/**
 * Marketplace card surface.
 *
 * White card on the dark CreatorMarket background to make this feel
 * like a marketplace rather than a gallery. Loud sales-driven badges,
 * big industry title, small "Shown on …" line, and two clear CTAs
 * (Customize & Buy / Add Vehicle Render).
 */
import { Pencil, Package, Camera, Clock, ShoppingBag, Truck, Crown } from "lucide-react";
import { cn } from "@/lib/utils";
import { thumbnailUrl } from "@/lib/storage-thumbnail";
import {
  PRINT_READY_PRICE, VEHICLE_RENDER_ADDON_PRICE, FILE_DELIVERY_HOURS,
} from "./listing-display";

interface MarketCardProps {
  listing: any;
  industryTitle: string;
  vehicleShown: string;
  commercial: boolean;
  price: number;
  creatorDisplay: string;
  /**
   * When true (driven by neuralnetwork_creator_profiles.is_partner_shop),
   * the card renders a small gold crest on the top-right of the image
   * tagging the listing as user-submitted by a real wrap shop. Platform-
   * team listings stay crest-free.
   */
  isPartnerShop?: boolean;
  /** Open the BuyerPopup with the design-only purchase mode. */
  onCustomize: () => void;
  /** Open the BuyerPopup with the $75 vehicle-render add-on pre-selected. */
  onWithRender: () => void;
  /** Tap on the image — opens the multi-view detail modal. */
  onPreview: () => void;
  /**
   * Render the secondary "Design + Printed Wrap" CTA. Only the dashboard
   * browse tab passes this (creator-facing). The unauth grid hides it
   * to keep the card focused on the primary $350 offer.
   */
  onWithPrintedWrap?: () => void;
}

