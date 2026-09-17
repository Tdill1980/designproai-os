import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE PERSISTENT HEADER USES THE ONE BRAND GRADIENT TOO (Trish 2026-09-17:
 * "Pro should be gradiant blue in wall pro and VehiclePro").
 *
 * ToolWordmark (sidebar nav, dashboard cards, the hero) has always painted a
 * tool's suffix -- "Pro", "IQ", "Studio" -- with one gradient,
 * `bg-gradient-to-r from-blue-500 to-fuchsia-500 bg-clip-text
 * text-transparent`. WallProLockup, the shared lockup every persistent
 * ToolHeader mounts (WallPro, VehiclePro, CutPro), painted the same suffix
 * flat `text-blue-400` instead -- a deliberate choice, but one that made the
 * FIRST thing a visitor sees on every tool page look like a different
 * product from everything below it.
 *
 * The fix keeps the original reasoning for the one case it was written for:
 * against a real partner logo (`theme.logo` set, e.g. the WePrintWraps ×
 * WallPro page) a gradient competing with someone else's mark reads as
 * noise, so that case keeps the solid tone. Every DesignProAI-native tool
 * header (no partner logo) gets the same gradient as everywhere else.
 *
 * 2026-09-17, later: the solid tone is now read from the lockup's INK table
 * (`ink.accent`), because the WPW PatternPro page carries the lockup on a
 * WHITE bar (owner: "I need the white ui just add the WPW colored logo in
 * corner") and `text-blue-400` on white is too pale to read. The rule is the
 * same -- a partner logo gets a SOLID blue, never the gradient -- so this
 * lock pins the table's every accent to a solid `text-blue-*` class.
 */
const root = resolve(import.meta.dirname, "..");
const LOCKUP = readFileSync(
  resolve(root, "app/src/components/wallpro/WallProLockup.tsx"),
  "utf8",
);

const BRAND_GRADIENT = "bg-gradient-to-r from-blue-500 to-fuchsia-500 bg-clip-text text-transparent";

test("the wordmark accent uses the one brand gradient when there is no partner logo", () => {
  assert.ok(
    LOCKUP.includes(BRAND_GRADIENT),
    "WallProLockup must paint wordmarkAccent with the same gradient ToolWordmark uses everywhere else",
  );
});

test("a real partner logo still keeps the solid tone, so it never competes with someone else's mark", () => {
  assert.match(LOCKUP, /theme\.logo\s*\?\s*ink\.accent/);
  // Every tone's accent is a solid blue; none of them is the gradient.
  const accents = [...LOCKUP.matchAll(/accent: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(accents.length >= 2, "the ink table declares an accent per tone");
  for (const accent of accents) {
    assert.match(accent, /^text-blue-\d{3}$/, `a partner logo's accent must be a solid blue, got ${accent}`);
  }
});

test("the accent span picks its class from theme.logo, not a fixed choice", () => {
  assert.match(
    LOCKUP,
    /className=\{theme\.logo \? ink\.accent : '[^']*bg-clip-text text-transparent'\}/,
  );
});
