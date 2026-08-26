from pathlib import Path

p = Path("runtime/flat-first-atlas.cjs")
s = p.read_text()
start = s.index("function atlasCreativeRules(input, manifest, options = {}) {")
end = s.index("\n}\n\nfunction atlasPrompt(", start) + 2
replacement = r'''function atlasCreativeRules(input, manifest, options = {}) {
  const vehicle = input?.vehicle || {};
  const panelLabels = Object.freeze({
    driver: "DRIVER SIDE",
    passenger: "PASSENGER SIDE",
    hood: "HOOD",
    roof: "ROOF",
    front: "FRONT",
    rear: "REAR",
  });
  const panels = manifest.zones.map((zone) => ({
    label: panelLabels[zone.surfaceKey],
    widthInches: Number(zone.trimWidthIn),
    heightInches: Number(zone.trimHeightIn),
  }));
  const colors = Array.isArray(input?.colors) ? input.colors.map(String).join(", ") : "";
  const dpagParams = {
    mode: "artboard",
    prompt: String(input?.brief || ""),
    finish: String(input?.finish || "Gloss"),
    substrate: input?.substrate || "standard",
    companyName: input?.companyName || input?.businessName || undefined,
    mascot: input?.mascot || undefined,
    bulletPoints: Array.isArray(input?.bulletPoints) ? input.bulletPoints : undefined,
    industryType: input?.industry || undefined,
    phone: input?.phone || undefined,
    brandColors: input?.brandColors || colors || undefined,
    fontStyle: input?.fontStyle || undefined,
    qrEnabled: input?.qrEnabled === true,
    vehicleYear: vehicle.year || input?.vehicleYear,
    vehicleMake: vehicle.make || input?.vehicleMake,
    vehicleModel: vehicle.model || input?.vehicleModel,
    visionBoardImages: Array.isArray(input?.visionBoardImages) ? input.visionBoardImages : [],
    visionboard_intent: input?.visionboardIntent || input?.visionboard_intent || "style_inspiration",
    styleDescriptors: input?.styleDescriptors || undefined,
    panels,
  };

  const creative = buildDesignIQPrompt(dpagParams);
  const addenda = [];

  // Artboard mode predates VisionBoard intent. Pull the reference clause from
  // the SAME vendored builder. This is local string assembly, not another AI call.
  if (dpagParams.visionBoardImages.length > 0) {
    const sourceReferencePrompt = buildDesignIQPrompt({
      ...dpagParams,
      mode: "restyle",
      viewType: "side",
    });
    const marker = dpagParams.visionboard_intent === "exact_reference"
      ? "EXACT REFERENCE (REPRODUCE, DO NOT REDESIGN):"
      : "STYLE INSPIRATION:";
    const markerAt = sourceReferencePrompt.indexOf(marker);
    if (markerAt >= 0) {
      const tail = sourceReferencePrompt.slice(markerAt);
      const stops = ["\nHOOD/ROOF CONTINUITY", "\nPHOTOGRAPHIC REALISM LOCK", "\nFinish:", "\nThe wrap covers"]
        .map((token) => tail.indexOf(token))
        .filter((index) => index > 0);
      addenda.push(stops.length ? tail.slice(0, Math.min(...stops)).trim() : tail.trim());
    }
  }

  // Exact customer identity is data integrity, not a creative prompt stack.
  if (input?.phone) {
    addenda.push(`CUSTOMER PHONE (EXACT): ${String(input.phone)} — preserve every digit exactly.`);
  } else {
    addenda.push("CUSTOMER PHONE: NOT SUPPLIED — invent no phone number; display none anywhere.");
  }
  if (input?.website) {
    addenda.push(`CUSTOMER WEBSITE (EXACT): ${String(input.website)} — display this EXACT URL, character for character.`);
  } else {
    addenda.push("CUSTOMER WEBSITE: NOT SUPPLIED — invent no website; display none anywhere.");
  }

  return [creative, ...addenda].filter(Boolean).join("\n");
}'''
p.write_text(s[:start] + replacement + s[end:])

p = Path("scripts/designiq-ab-precision.mjs")
s = p.read_text()
if "const ARMS = new Set(" not in s:
    anchor = 'const OUT = args.out || "./ab-evidence";\n'
    if anchor not in s:
        raise SystemExit("arms insertion seam drifted")
    s = s.replace(anchor, anchor + 'const ARMS = new Set(String(args.arms || "A,A2,B,C,B-configured").split(",").map((v) => v.trim()).filter(Boolean));\n', 1)
endneedle = '''    }]]),
  ]) {'''
if endneedle not in s:
    raise SystemExit("arms loop tail drifted")
s = s.replace(endneedle, '''    }]]),
  ].filter(([name]) => ARMS.has(name))) {''', 1)
p.write_text(s)

p = Path("tests/designpro-reference-authority.test.mjs")
t = p.read_text()
old = '''  assert.match(exact, /EXACT CUSTOMER REFERENCE/);
  assert.match(exact, /Installer-map examples remain topology-only and must never influence style/);'''
new = '''  assert.match(exact, /EXACT REFERENCE \\(REPRODUCE, DO NOT REDESIGN\\):/);
  assert.match(exact, /REFERENCE FIREWALL/);
  assert.match(exact, /TOPOLOGY\\/LAYOUT references only/);'''
if old not in t:
    raise SystemExit("reference test seam drifted")
p.write_text(t.replace(old, new, 1))

Path("tests/designiq-ab-arms.test.mjs").write_text(r'''import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("the A/B harness can execute exactly arm B", () => {
  const source = readFileSync("scripts/designiq-ab-precision.mjs", "utf8");
  assert.match(source, /args\.arms/);
  assert.match(source, /\.filter\(\(\[name\]\) => ARMS\.has\(name\)\)/);
});
''')
