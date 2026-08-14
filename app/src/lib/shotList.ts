/**
 * shotList — the Shot List tab's non-UI logic: upload raw footage to ONE shot
 * (never a shared pool), and enqueue the AI edit job for it.
 *
 * Reuses existing pipelines on purpose, per the 2026-08-03 plan:
 *  - Upload goes through the SAME path VideoStudio's "add from device" uses
 *    (wrap-files bucket + an agent_media_assets row) — no second media library.
 *  - Editing goes through the SAME video-render edge function every other
 *    Engine Room tool uses. source_ref carries `shotlist_<id>` so the worker
 *    (worker/video-renderer/index.js) can thread the shot back onto the
 *    finished render's board card.
 */
import { supabase } from "@/integrations/supabase/client";
import { kickParse } from "@/lib/kickParse";
import { resolveAssetType } from "@/lib/assetContentType";
import { toFetchableMediaUrl, mediaFilenameFromUrl } from "@/lib/mediaLinks";
import { inferEditType, type EditType } from "./shotEditType";

const db = supabase as any;

export type ShotStatus =
  | "planned" | "ready_to_film" | "filmed" | "uploaded"
  | "ai_editing" | "ready_for_review" | "approved" | "published";

export const SHOT_STATUSES: { key: ShotStatus; label: string }[] = [
  { key: "planned", label: "Planned" },
  { key: "ready_to_film", label: "Ready to Film" },
  { key: "filmed", label: "Filmed" },
  { key: "uploaded", label: "Uploaded" },
  { key: "ai_editing", label: "AI Editing" },
  { key: "ready_for_review", label: "Ready for Review" },
  { key: "approved", label: "Approved" },
  { key: "published", label: "Published" },
];

// EditType + inferEditType live in a pure module so they stay testable
// without a database (importing the Supabase client needs localStorage).
export type { EditType } from "./shotEditType";
export { inferEditType } from "./shotEditType";

export const EDIT_TYPES: { key: EditType; label: string }[] = [
  { key: "reel", label: "Reel" },
  { key: "story", label: "Story" },
  { key: "short_form_ad", label: "Short-form ad" },
  { key: "podcast_clip", label: "Podcast clip" },
  { key: "interview_clip", label: "Interview clip" },
  { key: "behind_the_scenes", label: "Behind-the-scenes" },
  { key: "long_form_segment", label: "Long-form segment" },
  { key: "broll", label: "B-roll" },
  { key: "carousel_assets", label: "Carousel assets" },
  { key: "static_ad", label: "Static ad (photo)" },
];

/** Blueprint shape (format/aspect/platform) per edit type — mirrors useAutoBuildVideo's FORMAT_SPECS. */
const EDIT_TYPE_SPEC: Record<EditType, { format: string; aspectRatio: "9:16" | "16:9" | "4:5"; platform: string; kind?: string }> = {
  reel: { format: "reel", aspectRatio: "9:16", platform: "instagram" },
  story: { format: "story", aspectRatio: "9:16", platform: "instagram" },
  short_form_ad: { format: "reel", aspectRatio: "9:16", platform: "instagram" },
  podcast_clip: { format: "reel", aspectRatio: "9:16", platform: "youtube" },
  interview_clip: { format: "reel", aspectRatio: "9:16", platform: "youtube" },
  behind_the_scenes: { format: "reel", aspectRatio: "9:16", platform: "instagram" },
  long_form_segment: { format: "youtube", aspectRatio: "16:9", platform: "youtube" },
  broll: { format: "reel", aspectRatio: "9:16", platform: "instagram" },
  carousel_assets: { format: "carousel", aspectRatio: "4:5", platform: "instagram", kind: "carousel" },
  static_ad: { format: "static", aspectRatio: "9:16", platform: "instagram", kind: "static_post" },
};

/** Photo-only edit types — a still frame per uploaded photo, no video timing needed. */
const STILL_KINDS = new Set(["carousel", "static_post"]);

