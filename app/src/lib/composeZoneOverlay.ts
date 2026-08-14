import type { VinylZone } from "@/components/graphicspro-v1/types";

const ZONE_COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444",
  "#8B5CF6", "#EC4899", "#06B6D4", "#F97316",
];

export async function composeZoneOverlay(
  imageUrl: string,
  zones: VinylZone[],
): Promise<Blob | null> {
  if (!zones || zones.length === 0) return null;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);

      ctx.drawImage(img, 0, 0);

      zones.forEach((z, i) => {
        const color = ZONE_COLORS[i % ZONE_COLORS.length];
        const x = (z.x / 100) * canvas.width;
        const y = (z.y / 100) * canvas.height;
        const w = (z.width / 100) * canvas.width;
        const h = (z.height / 100) * canvas.height;

        ctx.fillStyle = `${color}33`;
        ctx.fillRect(x, y, w, h);

        ctx.shadowColor = "rgba(0, 220, 255, 0.95)";
        ctx.shadowBlur = Math.max(12, canvas.width / 300);
        ctx.strokeStyle = "rgba(0, 220, 255, 0.9)";
        ctx.lineWidth = Math.max(2, canvas.width / 800);
        ctx.strokeRect(x, y, w, h);

        ctx.shadowBlur = 0;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(3, canvas.width / 500);
        ctx.strokeRect(x, y, w, h);

        const fontSize = Math.max(14, Math.round(canvas.width / 70));
        ctx.font = `bold ${fontSize}px Inter, Arial, sans-serif`;
        const padding = Math.round(fontSize * 0.4);
        const text = z.label || `Zone ${i + 1}`;
        const textWidth = ctx.measureText(text).width;
        const labelH = fontSize + padding * 2;

        ctx.fillStyle = color;
        ctx.fillRect(x, y, textWidth + padding * 2, labelH);
        ctx.fillStyle = "#ffffff";
        ctx.textBaseline = "top";
        ctx.fillText(text, x + padding, y + padding);

        if (z.widthInches > 0 && z.heightInches > 0) {
          const dimsFontSize = Math.max(11, Math.round(canvas.width / 95));
          ctx.font = `${dimsFontSize}px Inter, Arial, sans-serif`;
          const dimsText = `${z.widthInches}" × ${z.heightInches}"`;
          const dimsWidth = ctx.measureText(dimsText).width;
          const dimsPad = Math.round(dimsFontSize * 0.4);
          const dimsBoxH = dimsFontSize + dimsPad * 2;
          ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
          ctx.fillRect(x, y + h - dimsBoxH, dimsWidth + dimsPad * 2, dimsBoxH);
          ctx.fillStyle = "#ffffff";
          ctx.fillText(dimsText, x + dimsPad, y + h - dimsBoxH + dimsPad);
        }
      });

      canvas.toBlob((blob) => resolve(blob), "image/png", 0.92);
    };
    img.onerror = () => resolve(null);
    img.src = imageUrl;
  });
}
