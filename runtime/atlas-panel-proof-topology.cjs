"use strict";
/**
 * runtime/atlas-panel-proof-topology.cjs — CALL 1 AS THE PANEL PRODUCTION
 * PROOF, ON THE LIVE CUSTOMER ROUTE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-19: "real customer traffic is trapped on the legacy v28
 * artboard while production-panel-proof only runs via test probes ... wire
 * `production-panel-proof` directly into the live customer production route as
 * the active Call 1 engine (no more probe-only execution)."
 *
 * She is right that a component nothing routes to is not shipped. This is the
 * seam that routes it, and it is deliberately the SAME seam hero-driver uses:
 * an authoring function that returns `{bytes, contentHash, model, provenance}`
 * and throws a typed refusal. Nothing downstream changes by a single byte.
 *
 * ═══ WHY THE SHEET BECOMES A 4096² MASTER RATHER THAN REPLACING IT ═══
 *
 * The proof sheet is a 3:2 DOCUMENT. Everything after Call 1 — the master
 * gates, `cutCallOnePanels`, the seven proof authorities, Call 8's geometry,
 * Call 9's promotion, the revision row, both UIs — reads a square six-zone
 * A.T.L.A.S. master addressed by `manifest.zones`. Handing that chain a
 * document would not be "wiring the new system in"; it would be rewriting
 * twelve proven stages to accept a second shape, which is exactly the
 * greenfield move RULE 0 forbids.
 *
 * So the DAG ends by ASSEMBLING: the six Zone-1 panels are placed into the
 * GENIE manifest zones by `assembleFinishedMaster` — the same assembler the
 * hero cascade uses for the same reason — and what leaves this file is an
 * ordinary accepted master. The gates then judge it exactly as they judge any
 * other, which is the point: the new engine earns its acceptance through the
 * existing gates rather than around them.
 *
 * ═══ THE DAG ═══
 *
 *   proof.sheet ──▶ panel.cut ──▶ master.assemble
 *        │              │               │
 *   ONE image call   17 artifacts   the 4096² master
 *   (three zones)    zero AI        (zone 1 placed)
 *
 * and then NOTHING NEW. An assembled master is where this file stops. The
 * orchestration that takes it from there was already engineered and is not
 * touched: `cutCallOnePanels` cuts the six print panels, each release calls
 * `launchAtlasProof` (generation-worker.cjs), that reaches the pinned
 * `persona-photographer-render` in `mode: "atlas-proof"` for all seven views,
 * and the stage chain carries it through `await_panelpro_preflight_qc` ->
 * `enhance.upscale` -> `output.build` -> ZIP -> WrapBox.
 *
 * ⚠️ AN EARLIER DRAFT OF THIS WORK WROTE A SECOND CALL-2 CALLER
 * (`runtime/atlas-proof-3d.cjs`) BESIDE `launchAtlasProof`, and nothing ever
 * required it — the owner spotted it: "we had the graph engineered
 * orchestration for the 3d proofs and the QC - wrapbox checks." She was right.
 * It is deleted. RULE 0.29 says feed the deployed photographer, and the worker
 * already did; RULE 1 says recover before you invent. A duplicate caller that
 * nothing routes to still costs the next reader an hour deciding which one is
 * real. Do not add another one here.
 *
 * ZONE 2 AND ZONE 3 ARE STORED, NOT MEASURED AND DROPPED.
 *
 * Owner, 2026-09-19: "Production panel proof is source it has the 3 zones / For
 * panels, panels with seperated and logos and text." All three quadrants are
 * the deliverable, and only Zone 1 was reaching anything.
 *
 * This comment used to claim they "ride on the provenance as content-addressed
 * siblings" and that was FALSE: `sibling()` recorded `surfaceKey, role,
 * byteSize, fit, rect` and no storage path and no content hash, so the pixels
 * were cut, measured and garbage-collected when this function returned. A
 * receipt that names a byte count for bytes nobody can fetch is the
 * claiming-what-was-never-established shape this repo has now recorded five
 * times, and this instance was in a comment asserting the opposite.
 *
 * Each panel of both quadrants is now written through `store.putImmutableBytes`
 * — the seam `store` was already passed here for and ignored, so this is no new
 * door — and crosses the boundary as `{storagePath, contentHash, byteSize}`
 * (RULE 0.39). Content-addressed, so a re-run re-uploads nothing.
 *
 * WHY IT MATTERS MORE THAN A RECEIPT: both quadrants have a downstream consumer
 * already, and each one currently reconstructs what this sheet authored:
 *
 *   Zone 2 → `panels.delogo` (Call 11), which today duplicates a BRANDED panel,
 *            AI-locates the logo boxes and paints white rectangles over them.
 *   Zone 3 → `logos.extract` (Call 10), which keys marks out of finished art.
 *
 * An authored clean base beats a stripped one — RestylePro's own words, after
 * it shipped the smear: "Never re-introduce a strip/heal to make a clean logo
 * removal — it smears. The clean base is AUTHORED, not stripped." Wiring those
 * two stages onto these bytes is the next step and is NOT done here; storing
 * them is what makes it possible at all.
 *
 * Zones 1 and 2 are mandatory. Missing geometry or failed artifact persistence
 * refuses the node before it can publish a ready master. ZONE 3 DEGRADES
 * (owner, 2026-09-22): no original assets and no customer text is an EMPTY
 * band recorded in `composition.omitted`, never a refusal; a generated mark
 * with no alpha is dropped the same way. A SUPPLIED logo that cannot be read
 * or hash-verified still refuses. Zone 3 remains a raster preview; it is not
 * a vector cut file or QC approval.
 *
 * A refused panel-proof candidate is recorded in the refusal ledger and the
 * caller spends its bounded second candidate (`candidate` below), then stops
 * with the gate's real reason. The caller never substitutes another authoring
 * topology: THERE IS NO OTHER CALL 1 (owner, 2026-09-22).
 *
 * `DESIGNPRO_ATLAS_PANEL_PROOF` is no longer a router (owner, 2026-09-22:
 * "There isn't any other Call 1"). `panelProofEnabled()` is kept as the deploy
 * receipt that reads it -- `configure-env.sh`, `validate-env.py` and the
 * deploy-workflow lock still thread it -- and the routing logs when it reads
 * `off`, but every new authoring and every revision is the panel proof.
 */

const PANEL_PROOF_TOPOLOGY = "panel-proof";
const PANEL_PROOF_TOPOLOGY_CONTRACT = "designpro.atlas-panel-proof-topology.v2";
/** Its OWN Call-1 endpoint. It cannot reach design-panel-ai-generate at all. */
const PROOF_EDGE_FUNCTION = "production-panel-proof";

const { compositeProductionPanels, COMPOSITION_CONTRACT } = require("./atlas-master-composite.cjs");
const { planProductionPanelLockup } = require("./atlas-element-lockup.cjs");
const typeset = require("./atlas-typeset-layer.cjs");
const { verifyLogoIdentity } = require("./atlas-logo-prepare.cjs");
const { PROOF_REGIONS } = require("./atlas-panel-proof-contract.cjs");
// QUADRANTS is the ONE definition of the three role names. It is imported
// rather than retyped because a retyped copy is exactly how "clean-panel"
// drifted from "clean" and blanked every derived proof behind a 502.
const { cutProofPanels, scaleCell, QUADRANTS } = require("./atlas-proof-panels.cjs");
const {
  parsePanelRows, renderContainerTemplate, containerLayout,
} = require("./atlas-proof-container-template.cjs");
const { zonePixelSize } = require("./atlas-hero-driver.cjs");
const { createHash } = require("node:crypto");

const BUCKET = "wrap-files";
/** The A.T.L.A.S. master canvas. Not negotiable here: twelve stages read it. */
const CANVAS_PX = 4096;
/**
 * The edge's own allowlist, mirrored here so a path it would refuse cannot
 * leave this runtime. This is the 2099d17d lesson, applied before it costs a
 * live run: `attach()` admits a Call-1 input ONLY from this shape, and node 1
 * of the hero-first graph spent a whole generation discovering that by being
 * refused.
 */
const CALL1_INPUT_PATH = /^atlas-call1-inputs\/[0-9a-f]{64}\.png$/;

/**
 * Where the clean panels and the cut graphics live.
 *
 * Content-addressed and deliberately NOT under `atlas-call1-inputs/`: these are
 * OUTPUTS of Call 1, and that prefix is the edge's input allowlist. Putting a
 * product artifact in the doorway the flatten reads from is how a later change
 * ends up attaching a customer's own clean panel as a teaching input.
 */
const QUADRANT_PREFIX = "atlas-panel-proof/quadrants";

// DID-XXXXXXXX — the ONE canonical form, identical to app/src/lib/designId.ts,
// runtime/wrapbox-delivery.cjs and runtime/generation-worker.cjs. Kept as its
// own tiny function rather than imported because this module is loaded in the
// edge bundle too; the slice is what must not drift, and it is asserted.
function designIdFromGenerationId(generationId) {
  const hex = String(generationId || "").replaceAll("-", "");
  return hex.length >= 8 ? `DID-${hex.slice(0, 8).toUpperCase()}` : "";
}

/**
 * THE ID LADDER (owner, 2026-09-22: "Generation ID is call one, then design
 * id, and order id"). The sheet is a PRE-purchase document, so its job block
 * names the Generation ID -- the same first-8-hex the app's chip shows -- and
 * never a DID derived on the spot: a DID exists only once a purchase does.
 */
function generationIdLabel(generationId) {
  const hex = String(generationId || "").replaceAll("-", "");
  return hex.length >= 8 ? hex.slice(0, 8).toUpperCase() : "";
}

