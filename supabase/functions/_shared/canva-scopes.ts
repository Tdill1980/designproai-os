/**
 * canva-scopes — the ONE definition of which Canva Connect scopes this project
 * asks for, shared by canva-oauth-init (which requests them) and canva-status
 * (which reports whether the granted token actually covers autofill).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * canva-oauth-init used to carry this comment:
 *
 *   "the brandtemplate:* scopes are Enterprise-only and did exactly that
 *    (live 2026-07-28), so they were dropped"
 *
 * That diagnosis is FALSE, and dropping the scopes on the strength of it is
 * why the design engine could never work. Two independent checks (2026-08-07):
 *
 *  1. Canva's own scope reference (canva.dev/docs/connect/appendix/scopes)
 *     lists brandtemplate:meta:read and brandtemplate:content:read as ordinary
 *     scopes with NO plan restriction attached to the scope itself.
 *  2. The operator's own Canva account returns four autofill-capable brand
 *     templates for GET /v1/brand-templates?dataset=non_empty. If the scope
 *     were unavailable to them, that call could not succeed.
 *
 * `invalid_scope` at the AUTHORIZE step means the scope is not ticked on in the
 * Canva Developer Portal app's own configuration — an owner-side checkbox, not
 * a plan ceiling. A plan ceiling shows up later, as a 403 on the API CALL, and
 * the two failures must not be confused: dropping a scope to "fix" a portal
 * checkbox permanently disables the feature the scope exists for.
 *
 * So the autofill scopes are requested again. The escape hatch, if Canva ever
 * does reject the set, is CANVA_SCOPES / minimal mode below — NOT another
 * silent edit to this list.
 */

/**
 * Always requested. These back the surfaces that already work today:
 * listing designs, reading folders, and exporting a design to PNG/MP4.
 */
export const CANVA_CORE_SCOPES = [
  "design:meta:read", // GET /v1/designs — the All designs / Starred grids
  "design:content:read", // POST /v1/exports — export a design to PNG/MP4
  "folder:read", // GET /v1/folders/... — find + read the watched folder
] as const;

/**
 * Required by the brand-template autofill path in marketing-agent. Without
 * ALL THREE, a connect "succeeds" and then every design call fails:
 *   brandtemplate:meta:read     GET  /v1/brand-templates?dataset=non_empty
 *   brandtemplate:content:read  GET  /v1/brand-templates/{id}/dataset
 *   design:content:write        POST /v1/autofills
 *
 * Deliberately NOT here: `asset:write`. Nothing in this repo calls /v1/assets —
 * autofill only ever fills TEXT fields (marketing-agent maps text fields to
 * headline/subhead/cta and skips image fields), and exports are downloaded from
 * Canva rather than uploaded to it. Requesting write access we never use is a
 * consent prompt the owner would be right to refuse.
 */
export const CANVA_AUTOFILL_SCOPES = [
  "brandtemplate:meta:read",
  "brandtemplate:content:read",
  "design:content:write",
] as const;

export const CANVA_DEFAULT_SCOPES: string[] = [
  ...CANVA_CORE_SCOPES,
  ...CANVA_AUTOFILL_SCOPES,
];

/** Split a Canva scope string ("a b c") into a clean list. */
export function parseScopes(raw: string | null | undefined): string[] {
  return String(raw || "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Which scopes a connect attempt should request.
 *
 * - `minimal: true` drops the autofill scopes. This is the fallback the UI
 *   offers if the full set is rejected, so the owner can still get a working
 *   design-export connection instead of no connection at all.
 * - `CANVA_SCOPES` (space or comma separated) overrides the list entirely, so
 *   the set can be narrowed or widened from Supabase secrets WITHOUT a code
 *   change and redeploy. That is the release valve; editing the constants above
 *   is not.
 *
 * ⚠️ A STALE `CANVA_SCOPES` SILENTLY PINS EVERY FUTURE CONNECT. The override
 * wins over this file COMPLETELY and leaves no trace in the UI — so if it was
 * set to the core-only list while the portal checkboxes were missing, ticking
 * the autofill scopes in the Canva Developer Portal changes NOTHING: connect
 * keeps requesting the old narrow set, the token comes back without autofill,
 * and the design engine stays dead with every visible config looking correct.
 * That failure mode is invisible from the code and nearly invisible from the
 * dashboard, which is why it gets its own warning here.
 *
 * After ANY portal scope change: clear the secret
 * (`npx supabase secrets unset CANVA_SCOPES --project-ref kfapjdyythzyvnpdeghu`,
 * or Dashboard → Edge Functions → Secrets) and press Connect again. Both
 * `canva-oauth-init` (`scopes_overridden_by_env`) and `canva-status`
 * (`scope_override_active`) report when the override is live — check those
 * before concluding the scope constants above are wrong.
 */
export function resolveRequestedScopes(
  envScopes: string | null | undefined,
  minimal = false,
): string[] {
  const override = parseScopes(envScopes);
  if (override.length) return override;
  return minimal ? [...CANVA_CORE_SCOPES] : [...CANVA_DEFAULT_SCOPES];
}

/**
 * Which autofill scopes a GRANTED token is missing. Canva returns the scopes it
 * actually issued, which can be narrower than what was asked for — so this
 * reads the grant, never the request. Empty array = autofill is usable.
 */
export function missingAutofillScopes(granted: string | null | undefined): string[] {
  const have = new Set(parseScopes(granted));
  return CANVA_AUTOFILL_SCOPES.filter((s) => !have.has(s));
}
