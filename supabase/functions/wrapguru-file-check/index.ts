// =============================================================================
// wrapguru-file-check — WrapGuru's print-file checker + lead magnet.
//
// Ported from the WrapCommandAI `check-artwork-file` analyzer (the real one:
// it fetches the actual bytes and parses true dimensions / embedded DPI /
// color space / vector-ness, rather than guessing from the filename), and
// wired to the OUTCOME ROUTING this product needs:
//
//   PRINT-READY  -> return the WooCommerce add-to-cart link + product URL so
//                   the customer can buy the material immediately.
//   NOT USABLE   -> email the WPW design team to double-check it, AND hand the
//                   customer a path: the fixed-fee Print-Ready Prep / recreate
//                   fee, or DesignProAI RecreatePro to buy a recreate.
//
// Every check is persisted to `wrapguru_file_checks` so it surfaces in
// Admin -> WrapGuru Chats next to the transcript that produced it.
// =============================================================================

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { sendSlackMessage } from "../_shared/slack-webhook.ts";
import { graphMailConfigured, sendGraphMail } from "../_shared/graph-mail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DESIGN_TEAM_TO = Deno.env.get("WRAPGURU_DESIGN_TEAM_EMAIL") || "design@weprintwraps.com";

// Paid remediation paths offered when a file can't print as-is.
const RECREATE_URL = "https://www.restyleproai.com/recreatepro";
const PREP_FEE_USD = 199;   // Print-Ready Prep (automatic upscale / cleanup)
const RECREATE_FEE_USD = 199; // AI design recreate from the customer's reference

// Mirror of the wpw-sales-chat catalog (ids/prices must match the live Woo store).
const CATALOG: Record<string, { id: number; name: string; price: number; url: string }> = {
  avery: { id: 79, name: "Avery MPI 1105 + DOL 1460Z laminate", price: 5.27, url: "https://weprintwraps.com/our-products/avery-1105egrs-with-doz13607-lamination/" },
  "3m": { id: 72, name: "3M IJ180Cv3 + 8518 laminate", price: 5.27, url: "https://weprintwraps.com/our-products/3m-ij180-printed-wrap-film/" },
  perf: { id: 80, name: "Perforated Window Vinyl 50/50", price: 5.95, url: "https://weprintwraps.com/our-products/perforated-window-vinyl/" },
  wall: { id: 70093, name: "Wall Wrap Printed Vinyl", price: 3.25, url: "https://weprintwraps.com/our-products/wall-wrap-printed-vinyl/" },
  avery_contour: { id: 108, name: "Avery Contour-Cut", price: 6.32, url: "https://weprintwraps.com/our-products/avery-cut-contour-vinyl-graphics-54-roll-max-artwork-size-50/" },
  "3m_contour": { id: 19420, name: "3M Contour-Cut", price: 6.92, url: "https://weprintwraps.com/our-products/3m-cut-contour-vinyl-graphics-54-roll-max-artwork-size-50/" },
};

// Standard WooCommerce add-to-cart URL — no REST call needed.
function cartUrl(productId: number, qty = 1): string {
  const q = Math.max(1, Math.round(qty));
  return `https://weprintwraps.com/cart/?add-to-cart=${productId}${q > 1 ? `&quantity=${q}` : ""}`;
}

function svc() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

