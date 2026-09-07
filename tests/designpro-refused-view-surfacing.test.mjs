/**
 * A REFUSED VIEW MUST REACH THE SCREEN, WITH ITS REASON.
 *
 * Live evidence, generation e3ade856 (2026-09-07, 2022 Ford Transit Connect):
 * the passenger-side proof was rendered twice and refused twice by the proof
 * inspector on `atlasContinuityContract` -- "Artwork from the authority crop
 * (Hood) is not present on the vehicle's passenger side" -- and the slot ended
 * `state='failed'`, `reason='provider_attempts_exhausted'`.
 *
 * Everything server-side recorded that correctly. `get_designpro_generation_
 * request` builds `failedShots` from `designpro_generation_slots`; the gateway's
 * `validatedGenerationStatus` forwards it; `GenerationRequestState` types it;
 * and the run completed as an honest PARTIAL set with `callsCompleted: 6` and
 * `refusedViews: [{sourceViewType:"passenger-side", reason:"provider_attempts_
 * exhausted"}]` on the receipt. The A.T.L.A.S. partial path is deliberate
 * (owner, 2026-08-27): one refused proof may not destroy six good panels.
 *
 * The browser threw it away. `failedViews` was derived ONLY from persisted views
 * that came back without a signed URL, and a refused slot never persists a view
 * at all -- so `failedViews` was empty, the failure banner never rendered, no
 * retry card appeared, and the customer saw six view tabs and one sentence:
 * "Finish all 7 design views to order." A diagnosis that existed end to end and
 * stopped one hop short of the person who needed it.
 *
 * This pins the join. It is source-level on purpose: the hook is React state
 * over a network read, and what matters is that the two sources of "absent" are
 * unioned and that the reason survives to the surfaces that explain it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const APP = resolve(import.meta.dirname, "..", "app", "src");
const read = (...parts) => readFileSync(join(APP, ...parts), "utf8");

test("the hook joins server-refused slots into failedViews and keeps their reasons", () => {
  const hook = read("hooks", "useDesignPanelProLogic.ts");

  // The server's refusals are captured, with reasons, when status is applied.
  assert.match(hook, /setRefusedShots\(/, "refused shots are never captured from the request status");
  assert.match(
    hook,
    /state\.failedShots \|\| \[\]\)\.map\(\(shot\) => \(\{[\s\S]{0,200}reason: shot\.reason \?\? null/,
    "the refusal reason is dropped on the way in",
  );

  // Both ways a view can be absent are unioned before export.
  assert.match(
    hook,
    /new Set\(\[\.\.\.failedViews, \.\.\.refusedShots\.map\(\(shot\) => shot\.sourceViewType\)\]\)/,
    "failedViews must union URL-less views with server-refused slots",
  );
  assert.match(hook, /failedViews: resolvedFailedViews/, "the unioned list is not the one exported");
  assert.match(hook, /failedViewReasons/, "reasons are not exported for the surfaces that explain the absence");

  // Reset must clear it, or a refusal outlives the design it belonged to.
  assert.match(hook, /setRefusedShots\(\[\]\)/, "refused shots survive a reset");

  // THE DEFECT, PINNED: deriving failedViews only from unsigned views is what
  // made a refused slot invisible. The bare assignment must not come back.
  const bareDerivation = /setFailedViews\(\s*views\.filter\(\(view\) => !view\.signedUrl\)\.map\(\(view\) => view\.sourceViewType\),?\s*\)/;
  assert.match(hook, bareDerivation, "the unsigned-view source is still one half of the join");
  assert.doesNotMatch(
    hook,
    /failedViews,\n\s+retryFailedView/,
    "the raw failedViews state is exported again, so refused slots are invisible",
  );
});

test("the design surface names the refused view and says why", () => {
  const page = read("pages", "DesignPanelProPremium.tsx");

  assert.match(page, /failedViewReasons/, "the surface never reads the refusal reasons");
  // The banner lists each absent view by label rather than only a count.
  assert.match(
    page,
    /failedViews\.map\(\(viewType\) => \([\s\S]{0,400}VIEW_LABEL_MAP\[viewType\][\s\S]{0,300}failedViewReasons\?\.\[viewType\]/,
    "the failure banner still reports only a count, not which view and why",
  );
  // A view with no recorded reason still says something honest.
  assert.match(page, /not generated/, "an absent view with no server reason is left unexplained");
});

/**
 * THE STUDIO READS A DIFFERENT ROUTE, SO IT NEEDED ITS OWN HOP.
 *
 * RevisionStudioIQ resolves proofs through /jobs/:id/approved-views, whose
 * source is `designpro_generation_workspace` -- a projection of ACCEPTED views
 * that has never read the slots table. A refused view is therefore invisible
 * there too, and for the same underlying reason: it persists no row.
 *
 * The refusal rides beside the payload in a header, which is the idiom that
 * route already uses for `x-designpro-views-superseded`. The database half is
 * an ADDITIVE companion function; the workspace read is deliberately untouched,
 * because it is the one whose breakage blanks the studio (CLAUDE.md records the
 * `pg_catalog.coalesce` incident that did exactly that).
 */
