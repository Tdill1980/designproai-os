// FlexiShield Color PPF Extractor
// https://www.flexishieldusa.com/color-ppf

import { ExtractedColor } from "../color-extractor-types.ts";
import { normalizeColor } from "../color-extractor-utils.ts";

export async function parse($: any, sourceUrl: string): Promise<ExtractedColor[]> {
  const colors: ExtractedColor[] = [];

  // Pattern 1 — FlexiShield product grid
  $(".product-item, .product-card, .collection-product").each((_i: number, el: any) => {
    const block = $(el);

    const name =
      block.find("h2").text().trim() ||
      block.find(".product-title").text().trim() ||
      block.find("h3").text().trim() ||
      null;

    if (!name) return;

    const link = block.find("a").attr("href") || null;
    const absoluteUrl = link?.startsWith("http")
      ? link
      : link
      ? `https://www.flexishieldusa.com${link}`
      : null;

    const swatchUrl =
      block.find("img").attr("src") ||
      block.find("img").attr("data-src") ||
      null;

    // FlexiShield doesn't use codes — generate stable one
    const code = name.toUpperCase().replace(/\s+/g, "_");

    // Detect finish
    let finish = "Gloss";
    const n = name.toLowerCase();
    if (n.includes("matte")) finish = "Matte";
    if (n.includes("satin")) finish = "Satin";
    if (n.includes("metallic")) finish = "Metallic";
    if (n.includes("pearl")) finish = "Pearl";
    if (n.includes("flip") || n.includes("shift")) finish = "Color Shift";

    const series = "Color PPF";

    const color = normalizeColor(
      {
        code,
        name,
        series,
        finish,
        swatchUrl,
        imageUrl: swatchUrl,
      },
      "FlexiShield",
      sourceUrl
    );

    colors.push(color);
  });

  // Pattern 2 — Fallback for color swatch tiles
  if (colors.length === 0) {
    $(".color-swatch, .swatch-item, [data-color]").each((_i: number, el: any) => {
      const block = $(el);

      const name =
        block.attr("data-color") ||
        block.attr("data-title") ||
        block.find(".color-name").text().trim() ||
        null;

      if (!name) return;

      let swatchUrl = block.find("img").attr("src") || null;

      if (!swatchUrl) {
        const bg = block.css("background-image");
        if (bg) {
          swatchUrl = bg.replace(/url\(['"]?(.+?)['"]?\)/, "$1");
        }
      }

      const code = name.toUpperCase().replace(/\s+/g, "_");

      const color = normalizeColor(
        {
          code,
          name,
          series: "Color PPF",
          finish: "Gloss",
          swatchUrl,
          imageUrl: swatchUrl,
        },
        "FlexiShield",
        sourceUrl
      );

      colors.push(color);
    });
  }

  return colors;
}
