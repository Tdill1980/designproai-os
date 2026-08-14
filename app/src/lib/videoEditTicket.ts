/**
 * The persisted Content Director video-edit ticket contract.
 *
 * Tickets deliberately live on the existing agent_social_posts card at
 * `generation_meta.edit_ticket`. The post remains the one queue item; this
 * object is its editable production brief. Finished output still uses the
 * existing media_urls/BrandBoard path.
 */

export const VIDEO_EDIT_TICKET_KIND = "video_edit" as const;
export const WRAPTV_COLOR_LOGO_ASSET = "bundled:wraptvworld-color-primary-v1" as const;
export const WRAPTV_COLOR_LOGO_SHA256 = "34538dc48614283da38c9c1af70090d65b4ee0a83093fc9dc8ac7c405ab3b9f9" as const;
export const VIDEO_EDIT_SOURCE_BUCKET = "wrap-files" as const;

export const VIDEO_EDIT_SERIES = [
  "behind_the_install",
  "behind_the_brand",
  "weprintwraps",
] as const;

export type VideoEditSeries = (typeof VIDEO_EDIT_SERIES)[number];
export type VideoEditBrand = "wraptvworld" | "weprintwraps";
export type VideoEditOutputKey = "longform" | "reel";
export type VideoEditMusicMode = "auto_unique" | "manual";
export type VideoEditTicketState =
  | "draft"
  | "needs_source"
  | "needs_installer_credit"
  | "ready"
  | "rendering"
  | "blocked"
  | "complete";

/** Show ownership is deterministic; a BTI card cannot drift into WPW, or vice versa. */
export function videoEditBrandForSeries(selectedSeries: VideoEditSeries): VideoEditBrand {
  return selectedSeries === "weprintwraps" ? "weprintwraps" : "wraptvworld";
}

export interface VideoEditOutputSpec {
  enabled: boolean;
  aspect_ratio: "16:9" | "9:16";
  music_mode: VideoEditMusicMode;
  music_url: string;
  music_title: string;
}

export interface VideoEditTickerSpec {
  enabled: boolean;
  moving: boolean;
  installer_handle: string;
  installer_location: string;
  show_song_title: boolean;
}

