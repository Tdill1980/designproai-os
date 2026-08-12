/**
 * WpwRepToolkitCard — paste-and-share toolkit for a WPW / partner rep.
 *
 * Rendered inside /affiliate/dashboard when the logged-in user's
 * affiliate_partners.referral_code matches a slug in WPW_REPS. One
 * card holds everything a rep needs to share without ever asking us
 * "what's my link again?":
 *
 *   - Rep identity: headshot + name + title in the rep's accent color
 *   - Customer-facing URL (drops them into DesignPro + popup)
 *   - Coupon code (auto-applies via URL)
 *   - Scannable QR code (Download PNG)
 *   - 4:5 social post image (Download PNG — sized for IG / FB feed)
 *   - 3 paste-able templates (email reply, SMS, social caption)
 *   - Commission cheat sheet
 *
 * The 4:5 post is rendered live as an HTML element (rep-branded,
 * with photo + code + QR + the $25 offer headline) and converted to
 * a downloadable PNG via html2canvas so reps can drag it straight
 * into Instagram / Facebook / a story without opening Canva.
 */

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import html2canvas from "html2canvas";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/affiliate/CopyButton";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  ExternalLink,
  Mail,
  MessageSquare,
  Hash,
  BookOpen,
  Download,
  ImageDown,
  Loader2,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  defaultHeadshotPath,
  defaultHeroPath,
  defaultOrgLogoPath,
  type WpwRep,
} from "@/lib/wpw-reps";

/** McLaren koi 3D proof — the canonical wrap-design hero we fall back
 * to when a rep hasn't uploaded their own signature work yet. Same
 * image the /try and /wpw/:rep pages use as their hero fallback. */
const FALLBACK_HERO_RENDER =
  "https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/email-assets/McLaren%20koi%20proof%203d.jpeg";
import { toast } from "sonner";

interface WpwRepToolkitCardProps {
  rep: WpwRep;
  /** Production origin used to build absolute share URLs. */
  origin?: string;
}

const buildSnippets = (rep: WpwRep, fullUrl: string) => [
  {
    key: "email",
    label: "Email reply",
    icon: Mail,
    description:
      "Paste into a reply when a customer asks for a quote or a proof.",
    text: [
      `Hey,`,
      ``,
      `Easiest way to see your wrap idea is to build it yourself for $250 on my page — custom AI design on your exact vehicle, 7 angles, 3 revisions in Revision Studio, and a free push to CreatorMarket where the design can resell for $350:`,
      ``,
      fullUrl,
      ``,
      `Code ${rep.coupon} knocks 10% off ($225 total). If you love the design, you can grab the $299 Production Pack for print-ready files — or just have us print it at WePrintWraps.com and we'll hand you the square footage.`,
      ``,
      `Reply here with any questions and I'll jump in.`,
      ``,
      `— ${rep.name}`,
      `${rep.org ?? "WePrintWraps"}`,
    ].join("\n"),
  },
  {
    key: "sms",
    label: "Text message",
    icon: MessageSquare,
    description: "Short version — drop it into a text thread or DM.",
    text: `Hey — $250 gets you a custom AI wrap design on your truck (7 angles, 3 revisions). My code ${rep.coupon} knocks 10% off → ${fullUrl} — ${rep.name}`,
  },
  {
    key: "social",
    label: "Social caption",
    icon: Hash,
    description:
      "Caption for Instagram / Facebook post — pair it with the 4:5 image below.",
    text: [
      `Stop guessing what a wrap will look like on YOUR vehicle.`,
      ``,
      `$250 gets you a custom AI design rendered on your exact ride — 7 photorealistic angles, 3 revisions in Revision Studio, and a free push to CreatorMarket where the design can resell for $350.`,
      ``,
      `Love it? Grab the $299 Production Pack for print-ready files, or have us print it at WePrintWraps.com.`,
      ``,
      `Use code ${rep.coupon} for 10% off → ${fullUrl}`,
      ``,
      `#vehiclewraps #weprintwraps #restyleproai #customwraps`,
    ].join("\n"),
  },
];

