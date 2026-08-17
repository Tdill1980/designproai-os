import { ExtractedColor } from "../color-extractor-types.ts";
import { normalizeColor } from "../color-extractor-utils.ts";

// Arlon SLX+ Extractor
// https://www.arlon.com/products/slx-cast-wrap

export async function parse($: any, sourceUrl: string): Promise<ExtractedColor[]> {
  const colors: ExtractedColor[] = [];

  // Pattern 1 — Arlon product cards
  $("div.product-card, .product-grid-item, .product-tile").each(
    (_i: number, el: any) => {
      const block = $(el);

      // Extract name
      const name =
        block.find(".product-card__title").text().trim() ||
        block.find("h5").text().trim() ||
        null;

      if (!name) return;

      // Extract product URL
      const productUrl = block.find("a").attr("href") || null;
      const absoluteUrl = productUrl?.startsWith("http")
        ? productUrl
        : productUrl
        ? `https://www.arlon.com${productUrl}`
        : null;

      // Extract swatch image
      const swatchUrl =
        block.find("img").attr("src") ||
        block.find("img").attr("data-src") ||
        null;

      // Arlon does not publish separate codes → generate safe one
      const code = name.toUpperCase().replace(/\s+/g, "_");

      // All SLX+ colors are gloss unless their name indicates otherwise
      let finish = "Gloss";
      const n = name.toLowerCase();
      if (n.includes("matte")) finish = "Matte";
      if (n.includes("satin")) finish = "Satin";
      if (n.includes("metallic")) finish = "Metallic";

      const series = "SLX+";

      // Normalize final color object
      const color = normalizeColor(
        {
          code,
          name,
          series,
          finish,
          swatchUrl,
          imageUrl: swatchUrl,
        },
        "Arlon",
        sourceUrl
      );

      colors.push(color);
    }
  );

  // Pattern 2 — Alternative grid layout fallback
  if (colors.length === 0) {
    $(".color-swatch, .swatch-item, [data-color]").each((_i: number, el: any) => {
      const block = $(el);

      const name =
        block.find(".swatch-name, .color-name").text().trim() ||
        block.attr("data-color-name") ||
        block.attr("title") ||
        null;

      if (!name) return;

      const swatchUrl =
        block.find("img").attr("src") ||
        block.css("background-image")?.replace(/url\(['"]?([^'"]+)['"]?\)/i, "$1") ||
        null;

      const code = name.toUpperCase().replace(/\s+/g, "_");

      const color = normalizeColor(
        {
          code,
          name,
          series: "SLX+",
          finish: "Gloss",
          swatchUrl,
          imageUrl: swatchUrl,
        },
        "Arlon",
        sourceUrl
      );

      colors.push(color);
    });
  }

  return colors;
}
