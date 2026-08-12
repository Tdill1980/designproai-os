import jsPDF from 'jspdf';
import { inkFusionColors } from './restyleproai-colors';

// Featured Pantone colors from the uploaded PDF
const PANTONE_FEATURED_COLORS = [
  { name: 'PANTONE Yellow CS', cmyk: 'C:0 M:5 Y:81 K:0', hex: '#FFF000' },
  { name: 'PANTONE Orange 021 CS', cmyk: 'C:1 M:64 Y:96 K:4', hex: '#FE5000' },
  { name: 'PANTONE Red 032 CS', cmyk: 'C:4 M:89 Y:83 K:0', hex: '#EF3340' },
  { name: 'PANTONE Warm Red CS', cmyk: 'C:3 M:80 Y:84 K:0', hex: '#F9423A' },
  { name: 'PANTONE Violet CS', cmyk: 'C:90 M:92 Y:0 K:0', hex: '#440099' },
  { name: 'PANTONE Blue 072 CS', cmyk: 'C:98 M:78 Y:1 K:0', hex: '#10069F' },
  { name: 'PANTONE Green CS', cmyk: 'C:86 M:0 Y:66 K:0', hex: '#00AB84' },
  { name: 'PANTONE Black CS', cmyk: 'C:90 M:83 Y:93 K:85', hex: '#0A0A0A' },
  { name: 'PANTONE Purple CS', cmyk: 'C:35 M:78 Y:0 K:0', hex: '#BB29BB' },
  { name: 'PANTONE Magenta CS', cmyk: 'C:1 M:100 Y:24 K:0', hex: '#D62598' },
  { name: 'PANTONE Cyan CS', cmyk: 'C:89 M:5 Y:0 K:0', hex: '#00ADE6' },
  { name: 'PANTONE Reflex Blue CS', cmyk: 'C:100 M:72 Y:0 K:18', hex: '#001489' },
];

// Design panel examples
const DESIGN_PANELS = [
  { name: 'Carbon Midnight', path: '/panels/carbon-midnight.png' },
  { name: 'Blue Lightning Strike', path: '/panels/blue-lightning-strike.png' },
  { name: 'Crimson Marble', path: '/panels/crimson-marble.png' },
  { name: 'Electric Storm', path: '/panels/electric-storm.png' },
  { name: 'Neon Tactical', path: '/panels/neon-tactical.png' },
  { name: 'Synthwave Retro', path: '/panels/synthwave-retro.png' },
];

// Vehicle render examples
const VEHICLE_RENDERS = [
  { name: 'Celestial Aqua Hero', path: '/inkfusion/celestial-aqua-hero.png' },
  { name: 'Celestial Aqua Side', path: '/inkfusion/celestial-aqua-side.png' },
  { name: 'Supernova Coral Hood', path: '/inkfusion/supernova-coral-hood.png' },
  { name: 'Wine Burgundy Rear', path: '/inkfusion/wine-burgundy-rear.png' },
];

const PAGE_WIDTH = 210; // A4 width in mm
const PAGE_HEIGHT = 297; // A4 height in mm
const MARGIN = 15;

// Helper to convert hex to RGB
const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 0, g: 0, b: 0 };
};

// Helper to load image as base64
const loadImageAsBase64 = async (imagePath: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } else {
        reject(new Error('Canvas context not available'));
      }
    };
    img.onerror = () => reject(new Error(`Failed to load image: ${imagePath}`));
    img.src = imagePath;
  });
};

// Add black background to page
const addBlackBackground = (pdf: jsPDF) => {
  pdf.setFillColor(0, 0, 0);
  pdf.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, 'F');
};

// Add footer to page
const addFooter = (pdf: jsPDF) => {
  pdf.setFontSize(8);
  pdf.setTextColor(255, 255, 255);
  pdf.text('RestyleProAI PrintPro™', MARGIN, PAGE_HEIGHT - 10);
  pdf.text('weprintwraps.com', PAGE_WIDTH - MARGIN - 35, PAGE_HEIGHT - 10);
  pdf.setFontSize(7);
  pdf.setTextColor(180, 180, 180);
  pdf.text('Color Accuracy. Print Quality. Professional Results.', MARGIN, PAGE_HEIGHT - 6);
};

