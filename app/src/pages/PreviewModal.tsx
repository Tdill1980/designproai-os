/**
 * /preview-modal — TEMPORARY screenshot harness for the $25 popup.
 *
 * Lets us render TryForTwentyFiveModal in isolation (no DesignPro deps,
 * no auth, no Supabase env) so Playwright can capture the popup against
 * a representative DesignPro-style backdrop. Delete after the popup
 * design is signed off.
 */
import { TryForTwentyFiveModal } from "@/components/TryForTwentyFiveModal";
import { useSearchParams } from "react-router-dom";

export default function PreviewModal() {
  const [params] = useSearchParams();
  const ref = params.get("ref") || undefined;
  const promo = params.get("promo") || undefined;

  return (
    <div
      className="min-h-screen w-full"
      style={{
        background:
          "linear-gradient(135deg, #0b0f1a 0%, #111827 40%, #1f2937 100%)",
      }}
    >
      {/* Fake DesignPro header so the backdrop reads as "modal sits on top
          of the real tool" — visible behind the popup. */}
      <div className="h-14 flex items-center justify-between px-6 border-b border-white/10 text-white">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-gradient-to-br from-purple-500 to-fuchsia-500" />
          <span className="font-extrabold tracking-tight">
            DesignProAI
            <span className="text-white/40 text-xs">™</span>
          </span>
        </div>
        <div className="flex items-center gap-5 text-sm text-white/70">
          <span>Print Pro™ Suite</span>
          <span>Wall Pro™</span>
          <span>Graphics Pro™</span>
          <span>Gallery</span>
          <span>QuickQuote</span>
          <span>Pricing</span>
        </div>
        <div className="text-sm text-white/60">Menu ▾</div>
      </div>

      <div className="p-8 text-white/40 text-xs">
        DesignProAI · DesignIQ AI Design Studio (preview backdrop)
      </div>

      <TryForTwentyFiveModal
        open
        onClose={() => {}}
        refSlug={ref}
        promo={promo}
      />
    </div>
  );
}
