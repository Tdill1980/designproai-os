import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  Check,
  RefreshCw,
  Download,
  ZoomIn,
  Loader2,
  Send,
  Sun,
  Moon,
} from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";

interface MockupAngle {
  angleId: string;
  angleLabel: string;
  mockupUrl: string;
  jobId: string | null;
  // Cyan-outlined surface photo the AI was given. When present we show it
  // small beside the mockup so the customer can compare drawn ↔ rendered.
  zoneOverlayUrl?: string | null;
  // The clean surface photo before the wrap was applied. Used as the
  // persistent "Before" reference next to the rendered mockup.
  surfaceUrl?: string | null;
}

interface MockupPreviewProps {
  mockupUrl: string;
  jobId: string | null;
  isGenerating: boolean;
  onApprove: () => void;
  onRevise: (revisionNote?: string) => void;
  onStartOver: () => void;
  // All angles rendered. When length > 1 the preview switches to a grid.
  angles?: MockupAngle[];
  // Day/night re-render — surfaces an explicit toggle on the preview so the
  // customer can see the same wrap at midday vs after-hours without
  // re-doing the whole flow. Optional so older callers keep working.
  renderMode?: 'day' | 'night';
  onRenderModeChange?: (mode: 'day' | 'night') => void;
}

export function MockupPreview({
  mockupUrl,
  jobId,
  isGenerating,
  onApprove,
  onRevise,
  onStartOver,
  angles,
  renderMode = 'day',
  onRenderModeChange,
}: MockupPreviewProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string>(mockupUrl);
  const [showRevisionInput, setShowRevisionInput] = useState(false);
  const [revisionNote, setRevisionNote] = useState("");

  const angleList = angles && angles.length > 0
    ? angles
    : [{ angleId: "primary", angleLabel: "Mockup", mockupUrl, jobId }];

  const openLightbox = (url: string) => {
    setLightboxUrl(url);
    setLightboxOpen(true);
  };

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = mockupUrl;
    link.download = `graphicspro-mockup-${Date.now()}.png`;
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleRevise = () => {
    onRevise(revisionNote.trim() || undefined);
    setRevisionNote("");
    setShowRevisionInput(false);
  };

  return (
    <div className="space-y-6">
      {/* Day / Night toggle — re-renders the same wrap under different
          lighting. Only surfaced when the parent passed an onRenderModeChange
          callback so older callers (no toggle) keep their original UI. */}
      {onRenderModeChange && (
        <div className="flex items-center justify-center gap-2">
          <span className="text-xs text-gray-500 mr-1">View:</span>
          <button
            type="button"
            onClick={() => !isGenerating && renderMode !== 'day' && onRenderModeChange('day')}
            disabled={isGenerating}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors border ${
              renderMode === 'day'
                ? 'bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white border-transparent shadow'
                : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
            } disabled:opacity-50`}
          >
            <Sun className="w-3.5 h-3.5" /> Day
          </button>
          <button
            type="button"
            onClick={() => !isGenerating && renderMode !== 'night' && onRenderModeChange('night')}
            disabled={isGenerating}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors border ${
              renderMode === 'night'
                ? 'bg-gradient-to-r from-[#1e3a8a] to-[#6b21a8] text-white border-transparent shadow'
                : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
            } disabled:opacity-50`}
          >
            <Moon className="w-3.5 h-3.5" /> Night
          </button>
          {isGenerating && (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400 ml-1" />
          )}
        </div>
      )}

      {/* Mockup Image(s) — single hero image for one angle, grid for multi.
          Right rail keeps the clean BEFORE photo (and the zone-overlay
          reference underneath if available) pinned next to the AFTER mockup
          so the customer always sees what they started from. */}
      {angleList.length === 1 ? (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-3 items-start">
          <Card className="overflow-hidden bg-white border-gray-200">
            <div className="px-2.5 py-1.5 bg-gradient-to-r from-[#3b82f6]/15 to-[#ec4899]/15 border-b border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-700">
                After · {renderMode === 'night' ? 'Night' : 'Day'}
              </p>
            </div>
            <div className="relative group">
              <img
                src={angleList[0].mockupUrl}
                alt="Cut vinyl mockup render"
                className="w-full max-h-[70vh] object-contain cursor-zoom-in bg-gray-50"
                onClick={() => openLightbox(angleList[0].mockupUrl)}
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                <ZoomIn className="w-10 h-10 text-white opacity-0 group-hover:opacity-80 transition-opacity" />
              </div>
            </div>
          </Card>
          {angleList[0].zoneOverlayUrl && (
            // Small "Before" thumbnail pinned to the top of the right rail.
            // sticky + top-4 keeps it visible above the scroll fold so the
            // customer always sees the starting reference next to the
            // After mockup while they scroll through revision controls,
            // pricing, and approval buttons below.
            <Card className="overflow-hidden bg-white border-gray-200 lg:sticky lg:top-4 max-w-[240px]">
              <div className="px-2.5 py-1.5 bg-gradient-to-r from-[#3b82f6]/15 to-[#ec4899]/15 border-b border-gray-200">
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-700">
                  Before
                </p>
                <p className="text-[10px] text-gray-500">
                  Your drawn zones
                </p>
              </div>
              <div className="relative group">
                <img
                  src={angleList[0].zoneOverlayUrl}
                  alt="Before — surface with your drawn zones"
                  className="w-full object-contain cursor-zoom-in bg-gray-50"
                  onClick={() => openLightbox(angleList[0].zoneOverlayUrl!)}
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                  <ZoomIn className="w-6 h-6 text-white opacity-0 group-hover:opacity-90 transition-opacity" />
                </div>
              </div>
            </Card>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {angleList.map((a) => (
            <Card key={a.angleId} className="overflow-hidden bg-rp-surface border-border/30">
              <div className="grid grid-cols-[1fr_96px]">
                <div className="relative group">
                  <img
                    src={a.mockupUrl}
                    alt={`${a.angleLabel} mockup`}
                    className="w-full max-h-[55vh] object-contain cursor-zoom-in bg-secondary"
                    onClick={() => openLightbox(a.mockupUrl)}
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                    <ZoomIn className="w-8 h-8 text-white opacity-0 group-hover:opacity-80 transition-opacity" />
                  </div>
                  <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/70 text-[11px] font-bold text-white uppercase tracking-wide">
                    {a.angleLabel}
                  </div>
                </div>
                {a.zoneOverlayUrl && (
                  <div className="border-l border-border/30 bg-secondary flex flex-col">
                    <div className="px-1.5 py-1 text-center bg-gradient-to-r from-[#3b82f6]/15 to-[#ec4899]/15 border-b border-border/30">
                      <p className="text-[9px] font-bold uppercase tracking-wider text-foreground leading-tight">
                        Zones
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => openLightbox(a.zoneOverlayUrl!)}
                      className="flex-1 p-1 cursor-zoom-in"
                    >
                      <img
                        src={a.zoneOverlayUrl}
                        alt={`${a.angleLabel} drawn zones`}
                        className="w-full h-full object-contain"
                      />
                    </button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Revision Input */}
      {showRevisionInput && (
        <Card className="p-4 bg-rp-surface border-border/30 space-y-3">
          <p className="text-sm font-medium text-foreground">What would you like to change?</p>
          <select
            value={revisionNote.startsWith('[') ? revisionNote.split('] ')[0] + ']' : ''}
            onChange={(e) => {
              const zone = e.target.value;
              const existing = revisionNote.replace(/^\[.*?\]\s*/, '');
              setRevisionNote(zone ? `${zone} ${existing}` : existing);
            }}
            className="w-full h-8 text-xs bg-secondary border border-border rounded-md px-2 text-foreground"
          >
            <option value="">Whole design</option>
            <option value="[Doors]">Doors</option>
            <option value="[Side Panel]">Side Panel</option>
            <option value="[Tailgate]">Tailgate</option>
            <option value="[Hood]">Hood</option>
            <option value="[Rear Window]">Rear Window</option>
          </select>
          <Textarea
            value={revisionNote}
            onChange={(e) => setRevisionNote(e.target.value)}
            placeholder="e.g. Make the logo bigger, move text to the right, change colors to red and black, add phone number..."
            className="text-sm bg-secondary border-border/30 min-h-[80px] resize-none"
            rows={3}
          />
          <div className="flex gap-2 justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setShowRevisionInput(false); setRevisionNote(""); }}
              className="text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleRevise}
              disabled={isGenerating}
              className="bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white gap-2"
            >
              {isGenerating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              Send Revision
            </Button>
          </div>
        </Card>
      )}

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Button
          onClick={onApprove}
          disabled={isGenerating}
          size="sm"
          className="bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white font-semibold gap-2"
        >
          <Check className="w-4 h-4" />
          Approve
        </Button>
        <Button
          onClick={() => setShowRevisionInput(true)}
          disabled={isGenerating || showRevisionInput}
          variant="outline"
          size="sm"
          className="gap-2"
        >
          {isGenerating ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          Revise
        </Button>
        <Button
          onClick={handleDownload}
          variant="outline"
          size="sm"
          className="gap-2"
        >
          <Download className="w-4 h-4" />
          Download
        </Button>
        <Button
          onClick={onStartOver}
          variant="ghost"
          size="sm"
          className="gap-2 text-muted-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
          Start Over
        </Button>
      </div>

      {/* Lightbox */}
      <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 bg-black border-none">
          <img
            src={lightboxUrl}
            alt="Cut vinyl mockup — full size"
            className="w-full h-full object-contain"
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
