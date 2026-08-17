/**
 * artboard-grid.ts — ASPECT-LOCKED master-artboard layout for the Universal
 * Panelizer.
 *
 * Why this exists:
 *   The old grid forced every bottom-row panel (hood / bumpers) into a single
 *   fixed-height band (30%). Wide-flat panels (e.g. a 120"×38" bumper, ~3.16:1)
 *   were therefore drawn into nearly-square zones (~1.9:1), so slicing had to
 *   stretch them ~67% horizontally — the "squash". No downstream fit:cover/fill
 *   can undo a distortion baked into the master artboard.
 *
 * The fix:
 *   Allocate EVERY zone at its panel's TRUE physical aspect ratio (bleed
 *   included). A zone's rendered pixel aspect = (wPct / hPct) × artboardAspect,
 *   so to make it equal the panel aspect we set  wPct/hPct = panelAspect / AR.
 *   Sides span full width and stack; the remaining panels are shelf-packed into
 *   one or more rows, each row sized so its panels keep their true aspect AND
 *   fill the row width. The artboard aspect ratio is chosen from Gemini's
 *   supported set to maximise the smallest zone (best resolution) while the
 *   whole layout fits within 0–100%.
 *
 *   ┌──────────────────────────────────────────────┐
 *   │              DRIVER SIDE                      │  aspect-locked
 *   ├──────────────────────────────────────────────┤
 *   │            PASSENGER SIDE                     │  aspect-locked
 *   ├──────────┬───────────────────┬───────────────┤
 *   │   HOOD   │   FRONT BUMPER    │  REAR BUMPER   │  each at its TRUE aspect
 *   └──────────┴───────────────────┴───────────────┘  (wraps to more rows if needed)
 *
 * Pure module: no Deno/Node-only APIs, so it is unit-testable from Vitest and
 * importable by the panelizer-extract edge function alike.
 */

export interface VehicleDimsEntry {
  widthIn?: number;
  heightIn?: number;
}

