import { jsPDF } from 'jspdf';
import { inkFusionColors, InkFusionColor } from './restyleproai-colors';

// Professional InkFusion Sample Chart Generator
// Creates a print-ready PDF with clean swatches and hex codes

interface ChartConfig {
  title: string;
  subtitle: string;
  includeFinishes: ('Gloss' | 'Satin' | 'Matte')[];
  swatchesPerRow: number;
  swatchSize: number;
  showHexCodes: boolean;
  showColorFamily: boolean;
}

const DEFAULT_CONFIG: ChartConfig = {
  title: 'InkFusion™ Printed Film Collection',
  subtitle: 'Professional Latex Vehicle Wrap Color Samples',
  includeFinishes: ['Gloss', 'Satin', 'Matte'],
  swatchesPerRow: 5,
  swatchSize: 35,
  showHexCodes: true,
  showColorFamily: true,
};

// Convert hex to RGB
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 0, g: 0, b: 0 };
}

// Determine if color is light or dark for text contrast
function isLightColor(hex: string): boolean {
  const { r, g, b } = hexToRgb(hex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5;
}

export async function generateInkFusionSampleChart(
  config: Partial<ChartConfig> = {}
): Promise<Blob> {
  const settings = { ...DEFAULT_CONFIG, ...config };
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;

  // Filter colors by finish
  const filteredColors = inkFusionColors.filter((c) =>
    settings.includeFinishes.includes(c.finish as 'Gloss' | 'Satin' | 'Matte')
  );

  // Group by family for organization
  const colorsByFamily: Record<string, InkFusionColor[]> = {
    Bright: [],
    Mid: [],
    Dark: [],
    Neutral: [],
  };

  filteredColors.forEach((color) => {
    if (colorsByFamily[color.family]) {
      // Remove duplicates (same name different finish)
      const exists = colorsByFamily[color.family].find(
        (c) => c.name === color.name && c.finish === color.finish
      );
      if (!exists) {
        colorsByFamily[color.family].push(color);
      }
    }
  });

  let currentY = margin;

  // === HEADER ===
  // Logo placeholder area
  pdf.setFillColor(10, 10, 15);
  pdf.rect(0, 0, pageWidth, 45, 'F');

  // Brand name
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(28);
  pdf.setTextColor(255, 255, 255);
  pdf.text('InkFusion™', margin, 25);

  // Tagline
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor(150, 150, 150);
  pdf.text('Premium Printed Vehicle Wrap Films', margin, 33);

  // Company info right side
  pdf.setFontSize(9);
  pdf.setTextColor(100, 200, 255);
  pdf.text('DesignProAI.com', pageWidth - margin, 25, { align: 'right' });
  pdf.setTextColor(150, 150, 150);
  pdf.text('Professional Latex Printed Films', pageWidth - margin, 33, { align: 'right' });

  currentY = 55;

  // === TITLE SECTION ===
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(18);
  pdf.setTextColor(30, 30, 30);
  pdf.text(settings.title, pageWidth / 2, currentY, { align: 'center' });

  currentY += 8;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(11);
  pdf.setTextColor(100, 100, 100);
  pdf.text(settings.subtitle, pageWidth / 2, currentY, { align: 'center' });

  currentY += 5;

  // Finish legend
  pdf.setFontSize(9);
  pdf.setTextColor(80, 80, 80);
  const finishText = `Available Finishes: ${settings.includeFinishes.join(' • ')}`;
  pdf.text(finishText, pageWidth / 2, currentY, { align: 'center' });

  currentY += 12;

  // Horizontal divider
  pdf.setDrawColor(200, 200, 200);
  pdf.setLineWidth(0.5);
  pdf.line(margin, currentY, pageWidth - margin, currentY);

  currentY += 10;

  // === COLOR SWATCHES BY FAMILY ===
  const swatchWidth = settings.swatchSize;
  const swatchHeight = 25;
  const gap = 4;
  const textHeight = 18;

  const families = ['Bright', 'Mid', 'Dark', 'Neutral'] as const;

  for (const family of families) {
    const colors = colorsByFamily[family];
    if (colors.length === 0) continue;

    // Check if we need a new page
    if (currentY > pageHeight - 60) {
      pdf.addPage();
      currentY = margin + 10;
    }

    // Family header
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.setTextColor(30, 30, 30);
    pdf.text(`${family} Tones`, margin, currentY);

    // Color count badge
    pdf.setFontSize(9);
    pdf.setTextColor(100, 100, 100);
    const uniqueNames = [...new Set(colors.map((c) => c.name))];
    pdf.text(`${uniqueNames.length} colors`, margin + 35, currentY);

    currentY += 8;

    // Draw swatches
    let x = margin;
    const maxSwatchesPerRow = Math.floor(contentWidth / (swatchWidth + gap));

    // Get unique colors by name (show each color once)
    const uniqueColors = colors.reduce((acc, color) => {
      if (!acc.find((c) => c.name === color.name)) {
        acc.push(color);
      }
      return acc;
    }, [] as InkFusionColor[]);

    uniqueColors.forEach((color, index) => {
      // Check if we need to wrap to next row
      if (x + swatchWidth > pageWidth - margin) {
        x = margin;
        currentY += swatchHeight + textHeight + gap;
      }

      // Check if we need a new page
      if (currentY + swatchHeight + textHeight > pageHeight - 20) {
        pdf.addPage();
        currentY = margin + 10;
        x = margin;

        // Re-add family header on new page
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(12);
        pdf.setTextColor(30, 30, 30);
        pdf.text(`${family} Tones (continued)`, margin, currentY);
        currentY += 8;
      }

      // Draw swatch rectangle with rounded corners effect
      const rgb = hexToRgb(color.hex);
      pdf.setFillColor(rgb.r, rgb.g, rgb.b);
      pdf.roundedRect(x, currentY, swatchWidth, swatchHeight, 2, 2, 'F');

      // Add subtle border
      pdf.setDrawColor(180, 180, 180);
      pdf.setLineWidth(0.3);
      pdf.roundedRect(x, currentY, swatchWidth, swatchHeight, 2, 2, 'S');

      // Color name below swatch
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7);
      pdf.setTextColor(30, 30, 30);

      // Truncate long names
      let displayName = color.name;
      if (displayName.length > 14) {
        displayName = displayName.substring(0, 12) + '...';
      }
      pdf.text(displayName, x + swatchWidth / 2, currentY + swatchHeight + 5, {
        align: 'center',
      });

      // Hex code
      if (settings.showHexCodes) {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(6);
        pdf.setTextColor(100, 100, 100);
        pdf.text(color.hex.toUpperCase(), x + swatchWidth / 2, currentY + swatchHeight + 10, {
          align: 'center',
        });
      }

      x += swatchWidth + gap;
    });

    // Move to next family section
    currentY += swatchHeight + textHeight + 15;
  }

  // === FOOTER ===
  const addFooter = (pageNum: number, totalPages: number) => {
    pdf.setFillColor(245, 245, 245);
    pdf.rect(0, pageHeight - 25, pageWidth, 25, 'F');

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(100, 100, 100);

    // Left side - specs
    pdf.text('Latex Printed • Air Release Technology • 5+ Year Durability', margin, pageHeight - 15);

    // Center - contact
    pdf.setTextColor(50, 150, 200);
    pdf.text('sales@weprintwraps.com', pageWidth / 2, pageHeight - 15, { align: 'center' });

    // Right side - page number
    pdf.setTextColor(100, 100, 100);
    pdf.text(`Page ${pageNum} of ${totalPages}`, pageWidth - margin, pageHeight - 15, {
      align: 'right',
    });

    // Copyright
    pdf.setFontSize(7);
    pdf.text(
      `© ${new Date().getFullYear()} DesignProAI™. All colors shown are representations and may vary in print.`,
      pageWidth / 2,
      pageHeight - 8,
      { align: 'center' }
    );
  };

  // Add footers to all pages
  const totalPages = pdf.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i);
    addFooter(i, totalPages);
  }

  return pdf.output('blob');
}

// Download helper
export async function downloadInkFusionSampleChart(
  filename: string = 'InkFusion-Color-Sample-Chart.pdf',
  config?: Partial<ChartConfig>
): Promise<void> {
  const blob = await generateInkFusionSampleChart(config);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
