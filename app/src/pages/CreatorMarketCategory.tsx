import { useMemo } from "react";
import { Helmet } from "react-helmet-async";
import { useParams, Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, ChevronRight, Package } from "lucide-react";
import {
  categoryFromUrlSlug, designPath, CM_TRADE_CATEGORIES, CM_STYLE_CATEGORIES,
} from "@/lib/cm-seo";
import { getIndustryTitle, getVehicleSubtitle, PRINT_READY_PRICE } from "@/components/creatormarket/listing-display";

const ORIGIN = "https://www.restyleproai.com";
const SELECT =
  "id, title, industry_title, thumbnail_url, price, vehicle_year, vehicle_make, vehicle_model, trade_category, design_style, featured_creator_name, listed_at, display_order";

/**
 * CreatorMarketCategory — the programmatic SEO landing page for a CreatorMarket
 * category (a commercial TRADE or a restyle STYLE). One crawlable URL per
 * category (`/creatormarket/hvac-wraps`, `/creatormarket/carbon-fiber-wraps`),
 * with a unique H1/intro, real internal links to every design, and
 * CollectionPage + ItemList + BreadcrumbList structured data.
 */
export default function CreatorMarketCategory() {
  const { categorySlug } = useParams<{ categorySlug: string }>();
  const category = useMemo(() => categoryFromUrlSlug(categorySlug), [categorySlug]);

  const { data: listings, isLoading } = useQuery({
    queryKey: ["cm-category", category?.urlSlug],
    enabled: !!category,
    queryFn: async () => {
      let q = (supabase as any)
        .from("marketplace_listings")
        .select(SELECT)
        .eq("status", "listed")
        .eq("is_hidden", false)
        .order("display_order", { ascending: true, nullsFirst: false })
        .order("listed_at", { ascending: false })
        .limit(96);
      if (category!.kind === "trade") {
        q = q.eq("trade_category", category!.tradeCategory);
      } else if (category!.matchKeywords?.length) {
        q = q.or(category!.matchKeywords.map((k) => `title.ilike.%${k}%`).join(","));
      }
      const { data, error } = await q;
      if (error) { console.warn("cm-category query:", error); return []; }
      return (data || []) as any[];
    },
  });

  // Unknown slug → send to the marketplace index (no thin/soft-404 pages).
  if (categorySlug && !category) return <Navigate to="/creatormarket" replace />;
  if (!category) return null;

  const canonical = `${ORIGIN}/creatormarket/${category.urlSlug}`;
  const rows = listings || [];

  const itemList = rows.slice(0, 40).map((l, i) => ({
    "@type": "ListItem",
    position: i + 1,
    url: `${ORIGIN}${designPath(l)}`,
    name: getIndustryTitle(l),
    image: l.thumbnail_url || undefined,
  }));

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        name: category.h1,
        description: category.metaDescription,
        url: canonical,
        isPartOf: { "@type": "WebSite", name: "RestyleProAI CreatorMarket", url: `${ORIGIN}/creatormarket` },
        mainEntity: { "@type": "ItemList", numberOfItems: rows.length, itemListElement: itemList },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${ORIGIN}/` },
          { "@type": "ListItem", position: 2, name: "CreatorMarket", item: `${ORIGIN}/creatormarket` },
          { "@type": "ListItem", position: 3, name: category.h1, item: canonical },
        ],
      },
    ],
  };

  const siblings = (category.kind === "trade" ? CM_TRADE_CATEGORIES : CM_STYLE_CATEGORIES)
    .filter((c) => c.urlSlug !== category.urlSlug);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Helmet>
        <title>{category.metaTitle}</title>
        <meta name="description" content={category.metaDescription} />
        <link rel="canonical" href={canonical} />
        <meta property="og:type" content="website" />
        <meta property="og:title" content={category.metaTitle} />
        <meta property="og:description" content={category.metaDescription} />
        <meta property="og:url" content={canonical} />
        {rows[0]?.thumbnail_url && <meta property="og:image" content={rows[0].thumbnail_url} />}
        <meta name="twitter:card" content="summary_large_image" />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>

      <main className="flex-1 container mx-auto px-4 pt-4 sm:pt-6 pb-10">
        {/* Breadcrumb (visible + matches BreadcrumbList schema) */}
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-zinc-500 mb-4">
          <Link to="/" className="hover:text-white">Home</Link>
          <ChevronRight className="w-3 h-3" />
          <Link to="/creatormarket" className="hover:text-white">CreatorMarket</Link>
          <ChevronRight className="w-3 h-3" />
          <span className="text-zinc-300">{category.label}</span>
        </nav>

        <header className="mb-6 max-w-3xl">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">{category.h1}</h1>
          <p className="text-sm sm:text-base text-white/80 mt-2">{category.intro}</p>
          <p className="text-xs text-zinc-500 mt-1">
            {rows.length} design{rows.length === 1 ? "" : "s"} · ${PRINT_READY_PRICE} print-ready file package · delivered in 48 hours
          </p>
        </header>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-800 py-16 text-center">
            <p className="text-zinc-400">New {category.label.toLowerCase()} designs are being added.</p>
            <Link to="/creatormarket" className="text-fuchsia-400 hover:text-fuchsia-300 text-sm mt-2 inline-block">
              Browse the full marketplace →
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {rows.map((l) => {
              const title = getIndustryTitle(l);
              const vehicle = getVehicleSubtitle(l);
              return (
                <Link
                  key={l.id}
                  to={designPath(l)}
                  className="group rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 hover:border-fuchsia-500/40 transition-all hover:-translate-y-0.5"
                >
                  <div className="aspect-video bg-zinc-800 overflow-hidden">
                    {l.thumbnail_url ? (
                      <img
                        src={l.thumbnail_url}
                        alt={`${title}${vehicle ? ` — ${vehicle}` : ""} vehicle wrap design`}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><Package className="h-10 w-10 text-zinc-700" /></div>
                    )}
                  </div>
                  <div className="p-4">
                    <h2 className="font-semibold text-white truncate">{title}</h2>
                    {vehicle && <p className="text-xs text-zinc-500 truncate mt-0.5">{vehicle}</p>}
                    <p className="text-sm text-fuchsia-400 font-bold mt-2">${l.price || PRINT_READY_PRICE}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* Internal-link hub to sibling categories (crawl-equity + discovery) */}
        <section className="mt-12 border-t border-zinc-800 pt-6">
          <h2 className="text-sm font-semibold text-zinc-400 mb-3">
            Browse more {category.kind === "trade" ? "commercial" : "restyle"} wrap categories
          </h2>
          <div className="flex flex-wrap gap-2">
            {siblings.map((c) => (
              <Link
                key={c.urlSlug}
                to={`/creatormarket/${c.urlSlug}`}
                className="text-[11px] font-semibold px-3 py-1.5 rounded-full border border-zinc-700 text-zinc-400 hover:text-white hover:border-fuchsia-500/40 transition"
              >
                {c.label}
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
