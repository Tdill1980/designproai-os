/**
 * FROZEN OFFLINE FIXTURE. No provider call, no database, no network.
 *
 * THE FIELD STANDS IN FOR THE ONE GEMINI CALL. It is deliberately authored the
 * way the real call must be: ONE continuous oversized composition of
 * background, imagery, texture, ribbons and visual language, carrying NO
 * company name, NO phone number, NO website and NO logo. That absence is what
 * makes cropping it safe -- there is nothing protected in it to clip.
 *
 * It is built from deterministic vector geometry so two runs produce identical
 * bytes, which is the property the compile is being measured on.
 */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const sharp = require("../../runtime/node_modules/sharp");

export const sha256 = (b) => createHash("sha256").update(b).digest("hex");

/** The recorded Precision Climate Solutions 2022 Ford F-250 Crew Cab geometry. */
export const GENIE_TRIM = Object.freeze({
  driver: [153, 56], passenger: [153, 56], hood: [71.5, 56],
  roof: [74.3, 54.8], front: [129, 34], rear: [76, 54],
});
export const BLEED_INCHES = 5;
export const VEHICLE = Object.freeze({ year: 2022, make: "Ford", model: "F-250", configuration: "Crew Cab", type: "truck" });

/** Exact customer strings. Code owns spelling; the model never sees them. */
export const CUSTOMER = Object.freeze({
  company: "Precision Climate Solutions",
  phone: "555-0142",
  domain: "precisionclimate.com",
});

export const FONT_PATH = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf";
export const FIELD = Object.freeze({ width: 6144, height: 6144 });

export function genieSurfaces() {
  return Object.entries(GENIE_TRIM).map(([surfaceKey, [w, h]]) => ({
    surfaceKey, widthInches: w, heightInches: h,
  }));
}

/**
 * The continuous creative field: deep-blue depth ramp, layered diagonal energy
 * ribbons, a soft radial bloom and a fine texture. Vector only, so it is
 * reproducible to the byte and has no anatomy, no lettering and no marks.
 */
function fieldSvg({ width, height }) {
  const ribbons = [];
  for (let i = 0; i < 9; i += 1) {
    const y = Math.round(height * (0.08 + i * 0.098));
    const amp = 220 + i * 34;
    const op = (0.16 + (i % 3) * 0.05).toFixed(3);
    const thick = 90 + (i % 4) * 46;
    ribbons.push(
      `<path d="M ${-200} ${y} C ${width * 0.28} ${y - amp}, ${width * 0.62} ${y + amp}, ${width + 200} ${y - amp * 0.4}" ` +
      `fill="none" stroke="url(#ribbon)" stroke-opacity="${op}" stroke-width="${thick}" stroke-linecap="round"/>`,
    );
  }
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="ground" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#071a3a"/><stop offset="0.45" stop-color="#0e3f7e"/>
      <stop offset="0.78" stop-color="#1663a8"/><stop offset="1" stop-color="#0a2c56"/>
    </linearGradient>
    <linearGradient id="ribbon" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#7fd4ff" stop-opacity="0"/><stop offset="0.35" stop-color="#8fe0ff"/>
      <stop offset="0.7" stop-color="#3ea8f0"/><stop offset="1" stop-color="#7fd4ff" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="bloom" cx="0.66" cy="0.3" r="0.6">
      <stop offset="0" stop-color="#bfe9ff" stop-opacity="0.30"/><stop offset="1" stop-color="#bfe9ff" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grain" width="6" height="6" patternUnits="userSpaceOnUse">
      <rect width="6" height="6" fill="none"/>
      <circle cx="1.5" cy="1.5" r="0.7" fill="#ffffff" fill-opacity="0.035"/>
      <circle cx="4.5" cy="4.5" r="0.6" fill="#000000" fill-opacity="0.045"/>
    </pattern>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#ground)"/>
  ${ribbons.join("\n  ")}
  <rect width="${width}" height="${height}" fill="url(#bloom)"/>
  <rect width="${width}" height="${height}" fill="url(#grain)"/>
</svg>`,
  );
}

/** The approved logo. Its bytes are its identity; nothing may redraw it. */
function logoSvg() {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="320" viewBox="0 0 480 160">
  <rect x="4" y="4" width="472" height="152" rx="16" fill="#ffffff"/>
  <rect x="16" y="16" width="448" height="128" rx="9" fill="#0b2f6b"/>
  <path d="M50 120 L94 40 L138 120 Z" fill="#38bdf8"/>
  <circle cx="188" cy="80" r="30" fill="none" stroke="#38bdf8" stroke-width="10"/>
  <rect x="236" y="50" width="204" height="13" rx="6" fill="#e2f2ff"/>
  <rect x="236" y="74" width="164" height="13" rx="6" fill="#9ecbff"/>
  <rect x="236" y="98" width="124" height="13" rx="6" fill="#5aa9ef"/>
</svg>`,
  );
}

