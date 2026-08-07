import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rpc = readFileSync(new URL('../../supabase/migrations/20260806180100_designpro_workflow_rpcs.sql', import.meta.url), 'utf8').toLowerCase();
const identity = readFileSync(new URL('../../supabase/migrations/20260806180400_designpro_progressive_identity.sql', import.meta.url), 'utf8').toLowerCase();

test('automatic chain requires seven distinct views before Call 8 proof', () => {
  for (const contract of [
    "receipt_kind='views.seven-source'", "jsonb_array_length(p_receipt->'viewreceipts')<>7",
    "count(distinct v->>'viewkey')", "count(distinct lower(v->>'contenthash'))",
    "jsonb_array_length(p_receipt->'viewlineage')<>7", "call8.flat-proof"
  ]) assert.ok(rpc.includes(contract), `missing ${contract}`);
});

test('GENIE manifest fixes trim, four-edge bleed and deterministic square feet', () => {
  for (const contract of [
    "'{bleed,top}'", "'{bleed,right}'", "'{bleed,bottom}'", "'{bleed,left}'",
    "surfaceSqFt".toLowerCase(), "totalSqFt".toLowerCase(), "round(", "/144",
    "deterministic_surface_area_contract_invalid"
  ]) assert.ok(identity.includes(contract), `missing ${contract}`);
});

test('Call 9 is manifest-pinned and refuses source-region reuse', () => {
  for (const contract of [
    "call9.surface-panels", "trimdimensions", "dimensionmanifestid", "manifesthash",
    "sourceregionhashes", "like '%driver%'", "like '%passenger%'",
    "metadata,trimwidthinches", "metadata,trimheightinches", "metadata,surfacesqft",
    "call9_unique_proof_region_contract_failed"
  ]) assert.ok(rpc.includes(contract), `missing ${contract}`);
});

test('manual advancement compatibility RPC is removed from final schema', () => {
  assert.ok(identity.includes('drop function if exists public.advance_designpro_workflow_stage'));
});

test('Call 10 is tied to immutable expected logos and Call 9 regions', () => {
  for (const contract of ['expectedlogoinventory','designpro.deterministic-stored-overlay.v1','sourceregionhash','storagepath'])
    assert.ok(rpc.includes(contract), `missing Call 10 database fence ${contract}`);
});
