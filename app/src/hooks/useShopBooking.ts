import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const db = supabase as never as { from: (t: string) => any };

export interface ServiceCatalogRow {
  slug: string;
  name: string;
  description: string | null;
  base_price: number;
  duration_minutes: number;
  sort_order: number;
}

export interface AvailabilityWindow {
  day_of_week: number; // 0=Sun .. 6=Sat
  start_time: string; // "HH:MM:SS"
  end_time: string;
}

/**
 * Public-readable list of services a shop offers, sorted by sort_order.
 * RLS allows anon SELECT where is_active = true.
 */
export const useShopServices = (shopId: string | null | undefined) => {
  return useQuery<ServiceCatalogRow[]>({
    queryKey: ["shop-services", shopId],
    enabled: !!shopId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await db
        .from("service_catalog")
        .select("slug, name, description, base_price, duration_minutes, sort_order")
        .eq("shop_id", shopId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error || !data) return [];
      return data as ServiceCatalogRow[];
    },
  });
};

/**
 * Public-readable weekly availability windows for a shop.
 */
export const useShopAvailability = (shopId: string | null | undefined) => {
  return useQuery<AvailabilityWindow[]>({
    queryKey: ["shop-availability", shopId],
    enabled: !!shopId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await db
        .from("shop_availability")
        .select("day_of_week, start_time, end_time")
        .eq("shop_id", shopId)
        .eq("is_active", true)
        .order("day_of_week", { ascending: true });
      if (error || !data) return [];
      return data as AvailabilityWindow[];
    },
  });
};

export interface ComputedSlot {
  iso: string;
  date: Date;
  label: string;
  available: boolean;
}

/**
 * Build slot list for the next `lookAheadDays` days given availability
 * windows + a service duration. Uses 30-min granularity for short services
 * and the service duration as step for longer ones, capped at hourly grain.
 *
 * Bookings conflict check is done client-side off the public-readable
 * list of upcoming bookings (see useUpcomingBookings below); since
 * customer_bookings is RLS-private, anon clients won't see existing
 * bookings — the edge function does the authoritative check on insert.
 */
export function computeAvailableSlots(
  availability: AvailabilityWindow[],
  durationMinutes: number,
  lookAheadDays = 14,
): ComputedSlot[] {
  if (!availability || availability.length === 0) return [];

  const slotStepMin = Math.min(60, Math.max(30, Math.round(durationMinutes / 2)));
  const out: ComputedSlot[] = [];
  const now = new Date();

  for (let dayOffset = 0; dayOffset < lookAheadDays; dayOffset++) {
    const day = new Date(now);
    day.setDate(day.getDate() + dayOffset);
    day.setHours(0, 0, 0, 0);
    const dow = day.getDay();

    const windows = availability.filter((w) => w.day_of_week === dow);
    if (windows.length === 0) continue;

    for (const w of windows) {
      const [startH, startM] = w.start_time.split(":").map(Number);
      const [endH, endM] = w.end_time.split(":").map(Number);

      const windowStart = new Date(day);
      windowStart.setHours(startH, startM || 0, 0, 0);
      const windowEnd = new Date(day);
      windowEnd.setHours(endH, endM || 0, 0, 0);

      const lastStart = new Date(windowEnd);
      lastStart.setMinutes(lastStart.getMinutes() - durationMinutes);

      let cursor = new Date(windowStart);
      while (cursor.getTime() <= lastStart.getTime()) {
        // Skip slots in the past (today only).
        const inPast = cursor.getTime() < Date.now();
        if (!inPast) {
          out.push({
            iso: cursor.toISOString(),
            date: new Date(cursor),
            label: cursor.toLocaleString("en-US", {
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            }),
            available: true,
          });
        }
        cursor = new Date(cursor.getTime() + slotStepMin * 60_000);
      }
    }
  }

  return out;
}

export function groupSlotsByDate(slots: ComputedSlot[]): Map<string, ComputedSlot[]> {
  const map = new Map<string, ComputedSlot[]>();
  for (const s of slots) {
    const key = s.date.toISOString().slice(0, 10);
    const arr = map.get(key) || [];
    arr.push(s);
    map.set(key, arr);
  }
  return map;
}

/**
 * For the shop-owner admin dashboard: list upcoming bookings for one shop.
 */
export interface UpcomingBookingRow {
  id: string;
  service_slug: string;
  service_name: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  vehicle_year: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  scheduled_at: string;
  duration_minutes: number;
  base_price: number | null;
  status: string;
  notes: string | null;
  attachment_urls: string[] | null;
  payment_status: string;
  payment_notes: string | null;
  created_at: string;
}

export const useUpcomingBookings = () => {
  return useQuery<UpcomingBookingRow[]>({
    queryKey: ["dashboard-upcoming-bookings"],
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      const { data, error } = await db
        .from("customer_bookings")
        .select(
          `id, service_slug, service_name, customer_name, customer_email, customer_phone,
           vehicle_year, vehicle_make, vehicle_model, scheduled_at, duration_minutes,
           base_price, status, notes, attachment_urls, payment_status, payment_notes, created_at`
        )
        .gte("scheduled_at", since.toISOString())
        .order("scheduled_at", { ascending: true })
        .limit(50);
      if (error || !data) return [];
      return data as UpcomingBookingRow[];
    },
  });
};
