/**
 * BookingCalendarCard — visual mini-calendar for the dashboard.
 *
 * Shows a month grid with dots on days that have bookings.
 * Clicking a day shows that day's bookings inline. Links to
 * /bookingpro for full management.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { useUpcomingBookings } from "@/hooks/useShopBooking";

const statusDot: Record<string, string> = {
  pending: "bg-amber-400",
  confirmed: "bg-[#22c55e]",
  declined: "bg-red-400",
  completed: "bg-blue-400",
  cancelled: "bg-white/20",
};

const DAY_HEADERS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export const BookingCalendarCard = ({ className }: { className?: string }) => {
  const { data: bookings = [], isLoading } = useUpcomingBookings();
  const [viewDate, setViewDate] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const prevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1));

  const monthLabel = viewDate.toLocaleString("en-US", { month: "long", year: "numeric" });

  const bookingsByDate = useMemo(() => {
    const map = new Map<string, typeof bookings>();
    for (const b of bookings) {
      const key = new Date(b.scheduled_at).toISOString().slice(0, 10);
      const arr = map.get(key) || [];
      arr.push(b);
      map.set(key, arr);
    }
    return map;
  }, [bookings]);

  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPad = firstDay.getDay();
    const totalDays = lastDay.getDate();

    const days: Array<{ day: number; key: string; inMonth: boolean }> = [];

    const prevLast = new Date(year, month, 0).getDate();
    for (let i = startPad - 1; i >= 0; i--) {
      const d = prevLast - i;
      const dt = new Date(year, month - 1, d);
      days.push({ day: d, key: dt.toISOString().slice(0, 10), inMonth: false });
    }

    for (let d = 1; d <= totalDays; d++) {
      const dt = new Date(year, month, d);
      days.push({ day: d, key: dt.toISOString().slice(0, 10), inMonth: true });
    }

    const remaining = 42 - days.length;
    for (let d = 1; d <= remaining; d++) {
      const dt = new Date(year, month + 1, d);
      days.push({ day: d, key: dt.toISOString().slice(0, 10), inMonth: false });
    }

    return days;
  }, [year, month]);

  const todayKey = new Date().toISOString().slice(0, 10);
  const selectedBookings = selectedDay ? bookingsByDate.get(selectedDay) || [] : [];
  const pendingCount = bookings.filter((b) => b.status === "pending").length;
  const confirmedCount = bookings.filter((b) => b.status === "confirmed").length;
  const unpaidCount = bookings.filter((b) => (b as any).payment_status === "unpaid" && b.status !== "declined" && b.status !== "cancelled").length;

  return (
    <div className={`rounded-2xl border border-[#48484a] bg-rp-surface overflow-hidden flex flex-col ${className || ""}`}>
      {/* Two-tone BookingPro header */}
      <div className="px-5 pt-5 pb-4 bg-gradient-to-r from-[#111] to-[#0d1a16] border-b border-white/10">
        <Link to="/bookingpro" className="group flex items-center justify-between">
          <h2 className="text-xl font-extrabold tracking-tight">
            <span className="text-white">Booking</span><span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">Pro</span>
          </h2>
          <span className="text-[10px] text-white/40 group-hover:text-[#00C7FF] flex items-center gap-1 transition-colors font-medium">
            Open <ArrowRight className="w-3 h-3" />
          </span>
        </Link>
        <p className="text-[11px] text-white/40 mt-1">Customer appointments &amp; schedule</p>
      </div>

      {/* Unpaid banner */}
      {unpaidCount > 0 && (
        <Link to="/bookingpro" className="block px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-center">
          <span className="text-xs font-bold text-red-400">{unpaidCount} UNPAID — CALL TO COLLECT</span>
        </Link>
      )}

      {/* Stats strip */}
      <div className="flex border-b border-white/5">
        <div className="flex-1 px-4 py-2.5 text-center border-r border-white/5">
          <div className="text-lg font-bold text-amber-400">{pendingCount}</div>
          <div className="text-[9px] uppercase tracking-wider text-white/30 font-semibold">Pending</div>
        </div>
        <div className="flex-1 px-4 py-2.5 text-center border-r border-white/5">
          <div className="text-lg font-bold text-[#22c55e]">{confirmedCount}</div>
          <div className="text-[9px] uppercase tracking-wider text-white/30 font-semibold">Confirmed</div>
        </div>
        <div className="flex-1 px-4 py-2.5 text-center">
          <div className="text-lg font-bold text-white">{bookings.length}</div>
          <div className="text-[9px] uppercase tracking-wider text-white/30 font-semibold">Total</div>
        </div>
      </div>

      <div className="p-5 flex flex-col">
        {/* Month nav */}
        <div className="flex items-center justify-between mb-3">
          <button onClick={prevMonth} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/10 text-white/60 hover:text-white transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-bold text-white">{monthLabel}</span>
          <button onClick={nextMonth} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/10 text-white/60 hover:text-white transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 mb-1.5">
          {DAY_HEADERS.map((d) => (
            <div key={d} className="text-center text-[10px] font-bold text-white/50 uppercase">
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-0.5">
          {calendarDays.map(({ day, key, inMonth }, i) => {
            const isToday = key === todayKey;
            const isSelected = key === selectedDay;
            const dayBookings = bookingsByDate.get(key) || [];
            const hasPending = dayBookings.some((b) => b.status === "pending");
            const hasConfirmed = dayBookings.some((b) => b.status === "confirmed");

            return (
              <button
                key={`${key}-${i}`}
                onClick={() => setSelectedDay(isSelected ? null : key)}
                className={[
                  "relative w-full aspect-square flex flex-col items-center justify-center rounded-lg text-xs font-medium transition-all",
                  !inMonth ? "text-white/20" : "text-white/90",
                  isToday && !isSelected ? "ring-1 ring-emerald-400/60 bg-emerald-400/5 text-emerald-400 font-bold" : "",
                  isSelected ? "bg-[#00C7FF]/20 text-[#00C7FF] font-bold ring-1 ring-[#00C7FF]/40" : "hover:bg-white/10",
                  dayBookings.length > 0 && !isSelected && !isToday && inMonth ? "bg-white/[0.04]" : "",
                ].join(" ")}
              >
                {day}
                {dayBookings.length > 0 && (
                  <div className="absolute bottom-0.5 flex gap-0.5">
                    {hasPending && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
                    {hasConfirmed && <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e]" />}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-4 mt-3 pt-2 border-t border-white/5">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <span className="text-[9px] text-white/40 font-medium">Pending</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#22c55e]" />
            <span className="text-[9px] text-white/40 font-medium">Confirmed</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full ring-1 ring-emerald-400/60 bg-emerald-400/10" />
            <span className="text-[9px] text-white/40 font-medium">Today</span>
          </div>
        </div>

        {/* Selected day bookings */}
        {selectedDay && (
          <div className="mt-3 pt-3 border-t border-white/10">
            <div className="text-[10px] uppercase tracking-wider text-white/50 font-bold mb-2">
              {new Date(selectedDay + "T00:00:00").toLocaleString("en-US", {
                weekday: "long", month: "short", day: "numeric",
              })}
            </div>
            {selectedBookings.length === 0 ? (
              <div className="text-xs text-white/40 py-3 text-center bg-white/[0.03] rounded-lg">No bookings this day</div>
            ) : (
              <div className="space-y-1.5">
                {selectedBookings.map((b) => {
                  const time = new Date(b.scheduled_at).toLocaleString("en-US", {
                    hour: "numeric", minute: "2-digit",
                  });
                  return (
                    <div key={b.id} className="bg-[#1a1a1a] rounded-lg px-3 py-2.5 border border-white/10">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot[b.status] || "bg-white/20"}`} />
                        <span className="text-xs font-bold text-white truncate">{b.service_name}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-white/60 mt-1 ml-4">
                        <Clock className="w-3 h-3" /> {time}
                        {b.customer_name && <span className="text-white/80">· {b.customer_name}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {isLoading && (
          <div className="text-[10px] text-white/30 text-center py-2 mt-2">Loading...</div>
        )}
      </div>
    </div>
  );
};
