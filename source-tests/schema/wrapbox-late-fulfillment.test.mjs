import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sql = await readFile(
  path.join(
    root,
    'supabase/migrations/20260906170000_designpro_wrapbox_resolves_late_fulfillment.sql',
  ),
  'utf8',
);

test('WrapBox commit resolves the immutable late fulfillment without restating the closure', () => {
  assert.match(sql, /pg_get_functiondef/);
  assert.match(sql, /commit_designpro_wrapbox_pack\(uuid,text,bigint,text,bigint,jsonb\)/);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.commit_designpro_wrapbox_pack/);
  assert.match(sql, /designpro_private\.revision_fulfillment\(v_run\.revision_id\)/);
  assert.match(sql, /designpro\.fulfillment-binding\.v1/);
  assert.match(sql, /v_fulfillment->>'revisionId' IS DISTINCT FROM v_run\.revision_id::text/);
  assert.match(sql, /v_run\.input->'fulfillment' IS DISTINCT FROM v_fulfillment/);
  assert.match(sql, /designpro\.fulfillment-state\.v1/);
  assert.match(sql, /v_source\.snapshot#>>'\{fulfillment,state\}' IS DISTINCT FROM 'unbound'/);
  assert.match(sql, /v_source\.snapshot \?\| ARRAY\['orderNumber','delivery'\]/);
  assert.match(sql, /v_delivery := v_fulfillment->'delivery'/);
  assert.match(sql, /v_order_number := v_fulfillment->>'orderNumber'/);
});

test('WrapBox late-fulfillment patch preserves every fail-closed delivery boundary', () => {
  for (const boundary of [
    'source_entice_run_identity_mismatch',
    'observed_delivery_bytes_do_not_match_ledger',
    'manifest_logo_inventory_does_not_match_ledger',
    'wrapbox_notification_idempotency_identity_conflict',
  ]) {
    assert.match(sql, new RegExp(boundary));
  }
  assert.match(sql, /commit_designpro_wrapbox_pack_unexpected_live_contract/);
  assert.match(sql, /wrapbox_late_fulfillment_anchor_count_/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.commit_designpro_wrapbox_pack[\s\S]*FROM PUBLIC,anon,authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.commit_designpro_wrapbox_pack[\s\S]*TO service_role/);
});