export interface ShotListItem {
  id: string;
  brand: string;
  campaign?: string | null;
  content_type?: string | null;
  shot_title: string;
  filming_instruction?: string | null;
  responsible_person?: string | null;
  on_camera_person?: string | null;
  location?: string | null;
  props?: string | null;
  priority: "low" | "medium" | "high";
  status: ShotStatus;
  due_date?: string | null;
  hook?: string | null;
  cta?: string | null;
  platform?: string | null;
  notes?: string | null;
  edit_type?: EditType | null;
  raw_asset_ids: string[];
  cover_asset_id?: string | null;
  render_job_id?: string | null;
  board_task_id?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Upload one or more raw clips to a SINGLE shot. Same storage path + asset
 * registration VideoStudio's device upload uses, stamped with the shot id so
 * footage stays organized per item instead of pooling in one folder.
 */
export async function uploadRawFootageToShot(
  shot: Pick<ShotListItem, "id" | "brand">,
  files: FileList | File[],
  extraMeta?: Record<string, unknown>,
): Promise<{ ok: number; fail: number; assetIds: string[]; errors: string[] }> {
  const list = Array.from(files);
  let ok = 0, fail = 0;
  const assetIds: string[] = [];
  // Video/audio that lands here must also be QUEUED for transcription —
  // registering it in the library is not the same as making it usable.
  const parseTargets: ParseTarget[] = [];
  // Why the real message is carried back rather than just a count: a silent
  // RLS refusal on the agent_media_assets insert is exactly how "I uploaded it
  // but the shot still says (0)" happened — the file reached storage, the row
  // never landed, and the UI only said "1 upload(s) failed".
  const errors: string[] = [];

  for (const file of list) {
    // ONE resolver — see resolveAssetType. It reads extension AND mime, and
    // its return type CANNOT be `rendered_video`, so footage uploaded here can
    // never be typed as finished output and dropped out of the raw pool.
    const { assetType } = resolveAssetType({ filename: file.name, mimeType: file.type });
    const isAudio = assetType === "audio";
    const isVideo = assetType === "video";
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();
    const path = `shot-list/${shot.id}/${Date.now()}-${safe}`;

    const { error: upErr } = await supabase.storage.from("wrap-files")
      .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
    if (upErr) { fail++; errors.push(`${file.name}: ${upErr.message}`); console.error("[shotList] upload failed", file.name, upErr.message); continue; }

    const { data: urlData } = supabase.storage.from("wrap-files").getPublicUrl(path);
    const { data: asset, error: insErr } = await db.from("agent_media_assets").insert({
      asset_type: assetType,
      storage_url: urlData.publicUrl,
      title: safe.replace(/\.[^.]+$/, "").replace(/-/g, " "),
      original_filename: file.name,
      source_folder: "shot_list",
      file_size_bytes: file.size,
      brand: shot.brand,
      metadata: { shot_list_item_id: shot.id, ...(extraMeta || {}) },
    }).select("id").single();
    if (insErr || !asset) {
      fail++;
      errors.push(`${file.name}: ${insErr?.message || "could not register the file"}`);
      console.error("[shotList] asset insert failed", file.name, insErr?.message);
      continue;
    }
    ok++;
    assetIds.push(asset.id);
    if (isVideo || isAudio) {
      parseTargets.push({ url: urlData.publicUrl, filename: file.name, brand: shot.brand });
    }
  }

  if (assetIds.length) {
    const mergeErr = await mergeAssetIdsOntoShot(shot.id, assetIds);
    if (mergeErr) errors.push(`saved, but not attached to the shot: ${mergeErr}`);
  }

  // Footage that is never parsed is dead weight: no transcript, no scored
  // moments, invisible to Story Edit and to the music rule. See queueShotParse.
  if (parseTargets.length) await queueShotParse(parseTargets);

  // Upload -> edit -> Brand Board, with nobody clicking anything. Fired ONCE
  // per batch, not per file, so eight clips make one cut rather than eight.
  if (assetIds.length) await autoEditShotAfterUpload(shot.id);

  return { ok, fail, assetIds, errors };
}

interface ParseTarget { url: string; filename: string; brand?: string | null }

/**
 * Upload → EDIT → Brand Board, with nobody clicking anything.
 *
 * Owner, 2026-08-05: "if he just uploaded it should automatically go to
 * internal video editing then land in brand board."
 *
 * It didn't. `enqueueShotEdit` has always worked and has always been behind a
 * manual button in ShotListTab, so the chain stopped dead at "footage
 * uploaded". Measured against production the same day: **102 shots, and zero
 * of them have ever produced a render.** The button existed; nothing pressed
 * it. Same shape as the parse job that was never queued, one step later in the
 * same pipeline.
 *
 * The rest of the chain was already automatic — `video-render` writes
 * `video_render_jobs`, and the Brand Board reads that table, so a finished cut
 * lands in Finished Work on its own. This is the one missing link.
 *
 * ── WHAT IT PICKS, AND WHY IT SAYS SO ──────────────────────────────────────
 * `edit_type` is unset on all 102 shots, so an auto-edit has to choose. It
 * uses the shot's own `edit_type` when a human set one, then infers from the
 * shot's platform, and otherwise falls back to a vertical reel — the format
 * most of this footage is shot for. The choice is written back to the row, so
 * what it picked is visible and correctable rather than hidden.
 *
 * Never throws, and never fires twice: a shot that already has a render is
 * left alone, so adding a clip later cannot silently spend another render.
 * The manual button remains for a second, different cut.
 */
async function autoEditShotAfterUpload(shotId: string): Promise<void> {
  try {
    // Re-read: raw_asset_ids changed moments ago, and the caller only holds
    // {id, brand}. enqueueShotEdit needs the hook, CTA and title too.
    const { data: shot } = await db
      .from("shot_list_items")
      .select("*")
      .eq("id", shotId)
      .maybeSingle();
    if (!shot) return;

    // Already cut once. A second cut is a human decision, not an upload's.
    if (shot.render_job_id) return;
    if (!shot.raw_asset_ids?.length) return;

    const chosen: EditType =
      (shot.edit_type as EditType | null) ||
      inferEditType(shot.platform, shot.content_type);

    const res = await enqueueShotEdit(shot as ShotListItem, chosen);
    if (!res.ok) console.warn(`[shotList] auto-edit skipped for ${shotId}: ${res.error}`);
  } catch (e) {
    // The footage is saved and the parse is queued; a failed auto-edit costs
    // a first cut, which the manual button can still produce.
    console.warn("[shotList] auto-edit threw:", e);
  }
}


/**
 * Queue the parse for footage attached to a shot, and START it.
 *
 * THE BUG THIS FIXES (live, 2026-08-05): the shot-list paths registered video
 * in `agent_media_assets` and attached it to the shot — and stopped. They never
 * created a `video_parse_jobs` row, so eight DJI clips uploaded from a shoot
 * sat inert: no transcript, no content_moments, unusable by Story Edit, by
 * BrandCast's core-story pass, and by the speech-vs-music rule.
 *
 * It also evaded the guard in `tests/queue-starts-work.test.ts`, which checks
 * that every file inserting a parse job also kicks it. This file inserted
 * none, so there was nothing to catch. The guard now also asserts that a
 * surface which REGISTERS video queues a parse for it.
 *
 * Never throws: the asset row and the shot attachment are already saved, so a
 * failed enqueue costs a transcript, never the footage.
 */
async function queueShotParse(targets: ParseTarget[]): Promise<void> {
  try {
    const rows = targets.map((t) => ({
      kind: "url",
      media_url: t.url,
      filename: t.filename,
      // tags[0] is the SHOOT NAME by convention (src/lib/ingestTags.ts) — the
      // shot list is the shoot here, so parsed sources stay findable.
      tags: ["shot-list", ...(t.brand ? [String(t.brand)] : [])],
      status: "queued",
      created_by: "shot-list",
    }));
    const { error } = await db.from("video_parse_jobs").insert(rows);
    if (error) { console.warn("[shotList] parse enqueue failed:", error.message); return; }
    await kickParse();
  } catch (e) {
    console.warn("[shotList] parse enqueue threw:", e);
  }
}

/**
 * The real filename out of a share URL.
 *
 * Now one line over `mediaLinks.mediaFilenameFromUrl` — the local copy tested
 * `/\.[a-z0-9]{2,5}$/`, which happily accepts `.html` and `.aspx` and would
 * name a downloaded web page as if it were a clip. Kept exported because it
 * reads as this module's own vocabulary at the call sites.
 */
export function filenameFromUrl(url: string): string | null {
  return mediaFilenameFromUrl(url);
}

/** Returns an error message when the shot row itself refused the attach. */
async function mergeAssetIdsOntoShot(shotId: string, assetIds: string[]): Promise<string | null> {
  const { data: cur } = await db.from("shot_list_items").select("raw_asset_ids,status").eq("id", shotId).single();
  const merged = Array.from(new Set([...(cur?.raw_asset_ids || []), ...assetIds]));
  const nextStatus = cur?.status === "planned" || cur?.status === "ready_to_film" || cur?.status === "filmed"
    ? "uploaded" : cur?.status;
  const { error } = await db.from("shot_list_items")
    .update({ raw_asset_ids: merged, status: nextStatus, updated_at: new Date().toISOString() })
    .eq("id", shotId);
  return error?.message || null;
}

/**
 * Attach a direct URL (Google Drive share link, Dropbox, any direct video/
 * image/audio URL) to a shot instead of uploading a file — mobile-friendly
 * when the device connection is too slow to upload raw footage on-site. No
 * storage write: registers the URL as-is in agent_media_assets, same as an
 * upload, so it flows into enqueueShotEdit identically.
 */
export async function attachRawFootageUrlToShot(
  shot: Pick<ShotListItem, "id" | "brand">,
  url: string,
): Promise<{ ok: boolean; error?: string; assetId?: string }> {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return { ok: false, error: "Paste a full https:// URL" };

  // ── THE LINK MUST BECOME A FILE, OR IT MUST BE REFUSED ───────────────────
  //
  // This used to rewrite Dropbox links by swapping an EXISTING `dl=0`/`dl=1`
  // for `raw=1`. A share link that carried neither — which many do — matched
  // neither pattern, so nothing was rewritten and the row was saved pointing
  // at Dropbox's preview PAGE. The parse job then downloaded HTML, "completed"
  // on it, and produced no transcript, no duration and no moments. Nothing in
  // the chain could tell that apart from footage nobody had spoken over.
  //
  // `toFetchableMediaUrl` is now the single converter (shared with
  // sourceFootage.ts) and it refuses what it cannot convert with confidence.
  // Refusing is the point: an inert row that looks attached is strictly worse
  // than a red message the person who pasted the link can act on immediately.
  const link = toFetchableMediaUrl(trimmed);
  if (!link.ok) return { ok: false, error: link.reason };
  const storage_url = link.url;
  // Store the Drive id so the card can show Drive's own poster JPEG
  // (assetThumb) — a Drive file has no frame we can grab ourselves.
  const driveId = link.driveFileId;

  // A pasted link has no File object, so the URL is the only signal — that is
  // exactly the `url` rung of the resolver, and it keeps this path's answer
  // identical to the file-upload path's for the same extension. Resolved
  // against the ORIGINAL link: a converted Drive URL is `uc?export=download`,
  // which carries no extension at all, while the share link still names the
  // file.
  const { assetType: asset_type } = resolveAssetType({ url: trimmed, filename: link.filename });

  // Eight clips all titled "Linked footage" are indistinguishable on the shot
  // card — which is exactly what a real shoot produced on 2026-08-05. Both
  // Dropbox and Drive carry the name in the path, so recover it.
  const realName = link.filename;

  const { data: asset, error: insErr } = await db.from("agent_media_assets").insert({
    asset_type,
    storage_url,
    drive_file_id: driveId,
    title: realName ? realName.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ") : "Linked footage",
    original_filename: realName,
    source_folder: "shot_list",
    brand: shot.brand,
    metadata: { shot_list_item_id: shot.id, source: "url" },
  }).select("id").single();
  if (insErr || !asset) return { ok: false, error: insErr?.message || "Could not save that link" };

  const mergeErr = await mergeAssetIdsOntoShot(shot.id, [asset.id]);
  if (mergeErr) return { ok: false, error: `Link saved but not attached to the shot: ${mergeErr}` };

  // AUTOMATIC. Pasting a link is an upload — it must queue the transcription
  // and start it, exactly like the file path. Without this the footage is
  // registered and inert, which is how eight DJI clips from a live shoot
  // ended up with no transcript and no scored moments.
  if (asset_type === "video" || asset_type === "audio") {
    await queueShotParse([{
      url: storage_url,
      filename: realName || `shot-${shot.id.slice(0, 8)}`,
      brand: shot.brand,
    }]);
  }

  // Same chain as the file path — a pasted link is an upload.
  await autoEditShotAfterUpload(shot.id);

  return { ok: true, assetId: asset.id };
}

/**
 * Selecting the edit type IS the trigger — no separate submit. Builds a
 * video-render blueprint from the shot's own raw clips + brand/campaign/hook/
 * CTA/platform/notes, and enqueues it exactly like every other Engine Room
 * AI-edit path.
 */
export async function enqueueShotEdit(shot: ShotListItem, editType: EditType): Promise<{ ok: boolean; error?: string; renderJobId?: string }> {
  if (!shot.raw_asset_ids?.length) return { ok: false, error: "Upload raw footage to this shot first." };

  const { data: assets, error: assetErr } = await db
    .from("agent_media_assets")
    .select("id, storage_url, duration_seconds, asset_type")
    .in("id", shot.raw_asset_ids);
  if (assetErr) return { ok: false, error: assetErr.message };
  const usable = (assets || []).filter((a: any) => a.storage_url);
  if (!usable.length) return { ok: false, error: "None of this shot's uploaded clips have a usable file yet." };

  const spec = EDIT_TYPE_SPEC[editType];
  const isStill = STILL_KINDS.has(spec.kind || "");

  const scenes = usable.map((a: any, i: number) => ({
    sceneId: `shot_${i}`,
    clipId: a.id,
    clipUrl: a.storage_url,
    start: 0,
    end: isStill ? undefined : Math.max(2, Number(a.duration_seconds) || 8),
    purpose: i === 0 ? "hook" : "b_roll",
  }));
  const totalDuration = isStill ? 0 : scenes.reduce((t, s) => t + Math.max(0.5, Number(s.end) || 0), 0);

  const blueprint: Record<string, unknown> = {
    id: `shotlist_${shot.id}_${Date.now().toString(36)}`,
    kind: spec.kind || undefined,
    platform: spec.platform,
    totalDuration,
    aspectRatio: spec.aspectRatio,
    format: spec.format,
    source: "shot_list",
    brand: shot.brand,
    title: shot.shot_title,
    scenes,
    keepNativeAudio: !isStill,
    ...(shot.hook ? { headline: shot.hook } : {}),
    ...(!isStill && (shot.hook || shot.cta) ? { endCard: { duration: 2.5, text: shot.hook || shot.shot_title, cta: shot.cta || undefined } } : {}),
  };

  const { data, error } = await supabase.functions.invoke("video-render", {
    body: { blueprint, brand: shot.brand, source_ref: `shotlist_${shot.id}` },
  });
  if (error) return { ok: false, error: error.message };
  if (data?.ok === false) return { ok: false, error: data?.error || "Edit job failed to enqueue" };

  await db.from("shot_list_items").update({
    edit_type: editType,
    status: "ai_editing",
    render_job_id: data?.render_job_id || null,
    updated_at: new Date().toISOString(),
  }).eq("id", shot.id);

  return { ok: true, renderJobId: data?.render_job_id };
}
