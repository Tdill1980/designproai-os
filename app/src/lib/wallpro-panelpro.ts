// WallPanelProStudio: the WallPro lineage, in the shape PanelPro Studio uses.
//
// Owner, 2026-09-12: "We already create design id, version history and show up
// in RevisionStudioIQ so mirror what would work to give wallpro its own
// wallpanelprostudio."
//
// So this does not invent a lineage. WallPro already has all three pieces:
//
//   DesignID         wallDesignId(versionId) -> DID-XXXXXXXX   (wallpro-api.ts)
//   version history  wallpro_design_versions, V1..Vn, immutable (20260911150000)
//   the studio feed  listWallDesignsForStudio -> wallStudioRow  (wallpro-studio.ts)
//
// The vehicle board (PanelProStudioBoard.tsx) is keyed on one job with a
// version rail inside it, and selecting a version scopes the WHOLE workspace so
// V1's assets can never sit beside V2's. The wall equivalent of that job is the
// PROJECT, and the rail is its versions. That is the only structural change;
// every identity below is one WallPro already mints.
//
// WHAT REPLACES "PROOF | PANEL". A vehicle has six surfaces, so the vehicle
// board pairs each surface's 3D proof with its print panel and checks both came
// from one master. A wall is ONE flat rectangle -- that is the whole reason
// WallPro is the wedge product -- so the honest pair is the FLAT MASTER (what
// the design is) beside the PRINT FILES (what actually prints): the 54" panels
// and the one-file whole wall, at their measured PPI. The lineage check the
// vehicle board makes by comparing hashes is structural here: a production job
// carries `version_id`, so it cannot be built from another version. What CAN go
// wrong is staleness and resolution, so those are what is checked.
//
// Pure: no Supabase client, no React.
import type { WallGenerationRow, WallQcReview, WallReleaseState } from './wallpro-qc';
import { generationOutcome, releaseState, type WallGenerationOutcome } from './wallpro-qc';
import type { WallProductionJob, WallVersion } from './wallpro-api';

/** The DesignID a wall version is filed under, in the DID-XXXXXXXX form the
 * vehicle studio uses. Re-exported here so the studio has one import. */
export const wallDesignIdOf = (versionId: string) => 'DID-' + versionId.replace(/-/g, '').slice(0, 8).toUpperCase();

/** The print target every wall panel is enhanced to (runtime/wallpro-production.cjs). */
export const WALL_TARGET_PPI = 150;

export type WallStudioVersionRecord = {
  version: WallVersion;
  /** This version's own DesignID. Every version has one, as on the vehicle side. */
  designId: string;
  /** The generation that authored it, when the version records one. */
  generation: WallGenerationRow | null;
  outcome: WallGenerationOutcome;
  reviews: WallQcReview[];
  release: WallReleaseState;
  /** The newest production build for this exact version. */
  job: WallProductionJob | null;
  artworkUrl: string | null;
};

export type WallStudioProjectRecord = {
  projectId: string;
  projectName: string;
  ownerId: string;
  /** The project's headline DesignID: the approved version's, else the newest. */
  designId: string;
  /** V1..Vn, oldest first — never only the newest (RULE 0.22). */
  versions: WallStudioVersionRecord[];
  approvedVersionId: string | null;
  createdAt: string;
  updatedAt: string;
};

/** A generation that produced artwork and never became a version: the timeout.
 * It has no project and no DesignID yet, which is exactly the problem. */
export type WallOrphanRecord = {
  generation: WallGenerationRow;
  artworkUrl: string | null;
};

export type WallPanelProStudio = {
  designs: WallStudioProjectRecord[];
  orphans: WallOrphanRecord[];
};

/**
 * Build the studio from the rows as read.
 *
 * The project's headline DesignID follows `listWallDesignsForStudio`'s own
 * rule -- the approved version when there is one, because production reads only
 * it, else the newest draft -- so a design filed here and the same design in
 * RevisionStudioIQ carry the same DID rather than two answers about one job.
 */
