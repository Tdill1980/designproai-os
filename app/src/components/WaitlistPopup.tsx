import { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

// No fallback image — if no slides uploaded, show gradient placeholder

// Routes where the signup pitch is redundant — the visitor is already there.
const AUTH_ROUTES = ["/login", "/signup", "/reset-password"];

export const WaitlistPopup = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);
  // null = auth state not resolved yet; the popup only shows once we KNOW the
  // visitor is logged out — signed-in users (including admins mid-build on
  // internal pages) must never see the "Create Free Account" pitch.
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setIsLoggedIn(!!data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) setIsLoggedIn(!!session);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // If the visitor signs in while the popup is open (or was queued), drop it.
  useEffect(() => {
    if (isLoggedIn) setIsOpen(false);
  }, [isLoggedIn]);

  // ── Fetch admin-managed carousel slides ──
  const { data: slides } = useQuery({
    queryKey: ["promo-popup-slides"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("homepage_showcase")
        .select("*")
        .like("name", "popup:slide%")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error || !data || data.length === 0) return null;
      return data;
    },
    enabled: isOpen,
    staleTime: 5 * 60 * 1000,
  });

  // ── Fetch admin-managed messaging ──
  const { data: popupConfig } = useQuery({
    queryKey: ["promo-popup-config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("homepage_showcase")
        .select("title, alt_text")
        .eq("name", "popup:config")
        .maybeSingle();
      if (error) return null;
      return data;
    },
    enabled: isOpen,
    staleTime: 5 * 60 * 1000,
  });

  const activeSlides = slides ?? [];
  const hasMultipleSlides = activeSlides.length > 1;

  // Auto-rotate carousel
  useEffect(() => {
    if (!hasMultipleSlides || !isOpen) return;
    const interval = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % activeSlides.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [hasMultipleSlides, activeSlides.length, isOpen]);

  const goNext = useCallback(() => {
    if (activeSlides.length > 0) setCurrentSlide((p) => (p + 1) % activeSlides.length);
  }, [activeSlides.length]);

  const goPrev = useCallback(() => {
    if (activeSlides.length > 0) setCurrentSlide((p) => (p - 1 + activeSlides.length) % activeSlides.length);
  }, [activeSlides.length]);

  // Only show popup if admin has uploaded at least one slide
  // Fetch slide count to decide whether to show
  const { data: slideCount } = useQuery({
    queryKey: ["promo-popup-has-slides"],
    enabled: isLoggedIn === false, // don't even query for signed-in users
    queryFn: async () => {
      const { count, error } = await supabase
        .from("homepage_showcase")
        .select("id", { count: "exact", head: true })
        .like("name", "popup:slide%")
        .eq("is_active", true);
      if (error) return 0;
      return count || 0;
    },
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (isLoggedIn !== false) return; // Only prospects — never signed-in users
    if (AUTH_ROUTES.some((r) => location.pathname.startsWith(r))) return;
    if (!slideCount || slideCount === 0) return; // No slides uploaded — don't show popup
    const dismissed = sessionStorage.getItem("promo_popup_dismissed");
    if (dismissed) return;
    const timer = setTimeout(() => {
      setIsOpen(true);
    }, 5000);
    return () => clearTimeout(timer);
  }, [slideCount, isLoggedIn, location.pathname]);

  const handleDismiss = () => {
    setIsOpen(false);
    sessionStorage.setItem("promo_popup_dismissed", "true");
  };

  // Resolve current image — no fallback, show gradient if no slides
  const hasSlides = activeSlides.length > 0;
  const currentImage = hasSlides
    ? activeSlides[currentSlide % activeSlides.length]?.image_url
    : null;
  const currentSlideTitle = hasSlides
    ? activeSlides[currentSlide % activeSlides.length]?.title
    : "";

  const headline = popupConfig?.title || "RestyleProAI Wrap Visualizer";
  const body = popupConfig?.alt_text || "Design it. Panel it. Print it.";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleDismiss(); }}>
      <DialogContent
        className="w-[360px] max-w-[92vw] p-0 border-0 bg-transparent shadow-none overflow-visible gap-0"
        overlayClassName="bg-black/80"
      >
        <div className="w-[360px] max-w-[92vw] mx-auto bg-neutral-950 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden relative">
        {/* Close button */}
        <button
          onClick={handleDismiss}
          className="absolute top-3 right-3 z-20 w-8 h-8 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center text-white/70 hover:text-white hover:bg-black/80 transition-all"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Carousel */}
        <div className="relative w-full h-[180px] overflow-hidden">
          {currentImage ? (
            <img
              key={currentSlide}
              src={currentImage}
              alt={currentSlideTitle || "RestyleProAI"}
              className="w-full h-[180px] object-cover animate-in fade-in duration-500"
            />
          ) : (
            <div className="w-full h-[180px] bg-gradient-to-br from-cyan-600 via-blue-700 to-purple-800 flex items-center justify-center">
              <span className="text-4xl font-black text-white/20 tracking-tight">RestyleProAI</span>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-transparent to-transparent" />

          {/* Nav arrows */}
          {hasMultipleSlides && (
            <>
              <button
                onClick={goPrev}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white/70 hover:text-white transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={goNext}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white/70 hover:text-white transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </>
          )}

          {/* Dot indicators */}
          {hasMultipleSlides && (
            <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">
              {activeSlides.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentSlide(i)}
                  className={`w-2 h-2 rounded-full transition-all ${
                    i === currentSlide % activeSlides.length
                      ? "bg-cyan-400 w-4"
                      : "bg-white/30 hover:bg-white/50"
                  }`}
                />
              ))}
            </div>
          )}

          {/* Slide label */}
          {currentSlideTitle && (
            <div className="absolute bottom-6 left-0 right-0">
              <p className="text-[10px] font-bold tracking-[0.2em] text-cyan-400 uppercase text-center">
                {currentSlideTitle}
              </p>
            </div>
          )}
        </div>

        {/* Copy section */}
        <div className="px-6 pb-6 pt-2 text-center space-y-3">
          <h2 className="text-lg font-black text-white leading-tight tracking-tight">
            {headline}
          </h2>
          <p className="text-sm text-neutral-400 leading-relaxed whitespace-pre-line">
            {body}
          </p>

          <Button
            onClick={() => {
              handleDismiss();
              navigate("/signup");
            }}
            className="w-full h-11 text-sm font-bold bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white rounded-xl shadow-lg shadow-cyan-500/20 transition-all hover:shadow-cyan-500/30 hover:scale-[1.01] active:scale-[0.99]"
          >
            Create Free Account
          </Button>
          <button
            onClick={handleDismiss}
            className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            Maybe later
          </button>
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
