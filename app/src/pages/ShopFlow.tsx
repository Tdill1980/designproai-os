/**
 * /shopflow — the WePrintWraps tenant's account page, on RestylePro's own
 * data. Replaces the old /dashboard/my-orders (MyWpwOrders) as where a WPW
 * customer checks an order, reorders, and jumps to their Club WPW rewards —
 * ONE page instead of three overlapping dashboard cards.
 *
 * TWO DOORS (2026-09-14). Signed in with a linked Woo customer, it reads
 * `useMyWpwOrders` exactly as before. Signed OUT, it opens on an EMAIL proven
 * with any one of that email's order numbers (`useGuestWpwOrders`). The second
 * door exists because the first reaches almost nobody: of 809 distinct WPW
 * customer emails, 8 users had a linked account. WPW customers check out on
 * WordPress and never sign up here, so handing them a link to a sign-in wall is
 * the same dead end as the tracker this replaced, only politer.
 *
 * It is never an order number ALONE — that was the tracker's enumeration hole.
 * Both doors render through the SAME card, because two shapes would drift.
 *
 * Every order here comes from `useMyWpwOrders` → RestylePro's `wpw_orders`
 * table, synced live from WooCommerce. Status is mapped through ShopFlow's
 * own seven-stage model (src/lib/shopflowStages.ts, the browser twin of
 * supabase/functions/_shared/shopflow-stages.ts — the SAME table the
 * WrapGenius chat and the wpw-order-lookup embed use, so this page never
 * disagrees with what a customer hears in chat).
 *
 * This replaces the old WrapCommandAI tracker link, which read a different,
 * stale project (unsynced since February, no RLS for a customer read) —
 * see shopflow-stages.ts for the full history.
 *
 * REWARDS: the real program is WPLoyalty (confirmed live on weprintwraps.com,
 * 2026-09-14). This page does NOT compute a points/tier number — an earlier
 * version did (SUM(order totals)/10, invented tier breakpoints), which had
 * zero connection to the real program and was pulled. It links to WPLoyalty's
 * own customer page (`https://weprintwraps.com/loyalty-reward-page/`) instead,
 * because that number is always correct — see WpwRewardsCard.tsx for the full
 * writeup of why an inline number isn't safe yet (WPLoyalty's public REST API
 * is add/reduce-only, no balance-read endpoint).
 */
import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Check, ChevronRight, Grid3x3, LayoutDashboard, Loader2, LockKeyhole, Package, PaintBucket, RefreshCw, Repeat2, Search, ShoppingBag, Star, Truck, ExternalLink, Workflow, Gift, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  useMyWpwOrders, useGuestWpwOrder, useGuestWpwOrders, useReorderWpw, wpwStatusLabel,
  readGuestShopflowToken, writeGuestShopflowToken,
  readGuestShopflowOrder, unlockGuestShopflow,
  type WpwOrder,
} from "@/hooks/useWpwOrders";
import { useWallProDesignCredits, WALLPRO_WELCOME_DESIGNS } from "@/hooks/useWallProDesignCredits";
import { useAutoSyncWpw } from "@/hooks/useAutoSyncWpw";
import { SignInWithWPWButton } from "@/components/SignInWithWPWButton";
import { shopflowStageFor, SHOPFLOW_STAGES } from "@/lib/shopflowStages";

const money = (amount: number | null, currency?: string | null) => {
  if (amount == null) return "—";
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(amount); }
  catch { return `$${amount.toFixed(2)}`; }
};
const formatDate = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};

/**
 * THE SEVEN-STAGE RAIL.
 *
 * Laid out as SEVEN EQUAL COLUMNS, not a flex row with a `last:flex-none`
 * item. The flex version centred each label under its dot, which put the last
 * dot hard against the card's right edge and hung "COMPLETED/SHIPPED" off it —
 * clipped on desktop, and on a 400px phone the last two stages were cut off
 * the card entirely. A grid gives the final column the same width as the
 * others, so its label centres inside the card like every other one.
 *
 * The STEP LINE above the diagram is not decoration. This rail is now the main
 * thing a guest sees after entering a job number, and that is overwhelmingly a
 * phone; 8px labels in a 50px column are not an answer to "where is my job?".
 * The sentence is, at any width, so the labels can drop below `sm` without the
 * page losing its point.
 */
