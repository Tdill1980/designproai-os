import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");

test("preflight and final approvals expose every database-required evidence check", () => {
  for (const check of [
    "dimensionsVerified",
    "sourceRegionsVerified",
    "fiveInchBleed",
    "panelHashesVerified",
    "logoInventoryVerified",
    "textLockVerified",
    "outputHashesVerified",
    "printDimensionsVerified",
    "colorModeVerified",
  ]) assert.match(app + api, new RegExp(check));
  assert.match(app, /disabled=\{!complete \|\| busy\}/);
  assert.doesNotMatch(api, /known:\s*true|pass:\s*true/);
});

test("new revision uploads and freezes seven immutable private Storage identities", () => {
  for (const role of ["driver", "passenger", "hood", "roof", "front", "rear", "hero3d"]) assert.match(app, new RegExp(`key: "${role}"`));
  for (const field of ["storagePath", "contentHash", "byteSize", "contentType", "renderAssets"]) assert.match(api, new RegExp(field));
  assert.match(api, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(api, /x-upsert": "false"/);
  assert.doesNotMatch(app + api, /renderUrls|publicUrl|SERVICE_ROLE|WORKER_SECRET/i);
});

test("fresh project Auth supports confirmation-aware signup without QC self-promotion", () => {
  assert.match(api, /signup:/);
  assert.match(app, /confirmationRequired/);
  assert.match(app, /Open the confirmation email/);
  assert.doesNotMatch(app + api, /qc_members|can_preflight|can_final_qc|service_role/i);
});

test("browser remains a submit, status, resume and human-gate control plane", () => {
  for (const method of ["submitRevision", "getStatus", "listArtifacts", "requestResume", "approvePreflight", "approveFinalQc"]) assert.match(api, new RegExp(method));
  for (const forbidden of ["advanceStage", "claimLease", "completeStage", "runProductionFlow"]) assert.doesNotMatch(api, new RegExp(forbidden, "i"));
  assert.match(app, /setInterval\(load, 5000\)/);
  assert.match(app, /Review the actual production files/);
  assert.match(app, /SHA-256/);
  assert.match(app, /signedUrl/);
});

test("GENIE operator UI validates exact six-surface geometry with provenance before auto-resume", () => {
  for (const surface of ["driver", "passenger", "hood", "roof", "front", "rear"]) assert.match(app, new RegExp(`key: "${surface}"`));
  for (const evidence of ["sourceReviewed", "sourceUrlsReviewed", "operatorAttestation"]) assert.match(app + api, new RegExp(evidence));
  assert.match(api, /validateGenieCandidate/);
  assert.match(app, /Validate GENIE geometry and resume jobs/);
  assert.match(app, /widthInches/);
  assert.match(app, /heightInches/);
});

test("logo inventory is explicit and vehicle type starts on a supported resolver enum", () => {
  assert.match(app, /logoInventoryAttestation/);
  assert.match(app, /This design has no logos/);
  assert.match(app, /This design contains logos/);
  assert.match(app, /Logo identity \/ name/);
  assert.match(app, /Required surface/);
  assert.doesNotMatch(app, /expectedLogoInventory:\s*\[\]/);
  assert.match(app, /defaultValue="car"/);
  assert.doesNotMatch(app, /defaultValue="vehicle"/);
  for (const vehicleClass of ["car", "truck", "suv", "van", "motorcycle", "boat", "bus", "rv", "trailer", "aircraft", "heavy_equipment"]) assert.match(app, new RegExp(`value="${vehicleClass}"`));
  assert.doesNotMatch(app, /value="other"/);
  assert.doesNotMatch(app, /value="box-truck"/);
});

test("delivery recipient, repeated-logo placement, and WrapBox stay on authenticated gateway contracts", () => {
  for (const field of ["customerId", "customerEmail", "recipientIdentityHash", "orderNumber", "designName"]) assert.match(api, new RegExp(field));
  assert.match(api, /registerDeliveryRecipient/);
  assert.match(app, /Registering the confirmed WrapBox recipient/);
  assert.match(app, /requires its confirmed DesignPro account/i);
  assert.match(app, /hashes the order\/payment reference without storing or returning the original/i);
  assert.match(app, /Confirmed customer email<input name="customerEmail" type="email"/);
  assert.match(app, /Customer reference \/ name<input name="customerReference"/);
  assert.match(app, /Order or payment verification reference<input name="verificationReference"/);
  assert.doesNotMatch(app, /Business customer UUID|Customer Auth user UUID|SHA-256<input/);
  assert.doesNotMatch(app, /name="customerId"|name="customerAuthUserId"|name="verificationRefHash"/);
  assert.match(app + api, /placementKey/);
  assert.match(app, /identityKey.*@.*surfaceKey/s);
  assert.match(app, /same logo can appear on several surfaces/i);
  assert.match(api, /listWrapbox/);
  assert.match(api, /getWrapboxPack/);
  assert.match(app, /Refresh five-minute links/);
  assert.doesNotMatch(app + api, /SUPABASE_SERVICE_ROLE|SERVICE_ROLE_KEY|sb_secret_/i);
});

test("required business Order # and canonical DesignID remain visible from intake through WrapBox", () => {
  assert.match(app, /Order #<input name="orderNumber"/);
  assert.match(app, /never derived from a workflow UUID/);
  assert.match(app, /orderNumber: delivery\.orderNumber/);
  assert.match(app + api, /orderNumber/);
  assert.match(app + api, /designId/);
  assert.match(app, /job\.designId/);
  assert.match(app, /pack\.designId/);
  assert.match(app, /Order # \{pack\.orderNumber\}/);
});
