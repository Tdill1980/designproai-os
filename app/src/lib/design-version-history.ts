/**
 * ONE VERSION HISTORY, READ BY BOTH SURFACES.
 *
 * RevisionStudioIQ is the revision workspace and PanelPro Studio is the
 * production record, and they are looking at the same job. So V2 has to mean
 * the same thing on both: same number, same prompt text, same timestamp, same
 * master, same assets. The only way that stays true is for there to be exactly
 * one place the history is read from, which is this file.
 *
 * THE SERVER ALREADY OWNS IT. Every A.T.L.A.S. revision of a generation is a
 * row the runtime wrote, carrying its own sequence number, the customer's
 * instruction verbatim, the moment it was authored, and the master hash it
 * produced. `GET /api/jobs/:generationId/atlas` returns them in order. There is
 * nothing to reconstruct and nothing to number: the sequence IS the version.
 *
 * WHAT THIS REPLACES. RevisionStudio used to assemble a design's history by
 * guessing -- rows with a similar name on the same make and model, a parent_id
 * chain, an admin_notes sweep, a lineage_root_id union -- four overlapping
 * searches for a relationship nobody had written down. Then it was narrowed to
 * a single row, which was truthful but not a history. Meanwhile PanelPro read
 * the real revision list. Two surfaces, two answers, one job.
 *
 * WHAT MUST NOT HAPPEN HERE. No second table, no second numbering scheme, no
 * separate prompt store, no copying a version from one surface to the other. A
 * revision created in RevisionStudio appears in PanelPro because both call this
 * function, not because anything is synchronised.
 *
 * V1'S PROMPT IS THE BRIEF, NOT AN INSTRUCTION. The first revision is the
 * original design: nobody instructed a change, so its `instruction` is empty
 * and the customer's words for it are the run's brief. Later revisions carry
 * the instruction that produced them. Both are shown verbatim and labelled for
 * which they are, because "the original brief" and "what was asked for in V3"
 * are different facts and reading one as the other is how a design gets revised
 * against the wrong text.
 */
import {
  dpApi,
  type ApprovedGenerationView,
  type FlatAtlasRevision,
  type GenieSurfaceKey,
  type WorkflowArtifact,
  type WorkflowStatus,
} from "@/lib/designpro-api";

export type DesignVersionPromptKind = "original-brief" | "revision-instruction";

/** One version of one design, as the server recorded it. */
export type DesignVersion = {
  /** V1, V2, V3 — the server's own revision sequence. Never re-derived here. */
  version: number;
  revisionId: string;
  generationId: string;
  /** Design ID and Design Order Number, so a version is identifiable off-screen. */
  designId: string;
  orderNumber: string;
  parentRevisionId: string | null;
  /** The customer's words for this version, verbatim. Never a paraphrase. */
  prompt: string | null;
  promptKind: DesignVersionPromptKind;
  /** Authored moment, to the second, exactly as the server stamped it. */
  createdAt: string | null;
  /** The identity every asset of this version binds to. */
  masterContentHash: string;
  /** Admin-only imagery. Present only while the signed URL is valid. */
  masterUrl?: string;
  guideUrl?: string;
  promptVersion: string;
  affectedSurfaces: GenieSurfaceKey[];
  /** The whole server record, for anything that needs a field not lifted above. */
  revision: FlatAtlasRevision;
};

export type DesignVersionHistory = {
  generationId: string;
  designId: string;
  orderNumber: string;
  /** Oldest first: V1, V2, V3… The order the design actually happened in. */
  versions: DesignVersion[];
  /** The newest version, which is what an unqualified reference means. */
  current: DesignVersion | null;
};

/**
 * The Design ID a version is stamped with. It is the DID the rest of the
 * product shows, resolved once here so both surfaces print the same string.
 */
function identityFrom(job: WorkflowStatus | null | undefined) {
  return {
    designId: String(job?.designId || "").trim(),
    orderNumber: String(job?.orderNumber || "").trim(),
  };
}