const fmtSize = (b: number) =>
  b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`;

// ─────────────────────────────────────────────────────────────────────────────
// REAL analysis — fetch the bytes and parse true dimensions, embedded DPI,
// color space and vector/raster. No guessing from the filename.
// ─────────────────────────────────────────────────────────────────────────────
interface RealAnalysis {
  format: string;
  parsed: boolean;
  is_vector: boolean;
  width_px?: number;
  height_px?: number;
  embedded_dpi?: number;
  color_space?: "RGB" | "CMYK" | "Grayscale" | "unknown";
  page_w_in?: number;
  page_h_in?: number;
}

const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];

function parsePNG(b: Uint8Array): RealAnalysis {
  const width = u32be(b, 16), height = u32be(b, 20), colorType = b[25];
  let dpi: number | undefined;
  for (let i = 8; i < b.length - 12;) {
    const len = u32be(b, i);
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    if (type === "pHYs") { const ppuX = u32be(b, i + 8); if (b[i + 16] === 1) dpi = Math.round(ppuX * 0.0254); break; }
    if (type === "IDAT") break;
    i += 12 + len;
    if (len < 0) break;
  }
  return {
    format: "PNG", parsed: true, is_vector: false,
    width_px: width, height_px: height, embedded_dpi: dpi,
    color_space: (colorType === 0 || colorType === 4) ? "Grayscale" : "RGB",
  };
}

function parseJPEG(b: Uint8Array): RealAnalysis {
  let w: number | undefined, h: number | undefined, comps: number | undefined, dpi: number | undefined;
  let i = 2;
  while (i < b.length - 1) {
    if (b[i] !== 0xFF) { i++; continue; }
    const marker = b[i + 1];
    if (marker === 0xD8 || marker === 0xD9 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
    const len = u16be(b, i + 2);
    if (marker === 0xE0 && b[i + 4] === 0x4A && b[i + 5] === 0x46) { // APP0 JFIF
      const units = b[i + 11], xd = u16be(b, i + 12);
      if (units === 1) dpi = xd; else if (units === 2) dpi = Math.round(xd * 2.54);
    }
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) { // SOF
      h = u16be(b, i + 5); w = u16be(b, i + 7); comps = b[i + 9];
    }
    if (marker === 0xDA) break; // SOS
    i += 2 + len;
  }
  return {
    format: "JPEG", parsed: !!w, is_vector: false,
    width_px: w, height_px: h, embedded_dpi: dpi,
    color_space: comps === 4 ? "CMYK" : comps === 1 ? "Grayscale" : "RGB",
  };
}

function parseTIFF(b: Uint8Array): RealAnalysis {
  const le = b[0] === 0x49;
  const r16 = (o: number) => le ? (b[o] | (b[o + 1] << 8)) : ((b[o] << 8) | b[o + 1]);
  const r32 = (o: number) => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3])) >>> 0;
  const ifd = r32(4), n = r16(ifd);
  let w: number | undefined, h: number | undefined, photo: number | undefined, xres: number | undefined, resunit = 2;
  for (let e = 0; e < n && ifd + 2 + e * 12 + 12 < b.length; e++) {
    const o = ifd + 2 + e * 12, tag = r16(o), val = r32(o + 8);
    if (tag === 256) w = val;
    else if (tag === 257) h = val;
    else if (tag === 262) photo = val;
    else if (tag === 296) resunit = val;
    else if (tag === 282 && val + 8 < b.length) { const num = r32(val), den = r32(val + 4) || 1; xres = num / den; }
  }
  const dpi = xres ? (resunit === 3 ? Math.round(xres * 2.54) : Math.round(xres)) : undefined;
  return {
    format: "TIFF", parsed: !!w, is_vector: false,
    width_px: w, height_px: h, embedded_dpi: dpi,
    color_space: photo === 5 ? "CMYK" : (photo === 2 || photo === 6) ? "RGB" : (photo === 0 || photo === 1) ? "Grayscale" : "unknown",
  };
}

function parsePDF(b: Uint8Array): RealAnalysis {
  const txt = new TextDecoder("latin1").decode(b.subarray(0, Math.min(b.length, 300000)));
  const m = txt.match(/\/MediaBox\s*\[\s*([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s*\]/);
  let pw: number | undefined, ph: number | undefined;
  if (m) { pw = (parseFloat(m[3]) - parseFloat(m[1])) / 72; ph = (parseFloat(m[4]) - parseFloat(m[2])) / 72; }
  return { format: "PDF", parsed: true, is_vector: true, page_w_in: pw, page_h_in: ph, color_space: "unknown" };
}

async function analyzeRealFile(fileUrl: string): Promise<RealAnalysis | null> {
  try {
    // The first 3MB carries every header we parse.
    let resp = await fetch(fileUrl, { headers: { Range: "bytes=0-3145727" } });
    if (!resp.ok && resp.status !== 206) resp = await fetch(fileUrl);
    if (!resp.ok && resp.status !== 206) return null;
    const b = new Uint8Array(await resp.arrayBuffer());
    if (b.length < 16) return null;
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return parsePNG(b);
    if (b[0] === 0xFF && b[1] === 0xD8) return parseJPEG(b);
    if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2A) || (b[0] === 0x4D && b[1] === 0x4D && b[3] === 0x2A)) return parseTIFF(b);
    if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return parsePDF(b);
    if (b[0] === 0x25 && b[1] === 0x21) return { format: "EPS", parsed: true, is_vector: true, color_space: "unknown" };
    return null;
  } catch (e) {
    console.error("[wrapguru-file-check] real analysis failed:", e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring — the real parse + the intended wrap size become concrete findings.
// ─────────────────────────────────────────────────────────────────────────────
type CheckStatus = "pass" | "warn" | "fail" | "info";

function effectiveDpi(ra: RealAnalysis, sqft: number): number {
  return Math.round(Math.sqrt((ra.width_px! * ra.height_px!) / (sqft * 144)));
}

function realFindings(ra: RealAnalysis, sqft: number | null) {
  const issues: string[] = [], recommendations: string[] = [], good: string[] = [];
  let score = 6;

  if (ra.is_vector) {
    score += 3;
    good.push(`${ra.format} vector file — scales cleanly to any wrap size.`);
    recommendations.push("Confirm all fonts are outlined (converted to curves).");
  }

  if (ra.width_px && ra.height_px) {
    good.push(`Actual dimensions: ${ra.width_px}×${ra.height_px}px${ra.embedded_dpi ? ` @ ${ra.embedded_dpi} DPI` : ""}.`);
    if (sqft && sqft > 0) {
      const dpi = effectiveDpi(ra, sqft);
      if (dpi >= 100) { score += 2; good.push(`≈${dpi} DPI across a ${sqft} sq ft wrap — excellent for printing.`); }
      else if (dpi >= 72) { score += 1; good.push(`≈${dpi} DPI across a ${sqft} sq ft wrap — good (wraps view at a distance).`); }
      else if (dpi >= 40) { score -= 1; issues.push(`Only ≈${dpi} DPI across a ${sqft} sq ft wrap — a little soft up close. A Print-Ready Prep upscale fixes this.`); }
      else { score -= 3; issues.push(`Only ≈${dpi} DPI across a ${sqft} sq ft wrap — too low, it will pixelate. Needs a Print-Ready Prep upscale or a recreate.`); }
    }
  }

  if (ra.color_space === "CMYK") good.push("CMYK color space ✓ — print-ready color.");
  else if (ra.color_space === "RGB") {
    issues.push("Color space is RGB — we print CMYK, so some colors can shift. We convert + proof before printing.");
    recommendations.push("Convert to CMYK for accurate wrap color.");
  } else if (ra.color_space === "Grayscale") issues.push("Grayscale color space — confirm that's intentional.");

  if (!ra.is_vector) recommendations.push("High-res raster prints great; vector (PDF/AI/EPS) is ideal if you have it.");
  recommendations.push('Include a 0.25" bleed on all edges.');

  return { score: Math.max(1, Math.min(10, score)), issues, recommendations, good };
}

// Fallback when the bytes couldn't be parsed — judge by type + size only.
function fallbackFindings(ext: string, fileSize: number) {
  const issues: string[] = [], recommendations: string[] = [], good: string[] = [];
  let score = 5;

  if (["pdf", "ai", "eps"].includes(ext)) {
    score += 2;
    good.push(`${ext.toUpperCase()} vector format — scales to any size.`);
    if (fileSize < 100 * 1024) issues.push("Vector file is very small — it may be simple shapes or a placeholder.");
  } else if (ext === "psd") {
    score += 1;
    recommendations.push("Photoshop files work, but vector (PDF/AI) is preferred for wraps.");
  } else if (["tif", "tiff"].includes(ext)) {
    score += 1;
  } else if (["png", "jpg", "jpeg"].includes(ext)) {
    if (fileSize > 10 * 1024 * 1024) { score += 1; good.push("Large file size suggests good resolution."); }
    else if (fileSize > 5 * 1024 * 1024) { /* neutral */ }
    else if (fileSize > 1 * 1024 * 1024) { score -= 1; issues.push("Image may need higher resolution for large-format printing (100+ DPI at full size)."); }
    else { score -= 2; issues.push("Image appears low resolution — likely not suitable for a vehicle wrap as-is."); }
  } else {
    score -= 2;
    issues.push(`Unusual file format (.${ext}) — our design team will verify compatibility.`);
  }

  recommendations.push('Include a 0.25" bleed on all edges.');
  return { score: Math.max(1, Math.min(10, score)), issues, recommendations, good };
}

// A structured checklist with the ACTUAL values, for the chat card + email.
function buildChecks(real: RealAnalysis | null, ext: string, fileSize: number, sqft: number | null) {
  const checks: Array<{ label: string; value: string; status: CheckStatus }> = [];
  const isVector = real?.is_vector ?? ["pdf", "ai", "eps", "svg"].includes(ext);
  const fmt = real?.format || (ext ? ext.toUpperCase() : "Unknown");

  checks.push({
    label: "File format",
    value: `${fmt}${isVector ? " · vector" : real ? " · raster" : ""}`,
    status: isVector ? "pass" : "info",
  });

  if (real?.width_px && real?.height_px) {
    checks.push({ label: "Resolution", value: `${real.width_px} × ${real.height_px} px`, status: "info" });
    if (sqft && sqft > 0) {
      const dpi = effectiveDpi(real, sqft);
      checks.push({
        label: `Effective DPI @ ${sqft} sq ft`,
        value: `≈ ${dpi} DPI`,
        status: dpi >= 72 ? "pass" : dpi >= 40 ? "warn" : "fail",
      });
    } else if (real.embedded_dpi) {
      checks.push({ label: "Embedded DPI", value: `${real.embedded_dpi} DPI`, status: real.embedded_dpi >= 100 ? "pass" : "warn" });
    }
  } else if (isVector) {
    checks.push({ label: "Scalability", value: "Vector — scales to any wrap size", status: "pass" });
  }

  if (real?.page_w_in && real?.page_h_in) {
    checks.push({ label: "Page size", value: `${real.page_w_in.toFixed(1)}" × ${real.page_h_in.toFixed(1)}"`, status: "info" });
  }

  if (real?.color_space && real.color_space !== "unknown") {
    checks.push({
      label: "Color space",
      value: real.color_space,
      status: real.color_space === "CMYK" ? "pass" : "warn",
    });
  }

  checks.push({ label: "File size", value: fmtSize(fileSize), status: "info" });
  return checks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Outcome routing — this is what makes it a lead magnet rather than a report.
// ─────────────────────────────────────────────────────────────────────────────
type Verdict = "print_ready" | "needs_prep" | "not_usable";

function verdictFor(score: number, checks: ReturnType<typeof buildChecks>): Verdict {
  if (checks.some((c) => c.status === "fail")) return "not_usable";
  if (score >= 7) return "print_ready";
  if (score >= 5) return "needs_prep";
  return "not_usable";
}

// Post the flagged file to Slack. This is the PRIMARY channel: Resend is
// blocking our sends, and a silent email failure is how WrapGuru's team
// notifications went unnoticed for 11 of 12 conversations. Slack is also the
// better surface for an internal "check this file" ping.
//
// Prefers a dedicated SLACK_WEBHOOK_URL_WRAPGURU, and falls back to the
// proof-support webhook that is already configured, so a flagged file lands
// somewhere real even before a new channel is wired up.
async function slackDesignTeam(p: {
  verdict: Verdict;
  score: number;
  fileName: string;
  fileUrl: string;
  sqft: number | null;
  vehicle: string | null;
  customerEmail: string | null;
  sessionId: string;
  issues: string[];
  checks: ReturnType<typeof buildChecks>;
}): Promise<boolean> {
  const heading = p.verdict === "not_usable"
    ? "🚫 File can't print as-is"
    : "🛠️ File needs prep before printing";
  const facts = [
    `*Score:* ${p.score}/10`,
    `*Vehicle:* ${p.vehicle || "not stated"}`,
    `*Wrap size:* ${p.sqft ? `${p.sqft} sq ft` : "not stated"}`,
    `*Customer:* ${p.customerEmail || "no email captured yet"}`,
    `*Session:* ${p.sessionId}`,
  ].join("\n");
  const checkLines = p.checks.map((c) => {
    const dot = c.status === "pass" ? "✅" : c.status === "warn" ? "⚠️" : c.status === "fail" ? "❌" : "•";
    return `${dot} ${c.label}: *${c.value}*`;
  }).join("\n");
  const issueLines = p.issues.length ? `\n*Issues*\n${p.issues.map((i) => `• ${i}`).join("\n")}` : "";

  const message = {
    text: `${heading} — ${p.fileName} (${p.score}/10)`,
    username: "WrapGuru",
    icon_emoji: ":mag:",
    blocks: [
      { type: "header", text: { type: "plain_text", text: heading, emoji: true } },
      { type: "section", text: { type: "mrkdwn", text: `*${p.fileName}*\n${facts}` } },
      { type: "section", text: { type: "mrkdwn", text: `${checkLines}${issueLines}` } },
      {
        type: "actions",
        elements: [{
          type: "button",
          text: { type: "plain_text", text: "Open the file", emoji: true },
          url: p.fileUrl,
        }],
      },
    ],
  };

  for (const key of ["SLACK_WEBHOOK_URL_WRAPGURU", "SLACK_WEBHOOK_URL_PROOF_SUPPORT"]) {
    const res = await sendSlackMessage(key, message);
    if (res.ok) return true;
    if (res.reason !== "missing_url") break; // real failure — don't spam the fallback
  }
  return false;
}

type TeamAlertPayload = {
  verdict: Verdict;
  score: number;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  sqft: number | null;
  vehicle: string | null;
  customerEmail: string | null;
  sessionId: string;
  issues: string[];
  checks: ReturnType<typeof buildChecks>;
};

// One body, shared by every email channel, so Graph and Resend can never drift.
function designTeamHtml(payload: TeamAlertPayload): string {
  const rows = payload.checks
    .map((c) => {
      const color = c.status === "pass" ? "#16a34a" : c.status === "warn" ? "#d97706" : c.status === "fail" ? "#dc2626" : "#64748b";
      return `<tr><td style="padding:6px 10px;color:#334155;">${c.label}</td><td style="padding:6px 10px;font-weight:600;color:${color};">${c.value}</td></tr>`;
    })
    .join("");
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;">
  <h2 style="margin:0 0 4px;font-size:20px;">File check flagged for review</h2>
  <p style="color:#64748b;font-size:14px;margin:0 0 16px;">WrapGuru scored this <strong>${payload.score}/10</strong> (${payload.verdict.replace(/_/g, " ")}). Please double-check before we quote a fix.</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px;background:#f8fafc;border-radius:8px;">${rows}</table>
  ${payload.issues.length ? `<p style="font-size:14px;color:#334155;margin:16px 0 4px;"><strong>Issues found</strong></p><ul style="font-size:14px;color:#475569;">${payload.issues.map((i) => `<li>${i}</li>`).join("")}</ul>` : ""}
  <p style="font-size:14px;color:#334155;margin:16px 0 4px;">
    <strong>Customer:</strong> ${payload.customerEmail || "no email captured yet"}<br/>
    <strong>Vehicle:</strong> ${payload.vehicle || "not stated"}<br/>
    <strong>Wrap size:</strong> ${payload.sqft ? `${payload.sqft} sq ft` : "not stated"}<br/>
    <strong>Session:</strong> ${payload.sessionId}
  </p>
  <p style="margin:18px 0;"><a href="${payload.fileUrl}" style="display:inline-block;padding:12px 22px;border-radius:10px;background:linear-gradient(90deg,#3b82f6,#ec4899);color:#fff;text-decoration:none;font-weight:700;font-size:14px;">Open the file →</a></p>
</div>`;
}