function ShopflowRail({ status }: { status: string }) {
  const progress = shopflowStageFor(status);
  if (progress.terminal_note) {
    return <p className="text-xs font-semibold text-amber-700">{progress.terminal_note}</p>;
  }
  const { stage, stage_index: at, total_stages: total } = progress;
  return (
    <div>
      <p className="mb-3 text-sm font-bold text-gray-900">
        Step {at + 1} of {total}
        <span className="font-semibold text-gray-500"> · {stage}</span>
      </p>
      <div className="grid grid-cols-7 gap-x-1">
        {SHOPFLOW_STAGES.map((label, i) => (
          <div key={label} className="flex min-w-0 flex-col items-center gap-1">
            <div className="relative flex w-full items-center justify-center">
              {/* Connectors are drawn per-column, half on each side of the dot,
                  so they never rely on a sibling's width. */}
              {i > 0 && (
                <span className={`absolute left-0 right-1/2 h-0.5 ${i <= at ? "bg-[#3B82F6]" : "bg-gray-200"}`} />
              )}
              {i < total - 1 && (
                <span className={`absolute left-1/2 right-0 h-0.5 ${i < at ? "bg-[#3B82F6]" : "bg-gray-200"}`} />
              )}
              <div className={`relative flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold ${
                i < at ? "bg-[#3B82F6] text-gray-900"
                  : i === at ? "bg-[#3B82F6] text-white ring-2 ring-[#3B82F6]/30"
                  : "bg-gray-200 text-gray-300"
              }`}>
                {i + 1}
              </div>
            </div>
            <span className={`hidden text-center text-[8px] font-bold uppercase leading-tight tracking-wide sm:block ${
              i <= at ? "text-gray-600" : "text-gray-300"
            }`}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShopflowOrderCard({ order, guest }: { order: WpwOrder; guest?: boolean }) {
  const reorder = useReorderWpw();
  const progress = shopflowStageFor(order.status);
  const items = order.wpw_order_items || [];
  const itemNames = items.map((it) => it.name).filter(Boolean).join(", ");

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="h-[2px] bg-gradient-to-r from-[#3B82F6] via-[#9b87f5] to-[#D946EF]" />
      <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-gray-900">#{order.order_number || order.id}</span>
              {order.source === "patternpro" && (
                <Badge className="border-pink-200 bg-pink-50 text-[9px] font-bold uppercase tracking-wider text-pink-600">
                  PatternPro™
                </Badge>
              )}
              <Badge className="bg-[#3B82F6]/15 text-[#93c5fd] border-[#3B82F6]/30 text-[9px] font-bold uppercase tracking-wider">
                {progress.terminal_note ? wpwStatusLabel(order.status) : progress.stage}
              </Badge>
            </div>
            <p className="text-[11px] text-gray-500 mt-0.5">{formatDate(order.date_created)}{itemNames ? ` · ${itemNames}` : ""}</p>
          </div>
          <div className="text-right shrink-0">
            <div className="text-lg font-bold bg-gradient-to-r from-[#3B82F6] to-[#D946EF] bg-clip-text text-transparent">
              {money(order.total, order.currency)}
            </div>
          </div>
        </div>

        <ShopflowRail status={order.status} />

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {order.tracking_url && (
            <a href={order.tracking_url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-[#3B82F6] hover:text-[#D946EF] font-bold transition-colors">
              <Truck className="h-3.5 w-3.5" /> {order.tracking_carrier ? `${order.tracking_carrier} — ` : ""}Track
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {/* A PatternPro order has no Woo id to reorder; more yards are
              bought back in PatternPro. */}
          {order.source === "patternpro" && (
            <Link
              to="/pattern-wrap"
              className="ml-auto inline-flex items-center rounded-xl border border-[#2a2a2a] px-3 py-1.5 text-xs font-bold text-white/70 transition-colors hover:border-[#D946EF]/40 hover:text-[#D946EF]"
            >
              <Repeat2 className="h-3.5 w-3.5 mr-1" /> Order more yards
            </Link>
          )}
          {/* One-click reorder places a real Woo order against the linked
              customer, so it needs an account. A guest gets the storefront
              instead of a button that would fail at the server. */}
          {order.source !== "patternpro" && (<>
          {guest ? (
            <a
              href="https://weprintwraps.com/our-products/"
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto inline-flex items-center rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-600 transition-colors hover:border-[#D946EF]/40 hover:text-[#D946EF]"
            >
              <Repeat2 className="h-3.5 w-3.5 mr-1" /> Print this again
            </a>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={reorder.isPending}
              onClick={() => reorder.mutate(order.id)}
              className="ml-auto rounded-xl border-gray-200 text-gray-600 hover:text-[#D946EF] hover:border-[#D946EF]/40 text-xs"
            >
              <Repeat2 className="h-3.5 w-3.5 mr-1" /> {reorder.isPending ? "Placing order…" : "Reorder"}
            </Button>
          )}
          </>)}
        </div>
      </div>
    </div>
  );
}

/**
 * THE ONE DASHBOARD SIDEBAR (owner, 2026-09-15): "There will be one dashboard
 * side bar and its shopflow, and sidebar commercialpro, myshopflow order
 * status, wallpro, patternpro."
 *
 * So this is THE rail — not one of several. It is deliberately four
 * destinations, not a mirror of WooCommerce's eight-item account nav: this page
 * replaces Woo's My Account, and the Woo-owned screens (addresses, payment
 * methods, account details, tax exemption) stay on WooCommerce because a copy
 * of a stored payment token or a shipping address outside Woo is a screen that
 * looks like it works and does not.
 *
 * Every link goes somewhere that exists today. Nothing here is a placeholder.
 */
/**
 * THE LIVE JOB TRACKER SPINE (owner, 2026-09-15: "have live job tracker spine
 * at top").
 *
 * CommercialPro puts a navy strip of fleet codes directly under its white
 * header; this is the same device carrying the thing a ShopFlow visitor
 * actually came for — where their job is, right now, without scrolling to a
 * card to find out.
 *
 * It reads `shopflowStageFor` and SHOPFLOW_STAGES, the same table the card rail
 * and the WrapGenius chat read. There is no second list of stages here and
 * there must never be one: this is a second PRESENTATION, not a second source.
 *
 * It renders nothing when there is no job to track. An empty seven-dot spine
 * would read as "your order has not started", which for someone with no order
 * at all is simply untrue.
 */
function JobTrackerSpine({ order }: { order?: WpwOrder | null }) {
  if (!order) return null;
  const progress = shopflowStageFor(order.status);
  const num = order.order_number || order.id;
  return (
    <div className="-mx-4 bg-gradient-to-r from-[#0b1830] via-[#101b32] to-[#174a91] px-4 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
      <div className="flex flex-col gap-3 py-3 xl:flex-row xl:items-center xl:gap-6">
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#5ea3ff]">Live job tracker</span>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-bold text-white">#{num}</span>
        </div>

        {progress.terminal_note ? (
          <p className="text-sm font-semibold text-amber-300">{progress.terminal_note}</p>
        ) : (
          <div className="flex min-w-0 flex-1 items-center overflow-x-auto">
            {SHOPFLOW_STAGES.map((label, i) => {
              const done = i < progress.stage_index;
              const here = i === progress.stage_index;
              return (
                <div key={label} className="flex min-w-[104px] flex-1 items-start last:flex-none">
                  <div className="flex w-full flex-col items-center gap-1">
                    <div className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold ${
                      done ? "bg-[#22d3ee] text-[#0b1830]"
                        : here ? "bg-white text-[#0b1830] ring-4 ring-[#22d3ee]/30"
                        : "border border-white/25 text-white/40"
                    }`}>
                      {done ? <Check className="h-3 w-3" /> : i + 1}
                    </div>
                    <span className={`max-w-[100px] text-center text-[9px] font-bold uppercase leading-tight tracking-wide ${
                      here ? "text-white" : done ? "text-[#9dc2f5]" : "text-white/35"
                    }`}>{label}</span>
                  </div>
                  {i < SHOPFLOW_STAGES.length - 1 && (
                    <div className={`mt-2 h-[2px] min-w-[8px] flex-1 rounded-full ${done ? "bg-[#22d3ee]" : "bg-white/15"}`} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ShopflowSidebar({ credits, locked, commercialPro, points }: { credits?: number | null; locked: boolean; commercialPro?: boolean; points?: number | null }) {
  /**
   * Each PRODUCT tab carries a picture of the product (owner, 2026-09-15:
   * "the image of the type of product next to each product tab — so PatternPro
   * would have like a pattern design on a truck").
   *
   * Every thumbnail is a REAL WePrintWraps image, not an illustration:
   *   - CommercialPro  the Arizona Rodent Solutions fleet already on the
   *                    CommercialPro hero — printed by WPW, installed by
   *                    Viking Fleet.
   *   - WallPro        the WPW wall install already used in the page's
   *                    before/after, in preference to the stock photograph the
   *                    Woo product listing carries.
   *   - PatternPro     the live "Wrap By The Yard — Camo & Carbon" product
   *                    image from weprintwraps.com, cropped to the wrapped
   *                    vehicle. A pattern ON a vehicle, which is the point; a
   *                    flat swatch would show the material and not the product.
   *
   * `account: true` marks what the SIGN-IN is for, and those rows are shown
   * greyed and un-clickable to a guest rather than hidden (owner, 2026-09-15).
   * Hiding them is why the first version of the two-door split had nothing
   * visible behind the door: a customer cannot want what they cannot see. The
   * lock is honest — the server still refuses these to a guest either way, so
   * this changes what is DISPLAYED, never what is readable.
   *
   * "My ShopFlow order status" is never locked: it is the job the guest proved,
   * and this page is where they are. PatternPro is never locked either — the
   * library is public and pretending otherwise would be a fake gate.
   */
  /**
   * ANYONE CAN GET ON COMMERCIALPRO (owner, 2026-09-15: "I am giving everyone
   * access to it, they just need to buy 500 sq ft to get commercialpro perks …
   * anyone can get on commercialpro").
   *
   * So CommercialPro is NEVER locked. It is a door, not a club — locking it
   * would hide the pricing page from exactly the customer who has not yet
   * bought enough to earn the perks, which is the customer it is written for.
   * What it carries instead is a STATUS: a star once a single 500+ sq ft order
   * has earned the perks. The star is the thing to want; the page is open
   * either way.
   *
   * WHAT IS ACTUALLY LOCKED is only what genuinely needs an account — all your
   * orders, and your Club WPW points balance. Those are account data and the
   * server refuses them to a guest whatever this rail draws. WallPro and
   * PatternPro are open too; they carry their free-design count when we know it.
   *
   * Each product tab carries a picture of the product ("the image of the type of
   * product next to each product tab — so PatternPro would have like a pattern
   * design on a truck"). Every thumbnail is a REAL WePrintWraps image:
   *   - CommercialPro  the Arizona Rodent Solutions fleet from its own hero.
   *   - WallPro        the WPW wall install from that page's before/after.
   *   - PatternPro     the live "Wrap By The Yard — Camo & Carbon" product image
   *                    from weprintwraps.com, cropped to the wrapped vehicle.
   *                    A pattern ON a vehicle — a flat swatch would show the
   *                    material and not the product.
   */
  const items = [
    { href: "#orders", label: "My ShopFlow order status", icon: Package },
    { href: "#orders", label: "All my orders", icon: Search, account: true },
    { href: "#rewards", label: "Club WPW points", icon: Gift, account: true, badge: points },
    { href: "https://weprintwraps.com/commercialpro/", label: "CommercialPro", icon: Building2, external: true,
      thumb: "/assets/commercialpro/commercialpro-thumb.webp", star: commercialPro },
    /**
     * A WEPRINTWRAPS TAB OPENS THE WEPRINTWRAPS PAGE (owner, 2026-09-17: the
     * WPW WallPro page "must … appear in the wpw wallpro tab").
     *
     * This rail sat on WPW ShopFlow and pointed at `/wallpro`, which is the
     * DESIGNPROAI-branded landing — so a WePrintWraps customer clicking WallPro
     * inside their own WPW dashboard left the brand mid-session. The partner
     * routes mirror the house ones exactly (landing /wall-wrap → tool
     * /wallwrap-design), so this is the same product, correctly dressed.
     *
     * PatternPro was worse than mis-branded: `/patternpro` HAS NO ROUTE. It
     * fell through to the catch-all, so the tab was a dead click. Its real
     * partner page is /pattern-wrap, the route #464 shipped.
     */
    { href: "/wall-wrap", label: "WallPro", icon: LayoutDashboard, badge: credits,
      thumb: "/assets/commercialpro/wallpro-thumb.webp" },
    { href: "/pattern-wrap", label: "PatternPro", icon: Grid3x3,
      thumb: "/assets/commercialpro/patternpro-thumb.webp" },
  ];
  return (
    <aside className="sticky top-0 hidden min-h-screen w-[268px] shrink-0 flex-col self-start bg-gradient-to-b from-[#0b1830] via-[#101b32] to-[#174a91] px-4 py-6 lg:flex">
      <div className="-mx-4 -mt-6 mb-6 h-1 bg-gradient-to-r from-[#2f7ff7] to-[#22d3ee]" />
      <div className="mb-6 px-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#5ea3ff]">WePrintWraps</p>
        <p className="text-lg font-bold leading-tight text-white">
          My Shop<span className="bg-gradient-to-r from-[#5ea3ff] to-[#22d3ee] bg-clip-text text-transparent">Flow</span>
        </p>
      </div>
      <nav className="space-y-1">
        {items.map(({ href, label, icon: Icon, external, badge, thumb, account, star }) => {
          const isLocked = locked && account;
          const inner = (
            <>
              {thumb ? (
                <img src={thumb} alt="" loading="lazy" width={36} height={36}
                  className={`h-9 w-9 shrink-0 rounded-md border border-white/15 object-cover ${isLocked ? "grayscale opacity-60" : ""}`} />
              ) : (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/15 bg-white/5">
                  <Icon className="h-4 w-4 text-[#9dc2f5]" />
                </span>
              )}
              <span className="flex-1">{label}</span>
              {isLocked ? (
                <LockKeyhole className="h-3.5 w-3.5 shrink-0 text-white/35" />
              ) : star ? (
                <span title="CommercialPro perks unlocked"
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#facc15]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#facc15]">
                  <Star className="h-3 w-3 fill-current" /> Pro
                </span>
              ) : (
                <>
                  {/* The WallPro count is the balance the DATABASE would honour
                      at spend time (useWallProDesignCredits), never a hardcoded
                      5 — the fabricated points balance pulled off this page on
                      2026-09-14 is the failure that rule exists to avoid. */}
                  {typeof badge === "number" && badge > 0 && (
                    <span className="rounded-full bg-[#22d3ee]/15 px-2 py-0.5 text-[11px] font-bold text-[#22d3ee]">{badge}</span>
                  )}
                  {external && <ExternalLink className="h-3 w-3 shrink-0 text-white/30" />}
                </>
              )}
            </>
          );
          const row = "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors";
          // A locked row is a SPAN, not a disabled link: there is nowhere for it
          // to go, and a link that goes nowhere is the thing that teaches people
          // the page is broken.
          return isLocked ? (
            <span key={label} aria-disabled="true"
              className={`${row} cursor-default text-white/35`}>{inner}</span>
          ) : (
            <a key={label} href={href}
              className={`${row} text-[#cddcf0] hover:bg-white/10 hover:text-white`}
              {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{inner}</a>
          );
        })}
      </nav>

      {/* THE WALL. Named for what the customer already has, because almost every
          one of them has a WePrintWraps login and does not know this page is the
          same account — hence "formerly your WPW account page". */}
      {locked && (
        <div className="mt-5 rounded-xl border border-white/15 bg-white/5 p-4">
          <div className="mb-1.5 flex items-center gap-1.5">
            <LockKeyhole className="h-3.5 w-3.5 text-[#22d3ee]" />
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#9dc2f5]">Members</p>
          </div>
          <p className="text-sm font-semibold leading-snug text-white">
            Sign in to your WPW ShopFlow account
          </p>
          <p className="mt-1 text-xs text-[#9dc2f5]">
            Formerly your WePrintWraps account page. Every order, your Club WPW points, CommercialPro
            pricing and five free WallPro designs.
          </p>
          <Button asChild size="sm"
            className="mt-3 w-full rounded-full bg-none bg-[#2f7ff7] text-white shadow-sm hover:bg-[#2167ce]">
            <a href="https://weprintwraps.com/my-account/">Sign in <ChevronRight className="ml-1 h-4 w-4" /></a>
          </Button>
        </div>
      )}

      <div className="mt-auto pt-6">
        <Button asChild size="sm" variant="outline" className="w-full rounded-full border-white/25 bg-none bg-transparent text-white hover:border-[#22d3ee] hover:bg-white/10 hover:text-[#22d3ee]">
          <a href="https://weprintwraps.com/our-products/" target="_blank" rel="noopener noreferrer">Order film <ChevronRight className="ml-1 h-4 w-4" /></a>
        </Button>
      </div>
    </aside>
  );
}

export default function ShopFlow() {
  const navigate = useNavigate();
  const [refresh, setRefresh] = useState(false);
  const [search, setSearch] = useState("");
  const [syncing, setSyncing] = useState(false);

  // Which door is this visitor at? A session is checked first, because a
  // signed-in owner must never be shown a form for access they already have.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    supabase.auth.getSession().then(({ data: s }) => { if (live) setSignedIn(!!s.session); });
    return () => { live = false; };
  }, []);

  /**
   * A token handed over in the URL (`?t=…`) — THE WORDPRESS DOOR.
   *
   * weprintwraps.com/my-account/ has already authenticated the customer;
   * wordpress/wpw-shopflow-account mints a short-lived token server-side and
   * loads this page in an iframe already open. Asking a logged-in customer to
   * re-prove themselves with a job number would be a worse account page than
   * the one it replaces.
   *
   * IT OPENS THE HISTORY TIER, NOT THE ONE-JOB TIER, and that is not a
   * loosening of the two-door rule above. The guest tier is one job because an
   * order number is all that visitor proved. WordPress proved a whole logged-in
   * account, which is at least as strong as the email-plus-order-number proof
   * `unlock` demands — so it lands where that proof lands.
   *
   * READ ONCE and STRIPPED from the address bar immediately. The token is 24h,
   * but a credential left in browser history, a shared link or a screenshot has
   * a longer life than we chose for it.
   */
  const [wpToken, setWpToken] = useState<string | null>(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("t");
      if (fromUrl) {
        const url = new URL(window.location.href);
        url.searchParams.delete("t");
        window.history.replaceState({}, "", url.pathname + url.search + url.hash);
        return fromUrl;
      }
    } catch { /* no URL API — there is simply no WordPress door this visit */ }
    return null;
  });

  const [guestToken, setGuestToken] = useState<string | null>(() => readGuestShopflowToken());
  // THE JOB THE GUEST ASKED ABOUT. The guest tier shows this one and no other
  // (owner: "enter job number and see only that shopflow"), so the page has to
  // remember WHICH, not just that the email was proven.
  const [guestJob, setGuestJob] = useState<string | null>(() => readGuestShopflowOrder());
  // A PatternPro order-success page links here with ?job=PP-XXXXXXXX&email=…
  // so the guest form is pre-filled; the email still has to match the order.
  const [params] = useSearchParams();
  const [guestEmail, setGuestEmail] = useState(() => params.get("email") || "");
  const [guestOrderNumber, setGuestOrderNumber] = useState(() => params.get("job") || "");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  // `enabled` is the fix for a spinner that never stopped: this calls an
  // authenticated function, so running it for a signed-OUT visitor left
  // `isLoading` true for the life of the page and rendered a spinner in an
  // empty void under the door (2026-09-15).
  const authed = useMyWpwOrders({ refresh, enabled: signedIn === true });
  const guestQuery = useGuestWpwOrder(
    signedIn === false ? guestToken : null,
    signedIn === false ? guestJob : null,
  );
  // The WordPress door reads the whole history — see wpToken above.
  const wpQuery = useGuestWpwOrders(signedIn !== true ? wpToken : null);
  const useWp = signedIn !== true && !!wpToken;
  const useGuest = !useWp && signedIn === false && !!guestToken && !!guestJob;
  const { data, isLoading, isFetching, error, refetch } = useWp
    ? { ...wpQuery, refetch: wpQuery.refetch }
    : useGuest
    ? { ...guestQuery, refetch: guestQuery.refetch }
    : authed;
  useAutoSyncWpw();

  const submitUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setUnlocking(true); setUnlockError(null);
    const result = await unlockGuestShopflow(guestEmail, guestOrderNumber);
    if (result.ok && result.token) {
      setGuestToken(result.token);
      setGuestJob(result.orderNumber ?? null);
    } else setUnlockError(result.message || null);
    setUnlocking(false);
  };

  /**
   * IS THIS PAGE RUNNING INSIDE weprintwraps.com/my-account/ ?
   *
   * ShopFlow is replacing the WooCommerce account page, not merely living
   * beside it (owner, 2026-09-15: "shopflow is going to replace current account
   * page on wpw, not just be in restylepro"). Embedded, the WePrintWraps site
   * has ALREADY drawn its own chrome above this frame — the utility bar, the
   * white header, the WPW logo, the My Account button. Drawing a second header
   * with a second WPW logo underneath it is two logos and two headers on one
   * screen.
   *
   * So the masthead is for the STANDALONE page only. Inside the frame the page
   * starts at the live job tracker, which is the thing the customer came for
   * and the thing WooCommerce's account page never had.
   *
   * App.tsx already strips the global RestylePro header/footer in an iframe;
   * this masthead is page content, so it needs its own check.
   */
  const embedded = useMemo(() => {
    try { return typeof window !== "undefined" && window.self !== window.top; }
    catch { return true; }
  }, []);

  const forgetGuest = () => { writeGuestShopflowToken(null); setGuestToken(null); setGuestJob(null); };

  const handleSync = async () => {
    setSyncing(true);
    setRefresh(true);
    try {
      const { data: syncData, error: syncErr } = await supabase.functions.invoke("wpw-sync-orders", { body: { days_back: 90, per_page: 100 } });
      if (syncErr) throw syncErr;
      toast.success(`Synced ${syncData?.orders_fetched ?? 0} orders`);
      await refetch();
    } catch (e: any) {
      toast.error(e?.message || "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const orders = data?.orders || [];
  /**
   * The job the spine tracks: the first order still MOVING, falling back to the
   * newest. A finished order at the top would make the spine permanently green
   * for a customer whose live job is three rows down.
   */
  const trackedOrder = useMemo(() => {
    const moving = orders.find((o) => {
      const p = shopflowStageFor(o.status);
      return !p.terminal_note && p.stage_index < SHOPFLOW_STAGES.length - 1;
    });
    return moving || orders[0] || null;
  }, [orders]);
  const linked = data?.linked ?? false;
  const isGuest = data?.guest === true;
  // No session, no proven job, no WordPress token. The page is the door and
  // nothing else — in particular, never a spinner.
  const atTheDoor = signedIn === false && !(guestToken && guestJob) && !wpToken;

  // The five free WallPro designs ride on the LINKED WePrintWraps account, so
  // they are asked for only once we know there is one. The RPC both grants and
  // counts, and it is idempotent, so no button is needed — a customer receives
  // what they were promised by arriving.
  const wallPro = useWallProDesignCredits(signedIn === true && linked && !isGuest);

  const filtered = useMemo(() => {
    if (!search.trim()) return orders;
    const q = search.toLowerCase();
    return orders.filter((o) =>
      [o.order_number, String(o.id), o.status, o.tracking_number, ...(o.wpw_order_items || []).map((it) => it.name)]
        .filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [orders, search]);

  return (
    <>
      <Helmet>
        <title>My ShopFlow — WePrintWraps</title>
        <meta name="description" content="Track every order through ShopFlow's stages, review past orders, and reorder in one click." />
        {/* The route is public so the email door can be reached, and the page
            shows a named customer's order history. It must never be indexed. */}
        <meta name="robots" content="noindex,nofollow" />
      </Helmet>

      <main className="min-h-screen bg-gray-50">
        <div className="mx-auto flex max-w-[1440px]">
          {/* One rail, and only for someone who is actually in. At the door
              there is nothing to navigate between. */}
          {!atTheDoor && <ShopflowSidebar credits={wallPro.data?.remaining ?? null} locked={signedIn !== true} commercialPro={data?.commercialpro === true}
              points={data?.loyalty?.points_balance ?? null} />}
          <div className="min-w-0 flex-1 px-4 pb-16 sm:px-6 lg:px-10">
        {!embedded && <header className="border-b border-gray-200 py-7">
          <div>
            {/* A guest has no dashboard to go back to. */}
            {signedIn !== false && (
              <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")}
                className="text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-xl mb-4">
                <ArrowLeft className="h-4 w-4 mr-1" /> Dashboard
              </Button>
            )}
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-gray-400">
                  WePrintWraps <span className="text-gray-300">&times;</span> ShopFlow
                </p>
                <h1 className="mt-1 flex items-center gap-2.5 text-3xl sm:text-4xl font-bold tracking-tight">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#3b82f6] to-[#ec4899] shadow-sm">
                    <Workflow className="h-5 w-5 text-gray-900" />
                  </span>
                  <span className="whitespace-nowrap"><span className="text-gray-900">My Shop</span><span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">Flow</span><span className="text-gray-400 text-base align-top ml-0.5">&trade;</span></span>
                </h1>
                <p className="text-gray-600 mt-2 text-sm font-semibold">
                  {/* At the DOOR, isGuest is still false — no data has loaded —
                      so keying on it alone promises a visitor the history page
                      they are one tier away from. Key on the session. */}
                  {signedIn !== true
                    ? "Your job, and exactly which stage it's on right now"
                    : "Every order's real stage, past orders, and one-click reorder"}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {/* A guest is looking at exactly one job. A search box over a
                    list of one is furniture that implies there is more here. */}
                {!isGuest && (
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input placeholder="Search orders..." value={search} onChange={(e) => setSearch(e.target.value)}
                      className="w-56 pl-9 rounded-xl border-gray-200 bg-white text-gray-900 placeholder:text-gray-400" />
                  </div>
                )}
                {/* wpw-sync-orders pulls the linked customer's orders from Woo,
                    so it needs an account. A guest gets a plain refresh of what
                    they can already see. */}
                {signedIn !== true ? (
                  <>
                    {/* Both only mean something once a job is on screen. At
                        the door there is nothing to refresh and nobody to not
                        be. */}
                    {isGuest && (
                      <>
                        <Button size="sm" onClick={() => refetch()} disabled={isFetching}
                          className="bg-gray-900 text-white hover:bg-gray-700 rounded-xl">
                          <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
                        </Button>
                        <Button size="sm" variant="ghost" onClick={forgetGuest}
                          className="text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-xl">
                          Not you?
                        </Button>
                      </>
                    )}
                  </>
                ) : (
                  /* Account-only: wpw-sync-orders pulls the LINKED customer's
                     orders from Woo, so it needs a session. */
                  <Button size="sm" onClick={handleSync} disabled={syncing || isFetching}
                    className="bg-gray-900 text-white hover:bg-gray-700 rounded-xl">
                    <RefreshCw className={`h-4 w-4 mr-1 ${syncing || isFetching ? "animate-spin" : ""}`} /> {syncing ? "Syncing…" : "Sync"}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </header>}

            <JobTrackerSpine order={trackedOrder} />

        <div className="pt-7">
          {/* THE FIRST DOOR. Shown to anyone without a session — which is almost
              every WePrintWraps customer, since they check out on WordPress and
              never create a RestylePro account.

              It opens ONE JOB: the number they typed, and nothing else (owner,
              2026-09-15 — "enter job number and see only that shopflow, then
              once in it has the WPW ShopFlow log in to see your order history
              and points page"). The history, the points, the CommercialPro
              account and the free WallPro designs are what the sign-in is FOR.

              The email is still required and still not negotiable. It proves the
              job is theirs; an order number alone was the enumeration hole in
              the tracker this page replaced. Asking for it costs one field and
              is the only reason this page can be public at all. */}
          {atTheDoor && (
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-6 sm:p-8">
              <div className="flex items-center gap-2 mb-1">
                <Workflow className="h-4 w-4 text-[#3B82F6]" />
                <h2 className="text-lg font-bold text-gray-900">Track your job</h2>
              </div>
              <p className="text-gray-600 mb-5 text-sm max-w-lg">
                Enter your <b className="text-gray-700">job number</b> and the email on the order. You'll see that job
                move through every stage — no account needed.
              </p>
              <form onSubmit={submitUnlock} className="grid gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
                <label className="block">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Email on the order</span>
                  <Input type="email" required autoComplete="email" value={guestEmail}
                    onChange={(e) => setGuestEmail(e.target.value)} placeholder="you@company.com"
                    className="mt-1 rounded-xl border-gray-200 bg-white text-gray-900 placeholder:text-gray-400" />
                </label>
                <label className="block">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Job number</span>
                  <Input required inputMode="numeric" value={guestOrderNumber}
                    onChange={(e) => setGuestOrderNumber(e.target.value)} placeholder="36053"
                    className="mt-1 rounded-xl border-gray-200 bg-white text-gray-900 placeholder:text-gray-400" />
                </label>
                <Button type="submit" disabled={unlocking}
                  className="rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#D946EF] text-white hover:brightness-110">
                  {unlocking ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null} Track my job
                </Button>
              </form>
              {unlockError && <p className="mt-3 text-sm font-semibold text-red-600">{unlockError}</p>}
              <div className="mt-6 border-t border-gray-200 pt-5">
                <p className="text-gray-500 text-xs mb-3">
                  Signing in with WePrintWraps opens the rest of it — every order you've placed, your Club WPW points,
                  and {WALLPRO_WELCOME_DESIGNS} free WallPro designs.
                </p>
                <SignInWithWPWButton onLinked={() => refetch()} />
              </div>
            </div>
          )}

          {/* Signed in, but no Woo customer linked yet. */}
          {signedIn !== false && !isLoading && data && !linked && (
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-8 sm:p-12 text-center">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#3B82F6]/20 to-[#D946EF]/20 flex items-center justify-center mx-auto mb-6">
                <ShoppingBag className="h-10 w-10 text-[#D946EF]" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Link your WePrintWraps account</h2>
              <p className="text-gray-600 mb-6 max-w-md mx-auto text-sm">
                See every order move through ShopFlow's real stages, track shipments, and reorder in one click. Free.
              </p>
              <SignInWithWPWButton onLinked={() => refetch()} />
            </div>
          )}

          {/*
            Club WPW Rewards — a REAL number, pushed live by WPLoyalty's own
            `wlr_customer_points_balance_changed` hook via wordpress/wpw-
            loyalty-webhook + wpw-loyalty-webhook (see useMyWpwOrders'
            `loyalty` field). Not computed here. `loyalty` is null until that
            plugin is installed AND at least one point event has fired for
            this customer — an honest gap, so we link out to WPLoyalty's own
            page instead of inventing a number. Do NOT reintroduce a
            computed/estimated points formula; that was the exact mistake
            fixed here (2026-09-14).
          */}
          {/* `!isGuest` is load-bearing, not tidiness. The guest response sets
              `linked: true` (a proven email IS an identity), so without it this
              card renders for a guest — while the card directly below offers
              "your Club WPW points balance" as a reason to sign in. Caught in
              the browser; no assertion about the condition would have shown it,
              because each half was individually correct. */}
          {signedIn === true && linked && !isGuest && !isLoading && orders.length > 0 && (
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden mb-6">
              <div className="h-1 bg-gradient-to-r from-cyan-400 to-fuchsia-500" />
              <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-cyan-400/20 to-fuchsia-500/20 border border-fuchsia-500/30 flex items-center justify-center shrink-0">
                    <Gift className="w-5 h-5 text-[#D946EF]" />
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.15em] text-gray-500 font-bold">Club WPW Rewards</p>
                    {data?.loyalty ? (
                      <p className="text-sm text-gray-600">
                        <span className="text-lg font-bold bg-gradient-to-r from-cyan-400 to-fuchsia-400 bg-clip-text text-transparent">
                          {data.loyalty.points_balance.toLocaleString()} points
                        </span>{" "}
                        — synced live from WePrintWraps.com.
                      </p>
                    ) : (
                      <p className="text-sm text-gray-600">Your points, tier, and rewards live on WePrintWraps.com.</p>
                    )}
                  </div>
                </div>
                <Button asChild className="sm:ml-auto shrink-0 bg-gradient-to-r from-cyan-500 to-fuchsia-500 hover:brightness-110 text-white rounded-xl">
                  <a href="https://weprintwraps.com/loyalty-reward-page/" target="_blank" rel="noopener noreferrer">
                    {data?.loyalty ? "Redeem my points" : "View my points"} <ExternalLink className="h-4 w-4 ml-1.5" />
                  </a>
                </Button>
              </div>
            </div>
          )}

          {/*
            FIVE FREE WALLPRO DESIGNS (owner, 2026-09-15). A REAL entitlement,
            not a line of copy: `claim_wallpro_welcome_designs()` writes a grant
            row and returns what is left, so this number is one the database
            would honour at spend time. See useWallProDesignCredits for why a
            local count is forbidden here — a fabricated balance was pulled off
            this exact page on 2026-09-14 and must not come back in a new
            costume. The card renders only once the RPC has answered.
          */}
          {signedIn === true && linked && !isGuest && wallPro.data?.eligible && (
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden mb-6">
              <div className="h-1 bg-gradient-to-r from-[#3B82F6] to-[#D946EF]" />
              <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#3B82F6]/20 to-[#D946EF]/20 border border-[#3B82F6]/30 flex items-center justify-center shrink-0">
                    <PaintBucket className="w-5 h-5 text-[#3B82F6]" />
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.15em] text-gray-500 font-bold">WallPro Designs</p>
                    {wallPro.data.remaining > 0 ? (
                      <p className="text-sm text-gray-600">
                        <span className="text-lg font-bold bg-gradient-to-r from-[#3B82F6] to-[#D946EF] bg-clip-text text-transparent">
                          {wallPro.data.remaining} free
                        </span>{" "}
                        {wallPro.data.remaining === 1 ? "design" : "designs"} on your account — wall wraps, murals, full
                        interiors.
                      </p>
                    ) : (
                      /* Used up is NOT the same screen as never eligible. Saying
                         "0 free designs" to someone who has five is the bug this
                         split exists to prevent. */
                      <p className="text-sm text-gray-600">
                        You've used all {WALLPRO_WELCOME_DESIGNS} free designs. WallPro is still open for more.
                      </p>
                    )}
                  </div>
                </div>
                <Button asChild className="sm:ml-auto shrink-0 bg-gradient-to-r from-[#3B82F6] to-[#D946EF] hover:brightness-110 text-white rounded-xl">
                  {/* The WePrintWraps page, for the same reason as the rail
                      above: these free designs ride on the customer's LINKED
                      WePrintWraps account, so the page they open must be the
                      one carrying that brand. */}
                  <a href="/wall-wrap">
                    {wallPro.data.remaining > 0 ? "Start a design" : "Open WallPro"}
                  </a>
                </Button>
              </div>
            </div>
          )}

          {/*
            COMMERCIALPRO. Owner's words were "your CommercialPro account if you
            have one" — and there IS no per-customer CommercialPro account in the
            data. Checked 2026-09-15: no table, no column, no flag, and zero
            `commercialpro-proof` leads. CommercialPro is a BRAND and a pricing
            tier on products (the published weprintwraps.com/commercialpro page
            plus the FLEET ladder), not an entity a customer owns.

            So this card does not pretend to detect one. Inventing a rule for
            "has a CommercialPro account" — lifetime spend, a fleet tier cleared,
            a lead row — would put a number on screen that no system agrees to,
            which is the same failure as the fabricated points balance removed
            from this page on 2026-09-14.

            It also does not restate the volume ladder. The ladder is stated in
            four places already and `tests/wpw-fleet-ladder.test.ts` exists
            precisely because a fifth restatement drifts and then checkout
            refuses a discount the customer was promised. Link to the surface
            that owns it; never re-type the rungs here.

            Make this conditional the day a real CommercialPro account exists.
          */}
          {signedIn === true && linked && !isGuest && orders.length > 0 && (
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden mb-6">
              <div className="h-1 bg-gradient-to-r from-[#9b87f5] to-[#3B82F6]" />
              <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#9b87f5]/20 to-[#3B82F6]/20 border border-[#9b87f5]/30 flex items-center justify-center shrink-0">
                    <Building2 className="w-5 h-5 text-[#9b87f5]" />
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.15em] text-gray-500 font-bold">CommercialPro</p>
                    <p className="text-sm text-gray-600">
                      Fleet and commercial work — volume pricing, and a quote before anyone asks who you are.
                    </p>
                  </div>
                </div>
                <Button asChild variant="outline" className="sm:ml-auto shrink-0 rounded-xl border-gray-200 text-gray-700 hover:text-white hover:border-[#9b87f5]/50">
                  <a href="https://weprintwraps.com/commercialpro/" target="_blank" rel="noopener noreferrer">
                    Open CommercialPro <ExternalLink className="h-4 w-4 ml-1.5" />
                  </a>
                </Button>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 mb-6">
              <p className="text-sm text-red-600">Couldn't load orders: {(error as Error).message}</p>
            </div>
          )}

          {isLoading && !atTheDoor && (
            <div className="flex justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-[#3B82F6]" />
            </div>
          )}

          {linked && !isLoading && orders.length > 0 && (
            <div className="space-y-4">
              {filtered.map((o) => <ShopflowOrderCard key={o.id} order={o} guest={isGuest} />)}
              {filtered.length === 0 && (
                <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-8 text-center">
                  <Search className="w-8 h-8 text-white/20 mx-auto mb-3" />
                  <p className="text-gray-500">No orders match "{search}"</p>
                </div>
              )}
            </div>
          )}

          {/* THE SECOND DOOR. The guest has their job; this is what signing in
              adds, named concretely rather than as "more features": the rest of
              their orders, their real points balance, their CommercialPro
              account, and the five WallPro designs. It sits BELOW the job
              because the job is what they came for. */}
          {isGuest && !isLoading && orders.length > 0 && (
            <div className="mt-6 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-[#3B82F6] via-[#9b87f5] to-[#D946EF]" />
              <div className="p-5 sm:p-6">
                <div className="flex items-center gap-2 mb-1">
                  <LockKeyhole className="h-4 w-4 text-[#3B82F6]" />
                  <h2 className="text-lg font-bold text-gray-900">Your full WPW ShopFlow</h2>
                </div>
                <p className="text-gray-600 text-sm max-w-xl mb-4">
                  Sign in with WePrintWraps to open the rest of it.
                </p>
                <ul className="grid gap-2 sm:grid-cols-2 mb-5">
                  {[
                    "Every order you've placed, not just this one",
                    "Your Club WPW points balance and rewards",
                    "Your CommercialPro account, if you have one",
                    `${WALLPRO_WELCOME_DESIGNS} free WallPro designs`,
                  ].map((line) => (
                    <li key={line} className="flex items-start gap-2 text-sm text-gray-600">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gradient-to-r from-[#3B82F6] to-[#D946EF]" />
                      {line}
                    </li>
                  ))}
                </ul>
                <SignInWithWPWButton onLinked={() => refetch()} />
              </div>
            </div>
          )}

          {linked && !isLoading && orders.length === 0 && (
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-8 sm:p-12 text-center">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#3B82F6]/20 to-[#D946EF]/20 flex items-center justify-center mx-auto mb-6">
                <Package className="h-10 w-10 text-[#3B82F6]" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">No orders yet</h2>
              <p className="text-gray-500">Once you place an order, it'll show up here moving through ShopFlow.</p>
            </div>
          )}
        </div>
          </div>
        </div>
      </main>
    </>
  );
}
