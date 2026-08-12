import { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useParams, Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, ChevronRight, Package, CheckCircle2, ShoppingBag, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BuyerPopup } from "@/components/creatormarket/BuyerPopup";
import {
  designIdFromParam, designPath, CM_TRADE_CATEGORIES, buildSeoDescription,
} from "@/lib/cm-seo";
import {
  getIndustryTitle, getVehicleSubtitle, isCommercialListing,
  PRINT_READY_PRICE, FILE_DELIVERY_HOURS,
} from "@/components/creatormarket/listing-display";

const ORIGIN = "https://www.restyleproai.com";
const FULL_SELECT =
  "id, title, description, industry_title, thumbnail_url, price, vehicle_year, vehicle_make, vehicle_model, trade_category, design_style, featured_creator_name, render_urls, preview_urls, panel_2d_url, status";

/** Collect a de-duplicated ordered list of image URLs for the gallery. */
function galleryImages(l: any): string[] {
  const out: string[] = [];
  const push = (u: any) => { if (typeof u === "string" && u.startsWith("http") && !out.includes(u)) out.push(u); };
  push(l.thumbnail_url);
  const collect = (raw: any) => {
    if (!raw) return;
    if (Array.isArray(raw)) raw.forEach((v: any) => push(v?.url || v));
    else if (typeof raw === "object") Object.values(raw).forEach(push);
  };
  collect(l.render_urls);
  collect(l.preview_urls);
  push(l.panel_2d_url);
  return out;
}

/**
 * CreatorMarketDesign — the crawlable, shareable page for ONE design.
 * `/creatormarket/design/<slug>-<uuid>`. Real URL + Helmet meta + Product /
 * BreadcrumbList structured data, the buy flow (BuyerPopup), and related designs
 * for internal linking. This is what search engines index per design.
 */
