import Konva from "konva";
import { TextLayer } from "./types";

/**
 * Renders a text layer to a full-resolution PNG blob using an offscreen Konva
 * stage. Because geometry/fontSize are stored in doc pixels, drawing at 1:1
 * yields print-resolution text with the exact fonts the user sees on screen.
 * The result is uploaded and composited like any other raster layer, so the
 * server never has to resolve fonts.
 */
export async function rasterizeTextLayer(layer: TextLayer): Promise<Blob> {
  const width = Math.max(1, Math.round(layer.width));
  const height = Math.max(1, Math.round(layer.height));

  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "-99999px";
  container.style.top = "0";
  document.body.appendChild(container);

  try {
    // Make sure web fonts (Poppins/Oswald/Inter…) are ready before measuring.
    try {
      await (document as any).fonts?.ready;
    } catch {
      /* fonts API unavailable — proceed */
    }

    const stage = new Konva.Stage({ container, width, height });
    const klayer = new Konva.Layer();
    stage.add(klayer);

    const textNode = new Konva.Text({
      x: 0,
      y: 0,
      width,
      height,
      text: layer.text,
      fontFamily: layer.fontFamily,
      fontSize: layer.fontSize,
      fill: layer.fill,
      fontStyle: layer.fontStyle, // "normal" | "bold" | "italic" | "bold italic"
      align: layer.align,
      verticalAlign: "middle",
      lineHeight: layer.lineHeight,
      letterSpacing: layer.letterSpacing,
      wrap: "word",
    });
    klayer.add(textNode);
    klayer.draw();

    const canvas = stage.toCanvas({ pixelRatio: 1 });
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Text rasterization failed"))), "image/png"),
    );
    stage.destroy();
    return blob;
  } finally {
    container.remove();
  }
}
