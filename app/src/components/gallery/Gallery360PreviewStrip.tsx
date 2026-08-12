import { Rotate3D } from "lucide-react";

interface Gallery360PreviewStripProps {
  spinViews: Record<number, string>;
  onClick: () => void;
}

export function Gallery360PreviewStrip({ spinViews, onClick }: Gallery360PreviewStripProps) {
  // Show 4 key angles: Front (0°), Right (90°), Rear (180°), Left (270°)
  const previewAngles = [0, 90, 180, 270];
  const angleLabels = ["Front", "Right", "Rear", "Left"];
  
  // Filter to only available angles
  const availablePreviews = previewAngles
    .map((angle, idx) => ({ angle, url: spinViews[angle], label: angleLabels[idx] }))
    .filter(p => p.url);
  
  if (availablePreviews.length === 0) return null;
  
  return (
    <button
      onClick={(e) => { 
        e.stopPropagation(); 
        onClick(); 
      }}
      className="absolute bottom-0 left-0 right-0 z-10 flex items-center justify-center gap-1 
                 bg-gradient-to-t from-black/80 via-black/60 to-transparent pt-6 pb-2 px-2
                 hover:from-black/90 transition-all duration-300 group"
    >
      <div className="flex items-center gap-1.5">
        {availablePreviews.map((preview) => (
          <div 
            key={preview.angle} 
            className="relative w-12 h-8 rounded overflow-hidden border border-white/20 
                       group-hover:border-blue-400/50 transition-all"
          >
            <img 
              src={preview.url} 
              alt={preview.label}
              className="w-full h-full object-cover"
            />
            <span className="absolute bottom-0 left-0 right-0 bg-black/70 text-[6px] text-white text-center py-0.5">
              {preview.label}
            </span>
          </div>
        ))}
        <div className="flex items-center gap-1 ml-2 text-white/80 group-hover:text-blue-400 transition-colors">
          <Rotate3D className="w-3 h-3" />
          <span className="text-[10px] font-semibold">View 360°</span>
        </div>
      </div>
    </button>
  );
}
