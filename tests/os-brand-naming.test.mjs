import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Customer-facing naming and positioning (owner ruling, Trish 2026-09-16).
 *
 *   DESIGNPROAI — Prompt-Based Design + Production-Ready File Output
 *     VehiclePro · WallPro · CutPro
 *   Powered by Atlas
 *
 * This is BRAND / UI COPY. The internal identifiers -- navigation keys,
 * routes, buckets, edge functions, tier keys -- are deliberately unchanged,
 * and the second half of this file locks that they stayed. The two failures
 * this guards against are opposite: a session "restoring" the old names into
 * the chrome (the vehicle tool read "DesignPro / Vehicle Wrap Design System"
 * under a header reading "DesignProAI / Vehicle Wrap Design System", one name
 * for two things), and a session "finishing the rename" by touching the keys
 * a stored row or a deployed function reads.
 */

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const stripComments = (source) =>
  source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const BRAND = read("app/src/lib/os-brand.ts");
const HEADER = stripComments(read("app/src/components/Header.tsx"));
const NAV = stripComments(read("app/src/lib/dashboard-nav.ts"));
const WORDMARKS = stripComments(read("app/src/components/dashboard/ToolWordmark.tsx"));
const APP = read("app/src/App.tsx");

test("os-brand.ts states the hierarchy the customer must read at a glance", () => {
  assert.match(BRAND, /positioning: "Prompt-Based Design \+ Production-Ready File Output"/);
  assert.match(BRAND, /hero: "The Design-to-Production OS Built for Wide Format\."/);
  assert.match(BRAND, /poweredBy: "Powered by Atlas"/);
  assert.match(BRAND, /explanation: "The intelligence layer behind DesignProAI\."/);
  for (const [name, tagline] of [
    ["VehiclePro", "Prompt-Based Vehicle Graphics Design + Production-Ready File Output"],
    ["WallPro", "Prompt-Based Wall Graphics Design + Production-Ready File Output"],
    ["CutPro", "Prompt-Based Cut Graphics Design + Production-Ready File Output"],
  ]) {
    assert.ok(BRAND.includes(`name: "${name}"`), `${name} is declared`);
    assert.ok(BRAND.includes(`tagline: "${tagline}"`), `${name} carries its tagline`);
  }
  assert.match(BRAND, /OS_TOOL_ORDER[^=]*=\s*\["vehiclepro", "wallpro", "cutpro"\]/);
});

test("the persistent header carries the OS positioning line, never a tool's", () => {
  assert.match(HEADER, /\{OS_BRAND\.positioning\}/, "the lockup subtitle reads from os-brand.ts");
  assert.doesNotMatch(HEADER, /Vehicle Wrap Design System/, "the OS header must not wear the vehicle tool's old subtitle");
  // The three tools are linked from the header, in hierarchy order, and the
  // active tool is named BENEATH the DesignProAI lockup rather than in place of it.
  assert.match(HEADER, /OS_TOOL_ORDER\.map/);
  assert.match(HEADER, /activeOsTool\(location\.pathname\)/);
  assert.match(HEADER, /data-testid="active-tool-strip"/);
  // The DesignProAI wordmark itself is untouched.
  assert.match(HEADER, /<span className="text-white">Design<\/span>\s*<span[^>]*>Pro<\/span>\s*<span[^>]*>AI<\/span>/);
});

test("navigation and wordmarks name VehiclePro, WallPro and CutPro on the legacy keys", () => {
  // Labels come from os-brand.ts; the keys are the ones every gate reads.
  assert.match(NAV, /key:\s*"designpro",\s*label:\s*OS_TOOLS\.vehiclepro\.name/);
  assert.match(NAV, /key:\s*"wallpro",\s*label:\s*OS_TOOLS\.wallpro\.name/);
  assert.match(NAV, /key:\s*"graphicspro",\s*label:\s*OS_TOOLS\.cutpro\.name/);
  assert.match(WORDMARKS, /^\s*designpro:\s*\{ base: "Vehicle",\s*suffix: "Pro" \}/m);
  assert.match(WORDMARKS, /^\s*graphicspro:\s*\{ base: "Cut",\s*suffix: "Pro" \}/m);
  assert.match(WORDMARKS, /^\s*wallpro:\s*\{ base: "Wall",\s*suffix: "Pro" \}/m);
  // The hierarchy order in the sidebar: VehiclePro first, then WallPro, then CutPro.
  const order = ["designpro", "wallpro", "graphicspro"].map((k) => NAV.indexOf(`key: "${k}"`));
  assert.ok(order[0] < order[1] && order[1] < order[2], `sidebar order is VehiclePro, WallPro, CutPro (${order})`);
  // Atlas never competes with the three tools in navigation.
  assert.doesNotMatch(NAV, /label:\s*"Atlas"/);
});