/** MM/DD/YYYY in UTC, the form the owner's reference sheet carries. */
function proofDateLabel(now = new Date()) {
  const d = new Date(now);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getUTCFullYear()}`;
}

/** Zone 3 slot index by the role a code-owned asset carries. */
const ZONE3_SLOT_INDEX = Object.freeze({ logo: 0, typography: 1, contact: 2, promo: 3, icons: 4 });
/** Zone 3 slot key by index -- the container's own slot keys, in order. */
const ZONE3_SLOT_KEYS = Object.freeze(["logo", "tagline", "contact", "promo", "icons"]);

/**
 * ZONE 3 CARRIES THE DESIGN'S OWN ELEMENTS (owner, 2026-09-22: "a Restyle
 * design will have design elements that end up in zone 3 see example").
 *
 * The model is told to fill every Zone 3 box with the design's own marks --
 * a Restyle's vehicle number, series text, ship graphic, icon, stripe set,
 * badge -- and it draws them into the sheet. Until this date the assembler
 * then rebuilt Zone 3 from code-owned assets only (an original or generated
 * logo, typeset name and contact lines) and DISCARDED what the model drew, so
 * a design with no company name and no logo shipped an EMPTY Zone 3 band on
 * the customer's own proof.
 *
 * Now a slot no code-owned asset claims is filled from the sheet: the box is
 * cropped off the accepted sheet, inset past the template's own dashed frame,
 * measured for ink, trimmed to its ink and persisted as a Zone 3 element. It is
 * a RASTER PREVIEW on the sheet's white ground, drawn by the same pass that
 * drew Zone 1, so it matches the panels by construction. It is not keyed to
 * alpha -- a white or light element (the reference sheet's X-wing) would be
 * eaten by a white key -- and it is not a vector cut file; the plotter-ready
 * contours are produced in the production pack (Call 10), exactly as before.
 * `source: "sheet-drawn"` and `vector: false` say so on the receipt.
 *
 * A box with no ink is an empty slot, recorded in `composition.omitted` as
 * `slot_not_drawn`; nothing here can refuse a Call 1. Code-owned assets always
 * win their slot; the sheet never overwrites an original.
 */
const SHEET_DRAWN_CAPTION = Object.freeze({ caption: "DESIGN ELEMENT", note: "(Cut graphic — drawn with this design)" });
const SHEET_DRAWN_MIN_INK = 0.005;
const SHEET_DRAWN_INK_MAX_CHANNEL = 225;

async function sheetDrawnCutGraphic({ sheetBytes, rect, slotKey, slotIndex, sharp, persist }) {
  const inset = Math.max(3, Math.round(Math.min(rect.width, rect.height) * 0.04));
  const region = {
    left: rect.left + inset, top: rect.top + inset,
    width: Math.max(1, rect.width - inset * 2), height: Math.max(1, rect.height - inset * 2),
  };
  const { data, info } = await sharp(sheetBytes, { limitInputPixels: 40000000 })
    .extract(region).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let ink = 0, minX = info.width, minY = info.height, maxX = -1, maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 3;
      if (Math.min(data[i], data[i + 1], data[i + 2]) < SHEET_DRAWN_INK_MAX_CHANNEL) {
        ink++;
        if (x < minX) minX = x; if (y < minY) minY = y;
        if (x > maxX) maxX = x; if (y > maxY) maxY = y;
      }
    }
  }
  const fit = ink / (info.width * info.height);
  if (fit < SHEET_DRAWN_MIN_INK || maxX < minX || maxY < minY) {
    return { omitted: { zone: "zone3", role: slotKey, reason: "slot_not_drawn", fit: Number(fit.toFixed(4)) } };
  }
  const pad = 4;
  const left = Math.max(0, minX - pad), top = Math.max(0, minY - pad);
  const width = Math.min(info.width, maxX + pad + 1) - left;
  const height = Math.min(info.height, maxY + pad + 1) - top;
  const bytes = await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } })
    .extract({ left, top, width, height }).png().toBuffer();
  const contentHash = sha256(bytes);
  const stored = await persist({ storagePath: `atlas-elements/${contentHash}.png`, bytes, contentType: "image/png" });
  return { element: {
    ...stored, contentHash, byteSize: bytes.length, contentType: "image/png", width, height,
    // `assetRole` names WHICH element this is (logo / typography / contact /
    // promo / icon); `role` says it is a cut graphic. Both are needed: the
    // handoff's logo inventory and zip.build's archive filename read the first.
    surfaceKey: slotKey, assetRole: slotKey, slotIndex, role: "cut-graphic", persisted: true, vector: false,
    source: "sheet-drawn", fit: Number(fit.toFixed(4)), widthIn: null, heightIn: null, bytes,
  } };
}

/** What the Zone 3 band is made of, for the receipt. */
function zone3Format(zone3) {
  if (!zone3.length) return "none";
  if (zone3.every((a) => a.vector)) return "vector-originals";
  if (zone3.every((a) => a.source === "sheet-drawn")) return "sheet-drawn-raster";
  return "mixed-originals";
}

/**
 * How far a cut crop's aspect may sit from the zone it is resized into.
 *
 * `fit: "fill"` cannot refuse anything, so this is the guard that stops a crop
 * from the wrong region being reshaped into a valid-looking print panel. A
 * legitimate crop drifts by rounding only (the cut is integer-rounded off a
 * scaled sheet); a crop of the wrong region on a real sheet drifts by tens of
 * percent. 1.05 sits far above the former and far below the latter.
 *
 * It is the same shape of guard as `MAX_ASPECT_DRIFT_RATIO` in the hero
 * cascade, which exists for the same reason: a resize that silently reshapes is
 * a defect no downstream measurement can see.
 */
/**
 * ⛔ THE DIE-CUT GATE — A BRANDED PANEL MAY NOT BE EMPTIER THAN ITS OWN CLEAN TWIN.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Live 848be1c6 (2026-09-23, New Aura Day Spa on a Prius): the HOOD came back
 * drawn as a hood SILHOUETTE floating on the document's own white page, and it
 * shipped to PanelPro as a promoted production panel. Owner: "see hood also
 * fail cut to share of hood that's wrong."
 *
 * EVERY INSTRUMENT SAW IT AND NONE OF THEM COULD STOP IT:
 *
 *   masterOutputClass  vehicle_depiction, confidence 1.0, anatomyRectangles 3,
 *                      evidence "The hood panel is a vehicle-shaped island of
 *                      artwork on a plain white surround" — but on this
 *                      topology both master gates are ADVISORY by the owner's
 *                      2026-09-21 ruling ("System must not issue fails because
 *                      of no atlas"), so the verdict was recorded beside an
 *                      accepted master and refused nothing.
 *   edgeHoleRatio      0.000 on the hood. It is a DARKNESS test (holeAt is
 *                      luma <= 24) and this surround is 248,248,248. It is
 *                      structurally blind to a die-cut on white, exactly as
 *                      efca5e03 was blind to one on luma-88 grey.
 *   fit                0.8088 branded against 0.9841–1.0000 on every sibling —
 *                      measured, recorded, and consumed by nothing ("Paint
 *                      density remains a receipt metric").
 *
 * WHY THIS COMPARISON AND NOT A FIT FLOOR. A floor convicts a legitimately
 * light design, which is the precise false positive RULE 0.32 refused
 * `measurePlainSurround` for: this repo's own full-bleed fixtures — a flat
 * ground with graphics inset — score at the extreme and are correct. So the
 * gate is RELATIVE, and it rests on a fact about ink rather than a threshold
 * about taste:
 *
 *     ZONE 1 IS ZONE 2 PLUS LETTERING. TYPE ADDS INK. IT CANNOT SUBTRACT IT.
 *
 * Both bands are the same surface, at the same cell size, drawn by the same
 * model in the same pass, and Zone 2 is defined as those panels without the
 * type. A branded cell materially emptier than its own clean twin therefore
 * has no innocent reading — one band was die-cut and the other was not. A
 * design that is white all over is white in BOTH bands and the difference is
 * zero, so it is never convicted here.
 *
 * Measured on 848be1c6, branded minus clean:
 *
 *     driver 0.0000 · passenger 0.0000 · roof 0.0000
 *     front -0.0105 · rear +0.0044 · HOOD -0.1912
 *
 * 18x the worst innocent deviation. MAX_BAND_FIT_DROP sits at 0.06 — three
 * times clear of the defect and six times clear of the noise.
 *
 * THE CROSS-SURFACE DEFICIT IS MEASURED AND DELIBERATELY NOT BLOCKING. It
 * catches the case this gate cannot — a surface die-cut in BOTH bands, where
 * the difference is zero — and on 848be1c6 it separates just as cleanly (hood
 * 0.183 below its band's median, every sibling within 0.008). It is left as a
 * receipt because no fixture yet proves it will not convict a design that is
 * genuinely lighter on one panel, and this file's own zone gate is the
 * precedent: built, measured, non-blocking until a discriminator exists. Do
 * not promote it without one.
 *
 * IT IS THE COMPLEMENT OF `atlas-proof-diecut.cjs`, NOT A DUPLICATE. That file
 * convicts an INTERIOR die-cut -- a window or wheel arch of page colour
 * ENCLOSED by artwork -- and by its own definition page colour that can walk to
 * the band's border is "the margin between panels", so a panel trimmed to its
 * body-panel OUTLINE is invisible to it. This gate is the outer-boundary half.
 * (`detectDieCut` is also, as of this writing, wired to nothing; giving it a
 * consumer is its own decision with its own false-positive story -- a
 * white-filled logo counter is an enclosed page shape -- and is not made here.)
 *
 * SHEET PATH ONLY. On the derived path Zone 1 is composited by code and the
 * supplied Zone 2 panels carry a hardcoded `fit: 1`, so the comparison would
 * convict every legacy revision. The caller runs this only when six Zone 1
 * cells came off the sheet.
 */
const DIE_CUT_CONTRACT = "designpro.atlas-proof-die-cut-gate.v1";
const MAX_BAND_FIT_DROP = 0.06;
const SURFACE_FIT_DEFICIT_NOTICE = 0.12;

function median(values) {
  const sorted = values.filter((n) => Number.isFinite(n)).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * ⛔ `Number(null)` IS `0`, AND `Number.isFinite(0)` IS TRUE. A coercing read
 * here turns a cell nobody measured into a cell measured as COMPLETELY EMPTY,
 * and this gate would then convict it — refusing a sheet for a fault in a
 * different instrument. CLAUDE.md records the same coercion printing a
 * fabricated `0" wide` on a Zone 3 slot that has no inches by contract. `fit`
 * is produced by `inkFraction` as a number; anything else is absence.
 */
const fitOf = (panel) => {
  const raw = panel?.fit;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
};

/**
 * The arithmetic half: pure, no pixels, no sharp. `candidates` are surfaces
 * whose branded band lost ink against their own clean twin; `dieCutFindings`
 * below is what decides whether that loss is a die-cut.
 *
 * @returns {{contract, candidates: Array, notices: Array, surfaces: Array}}
 */
function bandFitFindings(zone1, zone2) {
  const clean = new Map((zone2 || []).map((panel) => [panel.surfaceKey, panel]));
  const brandedFits = (zone1 || []).map(fitOf).filter((n) => n !== null);
  const cleanFits = (zone2 || []).map(fitOf).filter((n) => n !== null);
  const brandedMedian = median(brandedFits);
  const cleanMedian = median(cleanFits);
  const candidates = [];
  const notices = [];
  const surfaces = [];
  for (const panel of zone1 || []) {
    const brandedFit = fitOf(panel);
    const twin = clean.get(panel.surfaceKey);
    const cleanFit = fitOf(twin);
    // A cell neither band could measure is a different failure and the
    // positional-premise check above already owns it.
    if (brandedFit === null || cleanFit === null) continue;
    const bandDrop = Number((cleanFit - brandedFit).toFixed(4));
    const brandedDeficit = brandedMedian === null ? null : Number((brandedMedian - brandedFit).toFixed(4));
    const cleanDeficit = cleanMedian === null ? null : Number((cleanMedian - cleanFit).toFixed(4));
    surfaces.push({ surfaceKey: panel.surfaceKey, brandedFit, cleanFit, bandDrop, brandedDeficit, cleanDeficit });
    if (bandDrop > MAX_BAND_FIT_DROP) {
      candidates.push({
        surfaceKey: panel.surfaceKey, brandedFit, cleanFit, bandDrop,
        finding: `${panel.surfaceKey}: the branded panel covers ${(brandedFit * 100).toFixed(1)}% of its cell `
          + `against ${(cleanFit * 100).toFixed(1)}% on the same surface without type — `
          + `${(bandDrop * 100).toFixed(1)}% of the artwork is page, so the panel was drawn cut to shape`,
      });
    }
    // Both bands short of their own band's median: a die-cut the comparison
    // above cannot see, because it is present in Zone 1 AND Zone 2.
    if (brandedDeficit !== null && cleanDeficit !== null
      && brandedDeficit > SURFACE_FIT_DEFICIT_NOTICE && cleanDeficit > SURFACE_FIT_DEFICIT_NOTICE) {
      notices.push({
        surfaceKey: panel.surfaceKey, brandedDeficit, cleanDeficit,
        finding: `${panel.surfaceKey}: both bands sit below their own median fit `
          + `(branded -${brandedDeficit.toFixed(4)}, clean -${cleanDeficit.toFixed(4)})`,
      });
    }
  }
  return { contract: DIE_CUT_CONTRACT, candidates, notices, surfaces,
    brandedMedianFit: brandedMedian, cleanMedianFit: cleanMedian,
    maxBandFitDrop: MAX_BAND_FIT_DROP, surfaceFitDeficitNotice: SURFACE_FIT_DEFICIT_NOTICE };
}

/**
 * ⛔ THE CONFIRMATION: A DIE-CUT LOSES THE CORNERS. AN INTERIOR WHITE ELEMENT
 * DOES NOT.
 *
 * The band comparison above is sound about ink and silent about WHERE the ink
 * went, and that gap has a real innocent case: a white banner behind lettering
 * is page colour by `inkFraction`'s reckoning (>= 246 on every channel), it
 * exists only in the branded band because the clean band has no type to sit
 * behind — and a banner covering 15% of a cell at 20% text coverage produces a
 * 0.12 band drop, twice MAX_BAND_FIT_DROP. That design is correct and this gate
 * would have refused it.
 *
 * A panel trimmed to a body-panel outline is a different shape entirely: the
 * outline is convex-ish and centred, so the page colour is the SURROUND, and
 * the surround always takes the four corners. A banner, a knocked-out wordmark
 * and a white sky never do — the CORE PRINT RULE has the artwork filling the
 * cell corner to corner, so on any correct panel the corners are artwork.
 *
 * So a candidate is convicted only when its corners are page as well. The
 * measurement runs on convicted candidates alone, which on a clean sheet is
 * none of them: this costs nothing on a good run and four small extracts on a
 * bad one.
 *
 * `MIN_CORNER_PAGE_FRACTION` is 0.5 — a die-cut's corners read at or near 1.0
 * and a filled panel's at or near 0, so the threshold sits in the middle of an
 * empty gap rather than being tuned against either.
 */
const CORNER_BOX = 0.12;
const MIN_CORNER_PAGE_FRACTION = 0.5;

/** Share of the four corner boxes that is page colour, by `inkFraction`'s own predicate. */
async function cornerPageFraction(sharp, bytes) {
  const meta = await sharp(bytes).metadata();
  const w = Number(meta.width) || 0;
  const h = Number(meta.height) || 0;
  if (w < 8 || h < 8) return null;
  const bw = Math.max(2, Math.round(w * CORNER_BOX));
  const bh = Math.max(2, Math.round(h * CORNER_BOX));
  const boxes = [
    { left: 0, top: 0 }, { left: w - bw, top: 0 },
    { left: 0, top: h - bh }, { left: w - bw, top: h - bh },
  ];
  let page = 0;
  let total = 0;
  for (const box of boxes) {
    const { data, info } = await sharp(bytes)
      .extract({ left: box.left, top: box.top, width: bw, height: bh })
      .removeAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += info.channels) {
      total += 1;
      // The SAME predicate `inkFraction` uses, inverted. Two definitions of
      // "page" between the measurement and its confirmation is how a gate
      // convicts on one rule and clears on another.
      if (data[i] >= 246 && (data[i + 1] ?? data[i]) >= 246 && (data[i + 2] ?? data[i]) >= 246) page += 1;
    }
  }
  return total ? Number((page / total).toFixed(4)) : null;
}

/**
 * @returns {{contract, convicted, candidates, notices, surfaces, ...}} —
 *   `convicted` is empty on a clean sheet. Nothing here throws: the caller owns
 *   the refusal so the sheet identity rides with it. A corner measurement that
 *   cannot be taken CLEARS the candidate rather than convicting it — an
 *   unmeasurable panel is a different fault and the checks above own it.
 */
