import { useState, useRef, useEffect, useCallback } from "react";

interface BeforeAfterSliderProps {
  beforeUrl: string;
  afterUrl: string;
  altText: string;
}

export const BeforeAfterSlider = ({ beforeUrl, afterUrl, altText }: BeforeAfterSliderProps) => {
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMove = useCallback((clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    // Calculate position relative to container, allow full 0-100 range
    const x = clientX - rect.left;
    // Clamp to 0-100% with no dead zones at edges
    const percent = Math.max(0, Math.min((x / rect.width) * 100, 100));
    setSliderPosition(percent);
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    setIsDragging(true);
  };

  // Global event listeners for continuous dragging - attached immediately
  useEffect(() => {
    const handleGlobalTouchMove = (e: TouchEvent) => {
      if (!isDragging) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.touches[0]) {
        handleMove(e.touches[0].clientX);
      }
    };

    const handleGlobalTouchEnd = () => {
      setIsDragging(false);
    };

    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      e.preventDefault();
      handleMove(e.clientX);
    };

    const handleGlobalMouseUp = () => {
      setIsDragging(false);
    };

    // Always attach listeners to ensure we catch all movements
    document.addEventListener('touchmove', handleGlobalTouchMove, { passive: false });
    document.addEventListener('touchend', handleGlobalTouchEnd);
    document.addEventListener('touchcancel', handleGlobalTouchEnd);
    document.addEventListener('mousemove', handleGlobalMouseMove);
    document.addEventListener('mouseup', handleGlobalMouseUp);

    return () => {
      document.removeEventListener('touchmove', handleGlobalTouchMove);
      document.removeEventListener('touchend', handleGlobalTouchEnd);
      document.removeEventListener('touchcancel', handleGlobalTouchEnd);
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging, handleMove]);

  // Tap-to-position handlers (only when not dragging)
  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isDragging) return;
    handleMove(e.clientX);
  };

  // Start dragging from anywhere on the container (mobile-friendly)
  const handleContainerTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    setIsDragging(true);
    const touch = e.touches[0];
    handleMove(touch.clientX);
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full aspect-video overflow-hidden cursor-ew-resize select-none"
      style={{ touchAction: 'none' }}
      onClick={handleContainerClick}
      onTouchStart={handleContainerTouchStart}
    >
      {/* After Image (3D Render) */}
      <img
        src={afterUrl}
        alt={`${altText} - After`}
        className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        draggable={false}
      />

      {/* Before Image (Original Design) with Clip */}
      <div
        className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none"
        style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}
      >
        <img
          src={beforeUrl}
          alt={`${altText} - Before`}
          className="absolute inset-0 w-full h-full object-cover"
          draggable={false}
        />
      </div>

      {/* Slider Handle - Large touch target for mobile */}
      <div
        className="absolute top-0 bottom-0 w-1 bg-white shadow-lg cursor-ew-resize z-10"
        style={{ left: `${sliderPosition}%`, transform: 'translateX(-50%)', touchAction: 'none' }}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        {/* Invisible expanded touch area for mobile (44px minimum) */}
        <div 
          className="absolute top-0 bottom-0 -left-6 w-12 cursor-ew-resize"
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
        />
        
        {/* Visible handle */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 md:w-8 md:h-8 bg-white rounded-full shadow-lg flex items-center justify-center border-2 border-primary/30">
          <svg className="w-5 h-5 md:w-4 md:h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
          </svg>
        </div>
      </div>

      {/* Labels */}
      <div className="absolute bottom-2 left-2 bg-background/80 backdrop-blur-sm px-2 py-1 rounded text-xs font-semibold pointer-events-none">
        Before
      </div>
      <div className="absolute bottom-2 right-2 bg-primary/80 backdrop-blur-sm px-2 py-1 rounded text-xs font-semibold text-primary-foreground pointer-events-none">
        After
      </div>
    </div>
  );
};
