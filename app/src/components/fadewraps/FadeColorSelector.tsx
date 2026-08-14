import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { InkFusionColor } from "@/lib/restyleproai-colors";

export interface Cmyk { c: number; m: number; y: number; k: number; }

// Standard fade colors — each tied to a real Pantone (PMS) reference with
// matching Color Bridge Coated CMYK breakdowns. Onyx / RIP-friendly.
// Hex values are sRGB approximations for screen preview only.
// CMYK numbers are Pantone Color Bridge Coated values (the same starting
// recipe Brice would see in Onyx before media-specific spot replacement).
// Order: popular brights → dark/moody → classy → light pastel.
const STANDARD_FADES = [
  // 🔥 Popular brights
  { id: 'std-atomic-cyan',     name: 'Atomic Cyan',     pantone: 'PMS 306 C',           hex: '#00B5E2', cmyk: { c: 76,  m: 5,   y: 4,   k: 0  } },
  { id: 'std-inferno',         name: 'Inferno',         pantone: 'PMS 185 C',           hex: '#E4002B', cmyk: { c: 0,   m: 100, y: 81,  k: 4  } },
  { id: 'std-heatwave',        name: 'Heatwave',        pantone: 'PMS Rhodamine Red C', hex: '#E10098', cmyk: { c: 11,  m: 87,  y: 0,   k: 0  } },
  { id: 'std-voltage',         name: 'Voltage',         pantone: 'PMS Blue 072 C',      hex: '#10069F', cmyk: { c: 100, m: 88,  y: 0,   k: 5  } },
  { id: 'std-acid-lime',       name: 'Acid Lime',       pantone: 'PMS 802 C',           hex: '#44D62C', cmyk: { c: 64,  m: 0,   y: 100, k: 0  } },
  { id: 'std-sunset-blaze',    name: 'Sunset Blaze',    pantone: 'PMS Orange 021 C',    hex: '#FE5000', cmyk: { c: 0,   m: 65,  y: 100, k: 0  } },
  { id: 'std-highlighter',     name: 'Highlighter',     pantone: 'PMS Yellow C',        hex: '#FEDD00', cmyk: { c: 0,   m: 1,   y: 100, k: 0  } },
  { id: 'std-ultraviolet',     name: 'Ultraviolet',     pantone: 'PMS Violet C',        hex: '#440099', cmyk: { c: 88,  m: 100, y: 0,   k: 5  } },
  { id: 'std-riot-pink',       name: 'Riot Pink',       pantone: 'PMS 806 C',           hex: '#FF3EB5', cmyk: { c: 0,   m: 75,  y: 0,   k: 0  } },
  { id: 'std-lava-strike',     name: 'Lava Strike',     pantone: 'PMS Warm Red C',      hex: '#F9423A', cmyk: { c: 0,   m: 75,  y: 90,  k: 0  } },

  // 🌑 Dark / moody
  { id: 'std-bloodmoon',       name: 'Bloodmoon',       pantone: 'PMS 188 C',           hex: '#76232F', cmyk: { c: 18,  m: 100, y: 65,  k: 60 } },
  { id: 'std-black-pine',      name: 'Black Pine',      pantone: 'PMS 5535 C',          hex: '#162F26', cmyk: { c: 78,  m: 35,  y: 71,  k: 81 } },
  { id: 'std-abyss',           name: 'Abyss',           pantone: 'PMS 282 C',           hex: '#041E42', cmyk: { c: 100, m: 87,  y: 42,  k: 51 } },
  { id: 'std-velvet-sin',      name: 'Velvet Sin',      pantone: 'PMS 504 C',           hex: '#572932', cmyk: { c: 32,  m: 75,  y: 50,  k: 70 } },
  { id: 'std-onyx',            name: 'Onyx',            pantone: 'PMS Black C',         hex: '#2D2926', cmyk: { c: 63,  m: 62,  y: 59,  k: 94 } },
  { id: 'std-witches-heart',   name: "Witch's Heart",   pantone: 'PMS 2627 C',          hex: '#3C1361', cmyk: { c: 75,  m: 100, y: 0,   k: 24 } },
  { id: 'std-gunmetal',        name: 'Gunmetal',        pantone: 'PMS 432 C',           hex: '#333F48', cmyk: { c: 78,  m: 65,  y: 54,  k: 53 } },
  { id: 'std-black-coffee',    name: 'Black Coffee',    pantone: 'PMS 476 C',           hex: '#4C3327', cmyk: { c: 39,  m: 60,  y: 65,  k: 75 } },
  { id: 'std-deepwater',       name: 'Deepwater',       pantone: 'PMS 309 C',           hex: '#003C50', cmyk: { c: 100, m: 53,  y: 38,  k: 75 } },
  { id: 'std-battlefield',     name: 'Battlefield',     pantone: 'PMS 574 C',           hex: '#404F24', cmyk: { c: 56,  m: 28,  y: 100, k: 65 } },

  // 💎 Classy / sophisticated
  { id: 'std-24-karat',        name: '24 Karat',        pantone: 'PMS 871 C (Metallic)',hex: '#85754E', cmyk: { c: 20,  m: 30,  y: 70,  k: 50 } },
  { id: 'std-bel-air-rose',    name: 'Bel-Air Rose',    pantone: 'PMS 7521 C',          hex: '#C09C83', cmyk: { c: 14,  m: 32,  y: 36,  k: 33 } },
  { id: 'std-mother-of-pearl', name: 'Mother of Pearl', pantone: 'PMS 9080 C',          hex: '#F2F0E6', cmyk: { c: 2,   m: 4,   y: 13,  k: 0  } },
  { id: 'std-sterling',        name: 'Sterling',        pantone: 'PMS 877 C (Metallic)',hex: '#8A8D8F', cmyk: { c: 30,  m: 22,  y: 22,  k: 36 } },
  { id: 'std-bond-green',      name: 'Bond Green',      pantone: 'PMS 3435 C',          hex: '#115740', cmyk: { c: 92,  m: 17,  y: 76,  k: 70 } },
  { id: 'std-crown-jewel',     name: 'Crown Jewel',     pantone: 'PMS 286 C',           hex: '#0033A0', cmyk: { c: 100, m: 75,  y: 0,   k: 0  } },
  { id: 'std-old-money',       name: 'Old Money',       pantone: 'PMS 7567 C',          hex: '#A47E3B', cmyk: { c: 24,  m: 47,  y: 95,  k: 39 } },
  { id: 'std-library-red',     name: 'Library Red',     pantone: 'PMS 209 C',           hex: '#6F263D', cmyk: { c: 32,  m: 100, y: 47,  k: 64 } },
  { id: 'std-penthouse',       name: 'Penthouse Slate', pantone: 'PMS 7546 C',          hex: '#253746', cmyk: { c: 80,  m: 56,  y: 38,  k: 60 } },
  { id: 'std-ivory-tower',     name: 'Ivory Tower',     pantone: 'PMS 7527 C',          hex: '#D6D2C4', cmyk: { c: 5,   m: 7,   y: 16,  k: 11 } },

  // ☁️ Light pastel
  { id: 'std-cotton-candy',    name: 'Cotton Candy',    pantone: 'PMS 1895 C',          hex: '#FABBCB', cmyk: { c: 0,   m: 27,  y: 8,   k: 0  } },
  { id: 'std-mint-whisper',    name: 'Mint Whisper',    pantone: 'PMS 559 C',           hex: '#B5CFB7', cmyk: { c: 33,  m: 0,   y: 27,  k: 14 } },
  { id: 'std-lilac-cloud',     name: 'Lilac Cloud',     pantone: 'PMS 2705 C',          hex: '#C2B2D1', cmyk: { c: 26,  m: 24,  y: 0,   k: 0  } },
  { id: 'std-lemon-chiffon',   name: 'Lemon Chiffon',   pantone: 'PMS 393 C',           hex: '#ECE981', cmyk: { c: 8,   m: 0,   y: 60,  k: 0  } },
  { id: 'std-peach-sorbet',    name: 'Peach Sorbet',    pantone: 'PMS 162 C',           hex: '#FFC4A3', cmyk: { c: 0,   m: 27,  y: 38,  k: 0  } },
  { id: 'std-baby-sky',        name: 'Baby Sky',        pantone: 'PMS 290 C',           hex: '#B9D9EB', cmyk: { c: 27,  m: 0,   y: 4,   k: 0  } },
  { id: 'std-coral-blush',     name: 'Coral Blush',     pantone: 'PMS 169 C',           hex: '#FBC3B0', cmyk: { c: 0,   m: 28,  y: 26,  k: 0  } },
  { id: 'std-sage-whisper',    name: 'Sage Whisper',    pantone: 'PMS 5645 C',          hex: '#A2B59F', cmyk: { c: 36,  m: 9,   y: 30,  k: 18 } },
];

