/**
 * Extract dominant colors from an image file using Canvas API
 */
export async function extractColorsFromImage(file: File): Promise<{
  primary: string;
  secondary: string;
  accent: string;
}> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    img.onload = () => {
      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }

      // Resize to small size for faster processing
      const size = 100;
      canvas.width = size;
      canvas.height = size;

      ctx.drawImage(img, 0, 0, size, size);
      const imageData = ctx.getImageData(0, 0, size, size);
      const pixels = imageData.data;

      // Color frequency map
      const colorMap = new Map<string, number>();

      // Sample every 4th pixel for performance
      for (let i = 0; i < pixels.length; i += 16) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const a = pixels[i + 3];

        // Skip transparent or near-white/black pixels
        if (a < 200 || (r > 240 && g > 240 && b > 240) || (r < 15 && g < 15 && b < 15)) {
          continue;
        }

        const hex = rgbToHex(r, g, b);
        colorMap.set(hex, (colorMap.get(hex) || 0) + 1);
      }

      // Sort by frequency
      const sortedColors = Array.from(colorMap.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([color]) => color);

      resolve({
        primary: sortedColors[0] || '#000000',
        secondary: sortedColors[1] || sortedColors[0] || '#333333',
        accent: sortedColors[2] || sortedColors[1] || sortedColors[0] || '#666666'
      });
    };

    img.onerror = () => reject(new Error('Failed to load image'));

    // Create object URL from file
    img.src = URL.createObjectURL(file);
  });
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(x => {
    const hex = x.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}