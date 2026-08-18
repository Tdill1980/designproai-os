/**
 * VEHICLE PROOF TEMPLATES -- ported verbatim from the proven RestylePro
 * implementation at supabase/functions/generate-2d-proof/vehicle-proof-template.ts.
 * Only the TypeScript annotations were removed and vehicleProofSvg now returns
 * the mapped silhouette path instead of a <clipPath> element, because sharp
 * masks with a composited alpha rather than an SVG clip reference.
 *
 * VEHICLE PROOF TEMPLATES — the flattened silhouettes the 2D proof draws on.
 *
 * The owner's contract (docs/CANONICAL_DESIGN_CALL_CONTRACT.md, Call 8) is that
 * the production proof shows the design ON THE VEHICLE — flattened driver,
 * passenger, roof, hood, front and rear elevations carrying the wrap, the way
 * the 2026-07-24 proofs looked — with GENIE trim dimensions, 5" bleed and total
 * square feet. The 2026-08-05 recovery (c6f8b0c1) flipped the tile prompt from
 * "a flat outline of the vehicle with the wrap design painted onto it" to
 * "there must be no vehicle silhouette", because that tile had become the Call 7
 * print master and a master with a truck body baked into it cannot be cropped
 * into a printable panel. Correct reasoning, wrong conclusion: it deleted the
 * proof's whole reason for existing instead of separating the two jobs.
 *
 * THIS MODULE IS THE SEPARATION. The Call 7 master stays exactly what it is —
 * a full-bleed rectangle of artwork, the deterministic source every print panel
 * is extracted from, byte for byte. Nothing here touches it. These outlines are
 * a DISPLAY MASK applied only while composing the proof sheet: the same master
 * pixels, shown through the shape of the vehicle.
 *
 * Consequences worth stating, because they are the point:
 *   - Panels remain `allPanelBytesEqualCall7Masters` — the proof cannot change
 *     a printed pixel, since it never feeds extraction.
 *   - The proof and the panels can never disagree about the design, because
 *     they are the same bytes rendered twice.
 *   - No model draws the vehicle. These are fixed paths. A silhouette cannot
 *     hallucinate a mirrored logo the way the July single-image sheet could.
 *
 * Coordinates are normalized 0..1 of each tile's PRINT rect (bleed included),
 * so a silhouette scales to any GENIE trim without re-authoring. Paths are
 * intentionally simple: this is a technical elevation on a proof sheet, not
 * vehicle art. Detail lines (glass, wheel arches, cab seams) are drawn as
 * strokes OVER the masked artwork so the wrap reads as applied to a vehicle
 * rather than as a sticker in a vehicle-shaped hole.
 */

const rect = () => ({
  silhouette: "M0,0 L1,0 L1,1 L0,1 Z",
  details: [],
  rectangular: true,
});

/**
 * Body families. Every vehicle type the intake accepts
 * (src/components/tools/VehicleTypeSelector.tsx) maps to one of these; an
 * unknown type falls back to the rectangle, which is honest — better a plain
 * panel than a silhouette that misrepresents the customer's vehicle.
 */
const FAMILY_BY_TYPE = {
  truck: "pickup",
  pickup: "pickup",
  van: "van",
  car: "car",
  sedan: "car",
  suv: "suv",
  crossover: "suv",
  bus: "box",
  rv: "box",
  trailer: "flat",
  motorcycle: "flat",
  boat: "flat",
};

function bodyFamilyFor(vehicleType) {
  const key = String(vehicleType || "").trim().toLowerCase();
  return FAMILY_BY_TYPE[key] || "flat";
}

/**
 * SIDE ELEVATIONS. Drawn cab-forward (nose left). The passenger side is the
 * driver path mirrored at composition time, never a separately authored shape,
 * so the two sides can never disagree about the vehicle's proportions.
 */
