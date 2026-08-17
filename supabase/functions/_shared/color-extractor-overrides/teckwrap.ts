import { ExtractedColor } from "../color-extractor-types.ts";
import { normalizeColor } from "../color-extractor-utils.ts";

// TeckWrap Extractor (all series)
// https://teckwrap.com/collections/all-products

export async function parse($: any, sourceUrl: string): Promise<ExtractedColor[]> {
  const colors: ExtractedColor[] = [];

  //
  // PATTERN 1 — New TeckWrap product grid
  //
  $(".grid-product, .grid-product__wrapper").each((_i: number, el: any) => {
    const block = $(el);

    const name =
      block.find(".grid-product__title").text().trim() ||
      block.find(".title").text().trim() ||
      null;

    if (!name) return;

    const link = block.find("a").attr("href") || null;
    const absoluteUrl = link?.startsWith("http")
      ? link
      : link
      ? `https://teckwrap.com${link}`
      : null;

    const swatchUrl =
      block.find("img.grid-product__image").attr("src") ||
      block.find("img").attr("src") ||
      null;

    // Extract code (TeckWrap doesn't publish formal codes — generate stable one)
    const code = name.toUpperCase().replace(/\s+/g, "_");

    // Detect finish (Gloss, Matte, Satin, Chrome, Neon)
    let finish = "Gloss";
    const n = name.toLowerCase();
    if (n.includes("matte")) finish = "Matte";
    if (n.includes("satin")) finish = "Satin";
    if (n.includes("chrome")) finish = "Chrome";
    if (n.includes("neon")) finish = "Neon";
    if (n.includes("metallic")) finish = "Metallic";

    // Infer series from keywords
    let series = "TeckWrap";
    if (n.includes("chrome")) series = "Super Chrome";
    if (n.includes("glitter")) series = "Glitter";
    if (n.includes("brushed")) series = "Brushed";
    if (n.includes("camo")) series = "Camouflage";

    const color = normalizeColor(
      {
        code,
        name,
        series,
        finish,
        swatchUrl,
        imageUrl: swatchUrl,
      },
      "TeckWrap",
      sourceUrl
    );

    colors.push(color);
  });

  //
  // PATTERN 2 — Legacy product card layout
  //
  if (colors.length === 0) {
    $(".product-item").each((_i: number, el: any) => {
      const block = $(el);

      const name =
        block.find(".product-item__title").text().trim() ||
        block.find("p").text().trim() ||
        null;

      if (!name) return;

      const swatchUrl =
        block.find("img").attr("src") ||
        block.find("img").attr("data-src") ||
        null;

      const code = name.toUpperCase().replace(/\s+/g, "_");

      const color = normalizeColor(
        {
          code,
          name,
          series: "TeckWrap",
          finish: "Gloss",
          swatchUrl,
          imageUrl: swatchUrl,
        },
        "TeckWrap",
        sourceUrl
      );

      colors.push(color);
    });
  }

  //
  // PATTERN 3 — Color tile blocks (fallback)
  //
  if (colors.length === 0) {
    $(".color-tile, .swatch-tile, [data-title]").each((_i: number, el: any) => {
      const block = $(el);

      const name =
        block.attr("data-title") ||
        block.attr("title") ||
        block.find(".color-name").text().trim() ||
        null;

      if (!name) return;

      const bg = block.css("background-image");
      let swatchUrl = null;

      if (bg) {
        swatchUrl = bg.replace(/url\(['"]?(.+?)['"]?\)/, "$1");
      }

      const code = name.toUpperCase().replace(/\s+/g, "_");

      const color = normalizeColor(
        {
          code,
          name,
          series: "TeckWrap",
          finish: "Gloss",
          swatchUrl,
          imageUrl: swatchUrl,
        },
        "TeckWrap",
        sourceUrl
      );

      colors.push(color);
    });
  }

  return colors;
}
