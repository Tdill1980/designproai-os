/**
 * KitSlotTemplate — auto-renders a real branded template for each of
 * the 7 marketing kit slots, using the rep's data (name, code,
 * headshot, accent). No fake placeholders, no labels-on-color.
 *
 * Layouts share the same brand vocabulary as the existing 4:5
 * Sharing Kit post (DesignProAI gradient wordmark, dark #0B1220
 * background, rep accent strip, $25 / coupon CTA, headshot row),
 * adapted per aspect ratio and per slot's specific hook.
 *
 * Used by:
 *  - /affiliate/marketing — replaces empty card thumbnails with
 *    a real, branded preview that's the actual deliverable
 *  - /admin/rep-marketing-kits — small preview tile per slot
 */

import React from "react";

export type KitSlotType =
  | "static_1"
  | "static_2"
  | "carousel"
  | "reel"
  | "email"
  | "landing_page"
  | "wpw_banner";

interface RepLike {
  full_name: string;
  referral_code: string;
  headshot_url?: string | null;
  accent_color?: string | null;
}

const DEFAULT_ACCENT = "#38BDF8";

interface Props {
  slot: KitSlotType;
  rep: RepLike;
  scale?: number;
}

const dims: Record<KitSlotType, { w: number; h: number }> = {
  static_1:     { w: 1080, h: 1350 },
  static_2:     { w: 1080, h: 1350 },
  carousel:     { w: 1080, h: 1350 },
  reel:         { w: 1080, h: 1920 },
  email:        { w: 1600, h: 900 },
  landing_page: { w: 1600, h: 900 },
  wpw_banner:   { w: 2400, h: 900 },
};

const hookCopy: Record<KitSlotType, { eyebrow: string; headline: string; sub: string }> = {
  static_1: {
    eyebrow: "Custom Wrap Design",
    headline: "$25",
    sub: "Your vehicle · 7 angles · 2 revisions",
  },
  static_2: {
    eyebrow: "Days → Minutes",
    headline: "See it Today",
    sub: "Real 3D proof on YOUR truck — not a stock photo",
  },
  carousel: {
    eyebrow: "Card 1 of 5 · Swipe →",
    headline: "Wrap Design in Minutes",
    sub: "Not weeks. Not days. Minutes.",
  },
  reel: {
    eyebrow: "POV",
    headline: "Wrap quote\nin minutes",
    sub: "Not weeks.",
  },
  email: {
    eyebrow: "Customer Email",
    headline: "We Just Cut Wrap Design from Days to Minutes",
    sub: "$25 buys you a real 3D proof on your own vehicle. 7 angles. 2 revisions.",
  },
  landing_page: {
    eyebrow: "Your Branded Landing",
    headline: "restyleproai.com/wpw/",
    sub: "Auto-applies your 10% off code on arrival.",
  },
  wpw_banner: {
    eyebrow: "Featured Affiliate · This Week",
    headline: "$25 Custom Wrap Design",
    sub: "10% off with the featured rep's code below.",
  },
};

