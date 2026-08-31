import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const board = readFileSync(
  new URL("../app/src/pages/AdminGeminiCompareStudio.tsx", import.meta.url),
  "utf8",
);

test("PanelPro hydrates a thin current-job row before rendering the workspace", () => {
  assert.match(
    board,
    /type PanelProStudioListJob = Awaited<ReturnType<typeof listPanelProStudioJobs>>\[number\]/,
  );
  assert.match(board, /useState<PanelProStudioListJob\[\] \| null>/);
  assert.match(board, /setRecentJobs\(rows\)/);

  const cards = board.slice(
    board.indexOf("{recentJobs.map((j) =>"),
    board.indexOf("{recentJobs.map((j) =>") + 4_000,
  );
  assert.match(cards, /void runSearch\(j\.generation_id\)/);
  assert.doesNotMatch(cards, /setJob\(j\)/,
    "an identity-only list row must never be rendered as a full PanelPro job");
  assert.doesNotMatch(cards, /j\.concept_json/,
    "the current-jobs card may only derive state from fields in its thin contract");
  assert.doesNotMatch(cards, /Not started/,
    "a missing artifact projection on a thin row is not evidence that the job never started");
});

test("PanelPro reads promoted panels from the canonical full-job projection", () => {
  const rows = board.slice(
    board.indexOf("function SurfacePairRows("),
    board.indexOf("function Fact("),
  );
  assert.match(rows, /job\.concept_json\?\.qc_side_panels\?\.\[sideKey\]/);
  assert.doesNotMatch(rows, /job\.qc_side_panels/,
    "PanelProStudioJob has no top-level qc_side_panels field");
});

test("PanelPro resets an old revision selection only when the generation changes", () => {
  assert.match(board, /const versionSelectionGenerationRef = useRef<string \| null>\(null\)/);
  const load = board.slice(
    board.indexOf("const loadJob = useCallback"),
    board.indexOf("const runSearch = useCallback"),
  );
  assert.match(load, /versionSelectionGenerationRef\.current !== next\.generation_id/);
  assert.match(load, /versionSelectionGenerationRef\.current = next\.generation_id/);
  assert.match(load, /setSelectedVersionNumber\(null\)/);
});

test("browser-only QC state cannot cross a GenerationID or revision boundary", () => {
  const load = board.slice(
    board.indexOf("const loadJob = useCallback"),
    board.indexOf("const runSearch = useCallback"),
  );
  assert.match(load, /changingGeneration \? new Set<string>\(\) : approvedSidesRef\.current/);
  assert.match(load, /approvedSidesRef\.current = new Set\(\)/);
  assert.match(
    board,
    /key=\{`surface-qc:\$\{versionedJob\.generation_id\}:\$\{selectedVersion\?\.revisionId \|\| "none"\}`\}/,
  );
  assert.match(
    board,
    /key=\{`production-pack:\$\{job\.generation_id\}:\$\{selectedVersion\?\.revisionId \|\| "none"\}`\}/,
  );
});
