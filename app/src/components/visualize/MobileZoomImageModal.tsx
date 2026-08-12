import { useState, useRef, useEffect, useCallback } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X, ZoomIn, ZoomOut, Download, ChevronLeft, ChevronRight } from "lucide-react";
import { fetchAsPngBlob } from "@/lib/reencode-png";

interface MobileZoomImageModalProps {
  imageUrl: string;
  title?: string;
  isOpen: boolean;
  onClose: () => void;
  showNavigation?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  currentIndex?: number;
  totalCount?: number;
}

export function MobileZoomImageModal({
  imageUrl,
  title,
  isOpen,
  onClose,
  showNavigation = false,
  onPrev,
  onNext,
  currentIndex = 0,
  totalCount = 1
}: MobileZoomImageModalProps) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Refs for gesture state (avoid stale closures in native event listeners)
  const scaleRef = useRef(1);
  const positionRef = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const lastTapRef = useRef(0);
  const pinchStartScaleRef = useRef(1);
  const initialTouchDistRef = useRef(0);
  const didMoveRef = useRef(false);
  const touchStartPosRef = useRef({ x: 0, y: 0 });
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const isPinchingRef = useRef(false);

  // Mouse drag refs
  const isMouseDraggingRef = useRef(false);
  const mouseStartRef = useRef({ x: 0, y: 0 });
  const lastClickRef = useRef(0);

  const MIN_SCALE = 1;
  const MAX_SCALE = 5;
  const SWIPE_THRESHOLD = 50;
  const DRAG_THRESHOLD = 10;

  // Keep refs in sync with state
  const updateScale = useCallback((newScale: number) => {
    scaleRef.current = newScale;
    setScale(newScale);
  }, []);

  const updatePosition = useCallback((newPos: { x: number; y: number }) => {
    positionRef.current = newPos;
    setPosition(newPos);
  }, []);

  // Reset on open/close or image change
  useEffect(() => {
    if (isOpen) {
      updateScale(1);
      updatePosition({ x: 0, y: 0 });
    }
  }, [isOpen, imageUrl, updateScale, updatePosition]);

  // Keyboard navigation support
  useEffect(() => {
    if (!isOpen || !showNavigation) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && onPrev) {
        e.preventDefault();
        onPrev();
      } else if (e.key === 'ArrowRight' && onNext) {
        e.preventDefault();
        onNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, showNavigation, onPrev, onNext]);

  // Calculate distance between two touch points
  const getTouchDistance = (touches: TouchList) => {
    if (touches.length < 2) return 0;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Native touch event listeners with { passive: false } so preventDefault works
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !isOpen) return;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dist = getTouchDistance(e.touches);
        initialTouchDistRef.current = dist;
        pinchStartScaleRef.current = scaleRef.current;
        isPinchingRef.current = true;
        isDraggingRef.current = false;
        swipeStartRef.current = null;
        didMoveRef.current = true; // Pinch suppresses double-tap
      } else if (e.touches.length === 1) {
        didMoveRef.current = false;
        touchStartPosRef.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY
        };
        if (scaleRef.current > 1) {
          e.preventDefault();
          isDraggingRef.current = true;
          dragStartRef.current = {
            x: e.touches[0].clientX - positionRef.current.x,
            y: e.touches[0].clientY - positionRef.current.y
          };
        } else if (showNavigation && totalCount > 1) {
          swipeStartRef.current = {
            x: e.touches[0].clientX,
            y: e.touches[0].clientY
          };
        }
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && initialTouchDistRef.current > 0) {
        e.preventDefault();
        const newDistance = getTouchDistance(e.touches);
        const ratio = newDistance / initialTouchDistRef.current;
        const newScale = Math.min(Math.max(pinchStartScaleRef.current * ratio, MIN_SCALE), MAX_SCALE);
        updateScale(newScale);
        if (newScale <= MIN_SCALE) {
          updatePosition({ x: 0, y: 0 });
        }
      } else if (e.touches.length === 1) {
        const dx = e.touches[0].clientX - touchStartPosRef.current.x;
        const dy = e.touches[0].clientY - touchStartPosRef.current.y;
        if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
          didMoveRef.current = true;
        }
        if (isDraggingRef.current && scaleRef.current > 1) {
          e.preventDefault();
          const newX = e.touches[0].clientX - dragStartRef.current.x;
          const newY = e.touches[0].clientY - dragStartRef.current.y;
          updatePosition({ x: newX, y: newY });
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      // Swipe navigation when not zoomed
      if (swipeStartRef.current && scaleRef.current === 1 && showNavigation) {
        const touch = e.changedTouches[0];
        const deltaX = touch.clientX - swipeStartRef.current.x;
        const deltaY = touch.clientY - swipeStartRef.current.y;
        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > SWIPE_THRESHOLD) {
          if (deltaX > 0 && onPrev) onPrev();
          else if (deltaX < 0 && onNext) onNext();
        }
      }

      // Double tap to zoom - only if finger didn't move
      if (!didMoveRef.current && e.changedTouches.length === 1) {
        const now = Date.now();
        const timeSinceLastTap = now - lastTapRef.current;
        if (timeSinceLastTap < 300 && timeSinceLastTap > 0) {
          e.preventDefault();
          if (scaleRef.current === 1) {
            updateScale(2.5);
          } else {
            updateScale(1);
            updatePosition({ x: 0, y: 0 });
          }
          lastTapRef.current = 0;
        } else {
          lastTapRef.current = now;
        }
      }

      isDraggingRef.current = false;
      isPinchingRef.current = false;
      initialTouchDistRef.current = 0;
      swipeStartRef.current = null;
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: false });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [isOpen, showNavigation, totalCount, onPrev, onNext, updateScale, updatePosition]);

  // Mouse handlers for desktop double-click zoom and drag-to-pan
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Double-click to zoom
    const now = Date.now();
    if (now - lastClickRef.current < 300) {
      if (scaleRef.current === 1) {
        updateScale(2.5);
      } else {
        updateScale(1);
        updatePosition({ x: 0, y: 0 });
      }
      lastClickRef.current = 0;
      return;
    }
    lastClickRef.current = now;

    // Start drag if zoomed
    if (scaleRef.current > 1) {
      e.preventDefault();
      isMouseDraggingRef.current = true;
      mouseStartRef.current = {
        x: e.clientX - positionRef.current.x,
        y: e.clientY - positionRef.current.y
      };
    }
  }, [updateScale, updatePosition]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isMouseDraggingRef.current && scaleRef.current > 1) {
      const newX = e.clientX - mouseStartRef.current.x;
      const newY = e.clientY - mouseStartRef.current.y;
      updatePosition({ x: newX, y: newY });
    }
  }, [updatePosition]);

  const handleMouseUp = useCallback(() => {
    isMouseDraggingRef.current = false;
  }, []);

  // Zoom buttons
  const handleZoomIn = () => {
    updateScale(Math.min(scaleRef.current + 0.5, MAX_SCALE));
  };

  const handleZoomOut = () => {
    const newScale = Math.max(scaleRef.current - 0.5, MIN_SCALE);
    updateScale(newScale);
    if (newScale <= MIN_SCALE) {
      updatePosition({ x: 0, y: 0 });
    }
  };

  // Download handler
  const handleDownload = async () => {
    try {
      const blob = await fetchAsPngBlob(imageUrl);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title || 'render'}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-full w-full h-screen max-h-screen p-0 bg-black border-0 touch-none">
        {/* Header with title, image counter, and close button */}
        <div className="absolute top-0 left-0 right-0 z-20 bg-gradient-to-b from-black/80 to-transparent p-4">
          <div className="flex items-center justify-between">
            <div className="text-white text-sm font-medium truncate max-w-[60%]">{title || 'Render Preview'}</div>
            <div className="flex items-center gap-3">
              {showNavigation && totalCount > 1 && (
                <div className="text-white/70 text-sm">
                  {currentIndex + 1} / {totalCount}
                </div>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="text-white hover:bg-white/20 h-10 w-10 rounded-full bg-black/50"
              >
                <X className="w-6 h-6" />
              </Button>
            </div>
          </div>
        </div>

        {/* Zoom percentage indicator */}
        <div className="absolute top-16 left-4 z-20 bg-black/70 text-white px-3 py-1 rounded-lg text-xs font-semibold backdrop-blur-sm">
          {Math.round(scale * 100)}%
        </div>

        {/* Navigation arrows */}
        {showNavigation && (
          <>
            {onPrev && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onPrev}
                className="absolute left-2 top-1/2 -translate-y-1/2 z-20 text-white hover:bg-white/20 h-12 w-12 rounded-full bg-black/50"
              >
                <ChevronLeft className="w-8 h-8" />
              </Button>
            )}
            {onNext && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onNext}
                className="absolute right-2 top-1/2 -translate-y-1/2 z-20 text-white hover:bg-white/20 h-12 w-12 rounded-full bg-black/50"
              >
                <ChevronRight className="w-8 h-8" />
              </Button>
            )}
          </>
        )}

        {/* Image container with touch handling */}
        <div
          ref={containerRef}
          className="w-full h-full flex items-center justify-center overflow-hidden touch-none select-none"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <img
            src={imageUrl}
            alt={title || 'Render'}
            className="max-w-full max-h-full object-contain select-none pointer-events-none"
            style={{
              transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
              transition: (isDraggingRef.current || isMouseDraggingRef.current || isPinchingRef.current) ? 'none' : 'transform 0.2s ease-out'
            }}
            draggable={false}
          />
        </div>

        {/* Bottom controls */}
        <div className="absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/80 to-transparent p-4 flex items-center justify-between gap-2">
          {/* Zoom controls */}
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleZoomOut}
              disabled={scale <= MIN_SCALE}
              className="text-white hover:bg-white/20 h-11 w-11"
            >
              <ZoomOut className="w-5 h-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleZoomIn}
              disabled={scale >= MAX_SCALE}
              className="text-white hover:bg-white/20 h-11 w-11"
            >
              <ZoomIn className="w-5 h-5" />
            </Button>
          </div>

          {/* Download button */}
          <Button
            variant="default"
            onClick={handleDownload}
            className="h-11 gap-2"
          >
            <Download className="w-4 h-4" />
            Download
          </Button>
        </div>

        {/* Help text */}
        <div className="absolute bottom-20 left-4 right-4 z-20 text-center">
          <p className="text-white/60 text-xs backdrop-blur-sm bg-black/40 px-3 py-2 rounded-lg inline-block">
            {showNavigation && totalCount > 1 ? 'Swipe to navigate • ' : ''}Pinch to zoom • Double tap • Drag to pan
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
