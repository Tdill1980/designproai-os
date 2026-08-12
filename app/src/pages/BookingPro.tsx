/**
 * BookingPro — shop-owner dashboard with live calendar + upcoming bookings.
 *
 * Top section: functional dashboard (upcoming bookings, shareable book link,
 * availability management, calendar preview).
 * Bottom section: marketing / upsell for QuickText bundle.
 */

import { useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/Header";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  useUpcomingBookings,
  useShopServices,
  useShopAvailability,
  computeAvailableSlots,
  groupSlotsByDate,
} from "@/hooks/useShopBooking";
import {
  Calendar, Clock, MessageSquareText, Smartphone, ArrowRight, Settings,
  Sparkles, CheckCircle2, Repeat, Zap, Database, ExternalLink,
  Copy, Users, AlertTriangle, Loader2, XCircle,
} from "lucide-react";

const db = supabase as never as { from: (t: string) => any };

const GRAD = "bg-gradient-to-r from-emerald-400 via-cyan-400 to-blue-500";
const GRAD_TEXT = "bg-clip-text text-transparent " + GRAD;

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const statusStyle: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-300",
  confirmed: "bg-[#22c55e]/15 text-[#22c55e]",
  declined: "bg-red-500/15 text-red-300",
  completed: "bg-blue-500/15 text-blue-300",
  cancelled: "bg-white/10 text-white/40",
};

const paymentStyle: Record<string, { bg: string; label: string }> = {
  unpaid: { bg: "bg-red-500/20 text-red-400 border border-red-500/30", label: "UNPAID — CALL TO COLLECT" },
  deposit_collected: { bg: "bg-amber-500/15 text-amber-300 border border-amber-500/20", label: "DEPOSIT COLLECTED" },
  paid: { bg: "bg-[#22c55e]/15 text-[#22c55e] border border-[#22c55e]/20", label: "PAID" },
  refunded: { bg: "bg-white/10 text-white/40 border border-white/10", label: "REFUNDED" },
};

interface ShopProfile { id: string; name: string; slug: string | null; }

const useMyShop = () => {
  return useQuery<ShopProfile | null>({
    queryKey: ["my-shop"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await db
        .from("shops")
        .select("id, name, slug")
        .eq("owner_user_id", user.id)
        .maybeSingle();
      return (data as ShopProfile) || null;
    },
  });
};

