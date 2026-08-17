// STEK Color PPF Extractor
// https://www.stekautomotive.com/products/color-ppf

import { ExtractedColor } from "../color-extractor-types.ts";
import { normalizeColor } from "../color-extractor-utils.ts";

export async function parse($: any, sourceUrl: string): Promise<ExtractedColor[]> {
  const colors: ExtractedColor[] = [];

  // Pattern 1 — Main STEK product grid
  $(".product-grid-item, .product-card, .film-color").each(
    (_i: number, el: any) => {
      const block = $(el);

      const name =
        block.find(".product-title").text().trim() ||
        block.find(".film-name").text().trim() ||
        block.find("h3").text().trim() ||
        block.find("h4").text().trim() ||
        null;

      if (!name) return;

      const link = block.find("a").attr("href") || null;
      const absoluteUrl = link?.startsWith("http")
        ? link
        : link
        ? `https://www.stekautomotive.com${link}`
        : null;

      const swatchUrl =
        block.find("img").attr("src") ||
        block.find("img").attr("data-src") ||
        null;

      // STEK uses color names, not formal codes
      const code = name.toUpperCase().replace(/\s+/g, "_");

      // Finish detection
      let finish = "Gloss";
      const n = name.toLowerCase();
      if (n.includes("matte")) finish = "Matte";
      if (n.includes("satin")) finish = "Satin";
      if (n.includes("metallic")) finish = "Metallic";

      // Series detection
      let series = "Color PPF";
      if (n.includes("dyno") || n.includes("shield")) series = "DYNOshield";

      const color = normalizeColor(
        {
          code,
          name,
          series,
          finish,
          swatchUrl,
          imageUrl: swatchUrl,
        },
        "STEK",
        sourceUrl
      );

      colors.push(color);
    }
  );

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
        "STEK",
        sourceUrl
      );

      colors.push(color);
    });
  }

  return colors;
}
