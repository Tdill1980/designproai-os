import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { X, ChevronLeft, ChevronRight, Download, Maximize2, ZoomIn, FileText, Pencil, Save, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { MobileZoomImageModal } from "@/components/visualize/MobileZoomImageModal";
import { useShopTerms } from "@/hooks/useShopTerms";
import { toast } from "@/hooks/use-toast";
import { findVehicle } from "@/data/vehicle-measurements";
import { sqFtToYards } from "@/lib/quick-quote";

interface StudioProofLayoutProps {
  designProofUrl?: string;
  designName: string;
  vehicleInfo: { year: string; make: string; model: string };
  views: Array<{ type: string; url: string; label: string }>;
  isOpen: boolean;
  onClose: () => void;
  onDownloadPDF?: () => void;
  toolName?: string;
  proofSectionLabel?: string;
  /** Pre-filled quote number for sync with proof sheet */
  initialQuoteNumber?: string;
  /** Film info for display on proof */
  manufacturer?: string;
  colorName?: string;
  finish?: string;
  productCode?: string;
  hex?: string;
  /** Which coverage unit to show: 'sqft' or 'yards'. Default: 'sqft' */
  coverageUnit?: 'sqft' | 'yards';
}

export const StudioProofLayout = ({
  designProofUrl,
  designName,
  vehicleInfo,
  views,
  isOpen,
  onClose,
  onDownloadPDF,
  toolName = "ApprovePro™",
  proofSectionLabel = "Original 2D Design Proof",
  initialQuoteNumber,
  manufacturer,
  colorName,
  finish,
  productCode,
  hex,
  coverageUnit = 'sqft',
}: StudioProofLayoutProps) => {
  const [selectedViewIndex, setSelectedViewIndex] = useState(0);
  const [fullscreenView, setFullscreenView] = useState<string | null>(null);
  const [showTerms, setShowTerms] = useState(false);
  const [isEditingTerms, setIsEditingTerms] = useState(false);
  const [quoteNumber, setQuoteNumber] = useState(initialQuoteNumber || '');
  const [orderNumber, setOrderNumber] = useState('');
  const heroRef = useRef<HTMLDivElement>(null);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const isStudioMode = !designProofUrl;

  // Shop terms
  const { termsText, setTermsText, saveTerms, isSaving: isSavingTerms } = useShopTerms();

  // Reset selection when opened
  useEffect(() => {
    if (isOpen) {
      setSelectedViewIndex(0);
      setShowTerms(false);
      setIsEditingTerms(false);
    }
  }, [isOpen]);

  // Vehicle sq ft and yards lookup
  const vehicleMeasurement = vehicleInfo.make && vehicleInfo.model
    ? findVehicle(vehicleInfo.make, vehicleInfo.model, vehicleInfo.year)
    : null;
  const estimatedSqFt = vehicleMeasurement?.corrSqFt || vehicleMeasurement?.totalSqFt || null;
  const estimatedYards = estimatedSqFt ? sqFtToYards(estimatedSqFt) : null;

  if (!isOpen) return null;

  const vehicleName = `${vehicleInfo.year} ${vehicleInfo.make} ${vehicleInfo.model}`;
  const selectedView = views[selectedViewIndex];

  const handlePrevView = () => {
    setSelectedViewIndex((prev) => (prev === 0 ? views.length - 1 : prev - 1));
  };

  const handleNextView = () => {
    setSelectedViewIndex((prev) => (prev === views.length - 1 ? 0 : prev + 1));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    if (e.key === "ArrowLeft") handlePrevView();
    if (e.key === "ArrowRight") handleNextView();
  };

  // Touch swipe on hero image for mobile navigation
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      swipeStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!swipeStartRef.current) return;
    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - swipeStartRef.current.x;
    const deltaY = touch.clientY - swipeStartRef.current.y;
    // Only swipe if horizontal movement > vertical and > threshold
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
      if (deltaX > 0) handlePrevView();
      else handleNextView();
    }
    swipeStartRef.current = null;
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-auto"
      style={{
        background: isStudioMode
          ? 'linear-gradient(to bottom, #f0f0f0 0%, #e0e0e0 40%, #1a1a1a 100%)'
          : 'linear-gradient(to bottom, #f5f5f5 0%, #e8e8e8 60%, #3d3d3d 60%, #2a2a2a 100%)',
      }}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 bg-white/95 backdrop-blur border-b border-neutral-200 shadow-sm">
        <div className="min-w-0 flex-1 mr-3">
          <h2 className="text-lg font-bold text-neutral-900 truncate">
            {toolName} {designProofUrl ? "Studio Proof" : "Studio"}
          </h2>
          <p className="text-xs text-neutral-500 truncate">
            {vehicleName} | {designName}
            {quoteNumber && <span className="ml-2 font-mono">Quote: {quoteNumber}</span>}
            {orderNumber && <span className="ml-2 font-mono">Order: {orderNumber}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {onDownloadPDF && (
            <Button
              variant="outline"
              size="sm"
              onClick={onDownloadPDF}
              className="border-neutral-300 text-neutral-700 hover:bg-neutral-100"
            >
              <Download className="w-4 h-4 mr-2" />
              Download PDF
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="text-neutral-700 hover:bg-neutral-200"
          >
            <X className="w-6 h-6" />
          </Button>
        </div>
      </div>

      {/* Main Content - Studio Layout */}
      <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-8">

        {/* Original 2D Proof Section — only for ApprovePro (2D→3D comparison) */}
        {toolName === "ApprovePro™" && (
          <>
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-blue-500 rounded-full" />
                <h3 className="text-sm font-semibold text-neutral-700 uppercase tracking-wider">
                  {proofSectionLabel}
                </h3>
              </div>
              <div
                className="relative bg-white rounded-xl overflow-hidden border border-neutral-200 shadow-lg cursor-pointer group"
                onClick={() => setFullscreenView(designProofUrl)}
              >
                <img
                  src={designProofUrl}
                  alt="Original 2D Design Proof"
                  className="w-full h-auto max-h-[400px] object-contain mx-auto"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                  <Maximize2 className="w-8 h-8 text-white" />
                </div>
                <div className="absolute bottom-3 left-3 bg-blue-500 px-3 py-1.5 rounded-lg">
                  <span className="text-xs font-bold text-white">2D PROOF</span>
                </div>
              </div>
            </section>

            {/* Divider with Arrow */}
            <div className="flex items-center justify-center gap-4">
              <div className="flex-1 h-px bg-gradient-to-r from-transparent via-neutral-400 to-transparent" />
              <div className="flex items-center gap-2 px-4 py-2 bg-white/80 rounded-full border border-neutral-300 shadow-sm">
                <span className="text-sm text-neutral-600">transforms to</span>
                <span className="text-lg">↓</span>
              </div>
              <div className="flex-1 h-px bg-gradient-to-r from-transparent via-neutral-400 to-transparent" />
            </div>
          </>
        )}

        {/* 3D Renders Section */}
        <section className="space-y-3">
          {!isStudioMode && (
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-primary rounded-full" />
              <h3 className="text-sm font-semibold text-neutral-700 uppercase tracking-wider">
                Photorealistic 3D Renders
              </h3>
            </div>
          )}

          {/* Featured Render with Navigation + Swipe */}
          <div
            ref={heroRef}
            className="relative bg-neutral-800 rounded-xl overflow-hidden border border-neutral-600 shadow-2xl"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            {/* Main Image */}
            <div
              className="relative aspect-video cursor-pointer group"
              onClick={() => setFullscreenView(selectedView?.url)}
            >
              <img
                src={selectedView?.url}
                alt={selectedView?.label}
                className="w-full h-full object-contain transition-opacity duration-200"
              />
              {/* Zoom hint overlay */}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                <div className="bg-white/90 rounded-full p-3 shadow-lg">
                  <ZoomIn className="w-6 h-6 text-neutral-800" />
                </div>
              </div>

              {/* View Label */}
              <div className="absolute bottom-3 left-3 bg-primary px-3 py-1.5 rounded-lg shadow-md">
                <span className="text-sm font-bold text-white">{selectedView?.label}</span>
              </div>

              {/* View Counter */}
              <div className="absolute bottom-3 right-3 bg-black/70 px-3 py-1.5 rounded-lg backdrop-blur-sm">
                <span className="text-sm text-white/80 font-medium">
                  {selectedViewIndex + 1} / {views.length}
                </span>
              </div>

              {/* Mobile swipe hint — only in studio mode, fades after interaction */}
              {isStudioMode && (
                <div className="absolute top-3 right-3 bg-black/50 backdrop-blur-sm px-2 py-1 rounded-md md:hidden">
                  <span className="text-[10px] text-white/60">Swipe &larr; &rarr; or tap to zoom</span>
                </div>
              )}
            </div>

            {/* Navigation Arrows */}
            {views.length > 1 && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute left-2 top-1/2 -translate-y-1/2 bg-white/90 hover:bg-white text-neutral-800 rounded-full w-10 h-10 shadow-lg active:scale-90 transition-transform"
                  onClick={(e) => { e.stopPropagation(); handlePrevView(); }}
                >
                  <ChevronLeft className="w-6 h-6" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-1/2 -translate-y-1/2 bg-white/90 hover:bg-white text-neutral-800 rounded-full w-10 h-10 shadow-lg active:scale-90 transition-transform"
                  onClick={(e) => { e.stopPropagation(); handleNextView(); }}
                >
                  <ChevronRight className="w-6 h-6" />
                </Button>
              </>
            )}
          </div>

          {/* Thumbnail Grid — scrollable on mobile */}
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            {views.map((view, idx) => (
              <button
                key={view.type}
                onClick={() => setSelectedViewIndex(idx)}
                className={cn(
                  "relative aspect-video rounded-lg overflow-hidden border-2 transition-all shadow-md active:scale-95",
                  selectedViewIndex === idx
                    ? "border-primary ring-2 ring-primary/30 scale-105"
                    : "border-neutral-400 hover:border-neutral-300 opacity-80 hover:opacity-100"
                )}
              >
                <img
                  src={view.url}
                  alt={view.label}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-1">
                  <span className="text-[10px] font-medium text-white truncate block">
                    {view.label}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Film Info & Coverage Bar */}
        {(manufacturer || colorName || estimatedSqFt) && (
          <div className="bg-neutral-800 rounded-lg border border-neutral-600 px-4 py-3 flex flex-wrap items-center gap-4 text-sm">
            {manufacturer && manufacturer !== 'Custom' && (
              <>
                <div>
                  <span className="text-neutral-500 text-[10px] uppercase tracking-wide">Manufacturer</span>
                  <p className="font-semibold text-neutral-200">{manufacturer}</p>
                </div>
                <div className="h-6 w-px bg-neutral-600" />
              </>
            )}
            {colorName && colorName !== 'Custom Color' && (
              <>
                <div>
                  <span className="text-neutral-500 text-[10px] uppercase tracking-wide">Color</span>
                  <p className="font-semibold text-neutral-200">{colorName}</p>
                </div>
                <div className="h-6 w-px bg-neutral-600" />
              </>
            )}
            {productCode && (
              <>
                <div>
                  <span className="text-neutral-500 text-[10px] uppercase tracking-wide">Code</span>
                  <p className="font-semibold text-neutral-200 font-mono">{productCode}</p>
                </div>
                <div className="h-6 w-px bg-neutral-600" />
              </>
            )}
            {finish && (
              <>
                <div>
                  <span className="text-neutral-500 text-[10px] uppercase tracking-wide">Finish</span>
                  <p className="font-semibold text-neutral-200">{finish}</p>
                </div>
                <div className="h-6 w-px bg-neutral-600" />
              </>
            )}
            {coverageUnit === 'sqft' && estimatedSqFt && (
              <div>
                <span className="text-neutral-500 text-[10px] uppercase tracking-wide">Coverage</span>
                <p className="font-semibold text-neutral-200">{estimatedSqFt} sq ft</p>
              </div>
            )}
            {coverageUnit === 'yards' && estimatedYards && (
              <div>
                <span className="text-neutral-500 text-[10px] uppercase tracking-wide">Film Needed</span>
                <p className="font-semibold text-neutral-200">{estimatedYards} yards</p>
              </div>
            )}
            {hex && (
              <div className="flex items-center gap-2 ml-auto">
                <div className="w-8 h-8 rounded-md border border-neutral-500" style={{ backgroundColor: hex }} />
                <span className="text-xs font-mono text-neutral-300 uppercase">{hex}</span>
              </div>
            )}
          </div>
        )}

        {/* All Views Grid */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-green-500 rounded-full" />
            <h3 className="text-sm font-semibold text-neutral-200 uppercase tracking-wider">
              All Angles Overview
            </h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {views.map((view, idx) => (
              <div
                key={`grid-${view.type}`}
                className="relative bg-neutral-700 rounded-lg overflow-hidden border border-neutral-500 cursor-pointer group shadow-lg active:scale-[0.98] transition-transform"
                onClick={() => {
                  setSelectedViewIndex(idx);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              >
                <div className="aspect-video">
                  <img
                    src={view.url}
                    alt={view.label}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors" />
                <div className="absolute bottom-2 left-2 bg-black/70 px-2 py-1 rounded">
                  <span className="text-xs font-medium text-white">{view.label}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Quote / Order Number */}
        <section className="space-y-2">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex items-center gap-2 flex-1">
              <label className="text-xs font-semibold text-neutral-400 shrink-0 uppercase tracking-wider">Quote #</label>
              <input
                type="text"
                value={quoteNumber}
                onChange={(e) => setQuoteNumber(e.target.value)}
                placeholder="e.g. QT-2026-042"
                className="flex-1 bg-neutral-800 border border-neutral-600 rounded-md px-3 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="flex items-center gap-2 flex-1">
              <label className="text-xs font-semibold text-neutral-400 shrink-0 uppercase tracking-wider">Order #</label>
              <input
                type="text"
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                placeholder="e.g. ORD-2026-042"
                className="flex-1 bg-neutral-800 border border-neutral-600 rounded-md px-3 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
          <p className="text-[10px] text-neutral-500">
            Enter your quote or order number to sync across proofs. You can quote first and enter the order number later.
          </p>
        </section>

        {/* Terms & Conditions Section */}
        <section className="space-y-3">
          <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <Checkbox
              id="termsCheckbox"
              checked={showTerms}
              onCheckedChange={(checked) => setShowTerms(checked === true)}
              className="border-amber-500 data-[state=checked]:bg-amber-500 mt-0.5"
            />
            <div className="flex-1 min-w-0">
              <Label htmlFor="termsCheckbox" className="text-sm cursor-pointer font-semibold text-neutral-200 flex items-center gap-2">
                <FileText className="w-4 h-4 text-amber-500" />
                Include Terms & Conditions
              </Label>
              <p className="text-xs text-neutral-400 mt-0.5">
                Check to display your shop's T&C on this proof
              </p>
            </div>
          </div>

          {showTerms && (
            <div className="bg-neutral-800 rounded-lg border border-neutral-600 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Terms & Conditions
                </h4>
                <div className="flex items-center gap-2">
                  {isEditingTerms ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        const ok = await saveTerms(termsText);
                        if (ok) {
                          setIsEditingTerms(false);
                          toast({ title: 'Terms Saved', description: 'Your terms have been updated.' });
                        } else {
                          toast({ title: 'Error', description: 'Failed to save terms.', variant: 'destructive' });
                        }
                      }}
                      disabled={isSavingTerms}
                      className="text-green-400 hover:text-green-300 hover:bg-green-500/10 gap-1.5 h-8"
                    >
                      {isSavingTerms ? (
                        <div className="h-3 w-3 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                      Save
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsEditingTerms(true)}
                      className="text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700 gap-1.5 h-8"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Quick Edit
                    </Button>
                  )}
                </div>
              </div>

              {isEditingTerms ? (
                <Textarea
                  value={termsText}
                  onChange={(e) => setTermsText(e.target.value)}
                  className="min-h-[200px] text-xs font-mono leading-relaxed bg-neutral-900 border-neutral-600 text-neutral-200"
                />
              ) : (
                <div className="text-xs text-neutral-300 whitespace-pre-wrap leading-relaxed max-h-[300px] overflow-y-auto pr-2">
                  {termsText}
                </div>
              )}

              {isEditingTerms && (
                <p className="text-[10px] text-neutral-500">
                  Changes are saved to your shop profile and will apply to all future proofs. Edit anytime in Admin &rarr; Shop Settings.
                </p>
              )}
            </div>
          )}
        </section>

        {/* Footer Info */}
        <div className="text-center py-6 border-t border-neutral-500">
          <p className="text-xs text-neutral-300">
            Generated with {toolName} by DesignProAI™ Vehicle Wrap Visualizer Suite
          </p>
        </div>
      </div>

      {/* Fullscreen Image with Zoom */}
      <MobileZoomImageModal
        imageUrl={fullscreenView || ''}
        title={selectedView?.label || 'Studio View'}
        isOpen={!!fullscreenView}
        onClose={() => setFullscreenView(null)}
        showNavigation={true}
        currentIndex={selectedViewIndex}
        totalCount={views.length}
        onPrev={() => {
          const prevIdx = selectedViewIndex === 0 ? views.length - 1 : selectedViewIndex - 1;
          setSelectedViewIndex(prevIdx);
          setFullscreenView(views[prevIdx]?.url || null);
        }}
        onNext={() => {
          const nextIdx = selectedViewIndex === views.length - 1 ? 0 : selectedViewIndex + 1;
          setSelectedViewIndex(nextIdx);
          setFullscreenView(views[nextIdx]?.url || null);
        }}
      />
    </div>
  );
};
