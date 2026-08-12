/**
 * Brand Board show actions — real, brand-scoped render plans behind the buttons.
 *
 * Planning is pure once the source render row is known. Running the plan writes
 * canonical draft posts first, then queues the existing video-render pipeline
 * with a make_creative_<post id> source_ref so reattach.js lands the finished
 * file on the exact draft that requested it.
 */
import { supabase } from "@/integrations/supabase/client";
import { canonicalBrandOrNull } from "@/lib/brandAliases";
import { REVIEW_STATES } from "@/lib/narrativeService";
import { showFormat, type ShowFormat } from "@/lib/showFormats";

const db = supabase as any;

export type BrandBoardShowAction =
  | "behind_the_install"
  | "behind_the_brand"
  | "wpw_content";

export type BrandBoardShowOutputKey = "longform" | "reel";

export type BrandBoardMusicLicenseType =
  | "owned_original"
  | "licensed"
  | "cc0"
  | "public_domain"
  | "unknown";

export interface BrandBoardMusicAssignment {
  assignmentId: string | null;
  assignmentKey: string;
  sourceRenderJob: string;
  outputKey: BrandBoardShowOutputKey | "shared" | "legacy";
  reuseGroupKey: string | null;
  trackId: string | null;
  rotationKey: string;
  title: string;
  url: string;
  licenseType: BrandBoardMusicLicenseType;
  licenseUrl: string | null;
  rightsOwner: string | null;
  selectionMode: "auto" | "manual";
  rotationCycle: number;
}

export interface BrandBoardShowActionInput {
  renderJobId: string;
  action: BrandBoardShowAction;
  /** Human-entered featured installer/shop Instagram handle. BTI only. */
  installerHandle?: string | null;
  /** Human-entered city + state, or country. BTI only. */
  installerLocation?: string | null;
  /** A human-selected real track URL when the source job has no music. BTI only. */
  musicUrl?: string | null;
  /** Legacy/shared song title. Per-output values below win when supplied. */
  musicTitle?: string | null;
  /** Each shape may use a different real track; blank uses automatic rotation. */
  musicUrls?: Partial<Record<BrandBoardShowOutputKey, string | null>>;
  /** Human-entered display titles paired with each output's selected track. */
  musicTitles?: Partial<Record<BrandBoardShowOutputKey, string | null>>;
  /** Optional catalog identities paired with explicit human selections. */
  musicTrackIds?: Partial<Record<BrandBoardShowOutputKey, string | null>>;
  /** License facts travel with every explicit track instead of living in copy. */
  musicLicenseTypes?: Partial<Record<BrandBoardShowOutputKey, BrandBoardMusicLicenseType | null>>;
  musicLicenseUrls?: Partial<Record<BrandBoardShowOutputKey, string | null>>;
  musicRightsOwners?: Partial<Record<BrandBoardShowOutputKey, string | null>>;
  /** When set by a human, both shapes intentionally share one reservation. */
  musicReuseGroupKey?: string | null;
  /** Resolved by the database rotation ledger; internal callers may supply it. */
  musicAssignments?: Partial<Record<BrandBoardShowOutputKey, BrandBoardMusicAssignment | null>>;
}

export interface BrandBoardSourceJob {
  id: string;
  brand?: string | null;
  source_ref?: string | null;
  status?: string | null;
  blueprint?: Record<string, any> | null;
  music_url?: string | null;
  captions?: unknown;
}

export interface BrandBoardShowOutput {
  key: BrandBoardShowOutputKey;
  label: string;
  aspectRatio: "16:9" | "9:16";
  format: "longform" | "reel";
  platform: "youtube" | "instagram";
  postType: "video" | "reel";
  destinations: string[];
  /** A real limitation retained on the plan; it never pads or invents scenes. */
  warning?: string;
  musicUrl: string | null;
  musicTitle: string | null;
  musicAssignment: BrandBoardMusicAssignment | null;
  blueprint: Record<string, unknown>;
}

export interface BrandBoardShowPlan {
  ok: boolean;
  reason: string;
  outputs: BrandBoardShowOutput[];
  showFormat: string | null;
  brand: string | null;
  angle: string;
  installerHandle: string;
  installerLocation: string;
  revision: string;
  sourceRenderJob: string;
  topic: string;
  /** Legacy summary value retained for existing callers (the longform track). */
  musicUrl: string | null;
  musicUrls: Record<BrandBoardShowOutputKey, string | null>;
  musicTitles: Record<BrandBoardShowOutputKey, string | null>;
  musicAssignments: Record<BrandBoardShowOutputKey, BrandBoardMusicAssignment | null>;
  captions: unknown;
}

