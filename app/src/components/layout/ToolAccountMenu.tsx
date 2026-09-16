/**
 * THE ACCOUNT CONTROL A TOOL PAGE OWNS ITSELF.
 *
 * Owner, 2026-09-16: "I NEED A PERSISTENT HEADER" -- said straight after
 * "REMOVE THE DUAL DESIGNPRO ... LOOK LIKE A TOOL PAGE IN A SAAS".
 *
 * Both are true at once, and the measurement says which half was actually
 * missing. The WallPro bar IS persistent: scrolled 1309px down the tool page
 * it still reports `top: 0`, because removing the marketing <Header> did not
 * un-stick it -- it promoted it from "sticky under another bar" to "sticky at
 * the top of the window". So the header did not go away.
 *
 * WHAT WENT AWAY WAS THE ACCOUNT. Header.tsx was carrying the only user menu
 * on an app route: who you are signed in as, your plan, billing, sign out.
 * AppSidebar has a plan pill and the tool list and NOTHING else -- no identity,
 * no way out. A SaaS tool page that cannot tell you whose account you are
 * spending credits from is a worse failure than the duplicate navigation that
 * was removed, so this is the half that has to come back.
 *
 * IT COMES BACK AS ONE CONTROL, NOT A SECOND NAVIGATION. The shape every
 * mature SaaS converges on is: a left rail for product navigation, and ONE
 * slim bar the app owns carrying the tool's name, the tool's primary actions
 * and the account control at the far right. WallPro already had the first
 * three. This is the fourth, and it is deliberately a single avatar button --
 * a menu bar in its place would rebuild the thing that was just removed.
 *
 * NOT AppTopBar.tsx. That file exists, has an account menu, and is rendered by
 * nothing: it is dead code whose wordmark still says "RestylePro", so wiring it
 * in would put another product's name on a DesignProAI header and a SECOND
 * fixed bar over a page that already has one. It is left alone.
 *
 * Self-contained on purpose: any tool header can drop it in without inheriting
 * a shell. Dark-ground styling because tool headers in this product are dark.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CreditCard, LayoutGrid, LogOut } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useUserTier } from '@/hooks/useUserTier';
import { TIER_LABELS } from '@/hooks/useToolAccess';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const initials = (email: string | null) => {
  const source = email?.split('@')[0] ?? '';
  if (!source) return '?';
  const parts = source.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
};

export function ToolAccountMenu() {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  // `undefined` is "we have not asked yet" and renders nothing at all. A
  // control that flashes "Sign in" for a beat and then turns into an avatar is
  // how a header looks broken to somebody who IS signed in, and this bar is
  // pinned in view the whole session.
  const [known, setKnown] = useState(false);
  // Returns the tier STRING, not an object. Destructuring it yields undefined
  // and the badge silently falls back to "Free" for every paying customer.
  const tier = useUserTier();

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setEmail(data?.session?.user?.email ?? null);
      setKnown(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
      setKnown(true);
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, []);

  if (!known) return null;

  if (!email) {
    return (
      <Link
        to="/login"
        className="rounded-md border border-white/25 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/10 md:text-sm"
      >
        Sign in
      </Link>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex shrink-0 items-center gap-2 rounded-full border border-white/20 py-1 pl-1 pr-2.5 text-white transition hover:bg-white/10"
          // The email is the accessible name because the initials are a
          // decoration: "TD" tells a screen-reader user nothing about which
          // account they are about to spend a generation from.
          aria-label={`Account: ${email}`}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-fuchsia-600 text-[11px] font-bold">
            {initials(email)}
          </span>
          <span className="hidden text-[11px] font-semibold uppercase tracking-wide text-white/70 sm:inline">
            {TIER_LABELS[tier] || 'Free'}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 border-white/10 bg-neutral-950 text-white">
        <DropdownMenuLabel className="truncate font-normal text-white/70">{email}</DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-white/10" />
        <DropdownMenuItem asChild>
          <Link to="/dashboard" className="cursor-pointer"><LayoutGrid className="mr-2 h-4 w-4" />Dashboard</Link>
        </DropdownMenuItem>
        {/* ONLY ROUTES THAT EXIST. /profile and /billing are both absent from
            App.tsx -- AppTopBar links to /billing and would 404 -- so the menu
            carries what the sidebar's own Account group carries, and nothing
            invented. */}
        <DropdownMenuItem asChild>
          <Link to="/pricing" className="cursor-pointer"><CreditCard className="mr-2 h-4 w-4" />Plans &amp; pricing</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-white/10" />
        <DropdownMenuItem
          className="cursor-pointer text-red-300 focus:text-red-200"
          onClick={() => { void supabase.auth.signOut().then(() => navigate('/login')); }}
        >
          <LogOut className="mr-2 h-4 w-4" />Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
