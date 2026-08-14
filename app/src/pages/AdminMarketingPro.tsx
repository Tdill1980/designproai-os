/**
 * MarketingPro™ — the end-to-end "how to use the marketing system" guide.
 *
 * Owner ask (2026-08-03): "Create how to use marketing system end to end,
 * call it MarketingPro… or Brand Builder System." This page is the long-form
 * walkthrough; the collapsible MarketingSuiteGuide on each tool page stays
 * the quick reference. White UI standard, suite gradient as accent only.
 */
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

const GRADIENT = "bg-gradient-to-r from-[#3b82f6] to-[#ec4899]";

type Step = {
  n: number;
  title: string;
  where: { label: string; to: string }[];
  you: string[];
  system: string[];
};

const STEPS: Step[] = [
  {
    n: 1,
    title: "Load the brand",
    where: [
      { label: "Hooks Manager", to: "/admin/hooks" },
      { label: "Asset Library", to: "/engine-room?tab=assets" },
      { label: "Content Studio → Templates", to: "/admin/content-studio" },
    ],
    you: [
      "Keep the hooks library stocked — every line the system writes starts from a hook you approved.",
      "Ingest raw footage/photos into the Asset Library (Drive link → parser).",
      "Upload Canva templates per brand and format (static, story, reel, carousel).",
    ],
    system: [
      "Brand voice, banned language and real product facts feed every generator.",
      "No template for a format = an honest skip, never an invented layout.",
    ],
  },
  {
    n: 2,
    title: "Direct the week",
    where: [{ label: "Content Director", to: "/admin/content-director" }],
    you: [
      "Plan the week or type an idea into 'Give the Director an idea'.",
      "Sort the queue with the color chips — Brand, Channel, Team, and Type (Landing Pages & Websites live under Type).",
      "Manage the Shot List: approve shots, upload footage as it's filmed.",
    ],
    system: [
      "Drafts land in the queue as captions (and shot cards) waiting for artwork.",
      "Nothing publishes from here without your approval — approve = scheduled.",
    ],
  },
  {
    n: 3,
    title: "Build the creative",
    where: [{ label: "Content Studio", to: "/admin/content-studio" }],
    you: [
      "Manual: ContentFlow AI — pick a template, generate, refine, export.",
      "Autonomous: point it at the Director queue and it builds artwork for caption-only drafts, bounded and honest about skips.",
      "Static ads and carousels use the deterministic composer — brand fonts (Anton/Lato) as vector type over real photos, zero AI in the lettering.",
    ],
    system: [
      "Every build attaches to its Director draft with provenance (template, producer, tone).",
      "Real templates and real photos only; invented prices/stats are banned at the prompt level.",
    ],
  },
  {
    n: 4,
    title: "Review and approve",
    where: [
      { label: "Brand Board", to: "/admin/brand-board" },
      { label: "Content Director", to: "/admin/content-director" },
    ],
    you: [
      "Sweep the Brand Board — X-delete anything not worth editing.",
      "Use '✏️ Fix with AI' on copy that's close but not right.",
      "Approve what ships. Landing pages (like CommercialPro) sit on the board as APPROVAL NEEDED cards before they go to WordPress as drafts.",
    ],
    system: [
      "Approval is the only gate to scheduling — the machines never skip it.",
    ],
  },
  {
    n: 5,
    title: "Ship it",
    where: [{ label: "Marketing Hub", to: "/admin/marketing-hub" }],
    you: [
      "Approved social goes out on schedule; email campaigns build through Klaviyo.",
      "Web pages publish only from WordPress drafts you've previewed (WrapTVWorld / CommercialPro pattern — credentials never leave the backend).",
    ],
    system: [
      "External sites (Lovable pages, quote tools) connect through public endpoints or embeds — no keys in any frontend.",
    ],
  },
  {
    n: 6,
    title: "Measure and steer",
    where: [{ label: "Ads Performance", to: "/admin/ads-performance" }],
    you: [
      "Read live verdicts on what's converting before spending more.",
      "Feed winners back to the Director ('rotate the caption angle that worked').",
    ],
    system: [
      "Quote events and Meta results tie spend to actual quote volume.",
    ],
  },
  {
    n: 7,
    title: "Retain and grow",
    where: [{ label: "WrapRewards", to: "https://weprintwraps.com/reward-landing/" }],
    you: [
      "Keep WrapRewards in the content mix — enrollment, points bonuses, reactivation.",
      "Promote CommercialPro angles to installers: bulk orders, wall wraps, rep assistance.",
    ],
    system: [
      "The hooks library carries the program's real terms so promotion never invents a number.",
    ],
  },
];

export default function AdminMarketingPro() {
  return (
    <div className="min-h-screen bg-white">
      <Helmet><title>MarketingPro™ — DesignProAI</title></Helmet>
      <div className="mx-auto max-w-4xl px-5 py-10">
        <div className="mb-2 text-xs font-bold uppercase tracking-widest text-gray-500">The Brand Builder System</div>
        <h1 className="text-4xl font-extrabold text-gray-900">
          Marketing<span className={`${GRADIENT} bg-clip-text text-transparent`}>Pro</span>™ — end to end
        </h1>
        <p className="mt-3 max-w-2xl text-gray-600">
          One system: load the brand, direct the week, build the creative, approve it, ship it,
          measure it, and keep customers coming back. You are the only approval gate — every step
          below feeds the next, and nothing publishes without you.
        </p>

        <div className={`mt-8 h-1 w-24 rounded ${GRADIENT}`} />

        <div className="mt-8 space-y-6">
          {STEPS.map((s) => (
            <div key={s.n} className="rounded-xl border border-gray-200 p-6">
              <div className="flex items-center gap-3">
                <div className={`flex h-9 w-9 items-center justify-center rounded-full ${GRADIENT} text-sm font-extrabold text-white`}>{s.n}</div>
                <h2 className="text-xl font-bold text-gray-900">{s.title}</h2>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {s.where.map((w) =>
                  w.to.startsWith("http") ? (
                    <a key={w.to} href={w.to} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50">
                      {w.label} <ArrowRight className="h-3 w-3" />
                    </a>
                  ) : (
                    <Link key={w.to} to={w.to} className="inline-flex items-center gap-1 rounded-full border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50">
                      {w.label} <ArrowRight className="h-3 w-3" />
                    </Link>
                  ),
                )}
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500">You do</div>
                  <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm text-gray-700">
                    {s.you.map((t, i) => <li key={i}>{t}</li>)}
                  </ul>
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500">The system does</div>
                  <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm text-gray-600">
                    {s.system.map((t, i) => <li key={i}>{t}</li>)}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-8 text-sm text-gray-500">
          Quick reference: every marketing page carries the collapsible "How to use the Marketing
          Suite" dropdown — this page is the full walkthrough.
        </p>
      </div>
    </div>
  );
}
