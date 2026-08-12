import { Link, useLocation } from "react-router-dom";
import { Rotate3D, Sparkles, Scissors, ChevronDown, Calculator } from "lucide-react";
import { useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useIsAppRoute } from "@/hooks/useIsAppRoute";

const FooterSection = ({
  title,
  children,
  isMobile,
}: {
  title: string;
  children: React.ReactNode;
  isMobile: boolean;
}) => {
  const [open, setOpen] = useState(false);

  if (!isMobile) {
    return (
      <div>
        <h4 className="font-semibold mb-4 text-white/90">{title}</h4>
        {children}
      </div>
    );
  }

  return (
    <div className="border-b border-white/10 last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-3 text-left"
      >
        <h4 className="font-semibold text-white/90 text-sm">{title}</h4>
        <ChevronDown
          className={`w-4 h-4 text-white/50 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div
        className={`overflow-hidden transition-all duration-200 ${open ? "max-h-96 pb-3" : "max-h-0"}`}
      >
        {children}
      </div>
    </div>
  );
};

export const Footer = () => {
  const location = useLocation();
  const isMobile = useIsMobile();
  const isAppRoute = useIsAppRoute();

  // Footer is persistent on every route (marketing + app). isAppRoute kept
  // imported so future variants can swap link groups without touching the shell.
  void isAppRoute;

  return (
    <footer className="border-t border-[#1c1c1e] mt-8 sm:mt-20 bg-[#0a0a0a]">
      <div className="container mx-auto px-4 sm:px-6 py-6 sm:py-12">
        {/* Brand - always visible */}
        <div className={isMobile ? "mb-4" : "mb-0"}>
          <h3 className="text-lg font-bold mb-1 sm:mb-4">
            <span className="text-white">Restyle</span>
            <span className="text-gradient-blue-subtle">ProAI™</span>
          </h3>
          <p className="text-sm text-white/60">
            Design. Output. Profit.
          </p>
        </div>

        {/* Link sections - collapsible on mobile, grid on desktop */}
        <div className={isMobile ? "mt-4" : "grid grid-cols-4 gap-8 mt-8"}>
          {/* Brand spacer on desktop */}
          {!isMobile && <div />}

          <FooterSection title="Design Tools" isMobile={isMobile}>
            <ul className="space-y-2">
              <li>
                <Link
                  to="/graphics-pro"
                  className={`text-sm inline-flex items-center gap-1.5 group rounded-full px-3 py-1 transition-colors ${
                    location.pathname.startsWith("/graphics-pro")
                      ? "text-foreground bg-card/60"
                      : "text-white/70 hover:text-white"
                  }`}
                >
                  <Scissors className="w-3 h-3 text-cyan-400 transition-transform duration-500 group-hover:scale-110" />
                  <span className="ml-1"><span className="text-foreground">Graphics</span><span className="text-gradient-blue-subtle">Pro™</span></span>
                </Link>
              </li>
              <li>
                <Link
                  to="/colorpro"
                  className={`text-sm inline-flex items-center gap-1.5 group rounded-full px-3 py-1 transition-colors ${
                    location.pathname.startsWith("/colorpro")
                      ? "text-foreground bg-card/60"
                      : "text-white/70 hover:text-white"
                  }`}
                >
                  <Rotate3D className="w-3 h-3 text-muted-foreground transition-transform duration-500 group-hover:animate-[rotate-360_0.6s_ease-in-out]" />
                  <span className="ml-1"><span className="text-foreground">Color</span><span className="text-gradient-blue-subtle">Pro™</span></span>
                </Link>
              </li>
              <li>
                <Link
                  to="/restylelibrary"
                  className={`text-sm inline-flex items-center gap-1.5 group rounded-full px-3 py-1 transition-colors ${
                    location.pathname.startsWith("/restylelibrary")
                      ? "text-foreground bg-card/60"
                      : "text-white/70 hover:text-white"
                  }`}
                >
                  <Rotate3D className="w-3 h-3 text-muted-foreground transition-transform duration-500 group-hover:animate-[rotate-360_0.6s_ease-in-out]" />
                  <span className="ml-1"><span className="text-foreground">Restyle</span><span className="text-gradient-blue-subtle">Library™</span></span>
                </Link>
              </li>
              <li>
                <Link
                  to="/wbty"
                  className={`text-sm inline-flex items-center gap-1.5 group rounded-full px-3 py-1 transition-colors ${
                    location.pathname.startsWith("/wbty")
                      ? "text-foreground bg-card/60"
                      : "text-white/70 hover:text-white"
                  }`}
                >
                  <Rotate3D className="w-3 h-3 text-muted-foreground transition-transform duration-500 group-hover:animate-[rotate-360_0.6s_ease-in-out]" />
                  <span className="ml-1"><span className="text-foreground">Pattern</span><span className="text-gradient-blue-subtle">Pro™</span></span>
                </Link>
              </li>
              <li>
                <Link
                  to="/approvemode"
                  className={`text-sm inline-flex items-center gap-1.5 group rounded-full px-3 py-1 transition-colors ${
                    location.pathname.startsWith("/approvemode")
                      ? "text-foreground bg-card/60"
                      : "text-white/70 hover:text-white"
                  }`}
                >
                  <Rotate3D className="w-3 h-3 text-muted-foreground transition-transform duration-500 group-hover:animate-[rotate-360_0.6s_ease-in-out]" />
                  <span className="ml-1"><span className="text-foreground">Approve</span><span className="text-gradient-blue-subtle">Pro™</span></span>
                </Link>
              </li>
              <li>
                <Link
                  to="/revision-studio"
                  className={`text-sm inline-flex items-center gap-1.5 group rounded-full px-3 py-1 transition-colors ${
                    location.pathname.startsWith("/revision-studio")
                      ? "text-foreground bg-card/60"
                      : "text-white/70 hover:text-white"
                  }`}
                >
                  <Sparkles className="w-3 h-3 text-muted-foreground transition-transform duration-500 group-hover:scale-110" />
                  <span className="ml-1"><span className="text-foreground">Revision</span><span className="text-gradient-blue-subtle">StudioIQ™</span></span>
                </Link>
              </li>
              <li>
                <Link
                  to="/productionflow?tab=prep"
                  className={`text-sm inline-flex items-center gap-1.5 group rounded-full px-3 py-1 transition-colors ${
                    location.pathname.startsWith("/productionflow")
                      ? "text-foreground bg-card/60"
                      : "text-white/70 hover:text-white"
                  }`}
                >
                  <Sparkles className="w-3 h-3 text-muted-foreground transition-transform duration-500 group-hover:scale-110" />
                  <span className="ml-1"><span className="text-foreground">Production</span><span className="text-gradient-blue-subtle">Flow™</span></span>
                </Link>
              </li>
              <li>
                <Link
                  to="/quick-quote"
                  className={`text-sm inline-flex items-center gap-1.5 group rounded-full px-3 py-1 transition-colors ${
                    location.pathname.startsWith("/quick-quote")
                      ? "text-foreground bg-card/60"
                      : "text-white/70 hover:text-white"
                  }`}
                >
                  <Calculator className="w-3 h-3 text-emerald-400 transition-transform duration-500 group-hover:scale-110" />
                  <span className="ml-1"><span className="text-foreground">Quick</span><span className="text-gradient-blue-subtle">Quote™</span></span>
                </Link>
              </li>
            </ul>
          </FooterSection>

          <FooterSection title="Print Products" isMobile={isMobile}>
            <ul className="space-y-2">
              <li>
                <Link to="/printpro/wbty" className="text-sm transition-colors inline-flex text-white/70 hover:text-white">
                  <span>Pattern</span><span className="text-gradient-blue-subtle">Pro™</span>
                </Link>
              </li>
              <li>
                <Link to="/printpro/fadewrap" className="text-sm transition-colors inline-flex text-white/70 hover:text-white">
                  <span>Fade</span><span className="text-gradient-blue-subtle">Wrap™</span>
                </Link>
              </li>
              <li><Link to="/printpro/design-packs" className="text-sm text-white/70 hover:text-white transition-colors">Design Packs</Link></li>
              <li><Link to="/printpro/custom-upload" className="text-sm text-white/70 hover:text-white transition-colors">Custom Prints</Link></li>
            </ul>
          </FooterSection>

          <FooterSection title="Company" isMobile={isMobile}>
            <ul className="space-y-2">
              <li>
                <Link to="/fleet" className="text-sm text-white/70 hover:text-white transition-colors font-medium">
                  Fleet Services
                </Link>
              </li>
              <li>
                <Link to="/faq" className="text-sm text-white/70 hover:text-white transition-colors">
                  FAQ
                </Link>
              </li>
              <li><a href="#" className="text-sm text-white/70 hover:text-white transition-colors">About</a></li>
              <li><a href="#" className="text-sm text-white/70 hover:text-white transition-colors">Contact</a></li>
              <li><a href="#" className="text-sm text-white/70 hover:text-white transition-colors">Support</a></li>
              {/* The affiliate program's remaining front door. The other ten
                  affiliate nav entries were hidden 2026-08-04 (17 partners,
                  idle since May) — but existing affiliates still need a way
                  to sign in that isn't a remembered URL. */}
              <li>
                <Link to="/affiliate/login" className="text-sm text-white/70 hover:text-white transition-colors">
                  Affiliate Login
                </Link>
              </li>
            </ul>
          </FooterSection>
        </div>

        <div className="border-t border-white/10 mt-6 sm:mt-8 pt-6 sm:pt-8 text-center text-sm text-white/40">
          <p>&copy; 2026 ProductionFlow™. All Rights Reserved.</p>
        </div>
      </div>
    </footer>
  );
};