const SIDE = {
  // Crew-cab pickup: nose, raked windshield, cab, bed with a visible bedside
  // break. The bed floor sits slightly above the cab sill, as it does on an
  // F-250.
  pickup: {
    silhouette:
      "M0.010,0.760 L0.020,0.560 L0.075,0.520 L0.140,0.330 L0.190,0.180 " +
      "L0.470,0.150 L0.520,0.330 L0.560,0.470 L0.575,0.520 L0.990,0.530 " +
      "L0.995,0.780 L0.960,0.860 L0.860,0.870 L0.840,0.800 L0.300,0.800 " +
      "L0.280,0.870 L0.150,0.870 L0.120,0.860 L0.040,0.850 Z",
    details: [
      // windshield + door glass
      "M0.200,0.330 L0.240,0.200 L0.450,0.180 L0.455,0.330 Z",
      "M0.470,0.190 L0.500,0.330 L0.470,0.330 Z",
      // cab / bed seam and bedside crease
      "M0.575,0.520 L0.575,0.800",
      "M0.620,0.640 L0.980,0.640",
      // wheel arches
      "M0.120,0.800 A0.090,0.140 0 0 1 0.300,0.800",
      "M0.700,0.800 A0.090,0.140 0 0 1 0.880,0.800",
    ],
  },
  // High-roof cargo van (Transit): tall slab flank, short nose, sliding-door
  // seam. The flank is the whole product — it is why vans wrap so well.
  van: {
    silhouette:
      "M0.010,0.740 L0.015,0.430 L0.060,0.300 L0.150,0.200 L0.300,0.150 " +
      "L0.960,0.145 L0.990,0.200 L0.995,0.760 L0.960,0.860 L0.870,0.870 " +
      "L0.845,0.800 L0.300,0.800 L0.275,0.870 L0.150,0.870 L0.040,0.850 Z",
    details: [
      "M0.075,0.400 L0.140,0.290 L0.245,0.240 L0.250,0.400 Z",
      "M0.290,0.235 L0.470,0.230 L0.470,0.400 L0.290,0.400 Z",
      "M0.500,0.200 L0.500,0.800",
      "M0.760,0.200 L0.760,0.800",
      "M0.120,0.800 A0.085,0.135 0 0 1 0.295,0.800",
      "M0.690,0.800 A0.085,0.135 0 0 1 0.865,0.800",
    ],
  },
  car: {
    silhouette:
      "M0.010,0.780 L0.030,0.600 L0.120,0.520 L0.260,0.330 L0.430,0.250 " +
      "L0.640,0.255 L0.800,0.360 L0.930,0.520 L0.990,0.590 L0.995,0.780 " +
      "L0.950,0.860 L0.860,0.865 L0.835,0.800 L0.300,0.800 L0.275,0.865 " +
      "L0.150,0.865 L0.040,0.850 Z",
    details: [
      "M0.300,0.360 L0.440,0.290 L0.620,0.295 L0.700,0.365 Z",
      "M0.520,0.290 L0.520,0.365",
      "M0.120,0.800 A0.088,0.130 0 0 1 0.295,0.800",
      "M0.680,0.800 A0.088,0.130 0 0 1 0.855,0.800",
    ],
  },
  suv: {
    silhouette:
      "M0.010,0.770 L0.025,0.560 L0.100,0.500 L0.210,0.290 L0.380,0.210 " +
      "L0.880,0.215 L0.950,0.300 L0.990,0.520 L0.995,0.770 L0.955,0.860 " +
      "L0.865,0.868 L0.840,0.800 L0.300,0.800 L0.275,0.868 L0.150,0.868 " +
      "L0.040,0.850 Z",
    details: [
      "M0.250,0.330 L0.390,0.255 L0.560,0.255 L0.560,0.400 L0.260,0.400 Z",
      "M0.590,0.255 L0.860,0.260 L0.870,0.400 L0.590,0.400 Z",
      "M0.575,0.230 L0.575,0.800",
      "M0.120,0.800 A0.088,0.132 0 0 1 0.295,0.800",
      "M0.690,0.800 A0.088,0.132 0 0 1 0.865,0.800",
    ],
  },
  // Box truck / bus / RV: the flank IS a rectangle, so the silhouette is one
  // too. Only the wheels and a floor line distinguish it.
  box: {
    silhouette: "M0.005,0.120 L0.995,0.120 L0.995,0.800 L0.005,0.800 Z",
    details: [
      "M0.005,0.800 L0.995,0.800",
      "M0.130,0.800 A0.080,0.120 0 0 1 0.290,0.800",
      "M0.720,0.800 A0.080,0.120 0 0 1 0.880,0.800",
    ],
  },
  flat: rect(),
};

