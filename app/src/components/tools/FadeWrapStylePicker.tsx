import { useEffect } from "react";
import { FadeStyleId, getStylePreviewGradient } from "@/lib/fadeStyles";
import { ArrowRight } from "lucide-react";

interface FadeWrapStylePickerProps {
  fadeStyle: FadeStyleId;
  setFadeStyle: (style: FadeStyleId) => void;
  colorHex?: string;
}

const LOCKED_STYLE: FadeStyleId = "front_back";

export function FadeWrapStylePicker({
  fadeStyle,
  setFadeStyle,
  colorHex = '#3B82F6'
}: FadeWrapStylePickerProps) {
  useEffect(() => {
    if (fadeStyle !== LOCKED_STYLE) setFadeStyle(LOCKED_STYLE);
  }, [fadeStyle, setFadeStyle]);

  const gradient = getStylePreviewGradient(LOCKED_STYLE, colorHex);

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-foreground">Fade Style</h4>
        <p className="text-xs text-muted-foreground">Color fades 3/4 of the way back to black</p>
      </div>

      <div className="relative flex flex-col items-center gap-2 p-3 rounded-xl border-2 border-primary bg-primary/10 ring-2 ring-primary/30 shadow-lg">
        <div
          className="relative w-full h-14 rounded-lg overflow-hidden shadow-inner"
          style={{ background: gradient }}
        >
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="p-2 rounded-full bg-black/30 backdrop-blur-sm">
              <ArrowRight className="w-4 h-4 text-foreground drop-shadow-md" />
            </div>
          </div>
          <div
            className="absolute inset-0 opacity-30"
            style={{
              background: `radial-gradient(ellipse at center, ${colorHex}88 0%, transparent 70%)`
            }}
          />
        </div>
        <span className="text-xs font-medium text-center leading-tight text-primary">
          3/4 Fade
        </span>
      </div>
    </div>
  );
}