export interface BrandBoardShowQueuedOutput {
  key: BrandBoardShowOutputKey;
  renderJobId: string;
  postId: string;
  existing: boolean;
}

export interface BrandBoardShowRunResult {
  ok: boolean;
  reason: string;
  queued: BrandBoardShowQueuedOutput[];
  errors: string[];
  plan: BrandBoardShowPlan;
}

function failedPlan(
  input: BrandBoardShowActionInput,
  reason: string,
  extra: Partial<BrandBoardShowPlan> = {},
): BrandBoardShowPlan {
  return {
    ok: false,
    reason,
    outputs: [],
    showFormat: null,
    brand: null,
    angle: "",
    installerHandle: "",
    installerLocation: "",
    revision: "",
    sourceRenderJob: String(input.renderJobId || ""),
    topic: "",
    musicUrl: null,
    musicUrls: { longform: null, reel: null },
    musicTitles: { longform: null, reel: null },
    musicAssignments: { longform: null, reel: null },
    captions: null,
    ...extra,
  };
}

/**
 * Formats only what the person supplied. It never derives a handle from a
 * title, URL, shop name, brand, or location.
 */
export function normalizeFeaturedInstallerHandle(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const handle = raw.startsWith("@") ? raw : `@${raw}`;
  return /^@[A-Za-z0-9._]{1,30}$/.test(handle) ? handle : "";
}

