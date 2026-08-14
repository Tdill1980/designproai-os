/**
 * Panel Image Processor
 * Handles cropping and preprocessing of DesignPanelPro™ panel images
 * Removes dimension text overlays to create clean display versions
 */

export interface ProcessedPanelImage {
  cleanDataUrl: string; // For customer display (no text)
  originalBlob: Blob; // Original image for AI input
}

/**
 * Process a panel image to create a clean version without dimension text
 * Detects and crops text overlay regions (typically at top/bottom)
 */
export async function processPanelImage(file: File): Promise<ProcessedPanelImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = (e) => {
      img.src = e.target?.result as string;
    };

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        reject(new Error('Canvas context not available'));
        return;
      }

      // Original dimensions
      const originalWidth = img.width;
      const originalHeight = img.height;

      // For 186"x56" panels (aspect ratio ~3.32:1), we expect dimension text
      // typically in top 10% and bottom 10% of image
      // Crop these regions to get clean panel
      const cropTopPercent = 0.12; // Remove top 12%
      const cropBottomPercent = 0.12; // Remove bottom 12%
      
      const cropTop = originalHeight * cropTopPercent;
      const cropBottom = originalHeight * cropBottomPercent;
      const cleanHeight = originalHeight - cropTop - cropBottom;

      // Set canvas to cropped dimensions
      canvas.width = originalWidth;
      canvas.height = cleanHeight;

      // Draw the cropped region (middle portion without text overlays)
      ctx.drawImage(
        img,
        0, cropTop, // Source x, y
        originalWidth, cleanHeight, // Source width, height
        0, 0, // Destination x, y
        originalWidth, cleanHeight // Destination width, height
      );

      // Convert to data URL for clean display
      const cleanDataUrl = canvas.toDataURL('image/png', 0.95);

      // Keep original blob for AI processing
      file.arrayBuffer().then(buffer => {
        const originalBlob = new Blob([buffer], { type: file.type });
        
        resolve({
          cleanDataUrl,
          originalBlob
        });
      });
    };

    img.onerror = () => {
      reject(new Error('Failed to load image'));
    };

    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };

    reader.readAsDataURL(file);
  });
}

/**
 * Upload both original and clean versions of a panel image to storage
 */
export async function uploadPanelImages(
  originalBlob: Blob,
  cleanDataUrl: string,
  fileName: string,
  supabaseClient: any,
  userId?: string
): Promise<{ originalUrl: string; cleanUrl: string }> {
  const fileExt = fileName.split('.').pop() || 'png';
  const baseFileName = `${crypto.randomUUID()}`;

  // User-scoped storage path: custom-panels/{userId}/...
  const userPrefix = userId ? `${userId}/` : '';

  // Upload original (for AI)
  const originalPath = `custom-panels/${userPrefix}${baseFileName}.${fileExt}`;
  const { error: originalError } = await supabaseClient.storage
    .from('patterns')
    .upload(originalPath, originalBlob);

  if (originalError) throw originalError;

  // Convert clean data URL to blob
  const cleanResponse = await fetch(cleanDataUrl);
  const cleanBlob = await cleanResponse.blob();

  // Upload clean version (for display)
  const cleanPath = `custom-panels/${userPrefix}${baseFileName}_clean.png`;
  const { error: cleanError } = await supabaseClient.storage
    .from('patterns')
    .upload(cleanPath, cleanBlob);

  if (cleanError) throw cleanError;

  // Get public URLs
  const { data: originalUrlData } = supabaseClient.storage
    .from('patterns')
    .getPublicUrl(originalPath);

  const { data: cleanUrlData } = supabaseClient.storage
    .from('patterns')
    .getPublicUrl(cleanPath);

  return {
    originalUrl: originalUrlData.publicUrl,
    cleanUrl: cleanUrlData.publicUrl
  };
}
