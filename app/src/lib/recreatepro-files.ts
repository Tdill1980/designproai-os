import { pdfFirstPageToDataUrl } from './pdf-first-page';
import { recreateFileError } from './recreatepro-intake';
import type { RecreateReference } from './recreatepro-draft';

/** PDF page 1 is explicitly disclosed in the UI. Original PDF is kept and
 * uploaded as an attachment; only the rendered page is sent as an image. */
export async function prepareRecreateReference(file: File): Promise<RecreateReference> {
  const error = recreateFileError(file);
  if (error) throw new Error(error);
  let image = file;
  if (file.type === 'application/pdf') {
    const url = URL.createObjectURL(file);
    try {
      const dataUrl = await pdfFirstPageToDataUrl(url, 3072);
      if (!dataUrl) throw new Error(`${file.name}: PDF page 1 could not be read. Export it as a PNG or JPG.`);
      const blob = await (await fetch(dataUrl)).blob();
      image = new File([blob], `${file.name.replace(/\.pdf$/i, '')}-page-1.png`, { type: 'image/png' });
      const renderedError = recreateFileError(image);
      if (renderedError) throw new Error(renderedError);
    } finally { URL.revokeObjectURL(url); }
  }
  return { id: crypto.randomUUID(), file: image, ...(file.type === 'application/pdf' ? { originalPdf: file } : {}), surface: 'reference' };
}