const teamAlertSubject = (p: TeamAlertPayload) =>
  `🎨 WrapGuru file check needs review — ${p.fileName} (${p.score}/10)`;

// Microsoft Graph — sends from a real WPW mailbox. This is a one-to-one
// internal alert at very low volume, which is exactly what mailbox sending is
// good at. Skipped cleanly when the Graph secrets are not set.
async function graphDesignTeam(payload: TeamAlertPayload): Promise<boolean> {
  if (!graphMailConfigured()) return false;
  return await sendGraphMail({
    to: DESIGN_TEAM_TO,
    subject: teamAlertSubject(payload),
    html: designTeamHtml(payload),
    replyTo: payload.customerEmail || undefined,
    fromName: "WrapGuru",
  });
}

async function emailDesignTeam(payload: TeamAlertPayload): Promise<boolean> {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return false;
  try {
    const resend = new Resend(resendKey);
    const r = await resend.emails.send({
      from: "WrapGuru <noreply@restyleproai.com>",
      to: [DESIGN_TEAM_TO],
      reply_to: payload.customerEmail || DESIGN_TEAM_TO,
      subject: teamAlertSubject(payload),
      html: designTeamHtml(payload),
    });
    return !r.error;
  } catch (e) {
    console.error("[wrapguru-file-check] team email failed:", e);
    return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const filePath = String(body.file_path || "").trim();
    let fileUrl = String(body.file_url || "").trim();
    const fileName = String(body.file_name || "").trim();
    const fileSize = Number(body.file_size || 0);
    const sessionId = String(body.session_id || "").trim();
    const sqft = body.sqft != null && Number(body.sqft) > 0 ? Number(body.sqft) : null;
    const vehicle = body.vehicle ? String(body.vehicle).slice(0, 120) : null;
    const customerEmail = body.email ? String(body.email).trim().toLowerCase() : null;
    const productKey = String(body.product_key || "avery");

    if ((!fileUrl && !filePath) || !fileName || !sessionId) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields: file_path (or file_url), file_name, session_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const db = svc();

    // The visitor uploads into the PRIVATE wrapguru-files bucket and sends only
    // the object path — they have no read access. We sign it here with the
    // service role so both the byte parse and the design team's review link
    // work without ever making a customer's artwork public. 7 days gives the
    // team a working link in their inbox.
    if (filePath) {
      if (!db) {
        return new Response(
          JSON.stringify({ success: false, error: "storage unavailable" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const { data: signed, error: signErr } = await db.storage
        .from("wrapguru-files")
        .createSignedUrl(filePath, 60 * 60 * 24 * 7);
      if (signErr || !signed?.signedUrl) {
        return new Response(
          JSON.stringify({ success: false, error: `could not read upload: ${signErr?.message || "unknown"}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      fileUrl = signed.signedUrl;
    }

    const ext = fileName.toLowerCase().split(".").pop() || "";
    const real = await analyzeRealFile(fileUrl);
    const findings = real ? realFindings(real, sqft) : fallbackFindings(ext, fileSize);
    const checks = buildChecks(real, ext, fileSize, sqft);
    const verdict = verdictFor(findings.score, checks);

    // ── Outcome routing ──────────────────────────────────────────────────────
    const product = CATALOG[productKey] || CATALOG.avery;
    let next_step: Record<string, unknown>;

    if (verdict === "print_ready") {
      // Usable -> straight to the cart.
      next_step = {
        action: "buy",
        headline: "This file is print-ready.",
        product: product.name,
        product_url: product.url,
        cart_url: cartUrl(product.id, sqft || 1),
        price_per_sqft: product.price,
        estimated_total: sqft ? Math.round(product.price * sqft * 100) / 100 : null,
      };
    } else if (verdict === "needs_prep") {
      // Fixable -> paid prep, then the cart.
      next_step = {
        action: "prep_then_buy",
        headline: "This will print, but it needs prep first.",
        fix: "Print-Ready Prep",
        fix_fee_usd: PREP_FEE_USD,
        recreate_url: RECREATE_URL,
        recreate_fee_usd: RECREATE_FEE_USD,
        product_url: product.url,
        cart_url: cartUrl(product.id, sqft || 1),
      };
    } else {
      // Not usable -> team review + a real path to buy a recreate.
      next_step = {
        action: "recreate",
        headline: "This file can't print as-is.",
        fix: "AI design recreate",
        recreate_url: RECREATE_URL,
        recreate_fee_usd: RECREATE_FEE_USD,
        prep_fee_usd: PREP_FEE_USD,
        team_notified: true,
      };
    }

    // Anything not immediately print-ready goes to the design team to verify.
    // Slack first (Resend is blocking us), email as a secondary attempt, and we
    // record WHICH channel actually delivered so this can't fail silently.
    let teamNotified = false;
    let notifyChannel: string | null = null;
    if (verdict !== "print_ready") {
      const common = {
        verdict, score: findings.score, fileName, fileUrl, sqft, vehicle,
        customerEmail, sessionId, issues: findings.issues, checks,
      };
      const full = { ...common, fileSize };
      const delivered: string[] = [];
      if (await slackDesignTeam(common)) delivered.push("slack");
      // Graph before Resend: Resend is suspended, so it is the one that works.
      if (await graphDesignTeam(full)) delivered.push("graph");
      if (await emailDesignTeam(full)) delivered.push("resend");
      if (delivered.length) {
        teamNotified = true;
        notifyChannel = delivered.join("+");
      }
      if (!teamNotified) notifyChannel = "none";
      if (verdict === "not_usable") (next_step as Record<string, unknown>).team_notified = teamNotified;
    }

    // Persist so it surfaces in Admin -> WrapGuru Chats beside the transcript.
    if (db) {
      const { error } = await db.from("wrapguru_file_checks").insert({
        session_id: sessionId,
        file_name: fileName,
        // Store the durable object path when we have one — signed URLs expire.
        file_url: filePath || fileUrl,
        file_size: fileSize,
        customer_email: customerEmail,
        vehicle,
        sqft,
        score: findings.score,
        verdict,
        checks,
        issues: findings.issues,
        recommendations: findings.recommendations,
        good: findings.good,
        analysis: real,
        team_notified: teamNotified,
        notify_channel: notifyChannel,
      });
      if (error) console.error("[wrapguru-file-check] persist failed:", error.message);
    }

    return new Response(
      JSON.stringify({
        success: true,
        score: findings.score,
        verdict,
        file_name: fileName,
        file_size_label: fmtSize(fileSize),
        parsed: !!real,
        analysis: real,
        checks,
        issues: findings.issues,
        recommendations: findings.recommendations,
        good: findings.good,
        next_step,
        team_notified: teamNotified,
        notify_channel: notifyChannel,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[wrapguru-file-check] error:", e);
    return new Response(
      JSON.stringify({ success: false, error: String(e).slice(0, 200) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
