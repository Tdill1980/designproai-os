import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const kernel = readFileSync(new URL(
  "../supabase/migrations/20260829230000_designpro_generation_os_kernel.sql",
  import.meta.url,
), "utf8");
const artifacts = readFileSync(new URL(
  "../supabase/migrations/20260829230100_designpro_generation_os_artifact_events.sql",
  import.meta.url,
), "utf8");
const stages = readFileSync(new URL(
  "../app/src/lib/designpro-stages.ts",
  import.meta.url,
), "utf8");

test("Generation ID is the durable OS root with append-only event history", () => {
  assert.match(kernel, /designpro_generation_os_events/);
  assert.match(kernel, /generation_id uuid NOT NULL/);
  assert.match(kernel, /designpro_os_event_history_is_append_only/);
  assert.match(kernel, /atlas\.revision\.created/);
  assert.match(kernel, /workflow\.run\.state/);
  assert.match(kernel, /workflow\.stage\.state/);
});

test("the canonical snapshot includes versions, runs, artifacts, receipts and events", () => {
  assert.match(artifacts, /designpro\.generation-os\.v1/);
  for (const field of [
    "currentRevisionId", "currentRevisionSequence", "revisions",
    "workflowRuns", "artifacts", "receipts", "events", "phase",
  ]) {
    assert.ok(artifacts.includes(`'${field}'`), `${field} missing from OS snapshot`);
  }
});

test("PanelPro QC names Call-1 ATLAS panels as production authority, never Call-8 proof regions", () => {
  assert.match(stages, /frozen Call-1 A\.T\.L\.A\.S\. panel/);
  assert.match(stages, /promoted production panel hash matches its frozen Call-1 A\.T\.L\.A\.S\. source panel/);
  assert.doesNotMatch(stages, /come from their own Call 8 proof region/);
});
