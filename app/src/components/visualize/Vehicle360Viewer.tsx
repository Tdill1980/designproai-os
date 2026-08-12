import { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, RotateCw, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Vehicle360ExportModal } from './Vehicle360ExportModal';
import { SocialShareButtons } from './SocialShareButtons';

interface Vehicle360ViewerProps {
  images: string[]; // 12 image URLs in angle order (0°, 30°, 60°, ..., 330°)
  autoRotate?: boolean;
  dragSensitivity?: number;
  showAngleIndicator?: boolean;
  className?: string;
  vehicleName?: string;
  designName?: string;
}

export function Vehicle360Viewer({
  images,
  autoRotate = false,
  dragSensitivity = 3, // Pixels per degree of rotation (lower = more sensitive)
  showAngleIndicator = true,
  className,
  vehicleName = 'Vehicle',
  designName = 'Design'
}: Vehicle360ViewerProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(autoRotate);
  const [isDragging, setIsDragging] = useState(false);
  const [imagesLoaded, setImagesLoaded] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showDragHint, setShowDragHint] = useState(true);
  const [hasInteracted, setHasInteracted] = useState(false);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const lastIndexRef = useRef(0);
  const autoRotateIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Momentum physics refs
  const velocityRef = useRef(0);
  const lastXRef = useRef(0);
  const lastTimeRef = useRef(0);
  const momentumRafRef = useRef<number | null>(null);
  const fractionalIndexRef = useRef(0);

  const totalImages = images.length;
  const currentAngle = totalImages > 0 ? Math.round((currentIndex * 360) / totalImages) : 0;

  // Preload all images for instant switching
  useEffect(() => {
    if (images.length === 0) return;

    let loadedCount = 0;
    const preloadedImages: HTMLImageElement[] = [];

    images.forEach((src) => {
      const img = new Image();
      img.src = src;
      img.onload = () => {
        loadedCount++;
        if (loadedCount === images.length) {
          console.log('✅ All 360° images preloaded');
          setImagesLoaded(true);
        }
      };
      img.onerror = () => {
        loadedCount++;
        if (loadedCount === images.length) {
          setImagesLoaded(true);
        }
      };
      preloadedImages.push(img);
    });

    return () => {
      preloadedImages.forEach(img => {
        img.onload = null;
        img.onerror = null;
      });
    };
  }, [images]);

  // Auto-hide drag hint after 3 seconds or on first interaction
  useEffect(() => {
    if (hasInteracted) {
      setShowDragHint(false);
      return;
    }
    
    const timer = setTimeout(() => {
      setShowDragHint(false);
    }, 3000);
    
    return () => clearTimeout(timer);
  }, [hasInteracted]);

  // Auto-rotate functionality
  useEffect(() => {
    if (isPlaying && imagesLoaded && totalImages > 0) {
      autoRotateIntervalRef.current = setInterval(() => {
        setCurrentIndex((prev) => (prev + 1) % totalImages);
      }, 100); // Smooth rotation
    } else {
      if (autoRotateIntervalRef.current) {
        clearInterval(autoRotateIntervalRef.current);
        autoRotateIntervalRef.current = null;
      }
    }

    return () => {
      if (autoRotateIntervalRef.current) {
        clearInterval(autoRotateIntervalRef.current);
      }
    };
  }, [isPlaying, imagesLoaded, totalImages]);

  // Momentum animation loop
  const startMomentum = useCallback(() => {
    if (totalImages === 0) return;
    
    const friction = 0.92; // Deceleration factor
    const minVelocity = 0.0005;
    
    const animate = () => {
      if (Math.abs(velocityRef.current) < minVelocity) {
        velocityRef.current = 0;
        return;
      }
      
      // Apply velocity to fractional index (negative because drag right = spin left)
      fractionalIndexRef.current -= velocityRef.current * 20;
      
      // Wrap around
      while (fractionalIndexRef.current < 0) fractionalIndexRef.current += totalImages;
      while (fractionalIndexRef.current >= totalImages) fractionalIndexRef.current -= totalImages;
      
      // Update display index
      setCurrentIndex(Math.floor(fractionalIndexRef.current));
      
      // Apply friction
      velocityRef.current *= friction;
      
      // Continue animation
      momentumRafRef.current = requestAnimationFrame(animate);
    };
    
    momentumRafRef.current = requestAnimationFrame(animate);
  }, [totalImages]);

  const stopMomentum = useCallback(() => {
    if (momentumRafRef.current) {
      cancelAnimationFrame(momentumRafRef.current);
      momentumRafRef.current = null;
    }
    velocityRef.current = 0;
  }, []);

  const handleDragStart = useCallback((clientX: number) => {
    stopMomentum();
    setIsDragging(true);
    setIsPlaying(false);
    setHasInteracted(true);
    
    startXRef.current = clientX;
    lastXRef.current = clientX;
    lastTimeRef.current = performance.now();
    lastIndexRef.current = currentIndex;
    fractionalIndexRef.current = currentIndex;
    velocityRef.current = 0;
  }, [currentIndex, stopMomentum]);

  const handleDragMove = useCallback((clientX: number) => {
    if (!isDragging || totalImages === 0) return;

    const now = performance.now();
    const dt = now - lastTimeRef.current;
    
    // Calculate velocity (pixels per millisecond)
    if (dt > 0) {
      const dx = clientX - lastXRef.current;
      velocityRef.current = dx / dt;
    }
    
    lastXRef.current = clientX;
    lastTimeRef.current = now;

    // Calculate new index based on total drag distance
    const totalDeltaX = clientX - startXRef.current;
    const indexChange = -totalDeltaX / dragSensitivity;
    
    fractionalIndexRef.current = lastIndexRef.current + indexChange;
    
    // Wrap around
    let newIndex = Math.floor(fractionalIndexRef.current) % totalImages;
    if (newIndex < 0) newIndex += totalImages;
    
    setCurrentIndex(newIndex);
  }, [isDragging, dragSensitivity, totalImages]);

  const handleDragEnd = useCallback(() => {
    if (!isDragging) return;
    
    setIsDragging(false);
    
    // Start momentum if velocity is significant
    if (Math.abs(velocityRef.current) > 0.05) {
      startMomentum();
    }
  }, [isDragging, startMomentum]);

  // Mouse events
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    handleDragStart(e.clientX);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
      handleDragMove(e.clientX);
    };

    const handleGlobalMouseUp = () => {
      handleDragEnd();
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging, handleDragMove, handleDragEnd]);

  // Touch events with proper handling
  const handleTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    handleDragStart(e.touches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isDragging) {
      e.preventDefault(); // Only prevent scroll when actively dragging
      e.stopPropagation();
    }
    handleDragMove(e.touches[0].clientX);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    e.stopPropagation();
    handleDragEnd();
  };

  const togglePlayPause = () => {
    stopMomentum();
    setIsPlaying(prev => !prev);
    setHasInteracted(true);
  };

  const resetToFront = () => {
    stopMomentum();
    setCurrentIndex(0);
    fractionalIndexRef.current = 0;
    setIsPlaying(false);
    setHasInteracted(true);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopMomentum();
    };
  }, [stopMomentum]);

  if (!imagesLoaded || images.length === 0) {
    return (
      <div className={cn("flex items-center justify-center bg-card rounded-lg min-h-[300px]", className)}>
        <div className="text-center space-y-4 p-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Loading 360° view...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* 360° Viewer Container */}
      <div className="relative bg-card rounded-lg overflow-hidden">
        <div
          ref={containerRef}
          className={cn(
            "relative select-none",
            isDragging ? "cursor-grabbing" : "cursor-grab"
          )}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{ touchAction: 'none' }}
        >
          {/* Image display with subtle transition */}
          <div className="relative w-full" style={{ aspectRatio: '16/9' }}>
            <img
              src={images[currentIndex]}
              alt={`${vehicleName} - ${currentAngle}° view`}
              className="w-full h-full object-cover pointer-events-none"
              draggable={false}
            />
          </div>

          {/* Angle Indicator Overlay */}
          {showAngleIndicator && (
            <div className="absolute top-4 left-4 bg-background/80 backdrop-blur-sm px-3 py-1.5 rounded-md">
              <p className="text-xs font-medium text-foreground">
                {currentAngle}° <span className="text-muted-foreground">({currentIndex + 1}/{totalImages})</span>
              </p>
            </div>
          )}

          {/* Smart Drag Hint - fades out after interaction or timeout */}
          <div 
            className={cn(
              "absolute inset-0 flex items-center justify-center pointer-events-none transition-opacity duration-500",
              showDragHint && !isDragging && !isPlaying ? "opacity-70" : "opacity-0"
            )}
          >
            <div className="bg-background/80 backdrop-blur-sm px-5 py-2.5 rounded-full shadow-lg">
              <p className="text-sm text-foreground font-medium">← Drag to spin →</p>
            </div>
          </div>
        </div>

        {/* Playback Controls */}
        <div className="absolute bottom-4 right-4 flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={togglePlayPause}
            className="bg-background/80 backdrop-blur-sm hover:bg-background"
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={resetToFront}
            className="bg-background/80 backdrop-blur-sm hover:bg-background"
          >
            <RotateCw className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="default"
            onClick={() => setShowExportModal(true)}
            className="bg-primary/80 backdrop-blur-sm hover:bg-primary"
          >
            <Download className="h-4 w-4 mr-1" />
            Export
          </Button>
        </div>
      </div>

      {/* Social Share Buttons */}
      <div className="bg-card border border-border rounded-lg p-3">
        <SocialShareButtons
          images={images}
          vehicleName={vehicleName}
          designName={designName}
        />
      </div>

      {/* Export Modal */}
      <Vehicle360ExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        images={images}
        vehicleName={vehicleName}
        designName={designName}
      />
    </div>
  );
}
