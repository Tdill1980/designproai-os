import jsPDF from 'jspdf';
import { stampOverlayAsDataUrl, OverlaySpec } from './overlay-stamper';
import { getToolLabel, isValidToolKey, type ToolKey, PLATFORM_LABEL } from './tool-registry';

interface ViewData {
  type: string;
  url: string;
  label: string;
}

interface ProofSheetData {
  views: ViewData[];
  vehicleInfo: {
    year: string;
    make: string;
    model: string;
  };
  designName: string;
  /** Tool key from registry - PREFERRED */
  toolKey?: ToolKey;
  /** Legacy: free-form tool name (will be mapped to registry if possible) */
  toolName?: string;
  /** Manufacturer name for overlay (e.g., "3M", "Avery Dennison") */
  manufacturer?: string;
}

interface ImageDimensions {
  base64: string;
  width: number;
  height: number;
}

/**
 * Resolve tool label from registry
 * Priority: toolKey > legacy toolName mapping > platform fallback
 */
function resolveToolLabel(data: ProofSheetData): string {
  // Priority 1: Use toolKey from registry
  if (data.toolKey && isValidToolKey(data.toolKey)) {
    return getToolLabel(data.toolKey);
  }
  
  // Priority 2: Try to map legacy toolName to registry
  if (data.toolName) {
    const normalized = data.toolName.toLowerCase().replace(/[™®\s]/g, '');
    if (isValidToolKey(normalized as ToolKey)) {
      return getToolLabel(normalized as ToolKey);
    }
  }
  
  // Priority 3: Fallback to platform label
  return PLATFORM_LABEL;
}

// Helper to load image and get natural dimensions
const loadImageWithDimensions = async (url: string): Promise<ImageDimensions> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = async () => {
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        const reader = new FileReader();
        
        reader.onloadend = () => {
          resolve({
            base64: reader.result as string,
            width: img.naturalWidth,
            height: img.naturalHeight
          });
        };
        reader.onerror = () => reject(new Error('Failed to read image'));
        reader.readAsDataURL(blob);
      } catch (err) {
        reject(err);
      }
    };
    
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
};

// Calculate dimensions that fit within cell while preserving aspect ratio
const calculateFitDimensions = (
  imgWidth: number,
  imgHeight: number,
  maxWidth: number,
  maxHeight: number
): { finalWidth: number; finalHeight: number } => {
  const imgAspect = imgWidth / imgHeight;
  let finalWidth = maxWidth;
  let finalHeight = maxWidth / imgAspect;
  
  // If too tall, scale down to fit height
  if (finalHeight > maxHeight) {
    finalHeight = maxHeight;
    finalWidth = finalHeight * imgAspect;
  }
  
  return { finalWidth, finalHeight };
};

