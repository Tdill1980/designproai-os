import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const sharp = require("../../runtime/node_modules/sharp");
const OUT = join(import.meta.dirname, "out");
const KEYS = ["driver", "passenger", "hood", "roof", "front", "rear"];
const W = 1560, PAD = 12, LEFT = 660;
const tiles = [];
tiles.push({ input: await sharp(readFileSync(join(OUT, "atlas-master.png"))).resize(LEFT - PAD, LEFT - PAD, { fit: "contain", background: "#101014" }).png().toBuffer(), left: PAD, top: PAD });
let y = PAD; const pw = W - LEFT - PAD * 2;
for (const k of KEYS) {
  const b = readFileSync(join(OUT, `panel-${k}.png`));
  const m = await sharp(b).metadata();
  const h = Math.max(26, Math.round(pw * m.height / m.width));
  tiles.push({ input: await sharp(b).resize(pw, h, { fit: "fill" }).png().toBuffer(), left: LEFT + PAD, top: y });
  y += h + 8;
}
const H = Math.max(LEFT + PAD, y + PAD);
writeFileSync(join(OUT, "contact-sheet.png"),
  await sharp({ create: { width: W, height: H, channels: 4, background: "#0a0a0c" } }).composite(tiles).png().toBuffer());
console.log("contact sheet", W + "x" + H, "| panels top->bottom:", KEYS.join(", "));
