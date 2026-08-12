/**
 * AdminAvailability — shop-owner-facing page to manage:
 *   1. Service catalog (which services they offer + price + duration)
 *   2. Weekly availability windows (day-of-week + start/end time)
 *   3. View incoming bookings + approve / decline / mark complete
 *
 * Lives at /admin/availability. RLS scopes everything to the user's shop.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, Clock, DollarSign, Save, Trash2, Plus, CheckCircle2, XCircle, Copy, ExternalLink } from "lucide-react";
import { Header } from "@/components/Header";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useUpcomingBookings } from "@/hooks/useShopBooking";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const db = supabase as any;

interface ShopProfile { id: string; name: string; slug: string | null; }
interface ServiceRow {
  id: string;
  shop_id: string;
  slug: string;
  name: string;
  description: string | null;
  base_price: number;
  duration_minutes: number;
  sort_order: number;
  is_active: boolean;
}
interface AvailabilityRow {
  id: string;
  shop_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
}

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

const useMyServices = (shopId: string | null | undefined) => {
  return useQuery<ServiceRow[]>({
    queryKey: ["my-services", shopId],
    enabled: !!shopId,
    queryFn: async () => {
      const { data } = await db
        .from("service_catalog")
        .select("*")
        .eq("shop_id", shopId)
        .order("sort_order", { ascending: true });
      return (data as ServiceRow[]) || [];
    },
  });
};

const useMyAvailability = (shopId: string | null | undefined) => {
  return useQuery<AvailabilityRow[]>({
    queryKey: ["my-availability", shopId],
    enabled: !!shopId,
    queryFn: async () => {
      const { data } = await db
        .from("shop_availability")
        .select("*")
        .eq("shop_id", shopId)
        .order("day_of_week", { ascending: true });
      return (data as AvailabilityRow[]) || [];
    },
  });
};

const AdminAvailability = () => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: shop, isLoading: shopLoading } = useMyShop();
  const { data: services = [], refetch: refetchServices } = useMyServices(shop?.id);
  const { data: availability = [], refetch: refetchAvail } = useMyAvailability(shop?.id);
  const { data: bookings = [], refetch: refetchBookings } = useUpcomingBookings();

  useEffect(() => {
    document.title = "Availability & Services — RestylePro";
  }, []);

  const updateService = async (id: string, patch: Partial<ServiceRow>) => {
    const { error } = await db.from("service_catalog").update(patch).eq("id", id);
    if (error) {
      toast({ variant: "destructive", title: "Save failed", description: error.message });
      return;
    }
    refetchServices();
  };

  const upsertWindow = async (row: Partial<AvailabilityRow>) => {
    if (row.id) {
      await db.from("shop_availability").update(row).eq("id", row.id);
    } else if (shop) {
      await db.from("shop_availability").insert({ ...row, shop_id: shop.id });
    }
    refetchAvail();
  };

  const deleteWindow = async (id: string) => {
    await db.from("shop_availability").delete().eq("id", id);
    refetchAvail();
  };

  const updateBooking = async (id: string, status: string) => {
    const { error } = await db.from("customer_bookings").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) {
      toast({ variant: "destructive", title: "Update failed", description: error.message });
      return;
    }
    qc.invalidateQueries({ queryKey: ["dashboard-upcoming-bookings"] });
    refetchBookings();
    toast({ title: `Marked ${status}` });
  };

  // ── Public booking page helpers ───────────────────────────────────────
  // Full origin-aware URL so shop owners can copy + paste straight into
  // bios, email signatures, "Get a Quote" buttons, QR codes, etc. without
  // having to mentally prefix the domain.
  const publicBookingUrl =
    shop?.slug && typeof window !== "undefined"
      ? `${window.location.origin}/quote/${shop.slug}`
      : null;

  const handleCopyLink = async () => {
    if (!publicBookingUrl) return;
    try {
      await navigator.clipboard.writeText(publicBookingUrl);
      toast({ title: "Booking link copied", description: publicBookingUrl });
    } catch {
      toast({
        variant: "destructive",
        title: "Copy failed",
        description: "Select the URL and copy it manually.",
      });
    }
  };

  // Inline slug setter — without a slug, the public page can't render and
  // the AppointmentsTab marketing receipt has no source data. The setter
  // updates the shops row directly; RLS scopes the UPDATE to the owner.
  const [slugDraft, setSlugDraft] = useState("");
  const [savingSlug, setSavingSlug] = useState(false);

  const handleSaveSlug = async () => {
    const cleaned = slugDraft
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!cleaned) {
      toast({
        variant: "destructive",
        title: "Pick a slug",
        description: "Lowercase letters, numbers, and dashes only.",
      });
      return;
    }
    if (!shop) return;
    setSavingSlug(true);
    const { error } = await db.from("shops").update({ slug: cleaned }).eq("id", shop.id);
    setSavingSlug(false);
    if (error) {
      toast({
        variant: "destructive",
        title: "Save failed",
        description: error.message.includes("duplicate")
          ? `"${cleaned}" is already taken — try another.`
          : error.message,
      });
      return;
    }
    qc.invalidateQueries({ queryKey: ["my-shop"] });
    toast({
      title: "Slug saved",
      description: `Your booking page is live at /quote/${cleaned}`,
    });
    setSlugDraft("");
  };

  const groupedAvail = useMemo(() => {
    const map: Record<number, AvailabilityRow[]> = {};
    for (let i = 0; i < 7; i++) map[i] = [];
    for (const w of availability) map[w.day_of_week].push(w);
    return map;
  }, [availability]);

  if (shopLoading) {
    return (
      <div className="min-h-screen bg-black text-white">
        <Header />
        <div className="p-12 text-center text-white/60">Loading...</div>
      </div>
    );
  }
  if (!shop) {
    return (
      <div className="min-h-screen bg-black text-white">
        <Header />
        <div className="p-12 text-center text-white/60">No shop attached to this account.</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <Header />
      <main className="max-w-5xl mx-auto px-6 py-8 space-y-10">
        <div>
          <h1 className="text-2xl font-bold">{shop.name} — Availability & Services</h1>
        </div>

        {/* ── Public Booking Page card ──────────────────────────────── */}
        <section className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-6">
          <div className="flex items-center gap-2 mb-4">
            <ExternalLink className="w-5 h-5 text-white/70" />
            <h2 className="text-lg font-semibold">Your public booking page</h2>
          </div>

          {publicBookingUrl ? (
            <>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1 bg-black border border-white/10 rounded-lg px-4 py-3 font-mono text-sm text-white/90 truncate">
                  {publicBookingUrl}
                </div>
                <button
                  onClick={handleCopyLink}
                  className="bg-[#00C7FF] text-black font-semibold px-4 py-3 rounded-lg flex items-center justify-center gap-2 hover:bg-[#00C7FF]/90"
                >
                  <Copy className="w-4 h-4" /> Copy Link
                </button>
                <a
                  href={publicBookingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="border border-white/20 text-white font-semibold px-4 py-3 rounded-lg flex items-center justify-center gap-2 hover:bg-white/5"
                >
                  Open <ExternalLink className="w-4 h-4" />
                </a>
              </div>
              <p className="text-xs text-white/50 mt-3 leading-relaxed">
                Share this link in your bio, email signature, "Get a Quote" button, or as a QR code on
                your shop window. Customers self-quote and book a slot in one flow — every booking lands
                in <span className="text-[#00C7FF]">/admin/quick-quote → Appointments</span>.
              </p>
            </>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
                No slug set yet — pick one to turn on your public booking page.
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1 flex items-stretch bg-black border border-white/10 rounded-lg overflow-hidden">
                  <span className="bg-white/5 px-3 py-3 text-sm text-white/40 font-mono whitespace-nowrap">
                    {typeof window !== "undefined" ? window.location.origin : ""}/quote/
                  </span>
                  <input
                    type="text"
                    value={slugDraft}
                    onChange={(e) => setSlugDraft(e.target.value)}
                    placeholder="your-shop"
                    className="flex-1 bg-transparent px-3 py-3 text-sm font-mono text-white outline-none"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </div>
                <button
                  onClick={handleSaveSlug}
                  disabled={savingSlug || !slugDraft.trim()}
                  className="bg-[#00C7FF] text-black font-semibold px-4 py-3 rounded-lg flex items-center justify-center gap-2 hover:bg-[#00C7FF]/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Save className="w-4 h-4" /> {savingSlug ? "Saving…" : "Save slug"}
                </button>
              </div>
              <p className="text-xs text-white/50 leading-relaxed">
                Lowercase letters, numbers, and dashes only. Once set, change with care — the URL
                becomes the link customers share, so changing it breaks anything already in the wild.
              </p>
            </div>
          )}
        </section>

        {/* ── Services ─────────────────────────── */}
        <section className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-[#00C7FF]" /> Services you offer
          </h2>
          <div className="space-y-3">
            {services.map((s) => (
              <div
                key={s.id}
                className="grid grid-cols-1 md:grid-cols-[1fr,90px,90px,90px,40px] gap-3 items-center bg-[#1a1a1a] border border-white/10 rounded-lg p-3"
              >
                <div>
                  <div className="font-semibold text-sm">{s.name}</div>
                  {s.description && <div className="text-xs text-white/50 mt-0.5">{s.description}</div>}
                </div>
                <input
                  type="number"
                  defaultValue={s.base_price}
                  onBlur={(e) => updateService(s.id, { base_price: parseFloat(e.target.value) || 0 })}
                  className="bg-black border border-white/10 rounded px-2 py-1.5 text-sm"
                  placeholder="Price"
                />
                <input
                  type="number"
                  defaultValue={s.duration_minutes}
                  onBlur={(e) =>
                    updateService(s.id, { duration_minutes: parseInt(e.target.value, 10) || 60 })
                  }
                  className="bg-black border border-white/10 rounded px-2 py-1.5 text-sm"
                  placeholder="Mins"
                />
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={s.is_active}
                    onChange={(e) => updateService(s.id, { is_active: e.target.checked })}
                  />
                  Active
                </label>
              </div>
            ))}
          </div>
        </section>

        {/* ── Availability ─────────────────────── */}
        <section className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-[#00C7FF]" /> Weekly availability
          </h2>
          <div className="space-y-3">
            {DAY_NAMES.map((name, dow) => {
              const wins = groupedAvail[dow] || [];
              return (
                <div
                  key={dow}
                  className="bg-[#1a1a1a] border border-white/10 rounded-lg p-3"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold text-sm">{name}</div>
                    <button
                      onClick={() =>
                        upsertWindow({ day_of_week: dow, start_time: "09:00", end_time: "17:00", is_active: true })
                      }
                      className="text-xs text-[#00C7FF] hover:underline flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" /> Add window
                    </button>
                  </div>
                  {wins.length === 0 ? (
                    <div className="text-xs text-white/40">Closed</div>
                  ) : (
                    <div className="space-y-2">
                      {wins.map((w) => (
                        <div key={w.id} className="flex items-center gap-2">
                          <input
                            type="time"
                            defaultValue={w.start_time.slice(0, 5)}
                            onBlur={(e) => upsertWindow({ id: w.id, start_time: e.target.value })}
                            className="bg-black border border-white/10 rounded px-2 py-1 text-sm"
                          />
                          <span className="text-white/40">→</span>
                          <input
                            type="time"
                            defaultValue={w.end_time.slice(0, 5)}
                            onBlur={(e) => upsertWindow({ id: w.id, end_time: e.target.value })}
                            className="bg-black border border-white/10 rounded px-2 py-1 text-sm"
                          />
                          <label className="flex items-center gap-1.5 text-xs ml-2">
                            <input
                              type="checkbox"
                              checked={w.is_active}
                              onChange={(e) => upsertWindow({ id: w.id, is_active: e.target.checked })}
                            />
                            Active
                          </label>
                          <button
                            onClick={() => deleteWindow(w.id)}
                            className="ml-auto text-white/40 hover:text-red-400"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Upcoming bookings ────────────────── */}
        <section className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-[#00C7FF]" /> Upcoming bookings
          </h2>
          {bookings.length === 0 ? (
            <div className="text-sm text-white/50 py-6 text-center border border-dashed border-white/10 rounded-lg">
              No bookings yet. Share /quote/{shop.slug} to start collecting.
            </div>
          ) : (
            <div className="space-y-2">
              {bookings.map((b) => {
                const when = new Date(b.scheduled_at).toLocaleString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                });
                const vehicle = [b.vehicle_year, b.vehicle_make, b.vehicle_model].filter(Boolean).join(" ");
                return (
                  <div
                    key={b.id}
                    className="grid grid-cols-1 md:grid-cols-[1fr,auto] gap-3 items-center bg-[#1a1a1a] border border-white/10 rounded-lg p-3"
                  >
                    <div>
                      <div className="text-sm font-semibold">{b.service_name}</div>
                      <div className="text-xs text-white/60 mt-0.5">{when}</div>
                      <div className="text-xs text-white/50 mt-1">
                        {b.customer_name || "—"}
                        {b.customer_email && ` · ${b.customer_email}`}
                        {b.customer_phone && ` · ${b.customer_phone}`}
                        {vehicle && ` · ${vehicle}`}
                      </div>
                      {b.notes && <div className="text-xs text-white/40 mt-1 italic">"{b.notes}"</div>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={[
                          "text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded",
                          b.status === "pending" && "bg-amber-500/15 text-amber-300",
                          b.status === "confirmed" && "bg-[#22c55e]/15 text-[#22c55e]",
                          b.status === "declined" && "bg-red-500/15 text-red-300",
                          b.status === "completed" && "bg-blue-500/15 text-blue-300",
                          b.status === "cancelled" && "bg-white/10 text-white/40",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {b.status}
                      </span>
                      {b.status === "pending" && (
                        <>
                          <button
                            onClick={() => updateBooking(b.id, "confirmed")}
                            className="text-[#22c55e] hover:bg-[#22c55e]/10 rounded p-1"
                            title="Confirm"
                          >
                            <CheckCircle2 className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => updateBooking(b.id, "declined")}
                            className="text-red-400 hover:bg-red-500/10 rounded p-1"
                            title="Decline"
                          >
                            <XCircle className="w-5 h-5" />
                          </button>
                        </>
                      )}
                      {b.status === "confirmed" && (
                        <button
                          onClick={() => updateBooking(b.id, "completed")}
                          className="text-blue-400 hover:bg-blue-500/10 rounded p-1 text-xs px-2"
                        >
                          Complete
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

export default AdminAvailability;
