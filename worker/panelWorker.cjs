/**
 * panelWorker.cjs — UniversalPanelizer asset processor
 * ----------------------------------------------------------------
 * Processes `production_panels` rows (status 'queued') into solid,
 * correctly-sized, pixel-accurate rectangular print sheets and routes them
 * straight into the ProductionFlow QC queue.
 *
 * Per job:
 *   queued -> rendering -> qc_pending   (| failed)
 *   1. Download the flat design source (mapping_payload.source_canvas).
 *   2. Deterministic transform (buildBleedPanel): flatten transparency to a
 *      solid sheet, place the design at the EXACT trim size WITHOUT distorting
 *      it, bleed the artwork to the edge. NO AI regeneration.
 *   3. Upload TIFF (+ web proof PNG) to the `production-files` bucket.
 *   4. Flip the row to 'qc_pending' with storage_path so ProductionFlow shows it.
 *
 * Storage timeouts are handled with bounded retry + exponential backoff.
 *
 * Run as a poller:   node worker/panelWorker.cjs
 * Or import:         const { executeQueuePanelProcess } = require('./panelWorker.cjs')
 */

const sharp = require("sharp");
const { createClient } = require("@supabase/supabase-js");
const { buildBleedPanel } = require("./build-bleed-panel.cjs");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://kfapjdyythzyvnpdeghu.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "production-files";
const POLL_MS = Number(process.env.PANEL_POLL_MS || 5000);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Storage upload with timeout + exponential backoff ─────────
async function uploadWithRetry(path, body, contentType, { tries = 4, timeoutMs = 60_000 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const upload = supabase.storage.from(BUCKET).upload(path, body, { contentType, upsert: true });
      const timeout = new Promise((_, rej) =>
        setTimeout(() => rej(new Error(`storage upload timed out after ${timeoutMs}ms`)), timeoutMs));
      const { error } = await Promise.race([upload, timeout]);
      if (error) throw error;
      return path;
    } catch (err) {
      lastErr = err;
      if (attempt < tries) {
        const wait = 2000 * 2 ** (attempt - 1); // 2s, 4s, 8s
        console.warn(`[PANEL] upload ${path} attempt ${attempt} failed: ${err.message} — retry in ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw new Error(`upload failed after ${tries} attempts: ${lastErr?.message}`);
}

async function setStatus(id, status, extra = {}) {
  await supabase.from("production_panels").update({ status, ...extra }).eq("id", id);
}

/**
 * Process one production_panels job end-to-end.
 * @param {{id:string, project_id:string, render_id:string, mapping_payload:any}} job
 */
async function executeQueuePanelProcess(job) {
  const startMs = Date.now();
  try {
    await setStatus(job.id, "rendering");

    const p = job.mapping_payload || {};
    const dims = p.dimensions || {};
    const source = p.source_canvas;
    if (!source) throw new Error("mapping_payload.source_canvas missing");

    // ── 1. Fetch the flat design source ──
    const res = await fetch(source);
    if (!res.ok) throw new Error(`source download failed (${res.status})`);
    let input = Buffer.from(await res.arrayBuffer());

    // ── 1b. OPTIONAL region crop (v75 aspect-locked coordinator) ──
    // When the coordinator passes a `crop` rect (percent of the FLAT master),
    // Sharp extracts exactly that panel zone before bleeding — this is the
    // deterministic "slice by coordinates", zero AI. Accepts leftPct/topPct/
    // widthPct/heightPct (or xPct/yPct/wPct/hPct). `mirror` flops the panel.
    const crop = p.crop || p.source_region || null;
    const leftPct = crop && (crop.leftPct ?? crop.xPct);
    const topPct = crop && (crop.topPct ?? crop.yPct);
    const wPct = crop && (crop.widthPct ?? crop.wPct);
    const hPct = crop && (crop.heightPct ?? crop.hPct);
    if (crop && wPct > 0 && hPct > 0) {
      const m = await sharp(input, { limitInputPixels: false }).metadata();
      const left = Math.max(0, Math.round((leftPct / 100) * m.width));
      const top = Math.max(0, Math.round((topPct / 100) * m.height));
      const width = Math.max(1, Math.min(m.width - left, Math.round((wPct / 100) * m.width)));
      const height = Math.max(1, Math.min(m.height - top, Math.round((hPct / 100) * m.height)));
      let pipe = sharp(input, { limitInputPixels: false }).extract({ left, top, width, height });
      if (p.mirror) pipe = pipe.flop();
      input = await pipe.png().toBuffer();
      console.log(`[PANEL] ${job.id} cropped zone ${left},${top} ${width}x${height}${p.mirror ? " (mirrored)" : ""} from master`);
    } else if (p.mirror) {
      input = await sharp(input, { limitInputPixels: false }).flop().png().toBuffer();
    }

    // ── 2. Deterministic pixel-accurate transform ──
    const { tiff, proof, meta } = await buildBleedPanel({
      input,
      widthIn: dims.base_width_inches,
      heightIn: dims.base_height_inches,
      bleedIn: dims.applied_bleed_inches ?? 2,
      ppi: 150,      // shop convention: 150 px/in embedded as 1500 DPI @ 10% RIP scale
      dpi: 1500,
      fit: p.fit || "cover", // proportionate by default — never silently squash
    });

    // ── 3. Upload to production-files ──
    const base = `production_runs/project_${job.project_id}/panel_${job.id}`;
    const tiffPath = `${base}_output.tiff`;
    const previewPath = `${base}_proof.png`;
    await uploadWithRetry(tiffPath, tiff, "image/tiff");
    await uploadWithRetry(previewPath, proof, "image/png");

    // ── 4. Route into QC queue ──
    await setStatus(job.id, "qc_pending", {
      storage_path: tiffPath,
      preview_path: previewPath,
      operator_notes: `OK ${meta.sheet_inches} @ ${meta.dpi}dpi (${meta.fit}) in ${Date.now() - startMs}ms`,
    });
    console.log(`[PANEL] ✓ ${job.id} → qc_pending (${meta.sheet_inches}, ${(tiff.length / 1024 / 1024).toFixed(1)}MB)`);
    return true;
  } catch (err) {
    console.error(`[PANEL] ✗ ${job.id}: ${err.message}`);
    await setStatus(job.id, "failed", { operator_notes: err.message });
    return false;
  }
}

// ── Poll loop: claim queued rows one at a time (memory-safe) ──
async function pollOnce() {
  const { data: jobs, error } = await supabase
    .from("production_panels")
    .select("id, project_id, render_id, mapping_payload")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) { console.error("[PANEL] poll error:", error.message); return; }
  if (jobs && jobs.length) await executeQueuePanelProcess(jobs[0]);
}

// Start the poll loop. Safe to call from index.js so the GENIE HTTP worker
// and this deterministic queue poller share one worker process (one health
// check, one set of env vars).
function startPolling() {
  console.log(`[PANEL] worker polling production_panels every ${POLL_MS}ms → bucket '${BUCKET}'`);
  const tick = async () => { try { await pollOnce(); } catch (e) { console.error(e); } finally { setTimeout(tick, POLL_MS); } };
  tick();
}

if (require.main === module) {
  startPolling();
}

module.exports = { executeQueuePanelProcess, startPolling };
