import { ArrowUpRight, Store } from "lucide-react";
import { WPW_SHOPFLOW_URL } from "@/lib/dashboard-nav";

/** Same-tab navigation preserves normal WPW sign-in; never passes auth in a URL. */
export function WpwShopflowNavLink({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <a href={WPW_SHOPFLOW_URL} onClick={onNavigate}
      className="flex min-h-[72px] w-full shrink-0 items-center gap-3 rounded-xl border border-sky-400/50 bg-gradient-to-r from-sky-600 to-blue-700 px-4 py-3 text-white shadow-lg transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-300"
      aria-label="Open WPW ShopFlow dashboard">
      <Store className="h-6 w-6 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-bold leading-tight">WPW ShopFlow</span>
        <span className="mt-1 block text-xs leading-snug text-white/90">Quotes, orders &amp; design tools</span>
      </span>
      <ArrowUpRight className="h-5 w-5 shrink-0" aria-hidden="true" />
    </a>
  );
}
