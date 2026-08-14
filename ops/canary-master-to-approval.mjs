import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Resolved from this file so the canary runs against whatever checkout it
// lives in. Hardcoded absolute paths meant it only ever ran on one machine.
const require = createRequire(import.meta.url);
const R = fileURLToPath(new URL("../runtime", import.meta.url));
const sharp = require(`${R}/node_modules/sharp`);
const { proceduralViewPlates } = require(`${R}/procedural-view-plates.cjs`);
const { authorDesignMaster, CREATIVE_BRIEF_CONTRACT } = require(`${R}/design-master-author.cjs`);
const { runOriginCycle, approveCycle, approvedProductionSurfaces } = require(`${R}/design-revision-cycle.cjs`);

const sha = (b) => createHash("sha256").update(b).digest("hex");
const uuid = (n) => `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const FONT = readFileSync(process.env.CANARY_FONT || "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf");
const PNG = { compressionLevel: 6, adaptiveFiltering: false, force: true };
const TRIM = { driver:[153,56], passenger:[153,56], hood:[71.5,56], roof:[74.3,54.8], front:[129,34], rear:[76,54] };
const KEYS = Object.keys(TRIM);
const PPI = Number(process.env.PPI || 8);
const MID = uuid("d"), MH = sha("f250-manifest");

const manifest = {
  totalSqFt: Math.round((KEYS.reduce((s,k)=>s+TRIM[k][0]*TRIM[k][1],0)/144)*100)/100,
  expectedSurfaces: KEYS.map((k)=>({surfaceKey:k,widthInches:TRIM[k][0],heightInches:TRIM[k][1],
    surfaceSqFt: Math.round((TRIM[k][0]*TRIM[k][1]/144)*100)/100})),
};

// Creative assets: what a model contributes. Imagery only, no lettering.
const fieldSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="3200" height="900">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0.35">
<stop offset="0" stop-color="#06131f"/><stop offset="0.5" stop-color="#0d3f63"/><stop offset="1" stop-color="#12a3a0"/></linearGradient></defs>
<rect width="3200" height="900" fill="url(#g)"/>
<path d="M0,640 C900,470 1500,760 3200,430 L3200,900 L0,900 Z" fill="#08192a" opacity="0.72"/>
<path d="M0,560 C900,392 1500,690 3200,352" stroke="#7fe7d8" stroke-width="16" fill="none"/>
<path d="M0,506 C900,340 1500,636 3200,300" stroke="#f4b942" stroke-width="7" fill="none"/></svg>`);
const field = await sharp(fieldSvg).png(PNG).toBuffer();
const mark = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><circle cx="120" cy="120" r="112" fill="#f4b942"/><path d="M64 152 L120 52 L176 152 Z" fill="#06131f"/></svg>`);

const snapshot = {
  contractVersion: "designpro.revision-snapshot.v1",
  designId: "DID-CANARY-F250",
  bodyText: KEYS.filter(k=>k==="driver"||k==="passenger").map((k)=>({
    textId:"domain", string:"PrecisionClimateAZ.com", surfaceKey:k, sizeIn:7,
    extent:{widthIn:110,heightIn:11}, transform:{x:18,y:36} })),
  expectedLogoInventory: ["driver","passenger"].map((k)=>({
    identityKey:"precision-mark", displayName:"Precision", surfaceKey:k,
    storagePath:"logos/mark.svg", contentHash: sha(mark) })),
};

const { master, assetSources } = authorDesignMaster({
  identity: { masterId:uuid("a"), revisionId:uuid("b"), vehicleId:uuid("c"),
    dimensionManifestId:MID, manifestHash:MH, designSpaceId:uuid("f"),
    surfaceMappings: Object.fromEntries(KEYS.map((k,i)=>[k,{mappingId:uuid(String(i+1)),mappingHash:sha(k)}])) },
  revisionSnapshot: snapshot, manifest,
  creativeBrief: { contract: CREATIVE_BRIEF_CONTRACT, direction:"teal-to-navy gradient, sweeping wave, premium HVAC", mood:"clean, technical" },
  creativeAssets: [{ assetId:"field", kind:"raster", contentHash:sha(field), storagePath:"creative/field.png",
    role:"background", generatedBy:"image-model", intrinsic:{widthPx:3200,heightPx:900}, minPxPerInch:1 }],
  composition: { layers:[{ layerId:"field", assetId:"field", space:"global",
    extent:{widthIn:728,heightIn:66}, transform:{x:0,y:0}, zOrder:0 }] },
  typography: { fontId:"sans", colorToken:"paper-white" },
  logoPlacements: { "precision-mark:driver":{widthIn:26,heightIn:26,x:112,y:6},
    "precision-mark:passenger":{widthIn:26,heightIn:26,x:112,y:6} },
  palette: [{token:"paper-white",srgb:"#f4f6f8"},{token:"brand-teal",srgb:"#12a3a0"}],
  fonts: [{fontId:"sans",family:"DejaVu Sans",version:"2.37",contentHash:sha(FONT),license:"bitstream-vera",storagePath:"fonts/s.ttf"}],
});
console.log("1. AUTHORED master", master.masterHash.slice(0,16), "layers", master.layers.length);

const plateSet = await proceduralViewPlates({ manifest, plateSetId:uuid("e"), vehicleId:uuid("c"), dimensionManifestId:MID, manifestHash:MH });
console.log("2. PLATES", plateSet.plates.views.length, "views,", plateSet.assets.size, "assets, authority", plateSet.manufacturingAuthority);

const bytesFor = { field, "logo-precision-mark": mark };
const cycle = await runOriginCycle({
  master, manifest, plates: plateSet.plates,
  loadAsset: async (ref) => { const id = typeof ref === "string" ? ref : ref.assetId; return bytesFor[id] || plateSet.assets.get(id); },
  loadFont: async () => FONT, proofFonts: { regular: FONT },
  pxPerInch: PPI, bleedInches: 5,
  vehicle: { year: 2022, make: "Ford", model: "F250 Crew Cab" },
  designName: "Precision Climate Solutions", finish: "gloss", orderNumber: "CANARY-1",
});
console.log("3. SURFACES", cycle.render.surfaces.map(s=>`${s.surfaceKey} ${s.pixelWidth}x${s.pixelHeight}`).join(", "));
console.log("4. 2D PROOF", cycle.proof2d.contentHash.slice(0,16), `${cycle.proof2d.totalSqFt} sqft`);
console.log("5. 3D PROOF", cycle.proof3d.proofHash.slice(0,16), cycle.proof3d.views.length, "views, authority", cycle.proof3d.manufacturingAuthority);
console.log("6. BUNDLE  ", cycle.identity.bundleIdentity.slice(0,16));

const approval = approveCycle({ cycle, approvedBy: uuid("9"), approvalRef: "canary-signoff", approvedAt: "2026-08-13T12:00:00.000Z" });
console.log("7. APPROVED", approval.approvalHash.slice(0,16));

const production = approvedProductionSurfaces({ approval, cycle });
console.log("8. PRODUCTION GATE PASSED ->", production.surfaces.length, "panels,", production.surfaces.map(s=>s.surfaceKey).join(","));
console.log("   text:", JSON.stringify(cycle.proof2d.textIdentities));

const OUT = process.env.CANARY_OUT || mkdtempSync(join(tmpdir(), "designpro-canary-"));
writeFileSync(join(OUT, "proof2d.png"), cycle.proof2d.bytes);
for (const v of cycle.proof3d.views) if (v.viewKey==="driver"||v.viewKey==="passenger")
  writeFileSync(join(OUT, `3d-${v.viewKey}.png`), v.bytes);
console.log("wrote proof images ->", OUT);
