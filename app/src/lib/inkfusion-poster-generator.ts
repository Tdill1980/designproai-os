/**
 * InkFusion™ Professional 50-Color Poster Generator
 * 48" × 36" Landscape - Premium Black Background Design
 * Matching 3M Professional Quality Standards
 */

import { jsPDF } from 'jspdf';
import { inkFusionColors, InkFusionColor } from './restyleproai-colors';

// Poster dimensions in mm (48" × 36")
const POSTER_WIDTH = 1219.2; // 48 inches
const POSTER_HEIGHT = 914.4; // 36 inches

// Brand colors
const BRAND_BLUE = { r: 59, g: 130, b: 246 };      // #3B82F6
const BRAND_MAGENTA = { r: 255, g: 45, b: 161 };  // #FF2DA1
const BRAND_PURPLE = { r: 182, g: 32, b: 224 };   // #B620E0
const DARK_BG = { r: 10, g: 10, b: 15 };          // #0A0A0F
const LIGHT_GRAY = { r: 136, g: 136, b: 136 };    // #888888
const WHITE = { r: 255, g: 255, b: 255 };

interface PosterConfig {
  title: string;
  subtitle: string;
}

const DEFAULT_CONFIG: PosterConfig = {
  title: 'InkFusion™',
  subtitle: 'Premium Latex Printed Films'
};

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
}

function rgbToCmyk(r: number, g: number, b: number): { c: number; m: number; y: number; k: number } {
  const rPrime = r / 255;
  const gPrime = g / 255;
  const bPrime = b / 255;
  
  const k = 1 - Math.max(rPrime, gPrime, bPrime);
  if (k === 1) return { c: 0, m: 0, y: 0, k: 100 };
  
  const c = Math.round(((1 - rPrime - k) / (1 - k)) * 100);
  const m = Math.round(((1 - gPrime - k) / (1 - k)) * 100);
  const y = Math.round(((1 - bPrime - k) / (1 - k)) * 100);
  
  return { c, m, y, k: Math.round(k * 100) };
}

function hexToCmykString(hex: string): string {
  const rgb = hexToRgb(hex);
  const cmyk = rgbToCmyk(rgb.r, rgb.g, rgb.b);
  return `C${cmyk.c} M${cmyk.m} Y${cmyk.y} K${cmyk.k}`;
}

function getProductCode(color: InkFusionColor, index: number): string {
  const familyPrefix: Record<string, string> = {
    'Bright': 'B',
    'Mid': 'M',
    'Dark': 'D',
    'Neutral': 'N'
  };
  const prefix = familyPrefix[color.family] || 'X';
  const num = String(index + 1).padStart(2, '0');
  return `IF-${prefix}${num}`;
}

// Load image and convert to base64 for PDF embedding
async function loadImageAsBase64(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Failed to load image:', error);
    return null;
  }
}

