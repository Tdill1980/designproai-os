import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL(
  "../../supabase/migrations/20260906132000_designpro_final_qc_resolves_late_fulfillment.sql",
  import.meta.url,
), "utf8");

assert.match(sql, /CREATE OR REPLACE FUNCTION public\.approve_designpro_human_gate/);
assert.match(sql, /v_fulfillment:=designpro_private\.revision_fulfillment\(v_run\.revision_id\)/);
assert.match(sql, /v_run\.input->'fulfillment' IS DISTINCT FROM v_fulfillment/);
assert.match(sql, /v_source\.snapshot#>>'\{fulfillment,state\}' IS DISTINCT FROM 'unbound'/);
assert.match(sql, /pg_catalog\.jsonb_typeof\(v_source\.snapshot->'delivery'\)='object'/);
assert.match(sql, /p_qc->>'orderNumber' IS DISTINCT FROM v_order_number/);
assert.doesNotMatch(sql, /UPDATE public\.designpro_revision_sources/i);

console.log("final QC resolves exact late fulfillment without rewriting the design snapshot");