test("the approved-views route reports refused views without touching the workspace read", () => {
  const gateway = readFileSync(
    resolve(import.meta.dirname, "..", "gateway", "src", "server.mjs"),
    "utf8",
  );

  assert.match(gateway, /async function refusedViewsForGeneration\(/, "the gateway has no refused-view read");
  assert.match(
    gateway,
    /rpc\(fetchImpl, token, cfg, "designpro_generation_refused_views"/,
    "the gateway does not call the additive refusal function",
  );
  assert.match(
    gateway,
    /res\.setHeader\("x-designpro-views-refused"/,
    "the refusal never reaches the caller",
  );
  // Degrade to silence, never to a lost payload.
  assert.match(
    gateway,
    /async function refusedViewsForGeneration[\s\S]{0,900}catch \{\s*return \[\];\s*\}/,
    "a failing refusal read must not cost the caller its proofs",
  );

  // ⛔ The workspace read stays exactly as it was.
  const workspaceBody = gateway.slice(
    gateway.indexOf("async function approvedViewsForGeneration"),
    gateway.indexOf("function validatedGenerationStatus"),
  );
  assert.doesNotMatch(
    workspaceBody,
    /designpro_generation_refused_views/,
    "the accepted-view projection must not be widened to carry refusals",
  );
});

test("the migration adds a companion function and leaves the workspace read alone", () => {
  const sql = readFileSync(
    resolve(
      import.meta.dirname, "..", "supabase", "migrations",
      "20260907090000_designpro_generation_refused_views.sql",
    ),
    "utf8",
  );

  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.designpro_generation_refused_views\(/);
  assert.match(sql, /STABLE SECURITY DEFINER/);
  assert.match(sql, /SET search_path TO 'pg_catalog', 'public'/);
  // The same ownership gate the workspace read uses.
  assert.match(sql, /designpro_private\.caller_may_read_generation\(p_generation_id\)/);
  // A slot that later produced a live view is not a standing refusal.
  assert.match(sql, /NOT EXISTS[\s\S]{0,300}designpro_generation_views[\s\S]{0,200}superseded_at IS NULL/);
  // It must never edit the read the studio depends on.
  assert.doesNotMatch(
    sql,
    /FUNCTION public\.designpro_generation_workspace/,
    "this migration must not touch designpro_generation_workspace",
  );

  // GRAMMAR IS NOT A FUNCTION. `pg_catalog.coalesce(...)` cannot exist: the
  // parser resolves COALESCE before any search path, and the last migration
  // that qualified it applied clean everywhere and then raised for every
  // generation that actually had proofs.
  //
  // Checked against EXECUTABLE SQL only. The file's own comment names that
  // incident, and a check that cannot tell prose from code would either fail on
  // the explanation or force the explanation out of the file.
  const executableSql = sql.replace(/--[^\n]*/g, "");
  assert.doesNotMatch(executableSql, /pg_catalog\.(coalesce|nullif|greatest|least)/i);
  // Real functions ARE qualified, which is what SET search_path requires.
  assert.match(sql, /pg_catalog\.jsonb_agg/);
  assert.match(sql, /pg_catalog\.jsonb_build_object/);
});

test("the studio surface names each refused proof", () => {
  const card = readFileSync(
    resolve(import.meta.dirname, "..", "app", "src", "components", "revisioniq", "DesignVersionRecordCard.tsx"),
    "utf8",
  );

  assert.match(card, /setRefusedProofs\(result\.refusedViews\)/, "the studio drops the refusals it was handed");
  assert.match(card, /refusedProofs\.length > 0 &&/, "the studio never renders a refusal notice");
  assert.match(card, /VIEW_LABEL\[view\.sourceViewType\]/, "the refused view is not named");
  assert.match(card, /view\.reason \? ` — \$\{view\.reason\}` : " — no reason recorded"/, "the reason is not shown");
  // The refusal explains the proofs; it must not imply the design is lost.
  assert.match(card, /six print panels are unaffected/i);
});

test("the api parses the refusal header defensively", () => {
  const api = readFileSync(
    resolve(import.meta.dirname, "..", "app", "src", "lib", "designpro-api.ts"),
    "utf8",
  );

  assert.match(api, /function parseRefusedViewsHeader\(/);
  assert.match(api, /refusedViews: parseRefusedViewsHeader\(headers\.get\("x-designpro-views-refused"\)\)/);
  // Malformed JSON in a header must cost the reason, never the views.
  assert.match(api, /parseRefusedViewsHeader[\s\S]{0,900}catch \{\s*return \[\];\s*\}/);
});
