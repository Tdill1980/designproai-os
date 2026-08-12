/**
 * RpToken — the canonical "$25 RestylePro design credit" coin.
 *
 * The visual was originally inlined in TokenBalanceCard. Extracted so the
 * try-modal, the header balance pill, and any future credit surface use
 * the exact same coin instead of one-off lookalikes.
 *
 * Sizes:
 *   - lg (default): 64px — the original dashboard hero coin
 *   - md: 48px — the modal stack
 *   - sm: 28px — the header balance pill / inline mentions
 */

import { Car } from "lucide-react";
import { cn } from "@/lib/utils";

type Size = "sm" | "md" | "lg";

interface RpTokenProps {
  size?: Size;
  className?: string;
  /** Hide the small car badge (used when the coin is tiny). */
  showBadge?: boolean;
}

const SIZE: Record<
  Size,
  {
    coin: string;
    rp: string;
    price: string;
    badge: string;
    car: string;
    ring: string;
    shadow: string;
  }
> = {
  sm: {
    coin: "w-7 h-7",
    rp: "text-[6px]",
    price: "text-[10px]",
    badge: "w-3 h-3 -bottom-1",
    car: "w-1.5 h-1.5",
    ring: "ring-1",
    shadow: "shadow-[0_0_6px_rgba(34,211,238,0.45)]",
  },
  md: {
    coin: "w-12 h-12",
    rp: "text-[8px]",
    price: "text-sm",
    badge: "w-4 h-4 -bottom-1.5",
    car: "w-2.5 h-2.5",
    ring: "ring-2",
    shadow: "shadow-[0_0_14px_rgba(34,211,238,0.5)]",
  },
  lg: {
    coin: "w-16 h-16",
    rp: "text-[9px]",
    price: "text-lg",
    badge: "w-5 h-5 -bottom-2",
    car: "w-3 h-3",
    ring: "ring-2",
    shadow: "shadow-[0_0_18px_rgba(34,211,238,0.55)]",
  },
};

export const RpToken = ({
  size = "lg",
  className,
  showBadge = true,
}: RpTokenProps) => {
  const s = SIZE[size];
  return (
    <div
      aria-label="One RestylePro design token — $25 retail value"
      className={cn(
        "relative rounded-full bg-gradient-to-br from-cyan-400 to-fuchsia-500 flex items-center justify-center shrink-0",
        s.coin,
        s.ring,
        s.shadow,
        "ring-cyan-300/80",
        className,
      )}
    >
      <div className="flex flex-col items-center leading-none select-none">
        <span
          className={cn(
            "font-bold tracking-[0.18em] text-cyan-100",
            s.rp,
          )}
        >
          RP
        </span>
        <span
          className={cn(
            "font-extrabold text-white tracking-tight",
            s.price,
          )}
        >
          $25
        </span>
      </div>
      {showBadge && (
        <span
          className={cn(
            "absolute left-1/2 -translate-x-1/2 inline-flex items-center justify-center rounded-full bg-black/85 border border-cyan-400/60 shadow-md",
            s.badge,
          )}
        >
          <Car className={cn("text-cyan-200", s.car)} strokeWidth={2.6} />
        </span>
      )}
    </div>
  );
};
