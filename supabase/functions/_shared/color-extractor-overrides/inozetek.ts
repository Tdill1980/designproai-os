// Inozetek — SuperGloss, PearlGloss, Frozen Matte, Frozen Satin, CN Exclusive
// https://inozetek.com/collections/supergloss

import { ExtractedColor } from "../color-extractor-types.ts";
import { normalizeColor } from "../color-extractor-utils.ts";

export async function parse($: any, sourceUrl: string): Promise<ExtractedColor[]> {
  const colors: ExtractedColor[] = [];

  // Each color tile in Inozetek uses <div class="product-item">
  $(".product-item").each((_i: number, el: any) => {
    const block = $(el);

    // Extract product name (e.g., "Miami Blue")
    const name =
      block.find(".product-item__title").text().trim() ||
      block.find("p").text().trim() ||
      null;

    if (!name) return;

    // Product URL
    const productUrl = block.find("a").attr("href") || null;
    const absoluteUrl = productUrl?.startsWith("http")
      ? productUrl
      : productUrl
      ? `https://inozetek.com${productUrl}`
      : null;

    // Swatch URL
    const swatchUrl =
      block.find("img").attr("src") ||
      block.find("img").attr("data-src") ||
      null;

    // Extract code (SG015, PG032, FM3003, CN601, FS2005, etc.)
    let code: string | null = null;

    const patterns = [
      /\bSG\d{3}\b/i,      // SuperGloss
      /\bPG\d{3,4}\b/i,    // Pearl Gloss
      /\bFM\d{3,4}\b/i,    // Frozen Matte
      /\bFS\d{3,4}\b/i,    // Frozen Satin
      /\bCN\d{3}\b/i,      // Exclusive CN
      /\bASSC\d{3}\b/i,    // Limited editions
      /\bLIM\d{3}\b/i,
      /\bPB\d{3}\b/i,
    ];

    for (const p of patterns) {
      if (!code && name) {
        const match = name.match(p);
        if (match) code = match[0].toUpperCase();
      }
      if (!code && absoluteUrl) {
        const match2 = absoluteUrl.match(p);
        if (match2) code = match2[0].toUpperCase();
      }
    }

    // Determine series from code prefix
    let series = "SuperGloss";
    if (code) {
      if (code.startsWith("PG")) series = "Pearl Gloss";
      if (code.startsWith("FM")) series = "Frozen Matte";
      if (code.startsWith("FS")) series = "Frozen Satin";
      if (code.startsWith("CN")) series = "Exclusive Color";
    }

    // Finish type detection
    let finish = "Gloss";
    if (series === "Frozen Matte") finish = "Matte";
    if (series === "Frozen Satin") finish = "Satin";
    if (series === "Pearl Gloss") finish = "Pearl";

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
      "Inozetek",
      sourceUrl
    );

    colors.push(color);
  });

  // Alternative selector for grid/card layouts
  if (colors.length === 0) {
    $(".product-card, .collection-product, [data-product]").each((_i: number, el: any) => {
      const block = $(el);

      const name =
        block.find(".product-card__title, .product-title, h3").text().trim() ||
        block.attr("data-product-title") ||
        null;

      if (!name) return;

      const productUrl = block.find("a").attr("href") || null;
      const absoluteUrl = productUrl?.startsWith("http")
        ? productUrl
        : productUrl
        ? `https://inozetek.com${productUrl}`
        : null;

      const swatchUrl =
        block.find("img").attr("src") ||
        block.find("img").attr("data-src") ||
        null;

      const color = normalizeColor(
        {
          code: null,
          name,
          series: "SuperGloss",
          swatchUrl,
          imageUrl: swatchUrl,
        },
        "Inozetek",
        sourceUrl
      );

      colors.push(color);
    });
  }

  return colors;
}
