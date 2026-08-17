// ORACAL 970RA Override - Real Extraction Logic
// Target: https://www.orafol.com/en/us/product/oracal-970ra

import { ExtractedColor } from "../color-extractor-types.ts";
import { normalizeColor } from "../color-extractor-utils.ts";

export async function parse($: any, sourceUrl: string): Promise<ExtractedColor[]> {
  const colors: ExtractedColor[] = [];

  // ORAFOL uses "colorbox" blocks for each color swatch
  $("div.colorbox").each((_i: number, el: any) => {
    const block = $(el);

    // Color name (e.g., "Gloss Black", "Matte Mint")
    const name =
      block.find(".colorbox__title").text().trim() ||
      block.find("h3").text().trim() ||
      null;

    if (!name) return;

    // Product detail page URL
    const link = block.find("a.colorbox__link").attr("href") || null;
    const absoluteUrl = link?.startsWith("http")
      ? link
      : link
      ? `https://www.orafol.com${link}`
      : null;

    // Swatch image
    const swatchUrl =
      block.find("img.colorbox__img").attr("src") ||
      block.find("img").attr("src") ||
      null;

    // Extract ORACAL 970RA/975RA codes
    let code: string | null = null;
    const codePatterns = [
      /970[RA-]*\d{3}[A-Z]?/i,
      /975[RA-]*\d{3}[A-Z]?/i,
      /\b\d{3}[A-Z]?\b/i, // fallback for pages missing full codes
    ];

    for (const pattern of codePatterns) {
      if (!code && name) {
        const m = name.match(pattern);
        if (m) code = m[0].toUpperCase().replace("_", "-");
      }
      if (!code && absoluteUrl) {
        const m2 = absoluteUrl.match(pattern);
        if (m2) code = m2[0].toUpperCase().replace("_", "-");
      }
    }

    // Generate stable fallback code if none found
    if (!code && name) {
      code = `ORA-${name.replace(/\s+/g, "-").toUpperCase()}`;
    }

    // Detect finish from name
    let finish = "Unknown";
    if (name) {
      const n = name.toLowerCase();
      if (n.includes("gloss")) finish = "Gloss";
      else if (n.includes("matte")) finish = "Matte";
      else if (n.includes("satin")) finish = "Satin";
      else if (n.includes("metal")) finish = "Metallic";
      else if (n.includes("pearl")) finish = "Pearl";
    }

    // Normalize according to shared extractor schema
    const color = normalizeColor(
      {
        code,
        name,
        series: "970RA",
        finish,
        swatchUrl,
        imageUrl: swatchUrl,
      },
      "Oracal",
      sourceUrl
    );

    colors.push(color);
  });

  // Alternative selector pattern for different Orafol page layouts
  if (colors.length === 0) {
    $(".product-color, .color-tile, .color-item, [data-color]").each((_i: number, el: any) => {
      const block = $(el);

      const name =
        block.attr("data-color-name") ||
        block.attr("title") ||
        block.find(".color-name, .title").text().trim() ||
        null;

      if (!name) return;

      const code = block.attr("data-sku") || block.attr("data-code") || null;

      const swatchUrl =
        block.find("img").attr("src") ||
        block.find("img").attr("data-src") ||
        null;

      const color = normalizeColor(
        {
          code,
          name,
          series: "970RA",
          swatchUrl,
          imageUrl: swatchUrl,
        },
        "Oracal",
        sourceUrl
      );

      colors.push(color);
    });
  }

  return colors;
}
