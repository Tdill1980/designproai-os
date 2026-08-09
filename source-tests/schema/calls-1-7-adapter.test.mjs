import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("../../supabase/migrations/20260808024500_designpro_calls_1_7_adapter.sql", import.meta.url), "utf8");

test("Calls 1-7 schema is isolated, authenticated, and service-claimed", () => {
  for (const table of ["designpro_generation_requests", "designpro_generation_views"]) {
    assert.match(sql, new RegExp(`CREATE TABLE public\\.${table}`));
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
  }
  assert.match(sql, /CREATE POLICY designpro_owner_read_generation_requests[\s\S]*owner_id=auth\.uid\(\)/);
  assert.match(sql, /GRANT SELECT ON public\.designpro_generation_requests,[\s\S]*TO authenticated/);
  assert.match(sql, /claim_designpro_generation_request[\s\S]*service_role_required/);
  assert.match(sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(sql, /complete_designpro_generation_request[\s\S]*generation_lease_lost/);
  assert.doesNotMatch(sql, /GRANT (?:ALL|INSERT|UPDATE|DELETE)[^;]*TO authenticated/i);
  assert.doesNotMatch(sql, /GRANT [^;]+\bTO\s+(?:PUBLIC|anon)\b/i);
});

test("frozen source blobs and exact seven source views cannot be browser overridden", () => {
  for (const sha of [
    "bdb26365904e91be446894e84b01b4a24f64aac0",
    "4df3a9741c4f0721afb00b4db823fe7022147aa6",
    "0eda353a80eb3e60b293d9a99ba3e7d69ab9f065",
    "8114c56cbb1934569bf659a5f6957c680b9bf868",
    "2946bc1ba26b374d21ae563f01bb464ee41477d2",
    "a962133b04c335754cf3df307505ed2da652bdda",
    "3843e2b66a8583e16e514a545b7827cf77fade17",
    "6870eaebab4d43ef8605d812416f86621727d3e9",
    "03d6282d71faeec37d0fd304f3bc234d9a3cf0a4",
  ]) assert.ok(sql.includes(sha), `missing frozen source identity ${sha}`);
  for (const key of ["prompt", "model", "seed", "temperature", "viewangle", "cameraangle", "enginecontract", "sourceblobs"]) {
    assert.match(sql, new RegExp(`'${key}'`));
  }
  assert.match(sql, /designpro_private\.generation_input_has_server_controls\(p_input\)/);
  assert.match(sql, /v_normalized='model' AND p_path=ARRAY\['vehicle'\]/);
  assert.match(sql, /jsonb_array_length\(p_views\)<>7/);
  assert.match(sql, /p_engine_receipt->>'byteVerified' IS DISTINCT FROM 'true'/);
  assert.match(sql, /p_engine_receipt->>'callsCompleted' IS DISTINCT FROM '7'/);
});

test("source close-up remains explicit and cannot silently become hero3d", () => {
  for (const [sourceViewType, consumerRole] of [
    ["side", "driver"], ["passenger-side", "passenger"],
    ["hood_detail", "hood"], ["front", "front"], ["rear", "rear"],
    ["close-up", "closeup"], ["roof", "roof"],
  ]) {
    assert.ok(sql.includes(`'sourceViewType','${sourceViewType}','consumerRole','${consumerRole}'`));
  }
  assert.match(sql, /source_close_up_has_no_verified_hero3d_role_mapping/);
  assert.match(sql, /designpro_generation_view_content_address/);
  assert.doesNotMatch(sql, /'close-up','consumerRole','hero3d'/);
});

test("adapter contains no shared-project or legacy persistence dependency", () => {
  for (const forbidden of [
    "kfapjdyythzyvnpdeghu", "color_visualizations", "designiq_generations",
    "panelizer_jobs", "production_flow_assets", "railway",
  ]) assert.doesNotMatch(sql, new RegExp(forbidden, "i"));
});