export interface VideoEditTicket {
  kind: typeof VIDEO_EDIT_TICKET_KIND;
  state: VideoEditTicketState;
  series: VideoEditSeries;
  requested_edits: string;
  source_video_url: string;
  output_url: string;
  /** Legacy single-output fields retained for existing Heat Gun cards. */
  aspect_ratio: "16:9" | "9:16";
  music_url: string;
  music_title: string;
  installer_handle: string;
  installer_location: string;
  ticker_enabled: boolean;
  ticker: VideoEditTickerSpec;
  outputs: Record<VideoEditOutputKey, VideoEditOutputSpec>;
  logo_asset: typeof WRAPTV_COLOR_LOGO_ASSET;
  logo_locked: true;
  logo_sha256: typeof WRAPTV_COLOR_LOGO_SHA256;
  source_render_job?: string;
  owner_id?: string;
  progress?: string;
  revision: number;
  updated_at?: string;
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function series(value: unknown): VideoEditSeries {
  return (VIDEO_EDIT_SERIES as readonly unknown[]).includes(value)
    ? value as VideoEditSeries
    : "behind_the_install";
}

function musicMode(value: unknown, url: string, title: string): VideoEditMusicMode {
  if (value === "manual" || value === "auto_unique") return value;
  return url || title ? "manual" : "auto_unique";
}

function outputSpec(
  raw: unknown,
  key: VideoEditOutputKey,
  fallback: { enabled: boolean; music_url: string; music_title: string },
): VideoEditOutputSpec {
  const row = record(raw);
  const url = text(row.music_url) || fallback.music_url;
  const title = text(row.music_title) || fallback.music_title;
  return {
    enabled: typeof row.enabled === "boolean" ? row.enabled : fallback.enabled,
    aspect_ratio: key === "longform" ? "16:9" : "9:16",
    music_mode: musicMode(row.music_mode, url, title),
    music_url: url,
    music_title: title,
  };
}

function state(value: unknown): VideoEditTicketState {
  const allowed: VideoEditTicketState[] = [
    "draft", "needs_source", "needs_installer_credit", "ready",
    "rendering", "blocked", "complete",
  ];
  return allowed.includes(value as VideoEditTicketState)
    ? value as VideoEditTicketState
    : "draft";
}

export function defaultVideoEditTicket(
  selectedSeries: VideoEditSeries = "behind_the_install",
): VideoEditTicket {
  const tickerEnabled = selectedSeries === "behind_the_install";
  return {
    kind: VIDEO_EDIT_TICKET_KIND,
    state: "needs_source",
    series: selectedSeries,
    requested_edits: "",
    source_video_url: "",
    output_url: "",
    aspect_ratio: "16:9",
    music_url: "",
    music_title: "",
    installer_handle: "",
    installer_location: "",
    ticker_enabled: tickerEnabled,
    ticker: {
      enabled: tickerEnabled,
      moving: tickerEnabled,
      installer_handle: "",
      installer_location: "",
      show_song_title: tickerEnabled,
    },
    outputs: {
      longform: {
        enabled: true,
        aspect_ratio: "16:9",
        music_mode: "auto_unique",
        music_url: "",
        music_title: "",
      },
      reel: {
        enabled: true,
        aspect_ratio: "9:16",
        music_mode: "auto_unique",
        music_url: "",
        music_title: "",
      },
    },
    logo_asset: WRAPTV_COLOR_LOGO_ASSET,
    logo_locked: true,
    logo_sha256: WRAPTV_COLOR_LOGO_SHA256,
    revision: 1,
  };
}

/** Read both the live Heat Gun shape and the extended multi-output shape. */
export function normalizeVideoEditTicket(value: unknown): VideoEditTicket | null {
  const raw = record(value);
  if (raw.kind !== VIDEO_EDIT_TICKET_KIND) return null;

  const selectedSeries = series(raw.series);
  const legacyAspect = raw.aspect_ratio === "9:16" ? "9:16" : "16:9";
  const legacyMusicUrl = text(raw.music_url);
  const legacyMusicTitle = text(raw.music_title);
  const outputs = record(raw.outputs);
  const hasExtendedOutputs = Object.keys(outputs).length > 0;
  const installerHandle = text(raw.installer_handle) || text(record(raw.ticker).installer_handle);
  const installerLocation = text(raw.installer_location)
    || text(record(raw.ticker).installer_location)
    || text(record(raw.ticker).location);
  const isBti = selectedSeries === "behind_the_install";
  const rawTicker = record(raw.ticker);
  const tickerEnabled = isBti
    ? true
    : (typeof raw.ticker_enabled === "boolean"
      ? raw.ticker_enabled
      : rawTicker.enabled === true);

  const ticket: VideoEditTicket = {
    ...defaultVideoEditTicket(selectedSeries),
    state: state(raw.state),
    requested_edits: text(raw.requested_edits),
    source_video_url: text(raw.source_video_url),
    output_url: text(raw.output_url),
    aspect_ratio: legacyAspect,
    music_url: legacyMusicUrl,
    music_title: legacyMusicTitle,
    installer_handle: installerHandle,
    installer_location: installerLocation,
    ticker_enabled: tickerEnabled,
    ticker: {
      enabled: tickerEnabled,
      // BTI's moving credit ticker is a locked show-format requirement.
      moving: isBti ? true : rawTicker.moving === true,
      installer_handle: installerHandle,
      installer_location: installerLocation,
      show_song_title: isBti ? true : rawTicker.show_song_title === true,
    },
    outputs: {
      longform: outputSpec(outputs.longform, "longform", {
        enabled: hasExtendedOutputs ? false : legacyAspect === "16:9",
        music_url: legacyAspect === "16:9" ? legacyMusicUrl : "",
        music_title: legacyAspect === "16:9" ? legacyMusicTitle : "",
      }),
      reel: outputSpec(outputs.reel, "reel", {
        enabled: hasExtendedOutputs ? false : legacyAspect === "9:16",
        music_url: legacyAspect === "9:16" ? legacyMusicUrl : "",
        music_title: legacyAspect === "9:16" ? legacyMusicTitle : "",
      }),
    },
    // Never accept a stale white/user-selected logo from persisted metadata.
    logo_asset: WRAPTV_COLOR_LOGO_ASSET,
    logo_locked: true,
    logo_sha256: WRAPTV_COLOR_LOGO_SHA256,
    revision: Math.max(1, Number(raw.revision) || 1),
  };

  const sourceRenderJob = text(raw.source_render_job);
  const ownerId = text(raw.owner_id);
  const progress = text(raw.progress);
  const updatedAt = text(raw.updated_at);
  if (sourceRenderJob) ticket.source_render_job = sourceRenderJob;
  if (ownerId) ticket.owner_id = ownerId;
  if (progress) ticket.progress = progress;
  if (updatedAt) ticket.updated_at = updatedAt;
  return ticket;
}

export function editTicketFromGenerationMeta(meta: unknown): VideoEditTicket | null {
  return normalizeVideoEditTicket(record(meta).edit_ticket);
}

export function withVideoEditTicket(meta: unknown, ticket: VideoEditTicket): UnknownRecord {
  return {
    ...record(meta),
    edit_ticket: normalizeVideoEditTicket(ticket) || ticket,
  };
}

/** An open ticket stays in Content Director even when it references an output. */
export function hasOpenVideoEditTicket(meta: unknown): boolean {
  const ticket = editTicketFromGenerationMeta(meta);
  return !!ticket && ticket.state !== "complete";
}

export function nextVideoEditTicketState(ticket: VideoEditTicket): VideoEditTicketState {
  if (!ticket.source_video_url) return "needs_source";
  if (ticket.series === "behind_the_install"
    && (!ticket.installer_handle.trim() || !ticket.installer_location.trim())) {
    return "needs_installer_credit";
  }
  return "ready";
}

export function validateVideoEditTicket(ticket: VideoEditTicket): string | null {
  if (!ticket.outputs.longform.enabled && !ticket.outputs.reel.enabled) {
    return "Choose at least one output: 16:9 longform or 9:16 reel.";
  }
  for (const key of ["longform", "reel"] as const) {
    const output = ticket.outputs[key];
    if (!output.enabled || output.music_mode !== "manual") continue;
    if (!output.music_title.trim()) return `Name the ${key} song, or use automatic unique-song rotation.`;
  }
  const longSong = ticket.outputs.longform.music_title.trim().toLowerCase();
  const reelSong = ticket.outputs.reel.music_title.trim().toLowerCase();
  const longSongUrl = ticket.outputs.longform.music_url.trim().toLowerCase();
  const reelSongUrl = ticket.outputs.reel.music_url.trim().toLowerCase();
  if (ticket.outputs.longform.enabled && ticket.outputs.reel.enabled
    && ticket.outputs.longform.music_mode === "manual"
    && ticket.outputs.reel.music_mode === "manual"
    && ((longSong && longSong === reelSong)
      || (longSongUrl && longSongUrl === reelSongUrl))) {
    return "Longform and reel must use different songs; choose another track or automatic unique-song rotation.";
  }
  if (ticket.series === "behind_the_install"
    && (!ticket.ticker_enabled || !ticket.ticker.enabled || !ticket.ticker.moving)) {
    return "Behind the Install requires the moving bottom ticker.";
  }
  if (ticket.logo_asset !== WRAPTV_COLOR_LOGO_ASSET
    || ticket.logo_sha256 !== WRAPTV_COLOR_LOGO_SHA256
    || ticket.logo_locked !== true) {
    return "WrapTVWorld productions must use the locked colored logo.";
  }
  return null;
}

export const VIDEO_EDIT_FILE_ACCEPT = ".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm";
export const VIDEO_EDIT_MAX_BYTES = 5 * 1024 * 1024 * 1024;

export interface VideoFileLike { name: string; type?: string; size: number }

export function videoFileExtension(file: Pick<VideoFileLike, "name">): "mp4" | "mov" | "webm" | null {
  const match = file.name.trim().toLowerCase().match(/\.([a-z0-9]+)$/);
  return match && ["mp4", "mov", "webm"].includes(match[1])
    ? match[1] as "mp4" | "mov" | "webm"
    : null;
}

export function videoContentType(file: Pick<VideoFileLike, "name" | "type">): string {
  const ext = videoFileExtension(file);
  if (ext === "mov") return "video/quicktime";
  if (ext === "webm") return "video/webm";
  return "video/mp4";
}

export function validateVideoEditFile(file: VideoFileLike): string | null {
  const ext = videoFileExtension(file);
  if (!ext) return "Choose an MP4, MOV, or WebM video.";
  if (!Number.isFinite(file.size) || file.size <= 0) return "That video file is empty.";
  if (file.size > VIDEO_EDIT_MAX_BYTES) return "Video is larger than the 5 GB upload limit.";
  const mime = text(file.type).toLowerCase();
  const allowed = ["video/mp4", "video/quicktime", "video/webm", "application/octet-stream", ""];
  if (!allowed.includes(mime)) return "Choose an MP4, MOV, or WebM video.";
  return null;
}

function safeSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function videoEditObjectPath(input: {
  ownerId: string;
  brand: string;
  postId: string;
  file: Pick<VideoFileLike, "name">;
  uploadId?: string;
}): string {
  const ext = videoFileExtension(input.file);
  if (!ext) throw new Error("Choose an MP4, MOV, or WebM video.");
  const owner = safeSegment(input.ownerId);
  const brand = safeSegment(input.brand);
  const post = safeSegment(input.postId);
  if (!owner || !brand || !post) throw new Error("Missing exact owner, brand, or card id for this upload.");
  const upload = safeSegment(input.uploadId || crypto.randomUUID());
  return `content-director/${owner}/${brand}/${post}/${upload}.${ext}`;
}