export function buildWallPanelProStudio(input: {
  projects: Array<{ id: string; name: string; owner_id?: string | null; created_at?: string | null; updated_at?: string | null }>;
  versions: WallVersion[];
  generations: WallGenerationRow[];
  reviews: WallQcReview[];
  jobs: WallProductionJob[];
  urls: Record<string, string>;
  now?: number;
}): WallPanelProStudio {
  const now = input.now ?? Date.now();
  const generationById = new Map(input.generations.map(g => [g.id, g]));
  const reviewsByVersion = new Map<string, WallQcReview[]>();
  for (const review of input.reviews) {
    const list = reviewsByVersion.get(review.version_id) || [];
    list.push(review); reviewsByVersion.set(review.version_id, list);
  }
  // Newest job per version: a rebuild supersedes, it does not accumulate.
  const jobByVersion = new Map<string, WallProductionJob>();
  for (const job of input.jobs) {
    const held = jobByVersion.get(job.version_id);
    if (!held || new Date(job.created_at).getTime() > new Date(held.created_at).getTime()) {
      jobByVersion.set(job.version_id, job);
    }
  }

  const byProject = new Map<string, WallVersion[]>();
  for (const version of input.versions) {
    const list = byProject.get(version.project_id) || [];
    list.push(version); byProject.set(version.project_id, list);
  }

  const projectRows = new Map(input.projects.map(p => [p.id, p]));
  const designs: WallStudioProjectRecord[] = [];
  for (const [projectId, rows] of byProject) {
    const versions = [...rows].sort((a, b) => a.version_no - b.version_no);
    const records: WallStudioVersionRecord[] = versions.map(version => {
      const generation = version.generation_id ? generationById.get(version.generation_id) || null : null;
      const reviews = reviewsByVersion.get(version.id) || [];
      return {
        version,
        designId: wallDesignIdOf(version.id),
        generation,
        // A version row EXISTS, so whatever authored it landed. A version with
        // no generation is an upload or a catalog pick, which also landed.
        outcome: generation ? generationOutcome(generation, true, now) : 'landed',
        reviews,
        release: releaseState(reviews),
        job: jobByVersion.get(version.id) || null,
        artworkUrl: input.urls[version.artwork_path] || null,
      };
    });
    const approved = records.find(r => r.version.status === 'approved') || null;
    const newest = records[records.length - 1];
    const project = projectRows.get(projectId);
    designs.push({
      projectId,
      projectName: project?.name || 'Wall design',
      ownerId: newest.version.owner_id,
      designId: (approved || newest).designId,
      versions: records,
      approvedVersionId: approved?.version.id || null,
      createdAt: project?.created_at || versions[0].created_at,
      updatedAt: project?.updated_at || newest.version.created_at,
    });
  }
  designs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  // Everything the version table never claimed. This is the lane that makes the
  // studio worth opening when a customer says it timed out.
  const claimed = new Set(input.versions.map(v => v.generation_id).filter(Boolean) as string[]);
  const orphans = input.generations
    .filter(g => !claimed.has(g.id) && generationOutcome(g, false, now) === 'orphaned')
    .map(g => ({ generation: g, artworkUrl: (g.artwork_path && input.urls[g.artwork_path]) || null }));

  return { designs, orphans };
}

/* ── What the studio reports about one version ──────────────────────────── */

/**
 * The version's place in the workflow, in the words the team uses. Mirrors the
 * vehicle board's StatePill without inventing a second state machine: every
 * value is read off rows that already exist.
 */
export type WallVersionStage =
  | 'draft'            // authored, not approved by the customer
  | 'approved'         // the customer approved it; production reads only this
  | 'building'         // the runtime is cutting panels
  | 'panels-ready'     // print files exist
  | 'build-failed'     // the panel build failed
  | 'held'             // QC held it: it may not print
  | 'released';        // QC released it: it may print

