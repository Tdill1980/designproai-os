export type FinishType = 'Gloss' | 'Satin' | 'Matte' | 'Flip' | 'Brushed' | 'Textured' | 'Chrome' | 'Specialty' | 'All';

export interface InkFusionColor {
  id: string;
  name: string;
  hex: string;
  renderHex?: string;       // Darker/richer for AI ink-density rendering
  inkDensity?: number;      // 0.8-1.5 ink absorption factor
  finish: FinishType;
  family: 'Bright' | 'Mid' | 'Dark' | 'Neutral';
  media_url?: string;
  colorLibrary?: 'inkfusion' | 'avery' | 'avery_sw900' | '3m' | '3m_2080' | 'custom' | 'verified_vinyl';
  manufacturer?: string;
  patternType?: string;
  hasMetallicFlakes?: boolean;
  swatchImageUrl?: string;
}

export const inkFusionColors: InkFusionColor[] = [
  // Bright Family - All in Gloss (14 colors) with ink-density profiles
  { id: 'bright-01', name: 'Celestial Aqua', hex: '#00E5E5', renderHex: '#00B8B8', inkDensity: 1.15, finish: 'Gloss', family: 'Bright' },
  { id: 'bright-02', name: 'Nebula Cyan', hex: '#00D4FF', renderHex: '#009CB8', inkDensity: 1.2, finish: 'Gloss', family: 'Bright' },
  { id: 'bright-03', name: 'Stellar Blue', hex: '#0080FF', renderHex: '#0060CC', inkDensity: 1.18, finish: 'Gloss', family: 'Bright' },
  { id: 'bright-04', name: 'Supernova Coral', hex: '#FF6B6B', renderHex: '#E05050', inkDensity: 1.12, finish: 'Gloss', family: 'Bright' },
  { id: 'bright-05', name: 'Orion Magenta', hex: '#FF00FF', renderHex: '#CC00CC', inkDensity: 1.2, finish: 'Gloss', family: 'Bright' },
  { id: 'bright-06', name: 'Lunar Amber', hex: '#FFB800', renderHex: '#D99A00', inkDensity: 1.1, finish: 'Gloss', family: 'Bright' },
  { id: 'bright-07', name: 'Galactic Lime', hex: '#B8FF00', renderHex: '#96CC00', inkDensity: 1.15, finish: 'Gloss', family: 'Bright' },
  { id: 'bright-08', name: 'Nova Pink', hex: '#FF69B4', renderHex: '#E05090', inkDensity: 1.12, finish: 'Gloss', family: 'Bright' },
  { id: 'bright-09', name: 'Solar Flare Yellow', hex: '#FFD700', renderHex: '#D9B800', inkDensity: 1.08, finish: 'Gloss', family: 'Bright' },
  { id: 'bright-10', name: 'Ice Blue', hex: '#87CEEB', renderHex: '#6BB0CC', inkDensity: 1.1, finish: 'Gloss', family: 'Bright' },
  { id: 'bright-11', name: 'Electric Teal', hex: '#00CED1', renderHex: '#00A5A8', inkDensity: 1.18, finish: 'Gloss', family: 'Bright' },
  { id: 'bright-12', name: 'Cyber Green', hex: '#00FF00', renderHex: '#00CC00', inkDensity: 1.2, finish: 'Gloss', family: 'Bright' },
  { id: 'bright-13', name: 'Cherry Blossom', hex: '#FFB7C5', renderHex: '#E09DA8', inkDensity: 1.05, finish: 'Gloss', family: 'Bright' },
  { id: 'bright-14', name: 'Candy Apple Red', hex: '#FF0800', renderHex: '#CC0600', inkDensity: 1.22, finish: 'Gloss', family: 'Bright' },

  // Mid Family - All in Gloss (14 colors)
  { id: 'mid-01', name: 'Horizon Blue', hex: '#4682B4', finish: 'Gloss', family: 'Mid' },
  { id: 'mid-02', name: 'Aurora Violet', hex: '#8B7AB8', finish: 'Gloss', family: 'Mid' },
  { id: 'mid-03', name: 'Ion Green', hex: '#50C878', finish: 'Gloss', family: 'Mid' },
  { id: 'mid-04', name: 'Solar Copper', hex: '#B87333', finish: 'Gloss', family: 'Mid' },
  { id: 'mid-05', name: 'Rocket Red', hex: '#DC143C', finish: 'Gloss', family: 'Mid' },
  { id: 'mid-06', name: 'Plasma Orange', hex: '#FF8C00', finish: 'Gloss', family: 'Mid' },
  { id: 'mid-07', name: 'Cosmic Taupe', hex: '#967969', finish: 'Gloss', family: 'Mid' },
  { id: 'mid-08', name: 'Satellite Silver', hex: '#C0C0C0', finish: 'Gloss', family: 'Mid' },
  { id: 'mid-09', name: 'Crimson Burst', hex: '#9B1B30', finish: 'Gloss', family: 'Mid' },
  { id: 'mid-10', name: 'Burnt Orange', hex: '#CC5500', finish: 'Gloss', family: 'Mid' },
  { id: 'mid-11', name: 'Sunset Red', hex: '#FA5F55', finish: 'Gloss', family: 'Mid' },
  { id: 'mid-12', name: 'Champagne Gold', hex: '#F7E7CE', finish: 'Gloss', family: 'Mid' },
  { id: 'mid-13', name: 'Tangerine', hex: '#F28500', finish: 'Gloss', family: 'Mid' },
  { id: 'mid-14', name: 'Storm Blue', hex: '#4F666A', finish: 'Gloss', family: 'Mid' },

  // Dark Family - All in Gloss (14 colors)
  { id: 'dark-01', name: 'Void Black', hex: '#0A0A0A', finish: 'Gloss', family: 'Dark' },
  { id: 'dark-02', name: 'Eclipse Navy', hex: '#000080', finish: 'Gloss', family: 'Dark' },
  { id: 'dark-03', name: 'Shadow Graphite', hex: '#36454F', finish: 'Gloss', family: 'Dark' },
  { id: 'dark-04', name: 'Meteorite Charcoal', hex: '#2F4F4F', finish: 'Gloss', family: 'Dark' },
  { id: 'dark-05', name: 'Earth Moss', hex: '#4A5D23', finish: 'Gloss', family: 'Dark' },
  { id: 'dark-06', name: 'Midnight Teal', hex: '#014F4B', finish: 'Gloss', family: 'Dark' },
  { id: 'dark-07', name: 'Deep Ocean Blue', hex: '#003D5C', finish: 'Gloss', family: 'Dark' },
  { id: 'dark-08', name: 'Forest Hunter Green', hex: '#355E3B', finish: 'Gloss', family: 'Dark' },
  { id: 'dark-09', name: 'Royal Purple', hex: '#4B0082', finish: 'Gloss', family: 'Dark' },
  { id: 'dark-10', name: 'Wine Burgundy', hex: '#800020', finish: 'Gloss', family: 'Dark' },
  { id: 'dark-11', name: 'Deep Plum', hex: '#4A0E4E', finish: 'Gloss', family: 'Dark' },
  { id: 'dark-12', name: 'Olive Drab', hex: '#6B8E23', finish: 'Gloss', family: 'Dark' },
  { id: 'dark-13', name: 'Gunmetal', hex: '#2A3439', finish: 'Gloss', family: 'Dark' },
  { id: 'dark-14', name: 'Midnight Blue', hex: '#191970', finish: 'Gloss', family: 'Dark' },

  // Neutral Family - All in Gloss (8 colors)
  { id: 'neutral-01', name: 'Space Pearl', hex: '#F8F8FF', finish: 'Gloss', family: 'Neutral' },
  { id: 'neutral-02', name: 'Ash Gray', hex: '#B2BEB5', finish: 'Gloss', family: 'Neutral' },
  { id: 'neutral-03', name: 'Steel Gray', hex: '#71797E', finish: 'Gloss', family: 'Neutral' },
  { id: 'neutral-04', name: 'Mystic White', hex: '#FFFFFF', finish: 'Gloss', family: 'Neutral' },
  { id: 'neutral-05', name: 'Storm Gray', hex: '#535662', finish: 'Gloss', family: 'Neutral' },
  { id: 'neutral-06', name: 'Platinum', hex: '#E5E4E2', finish: 'Gloss', family: 'Neutral' },
  { id: 'neutral-07', name: 'Carbon Black', hex: '#1C1C1C', finish: 'Gloss', family: 'Neutral' },
  { id: 'neutral-08', name: 'Titanium Silver', hex: '#878787', finish: 'Gloss', family: 'Neutral' },
  
  // Satin Finish Options (14 colors from Mid family)
  { id: 'mid-01-satin', name: 'Horizon Blue', hex: '#4682B4', finish: 'Satin', family: 'Mid' },
  { id: 'mid-02-satin', name: 'Aurora Violet', hex: '#8B7AB8', finish: 'Satin', family: 'Mid' },
  { id: 'mid-03-satin', name: 'Ion Green', hex: '#50C878', finish: 'Satin', family: 'Mid' },
  { id: 'mid-04-satin', name: 'Solar Copper', hex: '#B87333', finish: 'Satin', family: 'Mid' },
  { id: 'mid-05-satin', name: 'Rocket Red', hex: '#DC143C', finish: 'Satin', family: 'Mid' },
  { id: 'mid-06-satin', name: 'Plasma Orange', hex: '#FF8C00', finish: 'Satin', family: 'Mid' },
  { id: 'mid-07-satin', name: 'Cosmic Taupe', hex: '#967969', finish: 'Satin', family: 'Mid' },
  { id: 'mid-08-satin', name: 'Satellite Silver', hex: '#C0C0C0', finish: 'Satin', family: 'Mid' },
  { id: 'mid-09-satin', name: 'Crimson Burst', hex: '#9B1B30', finish: 'Satin', family: 'Mid' },
  { id: 'mid-10-satin', name: 'Burnt Orange', hex: '#CC5500', finish: 'Satin', family: 'Mid' },
  { id: 'mid-11-satin', name: 'Sunset Red', hex: '#FA5F55', finish: 'Satin', family: 'Mid' },
  { id: 'mid-12-satin', name: 'Champagne Gold', hex: '#F7E7CE', finish: 'Satin', family: 'Mid' },
  { id: 'mid-13-satin', name: 'Tangerine', hex: '#F28500', finish: 'Satin', family: 'Mid' },
  { id: 'mid-14-satin', name: 'Storm Blue', hex: '#4F666A', finish: 'Satin', family: 'Mid' },
  
  // Matte Finish Options (14 colors from Dark family)
  { id: 'dark-01-matte', name: 'Void Black', hex: '#0A0A0A', finish: 'Matte', family: 'Dark' },
  { id: 'dark-02-matte', name: 'Eclipse Navy', hex: '#000080', finish: 'Matte', family: 'Dark' },
  { id: 'dark-03-matte', name: 'Shadow Graphite', hex: '#36454F', finish: 'Matte', family: 'Dark' },
  { id: 'dark-04-matte', name: 'Meteorite Charcoal', hex: '#2F4F4F', finish: 'Matte', family: 'Dark' },
  { id: 'dark-05-matte', name: 'Earth Moss', hex: '#4A5D23', finish: 'Matte', family: 'Dark' },
  { id: 'dark-06-matte', name: 'Midnight Teal', hex: '#014F4B', finish: 'Matte', family: 'Dark' },
  { id: 'dark-07-matte', name: 'Deep Ocean Blue', hex: '#003D5C', finish: 'Matte', family: 'Dark' },
  { id: 'dark-08-matte', name: 'Forest Hunter Green', hex: '#355E3B', finish: 'Matte', family: 'Dark' },
  { id: 'dark-09-matte', name: 'Royal Purple', hex: '#4B0082', finish: 'Matte', family: 'Dark' },
  { id: 'dark-10-matte', name: 'Wine Burgundy', hex: '#800020', finish: 'Matte', family: 'Dark' },
  { id: 'dark-11-matte', name: 'Deep Plum', hex: '#4A0E4E', finish: 'Matte', family: 'Dark' },
  { id: 'dark-12-matte', name: 'Olive Drab', hex: '#6B8E23', finish: 'Matte', family: 'Dark' },
  { id: 'dark-13-matte', name: 'Gunmetal', hex: '#2A3439', finish: 'Matte', family: 'Dark' },
  { id: 'dark-14-matte', name: 'Midnight Blue', hex: '#191970', finish: 'Matte', family: 'Dark' },
];

export const getColorsByFamily = (family: InkFusionColor['family']) => {
  return inkFusionColors.filter(color => color.family === family);
};

export const getColorById = (id: string) => {
  return inkFusionColors.find(color => color.id === id);
};