async function dieCutFindings(zone1, zone2, { sharp = require("sharp") } = {}) {
  const bands = bandFitFindings(zone1, zone2);
  const bytesOf = new Map((zone1 || []).map((panel) => [panel.surfaceKey, panel?.bytes]));
  const convicted = [];
  const cleared = [];
  for (const candidate of bands.candidates) {
    const bytes = bytesOf.get(candidate.surfaceKey);
    let corners = null;
    if (bytes?.length) {
      try { corners = await cornerPageFraction(sharp, bytes); } catch { corners = null; }
    }
    if (corners !== null && corners >= MIN_CORNER_PAGE_FRACTION) {
      convicted.push({ ...candidate, cornerPageFraction: corners });
    } else {
      cleared.push({
        ...candidate, cornerPageFraction: corners,
        clearedBecause: corners === null
          ? "the corners could not be measured"
          : `the cell's corners carry artwork (${(corners * 100).toFixed(1)}% page), so the lost ink is inside the panel and not a trimmed outline`,
      });
    }
  }
  return { ...bands, convicted, cleared, minCornerPageFraction: MIN_CORNER_PAGE_FRACTION };
}

const MAX_PANEL_ASPECT_DRIFT = 1.05;

/**
 * No vehicle panel is this long. The largest surface this catalog carries is a
 * 251" flank, so 400 leaves room for anything real while convicting a pixel
 * rectangle read as inches — the defect `panelRowsFromManifest` shipped, where
 * the driver arrived as 979" x 2674".
 */
const MAX_PLAUSIBLE_PANEL_INCHES = 400;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** A creative refusal. Typed so flat-first-atlas can tell it from a fault. */
class PanelProofRefusal extends Error {
  constructor(reason, details = {}) {
    super(`panel proof refused: ${reason}`);
    this.code = "flat_atlas_panel_proof_refused";
    this.reason = reason;
    this.details = details;
  }
}

/**
 * `off` is the ONLY value that disables it, and a typo therefore fails to the
 * SAFE side — which for a routing that is not yet proven on a real customer
 * generation means OFF. That is the opposite default from `atlas_field_first`,
 * deliberately: field-first was adopted on 52 measured failures, and this has
 * four probe sheets. Turning it on is a deploy input, not an omission.
 */
function panelProofEnabled(env = process.env) {
  return String(env.DESIGNPRO_ATLAS_PANEL_PROOF || "").trim().toLowerCase() === "on";
}

/** GENIE trim rows in the contract's own wording. Inches, never fractions. */
/**
 * THE SIX PANEL ROWS, IN REAL INCHES, FROM THE FIELDS THAT ACTUALLY EXIST.
 *
 * ⚠️ THIS EMITTED PIXELS LABELLED AS INCHES, TRANSPOSED, ON EVERY REAL RUN.
 *
 * It read `zone.trimInches || zone.trim`. **`trimInches` does not exist on a
 * GENIE zone** -- the real fields are `trimWidthIn`/`trimHeightIn` and
 * `printWidthIn`/`printHeightIn` -- so every call fell through to `zone.trim`,
 * which is the PIXEL rectangle of the surface on the 4096 master. Measured on
 * the ordinary six-surface manifest:
 *
 *     emitted   DRIVER: 979" wide x 2674" high     <- pixels, and portrait
 *     real      DRIVER: 163" wide x  66" high      <- print inches, landscape
 *
 * The flank is a tall rotated column on the master, so the numbers were not
 * merely in the wrong unit: they were the wrong way round. Three consequences,
 * all of which were live:
 *
 *   1. the prompt told the model the driver panel was 81 FEET TALL and portrait,
 *      so the sheet it drew was answering a different question;
 *   2. the container template draws its cells from these same rows, so the
 *      driver cell came out at 1.160:1 against a true 2.470:1 -- and, being
 *      clamped to the band height, could not have been right at any scale;
 *   3. `fit: "fill"` in the assembler then stretched that cell into the true
 *      zone, so EVERY driver and passenger panel this route produced was
 *      horizontally stretched by a factor of about 2.1.
 *
 * The probe never saw it because the probe PASSES its own `panels` input by
 * hand, already correct. Production derives them here. A fixture laxer than the
 * real thing, for the sixth time in this repo.
 *
 * ═══ WHY PRINT INCHES AND NOT TRIM ═══
 *
 * The rectangle the model fills, the cutter cuts and `assembleFinishedMaster`
 * places is the FULL zone -- trim plus the 5" bleed on all four sides -- and
 * measured on every surface `printWidthIn/printHeightIn` reproduces that zone's
 * aspect exactly (driver 2.470 = 2.470, hood 1.235 = 1.235, and so on). Stating
 * trim instead would leave the cell ~5% off its zone AND describe a rectangle
 * with no bleed in it, which is the artwork the installer wraps around the edge.
 * Trim stays in the copy as a callout; the GEOMETRY is the print rectangle.
 *
 * IT REFUSES RATHER THAN FALLS BACK. A fallback is what produced the defect: a
 * missing field silently became a pixel rectangle that every consumer believed.
 */
function panelRowsFromManifest(manifest) {
  const zones = Array.isArray(manifest?.zones) ? manifest.zones : [];
  return zones.map((zone) => {
    const name = String(zone?.surfaceKey || "").toUpperCase();
    // The print rectangle, or trim plus its own bleed when a manifest states
    // only trim. Never `zone.trim`, which is pixels.
    const bleed = zone?.bleedIn || {};
    const trimW = Number(zone?.trimWidthIn);
    const trimH = Number(zone?.trimHeightIn);
    const w = Number.isFinite(Number(zone?.printWidthIn)) ? Number(zone.printWidthIn)
      : (Number.isFinite(trimW) ? trimW + Number(bleed.left || 0) + Number(bleed.right || 0) : NaN);
    const h = Number.isFinite(Number(zone?.printHeightIn)) ? Number(zone.printHeightIn)
      : (Number.isFinite(trimH) ? trimH + Number(bleed.top || 0) + Number(bleed.bottom || 0) : NaN);
    if (!name || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      throw new PanelProofRefusal(
        `${name || "a surface"} has no usable print dimensions `
        + `(printWidthIn/printHeightIn or trimWidthIn/trimHeightIn + bleedIn)`);
    }
    // A PLAUSIBILITY FLOOR, because this is the exact defect class that shipped:
    // no vehicle panel is a thousand inches. A pixel rectangle read as inches
    // trips this immediately instead of reaching the prompt.
    if (w > MAX_PLAUSIBLE_PANEL_INCHES || h > MAX_PLAUSIBLE_PANEL_INCHES) {
      throw new PanelProofRefusal(
        `${name}: ${w}" x ${h}" is not a vehicle panel — these look like pixels, not inches`);
    }
    return `${name}: ${round1(w)}" wide x ${round1(h)}" high`;
  });
}

/**
 * THE SAME SIX ROWS AT **TRIM** SIZE — the dimension the sheet must PRINT.
 *
 * `panelRowsFromManifest` states the PRINT rectangle because that is the shape
 * the model fills and the cutter cuts; its own header explains why, and it does
 * not change. But the document's callouts and its PANEL DIMENSIONS REFERENCE
 * table are labelled TRIM, and the edge draws its container from
 * `parsePanelRows(panelRows)` with no other dimension source — so it read those
 * print numbers as trim and added the 5" bleed a second time. A 222.5 x 53
 * driver printed as `242.5" W x 73.0" H (TRIM: 232.5" x 63.0")`: both numbers
 * wrong, on the sheet the designer is shown.
 *
 * So the trim inches travel beside the print inches and the edge labels from
 * these. Absent (an older caller), the edge falls back to exactly today's
 * behaviour, so this can never make a request fail.
 */
