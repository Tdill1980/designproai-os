/**
 * THE 2D PROOF APPEARS ON ALL THREE SURFACES, FROM ONE ARTIFACT.
 *
 * Owner, 2026-08-31: "Make sure after last 3d proof is shown on the designproai
 * first konva page it shows 2d proof on the attached page also make sure it's
 * shown in revison studios and PanelProstudio."
 *
 * All three were already wired -- this file exists so that stays true, and so a
 * future session cannot "fix" a missing proof by building a fourth producer.
 * There is ONE artifact (Call 8's flat-proof, role customer-2d-production-proof)
 * and ONE selector, and every surface resolves through it:
 *
 *   DesignProAI render page   useDesignPanelProLogic -> dpApi.listArtifacts
 *                             -> selectCustomerProof -> flatProofUrl
 *   RevisionStudioIQ          revisionstudio-source adminNotesFor
 *                             -> selectCustomerProof -> flat_proof_url
 *   PanelPro Studio           panelpro-studio-source
 *                             -> selectCustomerProof -> flat_proof_url
 *
 * RULE 0.27: "ONE LINEAGE, PUBLISHED TWICE -- NEVER RECONSTRUCTED TWICE ...
 * Neither UI may synthesize its own representation of a missing canonical
 * artifact -- a missing panel is reported missing." Three surfaces, one
 * selector, and a missing proof is stated rather than drawn.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const selectors = read("../app/src/lib/designpro-artifact-selectors.ts");
const renderLogic = read("../app/src/hooks/useDesignPanelProLogic.ts");
const renderPage = read("../app/src/pages/DesignPanelProPremium.tsx");
const revisionSource = read("../app/src/lib/revisionstudio-source.ts");
const panelproSource = read("../app/src/lib/panelpro-studio-source.ts");
const panelproPage = read("../app/src/pages/AdminGeminiCompareStudio.tsx");

test("there is exactly one customer-proof selector, and it is role-bound", () => {
  assert.match(selectors, /export const CUSTOMER_PROOF_ROLE = "customer-2d-production-proof"/);
  assert.match(selectors, /artifact\.kind === "flat-proof" && artifact\.metadata\?\.role === CUSTOMER_PROOF_ROLE/,
    "the proof must be selected by kind AND role, never by position or filename");
  // Cardinality is enforced in the selector itself: two customer proofs for one
  // design means two producers, which is the failure RULE 0.27 names.
  assert.match(selectors, /customer_2d_production_proof_cardinality/);
});

test("the DesignProAI render page resolves the proof and gates it on all seven views", () => {
  assert.match(renderLogic, /selectCustomerProof\(artifacts\)\?\.signedUrl/,
    "the render page must read the Call-8 artifact through the shared selector");
  // Polls until it lands, then slows to inside the 300s signature lifetime.
  assert.match(renderLogic, /refetchInterval: \(query\) => \(query\.state\.data \? 240_000 : 5_000\)/,
    "the proof poll must keep asking until it lands and refresh before the url expires");
  // Only one source. A fallback to a stored url would be a second producer.
  assert.match(renderPage, /const proofToShow = flatProofUrl \|\| null;/,
    "the render page must show the Call-8 proof or nothing -- never a recovered substitute");
  assert.match(renderPage, /proofToShow && displayedAllViews\.length >= requiredViewCount/,
    "the 2D proof card appears once the last 3D proof is shown, as the owner asked");
});

test("RevisionStudio publishes the same artifact", () => {
  assert.match(revisionSource, /const proof = selectCustomerProof\(\[\.\.\.input\.artifacts\]\)/);
  assert.match(revisionSource, /if \(proof\?\.signedUrl\) notes\.flat_proof_url = proof\.signedUrl;/);
});

test("PanelPro Studio publishes the same artifact and shows it", () => {
  assert.match(panelproSource, /selectCustomerProof/);
  assert.match(panelproSource, /flat_proof_url: proof\?\.signedUrl \|\| ""/);
  assert.match(panelproPage, /2D Production Proof/,
    "the control room must show the proof, not merely hold its url");
  // And says so honestly when it is absent, rather than leaving a blank tile.
  assert.match(panelproPage, /productionProofPresent: job\.concept_json\?\.flat_proof_url \? "present" : "not produced"/);
});

test("a deferred Call 8 is stated on the render page, not pulsed forever", () => {
  // The same defect fixed in RevisionStudio, in the surface the owner opens
  // first. Once the seventh view lands this card reads "Building Your 2D
  // Production Proof" with an indeterminate pulse -- correct while the stage
  // runs, and a lie the moment it defers, because a deferral COMPLETES the
  // stage. Nothing new is fetched: productionJobStatus was already polled here.
  assert.match(renderPage, /const proofDeferredStage = \(\(productionJobStatus as any\)\?\.stages \|\| \[\]\)\.find\(/,
    "the render page must read the deferral from the status it already polls");
  assert.match(renderPage, /stage\?\.key === "proof\.build" && stage\?\.deferred === true/);
  assert.match(renderPage, /2D Production Proof Not Produced/,
    "a deferred proof must be named on the render page");
  assert.match(renderPage, /deferredReason \|\| "reason not recorded"/,
    "the reason the stage recorded is the only thing that explains why");
  // The pulse is what makes it read as in-flight, so it has to stop too.
  assert.match(renderPage, /viewsComplete && !proofDeferredStage && "animate-pulse"/,
    "the progress pulse must stop on a deferral -- nothing is in flight");
});

test("no surface invents a proof when the artifact is absent", () => {
  for (const [name, source] of [
    ["the render page", renderPage],
    ["RevisionStudio", revisionSource],
    ["PanelPro Studio", panelproSource],
  ]) {
    // A generated substitute is the reconstruction RULE 0.27 forbids. Matched
    // as INVOCATIONS rather than mentions: naming a retired producer in a
    // comment to say it is retired is exactly the note a future session needs,
    // and a bare-string ban punishes writing it down.
    const invocations = [
      /functions\.invoke\(\s*["'`]generate-2d-proof/,
      /functions\.invoke\(\s*["'`]compose-2d-proof/,
      /fetch\(\s*["'`][^"'`]*compose-2d-proof/,
      /dpApi\.[A-Za-z]+\(\s*["'`][^"'`]*(?:generate|compose)-2d-proof/,
    ];
    for (const call of invocations) {
      assert.ok(!call.test(source),
        `${name} invokes a retired 2D proof producer (${call}) -- Call 8 is the only one (proofAuthority: designpro-os-call8)`);
    }
  }
});
