import GIF from 'gif.js';

export type AspectRatio = '16:9' | '9:16' | '1:1';
export type ExportFormat = 'gif' | 'video';

interface ExportOptions {
  images: string[];
  aspectRatio: AspectRatio;
  format: ExportFormat;
  quality?: 'high' | 'medium' | 'low';
  fps?: number;
}

/**
 * Load an image and return as HTMLImageElement
 */
const loadImage = (url: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (error) => {
      console.error('Image load error:', error);
      reject(new Error(`Failed to load image: ${url}`));
    };
    img.src = url;
  });
};

/**
 * Crop/resize image to target aspect ratio
 */
const processImageToAspectRatio = (
  img: HTMLImageElement,
  aspectRatio: AspectRatio,
  targetWidth: number
): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');

  let targetHeight: number;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = img.width;
  let sourceHeight = img.height;

  // Calculate dimensions based on aspect ratio
  switch (aspectRatio) {
    case '16:9':
      targetHeight = Math.round((targetWidth * 9) / 16);
      // Crop from center if needed
      const targetAspect16_9 = 16 / 9;
      const sourceAspect = sourceWidth / sourceHeight;
      if (sourceAspect > targetAspect16_9) {
        // Source is wider, crop width
        sourceWidth = sourceHeight * targetAspect16_9;
        sourceX = (img.width - sourceWidth) / 2;
      } else {
        // Source is taller, crop height
        sourceHeight = sourceWidth / targetAspect16_9;
        sourceY = (img.height - sourceHeight) / 2;
      }
      break;
    case '9:16':
      targetHeight = Math.round((targetWidth * 16) / 9);
      // For vertical format, focus on center of vehicle
      const targetAspect9_16 = 9 / 16;
      const sourceAspect9_16 = sourceWidth / sourceHeight;
      if (sourceAspect9_16 > targetAspect9_16) {
        // Source is wider, crop width (center on vehicle)
        sourceWidth = sourceHeight * targetAspect9_16;
        sourceX = (img.width - sourceWidth) / 2;
      } else {
        // Source is taller, crop height
        sourceHeight = sourceWidth / targetAspect9_16;
        sourceY = (img.height - sourceHeight) / 2;
      }
      break;
    case '1:1':
      targetHeight = targetWidth;
      // Square format - crop to center
      const minDimension = Math.min(sourceWidth, sourceHeight);
      sourceWidth = minDimension;
      sourceHeight = minDimension;
      sourceX = (img.width - minDimension) / 2;
      sourceY = (img.height - minDimension) / 2;
      break;
  }

  canvas.width = targetWidth;
  canvas.height = targetHeight;
  
  ctx.drawImage(
    img,
    sourceX, sourceY, sourceWidth, sourceHeight,
    0, 0, targetWidth, targetHeight
  );

  return canvas;
};

/**
 * Generate GIF from images
 */
export const generateGIF = async (options: ExportOptions): Promise<Blob> => {
  const { images, aspectRatio, quality = 'medium', fps = 10 } = options;

  // Determine output width based on quality
  const widthMap = {
    high: 720,
    medium: 540,
    low: 360
  };
  const outputWidth = widthMap[quality];

  // Load and process all images
  const loadedImages = await Promise.all(images.map(url => loadImage(url)));
  const processedCanvases = loadedImages.map(img => 
    processImageToAspectRatio(img, aspectRatio, outputWidth)
  );

  // Initialize GIF encoder with error handling
  const gif = new GIF({
    workers: 2,
    quality: quality === 'high' ? 5 : quality === 'medium' ? 10 : 15,
    // Note: GIF worker is bundled with the library - no external CDN needed
    width: processedCanvases[0].width,
    height: processedCanvases[0].height
  });

  // Add frames
  const delay = 1000 / fps;
  processedCanvases.forEach(canvas => {
    gif.addFrame(canvas, { delay });
  });

  // Render and return blob
  return new Promise((resolve, reject) => {
    gif.on('finished', (blob: Blob) => resolve(blob));
    gif.on('error', reject);
    gif.render();
  });
};

/**
 * Generate video (WebM) from images using MediaRecorder
 */
export const generateVideo = async (options: ExportOptions): Promise<Blob> => {
  const { images, aspectRatio, fps = 10 } = options;

  const outputWidth = 720;
  
  // Load and process all images
  const loadedImages = await Promise.all(images.map(url => loadImage(url)));
  const processedCanvases = loadedImages.map(img => 
    processImageToAspectRatio(img, aspectRatio, outputWidth)
  );

  const canvas = processedCanvases[0];
  const stream = canvas.captureStream(fps);
  const mediaRecorder = new MediaRecorder(stream, {
    mimeType: 'video/webm;codecs=vp9',
    videoBitsPerSecond: 2500000
  });

  const chunks: Blob[] = [];
  
  return new Promise((resolve, reject) => {
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      resolve(new Blob(chunks, { type: 'video/webm' }));
    };

    mediaRecorder.onerror = reject;

    mediaRecorder.start();

    // Draw frames at specified fps
    let frameIndex = 0;
    const interval = setInterval(() => {
      if (frameIndex >= processedCanvases.length) {
        clearInterval(interval);
        mediaRecorder.stop();
        return;
      }

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(processedCanvases[frameIndex], 0, 0);
      }
      frameIndex++;
    }, 1000 / fps);
  });
};

/**
 * Trigger download of blob
 */
export const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
