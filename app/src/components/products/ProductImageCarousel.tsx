import { useEffect, useState } from "react";
import { useProductCarousel } from "@/hooks/useProductCarousel";
import { cn } from "@/lib/utils";

/**
 * 3-image product carousel shown above the fold on RestyleProAI product
 * pages. Images are admin-managed at /admin/product-images. Styled to the
 * ApprovePro look (white card, blue→magenta gradient accents).
 *
 * Renders nothing until at least one image is uploaded so an empty page
 * never shows a blank box. Auto-advances every 5s; dots for manual control.
 */
export function ProductImageCarousel({
  slug,
  className,
  reserveSpace = false,
}: {
  slug: string;
  className?: string;
  /** When true, render a branded placeholder card if no images are
   *  uploaded yet, so the spot stays visible. When false (default), the
   *  component renders nothing until at least one image exists. */
  reserveSpace?: boolean;
}) {
  const { data: images = [] } = useProductCarousel(slug);
  const [index, setIndex] = useState(0);

  // Keep index in range if the image set shrinks.
  useEffect(() => {
    if (index > images.length - 1) setIndex(0);
  }, [images.length, index]);

  // Auto-advance only when there's more than one image.
  useEffect(() => {
    if (images.length < 2) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % images.length);
    }, 5000);
    return () => clearInterval(id);
  }, [images.length]);

  if (images.length === 0) {
    if (!reserveSpace) return null;
    // Branded placeholder so the carousel spot is visible before any
    // images are uploaded at /admin/product-images.
    return (
      <div className={cn("w-full", className)}>
        <div className="relative w-full overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="h-1 bg-gradient-to-r from-[#3b82f6] to-[#ec4899]" />
          <div className="relative aspect-[16/9] bg-gradient-to-br from-[#3b82f6]/8 via-white to-[#ec4899]/8 flex flex-col items-center justify-center gap-4">
            <div className="flex items-center gap-3 opacity-70">
              <img src="/sprocket/restyleproai-logo.png" alt="RestyleProAI" className="h-7 w-auto object-contain" />
              <span className="text-gray-300 text-xl font-light">·</span>
              <img src="/sprocket/designproai-logo.png" alt="DesignProAI" className="h-7 w-auto object-contain" />
            </div>
            <div className="text-center">
              <div className="text-sm font-semibold text-gray-700">Product gallery</div>
              <div className="text-xs text-gray-400 mt-0.5">
                Add up to 3 images at /admin/product-images
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("w-full", className)}>
      <div className="relative w-full overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        {/* Signature blue→magenta top strip */}
        <div className="h-1 bg-gradient-to-r from-[#3b82f6] to-[#ec4899]" />

        <div className="relative aspect-[16/9] bg-gray-50">
          {images.map((src, i) => (
            <img
              key={src}
              src={src}
              alt={`Product image ${i + 1}`}
              loading={i === 0 ? "eager" : "lazy"}
              className={cn(
                "absolute inset-0 h-full w-full object-cover transition-opacity duration-500",
                i === index ? "opacity-100" : "opacity-0",
              )}
            />
          ))}

          {images.length > 1 && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2">
              {images.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`Show image ${i + 1}`}
                  onClick={() => setIndex(i)}
                  className={cn(
                    "h-2 rounded-full transition-all",
                    i === index
                      ? "w-6 bg-gradient-to-r from-[#3b82f6] to-[#ec4899]"
                      : "w-2 bg-white/80 ring-1 ring-gray-300 hover:bg-white",
                  )}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ProductImageCarousel;
