import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * ONE STICKY BAR PER TOOL, SHARED, NOT DUPLICATED (Trish 2026-09-16: "dark
 * ui persistent header that shows both DP logo and the page logo").
 *
 * WallPro built the real pattern first (a comment in App.tsx literally names
 * it: "left rail for product navigation, and ONE slim bar the tool itself
 * owns"). VehiclePro and CutPro were still showing the marketing <Header>
 * (Home/Design/Output/Profit) stacked on top of the same AppSidebar rail --
 * the double-navigation WallPro's own fix was written to remove. This locks
 * that all three tools now share ONE header component instead of three
 * independently drifting copies, and that the marketing <Header> is
 * suppressed everywhere ToolHeader is mounted.
 */
const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

const TOOL_HEADER = read("app/src/components/layout/ToolHeader.tsx");
const APP = read("app/src/App.tsx");
const SIDEBAR = read("app/src/components/layout/AppSidebar.tsx");

test("ToolHeader reuses WallPro's lockup and account menu rather than re-describing them", () => {
  assert.match(TOOL_HEADER, /from ['"]@\/components\/wallpro\/WallProLockup['"]/);
  assert.match(TOOL_HEADER, /from ['"]@\/components\/layout\/ToolAccountMenu['"]/);
  assert.match(TOOL_HEADER, /useStickyOffset/);
});

test("every tool page mounts the shared ToolHeader, not its own bar", () => {
  for (const [path, marker] of [
    ["app/src/pages/DesignPanelProPremium.tsx", "vehiclepro-header"],
    ["app/src/pages/GraphicsProV1.tsx", "cutpro-header"],
    ["app/src/pages/GraphicsProWall.tsx", "cutpro-wall-header"],
    ["app/src/pages/GraphicsProWindow.tsx", "cutpro-window-header"],
  ]) {
    const source = read(path);
    assert.match(source, /<ToolHeader\b/, `${path} mounts <ToolHeader>`);
    assert.match(source, new RegExp(`id="${marker}"`), `${path} gives its header a stable, unique id`);
  }
  // WallPro predates the shared component and keeps its own inline header,
  // which is what ToolHeader was extracted FROM -- it must not diverge from
  // the same three primitives.
  const wallpro = read("app/src/pages/WallPro.tsx");
  assert.match(wallpro, /WallProLockup/);
  assert.match(wallpro, /ToolAccountMenu/);
});

test("the marketing Header is suppressed on every route a ToolHeader covers, via one predicate", () => {
  assert.match(APP, /isSelfHeaderedToolRoute/);
  assert.match(APP, /activeOsTool\(pathname\)/);
  // The old WallPro-only name must not survive as a second, competing check.
  assert.doesNotMatch(APP, /isWallProToolRoute/);
});

test("the sidebar carries a persistent DesignProAI mark, since ToolHeader no longer carries the OS identity itself", () => {
  assert.match(SIDEBAR, /OS_BRAND\.name/);
  assert.match(SIDEBAR, /to="\/dashboard"/);
});