export async function buildFixture() {
  const fieldBytes = await sharp(fieldSvg(FIELD), { limitInputPixels: false })
    .png({ compressionLevel: 6, adaptiveFiltering: false, palette: false, force: true }).toBuffer();
  const logoBytes = await sharp(logoSvg())
    .png({ compressionLevel: 6, adaptiveFiltering: false, palette: false, force: true }).toBuffer();
  const fontBytes = readFileSync(FONT_PATH);
  return {
    fieldBytes, fieldHash: sha256(fieldBytes),
    logoBytes, logoHash: sha256(logoBytes),
    fontBytes, fontHash: sha256(fontBytes),
  };
}

/**
 * Where the protected content sits on each surface, in inches from the print
 * box origin. Fixture values: a human chose them for this proof. They are not
 * presented as validated vehicle safe zones, and no obstruction data is implied.
 */
export function contentPlan({ logoBytes, logoHash }) {
  const P = (k) => ({ w: GENIE_TRIM[k][0] + BLEED_INCHES * 2, h: GENIE_TRIM[k][1] + BLEED_INCHES * 2 });
  const white = "#ffffff";

  const text = [
    { surfaceKey: "driver", string: CUSTOMER.company, sizeIn: 10, fill: white, rect: { xIn: 14, yIn: 24, widthIn: 136, heightIn: 15 } },
    { surfaceKey: "driver", string: CUSTOMER.phone, sizeIn: 7, fill: white, rect: { xIn: 14, yIn: 43, widthIn: 60, heightIn: 11 } },
    // Passenger carries the same canonical strings on the opposite hand, so the
    // two flanks read as one design without being one image.
    { surfaceKey: "passenger", string: CUSTOMER.company, sizeIn: 10, fill: white, rect: { xIn: P("passenger").w - 150, yIn: 24, widthIn: 136, heightIn: 15 } },
    { surfaceKey: "passenger", string: CUSTOMER.phone, sizeIn: 7, fill: white, rect: { xIn: P("passenger").w - 150, yIn: 43, widthIn: 60, heightIn: 11 } },
    { surfaceKey: "rear", string: CUSTOMER.domain, sizeIn: 5, fill: white, rect: { xIn: 11, yIn: 44, widthIn: 64, heightIn: 8 } },
  ];

  const logos = [
    { surfaceKey: "driver", identityKey: "primary-mark", bytes: logoBytes, contentHash: logoHash, rect: { xIn: 14, yIn: 6, widthIn: 42, heightIn: 14 } },
    { surfaceKey: "passenger", identityKey: "primary-mark", bytes: logoBytes, contentHash: logoHash, rect: { xIn: P("passenger").w - 56, yIn: 6, widthIn: 42, heightIn: 14 } },
    { surfaceKey: "hood", identityKey: "primary-mark", bytes: logoBytes, contentHash: logoHash, rect: { xIn: 20, yIn: 22, widthIn: 42, heightIn: 14 } },
  ];

  return { text, logos };
}
