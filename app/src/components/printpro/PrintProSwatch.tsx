import React, { useEffect, useState } from 'react';
import { getCleanColorName } from '@/lib/utils';
import { fetchRealHexCached } from '@/utils/fetchRealHex';

interface SwatchColor {
  name: string;
  hex: string;
  finish: string;
  media_url?: string;
  manufacturer?: string;
}

interface PrintProSwatchProps {
  color: SwatchColor;
  selected?: boolean;
  onClick?: () => void;
  size?: 'sm' | 'md' | 'lg';
}

export const PrintProSwatch: React.FC<PrintProSwatchProps> = ({ 
  color, 
  selected = false, 
  onClick,
  size = 'md'
}) => {
  const [imageError, setImageError] = useState(false);
  const [resolvedHex, setResolvedHex] = useState<string | null>(color.hex || null);

  // AI-resolve missing hex colors
  useEffect(() => {
    async function resolveHex() {
      if (!resolvedHex && color.manufacturer && color.name) {
        const aiHex = await fetchRealHexCached(color.manufacturer, color.name);
        if (aiHex !== "NOT_FOUND") {
          setResolvedHex(aiHex);
        }
      }
    }
    resolveHex();
  }, [color.manufacturer, color.name, resolvedHex]);
  
  const getGradientByFinish = (hex: string, finish: string) => {
    // Reduced gleam/opacity by 40% for more realistic appearance
    switch (finish) {
      case 'Gloss':
        return `
          radial-gradient(ellipse 80% 50% at 50% 40%, rgba(255,255,255,0.5) 0%, transparent 50%),
          radial-gradient(ellipse 60% 60% at 30% 30%, rgba(255,255,255,0.25) 0%, transparent 50%),
          linear-gradient(135deg, ${hex} 0%, ${hex} 100%)
        `;
      case 'Satin':
        return `
          radial-gradient(ellipse 70% 40% at 50% 35%, rgba(255,255,255,0.3) 0%, transparent 60%),
          radial-gradient(ellipse 50% 50% at 35% 35%, rgba(255,255,255,0.15) 0%, transparent 50%),
          linear-gradient(135deg, ${hex} 0%, ${hex} 100%)
        `;
      case 'Matte':
        return `
          radial-gradient(ellipse 60% 30% at 50% 30%, rgba(255,255,255,0.08) 0%, transparent 70%),
          linear-gradient(135deg, ${hex} 0%, ${hex} 100%)
        `;
      default:
        return hex;
    }
  };

  const sizeClasses = {
    sm: 'w-12 h-12',
    md: 'w-16 h-16',
    lg: 'w-24 h-24'
  };

  return (
    <button
      onClick={onClick}
      className={`
        relative overflow-hidden rounded-lg transition-all duration-200
        ${sizeClasses[size]}
        ${selected 
          ? 'ring-2 ring-primary border-2 border-primary shadow-lg scale-105' 
          : 'border-2 border-border/30 hover:border-border/60 hover:scale-105 hover:shadow-xl'
        }
      `}
      title={`${color.name} (${color.finish})`}
    >
      {/* Swatch display: image > resolved hex > fallback with text */}
      {color.media_url && !imageError ? (
        <img
          src={color.media_url}
          alt={color.name}
          className="absolute inset-0 w-full h-full object-cover"
          onError={() => setImageError(true)}
        />
      ) : resolvedHex ? (
        <div 
          className="absolute inset-0"
          style={{
            background: getGradientByFinish(resolvedHex, color.finish)
          }}
        />
      ) : (
        <div className="absolute inset-0 swatch-fallback">
          {color.name}
        </div>
      )}
      {/* Bottom shadow for depth */}
      <div 
        className="absolute inset-x-0 bottom-0 h-1/3 pointer-events-none"
        style={{
          background: 'linear-gradient(to top, rgba(0,0,0,0.3) 0%, transparent 100%)'
        }}
      />
      {/* Finish badge */}
      <div className="absolute bottom-0 inset-x-0 bg-background/95 py-0.5 px-1">
        <p className="text-[8px] font-medium text-center leading-tight">
          {getCleanColorName(color.name)}
        </p>
      </div>
    </button>
  );
};
