import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const doc = readFileSync(new URL("../docs/DESIGNPROAI-OS-KERNEL.md", import.meta.url), "utf8");

test("DesignProAI OS chief aim stays print-ready panels from one ATLAS authority", () => {
  assert.match(doc, /Produce print-ready wrap panels from one accepted A\.T\.L\.A\.S\. creative authority/);
  assert.match(doc, /generationId.*immutable job root/s);
  assert.match(doc, /Call 9 promotes deterministic Call-1 panel descendants/);
  assert.match(doc, /Call-8 proof region is never production artwork authority/);
});
