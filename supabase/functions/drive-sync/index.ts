/**
 * drive-sync — Google Drive feeder for the RestylePro-native video pipeline.
 * Phase 2 of docs/VIDEO-AUTOCREATE-PILOT-KICKOFF.md (G1 + G2 + G6).
 *
 * Auth: Google SERVICE ACCOUNT (JWT → access token; the proven pattern from
 * the SEO engine). The pilot Drive folder must be shared with the service
 * account's email as Editor.
 *
 * Actions (POST JSON { action, ... }):
 *   scan            List video files in the pilot source folders (recursive),
 *                   dedupe by name+size and by drive_file_id, and register
 *                   them as agent_media_assets rows (metadata only,
 *                   storage_url stays null until hydrated). Also ensures the
 *                   output folder exists.
 *                   Body: { brand?, source_prefixes? (default ["02","04"]) }
 *   hydrate         Download registered clips from Drive (auth'd) and upload
 *                   to Supabase Storage so the renderer can stream them.
 *                   Body: { asset_ids? (else oldest unhydrated), limit? (default 5) }
 *   upload-render   Upload a finished render (public URL) into the Drive
 *                   output folder. Body: { file_url, filename }
 *   status          Counts: registered / hydrated / total bytes.
 *
 * Secrets:
 *   GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON  (required — full SA key JSON)
 *   DRIVE_ROOT_FOLDER_ID               (optional; default = CONTENT VIDEO MASTER)
 *
 * Caveats:
 *   - Per-file hydrate cap 95MB (edge memory guard) — bigger files are
 *     registered but flagged too_large; hydrate them manually if needed.
 *   - Files uploaded by a service account count against the SA's own Drive
 *     quota (~15GB). Fine for finished renders; revisit if volume grows.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveAssetType } from "../_shared/asset-type.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_ROOT = "1Ns9CTIUdrUv_g6bsxRq0Ez1fpMla5aj7"; // CONTENT VIDEO MASTER
const OUTPUT_FOLDER_NAME = "05 – Finished Content & Renders";
const MAX_HYDRATE_BYTES = 95 * 1024 * 1024;
const STORAGE_BUCKET = "wrap-files";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Google service-account auth (ported from the SEO engine) ────────────────
function b64url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function googleAccessToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`)));
  const jwt = `${header}.${claims}.${b64url(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Google token exchange failed: ${JSON.stringify(data).slice(0, 300)}`);
  return data.access_token;
}

// ── Drive helpers ───────────────────────────────────────────────────────────
const DRIVE = "https://www.googleapis.com/drive/v3";

async function driveList(token: string, q: string, fields: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let pageToken = "";
  do {
    const url = `${DRIVE}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(`nextPageToken,files(${fields})`)}` +
      `&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Drive list failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    out.push(...(data.files || []));
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return out;
}

async function listChildFolders(token: string, parentId: string) {
  return await driveList(
    token,
    `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    "id,name",
  );
}

// Walks a Drive tree for media. `kinds` selects the mime families to collect —
// the Asset Library needs PHOTOS as well as video, so this is no longer
// video-only (it keeps that as the default for every existing caller).
async function listVideosRecursive(
  token: string, folderId: string, folderPath: string, depth = 0,
  kinds: Array<"video" | "image" | "audio"> = ["video"],
): Promise<Array<{ id: string; name: string; size: number; path: string; mime: string }>> {
  if (depth > 6) return []; // sanity cap
  const mimeClause = kinds.map((k) => `mimeType contains '${k}/'`).join(" or ");
  const items = await driveList(
    token,
    `'${folderId}' in parents and trashed=false and (${mimeClause} or mimeType='application/vnd.google-apps.folder')`,
    "id,name,mimeType,size",
  );
  const found: Array<{ id: string; name: string; size: number; path: string; mime: string }> = [];
  for (const it of items) {
    const mime = String(it.mimeType || "");
    if (mime === "application/vnd.google-apps.folder") {
      found.push(...await listVideosRecursive(token, String(it.id), `${folderPath}/${it.name}`, depth + 1, kinds));
    } else {
      found.push({ id: String(it.id), name: String(it.name), size: Number(it.size || 0), path: folderPath, mime });
    }
  }
  return found;
}

async function ensureOutputFolder(token: string, rootId: string): Promise<string> {
  const existing = await driveList(
    token,
    `'${rootId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false and name contains '05'`,
    "id,name",
  );
  const hit = existing.find((f) => String(f.name).trim().startsWith("05"));
  if (hit) return String(hit.id);

  const res = await fetch(`${DRIVE}/files?supportsAllDrives=true`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: OUTPUT_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder", parents: [rootId] }),
  });
  if (!res.ok) throw new Error(`Create output folder failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const created = await res.json();
  return String(created.id);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    // Binary ingest — POST raw video bytes with ?action=ingest&filename=…&brand=…&tags=a,b
    // (handled before JSON parsing: the request body IS the file). Registers the
    // clip in agent_media_assets (already hydrated) and queues a video_parse_jobs
    // row so the parse worker adds transcript + hook scoring.
    const reqUrl = new URL(req.url);
    if (req.method === "POST" && reqUrl.searchParams.get("action") === "ingest") {
      const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const filename = reqUrl.searchParams.get("filename") || `upload_${crypto.randomUUID().slice(0, 8)}.mp4`;
      const brand = reqUrl.searchParams.get("brand") || "weprintwraps";
      const tags = (reqUrl.searchParams.get("tags") || "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
      const bytes = new Uint8Array(await req.arrayBuffer());
      if (!bytes.length) return json({ ok: false, error: "empty body" }, 400);
      const ext = (filename.match(/\.([a-z0-9]+)$/i)?.[1] || "mp4").toLowerCase();
      const path = `manual-uploads/${crypto.randomUUID()}.${ext}`;
      const up = await sb.storage.from(STORAGE_BUCKET).upload(path, bytes, {
        contentType: ext === "mov" ? "video/quicktime" : "video/mp4",
        upsert: true,
      });
      if (up.error) return json({ ok: false, error: `storage: ${up.error.message}` }, 500);
      const publicUrl = sb.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
      // HARDCODED "video" before this. The endpoint takes ARBITRARY BYTES with
      // a caller-supplied filename, so an mp3 posted here was registered as a
      // video — CLAUDE.md's documented audio fall-through, on a path that can
      // receive any media at all. One resolver now (extension + mime), and it
      // cannot return `rendered_video`.
      const { assetType } = resolveAssetType({
        filename,
        mimeType: req.headers.get("content-type"),
        url: publicUrl,
      });
      const { data: row, error: insErr } = await sb.from("agent_media_assets").insert({
        brand,
        asset_type: assetType,
        title: filename.replace(/\.[a-z0-9]+$/i, ""),
        original_filename: filename,
        source_folder: "manual-upload",
        storage_url: publicUrl,
        file_size_bytes: bytes.length,
        tags,
        ai_labels: { source: "drive-sync-ingest" },
      }).select("id").single();
      if (insErr) return json({ ok: false, error: `db: ${insErr.message}` }, 500);
      const { error: pjErr } = await sb.from("video_parse_jobs").insert({ kind: "url", media_url: publicUrl, filename, tags });
      if (pjErr) console.warn("[drive-sync] parse queue failed:", pjErr.message);
      return json({ ok: true, asset_id: row.id, storage_url: publicUrl, parse_queued: !pjErr });
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action || "status";

    const saRaw = Deno.env.get("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // status works without Google credentials
    if (action === "status") {
      const { count: total } = await supabase.from("agent_media_assets")
        .select("*", { count: "exact", head: true }).not("drive_file_id", "is", null);
      const { count: hydrated } = await supabase.from("agent_media_assets")
        .select("*", { count: "exact", head: true }).not("drive_file_id", "is", null).not("storage_url", "is", null);
      return json({
        ok: true,
        registered: total || 0,
        hydrated: hydrated || 0,
        credentials_configured: !!saRaw,
      });
    }

    if (!saRaw) {
      return json({ ok: false, error: "GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON secret not set. Create a Google Cloud service account, share CONTENT VIDEO MASTER with its email (Editor), and add the key JSON as this secret." }, 400);
    }
    const sa = JSON.parse(saRaw);
    const token = await googleAccessToken(sa);
    const rootId = Deno.env.get("DRIVE_ROOT_FOLDER_ID") || DEFAULT_ROOT;

    // ── list-folder / drive-token (service-role callers only) ───────────────
    // The media-parser worker uses these for AUTHED folder listing + file
    // downloads — the anonymous embeddedfolderview/uc paths only work on
    // public folders and never recurse. Returns the SA access token, so the
    // caller MUST present the service-role key.
    if (action === "list-folder" || action === "drive-token") {
      const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      // Strict string equality against this function's SUPABASE_SERVICE_ROLE_KEY
      // env broke the GitHub-runner path: parse-media resolves the service key
      // via the Management API (api-keys?reveal=true), and that copy doesn't
      // byte-match the env injection, so authed folder listing 401'd and every
      // private folder fell to the public scrape (2026-07-28). Verify by
      // CAPABILITY instead: fast-path the exact env key, otherwise prove the
      // presented key is service-grade by performing an admin-only call with
      // it. Anon/authenticated keys fail auth.admin; only service_role (legacy
      // JWT or new secret-key format) passes.
      let serviceGrade = bearer.length > 0 && bearer === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!serviceGrade && bearer.length > 20) {
        try {
          const probe = createClient(Deno.env.get("SUPABASE_URL")!, bearer);
          const { error: probeErr } = await probe.auth.admin.listUsers({ page: 1, perPage: 1 });
          serviceGrade = !probeErr;
        } catch {
          serviceGrade = false;
        }
      }
      if (!serviceGrade) {
        return json({ ok: false, error: "service-role key required" }, 401);
      }
      if (action === "drive-token") return json({ ok: true, access_token: token });
      const folderId = String(body.folder_id || "");
      if (!folderId) return json({ ok: false, error: "folder_id required" }, 400);
      const files = await listVideosRecursive(token, folderId, "");
      return json({ ok: true, files, access_token: token, sa_email: sa.client_email });
    }

    // ── scan ────────────────────────────────────────────────────────────────
    if (action === "scan") {
      const brand = body.brand || "weprintwraps";
      const prefixes: string[] = body.source_prefixes || ["02", "04"];

      const children = await listChildFolders(token, rootId);
      const sources = children.filter((f) => prefixes.some((p) => String(f.name).trim().startsWith(p)));
      if (!sources.length) {
        return json({ ok: false, error: `No source folders matching prefixes ${prefixes.join(",")} under the root. Is the folder shared with ${sa.client_email}?`, folders_seen: children.map((c) => c.name) }, 404);
      }

      const outputFolderId = await ensureOutputFolder(token, rootId);

      // Which media families to pull. Default stays video-only (existing
      // callers); the Asset Library passes ["video","image"] to bring photos in.
      const kinds: Array<"video" | "image" | "audio"> =
        Array.isArray(body.kinds) && body.kinds.length ? body.kinds : ["video"];

      // Collect all media across source folders
      const all: Array<{ id: string; name: string; size: number; path: string; mime: string }> = [];
      for (const f of sources) {
        all.push(...await listVideosRecursive(token, String(f.id), String(f.name), 0, kinds));
      }

      // Dedupe by (name, size) — 56 duplicate groups exist in the corpus
      const seen = new Set<string>();
      const unique: typeof all = [];
      let dupes = 0;
      for (const v of all) {
        const key = `${v.name}|${v.size}`;
        if (seen.has(key)) { dupes++; continue; }
        seen.add(key);
        unique.push(v);
      }

      // Upsert into agent_media_assets keyed by drive_file_id
      let inserted = 0, skipped = 0, failed = 0;
      for (const v of unique) {
        const { error } = await supabase.from("agent_media_assets").upsert({
          brand,
          // Type from the real Drive mime AND the real Drive filename — a
          // photo scan must not register every still as a video, and a song
          // must never fall through to either. Same resolver as every other
          // ingest path so Drive and upload cannot disagree about one file.
          asset_type: resolveAssetType({ filename: v.name, mimeType: v.mime }).assetType,
          ingest_source: "drive-sync",
          title: v.name.replace(/\.[a-z0-9]+$/i, ""),
          original_filename: v.name,
          drive_file_id: v.id,
          source_folder: v.path,
          file_size_bytes: v.size,
          ai_labels: { source: "drive-sync", too_large: v.size > MAX_HYDRATE_BYTES },
        }, { onConflict: "drive_file_id", ignoreDuplicates: true });
        if (error) { failed++; console.error("[drive-sync] upsert failed:", v.name, error.message); }
        else inserted++;
      }
      // ignoreDuplicates makes re-scans cheap; count what already existed
      const { count: totalRegistered } = await supabase.from("agent_media_assets")
        .select("*", { count: "exact", head: true }).not("drive_file_id", "is", null);
      skipped = (totalRegistered || 0) - inserted < 0 ? 0 : (totalRegistered || 0);

      return json({
        ok: true,
        scanned_folders: sources.map((s) => s.name),
        videos_found: all.length,
        duplicates_skipped: dupes,
        unique: unique.length,
        upsert_failures: failed,
        total_registered: totalRegistered || 0,
        output_folder_id: outputFolderId,
      });
    }

    // ── hydrate ─────────────────────────────────────────────────────────────
    if (action === "hydrate") {
      const limit = Math.min(Number(body.limit || 5), 10);
      // Skip files over the hydrate cap — otherwise the oldest oversized rows
      // permanently occupy the selection window and block smaller clips.
      let q = supabase.from("agent_media_assets")
        .select("id, original_filename, drive_file_id, file_size_bytes")
        .not("drive_file_id", "is", null)
        .is("storage_url", null)
        .lte("file_size_bytes", MAX_HYDRATE_BYTES)
        .order("created_at", { ascending: true })
        .limit(limit);
      if (Array.isArray(body.asset_ids) && body.asset_ids.length) {
        q = supabase.from("agent_media_assets")
          .select("id, original_filename, drive_file_id, file_size_bytes")
          .in("id", body.asset_ids);
      }
      const { data: rows, error: qErr } = await q;
      if (qErr) return json({ ok: false, error: qErr.message }, 500);
      if (!rows?.length) return json({ ok: true, hydrated: 0, message: "Nothing to hydrate" });

      const results: Array<{ id: string; name: string; ok: boolean; error?: string }> = [];
      for (const row of rows) {
        try {
          if ((row.file_size_bytes || 0) > MAX_HYDRATE_BYTES) {
            throw new Error(`too large (${Math.round((row.file_size_bytes || 0) / 1e6)}MB > 95MB cap)`);
          }
          const dl = await fetch(`${DRIVE}/files/${row.drive_file_id}?alt=media&supportsAllDrives=true`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!dl.ok) throw new Error(`drive download ${dl.status}`);
          const buf = new Uint8Array(await dl.arrayBuffer());
          const ext = (row.original_filename?.match(/\.([a-z0-9]+)$/i)?.[1] || "mp4").toLowerCase();
          const path = `drive-clips/${row.id}.${ext}`;
          const up = await supabase.storage.from(STORAGE_BUCKET).upload(path, buf, {
            contentType: ext === "mov" ? "video/quicktime" : "video/mp4",
            upsert: true,
          });
          if (up.error) throw new Error(`storage upload: ${up.error.message}`);
          const publicUrl = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
          const { error: updErr } = await supabase.from("agent_media_assets")
            .update({ storage_url: publicUrl }).eq("id", row.id);
          if (updErr) throw new Error(updErr.message);
          results.push({ id: row.id, name: row.original_filename, ok: true });
        } catch (e) {
          results.push({ id: row.id, name: row.original_filename, ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      }
      return json({ ok: true, hydrated: results.filter((r) => r.ok).length, results });
    }

    // ── upload-render ───────────────────────────────────────────────────────
    if (action === "upload-render") {
      const { file_url, filename } = body;
      if (!file_url || !filename) return json({ ok: false, error: "file_url and filename required" }, 400);

      const outputFolderId = await ensureOutputFolder(token, rootId);
      const src = await fetch(file_url);
      if (!src.ok) return json({ ok: false, error: `fetch source ${src.status}` }, 400);
      const buf = new Uint8Array(await src.arrayBuffer());

      const boundary = "drive-sync-" + crypto.randomUUID();
      const meta = JSON.stringify({ name: filename, parents: [outputFolderId] });
      const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`;
      const tail = `\r\n--${boundary}--`;
      const payload = new Uint8Array(head.length + buf.length + tail.length);
      payload.set(new TextEncoder().encode(head), 0);
      payload.set(buf, head.length);
      payload.set(new TextEncoder().encode(tail), head.length + buf.length);

      const up = await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
        body: payload,
      });
      if (!up.ok) return json({ ok: false, error: `drive upload ${up.status}: ${(await up.text()).slice(0, 200)}` }, 500);
      const created = await up.json();
      return json({ ok: true, drive_file_id: created.id, folder_id: outputFolderId });
    }

    return json({ ok: false, error: `Unknown action '${action}' (use scan | hydrate | upload-render | status)` }, 400);
  } catch (err) {
    console.error("[drive-sync] error:", err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
