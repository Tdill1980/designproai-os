import { ExtractedColor } from "../color-extractor-types.ts";
import { normalizeColor } from "../color-extractor-utils.ts";

// VViViD Extractor (all series)
// https://vvividshop.com/collections/vinyl-wrap

export async function parse($: any, sourceUrl: string): Promise<ExtractedColor[]> {
  const colors: ExtractedColor[] = [];

  //
  // PATTERN 1 — VViViD product grid (main layout)
  //
  $(".grid-product, .product-card, .collection-product").each((_i: number, el: any) => {
    const block = $(el);

    const name =
      block.find(".grid-product__title").text().trim() ||
      block.find(".product-card__title").text().trim() ||
      block.find("h4").text().trim() ||
      block.find("p.title").text().trim() ||
      null;

    if (!name) return;

    const link = block.find("a").attr("href") || null;
    const absoluteUrl = link?.startsWith("http")
      ? link
      : link
      ? `https://vvividshop.com${link}`
      : null;

    const swatchUrl =
      block.find("img.grid-product__image").attr("src") ||
      block.find("img").attr("src") ||
      block.find("img").attr("data-src") ||
      null;

    // Generate stable code from name
    const code = name.toUpperCase().replace(/\s+/g, "_");

    // Detect finish from name
    let finish = "Gloss";
    const n = name.toLowerCase();
    if (n.includes("matte")) finish = "Matte";
    if (n.includes("satin")) finish = "Satin";
    if (n.includes("chrome")) finish = "Chrome";
    if (n.includes("metallic")) finish = "Metallic";
    if (n.includes("brushed")) finish = "Brushed";
    if (n.includes("carbon")) finish = "Carbon Fiber";

    // Infer series from keywords
    let series = "VViViD";
    if (n.includes("xpo")) series = "XPO";
    if (n.includes("carbon")) series = "Carbon Fiber";
    if (n.includes("chrome")) series = "Super Chrome";
    if (n.includes("camo")) series = "Camouflage";
    if (n.includes("wood")) series = "Wood Grain";

    const color = normalizeColor(
      {
        code,
        name,
        series,
        finish,
        swatchUrl,
        imageUrl: swatchUrl,
      },
      "VViViD",
      sourceUrl
    );

    colors.push(color);
  });

  //
  // PATTERN 2 — Legacy product item layout
  //
  if (colors.length === 0) {
    $(".product-item, .product-block").each((_i: number, el: any) => {
      const block = $(el);

      const name =
        block.find(".product-item__title").text().trim() ||
        block.find(".product-title").text().trim() ||
        block.find("h5").text().trim() ||
        null;

      if (!name) return;

      const link = block.find("a").attr("href") || null;
      const absoluteUrl = link?.startsWith("http")
        ? link
        : link
        ? `https://vvividshop.com${link}`
        : null;

      const swatchUrl =
        block.find("img").attr("src") ||
        block.find("img").attr("data-src") ||
        null;

      const code = name.toUpperCase().replace(/\s+/g, "_");

      const color = normalizeColor(
        {
          code,
          name,
          series: "VViViD",
          finish: "Gloss",
          swatchUrl,
          imageUrl: swatchUrl,
        },
        "VViViD",
        sourceUrl
      );

      colors.push(color);
    });
  }

  //
  // PATTERN 3 — Data attribute tiles (fallback)
  //
  if (colors.length === 0) {
    $("[data-title], .color-swatch, .swatch-item").each((_i: number, el: any) => {
      const block = $(el);

      const name =
        block.attr("data-title") ||
        block.attr("title") ||
        block.find(".swatch-name").text().trim() ||
        null;

      if (!name) return;

      const bg = block.css("background-image");
      let swatchUrl = null;

      if (bg) {
        swatchUrl = bg.replace(/url\(['"]?(.+?)['"]?\)/, "$1");
      } else {
        swatchUrl = block.find("img").attr("src") || null;
      }

      const code = name.toUpperCase().replace(/\s+/g, "_");

      const color = normalizeColor(
        {
          code,
          name,
          series: "VViViD",
          finish: "Gloss",
          swatchUrl,
          imageUrl: swatchUrl,
        },
        "VViViD",
        sourceUrl
      );

      colors.push(color);
    });
  }

  return colors;
}
