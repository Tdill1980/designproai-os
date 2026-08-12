import { useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { X, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PAGE_TIPS,
  PAGE_FAQ,
  PAGE_GREETINGS,
  PAGE_POSE_POOLS,
  GLOBAL_FAQ,
  SPROKET_STORAGE,
} from "@/lib/sproket-config";

/**
 * LAYER 2 — Persistent Hover Helper
 * Bottom-right avatar: hover shows tip bubble, click opens FAQ slide-out panel.
 * Header pulls from PAGE_GREETINGS so each page gets its own SPROKET pose +
 * headline + subtext. FAQ content is page-specific with SPROKET's dry-wit voice.
 */
export const SproketHelper = () => {
  const { pathname } = useLocation();
  const [showTip, setShowTip] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [tipIndex, setTipIndex] = useState(0);
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const tipTimeout = useRef<ReturnType<typeof setTimeout>>();

  const tips = PAGE_TIPS[pathname] || PAGE_TIPS["/"] || [];
  const faqItems = PAGE_FAQ[pathname] || GLOBAL_FAQ;
  const greeting = PAGE_GREETINGS[pathname] || PAGE_GREETINGS["/"];
  const posePool = PAGE_POSE_POOLS[pathname] || [];

  // Rotate through the page's pose pool so SPROKET feels alive instead of
  // showing the same image every time. Picks a fresh pose each time the
  // panel opens, never repeating the previous one if the pool has > 1 entry.
  const [poseIndex, setPoseIndex] = useState(() =>
    posePool.length > 0 ? Math.floor(Math.random() * posePool.length) : 0
  );
  const currentPose = posePool.length > 0
    ? posePool[poseIndex % posePool.length]
    : (greeting?.image || "/characters/sproket/sproket-tips.png");

  // Rotate tips on hover
  useEffect(() => {
    if (!showTip || tips.length <= 1) return;
    const interval = setInterval(() => {
      setTipIndex((prev) => (prev + 1) % tips.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [showTip, tips.length]);

  // Reset on page change
  useEffect(() => {
    setTipIndex(0);
    setPanelOpen(false);
    setExpandedFaq(null);
  }, [pathname]);

  // Listen for "open ground control" event from nav bar button
  useEffect(() => {
    const handler = () => {
      setPanelOpen(true);
      setShowTip(false);
    };
    window.addEventListener("sproket-open-panel", handler);
    return () => window.removeEventListener("sproket-open-panel", handler);
  }, []);

  const handleMouseEnter = () => {
    clearTimeout(tipTimeout.current);
    if (!panelOpen) setShowTip(true);
  };

  const handleMouseLeave = () => {
    tipTimeout.current = setTimeout(() => setShowTip(false), 300);
  };

  const togglePanel = () => {
    setPanelOpen((prev) => {
      const next = !prev;
      // Pick a fresh pose each time the panel opens. Never repeat the
      // previous pose if the pool has more than one entry.
      if (next && posePool.length > 1) {
        setPoseIndex((cur) => {
          let n = Math.floor(Math.random() * posePool.length);
          if (n === cur) n = (n + 1) % posePool.length;
          return n;
        });
      }
      return next;
    });
    setShowTip(false);
  };

  // Don't render on admin pages or on the app dashboard experience
  // (dashboard has its own navigation + the sproket overlaps tool cards).
  // Also hidden on /creatormarket so it doesn't fight the marketplace
  // chrome — that page wants a clean retail feel.
  if (pathname.startsWith("/admin")) return null;
  if (pathname.startsWith("/creatormarket")) return null;
  if (
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/") ||
    pathname.startsWith("/quotes") ||
    pathname.startsWith("/my-renders") ||
    pathname.startsWith("/my-designs")
  ) {
    return null;
  }

  return (
    <>
      {/* FAQ Slide-out Panel */}
      <div
        className={cn(
          "fixed bottom-[7.5rem] sm:bottom-20 left-3 right-3 md:right-auto md:w-80 z-[59] overflow-hidden rounded-xl",
          "transition-all duration-300 md:w-80",
          panelOpen
            ? "opacity-100 translate-y-0 pointer-events-auto"
            : "opacity-0 translate-y-4 pointer-events-none"
        )}
        style={{
          maxHeight: "60vh",
          backgroundColor: "#1a1a30",
          border: "0.5px solid #2a2a4a",
        }}
      >
        {/* Panel Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "0.5px solid #2a2a4a" }}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 sm:w-[60px] sm:h-[60px] max-w-[60px] max-h-[60px] shrink-0">
              <img
                src={currentPose}
                alt="SPROKET"
                width={60}
                height={60}
                className="w-full h-full object-contain"
              />
            </div>
            <div>
              <p
                className="text-base font-bold font-poppins"
                style={{ color: "#7F77DD" }}
              >
                {greeting?.headline || "Ground Control"}
              </p>
              <p className="text-xs" style={{ color: "#999" }}>
                {greeting?.subtext || "Ask SPROKET anything. He knows everything. Just ask him."}
              </p>
            </div>
          </div>
          <button
            onClick={() => setPanelOpen(false)}
            className="p-1.5 rounded-full transition-colors"
            style={{ color: "#666" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#666")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* FAQ List */}
        <div className="overflow-y-auto p-3 space-y-1.5" style={{ maxHeight: "calc(70vh - 100px)" }}>
          {faqItems.map((faq, i) => (
            <div
              key={i}
              className="rounded-lg overflow-hidden"
              style={{ border: "0.5px solid #2a2a4a" }}
            >
              <button
                onClick={() => setExpandedFaq(expandedFaq === i ? null : i)}
                className="w-full text-left px-3 py-2.5 flex items-center justify-between gap-2 transition-colors"
                style={{ backgroundColor: expandedFaq === i ? "#22223a" : "transparent" }}
                onMouseEnter={(e) => {
                  if (expandedFaq !== i) e.currentTarget.style.backgroundColor = "#1f1f35";
                }}
                onMouseLeave={(e) => {
                  if (expandedFaq !== i) e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                <span className="text-[13px] font-bold text-white leading-tight">
                  {faq.q}
                </span>
                <ChevronUp
                  className={cn(
                    "w-3.5 h-3.5 shrink-0 transition-transform duration-200",
                    expandedFaq === i ? "rotate-0" : "rotate-180"
                  )}
                  style={{ color: "#7F77DD" }}
                />
              </button>
              <div
                className={cn(
                  "overflow-hidden transition-all duration-200",
                  expandedFaq === i ? "max-h-60" : "max-h-0"
                )}
              >
                <p
                  className="px-3 pb-3 text-[13px] leading-relaxed"
                  style={{ color: "#999" }}
                >
                  {faq.a}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tip Bubble (hover only, not when panel is open) */}
      {showTip && tips.length > 0 && !panelOpen && (
        <div className="fixed bottom-[7.5rem] sm:bottom-20 left-4 z-[58] max-w-[200px] sm:max-w-[260px] animate-sproket-fade-up">
          <div
            className="rounded-xl px-3.5 py-2.5 shadow-lg"
            style={{
              backgroundColor: "#1a1a30",
              border: "0.5px solid #2a2a4a",
            }}
          >
            <p className="text-xs leading-relaxed" style={{ color: "#999" }}>
              {tips[tipIndex]}
            </p>
          </div>
          <div
            className="absolute -bottom-1.5 left-6 w-3 h-3 rotate-45"
            style={{
              backgroundColor: "#1a1a30",
              borderRight: "0.5px solid #2a2a4a",
              borderBottom: "0.5px solid #2a2a4a",
            }}
          />
        </div>
      )}

      {/* SPROKET Avatar Button */}
      <button
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={togglePanel}
        className={cn(
          "fixed bottom-[4.5rem] sm:bottom-3 left-3 z-[60] w-9 h-9 sm:w-12 sm:h-12 md:w-14 md:h-14 rounded-full",
          "bg-gradient-to-br from-blue-500/20 to-purple-500/20",
          "border-2 transition-all duration-300 hover:scale-110",
          "flex items-center justify-center shadow-lg",
          panelOpen
            ? "border-blue-400 shadow-blue-500/20"
            : "border-blue-500/30 shadow-blue-500/10 animate-sproket-bob"
        )}
        aria-label="SPROKET Help"
      >
        <img
          src="/characters/sproket/sproket-avatar.png"
          alt="SPROKET"
          className="w-6 h-6 sm:w-8 sm:h-8 md:w-10 md:h-10 object-contain"
        />
        {/* Notification dot */}
        <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-blue-400 border-2 border-background animate-pulse" />
      </button>
    </>
  );
};