export function versionStage(record: WallStudioVersionRecord): WallVersionStage {
  if (record.release === 'held') return 'held';
  if (record.release === 'released') return 'released';
  if (record.job?.status === 'failed') return 'build-failed';
  if (record.job?.status === 'ready') return 'panels-ready';
  if (record.job) return 'building';
  return record.version.status === 'approved' ? 'approved' : 'draft';
}

export const STAGE_LABEL: Record<WallVersionStage, string> = {
  draft: 'Draft',
  approved: 'Approved by customer',
  building: 'Building panels',
  'panels-ready': 'Print files ready',
  'build-failed': 'Panel build failed',
  held: 'Held in QC',
  released: 'Released for print',
};

/**
 * Whether the print files on screen were built from the version as it now
 * stands. A wall job carries `version_id`, so it can never be built from
 * another version — but it CAN predate the approval it is shown under, which
 * happens when a version is un-approved and re-approved with different
 * geometry. That is the wall's equivalent of the vehicle board's
 * different-masters check, and it is the one it can honestly make.
 */
export function jobIsStale(record: WallStudioVersionRecord): boolean {
  const approvedAt = record.version.approved_at;
  if (!record.job || !approvedAt) return false;
  return new Date(record.job.created_at).getTime() < new Date(approvedAt).getTime();
}

/**
 * The print files' own measured health. Every number is one the runtime stamped
 * on the panel; nothing is recomputed in the browser, for the same reason the
 * vehicle board reads its dimension sheet off the artifacts — a second set of
 * numbers agrees with the first only by luck.
 */
export function panelHealth(job: WallProductionJob | null) {
  const panels = job?.panels || [];
  if (!panels.length) return null;
  const ppis = panels.map(p => Number(p.ppi)).filter(n => Number.isFinite(n) && n > 0);
  const minPpi = ppis.length ? Math.min(...ppis) : null;
  const widths = panels.map(p => Number(p.widthIn)).filter(n => Number.isFinite(n) && n > 0);
  return {
    panelCount: panels.length,
    minPpi,
    /** False when any panel came back under the 150 PPI print target. */
    meetsTarget: minPpi !== null && minPpi >= WALL_TARGET_PPI,
    widestPanelIn: widths.length ? Math.max(...widths) : null,
    /** Panels that fell back to native pixels because Topaz was unavailable. */
    nativePanels: panels.filter(p => p.upscale?.engine === 'none').length,
    totalBytes: panels.reduce((sum, p) => sum + (Number(p.byteSize) || 0), 0),
  };
}

/**
 * The design-team record for one version, downloadable as JSON.
 *
 * The vehicle board's forensic record, on WallPro's own fields. Nothing is
 * recomputed: every value came from the canonical project, version, generation,
 * QC or job row.
 */
export function wallForensicRecord(project: WallStudioProjectRecord, record: WallStudioVersionRecord) {
  const version = record.version;
  return {
    contract: 'wallpro.panelpro-forensic-record.v1',
    projectId: project.projectId,
    projectName: project.projectName,
    ownerId: project.ownerId,
    designId: record.designId,
    version: version.version_no,
    versionId: version.id,
    parentVersionId: version.parent_version_id,
    kind: version.kind,
    status: version.status,
    createdAt: version.created_at,
    approvedAt: version.approved_at,
    artwork: {
      path: version.artwork_path,
      widthPx: version.width_px,
      heightPx: version.height_px,
      sha256: version.sha256,
      placement: version.placement,
      repeatWidthIn: version.repeat_width_in,
    },
    brief: {
      intent: version.intent,
      prompt: version.prompt,
      generationId: version.generation_id,
      generationInput: record.generation?.input ?? null,
      chargeSource: record.generation?.charge_source ?? null,
    },
    qc: {
      release: record.release,
      reviews: record.reviews.map(r => ({
        verdict: r.verdict, reviewerId: r.reviewer_id, checks: r.checks,
        notes: r.notes, createdAt: r.created_at,
      })),
    },
    production: record.job
      ? {
          jobId: record.job.id,
          status: record.job.status,
          request: record.job.request,
          stale: jobIsStale(record),
          health: panelHealth(record.job),
          panels: record.job.panels.map(p => ({
            number: p.number, file: p.file, widthIn: p.widthIn, heightIn: p.heightIn,
            widthPx: p.widthPx, heightPx: p.heightPx, ppi: p.ppi, sha256: p.sha256,
            overlapLeftIn: p.overlapLeftIn, upscale: p.upscale,
          })),
          manifestPath: record.job.manifest_path,
        }
      : null,
    /** The whole lineage, never only the selected version (RULE 0.22). */
    history: project.versions.map(v => ({
      version: v.version.version_no, versionId: v.version.id, designId: v.designId,
      kind: v.version.kind, prompt: v.version.prompt, createdAt: v.version.created_at,
      status: v.version.status, release: v.release,
    })),
  };
}

