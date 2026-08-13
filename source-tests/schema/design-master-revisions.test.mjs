// Phase 5 schema gate: revisions are immutable and production consumes only
// what a customer froze.
//
// The runtime can compute a bundle identity, but an identity nobody can rely on
// is not state. These are the properties the database has to hold on its own,
// because production trusts the row, not the process that wrote it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const sql = readFileSync(join(root, "supabase/migrations/20260813190000_designpro_design_master_revisions.sql"), "utf8").toLowerCase();

// The two tables and the gate.
for (const object of [
  "public.designpro_design_master_revisions",
  "public.designpro_design_revision_approvals",
  "public.save_designpro_design_master_revision",
  "public.approve_designpro_design_revision",
  "public.require_approved_designpro_revision",
]) assert.ok(sql.includes(object), `missing ${object}`);

// Immutability is enforced, not intended. A row production trusts must not be
// editable after the approval that made it trustworthy.
assert.ok(sql.includes("designpro_row_is_immutable"), "immutability must raise");
for (const trigger of [
  "designpro_design_master_revisions_immutable",
  "designpro_design_revision_approvals_immutable",
]) {
  assert.ok(sql.includes(trigger), `missing trigger ${trigger}`);
}
assert.ok((sql.match(/before update or delete on public\.designpro_design_(master_revisions|revision_approvals)/g) || []).length === 2,
  "both revision and approval rows must reject UPDATE and DELETE");
assert.ok(sql.includes("enable row level security"), "revision state must be RLS-protected");

// One canonical form, defined by the runtime contract and carried here rather
// than recomputed. jsonb does not preserve key order, so a SQL digest would be
// a *second* identity for one design — and two identities that can disagree is
// the class of defect this architecture exists to remove. Carrying is not
// trusting: every component is checked against the recorded master, and the
// gate recomputes from the artefacts.
assert.ok(!sql.includes("digest(convert_to(p_identity::text"), "a second canonicalisation must not compete with the runtime's");
assert.ok(!sql.includes("digest(convert_to((p_approval"), "a second canonicalisation must not compete with the runtime's");
assert.ok(sql.includes("revision_bundle_identity_missing"), "an identity must be present and well formed");
assert.ok(sql.includes("revision_bundle_identity_mismatch"), "an identity must agree with the master it describes");
assert.ok(sql.includes("approval_hash_missing"));
assert.ok(sql.includes("approval_hash_mismatch"));
for (const checked of ["'designid'", "'manifesthash'", "'supersedesrevisionid'", "'revisionsequence'"]) {
  assert.ok(sql.includes(`p_identity->>${checked}`) || sql.includes(`p_identity->>${checked})`),
    `the identity's ${checked} must be checked against the row`);
}

// Every hash that could change what prints is a column, so drift is detectable
// without re-reading the artefacts.
for (const column of [
  "master_hash", "render_hash", "surface_hashes", "proof_2d_hash", "proof_3d_hash",
  "plate_set_hash", "manifest_hash", "bundle_identity", "px_per_inch", "bleed_in",
]) assert.ok(sql.includes(column), `missing identity column ${column}`);
assert.ok(sql.includes("jsonb_array_length(surface_hashes)=6"), "a revision must carry exactly six surfaces");

// Lineage: an origin supersedes nothing and starts at zero; anything else
// supersedes exactly one earlier revision of the same design, contiguously.
assert.ok(sql.includes("designpro_revision_lineage"), "lineage must be constrained");
assert.ok(sql.includes("supersedes_revision_id is null and revision_sequence=0"));
assert.ok(sql.includes("designpro_revision_not_self_superseding"));
assert.ok(sql.includes("revision_sequence_not_contiguous"));
assert.ok(sql.includes("revision_parent_foreign"), "a revision must not supersede another owner's or another design's revision");

// A revision cannot be silently replaced by a different design under the same
// identifier.
assert.ok(sql.includes("revision_immutability_conflict"));
assert.ok(sql.includes("pg_advisory_xact_lock"), "concurrent writes must serialize");

// Approval freezes one identity per revision, and re-approving with different
// contents is a conflict rather than an overwrite.
assert.ok(sql.includes("approval_already_frozen"));
assert.ok(sql.includes("approval_identity_drift"), "an approval must be about the revision as recorded");
assert.ok(sql.includes("revision_id uuid primary key references public.designpro_design_master_revisions"),
  "at most one approval per revision");

// The gate hands back the COMPLETE frozen approval, not a summary of it. The
// database cannot verify approval_hash against the object it covers — that
// digest is over the runtime's canonical form — so it must return everything
// the runtime needs to do the verification itself. Returning only the hash and
// the reference would leave production with nothing to check the hash against,
// and "approved" would mean two different things on the two sides of this
// boundary.
assert.ok(sql.includes("'approval',v_approval.approval"), "the gate must return the complete frozen approval");
// The stored object and the columns beside it must agree, or the row is one
// approval by one reading and a different one by another.
assert.ok(sql.includes("approval->>'approvalhash'=approval_hash"), "columns and stored approval must agree");
assert.ok(sql.includes("approval->>'bundleidentity'=bundle_identity"));
assert.ok(sql.includes("approval->>'revisionid'=revision_id::text"));

// The production gate returns a revision only when it is approved and the
// identity matches. There is no most-recent branch and no status column.
assert.ok(sql.includes("production_not_approved"));
assert.ok(sql.includes("production_identity_drift"));
assert.ok(sql.includes("production_revision_unknown"));
for (const forbidden of ["order by created_at desc limit 1", "status='approved'", "is_approved", "order by revision_sequence desc limit 1"]) {
  assert.ok(!sql.includes(forbidden), `production must not select a revision by ${forbidden}`);
}

// Role separation, matching the rest of the OS: customers write and approve
// with their own JWT, and only the worker may ask what is printable.
assert.ok(sql.includes("auth.jwt()->>'role', '') is distinct from 'authenticated'"));
assert.ok(sql.includes("auth.jwt()->>'role', '') is distinct from 'service_role'"));
assert.ok(sql.includes("grant execute on function public.require_approved_designpro_revision(uuid,text) to service_role"));
assert.ok(sql.includes("revoke all on function public.require_approved_designpro_revision(uuid,text) from public,anon,authenticated"));
assert.ok(sql.includes("revoke all on function public.save_designpro_design_master_revision(uuid,text,uuid,uuid,integer,jsonb,jsonb,jsonb) from public,anon,service_role"));
assert.ok(sql.includes("revoke all on function public.approve_designpro_design_revision(uuid,jsonb,text,timestamptz) from public,anon,service_role"));

// The contracts the runtime writes are the contracts the database checks for.
for (const contract of [
  "designpro.design-master.v1.1",
  "designpro.design-master-revision.v1",
  "designpro.design-revision-approval.v1",
]) assert.ok(sql.includes(contract), `missing contract ${contract}`);

// Nothing generative reaches revision state.
for (const forbidden of ["gemini", "generativelanguage", "generatecontent", "restyle", "railway", "panelizer_jobs"]) {
  assert.ok(!sql.includes(forbidden), `forbidden dependency in revision state: ${forbidden}`);
}

console.log("immutable design master revision and approval-freeze contract passed");