export default function CreatorMarketDesign() {
  const { slugId } = useParams<{ slugId: string }>();
  const id = useMemo(() => designIdFromParam(slugId), [slugId]);
  const [buyOpen, setBuyOpen] = useState(false);
  const [activeImg, setActiveImg] = useState(0);

  const { data: listing, isLoading } = useQuery({
    queryKey: ["cm-design", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("marketplace_listings")
        .select(FULL_SELECT)
        .eq("id", id)
        .eq("status", "listed")
        .maybeSingle();
      if (error) { console.warn("cm-design query:", error); return null; }
      return data as any;
    },
  });

  const { data: related } = useQuery({
    queryKey: ["cm-design-related", listing?.trade_category, id],
    enabled: !!listing?.trade_category,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("marketplace_listings")
        .select("id, title, industry_title, thumbnail_url, price, vehicle_year, vehicle_make, vehicle_model, trade_category")
        .eq("status", "listed")
        .eq("is_hidden", false)
        .eq("trade_category", listing!.trade_category)
        .neq("id", id)
        .limit(6);
      return (data || []) as any[];
    },
  });

  if (slugId && !id) return <Navigate to="/creatormarket" replace />;
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
      </div>
    );
  }
  if (!listing) return <Navigate to="/creatormarket" replace />;

  const title = getIndustryTitle(listing);
  const vehicle = getVehicleSubtitle(listing).replace(/^Shown on /, "");
  const commercial = isCommercialListing(listing);
  const price = listing.price || PRINT_READY_PRICE;
  const images = galleryImages(listing);
  const heroImg = images[activeImg] || images[0] || `${ORIGIN}/hero-mustang.jpg`;
  const canonical = `${ORIGIN}${designPath(listing)}`;
  const cat = CM_TRADE_CATEGORIES.find((c) => c.tradeCategory === listing.trade_category);

  // Append " for <vehicle>" only when the title doesn't already contain it
  // (some titles are "Vehicle - Design", so the vehicle would repeat).
  const titleWithVehicle = vehicle && !title.toLowerCase().includes(vehicle.toLowerCase())
    ? `${title} for ${vehicle}`
    : title;
  const metaTitle = `${titleWithVehicle} — Print-Ready Wrap Design | CreatorMarket`;
  const metaDescription =
    (listing.description && String(listing.description).trim()) || buildSeoDescription(listing);

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Product",
        name: metaTitle.replace(" | CreatorMarket", ""),
        image: images.length ? images.slice(0, 6) : undefined,
        description: metaDescription,
        brand: { "@type": "Brand", name: "RestyleProAI CreatorMarket" },
        category: cat?.label || "Vehicle Wrap Design",
        ...(listing.featured_creator_name ? { creator: { "@type": "Organization", name: listing.featured_creator_name } } : {}),
        offers: {
          "@type": "Offer",
          price: String(price),
          priceCurrency: "USD",
          availability: "https://schema.org/InStock",
          url: canonical,
          itemCondition: "https://schema.org/NewCondition",
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${ORIGIN}/` },
          { "@type": "ListItem", position: 2, name: "CreatorMarket", item: `${ORIGIN}/creatormarket` },
          ...(cat ? [{ "@type": "ListItem", position: 3, name: cat.label, item: `${ORIGIN}/creatormarket/${cat.urlSlug}` }] : []),
          { "@type": "ListItem", position: cat ? 4 : 3, name: title, item: canonical },
        ],
      },
    ],
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Helmet>
        <title>{metaTitle}</title>
        <meta name="description" content={metaDescription} />
        <link rel="canonical" href={canonical} />
        <meta property="og:type" content="product" />
        <meta property="og:title" content={metaTitle} />
        <meta property="og:description" content={metaDescription} />
        <meta property="og:url" content={canonical} />
        <meta property="og:image" content={heroImg} />
        <meta property="og:image:alt" content={`${title}${vehicle ? ` on ${vehicle}` : ""}`} />
        <meta property="product:price:amount" content={String(price)} />
        <meta property="product:price:currency" content="USD" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:image" content={heroImg} />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>

      <main className="flex-1 container mx-auto px-4 pt-4 sm:pt-6 pb-10">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-zinc-500 mb-4 flex-wrap">
          <Link to="/" className="hover:text-white">Home</Link>
          <ChevronRight className="w-3 h-3" />
          <Link to="/creatormarket" className="hover:text-white">CreatorMarket</Link>
          {cat && (
            <>
              <ChevronRight className="w-3 h-3" />
              <Link to={`/creatormarket/${cat.urlSlug}`} className="hover:text-white">{cat.label}</Link>
            </>
          )}
          <ChevronRight className="w-3 h-3" />
          <span className="text-zinc-300 truncate max-w-[40vw]">{title}</span>
        </nav>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Gallery */}
          <div>
            <div className="rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-900 aspect-video">
              {heroImg ? (
                <img src={heroImg} alt={`${title}${vehicle ? ` on ${vehicle}` : ""} — vehicle wrap design`} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center"><Package className="h-12 w-12 text-zinc-700" /></div>
              )}
            </div>
            {images.length > 1 && (
              <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
                {images.slice(0, 8).map((u, i) => (
                  <button
                    key={u}
                    onClick={() => setActiveImg(i)}
                    className={`shrink-0 w-20 h-14 rounded-lg overflow-hidden border ${i === activeImg ? "border-fuchsia-500" : "border-zinc-800"}`}
                    aria-label={`View ${i + 1}`}
                  >
                    <img src={u} alt={`${title} view ${i + 1}`} loading="lazy" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Details + buy */}
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">{title}</h1>
            {vehicle && <p className="text-sm text-zinc-400 mt-1">Shown on {vehicle}</p>}
            {listing.featured_creator_name && (
              <p className="text-xs text-zinc-500 mt-1">By {listing.featured_creator_name}</p>
            )}
            <p className="text-3xl font-bold text-white mt-4">${price}</p>

            <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 mt-4 space-y-2.5">
              <p className="text-sm font-bold text-white">What's included:</p>
              <ul className="space-y-2 text-sm text-zinc-300">
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" /> Print-ready production files</li>
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" /> Sized to your exact year / make / model</li>
                {commercial && (
                  <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" /> Editable name, logo, phone, website & colors</li>
                )}
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" /> Delivered in {FILE_DELIVERY_HOURS} hours</li>
              </ul>
            </div>

            {listing.description && (
              <p className="text-sm text-zinc-400 mt-4 leading-relaxed">{listing.description}</p>
            )}

            <div className="flex flex-col sm:flex-row gap-3 mt-5">
              <Button
                onClick={() => setBuyOpen(true)}
                className="flex-1 bg-fuchsia-600 hover:bg-fuchsia-500 text-white gap-2 h-12 font-bold"
              >
                <ShoppingBag className="w-5 h-5" /> Customize & Buy — ${price}
              </Button>
              <Button
                variant="outline"
                onClick={() => { setBuyOpen(true); }}
                className="gap-2 h-12 border-zinc-700 text-zinc-200 hover:bg-zinc-800"
              >
                <Camera className="w-5 h-5" /> Preview on my vehicle
              </Button>
            </div>
            {cat && (
              <p className="text-xs text-zinc-500 mt-4">
                More like this:{" "}
                <Link to={`/creatormarket/${cat.urlSlug}`} className="text-fuchsia-400 hover:text-fuchsia-300">
                  {cat.h1}
                </Link>
              </p>
            )}
          </div>
        </div>

        {/* Related designs — internal links */}
        {(related || []).length > 0 && (
          <section className="mt-14 border-t border-zinc-800 pt-6">
            <h2 className="text-lg font-semibold text-white mb-4">Related {cat?.label || "wrap"} designs</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {(related || []).map((r) => (
                <Link key={r.id} to={designPath(r)} className="group rounded-lg overflow-hidden border border-zinc-800 hover:border-fuchsia-500/40 transition">
                  <div className="aspect-video bg-zinc-800 overflow-hidden">
                    {r.thumbnail_url && (
                      <img src={r.thumbnail_url} alt={`${getIndustryTitle(r)} wrap design`} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-400 truncate px-2 py-1.5">{getIndustryTitle(r)}</p>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>

      <BuyerPopup listing={buyOpen ? listing : null} open={buyOpen} onOpenChange={setBuyOpen} />
    </div>
  );
}
