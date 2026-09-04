/** One clean process, one compile. Hashes as JSON, for byte comparison. */
import { compileOnce } from "./compile.mjs";
const r = await compileOnce({ writeArtifacts: false });
console.log(JSON.stringify({
  field: r.compiled.field.sourceHash,
  master: r.compiled.masterContentHash,
  windows: r.compiled.surfaces.map((s) => ({ k: s.surfaceKey, h: s.contentHash })),
  panels: r.panels.map((p) => ({ k: p.surfaceKey, h: p.contentHash, b: p.byteSize })),
}));
