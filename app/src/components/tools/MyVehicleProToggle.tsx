import { useState } from "react";
import { Camera, Car, Grid3X3, Info, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { MyVehicleUploader } from "@/components/colorpro/MyVehicleUploader";
import { MultiViewUploader } from "@/components/colorpro/MultiViewUploader";
import { UpgradeRequired } from "@/components/UpgradeRequired";
import { useUserTier } from "@/hooks/useUserTier";
import type { VehicleInfo, ViewPhotoData } from "@/hooks/useMyVehicleMode";

// Tier levels matching SubscriptionGate / TIER_LEVELS — MyVehiclePro
// requires "advanced" (DesignPro Lite) or higher. Starter and free users
// see the toggle but get an upgrade prompt when they tap it.
const MYVEHICLE_REQUIRED_LEVEL = 2;
const TIER_LEVEL: Record<string, number> = {
  free: 0,
  starter: 1,
  pro: 1, // legacy alias used by OrganizationContext
  advanced: 2,
  complete: 3,
  enterprise: 3, // legacy alias
  agency: 99,
};

interface MyVehicleProToggleProps {
  /** Existing year/make/model inputs - shown when MyVehiclePro is OFF */
  children: React.ReactNode;
  isMyVehicleMode: boolean;
  onToggle: (enabled: boolean) => void;
  /** Upload mode: single photo or multi-view */
  uploadMode: "single" | "multi";
  onUploadModeChange: (mode: "single" | "multi") => void;
  /** Photo state */
  photoPreviewUrl: string | null;
  multiViewPhotos: ViewPhotoData[];
  isAnalyzing: boolean;
  detectedVehicleInfo: VehicleInfo | null;
  /** Photo actions */
  onPhotoUpload: (file: File) => void;
  onMultiViewPhotoUpload: (file: File, viewType: string) => void;
  onRemoveMultiViewPhoto: (viewType: string) => void;
  onClearPhotos: () => void;
  /**
   * When true, bypass the toggle's own tier gate. Use this on host tools
   * that already enforce a tier requirement at or above MyVehiclePro's
   * (e.g. /designpro requires `complete`, which is strictly higher than
   * MV's `advanced` minimum) so paid customers don't hit a redundant
   * upgrade prompt nested inside a tool they're already entitled to.
   */
  bypassTierGate?: boolean;
}

/**
 * Prominent branded toggle that replaces the vehicle input area on every tool page.
 * When OFF: shows existing year/make/model inputs (children).
 * When ON: shows photo uploader (single + multi-view).
 * Always visible as a brand anchor with gradient styling.
 */
export const MyVehicleProToggle = ({
  children,
  isMyVehicleMode,
  onToggle,
  uploadMode,
  onUploadModeChange,
  photoPreviewUrl,
  multiViewPhotos,
  isAnalyzing,
  detectedVehicleInfo,
  onPhotoUpload,
  onMultiViewPhotoUpload,
  onRemoveMultiViewPhoto,
  onClearPhotos,
  bypassTierGate = false,
}: MyVehicleProToggleProps) => {
  // Tier gate — MyVehiclePro is a DesignPro Lite (advanced) feature.
  // Starter / free users see the toggle as a locked upsell instead of a
  // working switch so they discover the feature but can't bypass billing.
  // Host tools with a stricter tier requirement than MV can pass
  // `bypassTierGate` so their paid customers don't hit a nested upsell.
  const userTier = useUserTier();
  const userLevel = TIER_LEVEL[userTier] ?? 0;
  const isLocked = !bypassTierGate && userLevel < MYVEHICLE_REQUIRED_LEVEL;
  const [showUpgrade, setShowUpgrade] = useState(false);

  // Tap on the switch — gated callers route to the upgrade modal so the
  // mode never flips on for unentitled users. If the parent had already
  // forced the mode on (shouldn't happen, but defensive), force it back
  // off for the locked case so we never render the photo uploader.
  const handleToggle = () => {
    if (isLocked) {
      if (isMyVehicleMode) onToggle(false);
      setShowUpgrade(true);
      return;
    }
    onToggle(!isMyVehicleMode);
  };

  return (
    <div className="space-y-3">
      {/* ─── Branded Toggle Banner ─── */}
      <div
        className={cn(
          "relative overflow-hidden rounded-xl border transition-all duration-300",
          isLocked
            ? "border-fuchsia-500/30 bg-gradient-to-r from-blue-600/5 via-fuchsia-600/5 to-background"
            : isMyVehicleMode
              ? "border-fuchsia-500/50 bg-gradient-to-r from-blue-600/15 via-fuchsia-600/10 to-background"
              : "border-blue-500/30 bg-gradient-to-r from-blue-600/10 via-fuchsia-500/5 to-background hover:border-fuchsia-500/40"
        )}
      >
        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            {/* Left: Branding */}
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "flex items-center justify-center w-9 h-9 rounded-lg transition-all",
                  isMyVehicleMode
                    ? "bg-gradient-to-br from-blue-500/25 to-fuchsia-500/25"
                    : "bg-gradient-to-br from-blue-500/10 to-fuchsia-500/10"
                )}
              >
                <Camera className={cn("w-5 h-5", isMyVehicleMode ? "text-fuchsia-400" : "text-blue-400")} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold">
                    <span className="text-foreground">MyVehicle</span>
                    <span className="bg-gradient-to-r from-blue-400 to-fuchsia-500 bg-clip-text text-transparent">Pro&#8482;</span>
                  </span>
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="w-3.5 h-3.5 text-muted-foreground/60 hover:text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[240px] text-xs">
                        Upload a photo of your actual vehicle — car, truck, van, boat, RV, or motorcycle — and see the wrap applied directly to it. Works with any vehicle as long as you enter year, make, and model.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                {isLocked && (
                  <span className="inline-flex items-center gap-1 mt-0.5 mr-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-gradient-to-r from-blue-500/20 to-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/30">
                    <Lock className="w-2.5 h-2.5" />
                    DesignPro Lite
                  </span>
                )}
                <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                  {isLocked
                    ? "Apply designs to your customer's actual vehicle photo — upgrade to unlock."
                    : isMyVehicleMode
                      ? "Your lighting, your vehicle — specular highlights & real-world light response"
                      : "See real manufacturer film on YOUR vehicle"}
                </p>
              </div>
            </div>

            {/* Right: Toggle Switch */}
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "text-xs font-medium transition-colors",
                  !isMyVehicleMode ? "text-foreground" : "text-muted-foreground"
                )}
              >
                Studio
              </span>
              <button
                onClick={handleToggle}
                aria-label={isLocked ? "Upgrade to use MyVehiclePro" : (isMyVehicleMode ? "Switch to Studio mode" : "Switch to MyVehicle mode")}
                className={cn(
                  "relative w-12 h-6 rounded-full transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500/50",
                  isLocked
                    ? "bg-gradient-to-r from-blue-500/40 to-fuchsia-500/40"
                    : isMyVehicleMode
                      ? "bg-gradient-to-r from-blue-500 to-fuchsia-500"
                      : "bg-secondary/80"
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-300 flex items-center justify-center",
                    (isMyVehicleMode && !isLocked) ? "left-[26px]" : "left-0.5"
                  )}
                >
                  {isLocked && <Lock className="w-2.5 h-2.5 text-fuchsia-500" />}
                </span>
              </button>
              <span
                className={cn(
                  "text-xs font-medium transition-colors",
                  isMyVehicleMode ? "text-fuchsia-400" : "text-muted-foreground"
                )}
              >
                My Vehicle
              </span>
            </div>
          </div>
        </div>

        {/* Gradient line at bottom when active */}
        {isMyVehicleMode && (
          <div className="h-[2px] bg-gradient-to-r from-transparent via-fuchsia-500/60 to-transparent" />
        )}
      </div>

      {/* ─── Content: Photo uploader when MyVehicle is ON ───
          (locked tier users never reach this — handleToggle blocks them) */}
      {isMyVehicleMode && !isLocked && (
        <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
          {/* Upload mode toggle (single vs multi) */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => onUploadModeChange("single")}
              className={cn(
                "px-3 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5",
                uploadMode === "single"
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              <Camera className="h-3.5 w-3.5" />
              Single Photo
            </button>
            <button
              onClick={() => onUploadModeChange("multi")}
              className={cn(
                "px-3 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5",
                uploadMode === "multi"
                  ? "bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/50"
                  : "bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              <Grid3X3 className="h-3.5 w-3.5" />
              Multi-View
            </button>
          </div>

          {/* Photo uploader */}
          {uploadMode === "single" ? (
            <MyVehicleUploader
              photoPreviewUrl={photoPreviewUrl}
              isAnalyzing={isAnalyzing}
              detectedVehicleInfo={detectedVehicleInfo}
              onPhotoUpload={onPhotoUpload}
              onClear={onClearPhotos}
            />
          ) : (
            <MultiViewUploader
              photos={multiViewPhotos.map((p) => ({
                viewType: p.viewType,
                file: null as any,
                previewUrl: p.previewUrl,
                base64: p.base64,
                mimeType: p.mimeType,
              }))}
              isAnalyzing={isAnalyzing}
              onPhotoUpload={onMultiViewPhotoUpload}
              onRemovePhoto={onRemoveMultiViewPhoto}
              onClearAll={onClearPhotos}
            />
          )}
        </div>
      )}

      {/* ─── Vehicle inputs — always visible ─── */}
      <>{children}</>

      {/* ─── Upgrade prompt — shown when a Starter/free user taps the
            locked MyVehiclePro toggle. Routes them to /pricing. ─── */}
      <UpgradeRequired
        isOpen={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        requiredTier="advanced"
        featureName="MyVehiclePro"
      />
    </div>
  );
};