export interface GridZone {
  key: string;
  label: string;
  widthInches: number;
  heightInches: number;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

export interface GenieGrid {
  zones: GridZone[];
  canvasAspect: string;     // Gemini renders at THIS ratio — the zone math assumes it
  vehicleDesc: string;
  specsSource: string;
  totalWidthInches: number;
  totalHeightInches: number;
}

// Gemini-supported aspect ratios, widest → tallest.
export const GEMINI_ASPECT_RATIOS: { label: string; ratio: number }[] = [
  { label: "21:9", ratio: 21 / 9 },
  { label: "16:9", ratio: 16 / 9 },
  { label: "3:2",  ratio: 3 / 2 },
  { label: "4:3",  ratio: 4 / 3 },
  { label: "5:4",  ratio: 5 / 4 },
  { label: "1:1",  ratio: 1 },
  { label: "4:5",  ratio: 4 / 5 },
  { label: "3:4",  ratio: 3 / 4 },
  { label: "2:3",  ratio: 2 / 3 },
  { label: "9:16", ratio: 9 / 16 },
];

// Default panel dimensions (inches, TRIM) when vehicle dims are unavailable.
export const DEFAULT_PANEL_DIMS: Record<string, { widthIn: number; heightIn: number }> = {
  driver_side:    { widthIn: 172, heightIn: 55.5 },
  passenger_side: { widthIn: 172, heightIn: 55.5 },
  hood:           { widthIn: 56,  heightIn: 36 },
  roof:           { widthIn: 66,  heightIn: 44 },
  rear:           { widthIn: 66,  heightIn: 42 },
  front:          { widthIn: 111, heightIn: 30 },
  trunk:          { widthIn: 56,  heightIn: 36 },
};

// Internal panel name → artboard zone key.
export const PANEL_TO_ZONE: Record<string, string> = {
  driver_side: "driver-side",
  passenger_side: "passenger-side",
  hood: "hood",
  rear: "rear",
  roof: "roof",
  front: "front",
  trunk: "trunk",
};

export const PANEL_ORDER_BOTTOM = ["hood", "front", "rear", "trunk", "roof"];

export const ZONE_LABEL: Record<string, string> = {
  "driver-side": "DRIVER SIDE",
  "passenger-side": "PASSENGER SIDE",
  hood: "HOOD",
  front: "FRONT BUMPER",
  rear: "REAR",
  trunk: "TRUNK",
  roof: "ROOF",
};

const GRID_GAP_PCT = 1.0; // vertical/horizontal gutter between zones (artboard %)

interface PanelBox {
  key: string;
  label: string;
  aspect: number;        // widthInches / heightInches (bleed included)
  widthInches: number;
  heightInches: number;
}

interface Shelf {
  hPct: number;
  panels: Array<PanelBox & { wPct: number }>;
}

/**
 * Build the aspect-locked artboard grid for a requested panel set.
 * `bleedInches` is added on every side so each cropped zone is print-ready.
 */
export function buildAspectLockedGrid(
  requestedPanels: string[],
  vehicleDims: Record<string, VehicleDimsEntry> | undefined,
  bleedInches: number,
): GenieGrid {
  const dim = (panel: string): { widthIn: number; heightIn: number } => {
    const fromCaller = vehicleDims?.[panel] || vehicleDims?.[panel.replace(/_/g, "-")];
    const w = fromCaller?.widthIn || DEFAULT_PANEL_DIMS[panel]?.widthIn || 172;
    const h = fromCaller?.heightIn || DEFAULT_PANEL_DIMS[panel]?.heightIn || 55.5;
    return { widthIn: w + bleedInches * 2, heightIn: h + bleedInches * 2 };
  };

  const box = (panel: string, key: string): PanelBox => {
    const d = dim(panel);
    return {
      key,
      label: ZONE_LABEL[key] || key.toUpperCase(),
      aspect: d.widthIn / d.heightIn,
      widthInches: d.widthIn,
      heightInches: d.heightIn,
    };
  };

  const sideBoxes: PanelBox[] = [];
  if (requestedPanels.includes("driver_side")) sideBoxes.push(box("driver_side", "driver-side"));
  if (requestedPanels.includes("passenger_side")) sideBoxes.push(box("passenger_side", "passenger-side"));

  const bottomBoxes: PanelBox[] = PANEL_ORDER_BOTTOM
    .filter((p) => requestedPanels.includes(p))
    .map((p) => box(p, PANEL_TO_ZONE[p]));

  // Choose the artboard aspect ratio that maximises the smallest zone (best
  // resolution) while everything fits inside 0–100%.
  let best: { label: string; zones: GridZone[]; minHpct: number } | null = null;
  for (const ar of GEMINI_ASPECT_RATIOS) {
    const laid = layoutForAspect(ar.ratio, sideBoxes, bottomBoxes, false);
    if (!laid) continue;
    if (!best || laid.minHpct > best.minHpct) best = { label: ar.label, zones: laid.zones, minHpct: laid.minHpct };
  }
  // Fallback for extreme dimensions: force 3:2 and uniformly downscale to fit.
  if (!best) {
    const laid = layoutForAspect(1.5, sideBoxes, bottomBoxes, true)!;
    best = { label: "3:2", zones: laid.zones, minHpct: laid.minHpct };
  }

  const totalWidthInches = sideBoxes[0]?.widthInches || bottomBoxes[0]?.widthInches || 100;
  const totalHeightInches =
    sideBoxes.reduce((s, b) => s + b.heightInches, 0) +
    (bottomBoxes.length ? Math.max(...bottomBoxes.map((b) => b.heightInches)) : 0);

  return {
    zones: best.zones,
    canvasAspect: best.label,
    vehicleDesc: "Vehicle",
    specsSource: "panelizer-extract",
    totalWidthInches,
    totalHeightInches,
  };
}

/**
 * Lay panels out for a given artboard aspect ratio (AR = width/height).
 * Returns null if it cannot fit 0–100% vertically (unless `allowScale`, which
 * uniformly shrinks the bottom shelves to fit — aspect preserved).
 */
function layoutForAspect(
  AR: number,
  sideBoxes: PanelBox[],
  bottomBoxes: PanelBox[],
  allowScale: boolean,
): { zones: GridZone[]; minHpct: number } | null {
  const zones: GridZone[] = [];
  const r2 = (n: number) => Math.round(n * 100) / 100;
  let y = 0;

  // Sides: full width. hPct = 100·AR/aspect makes wPct = 100 at the true aspect.
  for (const s of sideBoxes) {
    const hPct = (100 * AR) / s.aspect;
    if (y + hPct > 100.001) return null; // a single side is too tall for this AR
    zones.push({
      key: s.key, label: s.label, widthInches: s.widthInches, heightInches: s.heightInches,
      xPct: 0, yPct: r2(y), wPct: 100, hPct: r2(hPct),
    });
    y += hPct + GRID_GAP_PCT;
  }

  if (bottomBoxes.length) {
    const budget = 100 - y;
    if (budget <= 1 && !allowScale) return null;
    const shelves = packShelves(bottomBoxes, AR, budget, allowScale);
    if (!shelves) return null;
    for (const shelf of shelves) {
      const rowW = shelf.panels.reduce((sum, p) => sum + p.wPct, 0) + GRID_GAP_PCT * (shelf.panels.length - 1);
      let x = Math.max(0, (100 - rowW) / 2); // centre the row
      for (const p of shelf.panels) {
        zones.push({
          key: p.key, label: p.label, widthInches: p.widthInches, heightInches: p.heightInches,
          xPct: r2(x), yPct: r2(y), wPct: r2(p.wPct), hPct: r2(shelf.hPct),
        });
        x += p.wPct + GRID_GAP_PCT;
      }
      y += shelf.hPct + GRID_GAP_PCT;
    }
  }

  if (y > 100.001) return null;
  const minHpct = Math.min(...zones.map((z) => z.hPct));
  return { zones, minHpct };
}

/**
 * Pack bottom panels into aspect-locked shelves. Each shelf's height is set so
 * its panels keep their true aspect AND fill the row width. More rows → taller
 * (larger) panels but more total height; we keep the most rows whose total
 * fits the budget. If even one row is too tall, uniformly scale it to the
 * budget (aspect preserved).
 */
function packShelves(boxes: PanelBox[], AR: number, budget: number, allowScale: boolean): Shelf[] | null {
  const shelfHeight = (group: PanelBox[]): number => {
    const sumAsp = group.reduce((s, b) => s + b.aspect, 0);
    const widthBudget = 100 - GRID_GAP_PCT * (group.length - 1);
    return (widthBudget * AR) / sumAsp;
  };
  const buildShelves = (rows: PanelBox[][]): Shelf[] =>
    rows.map((group) => {
      const hPct = shelfHeight(group);
      return { hPct, panels: group.map((b) => ({ ...b, wPct: (hPct * b.aspect) / AR })) };
    });
  const totalHeight = (shelves: Shelf[]) =>
    shelves.reduce((s, sh) => s + sh.hPct, 0) + GRID_GAP_PCT * (shelves.length - 1);

  let chosen: Shelf[] | null = null;
  for (let R = 1; R <= boxes.length; R++) {
    const shelves = buildShelves(balancedContiguousPartition(boxes, R));
    if (totalHeight(shelves) <= budget + 0.001) chosen = shelves; // largest fitting R wins (biggest panels)
  }
  if (chosen) return chosen;

  if (!allowScale) return null;
  const oneRow = buildShelves([boxes]);
  const factor = budget / totalHeight(oneRow);
  return oneRow.map((sh) => ({ hPct: sh.hPct * factor, panels: sh.panels.map((p) => ({ ...p, wPct: p.wPct * factor })) }));
}

/** Split `boxes` into `rows` contiguous groups, minimising the largest per-row aspect-sum (balances row heights). */
export function balancedContiguousPartition(boxes: PanelBox[], rows: number): PanelBox[][] {
  if (rows <= 1) return [boxes];
  if (rows >= boxes.length) return boxes.map((b) => [b]);
  const asp = boxes.map((b) => b.aspect);
  const cutsNeeded = (limit: number): number => {
    let groups = 1, cur = 0;
    for (const a of asp) {
      if (cur + a > limit + 1e-9) { groups++; cur = a; } else { cur += a; }
    }
    return groups;
  };
  let lo = Math.max(...asp), hi = asp.reduce((s, a) => s + a, 0);
  while (hi - lo > 1e-6) {
    const mid = (lo + hi) / 2;
    if (cutsNeeded(mid) <= rows) hi = mid; else lo = mid;
  }
  const limit = hi;
  const out: PanelBox[][] = [];
  let cur: PanelBox[] = [], curSum = 0;
  for (let i = 0; i < boxes.length; i++) {
    if (cur.length && curSum + asp[i] > limit + 1e-9) { out.push(cur); cur = []; curSum = 0; }
    cur.push(boxes[i]); curSum += asp[i];
  }
  if (cur.length) out.push(cur);
  while (out.length > rows) { const last = out.pop()!; out[out.length - 1].push(...last); }
  return out;
}
