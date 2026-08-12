import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Eye, ArrowRight, ArrowLeft, CheckCircle2, AlertCircle,
  Image, Type, Palette, Scissors, FileText, Square,
} from "lucide-react";
import type { SurfaceSelections, GraphicInput, VinylFinish } from "./types";

interface PreVisionReviewProps {
  surface: SurfaceSelections;
  graphic: GraphicInput;
  vinylFinish: VinylFinish;
  isValid: boolean;
  onGenerate: () => void;
  onBack: () => void;
  isGenerating: boolean;
}

function ReviewRow({
  label,
  value,
  icon,
  ok,
}: {
  label: string;
  value: string | null;
  icon: React.ReactNode;
  ok: boolean;
}) {
  return (
    <div className="flex items-start gap-3 py-2">
      <div className={`mt-0.5 ${ok ? "text-green-400" : "text-muted-foreground/30"}`}>
        {ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-muted-foreground/60">{icon}</span>
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
        </div>
        <p className={`text-sm truncate ${ok ? "text-foreground" : "text-muted-foreground/40 italic"}`}>
          {value || "Not set"}
        </p>
      </div>
    </div>
  );
}

export function PreVisionReview({
  surface,
  graphic,
  vinylFinish,
  isValid,
  onGenerate,
  onBack,
  isGenerating,
}: PreVisionReviewProps) {
  // Aggregate zones across uploaded angles + build-mode zones for the summary.
  const allZones = surface.source === "upload"
    ? surface.uploadedAngles.flatMap((a) => a.zones)
    : surface.vinylZones;

  // Build surface summary
  const surfaceSummary = (): string | null => {
    if (surface.source === "upload" && surface.uploadedAngles.length > 0) {
      const n = surface.uploadedAngles.length;
      const labels = surface.uploadedAngles
        .map((a) => a.angleLabel)
        .filter(Boolean)
        .slice(0, 4)
        .join(", ");
      return n === 1
        ? `Uploaded: ${labels || "1 photo"}`
        : `${n} angles uploaded${labels ? ` — ${labels}` : ""}`;
    }
    if (surface.type === "vehicle") {
      const parts = [surface.year, surface.make, surface.model].filter(Boolean);
      const areas = surface.vinylZones.map((z) => z.label).join(", ");
      if (areas) parts.push(`(${areas})`);
      return parts.length > 0 ? parts.join(" ") : null;
    }
    if (surface.type === "wall") {
      return `${surface.indoor ? "Indoor" : "Outdoor"} wall — ${surface.wallTexture || "smooth"}`;
    }
    if (surface.type === "glass") {
      return `${surface.glassType || "Glass"} — ${surface.glassMount} mount, ${surface.glassTint} tint`;
    }
    if (surface.type === "surface") {
      if (surface.surfaceCategory === "floor") return `Floor — ${surface.floorType}`;
      if (surface.surfaceCategory === "signage") return `Signage — ${surface.signageType}`;
      return surface.surfaceCategory || null;
    }
    return null;
  };

  // Build graphic summary
  const graphicSummary = (): string | null => {
    switch (graphic.mode) {
      case "design":
        return graphic.designPrompt
          ? `${graphic.designStyle} — "${graphic.designPrompt.slice(0, 80)}${graphic.designPrompt.length > 80 ? "..." : ""}"`
          : null;
      case "commercial":
        return graphic.businessName
          ? `${graphic.businessName}${graphic.businessIndustry ? ` (${graphic.businessIndustry})` : ""}`
          : null;
      case "upload":
        return graphic.uploadedArtworkFiles.length > 0
          ? `${graphic.uploadedArtworkFiles.length} file${graphic.uploadedArtworkFiles.length > 1 ? "s" : ""} uploaded${graphic.restyleEnabled ? " + restyle" : ""}`
          : null;
      case "restyle":
        return graphic.restyleSourceFile
          ? `Restyle: "${graphic.restylePrompt.slice(0, 60)}${graphic.restylePrompt.length > 60 ? "..." : ""}"`
          : null;
      default:
        return null;
    }
  };

  const hasCopy = graphic.businessCopyText.trim().length > 0;
  const hasFont = graphic.businessFont.trim().length > 0;
  const hasLogo = !!graphic.businessLogoUrl;
  const hasVisionBoard = graphic.visionBoardImages.length > 0;
  const hasZones = allZones.length > 0;

  const finishLabels: Record<string, string> = {
    glossy: "Glossy — high-shine reflective",
    matte: "Matte — flat non-reflective",
    satin: "Satin — semi-gloss subtle sheen",
    reflective: "Reflective — high-visibility",
  };

  return (
    <Card className="p-5 bg-rp-surface border-rp">
      <div className="flex items-center gap-2 mb-4">
        <Eye className="w-5 h-5 text-blue-500" />
        <h3 className="text-lg font-semibold text-foreground">Pre-Vision Review</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Review your selections before generating. Edit anything by going back.
      </p>

      <div className="divide-y divide-gray-100">
        <ReviewRow
          label="Surface"
          value={surfaceSummary()}
          icon={<Image className="w-3.5 h-3.5" />}
          ok={!!surfaceSummary()}
        />
        <ReviewRow
          label={`Graphic — ${graphic.mode}`}
          value={graphicSummary()}
          icon={<Scissors className="w-3.5 h-3.5" />}
          ok={!!graphicSummary()}
        />
        <ReviewRow
          label="Vinyl Finish"
          value={finishLabels[vinylFinish] || vinylFinish}
          icon={<Palette className="w-3.5 h-3.5" />}
          ok={true}
        />
        {hasFont && (
          <ReviewRow
            label="Font"
            value={graphic.businessFont}
            icon={<Type className="w-3.5 h-3.5" />}
            ok={true}
          />
        )}
        {hasCopy && (
          <ReviewRow
            label="Additional Text"
            value={graphic.businessCopyText}
            icon={<FileText className="w-3.5 h-3.5" />}
            ok={true}
          />
        )}
        {hasLogo && (
          <div className="flex items-start gap-3 py-2">
            <CheckCircle2 className="w-4 h-4 text-green-400 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Logo</p>
              <img src={graphic.businessLogoUrl!} alt="Logo" className="h-10 rounded" />
            </div>
          </div>
        )}
        {hasVisionBoard && (
          <div className="flex items-start gap-3 py-2">
            <CheckCircle2 className="w-4 h-4 text-green-400 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">
                VisionBoardIQ — {graphic.visionBoardImages.length} reference{graphic.visionBoardImages.length > 1 ? "s" : ""} ({graphic.visionBoardIntent === "exact_reference" ? "Exact Reference" : graphic.visionBoardIntent === "style_inspiration" ? "Style Inspiration" : "Choose intent"})
              </p>
              <div className="flex gap-1.5">
                {graphic.visionBoardImages.map((img, i) => (
                  <img key={i} src={img.storageUrl} alt={img.slotLabel} className="w-10 h-10 rounded object-cover border border-border/30" />
                ))}
              </div>
            </div>
          </div>
        )}
        {hasZones && (
          <div className="flex items-start gap-3 py-2">
            <CheckCircle2 className="w-4 h-4 text-green-400 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-1">
                <Square className="w-3.5 h-3.5 text-muted-foreground/60" />
                <span className="text-xs font-medium text-muted-foreground">
                  Vinyl Zones — {allZones.length} zone{allZones.length > 1 ? "s" : ""}
                </span>
              </div>
              <div className="space-y-1">
                {allZones.map((z, i) => (
                  <div key={z.id} className="text-xs text-foreground">
                    <span className="font-medium">{z.label}</span>
                    <span className="text-muted-foreground">
                      {" — "}{z.widthInches}" × {z.heightInches}"
                      {z.location && ` @ ${z.location}`}
                    </span>
                    {z.designPrompt && (
                      <p className="text-muted-foreground/70 truncate ml-2">
                        "{z.designPrompt.slice(0, 60)}{z.designPrompt.length > 60 ? "..." : ""}"
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between mt-6 pt-4 border-t border-border/20">
        <Button
          variant="ghost"
          onClick={onBack}
          className="gap-2 text-muted-foreground"
        >
          <ArrowLeft className="w-4 h-4" /> Edit Setup
        </Button>
        <Button
          onClick={onGenerate}
          disabled={!isValid || isGenerating}
          size="sm"
          className="bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white font-semibold px-6 gap-2 disabled:opacity-40"
        >
          Generate Mockup
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </Card>
  );
}
