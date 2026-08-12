/**
 * NonStandardVehicleWarning — Proof-stage validation banner.
 *
 * Renders on the proof / preview / production screens when a render came from
 * a non-standard vehicle class (motorcycle, boat, bus, RV). These vehicles
 * have their dimensions looked up via Google-grounded Gemini rather than
 * RestylePro's curated 1,668-vehicle database, so the numbers must be
 * human-verified before any panel is sent to print.
 *
 * Flow:
 *   1. Render returns { requiresValidation: true, vehicleSpecsId, dimensions, sourceUrls }
 *   2. The proof screen shows this banner with the raw numbers and source links
 *   3. User clicks "I Verified These Dimensions" → banner calls the Supabase
 *      RPC to update vehicle_specs_universal.validated_by/validated_at
 *   4. Once validated, the print/production CTA unlocks
 *
 * Note: this banner DOES NOT block the on-screen render. It only blocks the
 * downstream print action. Users can still see and share the proof.
 */

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export interface VehicleSpecsPreview {
  vehicleSpecsId?: string;
  vehicleClass: string;
  vehicleSubType?: string;
  dimensions: {
    overall_length_in: number;
    overall_width_in: number;
    overall_height_in: number;
    wheelbase_in?: number;
  };
  panels?: { total_sq_ft?: number } & Record<string, number | undefined>;
  confidence: "high" | "medium" | "low";
  sourceUrls?: string[];
}

interface NonStandardVehicleWarningProps {
  specs: VehicleSpecsPreview;
  onValidated?: () => void;
  className?: string;
}

const CLASS_LABELS: Record<string, string> = {
  motorcycle: "Motorcycle",
  boat: "Boat",
  bus: "Bus",
  rv: "RV / Motorhome",
};

export const NonStandardVehicleWarning = ({ specs, onValidated, className }: NonStandardVehicleWarningProps) => {
  const { toast } = useToast();
  const [isValidated, setIsValidated] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const classLabel = CLASS_LABELS[specs.vehicleClass] || specs.vehicleClass;
  const subType = specs.vehicleSubType ? specs.vehicleSubType.replace(/_/g, " ") : null;

  const confidenceLabel =
    specs.confidence === "high"
      ? "High confidence"
      : specs.confidence === "low"
        ? "Low confidence — please double-check"
        : "Medium confidence";

  const handleConfirm = async () => {
    if (!specs.vehicleSpecsId) {
      // No DB row — mark as validated client-side only
      setIsValidated(true);
      onValidated?.();
      toast({
        title: "Dimensions Confirmed",
        description: "You've confirmed the dimensions are correct.",
      });
      return;
    }

    setIsSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast({
          title: "Sign in required",
          description: "Please sign in to confirm vehicle dimensions.",
          variant: "destructive",
        });
        setIsSaving(false);
        return;
      }

      const { error } = await supabase
        .from("vehicle_specs_universal")
        .update({
          validated_by: user.id,
          validated_at: new Date().toISOString(),
          requires_validation: false,
        })
        .eq("id", specs.vehicleSpecsId);

      if (error) {
        console.error("[NonStandardVehicleWarning] Validation update failed:", error);
        toast({
          title: "Validation Failed",
          description: "Could not save validation. Please try again.",
          variant: "destructive",
        });
        return;
      }

      setIsValidated(true);
      onValidated?.();
      toast({
        title: "Dimensions Confirmed",
        description: "Production CTA is now unlocked for this vehicle.",
      });
    } catch (err: any) {
      console.error("[NonStandardVehicleWarning] Exception:", err);
      toast({
        title: "Validation Failed",
        description: err.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isValidated) {
    return (
      <div className={cn("rounded-lg border border-green-500/40 bg-green-500/5 p-3", className)}>
        <div className="flex items-center gap-2 text-sm text-green-400">
          <CheckCircle2 className="w-4 h-4" />
          <span className="font-semibold">Dimensions Verified</span>
          <span className="text-xs text-green-400/70">— ready for production</span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("rounded-lg border border-blue-500/40 bg-blue-500/5 p-3 sm:p-4 space-y-3", className)}>
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-bold text-blue-400">
            Non-Standard Vehicle — Verify Before Printing
          </h4>
          <p className="text-xs text-blue-200/80 mt-1">
            This {classLabel}
            {subType ? ` (${subType})` : ""} is outside RestylePro's standard vehicle library.
            We looked up dimensions via Google. Please confirm they match the actual vehicle
            before sending panels to print.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs bg-background/40 rounded-md p-2">
        <div>
          <div className="text-muted-foreground">Length</div>
          <div className="font-mono font-semibold text-foreground">
            {specs.dimensions.overall_length_in}"
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Width</div>
          <div className="font-mono font-semibold text-foreground">
            {specs.dimensions.overall_width_in}"
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Height</div>
          <div className="font-mono font-semibold text-foreground">
            {specs.dimensions.overall_height_in}"
          </div>
        </div>
        {specs.dimensions.wheelbase_in ? (
          <div>
            <div className="text-muted-foreground">Wheelbase</div>
            <div className="font-mono font-semibold text-foreground">
              {specs.dimensions.wheelbase_in}"
            </div>
          </div>
        ) : (
          <div>
            <div className="text-muted-foreground">Wrap Coverage</div>
            <div className="font-mono font-semibold text-foreground">
              {specs.panels?.total_sq_ft ? `${specs.panels.total_sq_ft} sq ft` : "—"}
            </div>
          </div>
        )}
      </div>

      <div className="text-[10px] text-muted-foreground">{confidenceLabel}</div>

      {specs.sourceUrls && specs.sourceUrls.length > 0 && (
        <div className="text-[10px] space-y-1">
          <div className="text-muted-foreground font-semibold">Sources:</div>
          <ul className="space-y-0.5">
            {specs.sourceUrls.slice(0, 3).map((url, i) => (
              <li key={i}>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#00C7FF] hover:underline inline-flex items-center gap-1 break-all"
                >
                  <ExternalLink className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">{new URL(url).hostname}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Button
        type="button"
        size="sm"
        onClick={handleConfirm}
        disabled={isSaving}
        className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold"
      >
        {isSaving ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Saving...
          </>
        ) : (
          <>
            <CheckCircle2 className="w-4 h-4 mr-2" />
            I Verified These Dimensions
          </>
        )}
      </Button>
    </div>
  );
};
