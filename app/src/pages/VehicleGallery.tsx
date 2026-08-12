import { useState, useMemo } from "react";
import { Helmet } from "react-helmet-async";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { SEOBreadcrumb } from "@/components/SEOBreadcrumb";
import { ArrowRight, Maximize2, Download, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/**
 * Vehicle-specific SEO landing pages.
 * Route: /gallery/:vehicleSlug (e.g. /gallery/ford-mustang-wraps)
 *
 * Pulls gallery items matching the vehicle make+model and renders
 * an SEO-optimized page with unique meta tags, breadcrumbs, and schema.
 */

// Vehicle definitions for SEO landing pages
export const VEHICLE_SEO_PAGES = [
  { slug: "ford-mustang-wraps", make: "Ford", model: "Mustang", title: "Ford Mustang Wrap Designs & Ideas", keywords: ["mustang wrap", "ford mustang vehicle wrap", "mustang wrap ideas"] },
  { slug: "ford-f150-wraps", make: "Ford", model: "F-150", title: "Ford F-150 Wrap Designs & Ideas", keywords: ["f150 wrap", "ford f150 vehicle wrap", "truck wrap ideas"] },
  { slug: "chevrolet-corvette-wraps", make: "Chevrolet", model: "Corvette", title: "Chevrolet Corvette Wrap Designs & Ideas", keywords: ["corvette wrap", "c8 corvette wrap", "corvette wrap ideas"] },
  { slug: "dodge-charger-wraps", make: "Dodge", model: "Charger", title: "Dodge Charger Wrap Designs & Ideas", keywords: ["charger wrap", "dodge charger vehicle wrap"] },
  { slug: "tesla-model-3-wraps", make: "Tesla", model: "Model 3", title: "Tesla Model 3 Wrap Designs & Ideas", keywords: ["tesla wrap", "model 3 wrap", "tesla model 3 vehicle wrap"] },
  { slug: "bmw-m4-wraps", make: "BMW", model: "M4", title: "BMW M4 Wrap Designs & Ideas", keywords: ["bmw m4 wrap", "bmw vehicle wrap ideas"] },
  { slug: "porsche-911-wraps", make: "Porsche", model: "911", title: "Porsche 911 Wrap Designs & Ideas", keywords: ["porsche 911 wrap", "porsche vehicle wrap"] },
  { slug: "lamborghini-huracan-wraps", make: "Lamborghini", model: "Huracán", title: "Lamborghini Huracán Wrap Designs & Ideas", keywords: ["lamborghini wrap", "huracan wrap"] },
  { slug: "jeep-wrangler-wraps", make: "Jeep", model: "Wrangler", title: "Jeep Wrangler Wrap Designs & Ideas", keywords: ["jeep wrangler wrap", "jeep wrap ideas"] },
  { slug: "toyota-supra-wraps", make: "Toyota", model: "Supra", title: "Toyota Supra Wrap Designs & Ideas", keywords: ["supra wrap", "toyota supra vehicle wrap"] },
  { slug: "chevrolet-silverado-wraps", make: "Chevrolet", model: "Silverado", title: "Chevrolet Silverado Wrap Designs & Ideas", keywords: ["silverado wrap", "chevy truck wrap"] },
  { slug: "dodge-challenger-wraps", make: "Dodge", model: "Challenger", title: "Dodge Challenger Wrap Designs & Ideas", keywords: ["challenger wrap", "dodge challenger wrap ideas"] },
  { slug: "mercedes-amg-gt-wraps", make: "Mercedes", model: "AMG", title: "Mercedes-AMG Wrap Designs & Ideas", keywords: ["mercedes wrap", "amg wrap", "mercedes vehicle wrap"] },
  { slug: "cadillac-escalade-wraps", make: "Cadillac", model: "Escalade", title: "Cadillac Escalade Wrap Designs & Ideas", keywords: ["escalade wrap", "cadillac wrap ideas"] },
  { slug: "nissan-z-wraps", make: "Nissan", model: "Z", title: "Nissan Z Wrap Designs & Ideas", keywords: ["nissan z wrap", "370z wrap", "nissan wrap ideas"] },
];

export default function VehicleGallery() {
  const { vehicleSlug } = useParams<{ vehicleSlug: string }>();
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const vehiclePage = VEHICLE_SEO_PAGES.find((v) => v.slug === vehicleSlug);

  // Fetch gallery items matching this vehicle
  const { data: galleryItems, isLoading } = useQuery({
    queryKey: ["vehicle-gallery", vehiclePage?.make, vehiclePage?.model],
    enabled: !!vehiclePage,
    queryFn: async () => {
      if (!vehiclePage) return [];
      const items: any[] = [];

      // Fetch from starred renders (is_featured_hero)
      const { data: starredData } = await supabase
        .from("color_visualizations")
        .select("*")
        .eq("is_featured_hero", true)
        .ilike("vehicle_make", `%${vehiclePage.make}%`)
        .order("created_at", { ascending: false })
        .limit(30);

      if (starredData) {
        for (const item of starredData) {
          const renderUrls = item.render_urls as any;
          if (renderUrls) {
            const viewOrder = ['side', 'driver-side', 'passenger-side', 'hood_detail', 'front', 'rear', 'close-up', 'roof', 'top'];
            let heroUrl = '';
            for (const vk of viewOrder) {
              if (renderUrls[vk] && typeof renderUrls[vk] === 'string') {
                heroUrl = renderUrls[vk];
                break;
              }
            }
            if (heroUrl) {
              items.push({
                id: item.id,
                media_url: heroUrl,
                title: item.color_name || item.design_file_name || "Custom Wrap",
                vehicle_name: `${item.vehicle_year || ""} ${item.vehicle_make || ""} ${item.vehicle_model || ""}`.trim(),
                finish_type: item.finish_type || "",
                view_type: "side",
              });
            }
          }
        }
      }

      // Also fetch from carousels that match the make
      const carouselTables = [
        "inkfusion_carousel",
        "wbty_carousel",
        "fadewraps_carousel",
        "designpanelpro_carousel",
        "approvemode_carousel",
      ];

      for (const table of carouselTables) {
        const { data } = await (supabase as any)
          .from(table)
          .select("*")
          .eq("is_active", true)
          .ilike("vehicle_name", `%${vehiclePage.make}%`)
          .order("created_at", { ascending: false })
          .limit(10);

        if (data) {
          items.push(
            ...data.map((d: any) => ({
              id: d.id,
              media_url: d.media_url,
              title: d.title || d.color_name || d.pattern_name || "Wrap Design",
              vehicle_name: d.vehicle_name || "",
              finish_type: "",
              view_type: "",
            }))
          );
        }
      }

      return items;
    },
  });

  if (!vehiclePage) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background">
        <h1 className="text-2xl font-bold text-foreground mb-4">Vehicle Not Found</h1>
        <Link to="/gallery" className="text-primary hover:underline">
          Back to Gallery
        </Link>
      </div>
    );
  }

  const canonicalUrl = `https://www.restyleproai.com/gallery/${vehiclePage.slug}`;
  const description = `Browse ${vehiclePage.title.replace(" & Ideas", "")} — photorealistic AI-generated vehicle wrap designs. Color changes, custom panels, fade wraps. Design it. Panel it. Print it.`;

  const productSchema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: vehiclePage.title,
    description,
    url: canonicalUrl,
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: galleryItems?.length || 0,
      itemListElement: (galleryItems || []).slice(0, 10).map((item, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: `${item.vehicle_name} - ${item.title}`,
        image: item.media_url,
      })),
    },
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Helmet>
        <title>{vehiclePage.title} | RestyleProAI</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:title" content={`${vehiclePage.title} | RestyleProAI`} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:type" content="website" />
        {galleryItems?.[0]?.media_url && (
          <meta property="og:image" content={galleryItems[0].media_url} />
        )}
        <script type="application/ld+json">{JSON.stringify(productSchema)}</script>
      </Helmet>
      <SEOBreadcrumb
        items={[
          { name: "Home", path: "/" },
          { name: "Gallery", path: "/gallery" },
          { name: vehiclePage.title, path: `/gallery/${vehiclePage.slug}` },
        ]}
      />

      <main className="flex-1 container mx-auto px-4 py-8">
        {/* Hero */}
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-2">
            <Link
              to="/gallery"
              className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
            >
              <ChevronLeft className="w-4 h-4" />
              Gallery
            </Link>
          </div>
          <h1 className="text-3xl sm:text-5xl font-bold text-foreground mb-3">
            {vehiclePage.title}
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl">
            Browse AI-generated wrap designs for the {vehiclePage.make} {vehiclePage.model}.
            Every design is available as a print-ready production pack with EPS panel files.
          </p>
          <div className="flex flex-wrap gap-2 mt-4">
            {vehiclePage.keywords.map((kw) => (
              <Badge key={kw} variant="secondary" className="text-xs">
                {kw}
              </Badge>
            ))}
          </div>
        </section>

        {/* Gallery Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="aspect-video rounded-xl" />
            ))}
          </div>
        ) : (galleryItems || []).length === 0 ? (
          <div className="text-center py-20">
            <h2 className="text-xl font-bold text-foreground mb-3">
              No {vehiclePage.make} {vehiclePage.model} designs yet
            </h2>
            <p className="text-muted-foreground mb-6">
              Be the first to create a wrap design for the {vehiclePage.make} {vehiclePage.model}.
            </p>
            <Button asChild>
              <Link to="/signup">
                Start Designing Free <ArrowRight className="w-4 h-4 ml-2" />
              </Link>
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {(galleryItems || []).map((item) => (
              <Card
                key={item.id}
                className="group overflow-hidden border-border hover:border-primary/50 transition-all cursor-pointer"
                onClick={() => setLightboxUrl(item.media_url)}
              >
                <div className="relative aspect-video bg-muted overflow-hidden">
                  <img
                    src={item.media_url}
                    alt={`${item.vehicle_name} ${item.title} vehicle wrap design`}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <Maximize2 className="absolute bottom-3 right-3 w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <div className="p-3">
                  <p className="font-semibold text-foreground text-sm truncate">{item.vehicle_name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {item.title}
                    {item.finish_type && ` · ${item.finish_type}`}
                    {item.view_type && ` · ${item.view_type}`}
                  </p>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* CTA */}
        <section className="mt-16 mb-8">
          <div className="bg-gradient-to-br from-primary/10 via-card to-card border border-border rounded-2xl p-8 text-center">
            <h2 className="text-2xl font-bold text-foreground mb-3">
              Design your own {vehiclePage.make} {vehiclePage.model} wrap
            </h2>
            <p className="text-muted-foreground mb-6">
              Describe your vision and get a photorealistic render in 60 seconds. Print-ready EPS files included.
            </p>
            <Button asChild size="lg">
              <Link to="/try-design">
                Design Your Wrap — $250 <ArrowRight className="w-4 h-4 ml-2" />
              </Link>
            </Button>
          </div>
        </section>

        {/* Cross-links to other vehicles */}
        <section className="mb-8">
          <h2 className="text-xl font-semibold text-foreground mb-4">More Vehicle Wrap Designs</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {VEHICLE_SEO_PAGES.filter((v) => v.slug !== vehicleSlug)
              .slice(0, 10)
              .map((v) => (
                <Link
                  key={v.slug}
                  to={`/gallery/${v.slug}`}
                  className="group p-3 rounded-xl border border-border hover:border-primary/50 hover:bg-primary/5 transition-all text-center"
                >
                  <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                    {v.make} {v.model}
                  </p>
                  <p className="text-xs text-muted-foreground">Wraps</p>
                </Link>
              ))}
          </div>
        </section>
      </main>

      {/* Lightbox */}
      <Dialog open={!!lightboxUrl} onOpenChange={() => setLightboxUrl(null)}>
        <DialogContent className="max-w-5xl p-0 bg-black border-zinc-800">
          <VisuallyHidden><DialogTitle>Design Preview</DialogTitle></VisuallyHidden>
          {lightboxUrl && (
            <img
              src={lightboxUrl}
              alt="Wrap design preview"
              className="w-full h-auto rounded-lg"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
