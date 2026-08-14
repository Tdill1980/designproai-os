/**
 * UpcomingBookingsCard — dashboard card listing the next bookings.
 * Lives in the same row as ApproveProCard / quotes cards. Uses
 * useUpcomingBookings (RLS-scoped to the user's shop) with 30s
 * staleTime + 60s refetch interval.
 */

import { Calendar, Clock, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useUpcomingBookings } from "@/hooks/useShopBooking";

const statusStyle: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-300",
  confirmed: "bg-[#22c55e]/15 text-[#22c55e]",
  declined: "bg-red-500/15 text-red-300",
  completed: "bg-blue-500/15 text-blue-300",
  cancelled: "bg-white/10 text-white/40",
};

export const UpcomingBookingsCard = ({ className }: { className?: string }) => {
  const { data: bookings = [], isLoading } = useUpcomingBookings();

  return (
    <div
      className={[
        "rounded-2xl border border-[#48484a] bg-rp-surface p-5 flex flex-col",
        className || "",
      ].join(" ")}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-[#00C7FF]" />
          <h3 className="text-sm font-semibold">Upcoming bookings</h3>
          {bookings.length > 0 && (
            <span className="text-[10px] font-bold bg-[#00C7FF]/15 text-[#00C7FF] px-1.5 py-0.5 rounded">
              {bookings.length}
            </span>
          )}
        </div>
        <Link
          to="/admin/availability"
          className="text-xs text-white/50 hover:text-[#00C7FF] flex items-center gap-1"
        >
          Manage <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {isLoading ? (
        <div className="text-xs text-white/40 py-6 text-center">Loading...</div>
      ) : bookings.length === 0 ? (
        <div className="text-xs text-white/40 py-4 text-center border border-dashed border-white/10 rounded-lg">
          No bookings yet — share your /quote URL to start.
        </div>
      ) : (
        <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1">
          {bookings.slice(0, 8).map((b) => {
            const when = new Date(b.scheduled_at).toLocaleString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            });
            return (
              <div key={b.id} className="bg-[#1a1a1a] rounded-lg px-3 py-2 border border-white/5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold truncate">{b.service_name}</div>
                  <span
                    className={[
                      "text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded shrink-0",
                      statusStyle[b.status] || "bg-white/10 text-white/40",
                    ].join(" ")}
                  >
                    {b.status}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-white/60 mt-0.5">
                  <Clock className="w-3 h-3" /> {when}
                </div>
                <div className="text-[10px] text-white/40 truncate">
                  {b.customer_name || b.customer_email || "—"}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
