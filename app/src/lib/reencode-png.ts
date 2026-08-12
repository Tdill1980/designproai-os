/**
 * Re-encodes an image URL into a true PNG blob via canvas.
 * Use this for downloads when the source render is JPEG but we
 * want the saved file to be a real PNG (not JPEG bytes with a
 * .png extension).
 */
export async function fetchAsPngBlob(imageUrl: string): Promise<Blob> {
  const response = await fetch(imageUrl, { mode: 'cors' });
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
  const srcBlob = await response.blob();
  const objectUrl = URL.createObjectURL(srcBlob);

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Failed to load image'));
    i.src = objectUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    URL.revokeObjectURL(objectUrl);
    throw new Error('Failed to get canvas context');
  }
  ctx.drawImage(img, 0, 0);
  URL.revokeObjectURL(objectUrl);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Failed to encode PNG'))),
      'image/png'
    );
  });
}
