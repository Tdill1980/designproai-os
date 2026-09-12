import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * GraphicsPro end-to-end static contract.
 *
 * The GraphicsPro product (surface → Konva ZoneMasker on the customer's photo →
 * mockup → cut graphics proof / CutContour PDF / production files, plus
 * MyVehiclePro on a real vehicle photo) was carried into this repository as a
 * byte-identical copy of RestylePro's and then never routed, while every edge
 * function it invokes and every table it reads stayed behind on the RestylePro
 * project. Each of the four halves is locked here so the next pruning pass
 * fails the release instead of reaching a customer:
 *
 *   1. the router serves it and the shell can reach it;
 *   2. every edge function the browser or run_production invokes exists here
 *      and is registered in config.toml;
 *   3. the schema it reads/writes is created by a migration, with CHECK
 *      constraints that admit the UI's own enums;
 *   4. MyVehiclePro carries the approved mockup as the design reference
 *      (the request used to 400 with "Styling prompt required").
 *
 * Static on purpose: no browser, no Supabase project, no Gemini.
 */

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const APP = read("app/src/App.tsx");
const NAV = read("app/src/lib/dashboard-nav.ts");
const WORDMARKS = read("app/src/components/dashboard/ToolWordmark.tsx");
const IS_APP_ROUTE = read("app/src/hooks/useIsAppRoute.ts");
const CONFIG = read("supabase/config.toml");
const MIGRATION = read("supabase/migrations/20260911210000_graphicspro_cut_contour.sql");
const TYPES = read("app/src/components/graphicspro-v1/types.ts");
const V1_LOGIC = read("app/src/hooks/useGraphicsProV1Logic.ts");
const V1_UI = read("app/src/components/graphicspro-v1/GraphicsProV1ToolUI.tsx");
const MVP_INLINE = read("app/src/components/tools/MyVehicleProInline.tsx");
const MVP_ENDPOINT = read("app/src/lib/myvehicleEndpoint.ts");
const GGP = read("supabase/functions/generate-graphics-pro/index.ts");
const GP_MVP = read("supabase/functions/graphicspro-on-vehicle-photo/index.ts");
const GP_MVP_PROMPT = read("supabase/functions/graphicspro-on-vehicle-photo/prompt.ts");
const VECTORIZE = read("supabase/functions/vectorize-it/index.ts");
const CUT_BUILD = read("supabase/functions/cut-contour-build/index.ts");
const PRODUCE = read("supabase/functions/_shared/cut-contour/produce.ts");
const GEOMETRY = read("supabase/functions/_shared/cut-contour/geometry.mjs");

const BROWSER_SOURCES = [
  "app/src/hooks/useGraphicsProV1Logic.ts",
  "app/src/hooks/useCutGraphicsProof.ts",
  "app/src/components/graphicspro-v1/GraphicsProV1ToolUI.tsx",
  "app/src/components/tools/MyVehicleProInline.tsx",
];

