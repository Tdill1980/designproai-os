import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const api = read("app/src/lib/designpro-api.ts");
const adapter = read("app/src/lib/designpanelpro-standalone-adapter.ts");
const hook = read("app/src/hooks/useDesignPanelProLogic.ts");

const DESIGNIQ_FIELDS = [
  "finish", "substrate", "mascot", "bulletPoints", "brandColors",
  "fontStyle", "qrEnabled", "qrUrl", "visionBoardImages",
  "visionboardIntent", "textLayerPrompt",
];

test("the restored customer hook carries every existing DesignIQ control into one standalone request", () => {
  for (const field of DESIGNIQ_FIELDS) {
    assert.match(hook, new RegExp(`${field}(?::|,)`), `hook dropped ${field}`);
    assert.match(adapter, new RegExp(`${field}: input\\.${field}`), `adapter dropped ${field}`);
    if (field !== "visionBoardImages") {
      assert.match(api, new RegExp(`input\\.${field} = options\\.brief\\.${field}`), `encoder dropped ${field}`);
    }
  }
  assert.match(hook, /const combinedContact = classifyDesignIqCombinedContact\(params\.phone\)/);
  assert.match(hook, /website: explicitWebsite\(params\) \|\| combinedContact\.website/);
  assert.match(hook, /phone: combinedContact\.phone/);
  assert.match(hook, /companyName: params\.companyName\?\.trim\(\)/);
  // The restored UI choice is authoritative. Inference remains only for older
  // callers that omitted the field.
  assert.match(hook, /import \{ inferDesignMode \} from "@\/lib\/inferDesignMode"/);
  assert.match(hook, /mode: params\.mode \|\| inferDesignMode\(\{/);
  assert.ok(!/mode: params\.companyName\?\.trim\(\)/.test(hook),
    "the hook re-decides the mode locally again");
});

test("VisionBoard references are uploaded and verified before identity enters Calls 1-7", () => {
  assert.match(hook, /verifyVisionBoardAssets/);
  assert.match(hook, /dpApi\.uploadRevisionAsset\([\s\S]*?"attachment"/);
  assert.match(hook, /Promise\.all\(\[\s*verifyLogoAsset[\s\S]*?verifyVisionBoardAssets/);
  assert.match(api, /visionBoardImages = options\.brief\.visionBoardImages\.map/);
  assert.match(api, /storagePath: asset\.storagePath/);
  assert.match(api, /contentHash: asset\.contentHash/);
  assert.doesNotMatch(
    api.match(/if \(options\.brief\.visionBoardImages\?\.length\)[\s\S]*?\n  \}/)?.[0] || "",
    /signedUrl|publicUrl|storageUrl/,
  );
  assert.match(hook, /RUNTIME_VISIONBOARD_IMAGE_TYPES = new Map/);
  assert.match(hook, /normalizeVisionBoardImage\(blob, safeLabel\)/);
  assert.match(hook, /normalizeLogoAsset\(blob\)/);
  assert.match(hook, /canvas\.toBlob\([\s\S]*?"image\/png"/);
  assert.match(hook, /new File\(\[png\], `\$\{label\}\.png`, \{ type: "image\/png" \}\)/);
});

test("the Atlas preview watcher waits for a signed master, not a metadata row", () => {
  assert.match(hook, /const latest = revisions\[revisions\.length - 1\]/);
  assert.match(hook, /return latest\?\.masterUrl \? 240_000 : 2_000/);
  assert.doesNotMatch(hook, /query\.state\.data\?\.length \? 240_000 : 2_000/);
});