export const generateProofSheet = async (data: ProofSheetData): Promise<void> => {
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 12;
  const contentWidth = pageWidth - (margin * 2);

  // Resolve tool label from registry
  const toolLabel = resolveToolLabel(data);

  // ===== HEADER - Branded Typography =====
  pdf.setFont('helvetica', 'bolditalic');
  pdf.setFontSize(26);
  pdf.setTextColor(59, 130, 246); // Primary blue
  pdf.text(PLATFORM_LABEL, margin, margin + 10);
  
  // Tool sub-brand from registry
  pdf.setFontSize(16);
  pdf.setTextColor(148, 163, 184); // Muted gray
  pdf.text(toolLabel, margin, margin + 18);

  // Vehicle Info
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  pdf.setTextColor(30, 41, 59); // Dark text
  pdf.text(
    `${data.vehicleInfo.year} ${data.vehicleInfo.make} ${data.vehicleInfo.model}`,
    margin,
    margin + 28
  );

  // Design name
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(11);
  pdf.setTextColor(100, 116, 139);
  pdf.text(`Design: ${data.designName}`, margin, margin + 35);

  // Separator line
  pdf.setDrawColor(203, 213, 225);
  pdf.setLineWidth(0.5);
  pdf.line(margin, margin + 40, pageWidth - margin, margin + 40);

  // Section title
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.setTextColor(51, 65, 85);
  pdf.text('Professional 3D Wrap Preview - All Angles', margin, margin + 48);

  // ===== GRID LAYOUT =====
  const gridStartY = margin + 54;
  const spacing = 6;
  const labelSpace = 8;
  const cols = 2;
  const rows = 3;
  
  // Calculate cell dimensions
  const cellWidth = (contentWidth - spacing) / cols;
  const availableHeight = pageHeight - gridStartY - 20; // Leave room for footer
  const cellHeight = (availableHeight - (spacing * (rows - 1))) / rows;
  const maxImageHeight = cellHeight - labelSpace;

  // View order for grid - matches locked VIEW_ORDER from view-angles-os.ts
  const viewOrder = ['side', 'passenger-side', 'hood_detail', 'rear', 'close-up', 'roof'];

  for (let i = 0; i < viewOrder.length && i < 6; i++) {
    const viewType = viewOrder[i];
    const view = data.views.find(v => v.type === viewType);
    
    const col = i % cols;
    const row = Math.floor(i / cols);
    
    const cellX = margin + (col * (cellWidth + spacing));
    const cellY = gridStartY + (row * (cellHeight + spacing));

    if (view) {
      try {
        // Stamp overlay onto image before embedding in PDF
        const overlay: OverlaySpec = {
          toolKey: data.toolKey,
          toolName: data.toolName,
          manufacturer: data.manufacturer,
          colorOrDesignName: data.designName,
        };
        const stampedDataUrl = await stampOverlayAsDataUrl(view.url, overlay);
        
        // Load stamped image dimensions
        const imgData = await loadImageWithDimensions(stampedDataUrl);
        
        // Calculate fit dimensions preserving aspect ratio
        const { finalWidth, finalHeight } = calculateFitDimensions(
          imgData.width,
          imgData.height,
          cellWidth,
          maxImageHeight
        );
        
        // Center the image within the cell
        const xOffset = cellX + (cellWidth - finalWidth) / 2;
        const yOffset = cellY + (maxImageHeight - finalHeight) / 2;
        
        // Add image without distortion
        pdf.addImage(imgData.base64, 'JPEG', xOffset, yOffset, finalWidth, finalHeight);
        
        // Add label below image
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        pdf.setTextColor(71, 85, 105);
        pdf.text(view.label, cellX + (cellWidth / 2), cellY + maxImageHeight + 5, { align: 'center' });
        
      } catch (error) {
        console.error(`Failed to load image for ${view.label}:`, error);
        
        // Draw placeholder
        pdf.setDrawColor(203, 213, 225);
        pdf.setFillColor(241, 245, 249);
        pdf.rect(cellX, cellY, cellWidth, maxImageHeight, 'FD');
        
        pdf.setFont('helvetica', 'italic');
        pdf.setFontSize(9);
        pdf.setTextColor(148, 163, 184);
        pdf.text('Image unavailable', cellX + (cellWidth / 2), cellY + (maxImageHeight / 2), { align: 'center' });
      }
    } else {
      // Empty cell placeholder
      pdf.setDrawColor(226, 232, 240);
      pdf.setFillColor(248, 250, 252);
      pdf.rect(cellX, cellY, cellWidth, maxImageHeight, 'FD');
      
      pdf.setFont('helvetica', 'italic');
      pdf.setFontSize(9);
      pdf.setTextColor(148, 163, 184);
      const viewLabel = viewType.replace('-', ' ').replace(/\b\w/g, c => c.toUpperCase());
      pdf.text(`${viewLabel} - Pending`, cellX + (cellWidth / 2), cellY + (maxImageHeight / 2), { align: 'center' });
    }
  }

  // ===== FOOTER =====
  const footerY = pageHeight - 10;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(148, 163, 184);
  pdf.text(
    `Generated by ${PLATFORM_LABEL} ${toolLabel} | ${new Date().toLocaleDateString()}`,
    pageWidth / 2,
    footerY,
    { align: 'center' }
  );

  // Download PDF
  const filename = `${data.vehicleInfo.year}-${data.vehicleInfo.make}-${data.vehicleInfo.model}-Proof-Sheet.pdf`;
  pdf.save(filename);
};