export function MarketCard({
  listing,
  industryTitle,
  vehicleShown,
  commercial,
  price,
  creatorDisplay,
  isPartnerShop,
  onCustomize,
  onWithRender,
  onPreview,
  onWithPrintedWrap,
}: MarketCardProps) {
  return (
    <article className="group relative rounded-2xl bg-white text-zinc-900 shadow-[0_10px_40px_-15px_rgba(0,0,0,0.6)] hover:shadow-[0_20px_60px_-20px_rgba(217,70,239,0.45)] hover:-translate-y-1 transition-all duration-300 overflow-hidden border border-white/10 flex flex-col">
      {/* Hero image. 16:9 matches the photo aspect of every vehicle
          render in the bucket — 4:3 was leaving big empty bands on
          mobile. */}
      <button
        type="button"
        onClick={onPreview}
        className="relative aspect-video bg-zinc-100 overflow-hidden block text-left"
        aria-label={`Preview ${industryTitle}`}
      >
        {listing.thumbnail_url ? (
          // Raw URL — Trish reported the cards looked correct "this
          // morning" and broke after PR #1711 added the CDN-resize
          // wrapper. The Supabase image-transform endpoint was
          // returning a differently-cropped image at width=640 than
          // the original render, making cars look like close-ups of
          // the wrap pattern. The original 1-3 MB renders are a
          // little slower on LTE but visually correct, and the
          // bigger detail-modal thumbs (still CDN-resized) keep the
          // grid-tap experience fast.
          <img
            src={listing.thumbnail_url}
            alt={industryTitle}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-zinc-100 to-zinc-200">
            <Package className="h-12 w-12 text-zinc-400" />
          </div>
        )}
        {/* Partner-shop crest. Marks listings whose creator profile
            has is_partner_shop = true (real shops like Royalty Wraps).
            Dark amber text on gold for readability — earlier white-
            on-gold faded out at small sizes. */}
        {isPartnerShop && (
          <div className="absolute top-2.5 right-2.5 z-10 select-none pointer-events-none">
            <div
              className="relative text-center bg-gradient-to-b from-amber-200 via-amber-400 to-amber-600 px-3 pt-1.5 pb-2.5 shadow-[0_4px_12px_-2px_rgba(120,53,15,0.6)] ring-1 ring-amber-900/30"
              style={{ clipPath: "polygon(0 0, 100% 0, 100% 78%, 50% 100%, 0 78%)" }}
            >
              <Crown className="w-3.5 h-3.5 text-black mx-auto" />
              <div className="text-[8px] font-black text-black tracking-[0.12em] uppercase mt-0.5 whitespace-nowrap leading-none">
                {creatorDisplay}
              </div>
              <div className="text-[7px] text-black/85 mt-0.5 whitespace-nowrap leading-none font-bold tracking-[0.18em] uppercase">
                Creator
              </div>
            </div>
          </div>
        )}

        {/* On commercial cards only — single gradient pill so buyers
            know placeholder branding is swappable. Same blue→magenta
            gradient used in the white body for consistency. */}
        {commercial && (
          <div className="absolute top-2.5 left-2.5">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gradient-to-r from-blue-500 to-fuchsia-500 text-white text-[10px] font-bold tracking-wider uppercase shadow">
              <Pencil className="w-2.5 h-2.5" />
              Editable branding
            </span>
          </div>
        )}
      </button>

      {/* Body */}
      <div className="p-4 sm:p-5 flex-1 flex flex-col gap-3">
        <div>
          <h3 className="text-[20px] sm:text-[22px] leading-tight font-bold text-zinc-900 line-clamp-2">
            {industryTitle}
          </h3>
          {vehicleShown && (
            <p className="text-[14px] sm:text-[15px] text-zinc-500 mt-0.5">{vehicleShown}</p>
          )}
        </div>

        {/* Two consistent blue → magenta gradient pills inside the
            white card body — replaces the old multi-colour mess
            that lived on top of the image. One palette across both
            so cards feel premium and unified. */}
        <div className="flex flex-wrap gap-1.5">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gradient-to-r from-blue-500 to-fuchsia-500 text-white text-[10px] font-bold tracking-wider uppercase shadow-sm">
            <Package className="w-2.5 h-2.5" />
            Print-Ready Files
          </span>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gradient-to-r from-blue-500 to-fuchsia-500 text-white text-[10px] font-bold tracking-wider uppercase shadow-sm">
            <Clock className="w-2.5 h-2.5" />
            {FILE_DELIVERY_HOURS}HR Design File Delivery
          </span>
        </div>

        {/* Commercial-card hero callout: this is the selling point —
            "you can replace the placeholder branding with yours" — so
            it gets a full-width amber block with bigger type, not a
            tiny pill. */}
        {commercial && (
          <div className="rounded-lg bg-gradient-to-r from-amber-100 to-amber-50 border-2 border-amber-400 px-3 py-2.5">
            <div className="flex items-start gap-2">
              <div className="shrink-0 w-7 h-7 rounded-md bg-amber-500 flex items-center justify-center">
                <Pencil className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold text-amber-900 leading-tight">
                  Replace with your business info
                </div>
                <div className="text-[12px] text-amber-800 leading-tight mt-0.5">
                  Logo · name · phone · website · colors — all included
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-end justify-between gap-2 mt-auto">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">Print-ready package</div>
            <div className="text-[28px] sm:text-[32px] leading-none font-black text-zinc-900">${price}</div>
          </div>
          <div className="text-right text-[10px] text-zinc-500 leading-tight">
            <div>Created by</div>
            <div className="text-zinc-900 font-semibold truncate max-w-[140px]">{creatorDisplay}</div>
          </div>
        </div>

        {/* Primary CTA — full width, big. */}
        <button
          type="button"
          onClick={onCustomize}
          className={cn(
            "w-full inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 text-white font-bold text-[15px] py-3 hover:bg-zinc-800 transition active:scale-[0.99]",
          )}
        >
          <ShoppingBag className="w-4 h-4" />
          Customize &amp; Buy — ${price}
        </button>

        {onWithPrintedWrap && (
          <button
            type="button"
            onClick={onWithPrintedWrap}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg text-[12px] text-zinc-500 hover:text-zinc-900 py-1 transition"
          >
            <Truck className="w-3.5 h-3.5" />
            Design + Printed Wrap (Ship USA)
          </button>
        )}

        {/* Tiny bottom link — optional +$75 preview render. Sits at
            the foot of the card so it doesn't compete with the
            primary "Customize & Buy" CTA above. */}
        <button
          type="button"
          onClick={onWithRender}
          className="self-center inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-900 underline decoration-zinc-300 hover:decoration-zinc-700 underline-offset-2 pt-0.5 transition"
        >
          <Camera className="w-3 h-3 shrink-0" />
          See on my vehicle first (+${VEHICLE_RENDER_ADDON_PRICE})
        </button>
      </div>
    </article>
  );
}
