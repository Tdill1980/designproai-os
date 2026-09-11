/**
 * Deno test for the cut-contour producer (needs network for esm.sh/deno.land):
 *
 *   deno test --allow-net --allow-read supabase/functions/_shared/cut-contour/produce.test.ts
 *
 * Builds a synthetic "graphics kit" — a logo disc, a three-letter word, a
 * tall stripe — on white, runs the producer at a known print size, and
 * checks the WPW contract on the bytes that come out.
 */
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { assert, assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PDFDocument, PDFRawStream, decodePDFRawStream } from "https://esm.sh/pdf-lib@1.17.1";
import { produceCutContour, CUT_CONTOUR_SPOT } from "./produce.ts";

/** pdf-lib Flate-compresses page content; read the operators back out. */
async function pageOperators(pdf: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(pdf);
  const page = doc.getPage(0);
  const contents = page.node.Contents();
  const streams = contents instanceof PDFRawStream ? [contents] : (contents as any).asArray().map((r: any) => doc.context.lookup(r));
  return streams.map((s: PDFRawStream) => new TextDecoder("latin1").decode(decodePDFRawStream(s).decode())).join("\n");
}

function fixture(): Promise<Uint8Array> {
  const img = new Image(1200, 600);
  img.fill(0xffffffff);
  const fillRect = (x0: number, y0: number, w: number, h: number, color: number) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) img.setPixelAt(x + 1, y + 1, color);
  };
  const fillDisc = (cx: number, cy: number, r: number, color: number) => {
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) img.setPixelAt(x + 1, y + 1, color);
    }
  };
  fillDisc(200, 200, 120, 0xc81e1eff);             // logo
  fillDisc(200, 200, 40, 0xffffffff);              // its counter (a hole)
  fillRect(500, 150, 60, 100, 0x14288fff);         // "word": three letters
  fillRect(580, 150, 60, 100, 0x14288fff);
  fillRect(660, 150, 60, 100, 0x14288fff);
  fillRect(100, 450, 1000, 40, 0x14288fff);        // a long stripe
  return img.encode();
}

Deno.test("produces a three-layer CutContour PDF and SVG, nested within the cut-contour height", async () => {
  const png = await fixture();
  const result = await produceCutContour(png, { widthIn: 60, bleedIn: 0.25, label: "Test kit", substrate: "printed" });

  assertEquals(result.elements.length, 3, "logo, word, stripe");
  const logo = result.elements[0];
  assertEquals(logo.cutPaths, 2, "silhouette + counter");
  assert(logo.widthIn > 11.5 && logo.widthIn < 12.5, `logo ≈ 12 in wide, got ${logo.widthIn}`);
  const word = result.elements[1];
  assertEquals(word.cutPaths, 3, "three letters, one element");
  assert(result.sheet.heightIn <= 51.5);
  assert(result.sheet.widthIn > 0);
  assertEquals(result.layers, ["CutContour", "Artwork", "Bleed"]);
  assertEquals(result.spot, CUT_CONTOUR_SPOT);

  const pdfText = new TextDecoder("latin1").decode(result.pdf);
  assertMatch(pdfText, /\/Separation \/CutContour \/DeviceCMYK/);
  assertMatch(pdfText, /\/C1 \[ 0 1 0 0 \]/);
  assertMatch(pdfText, /\/OCProperties/);
  assertMatch(pdfText, /\/Name \(CutContour\)/);
  assert(pdfText.includes("/Subtype /Image"), "artwork is embedded");
  const ops = await pageOperators(result.pdf);
  assertMatch(ops, /\/CutContour CS\s+1 SCN\s+0\.25 w/, "cut line is a 0.25 pt stroke in the CutContour spot");
  assertMatch(ops, /\/OC \/OC0 BDC/, "layers are marked optional content");
  assert(!/\/CutContour CS[\s\S]*?\bf\b/.test(ops.split("/CutContour CS")[1].split("EMC")[0]), "the cut layer never fills");

  assertMatch(result.svg, /<g id="Bleed">/);
  assertMatch(result.svg, /<g id="Artwork">/);
  assertMatch(result.svg, /<g id="CutContour" fill="none" stroke="#FF00FF" stroke-width="0\.25"/);
  assertMatch(result.svg, /data-cmyk="0,100,0,0"/);
  assertEquals((result.svg.match(/<path id="cut-element-/g) || []).length, 3);
});

Deno.test("Manufacture Film Cut adds one hidden layer per film colour", async () => {
  const png = await fixture();
  const result = await produceCutContour(png, { widthIn: 60, substrate: "cut", label: "Films" });
  const films = result.elements.flatMap((e) => e.films);
  assert(films.length >= 3, `expected a film per element, got ${films.length}`);
  assert(result.layers.some((l) => l.startsWith("Film 1 ")));
  const pdfText = new TextDecoder("latin1").decode(result.pdf);
  assertMatch(pdfText, /\/OFF \[/);
  assertMatch(result.svg, /data-film="#/);
});

Deno.test("a design wider than the plotter is flagged for tiling, never silently shrunk", async () => {
  const img = new Image(1200, 600);
  img.fill(0xffffffff);
  for (let y = 20; y < 580; y++) for (let x = 20; x < 1180; x++) img.setPixelAt(x + 1, y + 1, 0x101010ff);
  const result = await produceCutContour(await img.encode(), { widthIn: 260, heightIn: 130 });
  assert(result.reviewFlags.some((f) => f.startsWith("oversize:")), result.reviewFlags.join("; "));
  assert(result.sheet.widthIn >= 250, "the sheet keeps the real size");
  assertEquals(result.scale, 0.1, "beyond the 200\" PDF page limit the file drops to 10% scale, like the WPW guide");
  assertMatch(result.svg, /data-scale="0\.1"/);
  assertMatch(new TextDecoder("latin1").decode(result.pdf), /\/MediaBox \[ 0 0 \d/);
});
