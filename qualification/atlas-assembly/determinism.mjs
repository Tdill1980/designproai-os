/** One clean process, one render. Printed as JSON so a second process can be diffed against it. */
import { runQualification } from "./run-qualification.mjs";
const r = await runQualification({ pxPerInch: 18, writeArtifacts: false, label: process.argv[2] || "x" });
console.log(JSON.stringify({
  designMasterHash: r.designMasterHash,
  renderHash: r.renderHash,
  masterContentHash: r.masterContentHash,
  compositionHash: r.compositionHash,
  surfaces: r.rendered.surfaces.map((s) => ({ k: s.surfaceKey, h: s.contentHash })),
  panels: r.panels.map((p) => ({ k: p.surfaceKey, h: p.contentHash, b: p.byteSize })),
}));
