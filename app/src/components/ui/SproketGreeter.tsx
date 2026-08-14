import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { X } from "lucide-react";
import { PAGE_GREETINGS, SPROKET_STORAGE } from "@/lib/sproket-config";

/**
 * LAYER 1 — Page Greeter
 * UFO entrance animation on first visit per page.
 * Dismisses after 6s or on click. Remembers per-page dismissal.
 */
export const SproketGreeter = () => {
  const { pathname } = useLocation();
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  const greeting = PAGE_GREETINGS[pathname];

  useEffect(() => {
    // Reset state on page change
    setVisible(false);
    setExiting(false);

    if (!greeting) return;

    // Check if already dismissed for this page
    try {
      const dismissed = JSON.parse(
        localStorage.getItem(SPROKET_STORAGE.GREETER_DISMISSED) || "{}"
      );
      if (dismissed[pathname]) return;
    } catch {}

    // Show after page settles (longer delay prevents "flash" feeling)
    const showTimer = setTimeout(() => setVisible(true), 1200);

    // Auto-dismiss after 5s
    const hideTimer = setTimeout(() => {
      setExiting(true);
      setTimeout(() => {
        setVisible(false);
        setExiting(false);
        try {
          const dismissed = JSON.parse(
            localStorage.getItem(SPROKET_STORAGE.GREETER_DISMISSED) || "{}"
          );
          dismissed[pathname] = true;
          localStorage.setItem(
            SPROKET_STORAGE.GREETER_DISMISSED,
            JSON.stringify(dismissed)
          );
        } catch {}
      }, 400);
    }, 6200);

    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
    };
  }, [pathname, greeting]);

  const dismiss = () => {
    setExiting(true);
    setTimeout(() => {
      setVisible(false);
      setExiting(false);
      // Mark dismissed
      try {
        const dismissed = JSON.parse(
          localStorage.getItem(SPROKET_STORAGE.GREETER_DISMISSED) || "{}"
        );
        dismissed[pathname] = true;
        localStorage.setItem(
          SPROKET_STORAGE.GREETER_DISMISSED,
          JSON.stringify(dismissed)
        );
      } catch {}
    }, 400);
  };

  if (!visible || !greeting) return null;

  return (
    <div
      className={`fixed top-16 sm:top-20 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 sm:gap-3
        bg-card/95 backdrop-blur-md border border-blue-500/30 rounded-2xl
        px-3 py-2 sm:px-5 sm:py-4 shadow-lg shadow-blue-500/10 max-w-[280px] sm:max-w-md w-auto
        ${exiting ? "opacity-0 translate-y-[-20px] transition-all duration-400" : "animate-sproket-ufo-enter"}`}
    >
      <img
        src={greeting.image}
        alt="SPROKET"
        className="w-8 h-8 sm:w-14 sm:h-14 object-contain animate-sproket-bob shrink-0"
      />
      <div className="flex-1 min-w-0">
        <p className="text-xs sm:text-sm font-semibold text-foreground font-poppins truncate">
          {greeting.headline}
        </p>
        <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">
          {greeting.subtext}
        </p>
      </div>
      <button
        onClick={dismiss}
        className="shrink-0 p-1 rounded-full hover:bg-secondary/80 transition-colors text-muted-foreground hover:text-foreground"
        aria-label="Dismiss SPROKET"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
