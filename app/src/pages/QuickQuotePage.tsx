/**
 * DesignProAI QuickQuote — standalone quote-builder page.
 *
 * Renders the exact same QuickQuoteCard + LatestQuotesCard pair the
 * dashboard shows, so the standalone /quick-quote page is identical
 * to the dashboard QuickQuote tool.
 *
 * Tools (FadeWraps, DesignPro, ColorPro, …) hand the user off here via
 * `navigate("/quick-quote", { state: <QuickQuoteCardInitial> })` after
 * a render. We forward that state into QuickQuoteCard so the vehicle,
 * design name, finish, render, and any preselected line items land in
 * the quote without the operator re-entering them.
 */

import { Helmet } from "react-helmet-async";
import { useLocation } from "react-router-dom";

import {
  QuickQuoteCard,
  type QuickQuoteCardInitial,
} from "@/components/dashboard/QuickQuoteCard";
import { LatestQuotesCard } from "@/components/dashboard/LatestQuotesCard";

const QuickQuotePage = () => {
  const location = useLocation();
  const initial = (location.state as QuickQuoteCardInitial | null) ?? undefined;

  return (
    <div className="min-h-screen flex flex-col bg-black">
      <Helmet>
        <title>QuickQuote — DesignProAI</title>
        <meta name="description" content="Build a wrap quote in seconds — vehicle-aware, render-aware, customer-ready." />
      </Helmet>

      <main className="flex-1">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
            <div>
              <QuickQuoteCard initial={initial} />
            </div>
            <aside className="space-y-4">
              <LatestQuotesCard />
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
};

export default QuickQuotePage;