/**
 * ROOF is a plan view: a rounded rectangle, cab glass forward. HOOD is a
 * trapezoid narrowing toward the windshield. FRONT and REAR are the vehicle's
 * face — kept deliberately plain, since their artwork is small and detail
 * strokes would compete with it at proof scale.
 */
const PLAN = {
  "DRIVER SIDE": null,
  "PASSENGER SIDE": null,
  ROOF: {
    silhouette:
      "M0.070,0.030 L0.930,0.030 L0.975,0.120 L0.975,0.880 L0.930,0.970 " +
      "L0.070,0.970 L0.025,0.880 L0.025,0.120 Z",
    details: ["M0.180,0.030 L0.180,0.970", "M0.560,0.030 L0.560,0.970"],
  },
  HOOD: {
    silhouette: "M0.090,0.965 L0.910,0.965 L0.815,0.035 L0.185,0.035 Z",
    details: ["M0.185,0.290 L0.815,0.290"],
  },
  FRONT: {
    silhouette:
      "M0.060,0.930 L0.070,0.300 L0.180,0.120 L0.820,0.120 L0.930,0.300 " +
      "L0.940,0.930 Z",
    details: ["M0.150,0.330 L0.850,0.330"],
  },
  REAR: {
    silhouette:
      "M0.060,0.940 L0.060,0.160 L0.140,0.070 L0.860,0.070 L0.940,0.160 " +
      "L0.940,0.940 Z",
    details: ["M0.500,0.070 L0.500,0.940"],
  },
};

/**
 * The template for one side of one vehicle. `mirrored` tells the compositor to
 * flip the path horizontally — PASSENGER SIDE reuses the driver geometry so the
 * proof can never show two differently-proportioned flanks of one truck.
 */
function vehicleProofTemplate(vehicleType, view) {
  const key = String(view || "").trim().toUpperCase();
  const family = bodyFamilyFor(vehicleType);

  if (key === "DRIVER SIDE" || key === "PASSENGER SIDE") {
    const side = SIDE[family] || rect();
    return { ...side, bodyFamily: family, mirrored: key === "PASSENGER SIDE" };
  }

  // Trailers and other flat products stay rectangular on every view: there is
  // no cab, hood or roof to draw, and inventing one would misdescribe the
  // product the customer is buying.
  if (family === "flat") return { ...rect(), bodyFamily: family, mirrored: false };

  const plan = PLAN[key];
  return plan ? { ...plan, bodyFamily: family, mirrored: false } : { ...rect(), bodyFamily: family, mirrored: false };
}

/**
 * Emit the clip path + detail strokes for one placed tile, in SHEET pixel
 * space. Returns SVG fragments the proof sheet appends; the artwork itself is
 * clipped by the worker using `clipId`.
 */
function vehicleProofSvg(template, x, y, w, h) {
  const map = (path) =>
    path.replace(
      /([ML])\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)|A\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s+(\d+)\s+(\d)\s+(\d)\s+(-?[\d.]+)\s*,\s*(-?[\d.]+)/g,
      (
        _m,
        cmd,
        px,
        py,
        rx,
        ry,
        rot,
        large,
        sweep,
        ax,
        ay,
      ) => {
        const toX = (v) => (template.mirrored ? x + w - v * w : x + v * w).toFixed(2);
        const toY = (v) => (y + v * h).toFixed(2);
        if (cmd) return `${cmd}${toX(Number(px))},${toY(Number(py))}`;
        const sweepFlag = template.mirrored ? (sweep === "1" ? "0" : "1") : sweep;
        return (
          `A${(Number(rx) * w).toFixed(2)},${(Number(ry) * h).toFixed(2)} ` +
          `${rot} ${large} ${sweepFlag} ${toX(Number(ax))},${toY(Number(ay))}`
        );
      },
    );

  const silhouette = `${map(template.silhouette)} Z`;
  const overlay = [
    // The outline itself, so the elevation reads as a drawn vehicle.
    `<path d="${map(template.silhouette)} Z" fill="none" stroke="#111111" stroke-width="2.5"/>`,
    ...template.details.map(
      (d) =>
        `<path d="${map(d)}" fill="none" stroke="#111111" stroke-width="1.6" stroke-opacity="0.75"/>`,
    ),
  ];
  return { silhouette, overlay, rectangular: Boolean(template.rectangular) };
}

module.exports = { bodyFamilyFor, vehicleProofTemplate, vehicleProofSvg };
