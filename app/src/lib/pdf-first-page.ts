/**
 * pdf-first-page — render page 1 of a PDF into a PNG data URL.
 *
 * The WPW proof template displays proof images in <img> tags, but an <img>
 * cannot render a PDF. When a designer uploads a PDF 2D proof we rasterize
 * its first page here so it shows in the sheet (and prints) like any image.
 *
 * pdfjs-dist is loaded dynamically so it only ships in the chunk for pages
 * that actually need it (the proof sheet), not the main bundle.
 */

let pdfjsPromise: Promise<any> | null = null;

async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjsLib = await import("pdfjs-dist");
      // Vite fingerprints this worker URL at build time.
      const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjsLib;
    })();
  }
  return pdfjsPromise;
}

/**
 * Fetch a PDF (by URL) and return a PNG data URL of its first page, or null
 * if anything fails (caller should fall back to the original URL).
 */
export async function pdfFirstPageToDataUrl(
  url: string,
  maxWidth = 1600,
): Promise<string | null> {
  try {
    const pdfjsLib = await getPdfjs();
    const pdf = await pdfjsLib.getDocument({ url }).promise;
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2, Math.max(0.5, maxWidth / base.width));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL("image/png");
  } catch (e) {
    console.warn("pdfFirstPageToDataUrl failed for", url, e);
    return null;
  }
}

/** True when the path/URL points at a PDF. */
export function isPdfPath(s: string): boolean {
  return /\.pdf($|\?)/i.test(s || "");
}
