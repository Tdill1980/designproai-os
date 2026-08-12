/**
 * AppointmentsTab — Admin view of customer-facing bookings created via
 * the public BookingPro slot picker (BookingCalendar component on the
 * /quote/:shopSlug page). Lives inside AdminQuickQuote as a tab so
 * shop owners see quotes and bookings in one workflow.
 *
 * Data source: public.customer_bookings (RLS scopes to the user's
 * shop). Currently every row in this table came in through the public
 * widget — staff-entered bookings will land here too once that path
 * exists. The tab is positioned as the marketing receipt for the
 * BookingPro sales page: "see exactly which jobs the tool generated."
 */

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  DollarSign,
  Loader2,
  Mail,
  Phone,
  TrendingUp,
  Users,
  XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

const db = supabase as never as { from: (t: string) => any };

interface BookingRow {
  id: string;
  shop_id: string;
  quote_id: string | null;
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
  created_at: string;
  /** 'public_widget' = customer self-served via /quote/:slug
   *  'staff_manual' = entered manually by shop team in admin */
  entry_source: string | null;
}

const STATUS_BADGES: Record<string, { label: string; classes: string }> = {
  pending:   { label: "Pending",   classes: "bg-amber-50 text-amber-700 border-amber-200" },
  confirmed: { label: "Confirmed", classes: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  declined:  { label: "Declined",  classes: "bg-rose-50 text-rose-700 border-rose-200" },
  completed: { label: "Completed", classes: "bg-cyan-50 text-cyan-700 border-cyan-200" },
  cancelled: { label: "Cancelled", classes: "bg-zinc-100 text-zinc-600 border-zinc-200" },
};

function formatScheduled(iso: string) {
  const d = new Date(iso);
  return {
    short: d.toLocaleString("en-US", { month: "short", day: "numeric", weekday: "short" }),
    time: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
  };
}

export const AppointmentsTab = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  const { data: bookings, isLoading } = useQuery<BookingRow[]>({
    queryKey: ["admin-customer-bookings"],
    queryFn: async () => {
      const { data, error } = await db
        .from("customer_bookings")
        .select(
          `id, shop_id, quote_id, service_slug, service_name,
           customer_name, customer_email, customer_phone,
           vehicle_year, vehicle_make, vehicle_model,
           scheduled_at, duration_minutes, base_price,
           status, notes, created_at, entry_source`
        )
        .order("scheduled_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data || []) as BookingRow[];
    },
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  const fireConfirmationEmail = (row: BookingRow) => {
    if (!row.customer_email) {
      toast({
        title: "No email on file",
        description: `${row.customer_name || "Customer"} doesn't have an email — booking confirmed but no email sent.`,
      });
      return;
    }
    // Fire-and-forget; the approve action shouldn't block UI on Resend latency.
    // The body shape matches the existing send-booking-confirmation function on
    // main, which expects `bookingId` (camelCase).
    supabase.functions
      .invoke("send-booking-confirmation", { body: { bookingId: row.id } })
      .then((res) => {
        if (res.error) {
          toast({
            title: "Confirmation email failed",
            description: res.error.message,
            variant: "destructive",
          });
          return;
        }
        toast({
          title: "Confirmation email sent",
          description: `${row.customer_email} received the booking details.`,
        });
      });
  };

  const updateStatus = async (row: BookingRow, nextStatus: string) => {
    const prev = row.status;
    const { error } = await db
      .from("customer_bookings")
      .update({ status: nextStatus })
      .eq("id", row.id);
    if (error) {
      toast({
        title: "Status update failed",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    toast({
      title: `Marked ${nextStatus}`,
      description: `${row.customer_name || "Booking"} moved from ${prev} to ${nextStatus}.`,
    });
    queryClient.invalidateQueries({ queryKey: ["admin-customer-bookings"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-upcoming-bookings"] });

    // When a shop owner approves a pending booking, also send the
    // branded confirmation email so the customer hears back the same
    // moment the appointment is confirmed in the dashboard.
    if (nextStatus === "confirmed" && prev === "pending") {
      fireConfirmationEmail(row);
    }
  };

  // Stats are computed off the unfiltered list so the metric tiles
  // reflect the whole shop, not the current filter chip.
  const stats = useMemo(() => {
    const all = bookings || [];
    const total = all.length;
    const now = Date.now();
    const oneWeek = now + 7 * 24 * 60 * 60 * 1000;
    const upcomingThisWeek = all.filter((b) => {
      const t = new Date(b.scheduled_at).getTime();
      return t >= now && t < oneWeek && !["declined", "cancelled"].includes(b.status);
    }).length;
    const closed = all.filter((b) => ["confirmed", "completed"].includes(b.status));
    const confirmationRate = total > 0 ? Math.round((closed.length / total) * 100) : 0;
    const ticketSum = closed.reduce((sum, b) => sum + (Number(b.base_price) || 0), 0);
    const avgTicket = closed.length > 0 ? Math.round(ticketSum / closed.length) : 0;
    return { total, upcomingThisWeek, confirmationRate, avgTicket };
  }, [bookings]);

  const filtered = useMemo(() => {
    let result = bookings || [];

    if (statusFilter !== "all") {
      result = result.filter((r) => r.status === statusFilter);
    }

    if (sourceFilter !== "all") {
      // entry_source defaults to 'public_widget' on rows from the
      // public submit-public-booking edge function. Older rows that
      // pre-date the migration will be NULL — treat them as self-serve
      // since that was the only insert path before staff entry existed.
      result = result.filter((r) => {
        const src = r.entry_source || "public_widget";
        return src === sourceFilter;
      });
    }

    if (dateFilter !== "all") {
      const days = parseInt(dateFilter);
      const since = Date.now() - days * 24 * 60 * 60 * 1000;
      result = result.filter((r) => new Date(r.scheduled_at).getTime() >= since);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((row) => {
        return (
          (row.customer_name || "").toLowerCase().includes(q) ||
          (row.customer_email || "").toLowerCase().includes(q) ||
          (row.customer_phone || "").includes(q) ||
          (row.service_name || "").toLowerCase().includes(q) ||
          `${row.vehicle_year || ""} ${row.vehicle_make || ""} ${row.vehicle_model || ""}`
            .toLowerCase()
            .includes(q)
        );
      });
    }

    return result;
  }, [bookings, search, statusFilter, dateFilter, sourceFilter]);

  const tiles = [
    {
      label: "Self-Serve Bookings",
      value: stats.total,
      hint: "All-time bookings via your public booking page",
      icon: Users,
      color: "text-cyan-600",
    },
    {
      label: "Upcoming This Week",
      value: stats.upcomingThisWeek,
      hint: "Confirmed or pending in the next 7 days",
      icon: CalendarClock,
      color: "text-emerald-600",
    },
    {
      label: "Confirmation Rate",
      value: `${stats.confirmationRate}%`,
      hint: "Bookings approved or completed",
      icon: TrendingUp,
      color: "text-fuchsia-600",
    },
    {
      label: "Avg Ticket",
      value: stats.avgTicket > 0 ? `$${stats.avgTicket}` : "—",
      hint: "Mean base price of confirmed bookings",
      icon: DollarSign,
      color: "text-orange-600",
    },
  ];

  return (
    <div className="space-y-4">
      {/* Marketing-receipt callout */}
      <div className="rounded-xl border border-cyan-200 bg-gradient-to-br from-cyan-50 to-fuchsia-50 px-4 py-3 flex items-center gap-3">
        <CalendarClock className="w-5 h-5 text-cyan-600 shrink-0" />
        <div className="flex-1 text-sm">
          <p className="font-bold text-[#111]">BookingPro · Self-Serve Receipts</p>
          <p className="text-[12px] text-[#6b7280] mt-0.5">
            Every appointment below was booked by a customer through your public booking page.
            This is the proof that BookingPro is generating jobs for you.
          </p>
        </div>
      </div>

      {/* Metric tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {tiles.map(({ label, value, hint, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-xl border border-[#e5e7eb] p-3.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className={cn("text-2xl font-bold", color)}>{value}</p>
                <p className="text-xs text-[#6b7280] mt-0.5">{label}</p>
              </div>
              <Icon className={cn("w-4 h-4 shrink-0 mt-1", color, "opacity-60")} />
            </div>
            <p className="text-[10px] text-[#9ca3af] mt-1.5">{hint}</p>
          </div>
        ))}
      </div>

      {/* Toolbar + table */}
      <div className="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#e5e7eb] space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-[#111]">
              Appointments
              <span className="ml-2 text-[10px] font-normal text-[#6b7280]">
                {filtered.length} of {bookings?.length || 0}
              </span>
            </h3>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customer, vehicle, service"
              className="max-w-xs h-8 text-sm"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-7 text-[11px] font-semibold rounded-md border border-[#d1d5db] bg-white text-[#374151] px-2 cursor-pointer"
            >
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="completed">Completed</option>
              <option value="declined">Declined</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="h-7 text-[11px] font-semibold rounded-md border border-[#d1d5db] bg-white text-[#374151] px-2 cursor-pointer"
            >
              <option value="all">All sources</option>
              <option value="public_widget">Self-Serve (widget)</option>
              <option value="staff_manual">Staff (manual)</option>
            </select>
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="h-7 text-[11px] font-semibold rounded-md border border-[#d1d5db] bg-white text-[#374151] px-2 cursor-pointer"
            >
              <option value="all">All time</option>
              <option value="1">Today</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
            {(statusFilter !== "all" || dateFilter !== "all" || sourceFilter !== "all") && (
              <button
                onClick={() => {
                  setStatusFilter("all");
                  setDateFilter("all");
                  setSourceFilter("all");
                }}
                className="h-7 text-[11px] font-semibold text-[#ef4444] hover:text-[#dc2626] px-2"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {/* Header row */}
        <div className="grid grid-cols-[110px_1fr_1fr_0.85fr_75px_95px_90px_170px] items-center gap-3 px-4 py-2 bg-[#f3f4f6] text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">
          <div>When</div>
          <div>Customer</div>
          <div>Vehicle</div>
          <div>Service</div>
          <div className="text-right">Price</div>
          <div className="text-center">Status</div>
          <div className="text-center">Source</div>
          <div className="text-right">Actions</div>
        </div>

        {/* Rows */}
        {isLoading && (
          <div className="py-10 flex items-center justify-center text-[#6b7280]">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            Loading appointments…
          </div>
        )}
        {!isLoading && filtered.length === 0 && (
          <div className="py-10 text-center text-[#6b7280] text-sm">
            <p>No self-serve bookings yet.</p>
            <p className="text-xs text-[#9ca3af] mt-1">
              Share your booking link with customers — every appointment they book will land here.
            </p>
          </div>
        )}
        {!isLoading &&
          filtered.map((row) => {
            const { short, time } = formatScheduled(row.scheduled_at);
            const vehicle = [row.vehicle_year, row.vehicle_make, row.vehicle_model]
              .filter(Boolean)
              .join(" ");
            const badge = STATUS_BADGES[row.status] || STATUS_BADGES.pending;
            const hasPrice = row.base_price != null && row.base_price > 0;
            const isPending = row.status === "pending";
            const isConfirmed = row.status === "confirmed";

            const source = row.entry_source || "public_widget";
            const sourceBadge = source === "staff_manual"
              ? { label: "Staff", classes: "bg-zinc-100 text-zinc-700 border-zinc-300" }
              : { label: "Self-Serve", classes: "bg-cyan-50 text-cyan-700 border-cyan-200" };

            return (
              <div
                key={row.id}
                className="grid grid-cols-[110px_1fr_1fr_0.85fr_75px_95px_90px_170px] items-start gap-3 px-4 py-4 border-t border-[#e5e7eb] hover:bg-[#fafafa] transition-colors"
              >
                {/* When */}
                <div className="text-[12px] text-[#111] leading-tight">
                  <p className="font-semibold">{short}</p>
                  <p className="text-[#6b7280] flex items-center gap-1 mt-0.5">
                    <Clock className="w-3 h-3" /> {time}
                  </p>
                  <p className="text-[10px] text-[#9ca3af] mt-0.5">{row.duration_minutes}m</p>
                </div>

                {/* Customer */}
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-[#111] truncate">
                    {row.customer_name || "—"}
                  </p>
                  {row.customer_email && (
                    <p className="text-[12px] text-[#0891b2] truncate">{row.customer_email}</p>
                  )}
                  {row.customer_phone && (
                    <p className="text-[12px] text-[#0891b2] flex items-center gap-1 mt-0.5">
                      <Phone className="w-3 h-3" /> {row.customer_phone}
                    </p>
                  )}
                </div>

                {/* Vehicle */}
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-[#111] truncate">
                    {vehicle || "—"}
                  </p>
                  {row.notes && (
                    <p className="text-[11px] text-[#6b7280] line-clamp-2 mt-0.5">{row.notes}</p>
                  )}
                </div>

                {/* Service */}
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-[#111] truncate">
                    {row.service_name}
                  </p>
                  <p className="text-[10px] text-[#9ca3af] truncate">{row.service_slug}</p>
                </div>

                {/* Price */}
                <div className="text-right">
                  {hasPrice ? (
                    <p className="text-[13px] font-bold text-[#111]">
                      ${Number(row.base_price).toFixed(0)}
                    </p>
                  ) : (
                    <p className="text-[11px] text-[#9ca3af]">—</p>
                  )}
                </div>

                {/* Status */}
                <div className="text-center">
                  <span
                    className={cn(
                      "inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border",
                      badge.classes
                    )}
                  >
                    {badge.label}
                  </span>
                </div>

                {/* Source */}
                <div className="text-center">
                  <span
                    className={cn(
                      "inline-block text-[10px] font-semibold px-2 py-1 rounded-full border",
                      sourceBadge.classes
                    )}
                  >
                    {sourceBadge.label}
                  </span>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-1.5">
                  {isPending && (
                    <>
                      <button
                        onClick={() => updateStatus(row, "confirmed")}
                        className="h-8 px-2.5 rounded-md flex items-center gap-1 text-[11px] font-semibold border border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                        title="Approve booking"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                      </button>
                      <button
                        onClick={() => updateStatus(row, "declined")}
                        className="h-8 w-8 rounded-md flex items-center justify-center border border-rose-200 text-rose-700 hover:bg-rose-50"
                        title="Decline booking"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    </>
                  )}
                  {isConfirmed && (
                    <button
                      onClick={() => updateStatus(row, "completed")}
                      className="h-8 px-2.5 rounded-md flex items-center gap-1 text-[11px] font-semibold border border-cyan-200 text-cyan-700 hover:bg-cyan-50"
                      title="Mark complete"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> Complete
                    </button>
                  )}
                  {row.customer_phone && (
                    <a
                      href={`tel:${row.customer_phone}`}
                      className="h-8 w-8 rounded-md flex items-center justify-center border border-[#e5e7eb] text-[#16a34a] hover:bg-[#f0fdf4]"
                      title={`Call ${row.customer_phone}`}
                    >
                      <Phone className="w-4 h-4" />
                    </a>
                  )}
                  {row.customer_email && (
                    <a
                      href={`mailto:${row.customer_email}`}
                      className="h-8 w-8 rounded-md flex items-center justify-center border border-[#e5e7eb] text-[#0891b2] hover:bg-[#f0f9ff]"
                      title={`Email ${row.customer_email}`}
                    >
                      <Mail className="w-4 h-4" />
                    </a>
                  )}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
};
