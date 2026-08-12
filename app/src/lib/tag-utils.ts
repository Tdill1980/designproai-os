/**
 * Utility functions for render tag detection and filtering
 */

export const getColorFamily = (hex: string): string => {
  if (!hex || hex === 'N/A') return 'other';
  
  try {
    const cleanHex = hex.replace('#', '');
    const r = parseInt(cleanHex.slice(0, 2), 16);
    const g = parseInt(cleanHex.slice(2, 4), 16);
    const b = parseInt(cleanHex.slice(4, 6), 16);

    // Teal/Cyan detection (#00A0A0 to #20E0E0)
    if (g > r && b > r && g > 120 && b > 120) return 'teal';
    
    // Blue dominant
    if (b > r && b > g && b > 100) return 'blue';
    
    // Red dominant
    if (r > g && r > b && r > 100) return 'red';
    
    // Green dominant
    if (g > r && g > b && g > 100) return 'green';
    
    // Yellow (high red and green, low blue)
    if (r > 150 && g > 150 && b < 100) return 'yellow';
    
    // Orange (high red, medium green, low blue)
    if (r > 150 && g > 80 && g < 200 && b < 100) return 'orange';
    
    // Purple/Violet
    if (r > 100 && b > 100 && g < Math.min(r, b)) return 'purple';
    
    // Grayscale
    if (Math.abs(r - g) < 30 && Math.abs(g - b) < 30 && Math.abs(r - b) < 30) {
      if (r > 200) return 'white';
      if (r < 50) return 'black';
      return 'gray';
    }
    
    return 'other';
  } catch {
    return 'other';
  }
};

export const getColorFamilyLabel = (family: string): string => {
  const labels: Record<string, string> = {
    teal: 'Teal/Cyan',
    blue: 'Blue',
    red: 'Red',
    green: 'Green',
    yellow: 'Yellow',
    orange: 'Orange',
    purple: 'Purple',
    white: 'White',
    black: 'Black',
    gray: 'Gray',
    other: 'Other'
  };
  return labels[family] || 'Other';
};