function panelTrimRowsFromManifest(manifest) {
  const zones = Array.isArray(manifest?.zones) ? manifest.zones : [];
  const rows = [];
  for (const zone of zones) {
    const name = String(zone?.surfaceKey || "").toUpperCase();
    const bleed = zone?.bleedIn || {};
    const printW = Number(zone?.printWidthIn);
    const printH = Number(zone?.printHeightIn);
    const w = Number.isFinite(Number(zone?.trimWidthIn)) ? Number(zone.trimWidthIn)
      : (Number.isFinite(printW) ? printW - Number(bleed.left || 0) - Number(bleed.right || 0) : NaN);
    const h = Number.isFinite(Number(zone?.trimHeightIn)) ? Number(zone.trimHeightIn)
      : (Number.isFinite(printH) ? printH - Number(bleed.top || 0) - Number(bleed.bottom || 0) : NaN);
    // A MISSING TRIM IS NOT A REFUSAL. The print rows already refused on a
    // manifest with no usable dimensions; this is a labelling detail, and
    // losing the whole design over a label is the blast radius this file
    // warns about in four other places.
    if (!name || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return [];
    if (w > MAX_PLAUSIBLE_PANEL_INCHES || h > MAX_PLAUSIBLE_PANEL_INCHES) return [];
    rows.push(`${name}: ${round1(w)}" wide x ${round1(h)}" high`);
  }
  return rows.length === zones.length ? rows : [];
}

/** One decimal, and no trailing ".0" — the owner's own spec-sheet form. */
function round1(value) {
  return String(Math.round(Number(value) * 10) / 10);
}

/**
 * NODE 1 — the sheet. ONE image call, through the dedicated edge function.
 *
 * The edge is `production-panel-proof`, which is its own Call-1 endpoint and
 * cannot reach `design-panel-ai-generate` at all — so production's other
 * topologies keep calling the one endpoint they always called (RULE 0.26) no
 * matter what this one returns.
 */
/**
 * THE CUSTOMER'S OWN ASSETS, STAGED AS REFERENCES RATHER THAN INLINED.
 *
 * Their absence was this route's worst defect: `requestProofSheet` forwarded
 * text and vehicle fields only, so a customer who uploaded a logo or a
 * reference photo received a design that never saw either, while the
 * six-surface and field contracts carried both. RULE 0.24 calls those CREATIVE
 * authority -- artwork authority under `exact_reference` -- and nothing
 * downstream can detect that they were dropped.
 *
 * THEY ARE NOT SENT AS BASE64, DELIBERATELY. The obvious fix is to copy
 * `edgeExtras.referenceImagesBase64`, and this edge's own header records why
 * that is the wrong door: it "already died twice on a bodiless 504 from a
 * 2.2 MB base64 request". A customer logo is conditioned to 1600px and a
 * VisionBoard set can be several images, so inlining them walks straight back
 * into a failure mode this function has already suffered.
 *
 * So each asset is written to `atlas-call1-inputs/<sha256>.png` -- the one shape
 * `attach()` admits -- and crosses as `{storagePath, contentHash, byteSize}`
 * (RULE 0.39). The edge then re-reads and hash-verifies each one itself, so the
 * runtime cannot name bytes the far side did not check. `CALL1_INPUT_PATH` is
 * asserted here too, so a path the edge would refuse never leaves (the 2099d17d
 * lesson, applied before it costs a run).
 *
 * VERIFICATION IS NOT REPEATED HERE. `verifiedCustomerLogoPart` and
 * `verifiedCustomerReferenceParts` already refused a URL, re-downloaded the
 * bytes and re-checked length and sha256 against the request identity; these
 * parts arrive from that. Re-implementing those checks would be the second
 * ownership path RULE 1 exists to prevent.
 */
async function stageCustomerAssets({ store, customerImageParts = [], logger = () => {} }) {
  const inline = (Array.isArray(customerImageParts) ? customerImageParts : [])
    .filter((part) => typeof part?.inlineData?.data === "string" && part.inlineData.data.length);
  if (!inline.length) return [];
  if (typeof store?.putImmutableBytes !== "function") {
    /**
     * AN EMPTY ARRAY HERE MEANT "THE CUSTOMER UPLOADED NOTHING", AND IT WAS
     * ALSO WHAT A DROP LOOKED LIKE.
     *
     * The receipt records `customerAssets: []` and its own comment says an
     * empty array is "a real answer (the customer uploaded nothing)". When the
     * customer DID upload and staging could not run, this returned exactly that
     * answer -- so the photo and the logo left the pipeline and every surface
     * downstream reported a design that had simply never been given any
     * references. RULE 0.24 calls those CREATIVE authority, and nothing
     * downstream can detect that they were dropped.
     *
     * So a staging path that cannot carry assets the customer actually supplied
     * refuses instead. The absent-store case with nothing to stage is unchanged
     * and still returns `[]` one line above, which is the only honest `[]`.
     */
    logger(`atlas call 1: ${inline.length} customer asset(s) cannot be staged (no store)`);
    throw new PanelProofRefusal(
      `${inline.length} customer asset(s) supplied and no artifact store to stage them`);
  }
  const staged = [];
  for (const part of inline) {
    const bytes = Buffer.from(part.inlineData.data, "base64");
    if (!bytes.length) continue;
    // PNG in, PNG out: these parts are already conditioned PNG (the logo is
    // resized and re-encoded by `verifiedCustomerLogoPart`), so the filename
    // hash is the hash of exactly what is written.
    const digest = sha256(bytes);
    const storagePath = `atlas-call1-inputs/${digest}.png`;
    if (!CALL1_INPUT_PATH.test(storagePath)) {
      throw new PanelProofRefusal(`customer asset path the edge would refuse: ${storagePath}`);
    }
    staged.push(await store.putImmutableBytes({ storagePath, bytes, contentType: "image/png" }));
  }
  logger(`atlas call 1: staged ${staged.length} customer asset(s) for the proof`);
  return staged;
}

/**
 * THE REVISION, AS THE EDGE MUST SEE IT (owner, 2026-09-22: "Revisions should
 * auto generate edits directly to panel pro production proof").
 *
 * A revision is the SAME three-zone request plus two things: the parent's
 * accepted proof sheet as a reference (staged under the edge's own
 * `atlas-call1-inputs/<sha>.png` allowlist, crossing as an identity, RULE 0.39)
 * and the customer's instruction. The instruction is folded into the brief the
 * model reads AND carried as its own field, so an edge that has not learned the
 * field yet still receives the words, and an edge that has can frame them.
 *
 * `revision` is `{ sequence, parentRevisionId, contextHash, instruction,
 * affectedSurfaces, parentProof: {storagePath, contentHash, byteSize} }` or
 * null on a first generation.
 */
function revisionRequestFields(revision, brief) {
  const sequence = Number(revision?.sequence || 1);
  if (!revision || sequence <= 1) return { customerPrompt: brief, revisionSequence: 1 };
  const instruction = String(revision.instruction || "").trim();
  return {
    customerPrompt: instruction
      ? `${brief}\n\nREVISION V${sequence} — apply this change to the approved parent production proof, keeping everything else exactly as approved: ${instruction}`
      : brief,
    revisionSequence: sequence,
    parentAtlasRevisionId: revision.parentRevisionId || null,
    revisionContextHash: revision.contextHash || null,
    revisionInstruction: instruction || null,
    affectedSurfaces: Array.isArray(revision.affectedSurfaces) ? [...revision.affectedSurfaces] : [],
    parentProof: revision.parentProof?.storagePath && revision.parentProof?.contentHash
      ? {
          storagePath: revision.parentProof.storagePath,
          contentHash: revision.parentProof.contentHash,
          byteSize: Number(revision.parentProof.byteSize || 0) || null,
          role: "parent-production-proof",
        }
      : null,
  };
}

async function requestProofSheet({
  manifest, input, providerRequest, callProofEdge, store, customerImageParts, logger,
  // See `revisionRequestFields`. Null on a first generation.
  revision = null,
  // THE CANDIDATE INDEX. The bounded re-roll (two candidates, then terminal)
  // needs each candidate to be its own durable operation, or the second is a
  // cache read of the first: the provider cache keys on attemptKey, and the
  // graph keys its run on the definition this rides in.
  candidate = 1,
}) {
  const panelRows = panelRowsFromManifest(manifest);
  if (panelRows.length !== 6) {
    throw new PanelProofRefusal(`manifest yielded ${panelRows.length}/6 panel rows`);
  }
  const vehicle = input?.vehicle || {};
  const customerAssets = await stageCustomerAssets({ store, customerImageParts, logger });
  const revisionFields = revisionRequestFields(revision, input?.brief || input?.prompt || "");
  const sheet = await callProofEdge({
    // Verified VisionBoard references, by identity. Protected Zone-3 originals
    // are retained by the compositor, outside this image-generation request.
    customerAssets,
    // ⛔ `separatedArtwork: true` USED TO SIT HERE, AND IT WAS THE WHOLE DEFECT.
    //
    // Owner, 2026-09-22: "It gets the production panel template with vehicle
    // make and model info including dimension of rectangle panels and it takes
    // customer prompt and designs a cohesive set of 6 wrap panels using our
    // persona based edge functions, and is shown the ridgeline pools 3 zone
    // proof so it does the same — it creates the zone 1, 2, and 3 all at one
    // time."
    //
    // That one field made the edge do the opposite of all of it. Measured in
    // `production-panel-proof/index.ts`:
    //
    //   :640-660  the three-zone prompt is assembled at :621 and DISCARDED;
    //             the substitute asks for "six clean printed background
    //             artworks" — Zone 2 alone, no lettering, no logo, no bands.
    //   :643-648  every A.C.E. line containing no/not/never/without/don't is
    //             stripped out, which is most of the designer's own rules.
    //   :773      the hash-pinned Ridgeline gold sheet is NOT attached.
    //   :717-728  the container is drawn `mode: "artwork"` — six plain grey
    //             rectangles, no vehicle, no dimensions, no captions.
    //   :972      the anchored conversation is forced off.
    //   :1090     a second paid image request runs for the logo.
    //
    // Then the assembler re-manufactured Zone 1 from those unlettered
    // backgrounds plus a typeset lockup. Gradients, generic type, two logos.
    //
    // Omitting it selects the path that was built for this and has never been
    // reachable by a customer: A.C.E. intact, the Ridgeline sheet attached, the
    // per-vehicle dimensioned template attached, all three zones asked for in
    // one pass. Do not restore it. It is `91d0b8e`'s decision, reversed.
    hasCustomerLogo: Boolean(input?.logoAsset),
    generateLogo: input?.generateLogo,
    // The customer's own words. The edge's intake node parses vehicle, contact
    // and brand out of them; a field set here is a field intake never had to
    // find, and the raw text is what production actually carries. On a
    // revision the instruction is folded in after the brief (see above).
    ...revisionFields,
    // THE CUSTOMER'S MODE selects the persona: commercial (the sign-and-wrap
    // designer) or restyle (the Lead Vehicle Wrap Designer). The edge read a
    // literal "commercial" until 2026-09-22; the app has always sent this.
    mode: String(input?.mode || "").toLowerCase() === "restyle" ? "restyle" : "commercial",
    companyName: input?.companyName || input?.businessName || "",
    tagline: input?.tagline || "",
    phone: input?.phone || "",
    website: input?.website || "",
    services: input?.services || input?.bulletPoints || [],
    promo: input?.promo || input?.promotionalText || "",
    finish: input?.finish || "Gloss",
    brandColors: String(input?.brandColors || "").trim()
      || (Array.isArray(input?.colors) ? input.colors.map(String).filter(Boolean).join(", ") : String(input?.colors || "").trim()),
    style: String(input?.style || "").trim(),
    fontStyle: String(input?.fontStyle || "").trim(),
    industryType: String(input?.industryType || input?.industry || "").trim(),
    styleDescriptors: String(input?.styleDescriptors || "").trim(),
    visionboard_intent: ["exact_reference", "artboard_projection"].includes(String(input?.visionboardIntent || "").trim())
      ? "exact_reference" : "style_inspiration",
    vehicleYear: vehicle.year || null,
    vehicleMake: vehicle.make || null,
    vehicleModel: vehicle.model || null,
    vehicleType: vehicle.type || vehicle.vehicleClass || null,
    panelRows,
    // The TRIM inches, so the document's callouts and its reference table say
    // what the panel actually prints. See `panelTrimRowsFromManifest`.
    panelTrimRows: panelTrimRowsFromManifest(manifest),
    // ONE CALL, NOT TWO. The owner's contract is one pass that draws all three
    // zones; the two-turn design-then-layout conversation is a second paid
    // image request and put Call 1 at 115 s. It stays in the edge and is one
    // field away, so a side-by-side costs nothing.
    anchorTurns: false,
    // THE OPERATION IDENTITY, STABLE ACROSS A RECOVERY.
    //
    // The edge now runs its image request through the durable provider module,
    // which keys the claim on {ownerId, requestId, generationId, mode,
    // attemptKey}. A re-claimed worker sending the same identity reads its own
    // earlier request instead of buying the sheet twice. Before this, the edge
    // minted a fresh uuid per invocation and `cacheOnly` could not mean anything.
    //
    // It was the literal "panel-proof:1", which made a re-roll a no-op: the
    // second candidate read the first's bytes back. The revision sequence and
    // the candidate index are in the key now, so V2 never reads V1's sheet and
    // candidate 2 never reads candidate 1's.
    attemptKey: `panel-proof:${revisionFields.revisionSequence}:${Math.max(1, Number(candidate) || 1)}`,
    ...providerRequest,
  });
  if (!sheet?.bytes) throw new PanelProofRefusal("the proof edge returned no sheet");
  return { sheet, panelRows, customerAssets };
}

/**
 * THE BLANK CONTAINER, DRAWN HERE AND STAGED WHERE THE EDGE CAN ATTACH IT.
 *
 * The edge draws its own container first and only falls back to a caller-staged
 * one (`containerSource.origin: "caller"`), so this is INSURANCE, not the
 * primary path — and it is worth having: without it a studio render that throws
 * on the edge answers `panel_proof_container_unavailable` and costs the whole
 * Call 1, where with it the same failure costs nothing and says so on the
 * receipt. The bytes are deterministic and content-addressed, so a second
 * generation on the same vehicle re-uploads nothing.
 *
 * It stages a PNG at `atlas-call1-inputs/<sha256>.png` because that is the one
 * shape the edge admits, and the regex above is checked HERE so a path the far
 * side would refuse never leaves.
 */
async function stageProofContainer({ supabase, manifest, companyName, vehicle, logger = () => {} }) {
  const bytes = await renderContainerTemplate({ manifest, companyName, vehicle, bleedInches: 5 });
  const digest = sha256(bytes);
  const storagePath = `atlas-call1-inputs/${digest}.png`;
  if (!CALL1_INPUT_PATH.test(storagePath)) {
    throw new PanelProofRefusal(`container path the edge would refuse: ${storagePath}`);
  }
  const { data } = await supabase.storage.from(BUCKET).download(storagePath);
  if (!data) {
    const { error } = await supabase.storage.from(BUCKET)
      .upload(storagePath, bytes, { contentType: "image/png", upsert: false });
    if (error && !/exists/i.test(String(error.message || error))) {
      throw new PanelProofRefusal(`container staging failed: ${String(error.message || error).slice(0, 200)}`);
    }
  }
  logger(`atlas call 1: container staged ${digest.slice(0, 12)} (${bytes.length} B)`);
  return { containerStoragePath: storagePath, containerContentHash: digest, containerByteSize: bytes.length };
}

/**
 * The transport, as the pass consumes it: stage the container, one POST to the
 * dedicated edge, then a HASH-VERIFIED download of the sheet it stored.
 *
 * The sheet crosses this boundary as an IDENTITY first — the edge answers
 * `{proofStoragePath, proofSha256, proofByteSize}` and never base64 — which is
 * RULE 0.39, and the download is verified against both halves of that identity
 * for the same reason `downloadVerified` is: a swapped object and a caller whose
 * claim does not match what it wrote are two different failures.
 */
function createPanelProofTransport({
  supabase, ownerId = null, fetchImpl = fetch, logger = () => {},
} = {}) {
  if (!supabase) throw new PanelProofRefusal("the panel-proof transport requires Supabase");
  // THE OWNER ARRIVES PER CALL, NOT ONLY AT CONSTRUCTION — the same shape
  // `createAtlasAuthorTransport` already uses, and for the same reason. Both
  // runtime processes build ONE transport at start-up and then serve panel-proof
  // nodes of ANY customer's run, so a construction-time owner would send an
  // EMPTY `x-designpro-owner-id` for every graph-claimed node. The edge fails
  // that closed with 403 (`production_panel_proof_internal_only`) rather than
  // proceeding, which is correct — but it would have made every durable
  // panel-proof run fail, and the owner id is also the provider cache's own
  // isolation key, so getting it from the claimed run is the whole point.
  return async (body, { ownerId: callOwnerId = ownerId } = {}) => {
    const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
    const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
    if (!supabaseUrl || serviceRoleKey.length < 32) {
      throw new PanelProofRefusal("SUPABASE_URL / service key are required for the proof edge");
    }
    const staged = await stageProofContainer({
      supabase, manifest: parsePanelRows(body.panelRows),
      companyName: body.companyName || "", logger,
      vehicle: [body.vehicleYear, body.vehicleMake, body.vehicleModel]
        .map((v) => String(v || "").trim()).filter(Boolean).join(" "),
    });
    const response = await fetchImpl(`${supabaseUrl}/functions/v1/${PROOF_EDGE_FUNCTION}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "content-type": "application/json",
        "x-designpro-owner-id": String(callOwnerId || ""),
      },
      body: JSON.stringify({ ...body, ...staged }),
    });
    const payload = await response.json().catch(() => ({ error: "unparseable response" }));
    if (!response.ok || payload?.success !== true) {
      throw new PanelProofRefusal(
        `${PROOF_EDGE_FUNCTION} failed (HTTP ${response.status}): ${String(payload?.error || "no body").slice(0, 300)}`,
        { status: response.status });
    }
    const { data, error } = await supabase.storage.from(BUCKET).download(payload.proofStoragePath);
    if (error || !data) {
      throw new PanelProofRefusal(`the proof sheet could not be read: ${payload.proofStoragePath}`);
    }
    const bytes = Buffer.from(await data.arrayBuffer());
    if (bytes.length !== Number(payload.proofByteSize) || sha256(bytes) !== payload.proofSha256) {
      throw new PanelProofRefusal(`${payload.proofStoragePath} does not match the identity the edge returned`);
    }
    return {
      bytes,
      contentHash: payload.proofSha256,
      storagePath: payload.proofStoragePath,
      byteSize: bytes.length,
      model: payload.model || null,
      contract: payload.contract || null,
      promptChars: Number(payload.promptChars || 0),
      sheetShape: payload.sheetShape || null,
      intake: payload.intake || null,
      // The designer's own DESIGN ANCHOR text, for the photographer (Call 2),
      // and which persona ran. Both are receipts of what the edge did.
      designAnchor: typeof payload.designAnchor === "string" && payload.designAnchor.trim()
        ? payload.designAnchor.trim() : null,
      mode: payload.mode === "restyle" ? "restyle" : (payload.mode === "commercial" ? "commercial" : null),
      generatedElements: payload.generatedElements || [],
      imageRequestCount: Number(payload.imageRequestCount || 1),
      containerSource: (payload.attachedInputs || []).find((a) => a?.role === "container") || null,
      // What Call 1 was SHOWN as a quality standard. Read from the edge rather
      // than assumed: `designPanelArtboardQualityExamplesApplied` was a
      // hardcoded 0 on the revision for weeks, so "did the designer see a gold
      // standard" was unanswerable from any run.
      artboardQualityExamplesApplied: Number(payload.artboardQualityExamplesApplied || 0),
      artboardQualityExampleIdentities: Array.isArray(payload.artboardQualityExampleIdentities)
        ? payload.artboardQualityExampleIdentities : [],
    };
  };
}

/**
 * THE SECOND HALF: cut → gate → place → assemble → store the siblings.
 *
 * Split out from `authorPanelProofMaster` so the durable graph and the
 * in-process pass execute THE SAME CODE rather than two implementations of it.
 * That is the whole point of the split and the reason it is not a copy: a
 * second producer of the panels is exactly what RULE 0.21 forbids by name, and
 * the drift it produces is what RULE 0.29 spent a session measuring.
 *
 * It takes the sheet as `{ bytes, contentHash, storagePath, byteSize, ... }`.
 * The graph's node reads those bytes back from the sheet's stored IDENTITY and
 * hash-verifies them before calling this (RULE 0.39 across the node boundary);
 * the in-process caller already holds them. Either way this function is handed
 * the same object and cannot tell which path it is on — deliberately, because a
 * function that behaves differently per caller is two functions.
 *
 * `stageTimings` is passed IN so a graph run can carry the sheet node's own
 * timing into the same list the in-process run produces, and the receipt keeps
 * one shape on both paths.
 */
async function assemblePanelProofMaster({
  sheet, panelRows, customerAssets = [], input = {}, downloadAsset, manifest, store, logger = () => {},
  /**
   * The design's own identity, minted at Call 1. Optional here so the probe and
   * the fixtures keep working without one; when present it fills the sheet's
   * ORDER # line. See the job block below for why that line mattered.
   */
  generationId = "",
  /** The revision this sheet belongs to; V1 on a first generation. Fills VERSION. */
  revisionSequence = 1,
  assembleFinishedMaster, sharp = require("sharp"),
  startedAt = Date.now(), stageTimings = [],
  /**
   * ZONE 2 SUPPLIED INSTEAD OF CUT (owner, 2026-09-21: "obviously you maintain
   * Call 1 PanelPro production proof").
   *
   * Read the rest of this function before assuming the model draws the proof:
   * it does not. Only ZONE 2 — the six clean, unlettered backgrounds — ever
   * came out of the sheet. Zone 1 is `compositeProductionPanels`, Zone 3 is
   * original assets and outlined typeset, and the document itself is
   * `renderContainerTemplate`. All three are deterministic code with zero model
   * calls, and all three are exactly what the owner means by the production
   * panel proof.
   *
   * So the proof does not need its own Call 1. It needs six clean backgrounds,
   * and the DesignPanelAI brain already authors those: `cleanBase` asks for a
   * composition with the lettering left off, and `cutCallOnePanels` cuts six
   * panels from the accepted master. Handing them in here keeps the whole
   * three-zone document — and gets it built from the better artwork.
   *
   * This is why the bypass could be killed without losing the proof: they were
   * never the same thing. One is who designs; the other is what is published.
   */
  zone2Panels = null,
  /**
   * STOP AT THE DOCUMENT. DO NOT ASSEMBLE A MASTER.
   *
   * On the derived path the master already exists, is already gated, and is
   * already what every panel and proof cites. Re-assembling one from these
   * composites would put a SECOND master beside it — the exact two-master shape
   * the 2026-08-31 ruling retired and the v28 composite shipped again. Worse,
   * the element graph already composites lettering onto the clean base and
   * promotes it, so a second compositor here is also the second producer
   * RULE 0.21 forbids by name.
   */
  documentOnly = false,
  /**
   * Whether the Zone 2 panels are genuinely lettering-free.
   *
   * True on the panel-proof pass, where the sheet authored a clean band. On the
   * derived path it follows the clean-base element graph: with it off the brain
   * draws the logo and lettering into the artwork, so those panels carry type
   * and Zone 2's bar says so instead of asserting "NO TEXT OR LOGO" over them.
   */
  cleanBaseZone2 = true,
} = {}) {
  const mark = (stage, at) => stageTimings.push({ stage, ms: Date.now() - at });
  if (!sheet?.bytes) throw new PanelProofRefusal("the assemble stage was handed no sheet bytes");

  /**
   * EVERY REFUSAL PAST THIS POINT NAMES THE SHEET IT JUDGED.
   *
   * Live 5772fcd5: the sheet came back, this pass refused it, and the ledger row
   * the caller writes had nothing to point at -- so the verdict existed and the
   * artifact behind it could not be opened. A refusal whose evidence cannot be
   * retrieved is the state the refusal ledger was built to end: judge the gates
   * from the pixels, which requires knowing which pixels.
   *
   * The sheet is already persisted by the edge and hash-verified by the
   * transport, so this carries its IDENTITY (RULE 0.39) and never its bytes.
   */
  const refuse = (reason, extra = {}) => new PanelProofRefusal(reason, {
    ...extra,
    sheet: {
      storagePath: sheet.storagePath || null,
      contentHash: sheet.contentHash || null,
      byteSize: sheet.byteSize || sheet.bytes?.length || null,
      contentType: sheet.sheetShape?.mime || null,
      model: sheet.model || null,
      ...(extra.sheet || {}),
    },
  });

  // ── node 2: the cut. Deterministic, zero model calls. ──────────────────
  const cutAt = Date.now();
  const proofManifest = parsePanelRows(panelRows);
  const cut = zone2Panels
    // SUPPLIED ZONE 2: the six Call-1 panels, already cut from the accepted
    // master. There is nothing to locate — each panel IS its surface by
    // construction, a deterministic `sharp.extract` of a gated master with a
    // recorded `sourceMasterHash`. The positional-premise check below exists to
    // catch a crop of the WRONG region out of a model-drawn sheet; hash lineage
    // to an accepted master is strictly stronger evidence than that, so these
    // arrive already satisfying it rather than bypassing it.
    //
    // The layout's own canvas is the sheet, so `scaleCell` scales by 1 and the
    // document is drawn at the template's native size.
    ? (() => {
        const layout = containerLayout(proofManifest);
        const cells = new Map(layout.zone2.map((cell) => [cell.surfaceKey, cell]));
        const panels = zone2Panels.map((panel) => {
          const cell = cells.get(panel.surfaceKey);
          if (!cell) throw refuse(`${panel.surfaceKey}: no Zone 2 cell in the container layout`);
          if (!panel.bytes?.length) throw refuse(`${panel.surfaceKey}: supplied Zone 2 panel has no bytes`);
          return {
            // ⛔ THE ROLE NAME IS A CONTRACT, NOT A LABEL. Live bug, found
            // 2026-09-21: this said "clean-panel". The canonical name is
            // "clean" -- `runtime/atlas-proof-panels.cjs` QUADRANTS, and the
            // gateway's `PANEL_PROOF_ROLES` accepts only
            // branded | clean | cut-graphic. Anything else makes
            // `validatedPanelProofQuadrantPanel` throw
            // `atlas_panel_proof_response_invalid` with status 502, which
            // `AtlasPanelProofSheet` turns into `return null`.
            //
            // So every DERIVED production panel proof -- the one Call 1
            // composes from the accepted master, the one the owner has been
            // asking to see for a week -- rendered as a silent blank in
            // PanelProStudio, RevisionStudioIQ and the compare studio. The
            // UIs were wired correctly the whole time. "clean-panel" appeared
            // exactly once in the repository.
            ...panel, zone: "zone2", role: QUADRANTS.zone2,
            rect: { left: cell.x, top: cell.y, width: cell.w, height: cell.h },
            byteSize: panel.byteSize ?? panel.bytes.length,
            fit: 1, widthIn: panel.trimWidthIn ?? null, heightIn: panel.trimHeightIn ?? null,
            identity: { surfaceKey: panel.surfaceKey, contentHash: panel.contentHash,
              sourceMasterHash: panel.sourceMasterHash ?? null, source: "call-one-panel" },
            positionalPremiseVerified: true,
          };
        });
        return { panels, sheet: { width: layout.width, height: layout.height }, refused: null };
      })()
    : await cutProofPanels({
      proofBytes: sheet.bytes, manifest: proofManifest,
      // ALL THREE BANDS, AS THE DESIGNER DREW THEM.
      //
      // This read `["zone2"]`, and the two lines above it said Zone 1 was
      // "composed below" and Zone 3 "comes from originals". That was the
      // background-only architecture: the sheet carried three finished bands
      // and the assembler kept one of them.
      //
      // Owner, 2026-09-22: the designer "creates the zone 1, 2, and 3 all at
      // one time" on the template. So all three are read off the sheet it
      // returned. The template cells are GENIE geometry authored BEFORE the
      // request, so Zone 1 and Zone 2 both arrive with
      // `positionalPremiseVerified` and a studio-template identity; nothing
      // here re-detects a rectangle out of generated pixels.
      // Zone 3 is NOT cut here: `sheetDrawnCutGraphic` already reads those five
      // boxes off this same sheet, insets past the template's dashed frame,
      // measures the ink and trims to it. A raw box crop beside it would be a
      // second producer of the same artifact (RULE 0.21) and a worse one.
      zones: ["zone1", "zone2"], sharp,
    });
  if (cut.refused) throw refuse(cut.refused, { cutSheet: cut.sheet });
  mark("panel.cut", cutAt);

  // The designer's own Zone 1, on the sheet path. Empty on the derived path,
  // where there is no sheet to read and the compositor below builds it.
  let zone1 = cut.panels.filter((p) => p.zone === "zone1");
  const zone2 = cut.panels.filter((p) => p.zone === "zone2");
  let zone3 = [];
  if (zone2.length !== 6) {
    throw refuse("the mandatory three-zone proof is incomplete", {
      zones: { branded: zone1.length, backgrounds: zone2.length, graphics: zone3.length },
    });
  }
  if (typeof store?.putImmutableBytes !== "function") {
    throw refuse("the mandatory three-zone proof has no artifact store");
  }
  const persist = async (object) => {
    try { return await store.putImmutableBytes(object); }
    catch (cause) { throw refuse("mandatory proof artifact could not be stored", {cause:String(cause?.message || cause)}); }
  };
  const unverified = zone2.filter((p) => !p.positionalPremiseVerified || !p.identity);
  if (unverified.length) {
    throw refuse(`unverified panel identities: ${unverified.map((p) => `${p.zone}:${p.surfaceKey}`).join(", ")}`);
  }
  // Paint density is a receipt metric about surface IDENTITY, and it is also
  // the one honest measure of whether this cell was drawn cut to shape.
  // `dieCutFindings` uses it only as a comparison between a surface's own two
  // bands; it never reads a fit in isolation. Sheet path only — on the derived
  // path Zone 1 is composited below and has nothing to compare yet.
  let dieCut = null;
  if (zone1.length === 6) {
    dieCut = await dieCutFindings(zone1, zone2, { sharp });
    if (dieCut.convicted.length) {
      throw refuse(
        `the designer drew ${dieCut.convicted.length === 1 ? "a panel" : "panels"} cut to the vehicle's shape `
        + `instead of filling the cell: ${dieCut.convicted.map((item) => item.finding).join("; ")}`,
        { dieCut },
      );
    }
  }

  // Zone 3 comes from original files and outlined typography, NEVER sheet crops.
  const assets = [];
  // ZONE 3 DEGRADES; IT DOES NOT REFUSE (owner, 2026-09-22: "System must not
  // issue fails because of no atlas ... Nothing may block orchestration").
  // Every Zone-3 element this pass declines to carry is named here with its
  // reason, so an empty band is a recorded state and never a silent one. A
  // SUPPLIED logo that cannot be read or hash-verified still refuses below:
  // that is the customer's own file, and shipping without it is a wrong
  // design, not a degraded one.
  const zone3Omitted = [];
  if (input.logoAsset) {
    const identity = verifyLogoIdentity(input.logoAsset);
    if (typeof downloadAsset !== "function") throw refuse("original logo reader missing");
    const bytes = await downloadAsset(identity);
    if (bytes.length !== identity.byteSize || sha256(bytes) !== identity.contentHash) {
      throw refuse("original logo identity mismatch");
    }
    const meta = await sharp(bytes, {density:300,limitInputPixels:40000000}).metadata();
    assets.push({...identity,bytes,role:"logo",width:meta.width,height:meta.height,
      contentType:input.logoAsset.contentType,vector:input.logoAsset.contentType === "image/svg+xml"});
  }
  // Generated marks use the exact same immutable asset in Zones 1 and 3.
  // A supplied logo always wins and is never replaced or regenerated.
  if (!input.logoAsset) {
    const generated = (sheet.generatedElements || []).find(asset => asset.role === "logo");
    if (generated) {
      if (typeof downloadAsset !== "function") throw refuse("generated logo reader missing");
      let bytes = await downloadAsset(generated);
      if (bytes.length !== generated.byteSize || sha256(bytes) !== generated.contentHash) {
        throw refuse("generated logo identity mismatch");
      }
      let asset = generated;
      if (generated.needsChromaKey === true) {
        bytes = await require("./atlas-logo-chroma.cjs").keyGeneratedLogo(bytes);
        const contentHash = sha256(bytes);
        const stored = await persist({storagePath:`atlas-elements/${contentHash}.png`,bytes,contentType:"image/png"});
        asset = {...generated,...stored,contentHash,byteSize:bytes.length,contentType:"image/png",
          needsChromaKey:false,sourceContentHash:generated.contentHash};
      }
      const meta = await sharp(bytes).metadata();
      if (!meta.hasAlpha) {
        // An opaque generated mark cannot be a cut graphic. It is dropped from
        // Zone 3 with its identity on the receipt; the design proceeds.
        zone3Omitted.push({ zone: "zone3", role: "logo", contentHash: asset.contentHash,
          storagePath: asset.storagePath, reason: "generated_logo_has_no_transparent_channel" });
        logger("atlas call 1: generated logo has no transparent channel; Zone 3 carries it as omitted");
      } else {
        assets.push({...asset,bytes,width:meta.width,height:meta.height,vector:false});
      }
    }
  }
  const brand = {...(sheet.intake || {}), ...Object.fromEntries(Object.entries(input).filter(([,v]) => v != null && v !== "" && (!Array.isArray(v) || v.length)))};
  // Explicit customer lettering is production copy even without a company or
  // contact form. Never infer a logo from a generic brand mention.
  const brief = String(input.brief || input.prompt || "");
  const wordmarkMatch = brief.match(/\b(?:feature|include|add|use)\s+(?:the\s+)?["“]?([^.!?\n"”]{1,80}?)["”]?\s+wordmark\b/i);
  const requestedWordmark = wordmarkMatch && !/\b(?:do not|don't|without|no)\s*$/i.test(brief.slice(0, wordmarkMatch.index))
    ? wordmarkMatch[1].trim() : "";
  const raceMatch = brief.match(/\brace\s+(?:number|no\.?)\s*#?\s*(\d{1,3})\b/i);
  const requestedNumber = raceMatch && !/\b(?:without|no|omit)\s*$/i.test(brief.slice(0, raceMatch.index)) ? raceMatch[1] : "";
  const explicitText = [brand.companyName,brand.businessName,brand.tagline,brand.phone,brand.website].filter(Boolean).join(" ");
  const raceNumber = requestedNumber && !new RegExp(`\\b${requestedNumber}\\b`).test(explicitText) ? requestedNumber : "";
  const services = Array.isArray(brand.services) ? brand.services : [];
  const textJobs = [
    {role:"typography",name:brand.companyName || brand.businessName || requestedWordmark,lines:[brand.tagline || ""],raceNumber},
    {role:"contact",name:"",lines:[brand.phone,brand.website,...services,brand.promo].filter(Boolean)},
  ];
  /**
   * ZONE 3 LETTERING IS THE DESIGN'S OWN ON THE SHEET PATH.
   *
   * Owner, 2026-09-22: "it's never supposed to use generic fonts. Ace creates
   * a logo font, uses that throughout." These two jobs typeset the company
   * name and the contact line in a vendored font and claimed the TYPOGRAPHY
   * and CONTACT slots BEFORE `sheetDrawnCutGraphic` could read the marks the
   * designer drew there, so the customer's cut sheet carried lettering in a
   * typeface the design never used while the real lettering sat unread on the
   * sheet. Live 2449ccf8: `typography` and `contact` both `vector: true`.
   *
   * So on the sheet path (`!zone2Panels`) they are not built: every slot the
   * customer's own uploaded logo leaves empty is filled from the sheet. The
   * DERIVED path — a legacy six-surface or field revision with no authored
   * Zone 3 — keeps the typeset originals, because there is no sheet to read.
   */
  const customerTextSupplied = textJobs.some((job) => job.name || job.lines.some(Boolean) || job.raceNumber);
  const zone3LetteringSource = !zone2Panels ? "sheet-drawn" : "typeset";
  for (const job of (zone3LetteringSource === "sheet-drawn" ? [] : textJobs)) {
    if (!job.name && !job.lines.some(Boolean) && !job.raceNumber) continue;
    let rendered = job.name || job.lines.some(Boolean)
      ? await typeset.renderLockup({...job,width:1600}) : {svg:"",width:1600,height:0};
    if (job.raceNumber) {
      const number = await typeset.renderLockup({name:job.raceNumber,width:420,color:"#000000"});
      const roundel = /\broundels?\b/i.test(brief);
      const top = rendered.height;
      const height = top + (roundel ? 480 : number.height + 40);
      const inner = (svg) => svg.replace(/^.*?<svg[^>]*>/s, "").replace(/<\/svg>\s*$/, "");
      const centerY = top + (height-top)/2;
      rendered = {width:1600,height,svg:`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="${height}" viewBox="0 0 1600 ${height}">${inner(rendered.svg)}${roundel ? `<circle cx="800" cy="${centerY}" r="220" fill="#ffffff"/>` : ""}<g transform="translate(590 ${centerY-number.height/2})">${inner(number.svg)}</g></svg>`};
    }
    const bytes = Buffer.from(rendered.svg);
    const stored = await persist({storagePath:typeset.elementStoragePath(sha256(bytes),"svg"),
      bytes,contentType:"image/svg+xml"});
    assets.push({...stored,bytes,byteSize:bytes.length,contentHash:sha256(bytes),role:job.role,
      width:rendered.width,height:rendered.height,contentType:"image/svg+xml",vector:true,
      textContent:[job.name,...job.lines,job.raceNumber].filter(Boolean)});
  }
  // Keep byte identities on the receipt, never the in-memory asset buffers.
  // These are the same originals used in both the branded panels and Zone 3.
  zone3 = assets.map(({bytes, role, ...asset}) => ({
    // `assetRole` IS LOAD-BEARING AND IT WAS DELETED BY `91d0b8e`, the same
    // commit that introduced `separatedArtwork`. `panel_proof_logo_inventory`
    // (20260920022906:43) requires EXACTLY ONE cutGraphics entry with
    // assetRole = 'logo' and raises `generation_logo_original_identity_mismatch`
    // otherwise — inside `IF v_logo IS NOT NULL`, so every handoff carrying a
    // customer logo fails and the entice workflow is never created. The live
    // rows show it exactly: 2026-09-20 carried ["logo","typography","contact"],
    // 2026-09-22 carried []. It only went unnoticed because the runs since had
    // no uploaded logo. `zip.build` reads it too, for the archive filename.
    assetRole: role,
    ...asset, surfaceKey: role, role: "cut-graphic", persisted: true,
  }));
  // The design's own drawn elements fill every slot the code-owned assets left
  // empty (see `sheetDrawnCutGraphic`). Sheet path only: on the derived path
  // the "sheet" is the accepted master and has no Zone 3 boxes to read.
  const sheetDrawn = [];
  if (!zone2Panels) {
    const cropLayout = containerLayout(proofManifest);
    const occupied = new Set(assets.map((a) => ZONE3_SLOT_INDEX[a.role]).filter(Number.isInteger));
    for (const [slotIndex, cell] of cropLayout.zone3.entries()) {
      if (occupied.has(slotIndex)) continue;
      const slotKey = ZONE3_SLOT_KEYS[slotIndex] || cell.surfaceKey;
      const result = await sheetDrawnCutGraphic({
        sheetBytes: sheet.bytes, rect: scaleCell(cell, cropLayout, cut.sheet), slotKey, slotIndex, sharp, persist,
      });
      if (result.omitted) zone3Omitted.push(result.omitted);
      else sheetDrawn.push(result.element);
    }
    if (sheetDrawn.length) {
      logger(`atlas call 1: Zone 3 carries ${sheetDrawn.length} element(s) the design drew (${sheetDrawn.map((e) => e.surfaceKey).join(", ")})`);
    }
    zone3 = [...zone3, ...sheetDrawn.map(({ bytes, slotIndex, ...element }) => element)];
  }
  let productionLayout;
  let composed;
  /**
   * WHICH ZONE 1 THIS RECEIPT DESCRIBES — and it is never inferred later.
   *
   * `sheet-drawn` is the designer's own branded panels, drawn with Zone 2 and
   * Zone 3 in one pass. `composited` is the clean backgrounds with a typeset
   * lockup dropped on by code, which is the derived path only.
   *
   * The same honesty rule as `deterministic`: a reader must be able to tell the
   * designer's work from something code manufactured, without opening pixels.
   * Reporting one as the other is the receipts-green/pixels-wrong shape this
   * file records four times.
   */
  let zone1Source = "composited";
  // THE ABSENCE OF ORIGINALS IS RECORDED HERE, NOT INSIDE ONE BRANCH.
  //
  // It used to be written only where the compositor found nothing to composite.
  // Zone 1 is now published as the designer drew it, so that branch no longer
  // runs on the sheet path — and the receipt silently stopped saying that no
  // customer logo, company name or contact line was ever supplied. That is a
  // fact about the CUSTOMER'S INPUT, not about which code built Zone 1, so it
  // is stated once, for every path.
  if (!assets.length && !customerTextSupplied) {
    zone3Omitted.push({ zone: "zone3", role: null, reason: "no_original_assets_or_customer_text" });
    logger("atlas call 1: no original logo and no customer text; Zone 3 carries only what the design drew");
  }
  // ═══ THE SHEET PATH: ZONE 1 IS THE DESIGNER'S, AND NOTHING REBUILDS IT ═══
  //
  // Owner, 2026-09-22: "No not cut from any drawing. It gets the production
  // panel template ... and designs a cohesive set of 6 wrap panels using our
  // persona based edge functions ... it creates the zone 1, 2, and 3 all at
  // one time."
  //
  // `compositeProductionPanels` builds Zone 1 by dropping a `typeset.renderLockup`
  // wordmark and the uploaded logo onto the UNLETTERED Zone 2 backgrounds. On
  // the sheet path that discards the lettering A.C.E. set in the design's own
  // typeface, replaces it with a generic one, and drops a second copy of a logo
  // the designer already drew. That is exactly what the owner rejected on
  // request 0f53d4e7.
  //
  // It is kept, unchanged, for the DERIVED path (`zone2Panels` supplied), where
  // there is no authored Zone 1 to publish and a legacy six-surface or field
  // revision still needs its three-zone document.
  if (zone1.length === 6) {
    const zone2ByKey = new Map(zone2.map((p) => [p.surfaceKey, p]));
    productionLayout = { contract: null, placements: [], omitted: [] };
    composed = {
      // ⚠️ THIS IS THE SCHEMA VERSION OF THE `composition` BLOCK, AND IT IS THE
      // SAME ON BOTH PATHS ON PURPOSE. It briefly read
      // PANEL_PROOF_TOPOLOGY_CONTRACT here, which would have failed closed in
      // three places at once -- the sheet unviewable (the signing policy reads
      // it), the handoff refused on any logo-bearing brief, and zip.build
      // refusing the pack. The block's SHAPE is what these gates check, and the
      // shape is unchanged: contract, layoutContract, placements, panels,
      // sourceAssetsPreserved. See COMPOSITION_CONTRACT for the three readers.
      //
      // Who DREW Zone 1 is a different question, and it is answered honestly by
      // `brandedSource` below and by `placements: []` -- code placed nothing,
      // because the designer drew it.
      contract: COMPOSITION_CONTRACT,
      brandedSource: "sheet-drawn",
      omitted: [],
      sourceAssetsPreserved: true,
      // `applied: []` is the honest record: no element was composited onto
      // these pixels, because the designer drew them there.
      // Paired BY SURFACE KEY, never by index. Both bands come from the same
      // container layout so the orders agree today, and an index pairing is
      // one refactor away from silently mapping the hood onto the roof.
      panels: zone1.map((panel) => ({
        ...panel,
        // `cutProofPanels` returns pixels, not identities — every other
        // consumer of `composed.panels` reads `contentHash`.
        contentHash: sha256(panel.bytes),
        backgroundContentHash: zone2ByKey.get(panel.surfaceKey)?.bytes
          ? sha256(zone2ByKey.get(panel.surfaceKey).bytes) : null,
        applied: [],
        zone: "zone1",
        role: "branded",
      })),
    };
    zone1Source = "sheet-drawn";
    logger("atlas call 1: Zone 1 is the designer's own six panels, drawn with Zone 2 and Zone 3 in one pass");
  } else if (!assets.length) {
    // EMPTY ZONE 3 IS A STATE, NOT A REFUSAL. No original logo and no customer
    // text (no company name, contact line or wordmark) means there is nothing
    // to cut, so the band is empty and says so in `composition.omitted`. Zone 1
    // is then the authored panels exactly as Zone 2 carries them -- nothing was
    // composited because there was nothing to composite -- and every downstream
    // reader still gets six branded panels, six clean panels and a cut-graphics
    // count of zero. This used to refuse the whole Call 1, which took the
    // design, its DesignID and every proof with it over an absent contact bar.
    logger("atlas call 1: Zone 3 is empty (no original assets or customer text); continuing without cut graphics");
    productionLayout = { contract: null, placements: [], omitted: [] };
    composed = { contract: null, omitted: [], sourceAssetsPreserved: true,
      panels: zone2.map((base) => ({ ...base, backgroundContentHash: base.contentHash,
        applied: [], zone: "zone1", role: "branded" })) };
  } else {
    try { productionLayout = planProductionPanelLockup({panels:zone2,elements:assets}); }
    catch (cause) { throw refuse("production panel overlay layout invalid", {cause:String(cause?.message || cause),code:cause?.code}); }
    composed = await compositeProductionPanels({backgrounds:zone2,assets,placements:productionLayout.placements});
  }
  const placements = productionLayout.placements;
  const compositionChecks = composed.panels.map(({surfaceKey,contentHash,backgroundContentHash,applied}) =>
    ({surfaceKey,contentHash,backgroundContentHash,applied}));
  logger(`atlas call 1: flat compositor checks passed ${JSON.stringify(compositionChecks)}`);
  const displayLayout = containerLayout(proofManifest);
  const displayCells = new Map(displayLayout.zone1.map(cell => [cell.surfaceKey,
    scaleCell(cell,displayLayout,cut.sheet)]));
  zone1 = composed.panels.map(p => ({...p,displayRect:displayCells.get(p.surfaceKey)}));

  // ═══ CODE BUILT ONLY THE PRODUCTION PANEL PROOF DOCUMENT ═══
  //
  // This block used to open "THE CUSTOMER-VISIBLE CALL 1 IS BUILT BY CODE,
  // NEVER BY GEMINI. Gemini's returned canvas is only an internal
  // background-art staging source." That sentence arrived in `91d0b8e`
  // (2026-09-20, "Make Gemini author backgrounds only, never the proof sheet")
  // together with `separatedArtwork` and the background-only prompt, and the
  // owner reversed all three on 2026-09-22. Do not restore it.
  //
  // What is true, and what this block does: the DOCUMENT is code. The template,
  // the header and job block, the zone bands, the panel rectangles, the
  // dimension callouts, the PANEL DIMENSIONS REFERENCE table, the notes and the
  // legend are drawn here from GENIE geometry, so a dimension can never be
  // invented or copied wrong.
  //
  // The ARTWORK is the designer's. Zone 1, Zone 2 and Zone 3 were created
  // together in one pass through the design edge functions, and they are placed
  // onto this document exactly as they were drawn. Code owns the document. It
  // does not own the design.
  const vehicle = input?.vehicle || {};
  const vehicleLabel = [vehicle.year || brand.vehicleYear, vehicle.make || brand.vehicleMake,
    vehicle.model || brand.vehicleModel]
    .map(v => String(v || "").trim()).filter(Boolean).join(" ");
  const blankTemplate = await renderContainerTemplate({
    manifest: proofManifest,
    dimensionManifest: manifest,
    companyName: brand.companyName || brand.businessName || "",
    vehicle: vehicleLabel,
    bleedInches: 5,
    // Zone 2's bar states what that row IS. On the panel-proof pass the sheet
    // authored a genuinely lettering-free band. On the derived path it is true
    // only when the clean-base element graph produced one; with the brain
    // drawing lettering and logo into the artwork, those panels carry type, and
    // the bar must not claim otherwise on the customer's own proof.
    cleanBase: cleanBaseZone2 !== false,
    // THE SHEET CARRIES THE DESIGN'S OWN IDENTITY, MINTED AT CALL 1.
    //
    // Owner, 2026-09-21: "MOST IMPORTANTLY IT MUST CREATE THE GENERATE ID ON
    // CALL 1". The GenerationID already exists by the time this runs, and the
    // sheet used to print it as a DID -- which the ID ladder (owner, 2026-09-22)
    // rules out before a purchase: Generation ID at Call 1, Design ID and Order
    // ID at purchase. So the second row reads GENERATION ID until a real shop
    // order number exists, which still wins. DATE, DESIGNER and VERSION are
    // filled by code too: the customer sees this sheet within a minute of
    // Generate, and three ruled blanks under a real design read as unfinished.
    job: {
      date: input?.proofDate || proofDateLabel(),
      order: input?.orderNumber || "",
      generationId: generationIdLabel(generationId),
      designer: input?.designer || "DesignProAI",
      version: input?.proofVersion || `V${Math.max(1, Number(revisionSequence) || 1)}`,
    },
    // A slot the design filled is captioned as the design's element, not as a
    // business field it is not.
    zone3Captions: ZONE3_SLOT_KEYS.map((_, index) =>
      sheetDrawn.some((e) => e.slotIndex === index) ? SHEET_DRAWN_CAPTION : null),
  });
  const proofBase = await sharp(blankTemplate)
    .resize(cut.sheet.width,cut.sheet.height,{fit:"fill"})
    .png().toBuffer();
  const proofLayers = [];

  // Zone 2: the exact clean backgrounds Gemini authored. No redraw.
  for (const p of zone2) {
    proofLayers.push({
      input: await sharp(p.bytes).resize(p.rect.width,p.rect.height,{fit:"fill"}).png().toBuffer(),
      left: p.rect.left, top: p.rect.top,
    });
  }

  // Zone 1: those SAME backgrounds plus protected customer assets, composited
  // deterministically by compositeProductionPanels().
  for (const p of zone1) {
    const r = p.displayRect;
    proofLayers.push({
      input: await sharp(p.bytes).resize(r.width,r.height,{fit:"fill"}).png().toBuffer(),
      left: r.left, top: r.top,
    });
  }

  // Zone 3: original logo / outlined type / contact assets, placed into the
  // code-drawn slots. The template captions remain code-owned and untouched.
  const zone3Cells = displayLayout.zone3.map(cell => scaleCell(cell,displayLayout,cut.sheet));
  for (const asset of assets) {
    const index = Number.isInteger(ZONE3_SLOT_INDEX[asset.role]) ? ZONE3_SLOT_INDEX[asset.role] : -1;
    if (index < 0 || !zone3Cells[index]) continue;
    const r = zone3Cells[index];
    const pad = Math.max(6, Math.round(Math.min(r.width,r.height)*0.08));
    proofLayers.push({
      input: await sharp(asset.bytes,{density:300,limitInputPixels:40000000})
        .resize(Math.max(1,r.width-pad*2),Math.max(1,r.height-pad*2),{fit:"contain",background:"white"})
        .png().toBuffer(),
      left:r.left+pad, top:r.top+pad,
    });
  }
  // The design's own drawn elements, back into the slots they came from, at
  // the same inset the code-owned assets use.
  for (const element of sheetDrawn) {
    const r = zone3Cells[element.slotIndex];
    if (!r) continue;
    const pad = Math.max(6, Math.round(Math.min(r.width,r.height)*0.08));
    proofLayers.push({
      input: await sharp(element.bytes,{limitInputPixels:40000000})
        .resize(Math.max(1,r.width-pad*2),Math.max(1,r.height-pad*2),{fit:"contain",background:"white"})
        .png().toBuffer(),
      left:r.left+pad, top:r.top+pad,
    });
  }

  const proofBytes = await sharp(proofBase).composite(proofLayers).png().toBuffer();
  const storedComposedProof = await persist({storagePath:`atlas-panel-proof/${sha256(proofBytes)}.png`,
    bytes:proofBytes,contentType:"image/png"});
  const composedProof = {
    storagePath: storedComposedProof.storagePath,
    contentHash: storedComposedProof.contentHash,
    byteSize: proofBytes.length,
    contentType: "image/png",
    contract: "designpro.code-owned-three-zone-production-proof.v1",
  };

  // Declared here, not beside its first use: BOTH exits below persist the
  // clean quadrant, and the derived one returns before the original call site.
  const sibling = async (zone) => {
    const panels = cut.panels.filter((p) => p.zone === zone);
    const out = [];
    for (const p of panels) {
      const described = {
        surfaceKey: p.surfaceKey, role: p.role, byteSize: p.byteSize, fit: p.fit, rect: p.rect,
        identity: p.identity, positionalPremiseVerified: p.positionalPremiseVerified,
        widthIn: p.widthIn ?? null, heightIn: p.heightIn ?? null,
      };
      try {
        const stored = await persist({
          storagePath: `${QUADRANT_PREFIX}/${sha256(p.bytes)}.png`,
          bytes: p.bytes, contentType: "image/png",
        });
        out.push({ ...described, persisted: true, ...stored });
      } catch (cause) {
        throw refuse(`${zone}:${p.surfaceKey}: mandatory proof artifact could not be stored`, {
          cause: String(cause?.message || cause).slice(0, 200),
        });
      }
    }
    return out;
  };

  // ── THE DERIVED PATH STOPS HERE. The document is the deliverable. ──────
  //
  // Everything above is the production panel proof in full: Zone 2 clean, Zone
  // 1 branded, Zone 3 cut graphics, the code-drawn template, the composed
  // document and the stored quadrants. What follows is master assembly, and on
  // this path the master already exists and is already the accepted authority.
  // See `documentOnly` in the signature for why building a second one here
  // would be a defect and not a convenience.
  if (documentOnly) {
    const quadrantsAt = Date.now();
    const cleanOnly = await sibling("zone2");
    logger(`atlas call 1: derived three-zone proof ${String(composedProof.contentHash).slice(0, 12)}`
      + ` (${composedProof.byteSize} B, clean ${cleanOnly.length}, cut graphics ${zone3.length})`);
    return {
      // NO `bytes` AND NO `contentHash`, DELIBERATELY. Those two fields are how
      // a caller names a master, and this path has no master to name. A receipt
      // that carried them would be read as one by the next reader, which is
      // precisely the ambiguity the two-master ruling exists to prevent.
      documentOnly: true,
      imageRequestCount: 0,
      provenance: {
        contract: PANEL_PROOF_TOPOLOGY_CONTRACT,
        topology: "derived-from-accepted-master",
        proofContract: composedProof.contract,
        proofSha256: composedProof.contentHash,
        proofStoragePath: composedProof.storagePath,
        proofByteSize: composedProof.byteSize,
        proofContentType: composedProof.contentType,
        // The artwork authority is the accepted master, named by identity and
        // never by bytes (RULE 0.39).
        sourceArtwork: {
          storagePath: sheet.storagePath || null,
          contentHash: sheet.contentHash || null,
          byteSize: sheet.byteSize || null,
        },
        quadrants: { clean: cleanOnly, cutGraphics: zone3 },
        // THE SAME FOUR FIELDS THE AUTHORED RECEIPT CARRIES. They were absent
        // here, and `designpro_private.panel_proof_logo_inventory`
        // (20260920022906) requires `threeZoneLayout`, `composition.contract`,
        // `composition.sourceAssetsPreserved` and `masterSha256` -- so every
        // revision of a logo design failed its handoff with
        // `generation_logo_placement_manifest_required`. `masterSha256` names
        // the accepted master this document was derived FROM; it is still not
        // a top-level `contentHash`, so the receipt still cannot be read as a
        // master (see the note above).
        threeZoneLayout: { required: true, branded: zone1.length,
          backgrounds: zone2.length, graphics: zone3.length,
          brandedSource: zone1Source,
          graphicsFormat: zone3Format(zone3), productionApproved: false,
        // THE DIE-CUT GATE'S OWN MEASUREMENTS, kept whether or not it
        // convicted: a clean sheet's per-surface band fits are what a
        // later reader needs to judge the thresholds from real runs,
        // and a convicted one never reaches a receipt at all. Null on
        // the derived path, which has no sheet-drawn Zone 1.
        dieCut },
        masterSha256: sheet.contentHash || null,
        composition: { contract: composed.contract, layoutContract: productionLayout.contract,
          placements: productionLayout.placements, brandedSource: zone1Source,
          panels: compositionChecks, sourceAssetsPreserved: true,
          omitted: [...(productionLayout.omitted || []), ...(composed.omitted || []), ...zone3Omitted] },
        surfaces: zone1.map((p) => ({ surfaceKey: p.surfaceKey, byteSize: p.byteSize,
          widthIn: p.widthIn, heightIn: p.heightIn })),
        stageTimings: [...stageTimings, { stage: "proof.document", ms: Date.now() - quadrantsAt }],
        totalMs: Date.now() - startedAt,
      },
    };
  }

  // ── node 3: the master. The six panels into the GENIE zones. ───────────
  //
  // EACH PANEL IS RESIZED TO ITS ZONE'S EXACT PIXEL SIZE FIRST, and the hash is
  // taken of the resized bytes. `assembleFinishedMaster` checks both — the
  // pixels must fit the original extraction exactly and the bytes must match
  // their recorded hash — and it is right to: those two assertions are what stop
  // a panel landing in the wrong rectangle or a buffer being swapped between
  // the cut and the composite. So this satisfies them rather than loosening
  // them, which is the same thing `assembleHeroMaster` does with `zonePixelSize`.
  const assembleAt = Date.now();
  const byKey = new Map(zone1.map((p) => [p.surfaceKey, p]));
  const canvas = await sharp({
    create: { width: CANVAS_PX, height: CANVAS_PX, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).png().toBuffer();
  const placed = [];
  for (const zone of manifest.zones) {
    const panel = byKey.get(zone.surfaceKey);
    if (!panel) throw refuse(`${zone.surfaceKey}: no cut panel to assemble`);
    const { pixelWidth, pixelHeight } = zonePixelSize(zone);

    // Detected bounds and surface identity are checked before this step.
    // Reject incompatible proportions. Preserve all source artwork with a
    // proportional resize, then copy only the boundary pixels into the bounded
    // remainder. This adapter padding is not production bleed.
    const cropAspect = panel.rect.width / panel.rect.height;
    const zoneAspect = pixelWidth / pixelHeight;
    const drift = Math.max(cropAspect / zoneAspect, zoneAspect / cropAspect);
    if (!Number.isFinite(drift) || drift > MAX_PANEL_ASPECT_DRIFT) {
      throw refuse(
        `${zone.surfaceKey}: the cut crop is ${cropAspect.toFixed(3)}:1 and its zone is `
        + `${zoneAspect.toFixed(3)}:1 (drift ${drift.toFixed(3)}, limit ${MAX_PANEL_ASPECT_DRIFT}) `
        + `— resizing it would distort the artwork rather than place it`,
        { aspect: { surfaceKey: zone.surfaceKey, cropAspect: Number(cropAspect.toFixed(4)),
          zoneAspect: Number(zoneAspect.toFixed(4)), drift: Number(drift.toFixed(4)) } });
    }

    const resized = await sharp(panel.bytes)
      .resize(pixelWidth, pixelHeight, { fit: "inside" })
      .png().toBuffer({ resolveWithObject: true });
    const padX = pixelWidth - resized.info.width;
    const padY = pixelHeight - resized.info.height;
    if (padX < 0 || padY < 0
      || padX > Math.ceil(pixelWidth * (1 - 1 / MAX_PANEL_ASPECT_DRIFT)) + 1
      || padY > Math.ceil(pixelHeight * (1 - 1 / MAX_PANEL_ASPECT_DRIFT)) + 1) {
      throw refuse(`${zone.surfaceKey}: edge extension exceeds the aspect budget`);
    }
    const left = Math.floor(padX / 2);
    const top = Math.floor(padY / 2);
    const bytes = await sharp(resized.data).extend({
      left, right: padX - left, top, bottom: padY - top, extendWith: "copy",
    }).png().toBuffer();
    placed.push({
      surfaceKey: zone.surfaceKey,
      finish: { applied: true, bytes, contentHash: sha256(bytes) },
    });
  }
  const assembled = await assembleFinishedMaster(canvas, manifest, placed);
  mark("master.assemble", assembleAt);

  // ── the other two quadrants: STORED, then described. ───────────────────
  //
  // See the header. These bytes are the clean base and the Logo Pack; they were
  // being cut, measured and dropped while a comment here claimed otherwise.
  // One content-addressed write each, through the store seam the caller already
  // hands this function.
  const quadrantAt = Date.now();
  const cleanQuadrant = await sibling("zone2");
  const cutGraphicsQuadrant = zone3;
  // NOT A `mark()`. `stageTimings` is the DAG's node list and its order is
  // locked as such; this is persistence of node 2's output, not a fourth node,
  // so it is timed on `timings` where a reader will not read it as one. The
  // order lock caught me putting it there.
  const quadrantMs = Date.now() - quadrantAt;
  const storedCount = [...cleanQuadrant, ...cutGraphicsQuadrant].filter((p) => p.persisted).length;
  logger(`atlas call 1: quadrants stored ${storedCount}/${cleanQuadrant.length + cutGraphicsQuadrant.length}`
    + ` (clean ${cleanQuadrant.filter((p) => p.persisted).length}, cut graphics `
    + `${cutGraphicsQuadrant.filter((p) => p.persisted).length})`);

  return {
    bytes: assembled.bytes,
    contentHash: assembled.contentHash,
    model: sheet.model || "gemini-3-pro-image",
    promptVersion: sheet.promptVersion || sheet.contract || PANEL_PROOF_TOPOLOGY_CONTRACT,
    imageRequestCount: Number(sheet.imageRequestCount || 1),
    surfaces: zone1.map((p) => ({
      surfaceKey: p.surfaceKey, method: "panel-proof-cut", fit: p.fit,
      widthIn: p.widthIn, heightIn: p.heightIn, byteSize: p.byteSize,
      imageRequestCount: 0, attempts: 1,
    })),
    // NO PANELS ARE RETURNED, DELIBERATELY. An earlier draft handed the six cut
    // Zone-1 panels back "so flat-first-atlas can release them without
    // re-cutting the assembled master", and nothing ever read them: the live
    // path cuts its own six with `cutCallOnePanels` from the assembled master
    // and releases each to `launchAtlasProof`, which is the orchestration that
    // has always driven Call 2 and the QC -> Topaz -> ZIP -> WrapBox chain.
    //
    // Returning a second set alongside it is the second-producer shape RULE 0.21
    // forbids by name, and a field nobody reads is worse than absent: the next
    // reader has to work out which of two panel sets production actually buys.
    provenance: {
      contract: PANEL_PROOF_TOPOLOGY_CONTRACT,
      topology: PANEL_PROOF_TOPOLOGY,
      // The edge names its CONTRACT and emits no separate prompt version, so
      // reading only `promptVersion` wrote null on every run while the very
      // same value was available two fields away (and `masterProvenance` above
      // already falls back to it). A receipt claiming not to know something the
      // sheet plainly carries is the shape this file records five times.
      promptVersion: sheet.promptVersion || sheet.contract || null,
      proofContract: composedProof.contract,
      proofSha256: composedProof.contentHash,
      proofStoragePath: composedProof.storagePath,
      proofByteSize: composedProof.byteSize,
      proofContentType: composedProof.contentType,
      sourceArtwork: {
        storagePath: sheet.storagePath || null,
        contentHash: sheet.contentHash || null,
        byteSize: sheet.byteSize || sheet.bytes.length,
        contentType: sheet.sheetShape?.mime || null,
        model: sheet.model || null,
        role: "internal-background-artwork-staging",
      },
      productionComposedProof: composedProof,
      threeZoneLayout: { required: true, branded: zone1.length,
        backgrounds: zone2.length, graphics: zone3.length,
        // "sheet-drawn" = the designer's own Zone 1; "composited" = code built
        // it from the clean backgrounds. See `zone1Source`.
        brandedSource: zone1Source,
        // "none" when the band is empty: an all-of-nothing `every()` would
        // have called an empty band "vector-originals".
        graphicsFormat: zone3Format(zone3), productionApproved: false,
        // THE DIE-CUT GATE'S OWN MEASUREMENTS, kept whether or not it
        // convicted: a clean sheet's per-surface band fits are what a
        // later reader needs to judge the thresholds from real runs,
        // and a convicted one never reaches a receipt at all. Null on
        // the derived path, which has no sheet-drawn Zone 1.
        dieCut },
      // `omitted` is the answer to "which asset did not reach which panel, and
      // why". Empty means every Zone-3 original was drawn onto every branded
      // surface that carries branding; it is never absent, so a reader can tell
      // "nothing was dropped" from "nobody recorded it". A Zone-3 element the
      // pass declined to carry at all (no assets, an opaque generated mark) is
      // listed here too, under `zone: "zone3"`.
      composition: {contract:composed.contract,layoutContract:productionLayout.contract,placements,
        // WHO DREW ZONE 1, carried on the block itself so a reader of the
        // composition never has to infer it from the schema version.
        brandedSource:zone1Source,
        panels:compositionChecks,sourceAssetsPreserved:true,
        omitted:[...(productionLayout.omitted || []),...(composed.omitted || []),...zone3Omitted]},
      imageRequestCount: Number(sheet.imageRequestCount || 1),
      // The gold standards Call 1 actually saw, by identity. Zero is now a
      // measured answer rather than a literal, so an empty prefix is visible.
      artboardQualityExamplesApplied: Number(sheet.artboardQualityExamplesApplied || 0),
      artboardQualityExampleIdentities: Array.isArray(sheet.artboardQualityExampleIdentities)
        ? sheet.artboardQualityExampleIdentities : [],
      /**
       * WHAT THE DESIGNER WAS ACTUALLY ASKED, ON THE RECEIPT.
       *
       * The edge returns `prompt` precisely so "a disagreement about the
       * design is settled on the REQUEST rather than on impressions of the
       * output", and returns `intake` so "a wrong parse is otherwise
       * invisible: the sheet just quietly carries the wrong company". The
       * runtime read neither, so when the owner said her placement
       * instruction was ignored, the run could not answer whether the words
       * ever reached the model. The brief is the customer's own text and is
       * already stored on the request; what was missing is what became of it.
       */
      intake: sheet.intake || null,
      promptChars: Number(sheet.promptChars || 0),
      // WHICH PERSONA RAN, WHAT IT SAID, AND WHO LETTERED ZONE 3. Three facts
      // the owner asked for on 2026-09-22 and none of which a receipt carried.
      mode: sheet.mode || null,
      briefSource: sheet.intake?.briefSource || null,
      designAnchor: sheet.designAnchor || null,
      zone3LetteringSource,
      masterSha256: assembled.contentHash,
      masterStoragePath: null,
      // THE CUSTOMER'S OWN ASSETS, BY IDENTITY, ON THE RECEIPT.
      //
      // They were staged, hash-verified and sent, and then recorded NOWHERE --
      // so "did the customer's logo reach Call 1" was unanswerable from the run,
      // which is the state that let this route ship forwarding neither the logo
      // nor the VisionBoard reference while every receipt read green. An empty
      // array is a real answer (the customer uploaded nothing); absence of the
      // field is not.
      customerAssets: (Array.isArray(customerAssets) ? customerAssets : []).map((asset) => ({
        storagePath: asset?.storagePath || null,
        contentHash: asset?.contentHash || null,
        byteSize: Number(asset?.byteSize || 0) || null,
      })),
      sheet: cut.sheet,
      // THE THREE QUADRANTS, NAMED. Zone 1 became the master; these two are
      // the clean base and the Logo Pack, and a reader that cannot see them
      // here would assume the sheet carried only panels.
      // Zone 1 became the master, so it is described from the placement above
      // rather than stored twice; the other two carry their own identities.
      quadrants: {
        branded: zone1.map((p) => ({
          surfaceKey: p.surfaceKey, role: p.role, byteSize: p.byteSize, fit: p.fit, rect: p.displayRect, backgroundRect: p.rect,
          widthIn: p.widthIn ?? null, heightIn: p.heightIn ?? null,
          identity: p.identity, positionalPremiseVerified: p.positionalPremiseVerified,
        })),
        clean: cleanQuadrant,
        cutGraphics: cutGraphicsQuadrant,
      },
      stageTimings,
      totalMs: Date.now() - startedAt,
    },
    timings: { panelProofMs: Date.now() - startedAt, quadrantStoreMs: quadrantMs, stages: stageTimings },
  };
}

/**
 * The whole pass, in one process: sheet → cut → assemble.
 *
 * This is now a two-line composition of the two halves above, and it stays
 * because it is the door the in-process path and every existing caller already
 * use. The durable graph claims the same two halves as two node rows; both
 * routes run the SAME functions, so there is exactly one producer of these
 * panels however Call 1 was dispatched.
 *
 * @returns the same shape `authorHeroDriverMaster` returns, because
 *   flat-first-atlas consumes both through one code path and a second shape
 *   there would be a second contract nobody asked for.
 */
async function authorPanelProofMaster({
  manifest, input, store, logger = () => {}, customerImageParts = [],
  providerRequest = {}, callProofEdge, downloadAsset,
  assembleFinishedMaster, sharp = require("sharp"),
  startedAt = Date.now(),
  // See `requestProofSheet`: the revision (null on a first generation) and the
  // bounded candidate index, both part of the durable operation identity.
  revision = null, candidate = 1,
} = {}) {
  const stageTimings = [];
  const sheetAt = Date.now();
  const { sheet, panelRows, customerAssets } = await requestProofSheet({
    manifest, input, providerRequest, callProofEdge, store, customerImageParts, logger,
    revision, candidate,
  });
  stageTimings.push({ stage: "proof.sheet", ms: Date.now() - sheetAt });
  logger(`atlas call 1: panel proof sheet ${String(sheet.contentHash || "").slice(0, 12)} (${sheet.bytes.length} B)`);
  return assemblePanelProofMaster({
    sheet, panelRows, customerAssets, input, downloadAsset, manifest, store, logger,
    assembleFinishedMaster, sharp, startedAt, stageTimings,
    // Same identity the provider request was authorised against, so the sheet
    // and the provider cache name one generation.
    generationId: providerRequest?.generationId || "",
    revisionSequence: Number(revision?.sequence || 1),
  });
}

module.exports = {
  PANEL_PROOF_TOPOLOGY,
  PANEL_PROOF_TOPOLOGY_CONTRACT,
  PROOF_EDGE_FUNCTION,
  CALL1_INPUT_PATH,
  PanelProofRefusal,
  dieCutFindings,
  bandFitFindings,
  MIN_CORNER_PAGE_FRACTION,
  DIE_CUT_CONTRACT,
  MAX_BAND_FIT_DROP,
  SURFACE_FIT_DEFICIT_NOTICE,
  panelProofEnabled,
  panelRowsFromManifest,
  stageProofContainer,
  createPanelProofTransport,
  revisionRequestFields,
  requestProofSheet,
  assemblePanelProofMaster,
  authorPanelProofMaster,
  _test: { proofDateLabel, generationIdLabel, SHEET_DRAWN_CAPTION, ZONE3_SLOT_KEYS, SHEET_DRAWN_MIN_INK },
};
