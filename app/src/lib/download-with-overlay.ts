/**
 * UNIFIED DOWNLOAD HELPER
 *
 * ====================================================================
 * ALL RENDER DOWNLOADS MUST USE THIS FUNCTION.
 * This ensures every exported image has the overlay permanently stamped.
 * ====================================================================
 *
 * Uses stampOverlayOnImage() internally to create deterministic exports.
 *
 * Mobile behavior: if the browser supports navigator.canShare with files,
 * we trigger the native iOS / Android share sheet so users can tap
 * "Save to Photos" instead of fighting the blob-download flow (which
 * often fails silently on mobile browsers or lands in Downloads where
 * users can't find it).
 */

import { stampOverlayOnImage, OverlaySpec, type StampFormat } from './overlay-stamper';

export type { OverlaySpec } from './overlay-stamper';

/**
 * Mobile detection via user agent. Used to pick the output format and
 * trigger Web Share sheet on phones so users can Save to Photos.
 */
function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/**
 * Detects mobile browsers that support the Web Share API with files.
 * Desktop browsers also have navigator.share but rarely canShare files,
 * so this cleanly routes only mobile through the share sheet.
 */
function canUseNativeShare(blob: Blob, filename: string): boolean {
  if (typeof navigator === 'undefined') return false;
  if (typeof navigator.share !== 'function') return false;
  if (typeof navigator.canShare !== 'function') return false;
  try {
    const testFile = new File([blob], filename, { type: blob.type || 'image/png' });
    return navigator.canShare({ files: [testFile] });
  } catch {
    return false;
  }
}

/**
 * Fallback blob-download path used when native share isn't available
 * or the user dismisses the share sheet.
 */
function triggerBlobDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
  }, 100);
}

/**
 * Downloads a render image with the overlay permanently stamped.
 *
 * On mobile: opens the native share sheet so users can tap "Save to Photos".
 * On desktop: triggers a regular blob download.
 *
 * @param imageUrl - URL of the base render image
 * @param filename - Desired filename for the download (without extension)
 * @param overlay - Overlay specification with tool name, manufacturer, color/design name
 */
export async function downloadWithOverlay(
  imageUrl: string,
  filename: string,
  overlay: OverlaySpec
): Promise<void> {
  // Every download is a full-resolution PNG — no size cap, so 4K renders
  // download at native 4K. (Surfaces with upload limits re-encode on upload.)
  const mobile = isMobileDevice();
  const format: StampFormat = 'png';
  const fullFilename = `${filename}.png`;

  try {
    // Stamp the overlay onto the image at native resolution (no downscale)
    const stampedBlob = await stampOverlayOnImage(imageUrl, overlay, format);

    // Mobile path — Web Share API with files so it lands in Photos
    if (mobile && canUseNativeShare(stampedBlob, fullFilename)) {
      try {
        const file = new File([stampedBlob], fullFilename, {
          type: stampedBlob.type || (mobile ? 'image/png' : 'image/jpeg'),
        });
        await navigator.share({
          files: [file],
          title: filename,
          text: `${filename} — DesignProAI render`,
        });
        return;
      } catch (shareErr) {
        // User cancelled the share sheet — that's fine, just bail silently
        if ((shareErr as Error)?.name === 'AbortError') return;
        // Any other share failure falls through to the blob-download path
        console.warn('[downloadWithOverlay] Native share failed, falling back:', shareErr);
      }
    }

    // Desktop + fallback path — regular blob download
    triggerBlobDownload(stampedBlob, fullFilename);
  } catch (error) {
    console.error('Download with overlay failed, falling back to raw download:', error);
    // Fallback: download without overlay rather than failing silently.
    // Raw PNG fetch is always PNG, so mobile stays on PNG, desktop swaps to PNG too.
    try {
      const { fetchAsPngBlob } = await import('./reencode-png');
      const blob = await fetchAsPngBlob(imageUrl);
      const rawFilename = `${filename}.png`;

      if (mobile && canUseNativeShare(blob, rawFilename)) {
        try {
          const file = new File([blob], rawFilename, {
            type: blob.type || 'image/png',
          });
          await navigator.share({
            files: [file],
            title: filename,
            text: `${filename} — DesignProAI render`,
          });
          return;
        } catch (shareErr) {
          if ((shareErr as Error)?.name === 'AbortError') return;
        }
      }

      triggerBlobDownload(blob, rawFilename);
    } catch (fallbackError) {
      console.error('Fallback download also failed:', fallbackError);
      window.open(imageUrl, '_blank');
    }
  }
}

/**
 * Downloads multiple render images with overlays.
 *
 * On mobile, all stamped images are bundled into a single Web Share call so
 * the user only sees ONE share sheet — tapping "Save to Photos" once stores
 * every view. Falls back to per-file blob downloads if multi-file share is
 * unsupported.
 *
 * On desktop, files are downloaded sequentially with a delay between each
 * to keep the browser from blocking the burst.
 *
 * @param images - Array of { url, filename } objects
 * @param overlay - Overlay specification (same for all images)
 * @param delayMs - Delay between downloads to prevent browser blocking (default: 500ms)
 */
export async function downloadAllWithOverlay(
  images: Array<{ url: string; filename: string }>,
  overlay: OverlaySpec,
  delayMs: number = 500
): Promise<void> {
  if (images.length === 0) return;

  const mobile = isMobileDevice();

  if (mobile) {
    // Stamp every image first, then share them all in one share sheet.
    const format: StampFormat = 'png';
    const stamped: Array<{ blob: Blob; filename: string }> = [];

    for (const { url, filename } of images) {
      try {
        const blob = await stampOverlayOnImage(url, overlay, format);
        stamped.push({ blob, filename: `${filename}.png` });
      } catch (err) {
        console.warn('[downloadAllWithOverlay] Stamp failed for', filename, err);
      }
    }

    if (stamped.length === 0) return;

    const files = stamped.map(({ blob, filename }) =>
      new File([blob], filename, { type: blob.type || 'image/png' })
    );

    if (typeof navigator !== 'undefined'
      && typeof navigator.share === 'function'
      && typeof navigator.canShare === 'function'
      && navigator.canShare({ files })) {
      try {
        await navigator.share({
          files,
          title: 'DesignProAI renders',
          text: `${files.length} renders from DesignProAI`,
        });
        return;
      } catch (shareErr) {
        if ((shareErr as Error)?.name === 'AbortError') return;
        console.warn('[downloadAllWithOverlay] Multi-file share failed, falling back:', shareErr);
      }
    }

    // Fallback for mobile browsers without multi-file share — sequential blob downloads.
    for (let i = 0; i < stamped.length; i++) {
      triggerBlobDownload(stamped[i].blob, stamped[i].filename);
      if (i < stamped.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    return;
  }

  // Desktop — original sequential flow with delay.
  for (let i = 0; i < images.length; i++) {
    const { url, filename } = images[i];
    await downloadWithOverlay(url, filename, overlay);

    if (i < images.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}
