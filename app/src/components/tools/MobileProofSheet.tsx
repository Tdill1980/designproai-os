import React, { useRef, useState, useEffect } from 'react';
import { Download, Share2, Loader2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { loadShopProfile } from '@/lib/proof-service';
import { getToolLabel, type ToolKey } from '@/lib/tool-registry';
import { findVehicle } from '@/data/vehicle-measurements';
import { sqFtToYards } from '@/lib/quick-quote';
import html2canvas from 'html2canvas';

interface RenderView {
  type: string;
  url: string;
  label?: string;
}

interface MobileProofSheetProps {
  views: RenderView[];
  vehicleYear?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  toolKey?: ToolKey;
  designName?: string;
  manufacturer?: string;
  colorName?: string;
  productCode?: string;
  finish?: string;
  hex?: string;
  initialQuoteNumber?: string;
  /** Which coverage unit to show: 'sqft' or 'yards'. Default: 'sqft' */
  coverageUnit?: 'sqft' | 'yards';
}

/**
 * Mobile-optimized 2D proof sheet rendered as PNG for easy sharing via text/iMessage.
 * Shows a compact grid of all render views with vehicle and film info.
 */
export const MobileProofSheet: React.FC<MobileProofSheetProps> = ({
  views,
  vehicleYear,
  vehicleMake,
  vehicleModel,
  toolKey,
  designName,
  manufacturer,
  colorName,
  productCode,
  finish,
  hex,
  initialQuoteNumber,
  coverageUnit = 'sqft',
}) => {
  const proofRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [quoteNumber, setQuoteNumber] = useState(initialQuoteNumber || '');
  const [shopProfile, setShopProfile] = useState<{ shop_name?: string; shop_logo_url?: string } | null>(null);

  const resolvedToolKey: ToolKey = toolKey || 'colorpro';
  const displayToolLabel = getToolLabel(resolvedToolKey);
  const shopName = shopProfile?.shop_name;
  const shopLogo = shopProfile?.shop_logo_url;
  const vehicleFullName = [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(' ');
  const proofDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

  // Vehicle sq ft and yards lookup
  const vehicleMeasurement = vehicleMake && vehicleModel
    ? findVehicle(vehicleMake, vehicleModel, vehicleYear)
    : null;
  const estimatedSqFt = vehicleMeasurement?.corrSqFt || vehicleMeasurement?.totalSqFt || null;
  const estimatedYards = estimatedSqFt ? sqFtToYards(estimatedSqFt) : null;

  useEffect(() => {
    loadShopProfile().then(profile => {
      if (profile) setShopProfile(profile);
    });
  }, []);

  // Get view by type
  const getViewByType = (types: string[], exclude?: string[]) => {
    for (const type of types) {
      const view = views.find(v => {
        const vl = v.type.toLowerCase();
        if (exclude?.some(ex => vl.includes(ex.toLowerCase()))) return false;
        return vl.includes(type.toLowerCase());
      });
      if (view) return view;
    }
    return undefined;
  };

  const sideView = getViewByType(['side', 'driver', 'left'], ['passenger']);
  const passengerView = getViewByType(['passenger', 'right']);
  const frontView = getViewByType(['front'], ['passenger']);
  const rearView = getViewByType(['rear', 'back']);
  const roofView = getViewByType(['roof']);
  const closeUpView = getViewByType(['close-up', 'closeup', 'detail']);
  const hoodView = getViewByType(['hood', 'hood_detail']);

  const passengerIsFlipped = !passengerView && !!sideView;
  const effectivePassengerView = passengerView || sideView;

  const mainViews: Array<{ label: string; view?: RenderView; flipped?: boolean }> = [
    { label: 'Driver Side', view: sideView },
    { label: 'Passenger', view: effectivePassengerView, flipped: passengerIsFlipped },
    { label: 'Front', view: frontView },
    { label: 'Rear', view: rearView },
    { label: 'Hood', view: hoodView },
    { label: 'Roof', view: roofView },
  ].filter(v => v.view);

  const captureAsPng = async (): Promise<Blob | null> => {
    if (!proofRef.current) return null;

    const images = proofRef.current.querySelectorAll('img');
    await Promise.all(
      Array.from(images).map(img =>
        img.complete ? Promise.resolve() : new Promise(resolve => {
          img.onload = resolve;
          img.onerror = resolve;
        })
      )
    );

    const canvas = await html2canvas(proofRef.current, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
    });

    return new Promise(resolve => canvas.toBlob(resolve, 'image/png', 1.0));
  };

  const handleDownloadPng = async () => {
    setIsGenerating(true);
    try {
      const blob = await captureAsPng();
      if (!blob) throw new Error('Failed to capture proof');

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${vehicleFullName || 'Vehicle'} - Design Proof.png`.replace(/[^a-zA-Z0-9 _\-.]/g, '');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({ title: 'PNG Downloaded', description: 'Proof saved as PNG - ready to share via text!' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to generate PNG', variant: 'destructive' });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSharePng = async () => {
    setIsGenerating(true);
    try {
      const blob = await captureAsPng();
      if (!blob) throw new Error('Failed to capture proof');

      const file = new File([blob], `${vehicleFullName || 'Vehicle'} Proof.png`, { type: 'image/png' });

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: `${vehicleFullName} - Design Proof`,
          text: `Design proof for ${vehicleFullName}`,
          files: [file],
        });
        toast({ title: 'Shared!', description: 'Proof shared successfully.' });
      } else {
        // Fallback: download
        await handleDownloadPng();
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        toast({ title: 'Error', description: err.message || 'Failed to share', variant: 'destructive' });
      }
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="w-full bg-background">
      {/* Control Bar */}
      <div className="p-3 border-b border-border bg-muted/30 space-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="mobileCustomerName" className="text-xs text-muted-foreground shrink-0 font-semibold">
            Customer
          </Label>
          <Input
            id="mobileCustomerName"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Customer name"
            className="flex-1 h-8 text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="mobileQuoteNum" className="text-xs text-muted-foreground shrink-0 font-semibold">
            Quote #
          </Label>
          <Input
            id="mobileQuoteNum"
            value={quoteNumber}
            onChange={(e) => setQuoteNumber(e.target.value)}
            placeholder="QT-2026-042"
            className="flex-1 h-8 text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            onClick={handleDownloadPng}
            disabled={isGenerating}
            className="gap-1.5 text-xs h-9"
          >
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Download PNG
          </Button>
          <Button
            onClick={handleSharePng}
            disabled={isGenerating}
            className="gap-1.5 text-xs h-9 bg-gradient-to-r from-blue-500 to-fuchsia-500 hover:brightness-110 text-white"
          >
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
            Share via Text
          </Button>
        </div>
      </div>

      {/* Proof Content — rendered as PNG */}
      <div className="w-full overflow-x-auto bg-muted/10">
        <div
          ref={proofRef}
          className="bg-white text-black p-4 w-[800px] mx-auto"
        >
          {/* Header */}
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2">
              {shopLogo ? (
                <img src={shopLogo} alt={shopName || 'Shop'} className="h-8 object-contain" />
              ) : (
                <div className="text-base font-bold tracking-tight text-black">
                  {displayToolLabel}
                </div>
              )}
              {shopName && !shopLogo && (
                <span className="text-xs text-gray-600 ml-1">{shopName}</span>
              )}
            </div>
            <div className="text-right">
              <h1 className="text-lg font-bold text-black">{vehicleFullName || 'Vehicle'}</h1>
              <p className="text-xs text-gray-600">Design Approval Proof</p>
              {quoteNumber && (
                <p className="text-[10px] text-gray-500 font-mono mt-0.5">Quote: {quoteNumber}</p>
              )}
            </div>
          </div>

          {/* 2D Grid — 2 columns for mobile-friendly aspect ratio */}
          <div className="grid grid-cols-2 gap-1.5 mb-3">
            {mainViews.map(({ label, view, flipped }) => (
              <div key={label} className="relative aspect-video rounded overflow-hidden">
                {view?.url ? (
                  <img
                    src={view.url}
                    alt={label}
                    className="w-full h-full object-cover"
                    style={flipped ? { transform: 'scaleX(-1)' } : undefined}
                  />
                ) : (
                  <div className="w-full h-full border border-dashed border-gray-300 bg-gray-50" />
                )}
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 bg-black/70 text-white text-[9px] px-1.5 py-0.5 rounded-full">
                  {label}
                </span>
              </div>
            ))}
          </div>

          {/* Film Info Bar — compact */}
          <div className="bg-gray-900 text-white px-3 py-2 rounded mb-3 flex flex-wrap items-center gap-3 text-[11px]">
            {manufacturer && manufacturer !== 'Custom' && (
              <div>
                <span className="text-gray-400 text-[9px] uppercase">Mfg</span>
                <p className="font-semibold">{manufacturer}</p>
              </div>
            )}
            {colorName && colorName !== 'Custom Color' && (
              <div>
                <span className="text-gray-400 text-[9px] uppercase">Color</span>
                <p className="font-semibold">{colorName}</p>
              </div>
            )}
            {productCode && (
              <div>
                <span className="text-gray-400 text-[9px] uppercase">Code</span>
                <p className="font-semibold font-mono">{productCode}</p>
              </div>
            )}
            <div>
              <span className="text-gray-400 text-[9px] uppercase">Finish</span>
              <p className="font-semibold">{finish || 'Gloss'}</p>
            </div>
            {coverageUnit === 'sqft' && estimatedSqFt && (
              <div>
                <span className="text-gray-400 text-[9px] uppercase">Coverage</span>
                <p className="font-semibold">{estimatedSqFt} sq ft</p>
              </div>
            )}
            {coverageUnit === 'yards' && estimatedYards && (
              <div>
                <span className="text-gray-400 text-[9px] uppercase">Film Needed</span>
                <p className="font-semibold">{estimatedYards} yds</p>
              </div>
            )}
            {hex && (
              <div className="flex items-center gap-1.5 ml-auto">
                <div className="w-6 h-6 rounded border border-white/20" style={{ backgroundColor: hex }} />
                <span className="font-mono text-[10px] uppercase">{hex}</span>
              </div>
            )}
          </div>

          {/* Customer + Date */}
          <div className="flex items-end justify-between border-t border-gray-200 pt-2">
            <div>
              {customerName && (
                <p className="text-xs text-gray-700">Customer: <strong>{customerName}</strong></p>
              )}
              <p className="text-[10px] text-gray-400">{proofDate} | {displayToolLabel} by RestyleProAI</p>
            </div>
            <div className="text-right text-[9px] text-gray-400 italic">
              Approval Proof — Not final production
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MobileProofSheet;
