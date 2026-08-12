import { lazy, Suspense } from "react";
import { Helmet } from "react-helmet-async";

/**
 * RestyleDashboard — thin shell that lazy-loads the actual content.
 *
 * The dashboard content file imports supabase client, hooks, recharts,
 * Radix UI, and 13 card components. When bundled together statically,
 * Vite's chunk initialization order causes TDZ "Cannot access before
 * initialization" errors. Lazy-loading the ENTIRE content as one unit
 * ensures all those modules initialize together in their own chunk
 * without cross-chunk circular dependencies.
 */
const Content = lazy(() => import("./RestyleDashboardContent"));

const RestyleDashboard = () => {
  return (
    <>
      <Helmet>
        <title>ShopEngine — RestylePro</title>
        <meta
          name="description"
          content="Design. Output. Profit. — RestylePro's unified wrap operating system."
        />
      </Helmet>

      <Suspense
        fallback={
          <div className="w-full max-w-[1400px] mx-auto px-3 sm:px-6 py-12 flex items-center justify-center min-h-[60vh]">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <div className="text-white/50 text-sm">Loading ShopEngine...</div>
            </div>
          </div>
        }
      >
        <Content />
      </Suspense>
    </>
  );
};

export default RestyleDashboard;
