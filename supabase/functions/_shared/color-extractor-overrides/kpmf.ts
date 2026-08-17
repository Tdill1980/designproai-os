import { ExtractedColor } from "../color-extractor-types.ts";
import { normalizeColor } from "../color-extractor-utils.ts";

// KPMF Vinyl Wrap Extractor (K75000 / VR1 series)
// Works on KPMF global site + U.S. distributor fallback (MetroRestyling)

export async function parse($: any, sourceUrl: string): Promise<ExtractedColor[]> {
  const colors: ExtractedColor[] = [];

  //
  // PATTERN 1 — KPMF Global VR1 / K75000 Catalog
  //
  $('div.product-grid-item, .productgrid--item, .collection__item').each(
    (_i: number, el: any) => {
      const block = $(el);

      // Extract name
      const name =
        block.find(".product-grid-item__title").text().trim() ||
        block.find(".grid-product__title").text().trim() ||
        block.find("p").text().trim() ||
        null;

      if (!name) return;

      // Product URL
      const link = block.find("a").attr("href") || null;
      const absoluteUrl =
        link?.startsWith("http")
          ? link
          : link
          ? `https://kpmf.com${link}`
          : null;

      // Swatch image
      const swatchUrl =
        block.find("img").attr("src") ||
        block.find("img").attr("data-src") ||
        null;

      // Extract KPMF codes like K75469, K75565, K75418
      let code: string | null = null;

      const codePatterns = [
        /\bK7\d{4}\b/i,  // K75469, K75565
        /\bK75\d{3}\b/i  // K75123 fallback
      ];

      for (const pattern of codePatterns) {
        if (!code && name) {
          const m = name.match(pattern);
          if (m) code = m[0].toUpperCase();
        }
        if (!code && absoluteUrl) {
          const m2 = absoluteUrl.match(pattern);
          if (m2) code = m2[0].toUpperCase();
        }
      }

      // Series
      const series = "K75000";

      // Finish detection
      let finish = "Gloss";
      const n = name.toLowerCase();
      if (n.includes("matte")) finish = "Matte";
      if (n.includes("satin")) finish = "Satin";
      if (n.includes("metallic")) finish = "Metallic";
      if (n.includes("iridescent") || n.includes("flip")) finish = "Color Shift";

      const color = normalizeColor(
        {
          code,
          name,
          series,
          finish,
          swatchUrl,
          imageUrl: swatchUrl,
        },
        "KPMF",
        sourceUrl
      );

      colors.push(color);
    }
  );

  //
  // PATTERN 2 — MetroRestyling Fallback (U.S. Distributor)
  //
  if (colors.length === 0) {
    $(".product-item, .grid-product").each((_i: number, el: any) => {
      const block = $(el);

      const name =
        block.find(".product-item__title").text().trim() ||
        block.find(".grid-product__title").text().trim() ||
        null;

      if (!name) return;

      const link = block.find("a").attr("href") || null;
      const absoluteUrl =
        link?.startsWith("http")
          ? link
          : link
          ? `https://metrorestyling.com${link}`
          : null;

      const swatchUrl =
        block.find("img").attr("src") ||
        block.find("img").attr("data-src") ||
        null;

      const color = normalizeColor(
        {
          code: null,
          name,
          series: "K75000",
          finish: "Gloss",
          swatchUrl,
          imageUrl: swatchUrl,
        },
        "KPMF",
        sourceUrl
      );

      colors.push(color);
    });
  }

  return colors;
}