/* ── Panelization, as the job actually cut it ───────────────────────────── */

/**
 * THE PANEL MAP, READ OFF THE JOB — NEVER RECOMPUTED IN THE BROWSER.
 *
 * Owner, 2026-09-12: "make sure specs show 1/2\" overlap lets show panelization
 * there."
 *
 * The same rule the vehicle board follows for its dimension sheet: every number
 * here was stamped on the panel by the runtime when it cut it. Re-deriving the
 * plan in the browser from the wall inches would produce a SECOND set of
 * numbers that agrees with the first only by luck — and a QC reviewer checking
 * a panel against the wrong one has no way to tell which they are holding.
 *
 * Positions are returned as percentages of the full printed width (bleed
 * included), so the map draws at any size without the caller doing arithmetic
 * the runtime has already done.
 */
export type PanelMapEntry = {
  number: number;
  /** Left edge, as a percentage of the whole printed wall. */
  leftPct: number;
  widthPct: number;
  /** Width of the duplicated overlap band on this panel's LEFT edge. */
  overlapPct: number;
  widthIn: number;
  heightIn: number;
  overlapLeftIn: number;
  ppi: number;
};

export type PanelMap = {
  entries: PanelMapEntry[];
  /** Total printed width in inches, bleed included. */
  totalWidthIn: number;
  /** The overlap every seam shares, in inches. Half an inch per the WPW spec. */
  overlapIn: number;
  bleedIn: number;
  panelWidthIn: number;
  targetPpi: number;
  /** Seams = panels - 1. Zero on a wall that fits one panel. */
  seams: number;
};

export function panelMap(job: WallProductionJob | null): PanelMap | null {
  const panels = job?.panels || [];
  if (!job || !panels.length) return null;
  const request = (job.request || {}) as Record<string, unknown>;
  const starts = panels.map(p => Number(p.xIn));
  const ends = panels.map(p => Number(p.xIn) + Number(p.widthIn));
  if (starts.some(n => !Number.isFinite(n)) || ends.some(n => !Number.isFinite(n))) return null;
  const left = Math.min(...starts), right = Math.max(...ends);
  const totalWidthIn = right - left;
  if (!(totalWidthIn > 0)) return null;
  const pct = (inches: number) => (inches / totalWidthIn) * 100;
  return {
    entries: panels.map(p => ({
      number: p.number,
      leftPct: pct(Number(p.xIn) - left),
      widthPct: pct(Number(p.widthIn)),
      overlapPct: pct(Number(p.overlapLeftIn) || 0),
      widthIn: Number(p.widthIn),
      heightIn: Number(p.heightIn),
      overlapLeftIn: Number(p.overlapLeftIn) || 0,
      ppi: Number(p.ppi),
    })),
    totalWidthIn: Math.round(totalWidthIn * 100) / 100,
    // Read off a real panel first: the request states what was ASKED for, the
    // panel states what was CUT, and QC cares about what was cut.
    overlapIn: panels.slice(1).map(p => Number(p.overlapLeftIn) || 0).find(n => n > 0) ?? Number(request.overlapIn) ?? 0,
    bleedIn: Number(request.bleedIn) || 0,
    panelWidthIn: Number(request.panelWidthIn) || 0,
    targetPpi: Number(request.targetPpi) || 0,
    seams: Math.max(0, panels.length - 1),
  };
}

