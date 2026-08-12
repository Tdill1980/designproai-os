/**
 * PrintProCTAButton — unified "Get a Price / Order through PrintPro" button.
 *
 * Use this button on any Design Gen tool (ColorPro, DesignPro, RevisionStudioIQ,
 * etc.) to hand a customer's current render off to PrintPro for WPW-priced
 * quoting + ordering.
 *
 * The render context (urls, vehicle info, finish, design name, source tool)
 * is serialized into localStorage under `printpro-quote-context`. PrintPro's
 * landing page reads this on mount to pre-populate the quote form.
 *
 * Non-destructive — does not save to any table, does not modify the tool's
 * state, does not call any edge function. Pure navigation + localStorage.
 */

import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ShoppingCart } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PrintProQuoteContext {
  toolSource: string;           // "colorpro" | "designpro" | "revisionstudio" | etc.
  renderUrl?: string | null;    // hero render
  renderUrls?: Record<string, string>; // all views (side, rear, etc.)
  vehicleYear?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  designName?: string;
  finish?: string;
  colorName?: string;
  colorHex?: string;
  designId?: string | null;
}

interface PrintProCTAButtonProps {
  context: PrintProQuoteContext;
  /** Disabled until a render exists */
  disabled?: boolean;
  className?: string;
  /** "full" fills container, "default" sizes to content */
  width?: "full" | "default";
  label?: string;
}

export function PrintProCTAButton({
  context,
  disabled = false,
  className,
  width = "default",
  label = "Get a Price / Order through PrintPro",
}: PrintProCTAButtonProps) {
  const navigate = useNavigate();

  const handleClick = () => {
    try {
      localStorage.setItem(
        "printpro-quote-context",
        JSON.stringify({ ...context, handedOffAt: new Date().toISOString() }),
      );
    } catch {
      // localStorage may be full / disabled — fall through, PrintPro lands blank
    }
    navigate("/printpro");
  };

  return (
    <Button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={cn(
        "bg-gradient-to-r from-green-600 to-emerald-600 text-white hover:from-green-700 hover:to-emerald-700 font-semibold",
        width === "full" && "w-full",
        className,
      )}
    >
      <ShoppingCart className="w-4 h-4 mr-2" />
      {label}
    </Button>
  );
}
