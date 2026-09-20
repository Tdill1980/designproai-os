import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const history = readFileSync(new URL("../app/src/lib/design-version-history.ts", import.meta.url), "utf8");
const revision = readFileSync(new URL("../app/src/components/revisioniq/DesignVersionRecordCard.tsx", import.meta.url), "utf8");
const panelpro = readFileSync(new URL("../app/src/pages/designpro/PanelProStudioBoard.tsx", import.meta.url), "utf8");

test("V1 is the original customer brief and later versions keep their exact revision instruction", () => {
  assert.match(history, /isOriginal \? \(brief \|\| instruction \|\| null\) : \(instruction \|\| null\)/);
  assert.match(history, /promptKind: \(isOriginal \? "original-brief" : "revision-instruction"\)/);
});

test("RevisionStudioIQ shows the verbatim prompt and canonical version history", () => {
  assert.match(revision, /Original customer brief/);
  assert.match(revision, /selected\.prompt/);
  assert.match(revision, /versions\.map/);
  assert.match(revision, /exactTimestamp\(selected\.createdAt\)/);
});

test("PanelPro Studio shows the same original prompt and every canonical version", () => {
  assert.match(panelpro, /V\$\{selectedVersion\.version\} · original brief/);
  assert.match(panelpro, /selectedVersion\.prompt/);
  assert.match(panelpro, /Version history · \{versionHistory\.versions\.length\}/);
  assert.match(panelpro, /versionHistory\.versions\.map/);
  assert.match(panelpro, /entry\.prompt/);
  assert.match(panelpro, /entry\.revisionId/);
});
