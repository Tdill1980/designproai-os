import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL(
  "../../supabase/migrations/20260906143000_designpro_stamp_certificate_and_late_fulfillment.sql",
  import.meta.url,
), "utf8");

assert.match(sql, /pg_catalog\.pg_get_functiondef/);
assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.complete_designpro_stage/);
assert.match(sql, /call9_atlas_panel_promotion_contract_failed/);
assert.match(sql, /call12\.topaz-upscale/);
assert.match(sql, /v_fulfillment:=designpro_private\.revision_fulfillment\(v_run\.revision_id\)/);
assert.match(sql, /v_run\.input->'fulfillment' IS DISTINCT FROM v_fulfillment/);
assert.match(sql, /jsonb_array_length\(COALESCE\(p_artifacts,'\[\]'::jsonb\)\) IS DISTINCT FROM 3/);
assert.match(sql, /a->>'surfaceKey'='certificate'[\s\S]*p_receipt->>'certificateHash'/);
assert.match(sql, /q\.receipt#>>'\{qc,orderNumber\}'=v_order_number/);
assert.doesNotMatch(sql, /UPDATE public\.designpro_revision_sources/i);

console.log("stamp completion resolves late fulfillment and requires the QC certificate");
