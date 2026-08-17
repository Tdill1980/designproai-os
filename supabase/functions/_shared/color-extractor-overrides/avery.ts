// AVERY DENNISON SW900 Override - Real Extraction Logic
// Target: https://graphics.averydennison.com/en/home/products/vehicle-wrapping-films/supreme-wrapping-film.html

import { ExtractedColor } from "../color-extractor-types.ts";
import { normalizeColor } from "../color-extractor-utils.ts";

export async function parse($: any, sourceUrl: string): Promise<ExtractedColor[]> {
  const colors: ExtractedColor[] = [];

  // Avery's site uses "card-product" blocks
  $("div.card.card-product").each((_i: number, el: any) => {
    const block = $(el);

    // Extract color name
    const name = block.find(".card-product__title").text().trim() || null;

    // Product URL
    const productUrl = block.find("a.card-product__link").attr("href") || null;

    // Build absolute product URL if needed
    const absoluteUrl = productUrl?.startsWith("http")
      ? productUrl
      : productUrl ? `https://graphics.averydennison.com${productUrl}` : null;

    // Extract swatch image
    const swatchUrl = block.find("img.card-product__image").attr("src") || null;

    // Extract SW900 code from title or URL
    let code: string | null = null;
    if (name) {
      const match = name.match(/SW900[-_]?\d{3}[A-Z]?/i);
      if (match) code = match[0].toUpperCase();
    }
    if (!code && absoluteUrl) {
      const match2 = absoluteUrl.match(/SW900[-_]?\d{3}[A-Z]?/i);
      if (match2) code = match2[0].toUpperCase();
    }

    // Build normalized color object
    const color = normalizeColor(
      {
        code,
        name,
        series: "SW900",
        swatchUrl,
        imageUrl: swatchUrl, // Avery doesn't have hover images on list page
      },
      "Avery Dennison",
      sourceUrl
    );

    colors.push(color);
  });

  return colors;
}
