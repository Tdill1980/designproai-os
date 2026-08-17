// HEXIS SKINTAC Override - Real Extraction Logic
// Target: https://www.hexisamericas.com/skintac/

import { ExtractedColor } from "../color-extractor-types.ts";
import { normalizeColor } from "../color-extractor-utils.ts";

export async function parse($: any, sourceUrl: string): Promise<ExtractedColor[]> {
  const colors: ExtractedColor[] = [];

  // Each product tile on Hexis SKINTAC page
  $(".productBlock").each((_i: number, el: any) => {
    const block = $(el);

    // EXTRACT COLOR CODE (e.g., HX20G06B)
    const code = block.find(".prod-sku").text().trim() || null;

    // EXTRACT COLOR NAME (e.g., Dust Grey Gloss)
    const name = block.find(".prod-title").text().trim() || null;

    // EXTRACT SERIES (inferred from code prefix)
    let series: string | null = null;
    if (code) {
      if (code.startsWith("HX20")) series = "HX20000";
      else if (code.startsWith("HX30")) series = "HX30000";
      else if (code.startsWith("HXSCH")) series = "HX Super Chrome";
      else if (code.startsWith("HX")) series = "HX Series";
      else series = "SKINTAC";
    }

    // EXTRACT SWATCH IMAGE URL
    const swatchUrl =
      block.find("img.prod-img").attr("src") ||
      block.find("img").attr("src") ||
      null;

    // EXTRACT ROLLOVER IMAGE URL (big preview on hover)
    const imageUrl =
      block.find("img.prod-img").attr("data-hover") ||
      block.find("img").attr("data-hover") ||
      swatchUrl;

    // Build and normalize color object
    const color = normalizeColor(
      {
        code,
        name,
        series,
        swatchUrl,
        imageUrl,
      },
      "Hexis",
      sourceUrl
    );

    colors.push(color);
  });

  return colors;
}