/**
 * Project the server's revision rows into versions.
 *
 * `brief` is the run's original customer brief and belongs to V1 alone. A later
 * revision that somehow arrived without an instruction is reported with a null
 * prompt rather than being given the brief -- an empty field is a fact, and
 * showing the original brief beside V3 would be a false one.
 */
export function designVersionsFrom(input: {
  generationId: string;
  job: WorkflowStatus | null | undefined;
  revisions: readonly FlatAtlasRevision[];
}): DesignVersionHistory {
  const { designId, orderNumber } = identityFrom(input.job);
  const brief = typeof input.job?.brief === "string" ? input.job.brief.trim() : "";

  const versions = [...input.revisions]
    .sort((left, right) => left.revisionSequence - right.revisionSequence)
    .map((revision) => {
      const instruction = typeof revision.instruction === "string" ? revision.instruction.trim() : "";
      const isOriginal = revision.revisionSequence <= 1;
      return {
        version: revision.revisionSequence,
        revisionId: revision.id,
        generationId: revision.generationId,
        designId,
        orderNumber,
        parentRevisionId: revision.parentRevisionId,
        prompt: isOriginal ? (brief || instruction || null) : (instruction || null),
        promptKind: (isOriginal ? "original-brief" : "revision-instruction") as DesignVersionPromptKind,
        createdAt: revision.createdAt || null,
        masterContentHash: revision.master.contentHash,
        ...(revision.masterUrl ? { masterUrl: revision.masterUrl } : {}),
        ...(revision.guideUrl ? { guideUrl: revision.guideUrl } : {}),
        promptVersion: revision.promptVersion,
        affectedSurfaces: [...revision.affectedSurfaces],
        revision,
      } satisfies DesignVersion;
    });

  return {
    generationId: input.generationId,
    designId,
    orderNumber,
    versions,
    current: versions.length ? versions[versions.length - 1] : null,
  };
}

/**
 * The canonical history for one design. Both surfaces call this and nothing
 * else; a surface that reads revisions another way is the drift this exists to
 * prevent.
 */
export async function loadDesignVersionHistory(
  generationId: string,
  /** Pass an already-loaded status to avoid a second round trip. */
  known?: { job?: WorkflowStatus | null; revisions?: readonly FlatAtlasRevision[] },
): Promise<DesignVersionHistory> {
  const id = String(generationId || "").trim();
  if (!id) return { generationId: "", designId: "", orderNumber: "", versions: [], current: null };
  const [job, revisions] = await Promise.all([
    known?.job !== undefined ? Promise.resolve(known.job) : dpApi.getStatus(id).catch(() => null),
    known?.revisions !== undefined
      ? Promise.resolve(known.revisions)
      : dpApi.listJobFlatAtlasRevisions(id).catch(() => [] as FlatAtlasRevision[]),
  ]);
  return designVersionsFrom({ generationId: id, job, revisions: revisions || [] });
}

/**
 * EVERY ASSET THIS EXACT VERSION PRODUCED — and nothing another one did.
 *
 * A version is switchable only if switching it actually changes what is on
 * screen, and the binding that makes that possible already exists: a panel
 * records the master it was cut from, and a proof records the master it was
 * conditioned on. So membership is a hash comparison, not a guess from
 * timestamps or from which artifact happens to be newest.
 *
 * An artifact with no master binding is NOT quietly assigned to the selected
 * version. It predates the binding or came from a Standard run, and claiming it
 * belongs to V3 would be exactly the version mixing this is meant to stop --
 * it is returned separately so a surface can show it as unbound rather than
 * hide it or mislabel it.
 */
