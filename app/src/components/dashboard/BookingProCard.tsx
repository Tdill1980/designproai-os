/**
 * BookingProCard — dashboard tile for BookingPro.
 *
 * Two states:
 *   - Active (appointments table has rows for this shop in next 7d):
 *       Shows next 3 upcoming appointments, total this-week count.
 *   - Inactive / empty:
 *       Upsell card → /bookingpro.
 *
 * Until the appointments table migration is applied, this falls
 * through to the upsell state automatically.
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { getActiveUser } from "@/lib/auth-session";
import { Calendar, ArrowRight, Sparkles, Clock, Car } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const db = supabase as any;

interface UpcomingAppt {
  id: string;
  scheduled_at: string;
  customer_name: string | null;
  vehicle: string | null;
  service: string | null;
  entry_source: string | null;
}

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });

export const BookingProCard = () => {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-bookingpro-upcoming"],
    queryFn: async () => {
      const user = await getActiveUser();
      if (!user) return { active: false, items: [] as UpcomingAppt[], weekCount: 0 };
      // customer_bookings.shop_id FKs to public.shops(id), not shop_profiles —
      // resolve via shops.owner_user_id like BookingPro.tsx does.
      const { data: shop } = await db
        .from("shops")
        .select("id")
        .eq("owner_user_id", user.id)
        .maybeSingle();
      if (!shop) return { active: false, items: [] as UpcomingAppt[], weekCount: 0 };

      const now = new Date();
      const weekOut = new Date();
      weekOut.setDate(weekOut.getDate() + 7);

      // customer_bookings is the canonical table used across BookingPro,
      // AppointmentsTab, and the public submit-public-booking flow. The
      // demo seed in sql/seed-demo-bookings.sql also targets this table.
      const { data: rows, error } = await db
        .from("customer_bookings")
        .select(
          "id, scheduled_at, customer_name, service_name, entry_source, " +
          "vehicle_year, vehicle_make, vehicle_model"
        )
        .eq("shop_id", shop.id)
        .gte("scheduled_at", now.toISOString())
        .lte("scheduled_at", weekOut.toISOString())
        .in("status", ["pending", "confirmed"])
        .order("scheduled_at", { ascending: true })
        .limit(10);

      if (error) {
        return { active: false, items: [] as UpcomingAppt[], weekCount: 0 };
      }

      const items = ((rows || []) as any[]).map((r) => {
        const vehicleParts = [r.vehicle_year, r.vehicle_make, r.vehicle_model].filter(Boolean);
        return {
          id: r.id,
          scheduled_at: r.scheduled_at,
          customer_name: r.customer_name || null,
          vehicle: vehicleParts.length > 0 ? vehicleParts.join(" ") : null,
          service: r.service_name || null,
          entry_source: r.entry_source || null,
        };
      }) as UpcomingAppt[];

      return { active: items.length > 0, items, weekCount: items.length };
    },
    staleTime: 60 * 1000,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-[#48484a] bg-rp-surface p-5 h-full">
        <Skeleton className="h-32 w-full bg-rp-elevated" />
      </div>
    );
  }

  // ── Inactive / empty (upsell) ────────────────────────────────
  if (!data?.active) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-rp-surface to-cyan-500/5 p-5 h-full flex flex-col">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center">
              <Calendar className="w-4 h-4 text-emerald-300" />
            </div>
            <h3 className="text-sm font-bold text-white uppercase tracking-[0.1em]">BookingPro</h3>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded text-emerald-100 bg-emerald-500/30">
            Add
          </span>
        </div>
        <p className="text-xs text-white/75 mb-3 font-inter leading-relaxed">
          Customers self-book straight from a QuickQuote link. SMS confirmation +
          reminder through your QuickText number. No phone tag.
        </p>
        <div className="flex-1" />
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="w-3 h-3 text-emerald-300" />
          <span className="text-[11px] text-emerald-300 font-semibold">
            Free with QuickText · or $19/mo standalone
          </span>
        </div>
        <Button asChild size="sm" className="bg-gradient-to-r from-emerald-400 to-cyan-400 hover:opacity-90 text-white font-semibold w-full h-9 text-xs">
          <Link to="/bookingpro">
            Add BookingPro
            <ArrowRight className="w-3 h-3 ml-1" />
          </Link>
        </Button>
      </div>
    );
  }

  // ── Active (upcoming list) ──────────────────────────────────
  return (
    <div className="relative overflow-hidden rounded-2xl border border-[#48484a] bg-rp-surface p-5 h-full flex flex-col">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-rp-elevated border border-[#48484a] flex items-center justify-center">
            <Calendar className="w-4 h-4 text-emerald-400" />
          </div>
          <h3 className="text-sm font-bold text-white uppercase tracking-[0.1em]">BookingPro</h3>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded text-white bg-gradient-to-r from-emerald-400 to-cyan-400">
          {data.weekCount} this week
        </span>
      </div>

      <p className="text-xs text-white/75 mb-3 font-inter">Next up</p>

      <div className="space-y-1.5 flex-1">
        {data.items.slice(0, 3).map((appt) => (
          <div
            key={appt.id}
            className="flex items-center gap-2 px-2 py-2 rounded-md bg-rp-elevated border border-[#48484a]"
          >
            <Clock className="w-3 h-3 text-emerald-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-white truncate">
                {appt.customer_name || "Booked appointment"}
              </div>
              <div className="text-[10px] text-white/70 truncate flex items-center gap-1">
                <span>{formatTime(appt.scheduled_at)}</span>
                {appt.service && (
                  <>
                    <span>·</span>
                    <Car className="w-2.5 h-2.5" />
                    <span>{appt.service}</span>
                  </>
                )}
              </div>
            </div>
            {appt.entry_source === "customer_self_booked" && (
              <span className="text-[9px] uppercase tracking-wide text-cyan-300 font-semibold">
                Self
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="mt-3 pt-3 border-t border-[#48484a]">
        <Button asChild variant="ghost" size="sm" className="w-full justify-between text-white/80 hover:text-white hover:bg-rp-elevated h-8 text-xs font-semibold">
          <Link to="/quotes">
            View all
            <ArrowRight className="w-3 h-3" />
          </Link>
        </Button>
      </div>
    </div>
  );
};