test("no customer-facing surface still names the vehicle tool DesignPro or the cut tool GraphicsPro", () => {
  // `productName="GraphicsPro"` on the FAQ is a logic key selecting the cut
  // tool's FAQ set, not a rendered name, so it is not in this pattern; the
  // rendered names are the wordmarks, titles and the ™ form.
  const oldNames = /VehicleWrapPro|Vehicle Wrap Design System|GraphicsPro™|GraphicsPro Wall|GraphicsPro Window|'GraphicsPro™'|>Graphics<\/span>/;
  for (const path of [
    "app/src/components/Header.tsx",
    "app/src/components/layout/AppSidebar.tsx",
    "app/src/components/layout/AppBottomTabs.tsx",
    "app/src/components/DesktopToolNav.tsx",
    "app/src/components/MobileToolNav.tsx",
    "app/src/components/dashboard/ToolWordmark.tsx",
    "app/src/lib/dashboard-nav.ts",
    "app/src/lib/tool-registry.ts",
    "app/src/pages/GraphicsProWall.tsx",
    "app/src/pages/GraphicsProWindow.tsx",
    "app/src/pages/DesignProAIHome.tsx",
    "app/src/pages/Index.tsx",
    "app/index.html",
  ]) {
    const offending = stripComments(read(path))
      .split("\n")
      .filter((line) => oldNames.test(line));
    assert.deepEqual(offending, [], `${path} still carries a retired customer-facing name`);
  }
  // The cut tool's page and the vehicle tool's page keep ONE logic key each
  // (FAQ set selection, MyVehiclePro tool source) and otherwise wear the new name.
  const cutPage = stripComments(read("app/src/pages/GraphicsProV1.tsx"));
  assert.match(cutPage, /\{OS_TOOLS\.cutpro\.name\}/);
  assert.doesNotMatch(cutPage, /<span className="text-white">GraphicsPro<\/span>/);
  const vehiclePage = stripComments(read("app/src/pages/DesignPanelProPremium.tsx"));
  assert.match(vehiclePage, /\{OS_TOOLS\.vehiclepro\.wordmark\.base\}/);
  assert.doesNotMatch(vehiclePage, /Vehicle Wrap Design System/);
});

test("the OS-side WallPro tagline is the hierarchy line; the partner page keeps its own words", () => {
  const brand = read("app/src/lib/wallpro-brand.ts");
  assert.match(brand, /eyebrow: 'DesignProAI',[\s\S]{0,400}tagline: 'Prompt-Based Wall Graphics Design \+ Production-Ready File Output'/);
  assert.match(brand, /eyebrow: 'WePrintWraps',[\s\S]{0,900}tagline: 'Custom Wall Wrap design, print files & printed wrap'/);
});

test("Atlas is 'Powered by Atlas', never a fourth product", () => {
  for (const path of ["app/src/pages/DesignPanelProPremium.tsx", "app/src/pages/DesignProAIHome.tsx"]) {
    const source = stripComments(read(path));
    assert.match(source, /ATLAS_BRAND\.poweredBy/, `${path} names Atlas through os-brand.ts`);
    assert.doesNotMatch(source, /A\.T\.L\.A\.S\. graph active/, `${path} no longer shows the engineering label to the customer`);
  }
});

test("legacy identifiers are retained: routes, keys, buckets and functions did not move", () => {
  // Routes the customer, emails and stored project links already carry.
  for (const route of ["/designpro/create", "/graphics-pro", "/graphics-pro-wall", "/graphics-pro-window", "/printpro/wallpro"]) {
    assert.ok(APP.includes(`path="${route}"`), `${route} is still served`);
  }
  assert.match(APP, /<Route path="\/graphicspro" element=\{<Navigate to="\/graphics-pro" replace \/>\} \/>/);
  // The new names redirect INTO the served routes.
  assert.match(APP, /OS_TOOL_ALIASES\.map/);
  for (const [from, to] of [
    ["/vehiclepro", "/designpro/create"],
    ["/vehicle-pro", "/designpro/create"],
    ["/cutpro", "/graphics-pro"],
    ["/cut-pro", "/graphics-pro"],
    ["/cut-pro-wall", "/graphics-pro-wall"],
    ["/cut-pro-window", "/graphics-pro-window"],
  ]) {
    assert.ok(BRAND.includes(`{ from: "${from}", to: "${to}" }`), `${from} → ${to}`);
  }
  // Tier gates, access checks and the proof registry still key on the legacy names.
  const access = read("app/src/hooks/useToolAccess.ts");
  assert.match(access, /^\s*designpro:\s*"complete"/m);
  assert.match(access, /^\s*graphicspro:\s*"complete"/m);
  assert.match(read("app/src/lib/tool-registry.ts"), /graphicspro:\s*\{\s*key: 'graphicspro'/);
  // The cut tool's storage, hooks and edge functions are untouched.
  assert.match(read("app/src/hooks/useGraphicsProV1Logic.ts"), /graphicspro-files/);
  assert.match(read("app/src/components/tools/MyVehicleProInline.tsx"), /toolSource === "GraphicsPro"/);
  assert.match(read("app/src/pages/GraphicsProV1.tsx"), /<FAQ productName="GraphicsPro" \/>/);
  assert.match(read("app/src/hooks/useIsAppRoute.ts"), /"\/graphics-pro"/);
});
