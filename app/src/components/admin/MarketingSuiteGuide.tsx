/**
 * MarketingSuiteGuide — the collapsible "how does this whole thing work?"
 * dropdown, shared by every marketing page.
 *
 * The suite is ~10 tools that only make sense as a sequence: fill the
 * libraries → make the content → approve it in the Director (which publishes
 * it) → see what shipped. Each page explained itself in isolation, so the
 * order was folklore. This puts the same map on every page, colour-matched to
 * the Engine Room's Quick Access buttons (one registry — src/lib/marketingSuite.ts)
 * so a chip in the guide is visibly the button you click.
 *
 * Collapsed by default: it's a reference, not a wall to scroll past. The page
 * you're on is marked "You are here" so the map orients you rather than just
 * listing links.
 */
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronDown, Compass } from "lucide-react";
import {
  SUITE_STAGES, toolsForStage, isCurrentTool, type SuiteTool,
} from "@/lib/marketingSuite";
import { cn } from "@/lib/utils";

function ToolChip({ tool, here }: { tool: SuiteTool; here: boolean }) {
  return (
    <Link
      to={tool.to}
      className={cn(
        "group flex items-start gap-2.5 rounded-lg border p-2.5 transition-shadow hover:shadow-sm",
        here ? "border-gray-900 bg-gray-50" : "border-gray-200 bg-white",
      )}
    >
      {/* The colour bar IS the wayfinding — same gradient as the Hub button. */}
      <span className={cn("mt-0.5 h-8 w-1.5 shrink-0 rounded-full bg-gradient-to-b", tool.gradient)} />
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] font-bold text-gray-900">{tool.label}</span>
          {here && (
            <span className="rounded-full bg-gray-900 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
              You are here
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-[11px] leading-snug text-gray-600">{tool.does}</span>
      </span>
    </Link>
  );
}

export default function MarketingSuiteGuide({
  defaultOpen = false,
}: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const { pathname } = useLocation();

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Compass className="h-5 w-5 shrink-0 text-blue-500" />
          <span className="text-sm font-bold text-gray-900">How to use the Marketing Suite</span>
          <span className="hidden truncate text-xs text-gray-400 sm:inline">
            Fill the libraries → make it → approve it (that publishes it) → see what shipped.
          </span>
        </span>
        <ChevronDown className={cn("h-5 w-5 shrink-0 text-gray-400 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="border-t border-gray-100 px-4 py-4">
          <p className="mb-4 max-w-3xl text-sm text-gray-700">
            Every tool below feeds <span className="font-semibold text-gray-900">one queue</span>. Whatever
            you make — a designed post, a video script, an email — lands in the{" "}
            <Link to="/admin/content-director" className="font-semibold text-blue-600 hover:underline">
              Content Director
            </Link>{" "}
            as a draft. Approving it there is the <span className="font-semibold">only</span> publish step,
            and nothing goes out without it.
          </p>

          {/* The two names people get lost between. */}
          <div className="mb-4 grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-gray-200 bg-gray-50/70 p-3">
              <p className="text-xs font-bold text-gray-900">
                The Engine Room <span className="font-normal text-gray-500">(a.k.a. the Marketing Hub)</span>
              </p>
              <p className="mt-1 text-[12px] leading-snug text-gray-700">
                <span className="font-semibold">Your home base — not a content tool.</span> It's the team's
                working surface: the task board, the content calendar, channels, blog, ideas, video and the
                Asset Library, plus Quick Access to every tool on this page. Start your day here; make the
                actual content in the tools below.
              </p>
              <p className="mt-1.5 text-[11px] text-gray-500">
                <Link to="/engine-room" className="font-semibold text-blue-600 hover:underline">/engine-room</Link>
                {" "}and{" "}
                <Link to="/admin/marketing-hub" className="font-semibold text-blue-600 hover:underline">/admin/marketing-hub</Link>
                {" "}are the <span className="font-semibold">same page</span> — two links, one place.
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50/70 p-3">
              <p className="text-xs font-bold text-gray-900">The Marketing Engine pages</p>
              <p className="mt-1 text-[12px] leading-snug text-gray-700">
                Everything below is a <span className="font-semibold">single-job tool</span>. Each one either
                feeds a library the AI reads, makes a piece of content, or gates what publishes. None of them
                publish on their own — they all hand off to the Director. If you're unsure which to open,
                follow the four steps in order.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {SUITE_STAGES.map((stage) => {
              const tools = toolsForStage(stage.key);
              if (!tools.length) return null;
              return (
                <div key={stage.key}>
                  <p className="text-xs font-bold uppercase tracking-wide text-gray-900">{stage.title}</p>
                  <p className="mb-2 text-[11px] leading-snug text-gray-500">{stage.blurb}</p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {tools.map((t) => (
                      <ToolChip key={t.to} tool={t} here={isCurrentTool(t, pathname)} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50/60 p-3">
            <p className="text-xs font-bold text-gray-900">Two shortcuts worth knowing</p>
            <ul className="mt-1.5 space-y-1 text-[12px] leading-snug text-gray-700">
              <li>
                <span className="font-semibold">Don't want to build each post by hand?</span>{" "}
                Content Studio → ContentFlow → <span className="font-semibold">Autonomous mode</span> takes the
                Director's caption-only drafts and builds the artwork for them. It never publishes — the
                Director still gates it.
              </li>
              <li>
                <span className="font-semibold">Copy not quite right?</span> Fix it on the Director card with{" "}
                <span className="font-semibold">✏️ Fix with AI</span> — say what should change, it rewrites and
                saves in place. No need to go back to the tool that made it.
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
