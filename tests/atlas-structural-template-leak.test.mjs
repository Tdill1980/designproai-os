import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const runtimeRequire = createRequire(new URL("../runtime/package.json", import.meta.url));
const sharp = runtimeRequire("sharp");
const { deterministicMasterChecks } = require("../runtime/atlas-master-qc.cjs");

const surfaceKeys = ["driver", "passenger", "hood", "roof", "front", "rear"];
const manifest = {
  zones: surfaceKeys.map((surfaceKey, index) => ({
    surfaceKey,
    x: (index % 3) * 160,
    y: Math.floor(index / 3) * 120,
    w: 160,
    h: 120,
    extraction: { outputRotationDegrees: 0 },
  })),
};

function baseArtwork(extra = "") {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120">
    <rect width="160" height="120" fill="#075985"/>
    <path d="M0 76 C38 28 102 104 160 34 L160 120 L0 120 Z" fill="#0ea5e9"/>
    <path d="M0 102 C48 54 108 118 160 66 L160 120 L0 120 Z" fill="#f97316"/>
    ${extra}
  </svg>`;
}

async function sheet(tileForSurface) {
  const composites = [];
  for (const zone of manifest.zones) {
    composites.push({
      input: await sharp(Buffer.from(tileForSurface(zone.surfaceKey))).png().toBuffer(),
      left: zone.x,
      top: zone.y,
    });
  }
  return sharp({
    create: { width: 480, height: 240, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(composites).png().toBuffer();
}

test("mirrored flank arch/gutters plus repeated centre frames block an opaque template leak", async () => {
  const bytes = await sheet((surfaceKey) => {
    if (surfaceKey === "driver") {
      return baseArtwork(`
        <rect x="7" width="4" height="120" fill="#000000"/>
        <rect x="13" width="22" height="120" fill="#ffffff"/>
        <circle cx="62" cy="120" r="27" fill="#ffffff" stroke="#000000" stroke-width="5"/>
      `);
    }
    if (surfaceKey === "passenger") {
      return baseArtwork(`
        <rect x="149" width="4" height="120" fill="#000000"/>
        <rect x="125" width="22" height="120" fill="#ffffff"/>
        <circle cx="98" cy="120" r="27" fill="#ffffff" stroke="#000000" stroke-width="5"/>
      `);
    }
    if (surfaceKey === "roof" || surfaceKey === "rear") {
      return baseArtwork(`
        <rect y="99" width="160" height="4" fill="#000000"/>
        <rect y="105" width="160" height="15" fill="#ffffff"/>
      `);
    }
    return baseArtwork();
  });

  const result = await deterministicMasterChecks(bytes, manifest);

  assert.equal(result.accepted, false);
  assert.equal(result.structuralTemplateLeak.convicted, true);
  assert.equal(result.structuralTemplateLeak.mirroredFlankGutters, true);
  assert.deepEqual(result.structuralTemplateLeak.centerSurfaces, ["roof", "rear"]);
  assert.match(result.blockingFailures.join("; "), /structural template frame leaked/);
  assert.deepEqual(
    result.cutoutFindings,
    [],
    "opaque white anatomy is a structural master failure, not something the dark cut-out fill may repaint",
  );
});

test("a legitimate white-base livery is not treated as leaked template anatomy", async () => {
  const bytes = await sheet(() => `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120">
    <rect width="160" height="120" fill="#ffffff"/>
    <path d="M-20 94 C35 14 104 116 180 28 L180 72 C108 142 36 42 -20 118 Z" fill="#0ea5e9"/>
    <path d="M-10 108 C48 44 108 126 174 64 L174 86 C108 146 42 70 -10 126 Z" fill="#fb7185"/>
    <rect x="45" y="47" width="70" height="18" rx="7" fill="#1e3a8a"/>
  </svg>`);

  const result = await deterministicMasterChecks(bytes, manifest);

  assert.equal(result.accepted, true, result.failures.join("; "));
  assert.equal(result.structuralTemplateLeak.convicted, false);
  assert.equal(result.blockingFailures.length, 0);
});