export function WpwRepToolkitCard({
  rep,
  origin: originProp,
}: WpwRepToolkitCardProps) {
  const origin =
    originProp ||
    (typeof window !== "undefined"
      ? window.location.origin
      : "https://restyleproai.com");
  // Customer-facing URL — lands them on DesignPro with the rep-branded
  // $25 popup pre-opened, code prefilled. This is the link reps share.
  const fullUrl = `${origin}/designpro?ref=${encodeURIComponent(
    rep.ref,
  )}&promo=${encodeURIComponent(rep.coupon)}&try=1`;
  // Short rep-page URL — same destination, more memorable for verbal
  // share ("go to restyleproai.com/wpw/troy"). Auto-redirects to fullUrl.
  const shortUrl = `${origin}/wpw/${rep.slug}`;
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrForPostUrl, setQrForPostUrl] = useState<string | null>(null);
  const postRef = useRef<HTMLDivElement | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      QRCode.toDataURL(fullUrl, {
        margin: 1,
        width: 240,
        color: { dark: "#000000", light: "#FFFFFF" },
      }),
      QRCode.toDataURL(fullUrl, {
        margin: 1,
        width: 360,
        color: { dark: "#0F172A", light: "#FFFFFF" },
      }),
    ])
      .then(([smallQr, postQr]) => {
        if (cancelled) return;
        setQrDataUrl(smallQr);
        setQrForPostUrl(postQr);
      })
      .catch((err) => {
        console.error("[WpwRepToolkitCard] QR generation failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [fullUrl]);

  const snippets = buildSnippets(rep, fullUrl);
  const headshot = defaultHeadshotPath(rep);

  const handleDownloadPost = async () => {
    if (!postRef.current) return;
    setDownloading(true);
    try {
      const canvas = await html2canvas(postRef.current, {
        scale: 2,
        backgroundColor: null,
        useCORS: true,
      });
      const dataUrl = canvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `restylepro-${rep.slug}-social-post.png`;
      link.click();
      toast.success("Social post downloaded");
    } catch (err) {
      console.error("[WpwRepToolkitCard] post download failed:", err);
      toast.error("Couldn't generate the image. Try again.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card
      className="bg-white shadow-[0_4px_24px_rgba(56,189,248,0.10)]"
      style={{ borderColor: `${rep.accent}55` }}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-4">
            <img
              src={headshot}
              alt={rep.name}
              className="w-16 h-16 rounded-full object-cover shadow-md ring-2"
              style={{ borderColor: rep.accent, boxShadow: `0 0 0 2px ${rep.accent}55` }}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
            <div>
              <Badge
                variant="outline"
                className="mb-2"
                style={{
                  borderColor: `${rep.accent}55`,
                  background: `${rep.accent}14`,
                  color: rep.accent,
                }}
              >
                <Sparkles className="h-3 w-3 mr-1" />
                Rep Toolkit · {rep.name}
              </Badge>
              <CardTitle className="text-lg text-gray-900">
                Your share-anywhere kit
              </CardTitle>
              <CardDescription className="text-gray-600">
                Your link, your code, your QR, and a ready-to-post 4:5 image.
                Every signup or $25 design through these is tracked to you.
              </CardDescription>
            </div>
          </div>
          <Button
            asChild
            size="sm"
            className="text-white border-0 shadow-sm hover:opacity-90 shrink-0"
            style={{
              background: `linear-gradient(90deg, ${rep.accent}, ${rep.accent}cc)`,
            }}
          >
            <a href={fullUrl} target="_blank" rel="noreferrer">
              Preview
              <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
            </a>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* URL + coupon + QR row */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-start">
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Your share URL
              </label>
              <div className="flex items-center gap-2 mt-1">
                <code className="flex-1 bg-gray-50 border border-gray-200 rounded px-3 py-2 text-xs text-gray-800 break-all">
                  {fullUrl}
                </code>
                <CopyButton text={fullUrl} label="Copy" />
              </div>
              <p className="text-[11px] text-gray-500 mt-1.5">
                Short version (easier to say out loud):{" "}
                <code className="text-gray-700">{shortUrl}</code>
              </p>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Your coupon code
              </label>
              <div className="flex items-center gap-2 mt-1">
                <code
                  className="flex-1 border rounded px-3 py-2 text-sm font-mono font-bold tracking-wider"
                  style={{
                    background: `${rep.accent}10`,
                    borderColor: `${rep.accent}55`,
                    color: rep.accent,
                  }}
                >
                  {rep.coupon}
                </code>
                <CopyButton text={rep.coupon} label="Copy" />
              </div>
              <p className="text-[11px] text-gray-500 mt-1.5">
                10% off the $250 custom design OR a customer&apos;s first month
                of any RestylePro subscription. Auto-applies via your URL.
              </p>
            </div>
          </div>
          {qrDataUrl && (
            <div className="flex flex-col items-center gap-2 shrink-0">
              <img
                src={qrDataUrl}
                alt={`QR code for ${fullUrl}`}
                width={120}
                height={120}
                className="rounded-md border border-gray-200 bg-white p-1"
              />
              <Button
                variant="ghost"
                size="sm"
                className="text-[11px] h-7"
                style={{ color: rep.accent }}
                asChild
              >
                <a href={qrDataUrl} download={`restylepro-${rep.slug}-qr.png`}>
                  <Download className="h-3 w-3 mr-1" />
                  Download QR
                </a>
              </Button>
            </div>
          )}
        </div>

        {/* 4:5 social post generator — live preview + PNG download */}
        <div className="rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-white p-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-bold text-gray-900">
                <ImageDown className="h-4 w-4" style={{ color: rep.accent }} />
                Instagram / Facebook post (4:5)
              </div>
              <p className="text-[11px] text-gray-500 mt-1">
                Branded with your photo, code &amp; QR. Download as PNG and drag
                it straight into your IG or FB post.
              </p>
            </div>
            <Button
              size="sm"
              onClick={handleDownloadPost}
              disabled={downloading || !qrForPostUrl}
              className="text-white border-0 shadow-sm hover:brightness-110 shrink-0"
              style={{
                background: `linear-gradient(90deg, ${rep.accent}, ${rep.accent}cc)`,
              }}
            >
              {downloading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-1.5" />
                  Download PNG
                </>
              )}
            </Button>
          </div>

          <div className="flex justify-center">
            <SocialPost4x5
              ref={postRef}
              rep={rep}
              qrDataUrl={qrForPostUrl}
              shortUrl={shortUrl}
              headshot={headshot}
            />
          </div>
        </div>

        {/* Paste-able snippets */}
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Paste-and-send templates
          </div>
          {snippets.map((snippet) => {
            const Icon = snippet.icon;
            return (
              <div
                key={snippet.key}
                className="rounded-lg border border-gray-200 bg-gray-50/60 p-3"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                    <Icon className="h-4 w-4" style={{ color: rep.accent }} />
                    {snippet.label}
                  </div>
                  <CopyButton text={snippet.text} label="Copy" />
                </div>
                <p className="text-[11px] text-gray-500 mb-2">
                  {snippet.description}
                </p>
                <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed text-gray-800 bg-white border border-gray-200 rounded p-2 max-h-48 overflow-auto">
                  {snippet.text}
                </pre>
              </div>
            );
          })}
        </div>

        {/* Commission cheat sheet */}
        <div className="rounded-lg border border-fuchsia-200 bg-gradient-to-r from-fuchsia-50 via-pink-50 to-fuchsia-50 p-3 text-xs text-gray-700 leading-relaxed">
          <span className="font-semibold text-fuchsia-700">
            What you earn:
          </span>{" "}
          20% on every $250 design sold through your link (~$50) and 20% on a
          customer&apos;s first month of any subscription they buy ($70–$199).
          Single-payout — you don&apos;t earn on renewals. Stats and payouts
          are in the cards below.
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Button
            asChild
            size="sm"
            className="justify-start text-white border-0 hover:opacity-90"
            style={{
              background: `linear-gradient(90deg, ${rep.accent}, ${rep.accent}cc)`,
            }}
          >
            <Link to="/help/wpw-rep-guide">
              <BookOpen className="h-4 w-4 mr-2" />
              Rep playbook
            </Link>
          </Button>
          <Button
            asChild
            size="sm"
            variant="outline"
            className="justify-start"
            style={{
              borderColor: `${rep.accent}55`,
              color: rep.accent,
            }}
          >
            <Link to="/help/restylepro-walkthrough">
              <Sparkles className="h-4 w-4 mr-2" />
              Customer walkthrough (sharable)
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * SocialPost4x5 — the 1080×1350 (4:5) preview that gets downloaded as
 * a PNG. Rendered at half size on screen via the wrapper width, then
 * captured at 2x scale by html2canvas so the exported PNG is the
 * native Instagram feed resolution. Layout:
 *
 *   ┌──────────────────────────────────────────────┐
 *   │  RestyleProAI™  ·  DesignProAI               │
 *   │                                              │
 *   │  CUSTOM WRAP DESIGN                          │
 *   │  $25                                         │
 *   │  rendered from 7 angles · 3 revisions        │
 *   │  + free CreatorMarket push                   │
 *   │                                              │
 *   │  [photo]  Direct from <Rep>                  │
 *   │           <Title>                            │
 *   │                                              │
 *   │  Code [CODE10] — 10% off                     │
 *   │  restyleproai.com/wpw/<slug>      [QR]       │
 *   └──────────────────────────────────────────────┘
 */
const SocialPost4x5 = ({
  ref,
  rep,
  qrDataUrl,
  shortUrl,
  headshot,
}: {
  ref: React.MutableRefObject<HTMLDivElement | null>;
  rep: WpwRep;
  qrDataUrl: string | null;
  shortUrl: string;
  headshot: string;
}) => {
  // Resolve the wrap-design hero — try the rep's signature work first
  // (/reps/<slug>/hero.jpg) and fall back to the canonical McLaren koi
  // 3D proof so the post never ships with empty space.
  const heroSrc = defaultHeroPath(rep);
  return (
    <div
      ref={ref}
      className="relative overflow-hidden text-white shadow-2xl"
      style={{
        width: 360,
        height: 450, // exactly 4:5
        background: "#0B1220",
        borderRadius: 0,
        fontFamily: "Poppins, Inter, system-ui, sans-serif",
      }}
    >
      {/* Hero wrap-design image — covers the top 55% of the post.
          Uses crossOrigin so html2canvas can include it in the
          exported PNG. onError swaps to the global fallback render
          so a missing per-rep hero doesn't show a broken image. */}
      <img
        src={heroSrc}
        alt={`Custom wrap design by ${rep.name}`}
        crossOrigin="anonymous"
        onError={(e) => {
          const img = e.currentTarget as HTMLImageElement;
          if (img.src !== FALLBACK_HERO_RENDER) {
            img.src = FALLBACK_HERO_RENDER;
          }
        }}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: 248,
          objectFit: "cover",
        }}
      />

      {/* Image gradient overlay — bottom of the photo fades to the
          dark panel below so the brand row reads on top of any
          render, light or dark. */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 248,
          background:
            "linear-gradient(180deg, rgba(11,18,32,0.55) 0%, rgba(11,18,32,0.05) 35%, rgba(11,18,32,0.6) 80%, #0B1220 100%)",
        }}
      />

      {/* Top accent strip */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 6,
          background: `linear-gradient(90deg, ${rep.accent}, ${rep.accent}99, ${rep.accent})`,
        }}
      />

      {/* Brand row — sits on top of the image, dark gradient overlay
          provides contrast */}
      <div
        style={{
          position: "absolute",
          top: 18,
          left: 22,
          right: 22,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 11,
          letterSpacing: 2,
          textTransform: "uppercase",
          fontWeight: 700,
          color: "#fff",
          textShadow: "0 1px 4px rgba(0,0,0,0.55)",
        }}
      >
        <span>RestyleProAI™</span>
        <span style={{ color: rep.accent }}>DesignProAI</span>
      </div>

      {/* Price chip — overlaid on the bottom-left of the image so the
          $25 reads against the design itself, hero-style. */}
      <div
        style={{
          position: "absolute",
          top: 168,
          left: 22,
          right: 22,
        }}
      >
        <div
          style={{
            display: "inline-block",
            background: rep.accent,
            color: "#fff",
            padding: "4px 10px",
            borderRadius: 6,
            fontSize: 10,
            letterSpacing: 2.5,
            textTransform: "uppercase",
            fontWeight: 800,
            marginBottom: 4,
          }}
        >
          Custom Wrap Design
        </div>
        <div
          style={{
            fontSize: 54,
            fontWeight: 900,
            lineHeight: 0.95,
            letterSpacing: -2,
            color: "#fff",
            textShadow: "0 2px 12px rgba(0,0,0,0.65)",
          }}
        >
          $250
        </div>
      </div>

      {/* Dark panel under the image — bullets, rep card, coupon, QR.
          Solid #0B1220 background ties cleanly to the image overlay's
          fade-to-color, replacing the harsh diagonal gradient. */}
      <div
        style={{
          position: "absolute",
          top: 248,
          left: 0,
          right: 0,
          bottom: 0,
          background: "#0B1220",
          padding: "12px 22px 18px",
        }}
      >
        <div
          style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.78)",
            lineHeight: 1.4,
            fontWeight: 500,
            marginBottom: 8,
          }}
        >
          Your vehicle · 7 photorealistic angles · 3 revisions
          <br />+ free CreatorMarket push ($350 resale)
        </div>
      </div>

      {/* Rep card */}
      <div
        style={{
          position: "absolute",
          top: 300,
          left: 22,
          right: 22,
          background: "rgba(255,255,255,0.07)",
          border: "1px solid rgba(255,255,255,0.10)",
          borderRadius: 12,
          padding: "10px 12px",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <img
          src={headshot}
          alt={rep.name}
          style={{
            width: 60,
            height: 60,
            borderRadius: "50%",
            objectFit: "cover",
            border: `3px solid ${rep.accent}`,
          }}
          crossOrigin="anonymous"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
          }}
        />
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 9,
              letterSpacing: 2,
              textTransform: "uppercase",
              fontWeight: 700,
              color: rep.accent,
            }}
          >
            Direct from
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span
              style={{
                fontSize: 18,
                fontWeight: 800,
                color: "#fff",
                lineHeight: 1.1,
              }}
            >
              {rep.name}
            </span>
            {/* Org logo co-brand — only renders if the rep has one
                (RoyaltyWraps for Amanda/Xavier, VinylVixenWraps for
                Jess, etc.). Sits next to the rep name in the Direct
                From card so the customer sees the shop affiliation. */}
            {defaultOrgLogoPath(rep) && (
              <img
                src={defaultOrgLogoPath(rep) ?? ""}
                alt={rep.org ?? "Org"}
                crossOrigin="anonymous"
                style={{
                  height: 22,
                  width: "auto",
                  objectFit: "contain",
                  filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.4))",
                }}
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            )}
          </div>
          <div
            style={{
              fontSize: 10,
              color: "rgba(255,255,255,0.65)",
              marginTop: 1,
            }}
          >
            {rep.title}
          </div>
        </div>
      </div>

      {/* 10% OFF banner — pinned above the code+QR row so the discount
          reads clearly without the QR visually crowding the label. */}
      <div
        style={{
          position: "absolute",
          bottom: 130,
          left: 22,
          right: 22,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          padding: "5px 10px",
          background: rep.accent,
          borderRadius: 6,
          color: "#fff",
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: 2.5,
          textTransform: "uppercase",
        }}
      >
        Use code · 10% off · save $2.50
      </div>

      {/* Code chip + URL on the left, QR on the right. The 10% off
          callout above this row carries the discount messaging so the
          QR can occupy the right column without overlapping copy. */}
      <div
        style={{
          position: "absolute",
          bottom: 18,
          left: 22,
          right: 22,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              display: "inline-block",
              padding: "8px 14px",
              borderRadius: 8,
              background: rep.accent,
              color: "#fff",
              fontSize: 22,
              fontWeight: 900,
              letterSpacing: 1.5,
              fontFamily: "monospace",
            }}
          >
            {rep.coupon}
          </div>
          <div
            style={{
              fontSize: 10,
              color: "rgba(255,255,255,0.75)",
              marginTop: 8,
              fontWeight: 500,
              wordBreak: "break-all",
            }}
          >
            {shortUrl.replace(/^https?:\/\//, "")}
          </div>
        </div>
        {qrDataUrl && (
          <img
            src={qrDataUrl}
            alt="QR"
            style={{
              width: 90,
              height: 90,
              borderRadius: 8,
              background: "#fff",
              padding: 5,
            }}
          />
        )}
      </div>
    </div>
  );
};
