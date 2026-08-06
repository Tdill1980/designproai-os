import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname,join } from "node:path";
import { fileURLToPath } from "node:url";

const sql=readFileSync(join(dirname(fileURLToPath(import.meta.url)),"../migrations/20260806180600_designpro_revision_source_ingest.sql"),"utf8").toLowerCase();
const immutable=readFileSync(join(dirname(fileURLToPath(import.meta.url)),"../migrations/20260806180400_designpro_progressive_identity.sql"),"utf8").toLowerCase();
assert.ok(sql.includes("public.save_designpro_revision_source"));
assert.ok(sql.includes("v_owner uuid:=auth.uid()"));
assert.ok(sql.includes("auth.role() is distinct from 'authenticated'"));
assert.ok(sql.includes("v_tenant:='user:'||v_owner::text"));
assert.ok(sql.includes("extensions.digest(convert_to(p_snapshot::text,'utf8'),'sha256')"),"hash must be derived in database");
assert.ok(sql.includes("revision_snapshot_hash_mismatch"));
assert.ok(sql.includes("nullif(btrim(coalesce(p_snapshot_hash,'')),'') is not null"),"client hash must be optional");
assert.ok(sql.includes("'snapshothash',v_existing.snapshot_hash"),"server-derived hash must be returned");
assert.ok(sql.includes("pg_advisory_xact_lock"),"first concurrent idempotent save must serialize");
assert.ok(sql.includes("revision_source_idempotency_conflict"));
assert.ok(sql.includes("snapshot is distinct from p_snapshot"),"replay must compare complete immutable snapshot");
assert.ok(sql.includes("revoke all on function public.save_designpro_revision_source")&&sql.includes("from public,anon,service_role"));
assert.ok(sql.includes("to authenticated"));
for(const token of ["expectedlogoinventory","expected_logo_inventory_item_invalid","identitykey","surfacekey","storagepath","contenthash"])
  assert.ok((sql+immutable).includes(token),`missing immutable logo inventory contract ${token}`);
for(const forbidden of ["color_visualizations","design_version_commits","panelizer_jobs","user_roles","restyle","railway"])
  assert.ok(!sql.includes(forbidden),`shared surface leaked into revision ingestion: ${forbidden}`);
console.log("authenticated immutable revision-source ingestion contract passed");
