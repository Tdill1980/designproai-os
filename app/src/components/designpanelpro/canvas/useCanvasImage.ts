import { useEffect, useState } from "react";

/**
 * Loads an HTMLImageElement for use as a Konva image source. Mirrors the tiny
 * `use-image` package (not a dependency here). Returns [image, status].
 * crossOrigin is set so the Konva canvas does not become tainted (needed if we
 * ever read pixels back), and so signed Supabase URLs render.
 */
export function useCanvasImage(
  src: string | undefined,
): [HTMLImageElement | undefined, "loading" | "loaded" | "failed"] {
  const [image, setImage] = useState<HTMLImageElement>();
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">("loading");

  useEffect(() => {
    if (!src) {
      setImage(undefined);
      setStatus("failed");
      return;
    }
    let cancelled = false;
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    setStatus("loading");
    img.onload = () => {
      if (cancelled) return;
      setImage(img);
      setStatus("loaded");
    };
    img.onerror = () => {
      if (cancelled) return;
      // Retry once without crossOrigin in case the host lacks CORS headers.
      const img2 = new window.Image();
      img2.onload = () => {
        if (cancelled) return;
        setImage(img2);
        setStatus("loaded");
      };
      img2.onerror = () => {
        if (cancelled) return;
        setImage(undefined);
        setStatus("failed");
      };
      img2.src = src;
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);

  return [image, status];
}