// Page 1: Cover/Hero Page
const addCoverPage = async (pdf: jsPDF) => {
  addBlackBackground(pdf);

  // Title with gradient effect simulation (magenta to purple)
  pdf.setFontSize(32);
  pdf.setTextColor(217, 70, 239); // Magenta
  pdf.text('RestyleProAI', PAGE_WIDTH / 2, 50, { align: 'center' });
  
  pdf.setFontSize(28);
  pdf.setTextColor(155, 135, 245); // Purple
  pdf.text('PrintPro™', PAGE_WIDTH / 2, 65, { align: 'center' });

  // Tagline
  pdf.setFontSize(12);
  pdf.setTextColor(255, 255, 255);
  pdf.text('Professional Wrap Film Solutions', PAGE_WIDTH / 2, 80, { align: 'center' });
  pdf.text('Color Matched to Pantone Standards', PAGE_WIDTH / 2, 88, { align: 'center' });

  // Try to load hero image
  try {
    const heroImage = await loadImageAsBase64('/inkfusion/nissan-z-celestial-aqua.jpg');
    pdf.addImage(heroImage, 'JPEG', MARGIN, 100, PAGE_WIDTH - 2 * MARGIN, 120);
  } catch (error) {
    console.error('Failed to load hero image:', error);
    pdf.setFontSize(10);
    pdf.setTextColor(150, 150, 150);
    pdf.text('Hero Vehicle Render', PAGE_WIDTH / 2, 160, { align: 'center' });
  }

  addFooter(pdf);
};

// Page 2: Pantone Color Swatches
const addPantoneColorPage = (pdf: jsPDF) => {
  addBlackBackground(pdf);

  // Title
  pdf.setFontSize(20);
  pdf.setTextColor(255, 255, 255);
  pdf.text('Pantone Color Reference', PAGE_WIDTH / 2, 30, { align: 'center' });

  // Color grid (3 columns, 4 rows)
  const cols = 3;
  const rows = 4;
  const swatchWidth = 50;
  const swatchHeight = 15;
  const spacing = 10;
  const startX = (PAGE_WIDTH - (cols * swatchWidth + (cols - 1) * spacing)) / 2;
  const startY = 50;

  PANTONE_FEATURED_COLORS.slice(0, 12).forEach((color, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = startX + col * (swatchWidth + spacing);
    const y = startY + row * 45;

    // Color swatch
    const rgb = hexToRgb(color.hex);
    pdf.setFillColor(rgb.r, rgb.g, rgb.b);
    pdf.rect(x, y, swatchWidth, swatchHeight, 'F');

    // Border
    pdf.setDrawColor(100, 100, 100);
    pdf.rect(x, y, swatchWidth, swatchHeight);

    // Color name
    pdf.setFontSize(8);
    pdf.setTextColor(255, 255, 255);
    pdf.text(color.name, x + swatchWidth / 2, y + swatchHeight + 5, { align: 'center', maxWidth: swatchWidth });

    // CMYK values
    pdf.setFontSize(6);
    pdf.setTextColor(180, 180, 180);
    pdf.text(color.cmyk, x + swatchWidth / 2, y + swatchHeight + 10, { align: 'center', maxWidth: swatchWidth });
  });

  addFooter(pdf);
};

// Page 3: InkFusion Color Collection
const addInkFusionColorPage = (pdf: jsPDF) => {
  addBlackBackground(pdf);

  // Title
  pdf.setFontSize(20);
  pdf.setTextColor(255, 255, 255);
  pdf.text('InkFusion™ Color Collection', PAGE_WIDTH / 2, 30, { align: 'center' });

  // Get unique gloss colors from each family
  const brightColors = inkFusionColors.filter(c => c.family === 'Bright' && c.finish === 'Gloss').slice(0, 7);
  const midColors = inkFusionColors.filter(c => c.family === 'Mid' && c.finish === 'Gloss').slice(0, 7);
  const darkColors = inkFusionColors.filter(c => c.family === 'Dark' && c.finish === 'Gloss').slice(0, 7);
  const neutralColors = inkFusionColors.filter(c => c.family === 'Neutral' && c.finish === 'Gloss');

  const families = [
    { name: 'Bright Family', colors: brightColors },
    { name: 'Mid Family', colors: midColors },
    { name: 'Dark Family', colors: darkColors },
    { name: 'Neutral Family', colors: neutralColors },
  ];

  let yOffset = 45;
  const swatchSize = 12;
  const spacing = 2;

  families.forEach((family) => {
    // Family name
    pdf.setFontSize(12);
    pdf.setTextColor(217, 70, 239); // Magenta
    pdf.text(family.name, MARGIN, yOffset);

    yOffset += 8;

    // Color swatches in a row
    family.colors.forEach((color, index) => {
      const x = MARGIN + index * (swatchSize + spacing + 15);
      
      // Color swatch
      const rgb = hexToRgb(color.hex);
      pdf.setFillColor(rgb.r, rgb.g, rgb.b);
      pdf.rect(x, yOffset, swatchSize, swatchSize, 'F');

      // Border
      pdf.setDrawColor(80, 80, 80);
      pdf.rect(x, yOffset, swatchSize, swatchSize);

      // Color name
      pdf.setFontSize(6);
      pdf.setTextColor(255, 255, 255);
      pdf.text(color.name, x, yOffset + swatchSize + 4, { maxWidth: swatchSize + 15 });
    });

    yOffset += 25;
  });

  addFooter(pdf);
};

