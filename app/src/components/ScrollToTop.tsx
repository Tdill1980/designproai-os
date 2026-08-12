import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export const ScrollToTop = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    const scrollTop = () => window.scrollTo({ top: 0, left: 0, behavior: 'instant' });

    // Immediate scroll
    scrollTop();
    // After next paint - catches early layout shifts
    requestAnimationFrame(scrollTop);
    // After Suspense lazy chunks resolve and mount (~50-150ms typical)
    const t1 = setTimeout(scrollTop, 50);
    const t2 = setTimeout(scrollTop, 150);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [pathname]);

  return null;
};
