/**
 * shotScriptLink — the one place that knows how a SHOT and its SCRIPT relate.
 *
 * The Shot List and Script Studio are two views of ONE table
 * (`shot_list_items`). A row titled "MASTER SCRIPT…" is a script; every other
 * row is a shot. That convention was previously re-implemented inline in each
 * surface (`ilike 'MASTER SCRIPT%'` in Script Studio, an implicit "everything
 * else" in the Shot List), which is exactly how two views of one table drift
 * apart. It lives here now, once.
 *
 * ── WHY A COLUMN AND NOT A CAMPAIGN MATCH ──────────────────────────────────
 * The only thing that ever joined a script to its shots was the free-text
 * `campaign` string, and in live data it does not join: the script sits on
 * campaign "DesignPro" while its shots say "DesignPro — founder series",
 * "DesignPro — Amanda tutorials", "DesignPro — prompt to print, on camera".
 * Three of five scripts pointed at nothing and 23 DesignPro shots had no
 * script — not because anyone unlinked them, but because someone typed a
 * longer campaign name later. `script_id` makes the link explicit so renaming
 * a campaign can no longer orphan a script.
 *
 * ── NEVER GUESS ────────────────────────────────────────────────────────────
 * `resolveScript` falls back to an EXACT (brand, campaign) match and stops
 * there. It will not prefix-match, fuzzy-match, or "best guess". A shot linked
 * to the wrong script sends a crew out to film the wrong words, which is worse
 * than a blank that says "no script linked". Locked by
 * `tests/shot-script-link.test.ts`.
 */

/** The title prefix that makes a row a script rather than a shot. */
export const MASTER_SCRIPT_PREFIX = "MASTER SCRIPT";

export interface ShotRow {
  id: string;
  brand?: string | null;
  campaign?: string | null;
  shot_title?: string | null;
  filming_instruction?: string | null;
  notes?: string | null;
  content_type?: string | null;
  script_id?: string | null;
  raw_asset_ids?: string[] | null;
  [k: string]: unknown;
}

/** True when this row IS a script (the Script Studio definition, shared). */
export function isMasterScript(row: Pick<ShotRow, "shot_title">): boolean {
  return String(row?.shot_title || "").trim().toUpperCase().startsWith(MASTER_SCRIPT_PREFIX);
}

/** True when this row is a filmable shot (i.e. not a script). */
export function isShot(row: Pick<ShotRow, "shot_title">): boolean {
  return !isMasterScript(row);
}

/** The script's display name with the "MASTER SCRIPT" boilerplate stripped. */
export function scriptLabel(script: Pick<ShotRow, "shot_title" | "campaign">): string {
  const raw = String(script?.shot_title || "").trim();
  const stripped = raw.replace(/^MASTER SCRIPT\s*[—:-]?\s*/i, "").trim();
  return stripped || script?.campaign || "Master script";
}

/** The words a crew actually says. Instruction first, notes as the long form. */
export function scriptBody(script: Pick<ShotRow, "filming_instruction" | "notes">): string {
  return [script?.filming_instruction, script?.notes]
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

export type ScriptMatch = "linked" | "campaign" | "none";

export interface ResolvedScript {
  script: ShotRow | null;
  /**
   * How it was found — surfaced in the UI so a campaign-name coincidence is
   * never mistaken for a deliberate link.
   *   linked   — a real script_id
   *   campaign — exact brand + campaign match, offered for confirmation
   *   none     — honest gap
   */
  match: ScriptMatch;
}

/**
 * Find the script for a shot: the explicit link first, then an EXACT
 * (brand, campaign) match, then nothing. No fuzzy matching, ever.
 */
export function resolveScript(shot: ShotRow, scripts: ShotRow[]): ResolvedScript {
  if (shot.script_id) {
    const linked = scripts.find((s) => s.id === shot.script_id);
    if (linked) return { script: linked, match: "linked" };
    // A dangling id is not a link. The FK is ON DELETE SET NULL so this
    // should not happen — if it does, say "none" rather than inventing one.
  }
  const campaign = String(shot.campaign || "").trim();
  if (campaign) {
    const exact = scripts.find(
      (s) =>
        String(s.campaign || "").trim() === campaign &&
        String(s.brand || "") === String(shot.brand || ""),
    );
    if (exact) return { script: exact, match: "campaign" };
  }
  return { script: null, match: "none" };
}

/**
 * The shots a script covers — the other direction, for Script Studio.
 * Explicitly linked shots first, then exact-campaign ones, deduped.
 */
export function shotsForScript(script: ShotRow, shots: ShotRow[]): ShotRow[] {
  const out: ShotRow[] = [];
  const seen = new Set<string>();
  for (const s of shots) {
    if (!isShot(s)) continue;
    const { script: found } = resolveScript(s, [script]);
    if (found?.id === script.id && !seen.has(s.id)) {
      seen.add(s.id);
      out.push(s);
    }
  }
  return out;
}

/** Split a mixed row set into its two kinds, once. */
export function partitionRows(rows: ShotRow[]): { scripts: ShotRow[]; shots: ShotRow[] } {
  const scripts: ShotRow[] = [];
  const shots: ShotRow[] = [];
  for (const r of rows || []) (isMasterScript(r) ? scripts : shots).push(r);
  return { scripts, shots };
}

/**
 * Deep link to ONE shot card — the card where footage is uploaded.
 *
 * The Shot List previously held the open card in local state only, so there
 * was no way for a script (or anything else) to point at a specific card.
 */
export function shotCardLink(shotId: string): string {
  return `/admin/content-director?tab=shotlist&shot=${encodeURIComponent(shotId)}`;
}

/** Deep link to Script Studio focused on one script. */
export function scriptStudioLink(scriptId?: string | null): string {
  return scriptId
    ? `/admin/script-studio?script=${encodeURIComponent(scriptId)}`
    : "/admin/script-studio";
}

/** True when a shot needs moving footage and therefore needs spoken words. */
const PHOTO_TYPES = ["photo", "carousel", "static", "static ad", "static_ad", "image"];
export function needsScript(shot: ShotRow): boolean {
  const t = String(shot.content_type || "").toLowerCase().trim();
  return !PHOTO_TYPES.some((p) => t === p || t.includes(p));
}
