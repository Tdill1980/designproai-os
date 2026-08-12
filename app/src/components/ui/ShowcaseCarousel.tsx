import { useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const IMAGES = [
  { src: "/screenshots/porsche-distressed-hero.png", alt: "Porsche 911 — Distressed Racing Livery" },
  { src: "/screenshots/productionflow-panelizer-mini.png", alt: "ProductionFlow — Universal Panelizer" },
];

export const ShowcaseCarousel = () => {
  const [idx, setIdx] = useState(0);
  const next = useCallback(() => setIdx((i) => (i + 1) % IMAGES.length), []);
  const prev = useCallback(() => setIdx((i) => (i - 1 + IMAGES.length) % IMAGES.length), []);

  useEffect(() => {
    const id = setInterval(next, 4000);
    return () => clearInterval(id);
  }, [next]);

  return (
    <div className="relative rounded-xl overflow-hidden group">
      <div className="relative w-full aspect-[16/9]">
        {IMAGES.map((img, i) => (
          <img
            key={img.src}
            src={img.src}
            alt={img.alt}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${i === idx ? "opacity-100" : "opacity-0"}`}
          />
        ))}
      </div>
      <button
        onClick={prev}
        className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <ChevronLeft className="w-4 h-4 text-white" />
      </button>
      <button
        onClick={next}
        className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <ChevronRight className="w-4 h-4 text-white" />
      </button>
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
        {IMAGES.map((_, i) => (
          <button
            key={i}
            onClick={() => setIdx(i)}
            className={`w-1.5 h-1.5 rounded-full transition-all ${i === idx ? "bg-cyan-400 w-4" : "bg-white/30"}`}
          />
        ))}
      </div>
    </div>
  );
};
