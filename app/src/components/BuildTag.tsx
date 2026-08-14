/**
 * BuildTag — "am I looking at current code?", answered on screen.
 *
 * The version check has always worked, and the build stamp has always existed —
 * but the stamp rendered on ONE admin page and the auto-reload is silent. So a
 * deployed fix and a stale tab produced the identical observation: nothing
 * changed. That ambiguity is what makes a day disappear into re-fixing things
 * that were already fixed.
 *
 * The console answers it, but only on a desktop browser with devtools open —
 * useless on a phone, and useless to anyone who does not live in devtools. This
 * puts the same answer where the work happens.
 *
 * Grey  = current.
 * Amber = a newer build is live; tap to load it.
 * Dash  = could not reach the server, so UNKNOWN — never shown as current,
 *         because "I could not check" must not read as "you are fine".
 */

import { useEffect, useState } from "react";
import { buildStatus } from "@/lib/versionCheck";
import { supabase } from "@/integrations/supabase/client";
import { isAllowlistedAdmin } from "@/lib/admin-allowlist";
import { cn } from "@/lib/utils";

const RECHECK_MS = 60_000;

export function BuildTag({ className }: { className?: string }) {
  const [id, setId] = useState<string>("");
  const [stale, setStale] = useState<boolean | null>(null);
  // ADMIN ONLY. This mounts on customer-facing pages, which are governed by the
  // WHITE UI standard — a build hash in the corner is operator instrumentation,
  // not something a wrap shop buying a design should ever see. Starts false and
  // is only ever set true, so a slow or failed role lookup hides the tag rather
  // than leaking it. Same two-part rule as RequireAdmin: the email allowlist
  // first (so a new operator works before their user_roles row syncs), then the
  // role table.
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let alive = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const user = session?.user;
        if (!user) {
          if (alive) setIsAdmin(false);
          return;
        }
        if (isAllowlistedAdmin(user.email)) {
          if (alive) setIsAdmin(true);
          return;
        }
        supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .in("role", ["admin", "tester"])
          .limit(1)
          .maybeSingle()
          .then(({ data }) => {
            if (alive) setIsAdmin(Boolean(data));
          });
      },
    );
    return () => {
      alive = false;
      subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isAdmin) return; // don't poll for viewers who will never see it
    let alive = true;
    const tick = async () => {
      try {
        const s = await buildStatus();
        if (!alive) return;
        setId(s.build);
        setStale(s.stale);
      } catch {
        if (alive) setStale(null);
      }
    };
    tick();
    const t = setInterval(tick, RECHECK_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [isAdmin]);

  if (!isAdmin || !id) return null;

  // Drop the timestamp on narrow screens — the sha is the part that identifies
  // the build, and this must stay readable on a phone where there is no console.
  const [sha, ...rest] = id.split(" · ");
  const when = rest.join(" · ");

  return (
    <button
      type="button"
      onClick={() => stale && window.location.reload()}
      disabled={!stale}
      title={
        stale === true
          ? `A newer build is live. Tap to load it. (running ${id})`
          : stale === false
            ? `You are on the current build (${id})`
            : `Could not reach the server to check — this may not be the current build (${id})`
      }
      // Styled for the DARK tool UI. /designpro is black with cyan accents —
      // the first pass used the WHITE UI palette and would have rendered a white
      // pill on a black page. The WHITE UI standard governs customer-facing
      // marketing/product/checkout surfaces; the design workbench itself is dark.
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] leading-none backdrop-blur-sm transition-colors",
        stale === true
          ? "cursor-pointer border-amber-500/60 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
          : stale === false
            ? "cursor-default border-white/10 bg-black/50 text-white/45"
            : "cursor-default border-white/10 bg-black/50 text-white/30",
        className,
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          stale === true
            ? "bg-amber-500"
            : stale === false
              ? "bg-green-500"
              : "bg-gray-300",
        )}
      />
      <span>build {sha}</span>
      {when && <span className="hidden sm:inline text-white/25">· {when}</span>}
      {stale === true && <span className="font-sans font-medium">update</span>}
    </button>
  );
}
