import { ReactNode, useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  LayoutDashboard,
  Image,
  Settings,
  ShieldCheck,
  Handshake,
  Share2,
  Copy,
  Check,
  ArrowRight,
} from "lucide-react";
import { useAffiliateProfile } from "@/hooks/useAffiliateData";
import { defaultHeadshotPath, getWpwRepByPartnerCode } from "@/lib/wpw-reps";
import { toast } from "sonner";

const OPERATOR_EMAILS = [
  "tdill@restyleproai.com",
  "jackson@weprintwraps.com",
  "carley@restyleproai.com",
];

const navItems = [
  { path: '/affiliate/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/affiliate/sharing-kit', label: 'Sharing Kit', icon: Share2 },
  { path: '/affiliate/marketing', label: 'Marketing', icon: Image },
  { path: '/affiliate/settings', label: 'Settings', icon: Settings },
];

interface AffiliateLayoutProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
}

export function AffiliateLayout({ children, title, subtitle }: AffiliateLayoutProps) {
  const location = useLocation();
  const [isOperator, setIsOperator] = useState(false);
  const { data: profile } = useAffiliateProfile();
  const rep = profile ? getWpwRepByPartnerCode(profile.referral_code) : null;

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setIsOperator(OPERATOR_EMAILS.includes(data?.user?.email || ""));
    });
  }, []);

  // Derive page name from title or current path so heading always shows
  // "DesignProAI Affiliate <Page>" with branded styling.
  const pageName =
    title ||
    (location.pathname.includes("/marketing")
      ? "Marketing"
      : location.pathname.includes("/settings")
      ? "Settings"
      : "Dashboard");

  return (
    <div className="min-h-screen flex flex-col bg-[#f3f4f6] light text-gray-900">
      <div className="flex-1 flex flex-col">
        {/* ── BRAND BAR — high-contrast dark strip ─────────────────── */}
        <div className="bg-[#05050A] border-b border-[#38BDF8]/30 px-3 py-2.5 flex items-center justify-between shadow-[0_2px_12px_rgba(56,189,248,0.08)]">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-bold tracking-[1.5px] text-[#38BDF8]">
              DesignProAI&trade;
            </span>
            <span className="text-[11px] text-white/30">&rarr;</span>
            <span className="text-[11px] font-semibold text-white/70">
              MightyAffiliate&trade;
            </span>
          </div>
          <span className="hidden sm:inline text-[10px] uppercase tracking-[0.2em] text-white/40">
            Partner Portal
          </span>
        </div>

        {/* ── PERSISTENT SHARE STRIP — visible on every affiliate page
            for known reps. Surfaces their share URL + coupon with
            one-tap copy + a CTA to the full Sharing Kit. Hidden on
            the kit page itself to avoid duplication. */}
        {rep && location.pathname !== "/affiliate/sharing-kit" && (
          <RepShareStrip rep={rep} />
        )}

        {/* ── WHITE HERO BLOCK — branded heading + nav ─────────────── */}
        <div className="bg-white border-b border-gray-200 shadow-sm">
          {/* Heading */}
          <div className="container mx-auto px-4 pt-6 pb-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#0A0A0F] to-[#1a1a24] flex items-center justify-center shrink-0 shadow-md ring-1 ring-[#38BDF8]/40">
              <Handshake className="w-6 h-6 text-[#38BDF8]" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-extrabold leading-none flex items-baseline gap-1.5 flex-wrap">
                <span className="text-gray-900">DesignProAI</span>
                <span className="text-gray-900">Affiliate</span>
                <span className="bg-gradient-to-r from-[#0284C7] via-[#38BDF8] to-[#0284C7] bg-clip-text text-transparent">
                  {pageName}
                </span>
                <span className="text-gray-400 text-base font-medium">&trade;</span>
              </h1>
              {subtitle && (
                <p className="text-sm text-gray-600 mt-1.5 font-medium">{subtitle}</p>
              )}
            </div>
          </div>

          {/* Nav Tabs — connected to the heading, no extra border between */}
          <div className="container mx-auto px-4">
            <nav className="flex items-center gap-1 overflow-x-auto pt-1 pb-2 border-t border-gray-100">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap",
                      isActive
                        ? "bg-[#0A0A0F] text-[#38BDF8] shadow-sm"
                        : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
              {isOperator && (
                <>
                  <div className="w-px h-6 bg-gray-200 mx-1" />
                  <Link
                    to="/admin"
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap",
                      "text-[#0284C7] hover:text-[#0369A1] hover:bg-[#38BDF8]/10"
                    )}
                  >
                    <ShieldCheck className="h-4 w-4" />
                    Admin
                  </Link>
                  <Link
                    to="/admin/operator-onboarding"
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap",
                      location.pathname === "/admin/operator-onboarding"
                        ? "bg-[#0A0A0F] text-[#38BDF8] shadow-sm"
                        : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                    )}
                  >
                    <ShieldCheck className="h-4 w-4" />
                    System &amp; Stripe
                  </Link>
                </>
              )}
            </nav>
          </div>
        </div>

        {/* Page Content */}
        <main className="flex-1 container mx-auto px-4 py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