export function assetsForVersion(
  version: DesignVersion | null,
  artifacts: readonly WorkflowArtifact[],
  views: readonly ApprovedGenerationView[],
): {
  artifacts: WorkflowArtifact[];
  views: ApprovedGenerationView[];
  unboundArtifacts: WorkflowArtifact[];
  unboundViews: ApprovedGenerationView[];
} {
  const master = version?.masterContentHash || "";
  const artifactMaster = (artifact: WorkflowArtifact) => {
    const metadata = (artifact.metadata || {}) as Record<string, unknown>;
    // A panel states the master it was cut from. A derivative of a panel -- a
    // correction, an enhanced copy -- inherits that same statement, so one field
    // answers for the whole chain.
    const value = metadata.sourceMasterHash;
    return typeof value === "string" ? value : "";
  };
  const viewMaster = (view: ApprovedGenerationView) => view.atlasBinding?.masterContentHash || "";

  return {
    artifacts: master ? artifacts.filter((artifact) => artifactMaster(artifact) === master) : [],
    views: master ? views.filter((view) => viewMaster(view) === master) : [],
    unboundArtifacts: artifacts.filter((artifact) => !artifactMaster(artifact)),
    unboundViews: views.filter((view) => !viewMaster(view)),
  };
}

/** `2026-08-25 05:34:09Z` — the exact moment, not a relative phrase. */
export function exactTimestamp(value: string | null | undefined): string {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) return "—";
  return new Date(parsed).toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
}


/**
 * THE CANONICAL HISTORY, IN THE SHAPE REVISIONSTUDIO'S TIMELINE ALREADY DRAWS.
 *
 * RevisionStudio renders its version cards from `design_version_commits` -- a
 * separate table, with its OWN `version_number`, its own prompt column, and a
 * browser-side writer. PanelPro renders from the server's A.T.L.A.S. revision
 * lineage. Two histories of one job, numbered independently: V2 in one surface
 * was not necessarily V2 in the other, and a revision made in RevisionStudio
 * had no reason to appear in PanelPro at all.
 *
 * The fix is not a sync job. It is to delete one of the two answers: the ledger
 * numbering is dropped and the server's revision sequence becomes the version
 * number everywhere. This projects the canonical history into the shape the
 * existing timeline consumes, so RevisionStudio's UI is untouched while the
 * facts behind it -- which versions exist, what each was asked for, when -- come
 * from the same place PanelPro reads.
 *
 * `version_number` is the server's `revisionSequence` and is never recomputed.
 * `user_prompt` is the customer's words verbatim. `id` is the A.T.L.A.S.
 * revision id, so a card identifies the revision it is actually about.
 */
export function versionCommitsFromHistory(history: DesignVersionHistory): Array<{
  id: string;
  job_id: string;
  version_number: number;
  user_id: null;
  shop_id: null;
  user_prompt: string | null;
  system_prompt_snapshot: null;
  master_artboard_url: string | null;
  hero_render_url: null;
  angle_renders_json: [];
  change_type: "generate" | "revision";
  created_at: string;
  designiq_generation_id: string;
  source_visualization_id: null;
  revision_snapshot: { contractVersion: string; change: { type: "generate" | "revision"; prompt: string | null } };
  revision_snapshot_hash: string;
  frozen_at: string | null;
}> {
  return history.versions.map((entry) => {
    const kind = entry.promptKind === "original-brief" ? "generate" as const : "revision" as const;
    return {
      id: entry.revisionId,
      job_id: entry.generationId,
      version_number: entry.version,
      user_id: null,
      shop_id: null,
      user_prompt: entry.prompt,
      system_prompt_snapshot: null,
      // ALWAYS NULL, ON PURPOSE. This field is rendered as a "View master
      // artboard" link on the customer-facing RevisionStudio timeline, and the
      // A.T.L.A.S. master is admin and design-team only -- the buyer sees the
      // 3D proofs and the panels cut from it, never the flattened sheet, its
      // hashes or its geometry. PanelPro reads `masterUrl` off the DesignVersion
      // itself, which is where an admin surface should get it.
      master_artboard_url: null,
      hero_render_url: null,
      angle_renders_json: [],
      change_type: kind,
      created_at: entry.createdAt || "",
      designiq_generation_id: entry.generationId,
      source_visualization_id: null,
      revision_snapshot: {
        contractVersion: "designpro.flat-first-atlas.v1",
        change: { type: kind, prompt: entry.prompt },
      },
      revision_snapshot_hash: entry.masterContentHash,
      frozen_at: entry.createdAt || null,
    };
  });
}
