/**
 * SubAccountQuotePage — public-facing branded quote tool for a sub-account.
 *
 * Route: /quote/:shopSlug   (e.g. /quote/toro-surfaces)
 *
 * Resolves the shop by slug, paints the page with the shop's logo + name,
 * and renders the QuickQuote tool with shopSlug threaded through. When a
 * prospect submits, saveQuote → submit-public-quote edge function inserts
 * into customer_quotes tagged with this shop_id. The shop owner sees the
 * lead on their dashboard immediately.
 *
 * Phase 2 will add a booking calendar (on-demand tint, small jobs / chrome
 * delete, large projects, sales consult $95) on the same page.
 */

import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useQuery } from "@tanstack/react-query";
import { Calculator, Loader2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { QuickQuote } from "@/components/tools/QuickQuote";
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

const SubAccountQuotePage = () => {
  const { shopSlug } = useParams<{ shopSlug: string }>();
  const { data: shop, isLoading } = useShopBySlug(shopSlug);

  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [finish, setFinish] = useState("Gloss");
  const [colorName, setColorName] = useState("");
  const [manufacturer, setManufacturer] = useState("3M");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [submittedQuoteNumber, setSubmittedQuoteNumber] = useState<string | null>(null);

  useEffect(() => {
    if (shop) document.title = `${shop.name} — Instant Quote`;
  }, [shop]);

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
            We couldn't find a shop with the URL <code className="px-2 py-1 bg-white/10 rounded">/quote/{shopSlug}</code>.
            Double-check the link or contact the shop directly.
          </p>
          <Link to="/" className="inline-block bg-[#00C7FF] text-black font-semibold px-6 py-2 rounded-lg">
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  const customerInfo =
    name || email || phone
      ? { name: name || undefined, email: email || undefined, phone: phone || undefined }
      : undefined;

  return (
    <div className="min-h-screen bg-black text-white">
      <Helmet>
        <title>{shop.name} — Instant Quote</title>
        <meta name="description" content={`Get an instant wrap quote from ${shop.name}.`} />
      </Helmet>

      {/* Branded header */}
      <header className="border-b border-white/10 bg-gradient-to-b from-[#0a0a0a] to-black">
        <div className="max-w-5xl mx-auto px-6 py-6 flex items-center gap-4">
          {shop.logo_url ? (
            <img
              src={shop.logo_url}
              alt={shop.name}
              className="h-12 w-auto object-contain"
            />
          ) : (
            <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-[#00C7FF] to-[#0080a0] flex items-center justify-center font-bold text-black">
              {shop.name.charAt(0)}
            </div>
          )}
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wider text-[#60A5FA] font-semibold">
              Instant Quote
            </div>
            <h1 className="text-xl font-bold">{shop.name}</h1>
          </div>
          {shop.phone && (
            <a
              href={`tel:${shop.phone}`}
              className="hidden sm:inline-block text-sm text-white/70 hover:text-[#00C7FF]"
            >
              {shop.phone}
            </a>
          )}
        </div>
      </header>

      {/* Body */}
      <main className="max-w-5xl mx-auto px-6 py-10">
        {submittedQuoteNumber ? (
          <div className="rounded-2xl border border-[#22c55e]/30 bg-[#22c55e]/5 px-6 py-10 text-center">
            <div className="text-3xl font-bold mb-2">Thanks — your quote is in.</div>
            <p className="text-white/70 mb-6">
              <span className="text-[#22c55e] font-semibold">Quote #{submittedQuoteNumber}</span> was
              sent to {shop.name}. They'll follow up shortly with next steps.
            </p>
            <button
              onClick={() => setSubmittedQuoteNumber(null)}
              className="bg-[#00C7FF] text-black font-semibold px-6 py-2 rounded-lg"
            >
              Get another quote
            </button>
          </div>
        ) : (
          <div className="grid lg:grid-cols-2 gap-8">
            {/* Left: vehicle + contact */}
            <div className="space-y-6">
              <section className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Calculator className="w-5 h-5 text-[#00C7FF]" />
                  <h2 className="text-lg font-semibold">Tell us about your vehicle</h2>
                </div>
                <div className="grid sm:grid-cols-3 gap-3">
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Year"
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm"
                  />
                  <input
                    type="text"
                    placeholder="Make"
                    value={make}
                    onChange={(e) => setMake(e.target.value)}
                    className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm"
                  />
                  <input
                    type="text"
                    placeholder="Model"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm"
                  />
                </div>

                <div className="grid sm:grid-cols-2 gap-3 mt-3">
                  <select
                    value={manufacturer}
                    onChange={(e) => setManufacturer(e.target.value)}
                    className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="3M">3M</option>
                    <option value="Avery Dennison">Avery Dennison</option>
                    <option value="KPMF">KPMF</option>
                    <option value="Hexis">Hexis</option>
                    <option value="Inozetek">Inozetek</option>
                    <option value="ORACAL">ORACAL</option>
                    <option value="TeckWrap">TeckWrap</option>
                  </select>
                  <select
                    value={finish}
                    onChange={(e) => setFinish(e.target.value)}
                    className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm"
                  >
                    <option>Gloss</option>
                    <option>Satin</option>
                    <option>Matte</option>
                    <option>Metallic</option>
                    <option>Chrome</option>
                    <option>Color Shift</option>
                  </select>
                </div>

                <input
                  type="text"
                  placeholder="Color name (e.g. Gloss Midnight Blue)"
                  value={colorName}
                  onChange={(e) => setColorName(e.target.value)}
                  className="w-full mt-3 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm"
                />
              </section>

              <section className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-6">
                <h2 className="text-lg font-semibold mb-4">How can {shop.name} reach you?</h2>
                <div className="space-y-3">
                  <input
                    type="text"
                    placeholder="Your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm"
                  />
                  <input
                    type="email"
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm"
                  />
                  <input
                    type="tel"
                    placeholder="Phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </section>
            </div>

            {/* Right: estimate card + booking calendar */}
            <div className="lg:sticky lg:top-6 self-start space-y-6">
              {make && model ? (
                <QuickQuote
                  year={year}
                  make={make}
                  model={model}
                  finish={finish}
                  colorName={colorName}
                  manufacturer={manufacturer}
                  toolSource="ColorPro"
                  shopSlug={shop.slug}
                  customerInfo={customerInfo}
                  onSaveSuccess={() => {
                    setSubmittedQuoteNumber("submitted");
                  }}
                />
              ) : (
                <div className="rounded-2xl border border-dashed border-white/15 bg-[#0d0d0d] p-10 text-center text-white/50">
                  <Calculator className="w-8 h-8 mx-auto mb-3 text-white/30" />
                  Enter your vehicle make + model to see an instant estimate.
                </div>
              )}

              <BookingCalendar
                shopId={shop.id}
                shopSlug={shop.slug}
                shopName={shop.name}
                customer={{ name, email, phone }}
                vehicle={{ year, make, model }}
              />
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-white/10 mt-16 py-6 text-center text-xs text-white/40">
        Powered by RestylePro · {shop.website ? <a href={shop.website} className="text-[#00C7FF] hover:underline">Visit {shop.name}</a> : shop.name}
      </footer>
    </div>
  );
};

export default SubAccountQuotePage;
