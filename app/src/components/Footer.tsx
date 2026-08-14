import { Link, useLocation } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useIsAppRoute } from "@/hooks/useIsAppRoute";
import { NAV_GROUPS } from "@/lib/dashboard-nav";

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
            <span className="text-white">Design</span>
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

          {/* Built from the same navigation registry the sidebar and top nav
              read. The hand-written Design Tools and Print Products columns
              this replaced pointed at RestylePro surfaces this system does not
              serve, so every one of those footer links reached the 404 page. */}
          {NAV_GROUPS.filter((group) => group.items.length > 0).map((group) => (
            <FooterSection key={group.id} title={group.label} isMobile={isMobile}>
              <ul className="space-y-2">
                {group.items.map((item) => {
                  const route = item.type === "tool" ? item.tool.route : item.route;
                  const label = item.type === "tool" ? item.tool.label : item.label;
                  return (
                    <li key={route}>
                      <Link
                        to={route}
                        className={`text-sm inline-flex items-center gap-1.5 rounded-full px-3 py-1 transition-colors ${
                          location.pathname.startsWith(route)
                            ? "text-foreground bg-card/60"
                            : "text-white/70 hover:text-white"
                        }`}
                      >
                        {label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </FooterSection>
          ))}
        </div>

        <div className="border-t border-white/10 mt-6 sm:mt-8 pt-6 sm:pt-8 text-center text-sm text-white/40">
          <p>&copy; 2026 DesignProAI™. All Rights Reserved.</p>
        </div>
      </div>
    </footer>
  );
};