export default function BookingPro() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: shop, isLoading: shopLoading } = useMyShop();
  const { data: bookings = [], isLoading: bookingsLoading } = useUpcomingBookings();
  const { data: services = [] } = useShopServices(shop?.id);
  const { data: availability = [] } = useShopAvailability(shop?.id);

  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const bookUrl = shop?.slug
    ? `${window.location.origin}/book/${shop.slug}`
    : null;

  const quoteUrl = shop?.slug
    ? `${window.location.origin}/quote/${shop.slug}`
    : null;

  const copyLink = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success("Link copied to clipboard");
  };

  const updateStatus = async (id: string, status: string) => {
    setUpdatingId(id);
    try {
      const { error } = await db
        .from("customer_bookings")
        .update({ status })
        .eq("id", id);
      if (error) throw error;

      if (status === "confirmed") {
        await supabase.functions.invoke("send-booking-confirmation", {
          body: { bookingId: id },
        }).catch(() => {});
      }

      qc.invalidateQueries({ queryKey: ["dashboard-upcoming-bookings"] });
      toast.success(`Booking ${status}`);
    } catch {
      toast.error("Failed to update booking");
    } finally {
      setUpdatingId(null);
    }
  };

  const updatePayment = async (id: string, payment_status: string) => {
    setUpdatingId(id);
    try {
      const update: Record<string, unknown> = { payment_status };
      if (payment_status === "paid" || payment_status === "deposit_collected") {
        update.payment_collected_at = new Date().toISOString();
      }
      const { error } = await db
        .from("customer_bookings")
        .update(update)
        .eq("id", id);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["dashboard-upcoming-bookings"] });
      toast.success(payment_status === "paid" ? "Marked as paid" : `Payment status: ${payment_status}`);
    } catch {
      toast.error("Failed to update payment");
    } finally {
      setUpdatingId(null);
    }
  };

  const pendingCount = bookings.filter((b) => b.status === "pending").length;
  const confirmedCount = bookings.filter((b) => b.status === "confirmed").length;
  const unpaidCount = bookings.filter((b) => b.payment_status === "unpaid" && b.status !== "declined" && b.status !== "cancelled").length;

  // Mini calendar: build a 14-day preview from the first service
  const previewService = services[0];
  const previewSlots = useMemo(() => {
    if (!previewService || availability.length === 0) return [];
    return computeAvailableSlots(availability, previewService.duration_minutes, 14);
  }, [previewService, availability]);
  const previewGrouped = useMemo(() => groupSlotsByDate(previewSlots), [previewSlots]);
  const previewDates = useMemo(() => Array.from(previewGrouped.keys()).slice(0, 7), [previewGrouped]);

  // Loading / no-shop states
  if (shopLoading) {
    return (
      <div className="min-h-screen bg-black text-white">
        <Header />
        <div className="flex items-center justify-center py-32">
          <Loader2 className="w-8 h-8 animate-spin text-[#00C7FF]" />
        </div>
      </div>
    );
  }

  if (!shop) {
    return (
      <div className="min-h-screen bg-black text-white">
        <Header />
        <div className="max-w-lg mx-auto px-6 py-32 text-center">
          <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">No shop profile found</h1>
          <p className="text-white/60 mb-6">
            BookingPro needs a shop profile to work. Set up your shop first.
          </p>
          <Button onClick={() => navigate("/admin/shop-settings")}>
            Go to Shop Settings
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <Helmet>
        <title>BookingPro — Calendar | RestyleProAI</title>
        <meta name="description" content="BookingPro — manage your booking calendar and upcoming appointments." />
      </Helmet>
      <Header />

      <div className="max-w-6xl mx-auto px-6 pt-8 pb-24">

        {/* ── HEADER ROW ───────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Calendar className="w-6 h-6 text-emerald-400" />
              <h1 className="text-3xl font-bold">BookingPro</h1>
            </div>
            <p className="text-white/50 text-sm">{shop.name} — calendar &amp; appointments</p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/admin/availability")}
              className="border-white/10 bg-transparent hover:bg-white/5"
            >
              <Settings className="w-4 h-4 mr-2" />
              Manage Availability
            </Button>
            {bookUrl && (
              <Button
                size="sm"
                onClick={() => window.open(bookUrl, "_blank")}
                className={`${GRAD} text-white font-semibold hover:opacity-90`}
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                View Public Page
              </Button>
            )}
          </div>
        </div>

        {/* ── STATS + SHARE LINKS ──────────────────────────── */}
        <div className="grid sm:grid-cols-5 gap-4 mb-8">
          {unpaidCount > 0 && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-5 py-4">
              <div className="text-xs text-red-400 uppercase tracking-wider mb-1 font-bold">Unpaid</div>
              <div className="text-3xl font-bold text-red-400">{unpaidCount}</div>
            </div>
          )}
          <div className="rounded-xl border border-white/10 bg-[#0d0d0d] px-5 py-4">
            <div className="text-xs text-white/40 uppercase tracking-wider mb-1">Pending</div>
            <div className="text-3xl font-bold text-amber-400">{pendingCount}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#0d0d0d] px-5 py-4">
            <div className="text-xs text-white/40 uppercase tracking-wider mb-1">Confirmed</div>
            <div className="text-3xl font-bold text-[#22c55e]">{confirmedCount}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#0d0d0d] px-5 py-4">
            <div className="text-xs text-white/40 uppercase tracking-wider mb-1">Services</div>
            <div className="text-3xl font-bold text-[#00C7FF]">{services.length}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#0d0d0d] px-5 py-4">
            <div className="text-xs text-white/40 uppercase tracking-wider mb-1">Total Upcoming</div>
            <div className="text-3xl font-bold">{bookings.length}</div>
          </div>
        </div>

        {/* Shareable links */}
        <div className="grid sm:grid-cols-2 gap-4 mb-8">
          {bookUrl && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-5 py-3 flex items-center gap-3">
              <Calendar className="w-5 h-5 text-emerald-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-emerald-400 font-semibold uppercase tracking-wider">Booking Link</div>
                <div className="text-sm text-white/70 truncate">{bookUrl}</div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => copyLink(bookUrl)} className="shrink-0 text-white/50 hover:text-white">
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          )}
          {quoteUrl && (
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-5 py-3 flex items-center gap-3">
              <Zap className="w-5 h-5 text-[#00C7FF] shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-[#00C7FF] font-semibold uppercase tracking-wider">Quote + Book Link</div>
                <div className="text-sm text-white/70 truncate">{quoteUrl}</div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => copyLink(quoteUrl)} className="shrink-0 text-white/50 hover:text-white">
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>

        {/* ── MAIN CONTENT: BOOKINGS + CALENDAR ────────────── */}
        <div className="grid lg:grid-cols-3 gap-6">

          {/* LEFT: Upcoming bookings list */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Users className="w-5 h-5 text-[#00C7FF]" />
                Upcoming Bookings
              </h2>
              <Link to="/admin/availability" className="text-xs text-white/40 hover:text-[#00C7FF]">
                View all &rarr;
              </Link>
            </div>

            {bookingsLoading ? (
              <div className="rounded-xl border border-white/10 bg-[#0d0d0d] p-8 text-center">
                <Loader2 className="w-6 h-6 animate-spin text-[#00C7FF] mx-auto" />
              </div>
            ) : bookings.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 bg-[#0d0d0d] p-10 text-center">
                <Calendar className="w-8 h-8 text-white/20 mx-auto mb-3" />
                <p className="text-white/40 text-sm mb-4">No upcoming bookings yet</p>
                {bookUrl && (
                  <p className="text-xs text-white/30">
                    Share your booking link to start receiving appointments.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {bookings.slice(0, 15).map((b) => {
                  const when = new Date(b.scheduled_at);
                  const dateStr = when.toLocaleString("en-US", {
                    weekday: "short", month: "short", day: "numeric",
                  });
                  const timeStr = when.toLocaleString("en-US", {
                    hour: "numeric", minute: "2-digit",
                  });
                  const vehicle = [b.vehicle_year, b.vehicle_make, b.vehicle_model].filter(Boolean).join(" ");
                  const isUpdating = updatingId === b.id;
                  const thumb = b.attachment_urls?.[0];
                  const extraPhotos = (b.attachment_urls?.length || 0) - 1;

                  const ps = paymentStyle[b.payment_status] || paymentStyle.unpaid;
                  const isUnpaid = b.payment_status === "unpaid";

                  return (
                    <div key={b.id} className={`rounded-xl overflow-hidden ${isUnpaid ? "border border-red-500/30" : "border border-white/10"} bg-[#0d0d0d]`}>
                      {/* Payment status banner */}
                      <div className={`px-4 py-2 flex items-center justify-between text-xs font-bold ${ps.bg}`}>
                        <span>{ps.label}</span>
                        {b.base_price && b.base_price > 0 && (
                          <span className="text-sm">${Number(b.base_price).toFixed(0)}</span>
                        )}
                      </div>
                      <div className="flex">
                        {/* Thumbnail */}
                        {thumb ? (
                          <div className="w-24 sm:w-28 shrink-0 bg-[#1a1a1a] relative">
                            <img src={thumb} alt="Reference" className="w-full h-full object-cover min-h-[100px]" />
                            {extraPhotos > 0 && (
                              <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
                                +{extraPhotos}
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="w-24 sm:w-28 shrink-0 bg-[#1a1a1a] flex items-center justify-center min-h-[100px]">
                            <Calendar className="w-6 h-6 text-white/10" />
                          </div>
                        )}

                        {/* Card body */}
                        <div className="flex-1 min-w-0 p-4">
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="font-bold text-sm text-white">{b.service_name}</span>
                            <span className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${statusStyle[b.status] || "bg-white/10 text-white/40"}`}>
                              {b.status}
                            </span>
                          </div>

                          {/* Labeled details */}
                          <div className="space-y-1 text-xs">
                            <div className="flex items-center gap-1.5 text-white/70">
                              <Calendar className="w-3 h-3 text-[#00C7FF] shrink-0" />
                              <span className="font-medium">{dateStr}</span>
                              <span className="text-white/40">at</span>
                              <span className="font-medium">{timeStr}</span>
                              {b.duration_minutes > 0 && (
                                <span className="text-white/40 ml-1">({b.duration_minutes < 60 ? `${b.duration_minutes}m` : `${Math.round(b.duration_minutes / 60)}h`})</span>
                              )}
                            </div>

                            {vehicle && (
                              <div className="flex items-center gap-1.5 text-white/70">
                                <span className="text-[9px] uppercase tracking-wider text-white/30 font-bold w-12 shrink-0">Vehicle</span>
                                <span className="font-medium">{vehicle}</span>
                              </div>
                            )}

                            <div className="flex items-center gap-1.5 text-white/70">
                              <span className="text-[9px] uppercase tracking-wider text-white/30 font-bold w-12 shrink-0">Client</span>
                              <span>{b.customer_name || "—"}</span>
                              {b.customer_phone && <span className="text-white/40">· {b.customer_phone}</span>}
                            </div>

                            {b.base_price && b.base_price > 0 && (
                              <div className="flex items-center gap-1.5">
                                <span className="text-[9px] uppercase tracking-wider text-white/30 font-bold w-12 shrink-0">Price</span>
                                <span className="text-[#22c55e] font-semibold">${Number(b.base_price).toFixed(0)}</span>
                              </div>
                            )}
                          </div>

                          {b.notes && (
                            <div className="text-[11px] text-white/40 mt-2 italic bg-white/[0.03] rounded px-2 py-1">"{b.notes}"</div>
                          )}

                          {/* Payment actions */}
                          {isUnpaid && b.status !== "declined" && b.status !== "cancelled" && (
                            <div className="flex items-center gap-2 mt-3">
                              <button
                                disabled={isUpdating}
                                onClick={() => updatePayment(b.id, "deposit_collected")}
                                className="rounded-lg bg-amber-500/15 text-amber-300 px-3 py-1.5 text-xs font-semibold hover:bg-amber-500/25 transition-colors disabled:opacity-50"
                              >
                                {isUpdating ? <Loader2 className="w-3 h-3 animate-spin" /> : "Deposit Collected"}
                              </button>
                              <button
                                disabled={isUpdating}
                                onClick={() => updatePayment(b.id, "paid")}
                                className="rounded-lg bg-[#22c55e]/15 text-[#22c55e] px-3 py-1.5 text-xs font-semibold hover:bg-[#22c55e]/25 transition-colors disabled:opacity-50"
                              >
                                {isUpdating ? <Loader2 className="w-3 h-3 animate-spin" /> : "Mark Paid"}
                              </button>
                            </div>
                          )}
                          {b.payment_status === "deposit_collected" && (
                            <div className="flex items-center gap-2 mt-3">
                              <button
                                disabled={isUpdating}
                                onClick={() => updatePayment(b.id, "paid")}
                                className="rounded-lg bg-[#22c55e]/15 text-[#22c55e] px-3 py-1.5 text-xs font-semibold hover:bg-[#22c55e]/25 transition-colors disabled:opacity-50"
                              >
                                {isUpdating ? <Loader2 className="w-3 h-3 animate-spin" /> : "Mark Paid in Full"}
                              </button>
                            </div>
                          )}

                          {/* Booking status actions */}
                          {b.status === "pending" && (
                            <div className="flex items-center gap-2 mt-2">
                              <button
                                disabled={isUpdating}
                                onClick={() => updateStatus(b.id, "confirmed")}
                                className="rounded-lg bg-[#22c55e]/15 text-[#22c55e] px-3 py-1.5 text-xs font-semibold hover:bg-[#22c55e]/25 transition-colors disabled:opacity-50"
                              >
                                {isUpdating ? <Loader2 className="w-3 h-3 animate-spin" /> : <><CheckCircle2 className="w-3 h-3 inline mr-1" />Confirm</>}
                              </button>
                              <button
                                disabled={isUpdating}
                                onClick={() => updateStatus(b.id, "declined")}
                                className="rounded-lg bg-red-500/10 text-red-400 px-3 py-1.5 text-xs font-semibold hover:bg-red-500/20 transition-colors disabled:opacity-50"
                              >
                                <XCircle className="w-3 h-3 inline mr-1" />Decline
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* RIGHT: Calendar preview + services */}
          <div className="space-y-5">
            {/* Mini calendar preview */}
            <div className="rounded-xl border border-white/10 bg-[#0d0d0d] p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-emerald-400" />
                  Availability Preview
                </h3>
                <Link to="/admin/availability" className="text-[10px] text-white/40 hover:text-[#00C7FF]">
                  Edit
                </Link>
              </div>

              {availability.length === 0 ? (
                <div className="text-xs text-white/40 text-center py-6 border border-dashed border-white/10 rounded-lg">
                  No availability set.{" "}
                  <Link to="/admin/availability" className="text-[#00C7FF] hover:underline">Set up hours</Link>
                </div>
              ) : (
                <div className="space-y-2">
                  {previewDates.map((dateKey) => {
                    const daySlots = previewGrouped.get(dateKey) || [];
                    const d = new Date(dateKey + "T00:00:00");
                    const label = d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
                    return (
                      <div key={dateKey}>
                        <div className="text-[10px] font-semibold text-white/50 mb-1">{label}</div>
                        <div className="flex flex-wrap gap-1">
                          {daySlots.slice(0, 6).map((slot) => (
                            <span key={slot.iso} className="rounded border border-white/10 bg-[#1a1a1a] px-2 py-0.5 text-[10px] text-white/60">
                              {slot.label}
                            </span>
                          ))}
                          {daySlots.length > 6 && (
                            <span className="text-[10px] text-white/30 px-1">+{daySlots.length - 6} more</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Services */}
            <div className="rounded-xl border border-white/10 bg-[#0d0d0d] p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">Your Services</h3>
                <Link to="/admin/availability" className="text-[10px] text-white/40 hover:text-[#00C7FF]">
                  Manage
                </Link>
              </div>
              {services.length === 0 ? (
                <div className="text-xs text-white/40 text-center py-4 border border-dashed border-white/10 rounded-lg">
                  No services configured.{" "}
                  <Link to="/admin/availability" className="text-[#00C7FF] hover:underline">Add services</Link>
                </div>
              ) : (
                <div className="space-y-2">
                  {services.map((s) => (
                    <div key={s.slug} className="bg-[#1a1a1a] rounded-lg px-3 py-2 border border-white/5">
                      <div className="text-xs font-semibold">{s.name}</div>
                      <div className="flex items-center gap-3 text-[10px] text-white/40 mt-0.5">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {s.duration_minutes < 60 ? `${s.duration_minutes}m` : `${Math.round(s.duration_minutes / 60)}h`}
                        </span>
                        {s.base_price > 0 && (
                          <span className="text-emerald-400 font-semibold">${s.base_price.toFixed(0)}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Weekly hours summary */}
            <div className="rounded-xl border border-white/10 bg-[#0d0d0d] p-5">
              <h3 className="text-sm font-semibold mb-3">Weekly Hours</h3>
              {availability.length === 0 ? (
                <div className="text-xs text-white/40">Not configured</div>
              ) : (
                <div className="space-y-1">
                  {[0, 1, 2, 3, 4, 5, 6].map((dow) => {
                    const windows = availability.filter((w) => w.day_of_week === dow);
                    return (
                      <div key={dow} className="flex items-center justify-between text-xs">
                        <span className={`font-medium ${windows.length > 0 ? "text-white/70" : "text-white/25"}`}>
                          {DAY_NAMES[dow]}
                        </span>
                        <span className={windows.length > 0 ? "text-emerald-400" : "text-white/20"}>
                          {windows.length > 0
                            ? windows.map((w) => `${w.start_time.slice(0, 5)}–${w.end_time.slice(0, 5)}`).join(", ")
                            : "Closed"
                          }
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── MARKETING / UPSELL ─────────────────────────────── */}
        <section className="mt-20 border-t border-[#1A1A1A] pt-16">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/5 mb-4">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-xs uppercase tracking-wider text-cyan-400">Level up</span>
            </div>
            <h2 className="text-3xl md:text-4xl font-bold mb-3">
              Plays alone. <span className={GRAD_TEXT}>Better in the suite.</span>
            </h2>
            <p className="text-gray-400 max-w-2xl mx-auto">
              BookingPro works on its own. Wire it into QuickQuote and QuickText for the full lead engine.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              { icon: Calendar, title: "Set your availability", body: "Weekly hours + service durations. Full wrap = 4 days, chrome delete = 6 hours. Block lunch, block days off." },
              { icon: Smartphone, title: "Customer picks a slot", body: "Mobile-first slot picker. Share the link on your QuickQuote, website, or socials. They tap, confirm, done." },
              { icon: MessageSquareText, title: "SMS confirms + reminds", body: "Auto-confirmation through your QuickText number. 24h reminder text. Reschedule with one tap." },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-2xl border border-[#1A1A1A] bg-[#0A0A0A] p-6">
                <div className={`w-10 h-10 rounded-xl ${GRAD} flex items-center justify-center mb-4`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <h3 className="text-lg font-semibold mb-2">{title}</h3>
                <p className="text-gray-400 text-sm leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
