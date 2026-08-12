/**
 * PortalHeader — the persistent AI-first customer portal banner shown at the
 * top of the customer proof page at EVERY stage (intake → Ace designing →
 * proof ready → approved), so the whole experience reads as one branded
 * ApprovePro × WePrintWraps journey led by Ace (the AI designer).
 *
 * White UI + ProductionFlow blue→magenta gradient accent. Includes the live
 * status tracker so the customer can see where their order is at any time.
 */

import { Check, MessageCircle } from "lucide-react";

const ACE_IMG = "/characters/ace-robot.png";

const STEPS = [
  { key: "received", label: "Order received" },
  { key: "designing", label: "Ace designing" },
  { key: "proof", label: "Proof ready" },
  { key: "approved", label: "Approved" },
];

function stepIndex(status: string, hasDesign: boolean): number {
  if (status === "approved") return 3;
  if (hasDesign) return 2;            // a design exists → proof ready to review
  return 1;                            // received, Ace is designing
}

interface Props {
  shopName?: string | null;
  shopLogoUrl?: string | null;
  whiteLabelLogoUrl?: string | null;
  status: string;
  hasDesign: boolean;
  onMessageTeam?: () => void;
}

export function PortalHeader({ shopName, shopLogoUrl, whiteLabelLogoUrl, status, hasDesign, onMessageTeam }: Props) {
  const idx = stepIndex(status, hasDesign);
  const whiteLabel = !!whiteLabelLogoUrl;

  return (
    <div className="rounded-2xl overflow-hidden border border-gray-200 bg-white shadow-sm">
      {/* Brand band */}
      <div className="px-5 py-4 text-white" style={{ background: "linear-gradient(90deg,#3b82f6,#ec4899)" }}>
        <div className="flex items-center gap-3">
          {whiteLabel ? (
            <img src={whiteLabelLogoUrl!} alt={shopName || ""} className="h-11 w-auto max-w-[150px] object-contain bg-white/15 rounded-lg p-1 shrink-0" />
          ) : (
            <img src={ACE_IMG} alt="Ace" className="w-12 h-12 rounded-lg object-contain bg-white/15 p-0.5 shrink-0" />
          )}
          <div className="min-w-0">
            <div className="text-[17px] font-extrabold leading-tight">
              {whiteLabel ? (shopName || "Your Design Portal") : "Meet Ace — your graphic designer 🎨"}
            </div>
            <div className="text-[11px] font-semibold opacity-95">
              {whiteLabel
                ? "Vehicle Wrap Design & Approval System"
                : `ApprovePro™ × ${shopName || "WePrintWraps.com"} · Vehicle Wrap Design & Approval System`}
            </div>
          </div>
          {(shopLogoUrl && !whiteLabel) && (
            <img src={shopLogoUrl} alt={shopName || ""} className="ml-auto h-9 w-auto max-w-[120px] object-contain bg-white/15 rounded-md p-1 shrink-0 hidden sm:block" />
          )}
        </div>
        {onMessageTeam && (
          <button
            type="button"
            onClick={onMessageTeam}
            className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/20 hover:bg-white/30 transition-colors px-3.5 py-1.5 text-[13px] font-semibold text-white"
          >
            <MessageCircle className="w-3.5 h-3.5" /> Message the team
          </button>
        )}
      </div>

      {/* Status tracker */}
      <div className="px-5 py-3">
        <div className="flex items-center">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center text-center">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold ${i <= idx ? "text-white" : "bg-gray-100 text-gray-400"}`}
                  style={i <= idx ? { background: "linear-gradient(90deg,#3b82f6,#ec4899)" } : undefined}
                >
                  {i < idx ? <Check className="w-4 h-4" /> : i + 1}
                </div>
                <span className={`mt-1 text-[10px] ${i <= idx ? "text-gray-800 font-semibold" : "text-gray-400"}`}>{s.label}</span>
              </div>
              {i < STEPS.length - 1 && <div className={`h-0.5 flex-1 mx-1 ${i < idx ? "bg-blue-400" : "bg-gray-200"}`} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
