import { useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowLeft, Upload, Trash2, ImageIcon, ExternalLink, Loader2 } from "lucide-react";
import {
  PRODUCT_PAGES,
  CAROUSEL_SLOT_COUNT,
  carouselRowName,
  type ProductPageDef,
} from "@/lib/product-image-slots";

/**
 * /admin/product-images
 *
 * Upload the up-to-3 carousel images shown above the fold on each new
 * RestyleProAI product page. Files go to wrap-files/product-carousel/ and
 * the public URL is upserted into homepage_showcase keyed
 * `product-carousel:<slug>:<n>`. The product page reads them via
 * useProductCarousel — no code change needed to swap an image.
 */

const STORAGE_BUCKET = "wrap-files";
const STORAGE_PREFIX = "product-carousel";

const sanitizeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "_");

const db = supabase as never as { from: (t: string) => any };

const productImagesKey = ["product-carousel-admin"] as const;

function useAllCarouselImages() {
  return useQuery<Record<string, string>>({
    queryKey: productImagesKey,
    queryFn: async () => {
      const { data, error } = await db
        .from("homepage_showcase")
        .select("name, image_url")
        .like("name", "product-carousel:%");
      if (error || !data) return {};
      const map: Record<string, string> = {};
      for (const row of data as { name: string; image_url: string | null }[]) {
        if (row.image_url) map[row.name] = row.image_url;
      }
      return map;
    },
    staleTime: 30 * 1000,
    retry: false,
  });
}

export default function AdminProductImages() {
  const { data: images = {}, isLoading } = useAllCarouselImages();

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>Product Images — Admin</title>
      </Helmet>

      <main className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="mb-6">
          <Button variant="ghost" asChild>
            <Link to="/admin">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Admin
            </Link>
          </Button>
        </div>

        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Product Page Images</h1>
          <p className="text-muted-foreground">
            Upload up to 3 carousel images per product page. They appear above
            the fold on each RestyleProAI product page and rotate automatically.
            Stored in <code>wrap-files/product-carousel/</code> and served from
            Supabase's public CDN.
          </p>
        </div>

        {isLoading ? (
          <div className="space-y-8">
            {PRODUCT_PAGES.map((p) => (
              <div key={p.slug} className="h-40 bg-muted rounded animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-10">
            {PRODUCT_PAGES.map((product) => (
              <ProductBlock key={product.slug} product={product} images={images} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function ProductBlock({
  product,
  images,
}: {
  product: ProductPageDef;
  images: Record<string, string>;
}) {
  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-lg font-semibold">{product.label}</h2>
        <a
          href={product.path}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          Preview <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
      <div className="grid sm:grid-cols-3 gap-4">
        {Array.from({ length: CAROUSEL_SLOT_COUNT }, (_, i) => {
          const idx = i + 1;
          const rowName = carouselRowName(product.slug, idx);
          return (
            <SlotCard
              key={rowName}
              rowName={rowName}
              label={`Image ${idx}`}
              currentUrl={images[rowName] || ""}
            />
          );
        })}
      </div>
    </section>
  );
}

function SlotCard({
  rowName,
  label,
  currentUrl,
}: {
  rowName: string;
  label: string;
  currentUrl: string;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      setProgress("Uploading…");
      const ext = file.name.split(".").pop() || "bin";
      const filePath = `${STORAGE_PREFIX}/${rowName.replace(/[^a-zA-Z0-9._-]/g, "-")}-${Date.now()}-${sanitizeFileName(
        file.name.replace(/\.[^.]+$/, ""),
      )}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(filePath, file, {
          upsert: true,
          contentType: file.type || undefined,
          cacheControl: "31536000",
        });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(filePath);
      const publicUrl = urlData.publicUrl;

      setProgress("Saving…");
      const { data: existing } = await db
        .from("homepage_showcase")
        .select("id")
        .eq("name", rowName)
        .maybeSingle();

      const payload = {
        name: rowName,
        title: label,
        alt_text: label,
        image_url: publicUrl,
        is_active: true,
        sort_order: 0,
      };

      if (existing?.id) {
        const { error } = await db.from("homepage_showcase").update(payload).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await db.from("homepage_showcase").insert(payload);
        if (error) throw error;
      }
      return publicUrl;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productImagesKey });
      toast({ title: "Uploaded", description: `${label} updated.` });
      setProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    onError: (err: any) => {
      toast({ title: "Upload failed", description: err?.message || "Unknown error", variant: "destructive" });
      setProgress(null);
    },
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      const { error } = await db
        .from("homepage_showcase")
        .update({ image_url: "", is_active: false })
        .eq("name", rowName);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productImagesKey });
      toast({ title: "Removed", description: `${label} cleared.` });
    },
    onError: (err: any) => {
      toast({ title: "Remove failed", description: err?.message || "Unknown error", variant: "destructive" });
    },
  });

  return (
    <Card className="p-4 border border-border bg-card">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <ImageIcon className="w-4 h-4 text-muted-foreground" />
          {label}
        </h3>
        {currentUrl && (
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive h-7 w-7"
            disabled={removeMutation.isPending}
            onClick={() => removeMutation.mutate()}
            title="Clear this slot"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </div>

      <div className="relative w-full aspect-[16/9] rounded-md overflow-hidden border border-border bg-muted/30 mb-3">
        {currentUrl ? (
          <img src={currentUrl} alt={label} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-center px-4 border-2 border-dashed border-border rounded-md">
            <ImageIcon className="w-6 h-6 text-muted-foreground/60 mb-1.5" />
            <div className="text-[11px] text-muted-foreground/80 font-medium">No image</div>
            <div className="text-[10px] text-muted-foreground/60 mt-0.5">16:9 · 1600×900+</div>
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) uploadMutation.mutate(f);
        }}
      />

      <Button
        type="button"
        variant={currentUrl ? "outline" : "default"}
        className="w-full"
        size="sm"
        disabled={uploadMutation.isPending}
        onClick={() => fileInputRef.current?.click()}
      >
        {uploadMutation.isPending ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            {progress || "Uploading…"}
          </>
        ) : (
          <>
            <Upload className="w-4 h-4 mr-2" />
            {currentUrl ? "Replace" : "Upload"}
          </>
        )}
      </Button>
    </Card>
  );
}