export function KitSlotTemplate({ slot, rep, scale = 1 }: Props) {
  const { w, h } = dims[slot];
  const accent = rep.accent_color || DEFAULT_ACCENT;
  const copy = hookCopy[slot];
  const firstName = rep.full_name.split(" ")[0];
  const slug = firstName.toLowerCase();
  const landingUrl = `restyleproai.com/wpw/${slug}`;

  // Use intrinsic dimensions and a CSS transform so the same component
  // can render as a thumbnail or full-size when exporting via canvas.
  const containerStyle: React.CSSProperties = {
    width: w,
    height: h,
    background: "#0B1220",
    color: "#fff",
    fontFamily: "Poppins, Inter, system-ui, sans-serif",
    position: "relative",
    overflow: "hidden",
    transform: `scale(${scale})`,
    transformOrigin: "top left",
  };

  const accentStrip = (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: w >= 1600 ? 10 : 8,
        background: `linear-gradient(90deg, ${accent}, ${accent}aa, ${accent})`,
      }}
    />
  );

  const brandRow = (
    <div
      style={{
        position: "absolute",
        top: w >= 1600 ? 30 : 24,
        left: w >= 1600 ? 50 : 36,
        right: w >= 1600 ? 50 : 36,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        fontSize: w >= 1600 ? 18 : 14,
        letterSpacing: 3,
        textTransform: "uppercase",
        fontWeight: 800,
        color: "#fff",
      }}
    >
      <span>
        Restyle<span style={{ color: accent }}>Pro</span>
        <span style={{ color: "#EC4899" }}>AI</span>
        <span style={{ fontSize: 10, verticalAlign: "super", marginLeft: 2 }}>™</span>
      </span>
      <span style={{ opacity: 0.7 }}>DesignProAI</span>
    </div>
  );

  const couponBlock = (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        background: accent,
        color: "#0B1220",
        padding: w >= 1600 ? "12px 20px" : "8px 14px",
        borderRadius: 999,
        fontWeight: 900,
        fontSize: w >= 1600 ? 22 : 16,
        letterSpacing: 1,
      }}
    >
      {rep.referral_code} → 10% OFF
    </div>
  );

  const repRow = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        marginTop: 14,
      }}
    >
      {rep.headshot_url ? (
        <img
          src={rep.headshot_url}
          alt={rep.full_name}
          crossOrigin="anonymous"
          style={{
            width: w >= 1600 ? 64 : 44,
            height: w >= 1600 ? 64 : 44,
            borderRadius: "50%",
            objectFit: "cover",
            border: `2px solid ${accent}`,
          }}
        />
      ) : (
        <div
          style={{
            width: w >= 1600 ? 64 : 44,
            height: w >= 1600 ? 64 : 44,
            borderRadius: "50%",
            background: `linear-gradient(135deg, ${accent}, #EC4899)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontWeight: 900,
            fontSize: w >= 1600 ? 26 : 18,
          }}
        >
          {firstName.charAt(0)}
        </div>
      )}
      <div style={{ lineHeight: 1.1 }}>
        <div
          style={{
            fontSize: w >= 1600 ? 11 : 9,
            letterSpacing: 2,
            textTransform: "uppercase",
            opacity: 0.6,
            fontWeight: 700,
          }}
        >
          Direct from
        </div>
        <div
          style={{
            fontSize: w >= 1600 ? 22 : 16,
            fontWeight: 800,
            color: "#fff",
          }}
        >
          {rep.full_name}
        </div>
      </div>
    </div>
  );

  // Layout split by aspect ratio
  if (slot === "reel") {
    // 9:16 vertical
    return (
      <div style={containerStyle}>
        {accentStrip}
        {brandRow}
        <div
          style={{
            position: "absolute",
            left: 60,
            right: 60,
            top: 280,
          }}
        >
          <div
            style={{
              fontSize: 28,
              fontWeight: 800,
              letterSpacing: 3,
              textTransform: "uppercase",
              color: accent,
              marginBottom: 12,
            }}
          >
            {copy.eyebrow}
          </div>
          <div
            style={{
              fontSize: 120,
              fontWeight: 900,
              lineHeight: 0.95,
              letterSpacing: -3,
              color: "#fff",
              whiteSpace: "pre-line",
            }}
          >
            {copy.headline}
          </div>
          <div
            style={{
              fontSize: 36,
              fontWeight: 700,
              marginTop: 24,
              color: "#fff",
              opacity: 0.85,
            }}
          >
            {copy.sub}
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            left: 60,
            right: 60,
            bottom: 80,
          }}
        >
          {couponBlock}
          {repRow}
        </div>
      </div>
    );
  }

  if (slot === "email" || slot === "landing_page" || slot === "wpw_banner") {
    // Wide layouts (16:9 or 8:3) — split left content + right CTA
    return (
      <div style={containerStyle}>
        {accentStrip}
        {brandRow}
        <div
          style={{
            position: "absolute",
            top: w >= 2400 ? 200 : 160,
            left: 60,
            right: w >= 2400 ? 900 : 700,
          }}
        >
          <div
            style={{
              fontSize: w >= 1600 ? 18 : 14,
              fontWeight: 800,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: accent,
              marginBottom: 16,
            }}
          >
            {copy.eyebrow}
          </div>
          <div
            style={{
              fontSize: w >= 2400 ? 96 : 64,
              fontWeight: 900,
              lineHeight: 1,
              letterSpacing: -2,
              color: "#fff",
            }}
          >
            {copy.headline}
            {slot === "landing_page" && (
              <span style={{ color: accent }}>{slug}</span>
            )}
          </div>
          <div
            style={{
              fontSize: w >= 1600 ? 26 : 18,
              fontWeight: 600,
              marginTop: 20,
              color: "#fff",
              opacity: 0.85,
              maxWidth: w >= 2400 ? 1100 : 800,
            }}
          >
            {copy.sub}
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            right: 60,
            top: w >= 2400 ? 220 : 200,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 18,
          }}
        >
          {couponBlock}
          {repRow}
          <div
            style={{
              fontSize: w >= 1600 ? 18 : 14,
              opacity: 0.65,
              fontFamily: "monospace",
            }}
          >
            {landingUrl}
          </div>
        </div>
      </div>
    );
  }

  // 4:5 layouts (static_1, static_2, carousel)
  const variant: Record<string, { eyebrowColor: string; bgGradient: string }> = {
    static_1: {
      eyebrowColor: accent,
      bgGradient: `radial-gradient(circle at 30% 0%, ${accent}33, transparent 60%)`,
    },
    static_2: {
      eyebrowColor: "#EC4899",
      bgGradient: "radial-gradient(circle at 70% 100%, #EC489955, transparent 60%)",
    },
    carousel: {
      eyebrowColor: "#A855F7",
      bgGradient: "radial-gradient(circle at 50% 50%, #A855F744, transparent 60%)",
    },
  };
  const v = variant[slot];

  return (
    <div style={containerStyle}>
      {/* Soft gradient mood */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: v.bgGradient,
        }}
      />
      {accentStrip}
      {brandRow}
      <div
        style={{
          position: "absolute",
          left: 60,
          right: 60,
          top: 280,
        }}
      >
        <div
          style={{
            fontSize: 20,
            fontWeight: 800,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: v.eyebrowColor,
            marginBottom: 14,
          }}
        >
          {copy.eyebrow}
        </div>
        <div
          style={{
            fontSize: slot === "static_1" ? 180 : 84,
            fontWeight: 900,
            lineHeight: 0.9,
            letterSpacing: -3,
            color: "#fff",
          }}
        >
          {copy.headline}
        </div>
        <div
          style={{
            fontSize: 28,
            fontWeight: 600,
            marginTop: 24,
            color: "#fff",
            opacity: 0.85,
          }}
        >
          {copy.sub}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 60,
          right: 60,
          bottom: 80,
        }}
      >
        {couponBlock}
        {repRow}
      </div>
    </div>
  );
}

/** Render the template into a fixed-width thumbnail container,
 *  scaling the intrinsic resolution down to fit. */
export function KitSlotThumbnail({
  slot,
  rep,
  targetWidth = 360,
}: {
  slot: KitSlotType;
  rep: RepLike;
  targetWidth?: number;
}) {
  const { w, h } = dims[slot];
  const scale = targetWidth / w;
  return (
    <div
      style={{
        width: targetWidth,
        height: h * scale,
        position: "relative",
        overflow: "hidden",
        background: "#0B1220",
      }}
    >
      <KitSlotTemplate slot={slot} rep={rep} scale={scale} />
    </div>
  );
}