/**
 * RepShareStrip — one-line persistent reminder of the rep's share URL
 * and coupon, surfaced at the top of every affiliate page (except the
 * Sharing Kit itself). The whole point: even when a rep is on Settings
 * or Marketing, they can still copy their link in one tap without
 * navigating away.
 */
function RepShareStrip({ rep }: { rep: ReturnType<typeof getWpwRepByPartnerCode> }) {
  const [copiedField, setCopiedField] = useState<"link" | "code" | null>(null);
  if (!rep) return null;

  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://designproai.com";
  const shareUrl = `${origin}/wpw/${rep.slug}`;
  const headshot = defaultHeadshotPath(rep);

  const copy = async (text: string, field: "link" | "code") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      toast.success(`${field === "link" ? "Link" : "Code"} copied`);
      setTimeout(() => setCopiedField(null), 1800);
    } catch {
      toast.error("Couldn't copy — select it manually");
    }
  };

  return (
    <div
      className="border-b border-gray-200 bg-white"
      style={{
        borderTop: `2px solid ${rep.accent}`,
      }}
    >
      <div className="container mx-auto px-4 py-2 flex items-center gap-3 overflow-x-auto">
        <img
          src={headshot}
          alt={rep.name}
          className="w-7 h-7 rounded-full object-cover shrink-0"
          style={{ border: `2px solid ${rep.accent}` }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
          }}
        />
        <span className="text-[11px] uppercase tracking-[0.18em] font-bold shrink-0"
          style={{ color: rep.accent }}
        >
          {rep.name}
        </span>

        {/* Link */}
        <button
          type="button"
          onClick={() => copy(shareUrl, "link")}
          className="inline-flex items-center gap-1.5 text-[12px] text-gray-700 hover:text-gray-900 transition shrink-0"
          aria-label="Copy share link"
        >
          <span className="text-gray-400">Link:</span>
          <code className="font-mono">{shareUrl.replace(/^https?:\/\//, "")}</code>
          {copiedField === "link" ? (
            <Check className="w-3.5 h-3.5 text-emerald-500" />
          ) : (
            <Copy className="w-3.5 h-3.5 opacity-50" />
          )}
        </button>

        <span className="text-gray-200">·</span>

        {/* Coupon */}
        <button
          type="button"
          onClick={() => copy(rep.coupon, "code")}
          className="inline-flex items-center gap-1.5 text-[12px] shrink-0"
          aria-label="Copy coupon code"
        >
          <span className="text-gray-400">Code:</span>
          <code
            className="font-mono font-bold tracking-wider"
            style={{ color: rep.accent }}
          >
            {rep.coupon}
          </code>
          {copiedField === "code" ? (
            <Check className="w-3.5 h-3.5 text-emerald-500" />
          ) : (
            <Copy className="w-3.5 h-3.5 opacity-50" />
          )}
        </button>

        <span className="ml-auto shrink-0">
          <Link
            to="/affiliate/sharing-kit"
            className="inline-flex items-center gap-1 text-[12px] font-semibold hover:underline"
            style={{ color: rep.accent }}
          >
            Sharing Kit
            <ArrowRight className="w-3 h-3" />
          </Link>
        </span>
      </div>
    </div>
  );
}