function invokedFunctions(source) {
  return [...stripComments(source).matchAll(/functions\.invoke\(\s*"([a-z0-9-]+)"/g)].map((m) => m[1]);
}

function enumValues(source, typeName) {
  const match = source.match(new RegExp(`export type ${typeName} = ([^;]+);`));
  assert.ok(match, `${typeName} is not declared in graphicspro-v1/types.ts`);
  return [...match[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
}

function checkValues(column) {
  const match = MIGRATION.match(new RegExp(`${column} text[^\\n]*CHECK \\(${column} IN \\(([^)]+)\\)`));
  assert.ok(match, `graphics_pro_jobs.${column} carries no CHECK constraint`);
  return [...match[1].matchAll(/'([a-z_-]+)'/g)].map((m) => m[1]);
}

test("GraphicsPro is routed, guarded and reachable from the shell", () => {
  assert.match(APP, /<Route path="\/graphics-pro" element=\{<RequireAuth><GraphicsProV1 \/><\/RequireAuth>\} \/>/);
  assert.match(APP, /<Route path="\/graphics-pro-wall" element=\{<RequireAuth><GraphicsProWall \/><\/RequireAuth>\} \/>/);
  assert.match(APP, /<Route path="\/graphicspro" element=\{<Navigate to="\/graphics-pro" replace \/>\} \/>/);
  assert.match(NAV, /key:\s*"graphicspro"[\s\S]{0,200}route:\s*"\/graphics-pro"/, "the navigation registry must list GraphicsPro");
  assert.match(WORDMARKS, /^\s*graphicspro:/m, "GraphicsPro needs a wordmark or the sidebar renders its raw key");
  assert.match(IS_APP_ROUTE, /"\/graphics-pro"/, "GraphicsPro must keep the app shell chrome");
});

test("walls, windows and vehicles all reach the same tool and the same cut-contour kit", () => {
  // Entry pages pre-select the surface; the one tool serves all three.
  assert.match(read("app/src/pages/GraphicsProWall.tsx"), /<GraphicsProV1ToolUI initialSurfaceType="wall" \/>/);
  assert.match(read("app/src/pages/GraphicsProWindow.tsx"), /<GraphicsProV1ToolUI initialSurfaceType="glass" \/>/);
  assert.match(APP, /<Route path="\/graphics-pro-window" element=\{<RequireAuth><GraphicsProWindow \/><\/RequireAuth>\} \/>/);
  // Every surface's zones are drawn on the customer's photo in the Konva ZoneMasker …
  const surfaceSelection = read("app/src/components/graphicspro-v1/SurfaceSelection.tsx");
  assert.match(surfaceSelection, /imageUrl=\{surface\.wallPhotoUrl\}[\s\S]{0,200}zones=\{surface\.vinylZones\}/, "wall zones");
  assert.match(surfaceSelection, /imageUrl=\{surface\.glassPhotoUrl\}[\s\S]{0,200}zones=\{surface\.vinylZones\}/, "window zones");
  assert.match(surfaceSelection, /zones=\{a\.zones\}/, "per-angle vehicle zones");
  // … and the kit reads them wherever they live: vinylZones (wall / window /
  // built vehicle) or uploadedAngles[].zones (uploaded vehicle photos).
  assert.match(GGP, /\.\.\.\(surface\?\.vinylZones \|\| \[\]\),\s*\.\.\.\(\(surface\?\.uploadedAngles \|\| \[\]\) as any\[\]\)\.flatMap\(\(a: any\) => a\?\.zones \|\| \[\]\)/);
  assert.match(V1_UI, /const zones = surface\.source === 'upload' \? surface\.uploadedAngles\.flatMap\(\(a\) => a\.zones\) : surface\.vinylZones;/);
  // The production-proof card (Cut Contour Kit button) shows for all three surfaces.
  assert.match(V1_UI, /\(surface\.type === 'vehicle' \|\| surface\.type === 'wall' \|\| surface\.type === 'glass'\) && \(/);
  // Windows: interior-mount graphics are cut in reverse, from the UI and from run_production.
  assert.match(V1_UI, /mirror: surface\.type === 'glass' && surface\.glassMount === 'interior'/);
  assert.match(GGP, /mirror: surface\?\.type === "glass" && surface\?\.glassMount === "interior"/);
  assert.match(PRODUCE, /mirror\?: boolean;/);
  assert.match(CUT_BUILD, /mirror: opt\.mirror === true \|\| opt\.mirror === "true"/);
  // The flat artwork is briefed per surface.
  for (const surface of ["wall", "glass", "vehicle"]) assert.match(GGP, new RegExp(`p\\.surfaceType === "${surface}" \\? "APPLICATION: cut vinyl`));
  assert.match(V1_LOGIC, /surfaceType: cutContext\?\.surfaceType \?\? undefined/);
});

test("every edge function the browser invokes exists here and is registered", () => {
  const names = new Set(BROWSER_SOURCES.flatMap((path) => invokedFunctions(read(path))));
  // MyVehiclePro resolves its function by tool; GraphicsPro's own plus the
  // shared fallback both have to exist.
  for (const name of ["graphicspro-on-vehicle-photo", "edit-vehicle-photo"]) {
    assert.match(MVP_ENDPOINT, new RegExp(`"${name}"`));
    names.add(name);
  }
  assert.ok(names.has("generate-graphics-pro"), "the mockup path must invoke generate-graphics-pro");
  assert.ok(names.has("cut-graphics-proof"), "the dimensioned proof must invoke cut-graphics-proof");
  assert.ok(names.has("cut-contour-build"), "the CutContour PDF must invoke cut-contour-build");
  for (const name of names) {
    assert.ok(
      existsSync(resolve(root, `supabase/functions/${name}/index.ts`)),
      `the browser invokes ${name} but supabase/functions/${name}/index.ts does not exist`,
    );
    assert.ok(CONFIG.includes(`[functions.${name}]`), `${name} is not registered in supabase/config.toml`);
  }
});

test("run_production builds the cut-contour kit deterministically and fans out only to functions that exist here", () => {
  const names = invokedFunctions(GGP);
  assert.deepEqual([...new Set(names)], ["cut-contour-build"], "cut line, bleed, nesting and the CutContour PDF all come from cut-contour-build");
  assert.ok(!names.includes("quick-prep-pdf-export"), "quick-prep-pdf-export never embedded the artwork; it must not be the PDF stage");
  assert.ok(!names.includes("cut-map") && !names.includes("generate-cut-files"), "no Replicate / VTracer dependency on the cut line");
  assert.match(GGP, /options: \{\s*width_in: widthIn,\s*height_in: heightIn,\s*bleed_in:[^\n]*\n\s*substrate: surface\?\.vinylSubstrate === "cut" \? "cut" : "printed"/, "the kit gets the measured size, the bleed and the production method");
  assert.match(GGP, /let nestedWidth = sheetWidthIn;\s*let nestedHeight = sheetHeightIn;/, "pricing uses the nested sheet the customer orders");
  for (const name of names) {
    assert.ok(existsSync(resolve(root, `supabase/functions/${name}/index.ts`)), `run_production invokes ${name}, which does not exist`);
    assert.ok(CONFIG.includes(`[functions.${name}]`), `${name} is not registered in supabase/config.toml`);
  }
  assert.ok(!stripComments(GGP).includes("production_flow_assets"), "production_flow_assets is a RestylePro vault this OS does not have");
});

test("the cut-contour producer is the WPW guide, deterministically, and cut-contour-build runs it", () => {
  // The spot colour the RIP keys on: the literal name and 100% magenta.
  assert.match(PRODUCE, /name: "CutContour"/);
  assert.match(PRODUCE, /cmyk: Object\.freeze\(\{ c: 0, m: 100, y: 0, k: 0 \}\)/);
  assert.match(PRODUCE, /strokeWeightPt: 0\.25/);
  assert.match(PRODUCE, /PDFName\.of\("Separation"\), PDFName\.of\(CUT_CONTOUR_SPOT\.name\), PDFName\.of\("DeviceCMYK"\)/, "a real PDF Separation colour space, not a process-magenta stroke");
  assert.match(PRODUCE, /C1: \[0, 1, 0, 0\]/);
  assert.match(PRODUCE, /StrokingColorspace, \[PDFName\.of\(CUT_CONTOUR_SPOT\.name\)\]/);
  // Three layers as optional content, cut line stroked never filled.
  assert.match(PRODUCE, /\["CutContour", \.\.\.filmOrder\.map\(filmLayer\), "Bleed"\]/, "Film Cut: one vector layer per film, CutContour on top, Bleed underneath");
  assert.match(PRODUCE, /: \["CutContour", "Artwork", "Bleed"\]/, "Print & Cut: raster artwork inside the vector-layered file");
  assert.match(PRODUCE, /MIN_LETTER_HEIGHT_IN = 2/, "WPW: letters under 2\" need a conversation before ordering");
  assert.match(PRODUCE, /G\.smallLetterRuns\(g\.components, MIN_LETTER_HEIGHT_IN \* dpiWork\)/);
  assert.match(PRODUCE, /OCProperties/);
  assert.match(PRODUCE, /cutOps\.push\(stroke\(\), popGraphicsState\(\), endOC\(\)\)/);
  // 1/4" bleed that extends the artwork's own colour; 51.5" nesting limit; 10% scale beyond 200".
  assert.match(PRODUCE, /DEFAULT_BLEED_IN = 0\.25/);
  assert.match(PRODUCE, /MAX_CUT_CONTOUR_HEIGHT_IN = 51\.5/);
  assert.match(PRODUCE, /G\.bleedRing\(elemRgba, elemMask, cw, ch, bleedPx, dist\)/);
  assert.match(PRODUCE, /G\.shelfPack\(items, maxSheetHeightIn, gapIn\)/);
  assert.match(PRODUCE, /const scale = Math\.max\(sheetWIn, sheetHIn\) > PDF_MAX_IN \? 0\.1 : 1/);
  // The geometry core is pure and node-tested.
  assert.ok(!/\bimport\b/.test(GEOMETRY), "geometry.mjs has no dependencies");
  for (const fn of ["maskFromRgba", "edt", "traceBoundaries", "cleanLoop", "bleedRing", "quantizeColors", "shelfPack"]) {
    assert.match(GEOMETRY, new RegExp(`export function ${fn}\\(`));
  }
  // cut-contour-build's file-prep mode is the producer, and returns PDF + SVG + ZIP.
  assert.match(CUT_BUILD, /import \{ produceCutContour, DEFAULT_BLEED_IN \} from "\.\.\/_shared\/cut-contour\/produce\.ts"/);
  assert.match(CUT_BUILD, /const result = await produceCutContour\(img\.bytes, \{/);
  assert.match(CUT_BUILD, /output_url: pdfUrl,\s*svg_url: svgUrl,\s*preview_url: svgUrl,\s*zip_url: zipUrl/);
  assert.ok(!/drawRectangle\(\{ x: offX, y: offY, width: trimW, height: trimH, borderColor: MAGENTA/.test(stripComments(CUT_BUILD).split("const { data: proof, error: fetchErr }")[0]), "the file-prep mode no longer draws a rectangle keyline around a raster");
  // The flat artwork Gemini draws is briefed as cut-ready input to that producer.
  assert.match(GGP, /Background is PURE WHITE \(#FFFFFF\)/);
  assert.match(GGP, /Every graphic is a SOLID, CLOSED SHAPE with a clean, crisp outer edge/);
  assert.match(GGP, /MANUFACTURE FILM CUT: flat solid colours ONLY/);
  assert.match(V1_LOGIC, /vinylSubstrate: cutContext\?\.vinylSubstrate/);
  assert.match(V1_UI, /substrate: surface\.vinylSubstrate,\s*label: designLabel/);
});

test("GraphicsPro files live in the public graphicspro-files bucket, never the private wrap-files", () => {
  assert.match(MIGRATION, /INSERT INTO storage\.buckets[^;]*'graphicspro-files',\s*'graphicspro-files',\s*true/);
  assert.match(MIGRATION, /graphicspro_files_public_read ON storage\.objects/);
  assert.match(MIGRATION, /graphicspro_files_owner_upload[\s\S]{0,400}\(storage\.foldername\(name\)\)\[1\] = 'renders'[\s\S]{0,120}\[2\] = \(SELECT auth\.uid\(\)\)::text/);
  for (const path of [
    "app/src/hooks/useGraphicsProV1Logic.ts",
    "supabase/functions/generate-graphics-pro/index.ts",
    "supabase/functions/graphicspro-on-vehicle-photo/index.ts",
    "supabase/functions/edit-vehicle-photo/index.ts",
    "supabase/functions/cut-contour-build/index.ts",
  ]) {
    const source = stripComments(read(path));
    assert.ok(!source.includes("wrap-files"), `${path} still writes to the private wrap-files bucket`);
    assert.ok(source.includes("graphicspro-files"), `${path} does not use the graphicspro-files bucket`);
  }
  // The browser upload path must land inside the prefix the storage policy admits.
  assert.match(V1_LOGIC, /const path = `renders\/\$\{user\.id\}\/GraphicsProV1\//);
});

test("the migration creates what the product reads and admits the UI's own enums", () => {
  assert.match(MIGRATION, /CREATE TABLE public\.graphics_pro_jobs/);
  assert.match(MIGRATION, /CREATE TABLE public\.graphics_pro_pricing/);
  assert.match(MIGRATION, /CREATE TABLE public\.shop_pricing_config[\s\S]{0,200}user_id uuid NOT NULL UNIQUE/, "ShopMarkupConfig upserts on user_id");
  assert.match(MIGRATION, /'avery_cut_contour'[^\n]*6\.32/);
  assert.match(MIGRATION, /'3m_cut_contour'[^\n]*6\.92/);

  const modes = checkValues("mode");
  for (const mode of enumValues(TYPES, "GraphicMode")) {
    assert.ok(modes.includes(mode), `graphics_pro_jobs.mode rejects the UI mode '${mode}'`);
  }
  const surfaces = checkValues("surface_type");
  for (const surface of enumValues(TYPES, "SurfaceType")) {
    assert.ok(surfaces.includes(surface), `graphics_pro_jobs.surface_type rejects the UI surface '${surface}'`);
  }
  const finishes = checkValues("vinyl_finish");
  for (const finish of enumValues(TYPES, "VinylFinish")) {
    assert.ok(finishes.includes(finish), `graphics_pro_jobs.vinyl_finish rejects the UI finish '${finish}'`);
  }
  // Every status the edge function writes and the browser polls for.
  const statuses = checkValues("status");
  for (const status of ["mockup_ready", "approved", "processing", "complete", "failed"]) {
    assert.ok(statuses.includes(status), `graphics_pro_jobs.status rejects '${status}'`);
  }
  // The customer polls their own job from the browser (ProductionOutput).
  assert.match(MIGRATION, /graphics_pro_jobs_owner_select[\s\S]{0,120}user_id = \(SELECT auth\.uid\(\)\)/);
});

test("MyVehiclePro carries the approved mockup as the GraphicsPro design reference", () => {
  // The panel used to send colour fields only, and the function refused every
  // request: "Styling prompt required". Now the mockup IS the design.
  assert.match(MVP_INLINE, /if \(toolSource === "GraphicsPro"\)[\s\S]{0,300}colorData\.designUrl = renderUrl/);
  assert.match(MVP_INLINE, /colorData\.customStylingPrompt = /);
  assert.match(GP_MVP, /colorData\.designUrl \|\| colorData\.panelUrl/);
  assert.match(GP_MVP, /parts\.push\(\{ inlineData: designReference \}\)/, "the reference must ride as IMAGE 2");
  assert.match(GP_MVP_PROMPT, /hasDesignReference/);
  assert.match(GP_MVP_PROMPT, /IMAGE 2: The APPROVED MOCKUP/);
  // Vehicle jobs only — a wall graphic has no vehicle to see it on — and the
  // brief, not the literal "Graphic", is the styling prompt.
  assert.match(V1_UI, /\(surface\.type === 'vehicle' \|\| surface\.source === 'upload'\) && \(\s*<MyVehicleProInline/);
  assert.match(V1_UI, /designName=\{graphic\.businessName \|\| graphic\.designPrompt \|\| "Cut vinyl graphic"\}/);
  assert.ok(!/designName="Graphic"/.test(V1_UI));
});

test("the customer's own photo reaches the mockup with the Konva zones burned in", () => {
  // Wall / glass photos and every uploaded vehicle angle are uploaded first,
  // the ZoneMasker rectangles are composited onto that photo, and BOTH go to
  // the mockup call — the overlay first, as the hard spatial mask.
  assert.match(V1_LOGIC, /surface\.type === "wall" && surface\.wallPhotoFile[\s\S]{0,120}uploadFile\(surface\.wallPhotoFile, "wall-photos"\)/);
  assert.match(V1_LOGIC, /composeZoneOverlay\(item\.surfaceUrl, item\.zones\)/);
  assert.match(V1_LOGIC, /surfaceImageWithZonesUrl: zoneOverlayUrl/);
  assert.match(GGP, /if \(surfaceImageWithZonesUrl\) \{\s*const overlayImg = await fetchImageAsBase64\(surfaceImageWithZonesUrl\);\s*if \(overlayImg\) refImages\.push\(overlayImg\);/);
  const surfaceSelection = read("app/src/components/graphicspro-v1/SurfaceSelection.tsx");
  assert.match(surfaceSelection, /imageUrl=\{surface\.wallPhotoUrl\}/, "the wall photo must open in the Konva ZoneMasker");
  assert.match(surfaceSelection, /imageUrl=\{surface\.glassPhotoUrl\}/, "the storefront photo must open in the Konva ZoneMasker");
  assert.match(read("app/src/components/graphicspro-v1/ZoneMasker.tsx"), /from "react-konva"/);
});

test("vectorize-it points at the DesignProAI runtime, never a hard-coded RestylePro host", () => {
  assert.ok(!/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(stripComments(VECTORIZE)), "no hard-coded droplet IP");
  assert.match(VECTORIZE, /Deno\.env\.get\("VECTORIZE_DROPLET_URL"\)/);
  assert.match(VECTORIZE, /status: 503/);
});
