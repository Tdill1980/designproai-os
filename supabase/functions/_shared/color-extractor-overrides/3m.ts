// 3M 2080 Series Override - Real Extraction Logic
// Target: https://www.3m.com/3M/en_US/p/c/graphics-films/vehicle-wraps/

import { ExtractedColor } from "../color-extractor-types.ts";
import { normalizeColor } from "../color-extractor-utils.ts";

export async function parse($: any, sourceUrl: string): Promise<ExtractedColor[]> {
  const colors: ExtractedColor[] = [];

  // 3M uses multiple possible selectors depending on page type
  // Try product cards first (common 3M pattern)
  $("div.product-card, div.mmm-product-card, .product-item, .product-tile").each((_i: number, el: any) => {
    const block = $(el);
    
    // Extract product name
    const name = block.find(".product-card__title, .mmm-product-card__title, .product-name, h3, h4").first().text().trim() || null;
    
    // Skip if no name found
    if (!name) return;
    
    // Extract product URL
    const productLink = block.find("a").first().attr("href") || null;
    const absoluteUrl = productLink?.startsWith("http")
      ? productLink
      : productLink ? `https://www.3m.com${productLink}` : null;
    
    // Extract swatch/product image
    const swatchUrl = block.find("img").first().attr("src") || 
                      block.find("img").first().attr("data-src") || null;
    
    // Extract 2080 series code from name or URL
    let code: string | null = null;
    const codePatterns = [
      /2080[-_]?[A-Z]{1,2}\d{1,3}/i,  // 2080-G12, 2080-M12, 2080-SP10
      /1080[-_]?[A-Z]{1,2}\d{1,3}/i,  // Legacy 1080 series
      /\b[GSM]\d{2,3}\b/i,             // Short codes like G12, M12, S12
    ];
    
    for (const pattern of codePatterns) {
      if (name) {
        const match = name.match(pattern);
        if (match) {
          code = match[0].toUpperCase().replace('_', '-');
          break;
        }
      }
      if (!code && absoluteUrl) {
        const match2 = absoluteUrl.match(pattern);
        if (match2) {
          code = match2[0].toUpperCase().replace('_', '-');
          break;
        }
      }
    }
    
    // Detect series from code
    let series: string | null = "2080";
    if (code?.includes("1080")) series = "1080";
    
    // Build normalized color object
    const color = normalizeColor(
      {
        code,
        name,
        series,
        swatchUrl,
        imageUrl: swatchUrl,
      },
      "3M",
      sourceUrl
    );
    
    colors.push(color);
  });

  // Alternative selector pattern for 3M color swatches pages
  if (colors.length === 0) {
    $(".color-swatch, .swatch-item, .color-option, [data-color]").each((_i: number, el: any) => {
      const block = $(el);
      
      const name = block.attr("data-color-name") || 
                   block.attr("title") || 
                   block.find(".color-name, .swatch-label").text().trim() || null;
      
      if (!name) return;
      
      const code = block.attr("data-sku") || 
                   block.attr("data-product-code") || null;
      
      const swatchUrl = block.find("img").attr("src") ||
                        block.css("background-image")?.replace(/url\(['"]?|['"]?\)/g, '') || null;
      
      const color = normalizeColor(
        {
          code,
          name,
          series: "2080",
          swatchUrl,
          imageUrl: swatchUrl,
        },
        "3M",
        sourceUrl
      );
      
      colors.push(color);
    });
  }

  // Third pattern: table-based product listings
  if (colors.length === 0) {
    $("table.product-table tbody tr, .product-list-item").each((_i: number, el: any) => {
      const row = $(el);
      
      const name = row.find("td:nth-child(1), .product-name").text().trim() ||
                   row.find(".title, .name").text().trim() || null;
      
      if (!name) return;
      
      const code = row.find("td:nth-child(2), .product-code, .sku").text().trim() ||
                   row.attr("data-sku") || null;
      
      const swatchUrl = row.find("img").attr("src") || null;
      
      const color = normalizeColor(
        {
          code: code?.toUpperCase() || null,
          name,
          series: "2080",
          swatchUrl,
          imageUrl: swatchUrl,
        },
        "3M",
        sourceUrl
      );
      
      colors.push(color);
    });
  }

  return colors;
}