const fmtCmyk = (c: Cmyk) => `C${c.c} M${c.m} Y${c.y} K${c.k}`;

export interface FadeColor {
  id: string;
  name: string;
  hex: string;
  pantone?: string;
  cmyk?: Cmyk;
  isInkFusion: boolean;
  inkFusionColor?: InkFusionColor;
}

interface FadeColorSelectorProps {
  selectedColor: FadeColor | null;
  onColorSelect: (color: FadeColor) => void;
}

export const FadeColorSelector = ({ selectedColor, onColorSelect }: FadeColorSelectorProps) => {
  const handleStandardSelect = (fade: typeof STANDARD_FADES[0]) => {
    onColorSelect({
      id: fade.id,
      name: `${fade.name} → Black`,
      hex: fade.hex,
      pantone: fade.pantone,
      cmyk: fade.cmyk,
      isInkFusion: false
    });
  };

  return (
    <div className="space-y-4">
      <Label className="text-sm font-semibold">Select Fade Color</Label>

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          {STANDARD_FADES.length} Pantone + CMYK fade colors — brights, darks, classy, pastels
        </p>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-[480px] overflow-y-auto pr-1">
          {STANDARD_FADES.map((fade) => (
            <button
              key={fade.id}
              onClick={() => handleStandardSelect(fade)}
              className={cn(
                "relative aspect-[3/4] rounded-lg overflow-hidden border-2 transition-all flex flex-col",
                selectedColor?.id === fade.id
                  ? "border-primary ring-2 ring-primary/30"
                  : "border-border hover:border-primary/50"
              )}
              title={`${fade.name} — ${fade.pantone} — ${fmtCmyk(fade.cmyk)} → Black`}
            >
              <div
                className="flex-1 w-full"
                style={{
                  background: `linear-gradient(to bottom, ${fade.hex}, #000000)`
                }}
              />
              <div className="bg-black/85 px-1.5 py-1 border-t border-white/10">
                <p className="text-white text-[11px] font-semibold leading-tight truncate text-center">
                  {fade.name}
                </p>
                <p className="text-white/60 text-[9px] leading-tight truncate text-center font-mono">
                  {fade.pantone}
                </p>
                <p className="text-white/50 text-[9px] leading-tight truncate text-center font-mono">
                  {fmtCmyk(fade.cmyk)}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {selectedColor && (
        <Card className="p-3 bg-secondary/30 border-border">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-14 rounded-md border border-border"
              style={{
                background: `linear-gradient(to bottom, ${selectedColor.hex}, #000000)`
              }}
            />
            <div className="min-w-0">
              <p className="font-semibold text-sm truncate">{selectedColor.name}</p>
              <p className="text-xs text-muted-foreground truncate">
                {selectedColor.pantone || 'Standard Fade'}
              </p>
              {selectedColor.cmyk && (
                <p className="text-[10px] text-muted-foreground/80 font-mono truncate">
                  {fmtCmyk(selectedColor.cmyk)} • Onyx-ready
                </p>
              )}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};