// Page 4: Design Panel Examples
const addDesignPanelPage = async (pdf: jsPDF) => {
  addBlackBackground(pdf);

  // Title
  pdf.setFontSize(20);
  pdf.setTextColor(255, 255, 255);
  pdf.text('RestyleLibrary™ Collections', PAGE_WIDTH / 2, 30, { align: 'center' });

  // 2x3 grid
  const cols = 2;
  const rows = 3;
  const imageWidth = 75;
  const imageHeight = 50;
  const spacing = 10;
  const startX = (PAGE_WIDTH - (cols * imageWidth + spacing)) / 2;
  const startY = 50;

  for (let i = 0; i < DESIGN_PANELS.length; i++) {
    const panel = DESIGN_PANELS[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = startX + col * (imageWidth + spacing);
    const y = startY + row * (imageHeight + spacing + 10);

    try {
      const imageData = await loadImageAsBase64(panel.path);
      pdf.addImage(imageData, 'PNG', x, y, imageWidth, imageHeight);
      
      // Panel name
      pdf.setFontSize(8);
      pdf.setTextColor(255, 255, 255);
      pdf.text(panel.name, x + imageWidth / 2, y + imageHeight + 5, { align: 'center' });
    } catch (error) {
      console.error(`Failed to load panel: ${panel.name}`, error);
      // Draw placeholder
      pdf.setDrawColor(100, 100, 100);
      pdf.rect(x, y, imageWidth, imageHeight);
      pdf.setFontSize(8);
      pdf.setTextColor(150, 150, 150);
      pdf.text(panel.name, x + imageWidth / 2, y + imageHeight / 2, { align: 'center' });
    }
  }

  addFooter(pdf);
};

// Page 5: Vehicle Render Showcase
const addVehicleRenderPage = async (pdf: jsPDF) => {
  addBlackBackground(pdf);

  // Title
  pdf.setFontSize(20);
  pdf.setTextColor(255, 255, 255);
  pdf.text('Photorealistic Wrap Visualizations', PAGE_WIDTH / 2, 30, { align: 'center' });

  // 2x2 grid
  const cols = 2;
  const rows = 2;
  const imageWidth = 80;
  const imageHeight = 60;
  const spacing = 10;
  const startX = (PAGE_WIDTH - (cols * imageWidth + spacing)) / 2;
  const startY = 50;

  for (let i = 0; i < VEHICLE_RENDERS.length; i++) {
    const render = VEHICLE_RENDERS[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = startX + col * (imageWidth + spacing);
    const y = startY + row * (imageHeight + spacing + 10);

    try {
      const imageData = await loadImageAsBase64(render.path);
      pdf.addImage(imageData, 'PNG', x, y, imageWidth, imageHeight);
      
      // Render name
      pdf.setFontSize(8);
      pdf.setTextColor(255, 255, 255);
      pdf.text(render.name, x + imageWidth / 2, y + imageHeight + 5, { align: 'center' });
    } catch (error) {
      console.error(`Failed to load render: ${render.name}`, error);
      // Draw placeholder
      pdf.setDrawColor(100, 100, 100);
      pdf.rect(x, y, imageWidth, imageHeight);
      pdf.setFontSize(8);
      pdf.setTextColor(150, 150, 150);
      pdf.text(render.name, x + imageWidth / 2, y + imageHeight / 2, { align: 'center' });
    }
  }

  addFooter(pdf);
};

// Main PDF generation function
export const generatePrintProPoster = async (): Promise<void> => {
  try {
    console.log('Starting PrintPro poster generation...');
    
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    // Page 1: Cover
    await addCoverPage(pdf);

    // Page 2: Pantone colors
    pdf.addPage();
    addPantoneColorPage(pdf);

    // Page 3: InkFusion colors
    pdf.addPage();
    addInkFusionColorPage(pdf);

    // Page 4: Design panels
    pdf.addPage();
    await addDesignPanelPage(pdf);

    // Page 5: Vehicle renders
    pdf.addPage();
    await addVehicleRenderPage(pdf);

    // Save the PDF
    pdf.save('RestyleProAI-PrintPro-Color-Catalog.pdf');
    
    console.log('PrintPro poster generated successfully!');
  } catch (error) {
    console.error('Error generating PrintPro poster:', error);
    throw error;
  }
};
