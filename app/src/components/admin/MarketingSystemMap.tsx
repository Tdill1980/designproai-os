/**
 * MarketingSystemMap — the one-glance answer to "which page do I start on?"
 *
 * Mounted at the TOP of Content Director, the Marketing Hub, and Brand
 * Board. Collapsed: a single sentence saying what THIS page is for.
 * Expanded: the whole system flow, the same explanation on every page so
 * the team learns one mental model (owner 2026-08-03: "Content Director
 * first or Marketing Hub??? I am confused" — this answers it in-product).
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type PageKey = "director" | "hub" | "script" | "brandboard";

const PAGE_LINE: Record<PageKey, string> = {
  director: "START HERE every day — this is the decision desk. Everything lands here as a draft; Approve = it publishes itself.",
  hub: "This is the WORKSHOP — where content gets made or fixed. Approvals do NOT happen here; they happen on Content Director.",
  script: "This is the SCRIPT ROOM — turn footage into the script for an episode. Scripts flow to Content Director for approval.",
  brandboard: "This is the GALLERY — review everything a brand has, open a card to edit or approve it.",
};

const SURFACES: { key: PageKey; label: string; to: string; role: string }[] = [
  { key: "director", label: "1 · Content Director", to: "/admin/content-director", role: "The decision desk. Every draft waits here for a human yes/no. Approve = scheduled = published, automatically. The Shot List tab (filming days) lives here too. Start every day on this page." },
  { key: "hub", label: "2 · Engine Room (Marketing Hub)", to: "/engine-room", role: "The workshop. Video Studio, Cut Editor, Asset Library, Content Studio, Composer, Script Studio. Go here only when something needs to be MADE or FIXED — a card's \"Refine in Engine Room\" button drops you at the right tool." },
  { key: "script", label: "3 · Script Studio", to: "/admin/script-studio", role: "The script room. Footage is the truth: parse it, then write the episode script against the brand's pillars and hooks. Ideas and scripts group by SHOW, so you can see what each WrapTVWorld show already has and what it still needs." },
  { key: "brandboard", label: "4 · Brand Board", to: "/admin/brand-board", role: "The gallery. Everything a brand has — videos, posts, emails, blogs — in one color-coded view. Best for reviewing a whole brand's body of work (e.g. the WrapTVWorld music videos)." },
];

export default function MarketingSystemMap({ page }: { page: PageKey }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
      >
        <HelpCircle className="h-4 w-4 shrink-0 text-blue-600" />
        <span className="flex-1 text-[13px] font-bold text-gray-900">{PAGE_LINE[page]}</span>
        <span className="shrink-0 text-[11px] font-semibold text-blue-600">Learn more</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-gray-400 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t border-gray-100 px-4 py-3">
          <div className="mb-2 rounded-lg bg-gradient-to-r from-[#3b82f6]/10 to-[#ec4899]/10 px-3 py-2 text-[13px] font-bold text-gray-900">
            The whole system, one direction: the Hub MAKES it → Content Director APPROVES it → it PUBLISHES itself on the calendar. Nothing goes out without a human Approve.
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {SURFACES.map((s) => (
              <div key={s.key} className={cn("rounded-lg border p-2.5", s.key === page ? "border-blue-300 bg-blue-50/50" : "border-gray-200 bg-white")}>
                <Link to={s.to} className="text-[12px] font-extrabold text-blue-700 hover:underline">{s.label}{s.key === page ? " (you are here)" : ""}</Link>
                <p className="mt-1 text-[12px] leading-snug text-gray-600">{s.role}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[12px] text-gray-500">
            Daily loop: open <b>Content Director</b> → approve / reject / fix every card in "Waiting on you" → check <b>Brand Board</b> for new finished videos → only enter the <b>Hub</b> when a piece needs hands-on work. On shoot days, work the <b>Shot List</b> tab.
          </p>
        </div>
      )}
    </div>
  );
}