function cleanLocation(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function sceneDuration(scene: Record<string, any>): number {
  return Math.max(0, Number(scene?.end) - Number(scene?.start) || 0);
}

function trimScenes(
  rawScenes: unknown,
  seconds: number,
): { scenes: Record<string, unknown>[]; duration: number } {
  const scenes = Array.isArray(rawScenes) ? rawScenes : [];
  const target = Math.max(0, Number(seconds) || 0);
  const out: Record<string, unknown>[] = [];
  let used = 0;

  for (const raw of scenes) {
    if (!raw || typeof raw !== "object" || used >= target) continue;
    const scene = raw as Record<string, any>;
    const duration = sceneDuration(scene);
    if (!duration) continue;
    const take = Math.min(duration, target - used);
    out.push({ ...scene, end: Number(scene.start) + take });
    used += take;
  }
  return { scenes: out, duration: Math.round(used * 1000) / 1000 };
}

const STILL_MEDIA = /\.(?:avif|gif|jpe?g|png|svg|webp)(?:$|[?#])/i;

/** A BTI opener is a timed video clip, never a title card or held photograph. */
export function isMovingFootageScene(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const scene = raw as Record<string, any>;
  if (!sceneDuration(scene)) return false;
  const kind = String(scene.media_type || scene.mediaType || scene.kind || scene.type || "").toLowerCase();
  if (/title.?card|image|photo|poster|still/.test(kind)) return false;
  const src = String(scene.clipUrl || scene.clip_url || scene.source || "").trim();
  return Boolean(src) && !STILL_MEDIA.test(src);
}

/**
 * Move the first real video clip to frame one while preserving every supplied
 * scene exactly once. Returns null when a photo-only source cannot satisfy BTI.
 */
export function movingFootageFirst(rawScenes: unknown): Record<string, unknown>[] | null {
  const scenes = Array.isArray(rawScenes)
    ? rawScenes.filter((scene): scene is Record<string, unknown> => Boolean(scene && typeof scene === "object" && !Array.isArray(scene)))
    : [];
  const movingIndex = scenes.findIndex(isMovingFootageScene);
  if (movingIndex < 0) return null;
  if (movingIndex === 0) return scenes;
  return [scenes[movingIndex], ...scenes.slice(0, movingIndex), ...scenes.slice(movingIndex + 1)];
}

function selectedMusic(
  input: BrandBoardShowActionInput,
  job: BrandBoardSourceJob,
  base: Record<string, any>,
  key: BrandBoardShowOutputKey,
): { url: string; title: string; assignment: BrandBoardMusicAssignment | null } {
  const assignment = input.musicAssignments?.[key] || null;
  const selectedUrl = String(
    input.musicUrls?.[key]
      || input.musicUrl
      || assignment?.url
      || job.music_url
      || "",
  ).trim();
  const selectedTitle = String(
    input.musicTitles?.[key]
      || input.musicTitle
      || assignment?.title
      || base.music_title
      || base.musicTitle
      || "",
  ).trim().replace(/\s+/g, " ");
  return { url: selectedUrl, title: selectedTitle, assignment };
}

/** Stable output identity. Only an explicit reuse group collapses two shapes. */
export function btiMusicAssignmentKey(
  sourceRenderJob: string,
  outputKey: BrandBoardShowOutputKey,
  reuseGroupKey?: string | null,
): string {
  const source = String(sourceRenderJob || "").trim();
  const reuse = String(reuseGroupKey || "").trim();
  return reuse
    ? `wraptv-bti:reuse:${encodeURIComponent(reuse)}`
    : `wraptv-bti:${encodeURIComponent(source)}:${outputKey}`;
}

/** Small deterministic key; stable inputs make a second press idempotent. */
function revisionKey(parts: unknown[]): string {
  const text = JSON.stringify(parts);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function actionRule(action: BrandBoardShowAction): {
  brand: "wraptvworld" | "weprintwraps";
  format: ShowFormat | null;
  angle: string;
} | null {
  if (action === "wpw_content") {
    return {
      brand: "weprintwraps",
      format: null,
      angle: "WePrintWraps-owned footage kept in the WePrintWraps reel/video lane.",
    };
  }
  const format = showFormat(action);
  if (!format) return null;
  return { brand: "wraptvworld", format, angle: format.reference };
}

function outputBlueprint(input: {
  base: Record<string, any>;
  job: BrandBoardSourceJob;
  action: BrandBoardShowAction;
  brand: string;
  format: ShowFormat | null;
  key: BrandBoardShowOutputKey;
  revision: string;
  scenes: Record<string, unknown>[];
  duration: number;
  handle: string;
  location: string;
  musicUrl: string;
  musicTitle: string;
  musicAssignment: BrandBoardMusicAssignment | null;
  warning?: string;
}): Record<string, unknown> {
  const isLong = input.key === "longform";
  const blueprint: Record<string, unknown> = {
    ...input.base,
    id: `${String(input.base.id || input.job.id || "cut")}_${input.action}_${input.key}_${input.revision}`,
    source: "brand_board_show_action",
    source_render_job: String(input.job.id),
    brand_board_action: input.action,
    brand_board_revision: input.revision,
    show_output_key: input.key,
    brand: input.brand,
    show_format: input.format?.key ?? null,
    show_editor: input.format?.editor ?? null,
    show_form: isLong ? "long" : "short",
    aspectRatio: isLong ? "16:9" : "9:16",
    format: isLong ? "longform" : "reel",
    postType: isLong ? "video" : "reel",
    totalDuration: input.duration,
    scenes: input.scenes,
    music_url: input.musicUrl,
    music_title: input.musicTitle,
    music_assignment_id: input.musicAssignment?.assignmentId ?? null,
    music_assignment_key: input.musicAssignment?.assignmentKey ?? null,
    music_track_id: input.musicAssignment?.trackId ?? null,
    music_rotation_key: input.musicAssignment?.rotationKey ?? null,
    music_rotation_cycle: input.musicAssignment?.rotationCycle ?? null,
    music_selection_mode: input.musicAssignment?.selectionMode ?? null,
    music_license_type: input.musicAssignment?.licenseType ?? null,
    music_license_url: input.musicAssignment?.licenseUrl ?? null,
    music_rights_owner: input.musicAssignment?.rightsOwner ?? null,
    music_reuse_group_key: input.musicAssignment?.reuseGroupKey ?? null,
    opener_contract: input.action === "behind_the_install" ? "moving_footage" : undefined,
    ...(input.warning ? { show_form_duration_warning: input.warning } : {}),
  };

  // A prior WrapTV blueprint may carry a user-selected logo URL or BTI ticker.
  // Each named action writes its own contract instead of inheriting decoration
  // from a different show.
  delete blueprint.logoUrl;
  if (input.action !== "behind_the_install") delete blueprint.ticker;

  if (input.brand === "wraptvworld") {
    blueprint.logo = true;
    blueprint.logoPosition = "tr";
  }

  if (input.action === "behind_the_install") {
    const credit = `${input.handle} · ${input.location}`;
    blueprint.featured_installer_handle = input.handle;
    blueprint.featured_installer_location = input.location;
    blueprint.logo = true;
    blueprint.logoPosition = "tr";
    blueprint.ticker = {
      label: "FEATURED INSTALLER",
      names: [credit, `NOW PLAYING · ${input.musicTitle}`],
      cycleSeconds: Math.max(6, Number(input.base?.ticker?.cycleSeconds) || 12),
    };
  }

  return blueprint;
}

/**
 * Pure contract planner. The source row is passed explicitly so tests and the
 * UI can inspect the exact two blueprints without touching Supabase.
 */
export function planBrandBoardShowActionFromJob(
  input: BrandBoardShowActionInput,
  job: BrandBoardSourceJob | null | undefined,
): BrandBoardShowPlan {
  const sourceRenderJob = String(input.renderJobId || "").trim();
  if (!sourceRenderJob) return failedPlan(input, "Choose a source render first.");
  if (!job || String(job.id || "") !== sourceRenderJob) {
    return failedPlan(input, "That source render could not be found.");
  }

  const rule = actionRule(input.action);
  if (!rule) return failedPlan(input, `Unknown Brand Board show action "${String(input.action || "")}".`);

  const brand = canonicalBrandOrNull(job.brand);
  if (brand !== rule.brand) {
    return failedPlan(
      input,
      input.action === "wpw_content"
        ? "WPW reels/videos require a WePrintWraps source render; this action will not relabel another brand's footage."
        : "WrapTVWorld shows require a WrapTVWorld source render; this action will not borrow another brand's footage.",
      { brand },
    );
  }

  const base = (job.blueprint && typeof job.blueprint === "object" && !Array.isArray(job.blueprint))
    ? job.blueprint
    : {};
  const blueprintBrand = base.brand == null || String(base.brand).trim() === ""
    ? brand
    : canonicalBrandOrNull(base.brand);
  if (blueprintBrand !== brand) {
    return failedPlan(input, "The render row and its blueprint name different brands, so this action was refused.", { brand });
  }

  const topic = String(base.title || base.headline || base.caption || "").trim();
  if (!topic) {
    return failedPlan(input, "The source render has no title or headline, so a canonical draft cannot be named honestly.", { brand });
  }

  const arrangedScenes = input.action === "behind_the_install"
    ? movingFootageFirst(base.scenes)
    : (Array.isArray(base.scenes) ? base.scenes : []);
  if (input.action === "behind_the_install" && !arrangedScenes) {
    return failedPlan(input, "Behind the Install must open on moving footage; this source has no timed video clip.", { brand, topic });
  }
  const duration = (arrangedScenes || []).reduce((total, scene) => total + sceneDuration(scene as Record<string, any>), 0);
  if (!duration) {
    return failedPlan(input, "The source blueprint has no timed scenes to cut.", { brand, topic });
  }

  const handle = normalizeFeaturedInstallerHandle(input.installerHandle);
  const location = cleanLocation(input.installerLocation);
  if (input.action === "behind_the_install") {
    if (!String(input.installerHandle || "").trim()) {
      return failedPlan(input, "Behind the Install needs the featured installer/shop @Instagram handle. Enter the real handle; none will be invented.", { brand, topic });
    }
    if (!handle) {
      return failedPlan(input, "Enter a valid featured Instagram handle (letters, numbers, periods or underscores, up to 30 characters).", { brand, topic });
    }
    if (!location) {
      return failedPlan(input, "Behind the Install needs the featured installer/shop location (city + state, or country). None will be inferred.", { brand, topic, installerHandle: handle });
    }
    for (const key of ["longform", "reel"] as const) {
      const music = selectedMusic(input, job, base, key);
      if (!/^https?:\/\//i.test(music.url)) {
        return failedPlan(input, `Behind the Install ${key} output has no real music track URL.`, {
          brand, topic, installerHandle: handle, installerLocation: location,
        });
      }
      if (!music.title) {
        return failedPlan(input, `Behind the Install ${key} output needs the real song title for its ticker.`, {
          brand, topic, installerHandle: handle, installerLocation: location,
        });
      }
    }
    const short = rule.format?.forms?.find((form) => form.key === "short");
    const long = rule.format?.forms?.find((form) => form.key === "long");
    if (!short || !long) {
      return failedPlan(input, "Behind the Install has no declared long/short form contract.", {
        brand, topic, installerHandle: handle, installerLocation: location,
      });
    }
  }

  const musicByOutput = {
    longform: selectedMusic(input, job, base, "longform"),
    reel: selectedMusic(input, job, base, "reel"),
  };
  const revision = revisionKey([
    sourceRenderJob,
    String(base.id || ""),
    input.action,
    handle,
    location,
    musicByOutput,
    Math.round(duration * 1000),
  ]);

  const showLong = rule.format?.forms?.find((form) => form.key === "long");
  const showShort = rule.format?.forms?.find((form) => form.key === "short");
  const longTarget = input.action === "behind_the_install"
    ? Math.min(duration, showLong!.seconds[1])
    : duration;
  const reelTarget = input.action === "behind_the_install"
    ? Math.min(duration, showShort!.seconds[1])
    : Math.min(duration, 180);
  const longCut = trimScenes(arrangedScenes, longTarget);
  const reelCut = trimScenes(arrangedScenes, reelTarget);
  const longWarning = input.action === "behind_the_install" && showLong && duration < showLong.seconds[0]
    ? `This source has ${Math.round(duration)}s; the declared long-form target starts at ${showLong.seconds[0]}s. Rendering the real ${Math.round(duration)}s in 16:9 without padding or invented footage.`
    : undefined;

  const common = {
    base,
    job,
    action: input.action,
    brand,
    format: rule.format,
    revision,
    handle,
    location,
  };
  const outputs: BrandBoardShowOutput[] = [
    {
      key: "longform",
      label: "Longform (16:9)",
      aspectRatio: "16:9",
      format: "longform",
      platform: "youtube",
      postType: "video",
      destinations: ["youtube"],
      musicUrl: musicByOutput.longform.url || null,
      musicTitle: musicByOutput.longform.title || null,
      musicAssignment: musicByOutput.longform.assignment,
      ...(longWarning ? { warning: longWarning } : {}),
      blueprint: outputBlueprint({ ...common, key: "longform", scenes: longCut.scenes, duration: longCut.duration, musicUrl: musicByOutput.longform.url, musicTitle: musicByOutput.longform.title, musicAssignment: musicByOutput.longform.assignment, warning: longWarning }),
    },
    {
      key: "reel",
      label: "Reel / Short (9:16)",
      aspectRatio: "9:16",
      format: "reel",
      platform: "instagram",
      postType: "reel",
      destinations: ["instagram_reel", "youtube_short"],
      musicUrl: musicByOutput.reel.url || null,
      musicTitle: musicByOutput.reel.title || null,
      musicAssignment: musicByOutput.reel.assignment,
      blueprint: outputBlueprint({ ...common, key: "reel", scenes: reelCut.scenes, duration: reelCut.duration, musicUrl: musicByOutput.reel.url, musicTitle: musicByOutput.reel.title, musicAssignment: musicByOutput.reel.assignment }),
    },
  ];

  return {
    ok: true,
    reason: `Ready to queue ${outputs.length} brand-scoped renders: 16:9 longform and 9:16 Reel / Short.${longWarning ? ` ${longWarning}` : ""}`,
    outputs,
    showFormat: rule.format?.key ?? null,
    brand,
    angle: rule.angle,
    installerHandle: handle,
    installerLocation: location,
    revision,
    sourceRenderJob,
    topic,
    musicUrl: musicByOutput.longform.url || null,
    musicUrls: {
      longform: musicByOutput.longform.url || null,
      reel: musicByOutput.reel.url || null,
    },
    musicTitles: {
      longform: musicByOutput.longform.title || null,
      reel: musicByOutput.reel.title || null,
    },
    musicAssignments: {
      longform: musicByOutput.longform.assignment,
      reel: musicByOutput.reel.assignment,
    },
    captions: job.captions ?? null,
  };
}

async function fetchBrandBoardSourceJob(
  input: BrandBoardShowActionInput,
): Promise<{ job: BrandBoardSourceJob | null; error: string | null }> {
  const { data, error } = await db
    .from("video_render_jobs")
    .select("id, brand, source_ref, status, blueprint, music_url, captions")
    .eq("id", input.renderJobId)
    .maybeSingle();
  return {
    job: data as BrandBoardSourceJob | null,
    error: error ? (error.message || "The source render could not be read.") : null,
  };
}

interface ManualMusicChoice {
  trackId: string | null;
  title: string;
  url: string;
  licenseType: BrandBoardMusicLicenseType | null;
  licenseUrl: string | null;
  rightsOwner: string | null;
}

function manualMusicChoice(
  input: BrandBoardShowActionInput,
  key: BrandBoardShowOutputKey,
): ManualMusicChoice | null {
  const trackId = String(input.musicTrackIds?.[key] || "").trim() || null;
  const title = String(input.musicTitles?.[key] || input.musicTitle || "").trim().replace(/\s+/g, " ");
  const url = String(input.musicUrls?.[key] || input.musicUrl || "").trim();
  if (!trackId && !title && !url) return null;
  return {
    trackId,
    title,
    url,
    licenseType: input.musicLicenseTypes?.[key] || null,
    licenseUrl: String(input.musicLicenseUrls?.[key] || "").trim() || null,
    rightsOwner: String(input.musicRightsOwners?.[key] || "").trim() || null,
  };
}

const MUSIC_LICENSES = new Set<BrandBoardMusicLicenseType>([
  "owned_original", "licensed", "cc0", "public_domain", "unknown",
]);

function assignmentFromRpc(raw: unknown): BrandBoardMusicAssignment {
  const row = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | null;
  if (!row || typeof row !== "object") throw new Error("The music rotation ledger returned no assignment.");
  const licenseType = String(row.license_type || "unknown") as BrandBoardMusicLicenseType;
  const outputKey = String(row.output_key || "") as BrandBoardMusicAssignment["outputKey"];
  const selectionMode = String(row.selection_mode || "") as BrandBoardMusicAssignment["selectionMode"];
  const assignment: BrandBoardMusicAssignment = {
    assignmentId: String(row.assignment_id || "").trim() || null,
    assignmentKey: String(row.assignment_key || "").trim(),
    sourceRenderJob: String(row.source_render_job || "").trim(),
    outputKey,
    reuseGroupKey: String(row.reuse_group_key || "").trim() || null,
    trackId: String(row.track_id || "").trim() || null,
    rotationKey: String(row.rotation_key || "").trim(),
    title: String(row.track_title || "").trim(),
    url: String(row.track_url || "").trim(),
    licenseType,
    licenseUrl: String(row.license_url || "").trim() || null,
    rightsOwner: String(row.rights_owner || "").trim() || null,
    selectionMode,
    rotationCycle: Number(row.rotation_cycle),
  };
  if (!assignment.assignmentKey || !assignment.sourceRenderJob || !assignment.rotationKey
      || !assignment.title || !/^https?:\/\//i.test(assignment.url)
      || !["longform", "reel", "shared", "legacy"].includes(assignment.outputKey)
      || !["auto", "manual"].includes(assignment.selectionMode)
      || !MUSIC_LICENSES.has(assignment.licenseType)
      || !Number.isInteger(assignment.rotationCycle) || assignment.rotationCycle < 1) {
    throw new Error("The music rotation ledger returned an invalid assignment contract.");
  }
  return assignment;
}

async function requestMusicAssignment(input: {
  assignmentKey: string;
  sourceRenderJob: string;
  outputKey: BrandBoardShowOutputKey | "shared";
  reuseGroupKey: string | null;
  manual: ManualMusicChoice | null;
  excludeRotationKeys: string[];
  reserve: boolean;
}): Promise<BrandBoardMusicAssignment> {
  const { data, error } = await db.rpc("assign_wraptv_bti_music", {
    p_assignment_key: input.assignmentKey,
    p_source_render_job: input.sourceRenderJob,
    p_output_key: input.outputKey,
    p_reuse_group_key: input.reuseGroupKey,
    p_manual_track_id: input.manual?.trackId || null,
    p_manual_title: input.manual?.title || null,
    p_manual_url: input.manual?.url || null,
    p_manual_license_type: input.manual?.licenseType || null,
    p_manual_license_url: input.manual?.licenseUrl || null,
    p_manual_rights_owner: input.manual?.rightsOwner || null,
    p_exclude_rotation_keys: [...input.excludeRotationKeys],
    p_reserve: input.reserve,
  });
  if (error) throw new Error(error.message || "The original-song rotation could not assign a track.");
  return assignmentFromRpc(data);
}

function sameManualChoice(a: ManualMusicChoice | null, b: ManualMusicChoice | null): boolean {
  if (!a || !b) return true;
  return a.trackId === b.trackId && a.title === b.title && a.url === b.url;
}

async function resolveBtiMusic(
  input: BrandBoardShowActionInput,
  job: BrandBoardSourceJob,
  reserve: boolean,
): Promise<BrandBoardShowActionInput> {
  if (input.action !== "behind_the_install") return input;

  const reuseGroupKey = String(input.musicReuseGroupKey || "").trim() || null;
  const longManual = manualMusicChoice(input, "longform");
  const reelManual = manualMusicChoice(input, "reel");
  for (const manual of [longManual, reelManual]) {
    if (manual && !manual.trackId && !manual.url) {
      throw new Error("A manual song title needs its catalog track or real http(s) URL.");
    }
    if (manual?.url && !/^https?:\/\//i.test(manual.url)) {
      throw new Error("A manual music track must use a valid http(s) URL.");
    }
  }
  if (reuseGroupKey && !sameManualChoice(longManual, reelManual)) {
    throw new Error("The shared-song option is on, but the two outputs name different manual tracks.");
  }

  if (reuseGroupKey) {
    const assignment = await requestMusicAssignment({
      assignmentKey: btiMusicAssignmentKey(job.id, "longform", reuseGroupKey),
      sourceRenderJob: job.id,
      outputKey: "shared",
      reuseGroupKey,
      manual: longManual || reelManual,
      excludeRotationKeys: [],
      reserve,
    });
    return {
      ...input,
      musicUrls: { longform: assignment.url, reel: assignment.url },
      musicTitles: { longform: assignment.title, reel: assignment.title },
      musicAssignments: { longform: assignment, reel: assignment },
    };
  }

  const assignments: Partial<Record<BrandBoardShowOutputKey, BrandBoardMusicAssignment>> = {};
  const excluded: string[] = [];
  for (const key of ["longform", "reel"] as const) {
    const assignment = await requestMusicAssignment({
      assignmentKey: btiMusicAssignmentKey(job.id, key),
      sourceRenderJob: job.id,
      outputKey: key,
      reuseGroupKey: null,
      manual: key === "longform" ? longManual : reelManual,
      excludeRotationKeys: excluded,
      reserve,
    });
    assignments[key] = assignment;
    if (assignment.selectionMode === "auto") excluded.push(assignment.rotationKey);
  }
  return {
    ...input,
    musicUrls: {
      longform: assignments.longform!.url,
      reel: assignments.reel!.url,
    },
    musicTitles: {
      longform: assignments.longform!.title,
      reel: assignments.reel!.title,
    },
    musicAssignments: assignments,
  };
}

/** Validate footage, brand and human credits before reserving a rotation slot. */
function preflightWithoutMusic(
  input: BrandBoardShowActionInput,
  job: BrandBoardSourceJob,
): BrandBoardShowPlan {
  if (input.action !== "behind_the_install") return planBrandBoardShowActionFromJob(input, job);
  return planBrandBoardShowActionFromJob({
    ...input,
    musicUrls: {
      longform: "https://music-preview.invalid/longform.mp3",
      reel: "https://music-preview.invalid/reel.mp3",
    },
    musicTitles: {
      longform: "Original track assigned when queued",
      reel: "Original track assigned when queued",
    },
  }, job);
}

/** Fetch and preview the exact database-backed rotation. No reservation write. */
export async function planBrandBoardShowAction(
  input: BrandBoardShowActionInput,
): Promise<BrandBoardShowPlan> {
  const source = await fetchBrandBoardSourceJob(input);
  if (source.error) return failedPlan(input, source.error);
  if (!source.job) return failedPlan(input, "That source render could not be found.");
  const preflight = preflightWithoutMusic(input, source.job);
  if (!preflight.ok) return preflight;
  try {
    const resolved = await resolveBtiMusic(input, source.job, false);
    return planBrandBoardShowActionFromJob(resolved, source.job);
  } catch (error) {
    return failedPlan(input, error instanceof Error ? error.message : String(error), {
      brand: preflight.brand,
      topic: preflight.topic,
      installerHandle: preflight.installerHandle,
      installerLocation: preflight.installerLocation,
    });
  }
}

function generationMeta(plan: BrandBoardShowPlan, output: BrandBoardShowOutput): Record<string, unknown> {
  return {
    source: "brand-board-show-action",
    source_render_job: plan.sourceRenderJob,
    brand_board_action: output.blueprint.brand_board_action,
    brand_board_revision: plan.revision,
    show_output_key: output.key,
    show_format: plan.showFormat,
    show_angle: plan.angle,
    music_url: output.musicUrl,
    music_title: output.musicTitle,
    music_assignment_id: output.musicAssignment?.assignmentId ?? null,
    music_assignment_key: output.musicAssignment?.assignmentKey ?? null,
    music_track_id: output.musicAssignment?.trackId ?? null,
    music_rotation_key: output.musicAssignment?.rotationKey ?? null,
    music_rotation_cycle: output.musicAssignment?.rotationCycle ?? null,
    music_selection_mode: output.musicAssignment?.selectionMode ?? null,
    music_license_type: output.musicAssignment?.licenseType ?? null,
    music_license_url: output.musicAssignment?.licenseUrl ?? null,
    music_rights_owner: output.musicAssignment?.rightsOwner ?? null,
    music_reuse_group_key: output.musicAssignment?.reuseGroupKey ?? null,
    output_aspect_ratio: output.aspectRatio,
    destinations: output.destinations,
    ...(plan.showFormat === "behind_the_install"
      ? {
          featured_installer_handle: plan.installerHandle,
          featured_installer_location: plan.installerLocation,
          credits_editable: true,
        }
      : {}),
  };
}

async function existingRevisionPost(
  plan: BrandBoardShowPlan,
  output: BrandBoardShowOutput,
): Promise<Record<string, any> | null> {
  const { data, error } = await db
    .from("agent_social_posts")
    .select("id, media_urls, generation_meta")
    .eq("brand", plan.brand)
    .contains("generation_meta", {
      source_render_job: plan.sourceRenderJob,
      brand_board_action: output.blueprint.brand_board_action,
      brand_board_revision: plan.revision,
      show_output_key: output.key,
    })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function createRevisionPost(
  plan: BrandBoardShowPlan,
  output: BrandBoardShowOutput,
): Promise<Record<string, any>> {
  const meta = generationMeta(plan, output);
  const { data, error } = await db
    .from("agent_social_posts")
    .insert({
      brand: plan.brand,
      platform: output.platform,
      post_type: output.postType,
      caption: plan.topic,
      hashtags: [],
      media_urls: [],
      scheduled_date: null,
      status: REVIEW_STATES.social,
      created_by: "brand-board-show-action",
      generation_meta: meta,
      engagement: {
        source_render_job: plan.sourceRenderJob,
        brand_board_action: output.blueprint.brand_board_action,
        brand_board_revision: plan.revision,
      },
    })
    .select("id, media_urls, generation_meta")
    .single();
  if (error || !data) throw new Error(error?.message || "Could not create the canonical draft.");
  return data;
}

/**
 * Queue the real renderer and canonical drafts. A repeated press with identical
 * inputs reuses the same revision; changing either BTI credit creates a new
 * revision, so corrected credits can never silently reuse the old files.
 */
export async function runBrandBoardShowAction(
  input: BrandBoardShowActionInput,
): Promise<BrandBoardShowRunResult> {
  const queued: BrandBoardShowQueuedOutput[] = [];
  const errors: string[] = [];
  const source = await fetchBrandBoardSourceJob(input);
  if (source.error || !source.job) {
    const plan = failedPlan(input, source.error || "That source render could not be found.");
    return { ok: false, reason: plan.reason, queued, errors, plan };
  }
  const preflight = preflightWithoutMusic(input, source.job);
  if (!preflight.ok) {
    return { ok: false, reason: preflight.reason, queued, errors, plan: preflight };
  }

  let plan: BrandBoardShowPlan;
  try {
    const resolved = await resolveBtiMusic(input, source.job, true);
    plan = planBrandBoardShowActionFromJob(resolved, source.job);
  } catch (error) {
    plan = failedPlan(input, error instanceof Error ? error.message : String(error), {
      brand: preflight.brand,
      topic: preflight.topic,
      installerHandle: preflight.installerHandle,
      installerLocation: preflight.installerLocation,
    });
  }
  if (!plan.ok || !plan.brand) {
    return { ok: false, reason: plan.reason, queued, errors, plan };
  }

  for (const output of plan.outputs) {
    try {
      let post = await existingRevisionPost(plan, output);
      const meta = (post?.generation_meta && typeof post.generation_meta === "object")
        ? post.generation_meta
        : {};
      const media = Array.isArray(post?.media_urls) ? post.media_urls.filter(Boolean) : [];
      const priorJobId = String(meta.pending_render_job_id || meta.creative_render_job || "");

      if (post && (priorJobId || media.length)) {
        queued.push({
          key: output.key,
          renderJobId: priorJobId,
          postId: String(post.id),
          existing: true,
        });
        continue;
      }

      if (!post) post = await createRevisionPost(plan, output);
      const postId = String(post.id);
      const currentMeta = (post.generation_meta && typeof post.generation_meta === "object")
        ? post.generation_meta
        : generationMeta(plan, output);

      const { data, error } = await supabase.functions.invoke("video-render", {
        body: {
          blueprint: output.blueprint,
          brand: plan.brand,
          source_ref: `make_creative_${postId}`,
          music_url: output.musicUrl,
          captions: plan.captions,
        },
      });
      if (error || data?.ok === false) {
        const message = error?.message || data?.error || "Render failed to enqueue.";
        await db.from("agent_social_posts").update({
          generation_meta: {
            ...currentMeta,
            render_enqueue_error: message,
            render_enqueue_failed_at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        }).eq("id", postId);
        errors.push(`${output.label}: ${message}`);
        continue;
      }

      const renderJobId = data?.render_job_id ? String(data.render_job_id) : "";
      const finalUrl = data?.final_url ? String(data.final_url) : "";
      if (!renderJobId && !finalUrl) {
        errors.push(`${output.label}: renderer returned neither a job id nor a finished URL.`);
        continue;
      }

      await db.from("agent_social_posts").update({
        media_urls: finalUrl ? [finalUrl] : [],
        generation_meta: {
          ...currentMeta,
          render_enqueue_error: null,
          ...(renderJobId
            ? {
                pending_render_job_id: renderJobId,
                pending_render_since: new Date().toISOString(),
              }
            : {
                creative_attached_at: new Date().toISOString(),
                pending_render_job_id: null,
              }),
        },
        updated_at: new Date().toISOString(),
      }).eq("id", postId);

      queued.push({
        key: output.key,
        renderJobId,
        postId,
        existing: false,
      });
    } catch (error) {
      errors.push(`${output.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const ok = errors.length === 0 && queued.length === plan.outputs.length;
  return {
    ok,
    reason: ok
      ? `${queued.filter((item) => !item.existing).length} render revision(s) queued; ${queued.filter((item) => item.existing).length} already existed.`
      : `${queued.length} of ${plan.outputs.length} outputs are ready; ${errors.length} failed.`,
    queued,
    errors,
    plan,
  };
}
