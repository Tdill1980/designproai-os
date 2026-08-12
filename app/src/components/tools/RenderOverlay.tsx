import { cn } from "@/lib/utils";

/**
 * RENDER OVERLAY - Branding for all tool renders (UI PREVIEW ONLY)
 *
 * IMPORTANT: This component is for UI preview purposes only.
 * All exported images (downloads, PDFs, share links) MUST use
 * the stampOverlayOnImage() utility from src/lib/overlay-stamper.ts
 * to ensure deterministic, permanent overlay embedding.
 *
 * Typography: Black text matching the export stamper contract.
 * - Upper-left: Tool name | Font: Poppins | Weight: 500 | Color: White w/ shadow
 * - Bottom-right: Manufacturer + Color/Design | Font: Inter | Weight: 500 | Color: White w/ shadow
 */
interface RenderOverlayProps {
  /** Tool name displayed in upper-left (e.g., "ColorPro", "FadeWraps", "DesignPanelPro") */
  toolName?: string;
  /** Manufacturer name (e.g., "3M", "Avery Dennison") - bottom right */
  manufacturer?: string;
  /** Color or design name (e.g., "Satin Nardo Gray", "Carbon Fiber") - bottom right */
  colorOrDesignName?: string;
  /** Additional CSS classes */
  className?: string;
}

export const RenderOverlay = ({
  toolName,
  manufacturer,
  colorOrDesignName,
  className,
}: RenderOverlayProps) => {
  const bottomLabel = [manufacturer, colorOrDesignName].filter(Boolean).join(" ").trim();

  // Don't render if nothing to show
  if (!toolName && !bottomLabel) return null;

  return (
    <>
      {/* Upper-left: Tool name branding - Poppins Medium, Black */}
      {toolName && (
        <div
          className={cn(
            "absolute top-3 left-3 text-base font-medium pointer-events-none select-none",
            "font-poppins text-black",
            className,
          )}
        >
          {toolName}
        </div>
      )}

      {/* Bottom-right: Manufacturer + Color/Design name - Inter Light, Black */}
      {bottomLabel && (
        <div
          className={cn(
            "absolute bottom-3 right-3 text-sm font-bold pointer-events-none text-right max-w-[70%] select-none",
            "font-inter text-white",
            className,
          )}
        >
          {bottomLabel}
        </div>
      )}
    </>
  );
};