export async function generateInkFusionPoster(
  config: Partial<PosterConfig> = {}
): Promise<Blob> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  
  // Load Nissan Z image for vehicle showcase
  const nissanZImageUrl = '/inkfusion/nissan-z-celestial-aqua.jpg';
  const nissanZBase64 = await loadImageAsBase64(nissanZImageUrl);
  
  // Create PDF in landscape orientation
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [POSTER_WIDTH, POSTER_HEIGHT]
  });

  // ============================================
  // FULL BLACK BACKGROUND
  // ============================================
  doc.setFillColor(DARK_BG.r, DARK_BG.g, DARK_BG.b);
  doc.rect(0, 0, POSTER_WIDTH, POSTER_HEIGHT, 'F');

  // Get exactly 50 Gloss colors, deduplicated and sorted by family
  const uniqueColors = inkFusionColors
    .filter((c) => c.finish === 'Gloss')
    .reduce((acc, color) => {
      if (!acc.find((c) => c.name === color.name)) {
        acc.push(color);
      }
      return acc;
    }, [] as InkFusionColor[]);

  // Sort by family order
  const familyOrder = ['Bright', 'Mid', 'Dark', 'Neutral'];
  const sortedColors: InkFusionColor[] = [];
  familyOrder.forEach((family) => {
    const familyColors = uniqueColors.filter((c) => c.family === family);
    sortedColors.push(...familyColors);
  });

  // Ensure exactly 50 colors
  while (sortedColors.length < 50) {
    sortedColors.push({
      id: `placeholder-${sortedColors.length}`,
      name: 'Reserved',
      hex: '#333333',
      finish: 'Gloss',
      family: 'Neutral'
    });
  }

  // ============================================
  // HEADER SECTION (150mm height) - Premium Design
  // ============================================
  const headerHeight = 150;
  
  // Subtle gradient accent line under header
  doc.setFillColor(BRAND_BLUE.r, BRAND_BLUE.g, BRAND_BLUE.b);
  doc.rect(0, headerHeight - 3, POSTER_WIDTH, 3, 'F');

  // "50 COLORS" badge (top right)
  const badgeX = POSTER_WIDTH - 220;
  const badgeY = 25;
  doc.setFillColor(BRAND_BLUE.r, BRAND_BLUE.g, BRAND_BLUE.b);
  doc.roundedRect(badgeX, badgeY, 180, 50, 25, 25, 'F');
  doc.setFontSize(28);
  doc.setTextColor(DARK_BG.r, DARK_BG.g, DARK_BG.b);
  doc.setFont('helvetica', 'bold');
  doc.text('50 COLORS', badgeX + 90, badgeY + 34, { align: 'center' });

  // Main Logo - "Ink" in WHITE (LARGE)
  const logoX = 60;
  const logoY = 85;
  
  doc.setFontSize(140);
  doc.setTextColor(WHITE.r, WHITE.g, WHITE.b);
  doc.setFont('helvetica', 'bold');
  doc.text('Ink', logoX, logoY);
  
  // "Fusion" in TEAL/CYAN (LARGE)
  const fusionX = logoX + 245;
  doc.setTextColor(BRAND_BLUE.r, BRAND_BLUE.g, BRAND_BLUE.b);
  doc.text('Fusion', fusionX, logoY);
  
  // "™" symbol in TEAL/CYAN
  doc.setFontSize(48);
  doc.setTextColor(BRAND_BLUE.r, BRAND_BLUE.g, BRAND_BLUE.b);
  doc.text('™', fusionX + 410, logoY - 55);

  // Tagline - "Premium Latex Printed Films"
  doc.setFontSize(36);
  doc.setTextColor(LIGHT_GRAY.r, LIGHT_GRAY.g, LIGHT_GRAY.b);
  doc.setFont('helvetica', 'normal');
  doc.text(finalConfig.subtitle, logoX, logoY + 50);

  // Right side branding section
  const rightX = POSTER_WIDTH - 60;
  
  // RestylePro™ Logo - Blue/White branding
  doc.setFontSize(48);
  doc.setFont('helvetica', 'bold');
  
  // Calculate text widths for positioning (right-aligned)
  const restyleText = 'Restyle';
  const proText = 'Pro';
  const tmText = '™';
  
  // Approximate character widths at font size 48 (helvetica bold)
  const charWidth = 24; // approx mm per character
  const restyleWidth = restyleText.length * charWidth;
  const proWidth = proText.length * charWidth;
  const tmWidth = 18; // smaller for ™
  const totalWidth = restyleWidth + proWidth + tmWidth;
  
  const restyleStartX = rightX - totalWidth;
  
  // "Restyle" in WHITE
  doc.setTextColor(WHITE.r, WHITE.g, WHITE.b);
  doc.text(restyleText, restyleStartX, logoY - 15);
  
  // "Pro" in CYAN (blue)
  doc.setTextColor(BRAND_BLUE.r, BRAND_BLUE.g, BRAND_BLUE.b);
  doc.text(proText, restyleStartX + restyleWidth, logoY - 15);
  
  // "™" in CYAN
  doc.setFontSize(24);
  doc.text(tmText, restyleStartX + restyleWidth + proWidth, logoY - 30);
  
  // RestyleProAI.com - cyan accent
  doc.setFontSize(48);
  doc.setTextColor(BRAND_BLUE.r, BRAND_BLUE.g, BRAND_BLUE.b);
  doc.setFont('helvetica', 'bold');
  doc.text('RestyleProAI.com', rightX, logoY + 35, { align: 'right' });

  // ============================================
  // SWATCH GRID SECTION - LARGER SWATCHES
  // ============================================
  const gridStartY = headerHeight + 25;
  const gridMarginX = 50;
  const footerHeight = 85;
  const vehicleShowcaseWidth = 280; // Space for Nissan Z image
  const availableWidth = POSTER_WIDTH - (gridMarginX * 2) - vehicleShowcaseWidth - 20;
  const availableHeight = POSTER_HEIGHT - gridStartY - footerHeight - 15;

  const cols = 10;
  const rows = 5;
  const gapX = 12;
  const gapY = 14;
  
  // Calculate swatch dimensions (MUCH LARGER swatches)
  const textHeight = 55; // Space for name, code, CMYK
  const swatchWidth = (availableWidth - (gapX * (cols - 1))) / cols;
  const swatchHeight = (availableHeight - (gapY * (rows - 1))) / rows - textHeight;

  // Track color index by family for product codes
  const familyCounters: Record<string, number> = {
    'Bright': 0,
    'Mid': 0,
    'Dark': 0,
    'Neutral': 0
  };

  // Draw swatches with LARGE color names
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const index = row * cols + col;
      if (index >= sortedColors.length) continue;

      const color = sortedColors[index];
      const x = gridMarginX + col * (swatchWidth + gapX);
      const y = gridStartY + row * (swatchHeight + textHeight + gapY);

      // Get product code
      const familyIndex = familyCounters[color.family];
      familyCounters[color.family]++;
      const productCode = getProductCode(color, familyIndex);

      // Draw swatch with rounded corners (LARGER)
      const rgb = hexToRgb(color.hex);
      doc.setFillColor(rgb.r, rgb.g, rgb.b);
      doc.roundedRect(x, y, swatchWidth, swatchHeight, 10, 10, 'F');

      // Add subtle white border for dark colors
      doc.setDrawColor(60, 60, 60);
      doc.setLineWidth(0.8);
      doc.roundedRect(x, y, swatchWidth, swatchHeight, 10, 10, 'S');

      // Text below swatch - on black background
      const textY = y + swatchHeight + 18;
      
      // Color Name (BOLD WHITE - LARGE)
      doc.setFontSize(20);
      doc.setTextColor(WHITE.r, WHITE.g, WHITE.b);
      doc.setFont('helvetica', 'bold');
      // Truncate name if too long
      const displayName = color.name.length > 14 ? color.name.substring(0, 12) + '...' : color.name;
      doc.text(displayName, x + swatchWidth / 2, textY, { align: 'center' });

      // Product Code (CYAN accent)
      doc.setFontSize(15);
      doc.setTextColor(BRAND_BLUE.r, BRAND_BLUE.g, BRAND_BLUE.b);
      doc.setFont('helvetica', 'bold');
      doc.text(productCode, x + swatchWidth / 2, textY + 18, { align: 'center' });

      // CMYK values (subtle gray)
      doc.setFontSize(11);
      doc.setTextColor(LIGHT_GRAY.r, LIGHT_GRAY.g, LIGHT_GRAY.b);
      doc.setFont('helvetica', 'normal');
      doc.text(hexToCmykString(color.hex), x + swatchWidth / 2, textY + 34, { align: 'center' });
    }
  }

  // ============================================
  // NISSAN Z VEHICLE SHOWCASE (Bottom Right)
  // ============================================
  const vehicleX = POSTER_WIDTH - vehicleShowcaseWidth - 40;
  const vehicleY = gridStartY + 60;
  const vehicleWidth = vehicleShowcaseWidth;
  const vehicleHeight = 180;
  const totalBoxHeight = vehicleHeight + 100;

  // Vehicle showcase background box
  doc.setFillColor(18, 18, 22);
  doc.roundedRect(vehicleX, vehicleY, vehicleWidth, totalBoxHeight, 12, 12, 'F');
  
  // Cyan border accent
  doc.setDrawColor(BRAND_BLUE.r, BRAND_BLUE.g, BRAND_BLUE.b);
  doc.setLineWidth(2);
  doc.roundedRect(vehicleX, vehicleY, vehicleWidth, totalBoxHeight, 12, 12, 'S');

  // "FEATURED" badge
  doc.setFillColor(BRAND_MAGENTA.r, BRAND_MAGENTA.g, BRAND_MAGENTA.b);
  doc.roundedRect(vehicleX + 20, vehicleY + 12, 100, 26, 13, 13, 'F');
  doc.setFontSize(13);
  doc.setTextColor(WHITE.r, WHITE.g, WHITE.b);
  doc.setFont('helvetica', 'bold');
  doc.text('FEATURED', vehicleX + 70, vehicleY + 30, { align: 'center' });

  // Add Nissan Z image if loaded successfully
  const imageX = vehicleX + 15;
  const imageY = vehicleY + 48;
  const imageWidth = vehicleWidth - 30;
  const imageHeight = vehicleHeight - 30;

  if (nissanZBase64) {
    try {
      doc.addImage(nissanZBase64, 'JPEG', imageX, imageY, imageWidth, imageHeight);
    } catch (error) {
      console.error('Failed to add image to PDF:', error);
      // Fallback: draw placeholder
      doc.setFillColor(25, 25, 30);
      doc.roundedRect(imageX, imageY, imageWidth, imageHeight, 8, 8, 'F');
      doc.setFontSize(14);
      doc.setTextColor(60, 60, 65);
      doc.text('Nissan Z Image', vehicleX + vehicleWidth / 2, imageY + imageHeight / 2, { align: 'center' });
    }
  } else {
    // Fallback: draw placeholder if image didn't load
    doc.setFillColor(25, 25, 30);
    doc.roundedRect(imageX, imageY, imageWidth, imageHeight, 8, 8, 'F');
    doc.setFontSize(14);
    doc.setTextColor(60, 60, 65);
    doc.text('Nissan Z', vehicleX + vehicleWidth / 2, imageY + imageHeight / 2, { align: 'center' });
  }

  // Vehicle caption below image
  const captionY = imageY + imageHeight + 18;
  doc.setFontSize(22);
  doc.setTextColor(WHITE.r, WHITE.g, WHITE.b);
  doc.setFont('helvetica', 'bold');
  doc.text('Nissan Z', vehicleX + vehicleWidth / 2, captionY, { align: 'center' });
  
  doc.setFontSize(18);
  doc.setTextColor(BRAND_BLUE.r, BRAND_BLUE.g, BRAND_BLUE.b);
  doc.setFont('helvetica', 'normal');
  doc.text('Celestial Aqua', vehicleX + vehicleWidth / 2, captionY + 22, { align: 'center' });

  // "See it on your vehicle" CTA
  doc.setFontSize(12);
  doc.setTextColor(LIGHT_GRAY.r, LIGHT_GRAY.g, LIGHT_GRAY.b);
  doc.text('Visualize at RestylePro.com', vehicleX + vehicleWidth / 2, captionY + 42, { align: 'center' });

  // ============================================
  // FOOTER SECTION - Professional Design
  // ============================================
  const footerY = POSTER_HEIGHT - footerHeight;
  
  // Cyan accent line at top of footer
  doc.setFillColor(BRAND_BLUE.r, BRAND_BLUE.g, BRAND_BLUE.b);
  doc.rect(0, footerY, POSTER_WIDTH, 4, 'F');

  // Product specifications (left)
  const specY = footerY + 35;
  doc.setFontSize(18);
  doc.setTextColor(WHITE.r, WHITE.g, WHITE.b);
  doc.setFont('helvetica', 'bold');
  doc.text('SPECIFICATIONS', 60, specY);
  
  doc.setFontSize(15);
  doc.setTextColor(LIGHT_GRAY.r, LIGHT_GRAY.g, LIGHT_GRAY.b);
  doc.setFont('helvetica', 'normal');
  doc.text('Latex Printed  •  Air Release Technology  •  5+ Year Durability  •  Available in Gloss, Satin & Matte', 60, specY + 25);

  // Contact info (center)
  doc.setFontSize(18);
  doc.setTextColor(WHITE.r, WHITE.g, WHITE.b);
  doc.setFont('helvetica', 'bold');
  doc.text('CONTACT', POSTER_WIDTH / 2 + 100, specY);
  
  doc.setFontSize(15);
  doc.setTextColor(BRAND_BLUE.r, BRAND_BLUE.g, BRAND_BLUE.b);
  doc.setFont('helvetica', 'normal');
  doc.text('sales@weprintwraps.com', POSTER_WIDTH / 2 + 100, specY + 25);

  // Copyright (far right)
  doc.setFontSize(13);
  doc.setTextColor(LIGHT_GRAY.r, LIGHT_GRAY.g, LIGHT_GRAY.b);
  doc.text('© 2025 RestyleProAI™. All Rights Reserved.', POSTER_WIDTH - 60, specY + 25, { align: 'right' });

  // RestylePro branding in footer - Blue/White
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  
  // Footer RestylePro positioning
  const footerRestyleX = POSTER_WIDTH - 280;
  
  // "Powered by " in gray
  doc.setTextColor(LIGHT_GRAY.r, LIGHT_GRAY.g, LIGHT_GRAY.b);
  doc.text('Powered by ', footerRestyleX, specY);
  
  // "Restyle" in WHITE
  doc.setTextColor(WHITE.r, WHITE.g, WHITE.b);
  doc.text('Restyle', footerRestyleX + 70, specY);
  
  // "Pro™" in CYAN
  doc.setTextColor(BRAND_BLUE.r, BRAND_BLUE.g, BRAND_BLUE.b);
  doc.text('ProAI™ Vehicle Wrap Design Suite', footerRestyleX + 118, specY);

  // Return as blob
  return doc.output('blob');
}

// Download helper
export async function downloadInkFusionPoster(
  filename: string = 'InkFusion-50-Color-Poster-48x36.pdf',
  config?: Partial<PosterConfig>
): Promise<void> {
  const blob = await generateInkFusionPoster(config);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
