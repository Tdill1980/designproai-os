import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const sharp = require("../../runtime/node_modules/sharp");
const OUT = join(import.meta.dirname, "out");
const KEYS = ["driver","passenger","hood","roof","front","rear"];
const W = 1500, PAD = 10;
const tiles = [];
let y = PAD;
// atlas master on top
const atlasT = await sharp(readFileSync(join(OUT,"atlas-master.png"))).resize(700,700,{fit:"contain",background:"#111"}).png().toBuffer();
tiles.push({input: atlasT, left: PAD, top: y});
// panels stacked to its right
let py = y; const pw = W - 700 - PAD*3;
for (const k of KEYS) {
  const b = readFileSync(join(OUT,`panel-${k}.png`));
  const m = await sharp(b).metadata();
  const h = Math.max(24, Math.round(pw * m.height / m.width));
  const t = await sharp(b).resize(pw, h, {fit:"fill"}).png().toBuffer();
  tiles.push({input: t, left: 700 + PAD*2, top: py});
  py += h + 6;
}
const H = Math.max(700 + PAD*2, py + PAD);
const sheet = await sharp({create:{width:W,height:H,channels:4,background:"#0b0b0e"}}).composite(tiles).png().toBuffer();
writeFileSync(join(OUT,"contact-sheet.png"), sheet);
console.log("contact sheet", W+"x"+H, "panels top→bottom:", KEYS.join(", "));
