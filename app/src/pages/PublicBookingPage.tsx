/**
 * PublicBookingPage — standalone public booking page for clients.
 *
 * Route: /book/:shopSlug
 *
 * A potential customer clicks "Book Now" from a QuickQuote link or
 * anywhere else and lands here. Shows the shop's branding, services,
 * and available time slots. Connected to QuickQuote via optional
 * query params (?name=...&email=...&phone=...&year=...&make=...&model=...&quoteId=...).
 */

import { useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useQuery } from "@tanstack/react-query";
import { Loader2, AlertTriangle, Calendar } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { BookingCalendar } from "@/components/booking/BookingCalendar";

interface ShopBrand {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  website: string | null;
  phone: string | null;
}

const useShopBySlug = (slug: string | undefined) => {
  return useQuery<ShopBrand | null>({
    queryKey: ["public-shop-by-slug", slug],
    enabled: !!slug,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("shops")
        .select("id, slug, name, logo_url, website, phone")
        .eq("slug", slug)
        .maybeSingle();
      if (error || !data) return null;
      return data as ShopBrand;
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
};

const PublicBookingPage = () => {
  const { shopSlug } = useParams<{ shopSlug: string }>();
  const [searchParams] = useSearchParams();
  const { data: shop, isLoading } = useShopBySlug(shopSlug);

  const name = searchParams.get("name") || "";
  const email = searchParams.get("email") || "";
  const phone = searchParams.get("phone") || "";
  const year = searchParams.get("year") || "";
  const make = searchParams.get("make") || "";
  const model = searchParams.get("model") || "";
  const quoteId = searchParams.get("quoteId") || "";

  const [contactName, setContactName] = useState(name);
  const [contactEmail, setContactEmail] = useState(email);
  const [contactPhone, setContactPhone] = useState(phone);

  const [vYear, setVYear] = useState(year);
  const [vMake, setVMake] = useState(make);
  const [vModel, setVModel] = useState(model);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#00C7FF]" />
      </div>
    );
  }

  if (!shop) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Shop not found</h1>
          <p className="text-white/60 mb-6">
            We couldn't find a shop at <code className="px-2 py-1 bg-white/10 rounded">/book/{shopSlug}</code>.
            Double-check the link or contact the shop directly.
          </p>
          <Link to="/" className="inline-block bg-[#00C7FF] text-black font-semibold px-6 py-2 rounded-lg">
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  const vehicleLabel = [vYear, vMake, vModel].filter(Boolean).join(" ");

  return (
    <div className="min-h-screen bg-black text-white">
      <Helmet>
        <title>{shop.name} — Book an Appointment</title>
        <meta name="description" content={`Book a vehicle wrap appointment with ${shop.name}.`} />
      </Helmet>

      {/* Branded header */}
      <header className="border-b border-white/10 bg-gradient-to-b from-[#0a0a0a] to-black">
        <div className="max-w-2xl mx-auto px-6 py-6 flex items-center gap-4">
          {shop.logo_url ? (
            <img src={shop.logo_url} alt={shop.name} className="h-12 w-auto object-contain" />
          ) : (
            <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-400 flex items-center justify-center font-bold text-black text-lg">
              {shop.name.charAt(0)}
            </div>
          )}
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wider text-emerald-400 font-semibold">
              Book an Appointment
            </div>
            <h1 className="text-xl font-bold">{shop.name}</h1>
          </div>
          {shop.phone && (
            <a href={`tel:${shop.phone}`} className="hidden sm:inline-block text-sm text-white/70 hover:text-[#00C7FF]">
              {shop.phone}
            </a>
          )}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-10 space-y-6">
        {/* Vehicle context banner (if passed from QuickQuote) */}
        {vehicleLabel && (
          <div className="rounded-xl border border-white/10 bg-[#0d0d0d] px-5 py-3 flex items-center gap-3">
            <Calendar className="w-5 h-5 text-emerald-400 shrink-0" />
            <div>
              <div className="text-xs text-white/50">Booking for</div>
              <div className="text-sm font-semibold">{vehicleLabel}</div>
            </div>
          </div>
        )}

        {/* Contact info section */}
        <section className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-6">
          <h2 className="text-lg font-semibold mb-4">Your contact info</h2>
          <div className="space-y-3">
            <input
              type="text"
              placeholder="Your name"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm"
            />
            <div className="grid sm:grid-cols-2 gap-3">
              <input
                type="email"
                placeholder="Email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm"
              />
              <input
                type="tel"
                placeholder="Phone"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>
        </section>

        {/* Booking calendar */}
        <BookingCalendar
          shopId={shop.id}
          shopSlug={shop.slug}
          shopName={shop.name}
          customer={{ name: contactName, email: contactEmail, phone: contactPhone }}
          vehicle={{ year: vYear, make: vMake, model: vModel }}
          quoteId={quoteId || undefined}
          onVehicleChange={(v) => { setVYear(v.year); setVMake(v.make); setVModel(v.model); }}
        />

        {/* QuickQuote link */}
        <div className="text-center pt-4">
          <Link
            to={`/quote/${shop.slug}`}
            className="text-sm text-white/50 hover:text-[#00C7FF] transition-colors"
          >
            Need a quote first? Get an instant estimate &rarr;
          </Link>
        </div>
      </main>

      <footer className="border-t border-white/10 mt-8 py-6 text-center text-xs text-white/40">
        Powered by RestylePro
        {shop.website && (
          <> &middot; <a href={shop.website} className="text-[#00C7FF] hover:underline">Visit {shop.name}</a></>
        )}
      </footer>
    </div>
  );
};

export default PublicBookingPage;