/* ── The human validation window ────────────────────────────────────────── */

/**
 * GENIE WALL PANELIZER — WHAT THE CUSTOMER IS TOLD WHILE A HUMAN CHECKS.
 *
 * Owner, 2026-09-12: "a wall version of the Genie Universal Panelizer this can
 * act as a value ad while we create panels which will take 24 hours for my
 * human team to validate ais panels ... these are our real customers of wpw we
 * can't risk going 100% ai."
 *
 * So `ready` on a production job means READY FOR VALIDATION, not ready for the
 * customer, and `released_at` is the separate fact that a person signed the
 * panels off. 20260912240000 enforces that in storage: until a human releases,
 * the customer cannot read the files at all.
 *
 * The window is a selling point, not an apology, and it is stated as one. A
 * competitor hands over whatever the model produced; WePrintWraps has a person
 * measure it against the wall first. That is the reason the trade buys here.
 */
export const WALL_VALIDATION_HOURS = 24;

export type WallDelivery =
  | 'not-requested'   // no production job yet
  | 'building'        // the panelizer is cutting
  | 'validating'      // cut, waiting on the human team
  | 'released'        // a person signed it off; the customer has the files
  | 'failed';

export function deliveryState(job: WallProductionJob | null): WallDelivery {
  if (!job) return 'not-requested';
  if (job.status === 'failed') return 'failed';
  if (job.status !== 'ready') return 'building';
  return (job as { released_at?: string | null }).released_at ? 'released' : 'validating';
}

/**
 * When the team's 24 hours are up, measured from the moment the panels were
 * actually cut rather than from when the order was placed — the clock is a
 * promise about human review, and review cannot start before there is
 * something to review.
 */
export function validationDueAt(job: WallProductionJob | null): Date | null {
  const finished = job?.finished_at;
  if (!finished) return null;
  const at = new Date(finished).getTime();
  if (!Number.isFinite(at)) return null;
  return new Date(at + WALL_VALIDATION_HOURS * 3600_000);
}

/** Whole hours left in the window, floored at zero. Null when not validating. */
export function validationHoursLeft(job: WallProductionJob | null, now: number = Date.now()): number | null {
  const due = validationDueAt(job);
  if (!due || deliveryState(job) !== 'validating') return null;
  return Math.max(0, Math.ceil((due.getTime() - now) / 3600_000));
}

/** What the customer reads. Positive: this is the service, not the delay. */
export function deliveryMessage(job: WallProductionJob | null, now: number = Date.now()): { title: string; detail: string } | null {
  const state = deliveryState(job);
  if (state === 'not-requested') return null;
  if (state === 'failed') return {
    title: 'The panel build stopped',
    detail: 'Our team has been notified and will rebuild your panels. Nothing was charged twice.',
  };
  if (state === 'building') {
    const done = Number(job?.progress?.panelsDone) || 0, total = Number(job?.progress?.panelsTotal) || 0;
    return {
      title: total ? `Cutting your panels · ${done}/${total}` : 'Cutting your panels',
      detail: 'Your approved design is being cut to the roll and enhanced to print resolution, panel by panel.',
    };
  }
  if (state === 'validating') {
    const left = validationHoursLeft(job, now);
    return {
      title: 'Your panels are with our production team',
      detail: `A person is checking every panel against your wall measurements, the seams and the print resolution before anything is released${left !== null ? ` — usually within ${left} ${left === 1 ? 'hour' : 'hours'}` : ''}. We do not hand over unchecked files.`,
    };
  }
  return {
    title: 'Released by our production team',
    detail: 'Checked by a person, not just generated. Your print-ready files are ready to download.',
  };
}
