import { useState, useRef, forwardRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Copy, ArrowLeft, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useLandingHeroRenders } from "@/hooks/useLandingHeroRenders";

/**
 * /admin/banner-preview — 1600×500 banner export tool for the
 * WePrintWraps.com header. Renders the same hero as /landing in
 * compact dimensions so the PNG can drop into Elementor as a header
 * image. Also generates an iframe HTML snippet for shops who want to
 * embed the live /landing page instead of a static PNG.
 */

const LANDING_URL = "https://designproai.com/landing";

const HERO_VIEWS = [
  {
    src: "/landing-hero/colorpro.png",
    fallbackSrc: "/colorpro-hero-corvette.png",
    label: "ColorPro™",
    urlPath: "colorpro",
    caption: "Real film colors before you print",
  },
  {
    src: "/landing-hero/designpro.png",
    fallbackSrc: "/screenshots/porsche-distressed-hero.png",
    label: "DesignProAI™",
    urlPath: "designpro",
    caption: "Real custom wrap designs · fast",
  },
  {
    src: "/landing-hero/myvehiclepro.png",
    fallbackSrc: "/screenshots/designproai-system.png",
    label: "MyVehiclePro™",
    urlPath: "myvehiclepro",
    caption: "Their car. Their truck. Their fleet.",
  },
];

export default function AdminBannerPreview() {
  const navigate = useNavigate();
  const [isExporting, setIsExporting] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);
  const { data: liveHero } = useLandingHeroRenders();

  const heroViews = HERO_VIEWS.map((view, i) => {
    const live = liveHero?.[i];
    if (!live?.src) return view;
    return {
      ...view,
      src: live.src,
      caption: live.vehicle ? `${view.caption} · ${live.vehicle}` : view.caption,
    };
  });

  const iframeSnippet = `<div style="width:100%;max-width:1600px;margin:0 auto;">
  <iframe
    src="${LANDING_URL}"
    width="100%"
    height="500"
    frameborder="0"
    scrolling="no"
    style="border:0;display:block;border-radius:14px;overflow:hidden;"
    title="DesignProAI - Vehicle Wrap Design Engine"
  ></iframe>
</div>`;

  const handleExport = async () => {
    if (!bannerRef.current) return;
    setIsExporting(true);
    toast.loading("Generating banner PNG...");
    try {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(bannerRef.current, {
        backgroundColor: "#05050B",
        scale: 2,
        useCORS: true,
        logging: false,
      });
      canvas.toBlob((blob) => {
        if (!blob) {
          toast.dismiss();
          toast.error("Export failed");
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `weprintwraps-header-${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.dismiss();
        toast.success("Banner PNG downloaded");
      }, "image/png");
    } catch (err) {
      toast.dismiss();
      toast.error("Export failed");
      console.error(err);
    } finally {
      setIsExporting(false);
    }
  };

  const handleCopyIframe = async () => {
    try {
      await navigator.clipboard.writeText(iframeSnippet);
      toast.success("Iframe HTML copied — paste into Elementor Custom HTML widget");
    } catch {
      toast.error("Copy failed — select the text manually");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-[1700px] mx-auto">
          <div className="mb-6 flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin")}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Admin
            </Button>
            <div>
              <h1 className="text-3xl font-bold text-foreground">WePrintWraps Header Banner</h1>
              <p className="text-muted-foreground text-sm">
                1600×500 banner for the WePrintWraps.com header. Same hero as <code className="text-cyan-400 bg-muted px-1 rounded">/landing</code> — pick the deploy method that fits.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">Option 1 · PNG</CardTitle>
                <CardDescription>Download the static banner. Upload to WordPress media → drop into Elementor as a header image.</CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={handleExport}
                  disabled={isExporting}
                  className="w-full bg-gradient-to-r from-cyan-500 to-fuchsia-500 hover:opacity-90 text-white font-semibold"
                >
                  <Download className="mr-2 h-4 w-4" /> {isExporting ? "Generating..." : "Export PNG (1600×500)"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">Option 2 · Embed</CardTitle>
                <CardDescription>Live iframe of /landing — auto-updates when starred renders change. Paste into Elementor Custom HTML.</CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={handleCopyIframe} variant="outline" className="w-full">
                  <Copy className="mr-2 h-4 w-4" /> Copy iframe HTML
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">Option 3 · Link</CardTitle>
                <CardDescription>Put a Join Now button on WPW that links here. Customer clicks → live React signup page.</CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={() => window.open(LANDING_URL, "_blank")}
                  variant="outline"
                  className="w-full"
                >
                  <ExternalLink className="mr-2 h-4 w-4" /> Open /landing
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Preview · 1600×500
          </div>

          <BannerFrame ref={bannerRef} views={heroViews} />

          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-base">Iframe HTML</CardTitle>
              <CardDescription>
                Paste into an Elementor "Custom HTML" widget on the WePrintWraps.com header. The iframe loads /landing live, so any time you star a different render in RevisionStudioIQ the WPW header updates automatically (no re-export needed).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="text-xs bg-muted p-4 rounded overflow-x-auto whitespace-pre-wrap text-foreground/90">
                {iframeSnippet}
              </pre>
            </CardContent>
          </Card>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            Hero pulls live from your starred renders in RevisionStudioIQ (is_featured_hero=true). Star different renders to swap which ones appear here.
          </p>
        </div>
      </main>
    </div>
  );
}

const BannerFrame = forwardRef<
  HTMLDivElement,
  { views: typeof HERO_VIEWS }
>(({ views }, ref) => {
  return (
    <div
      ref={ref}
      style={{
        width: "100%",
        maxWidth: 1600,
        margin: "0 auto",
        aspectRatio: "1600 / 500",
        background: "#000",
        borderRadius: 14,
        overflow: "hidden",
        position: "relative",
        boxShadow: "0 30px 80px rgba(0,0,0,0.5)",
        fontFamily: "Inter, sans-serif",
        color: "#fff",
      }}
    >
      {/* Background — flat black to match /pricing */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "#000",
          zIndex: 1,
        }}
      />

      {/* Logo lockup */}
      <div
        style={{
          position: "absolute",
          top: 22,
          left: 32,
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <img
          src="/sprocket/restyleproai-logo.png"
          alt="DesignProAI"
          style={{ height: 44, filter: "drop-shadow(0 4px 14px rgba(0,199,255,0.5))" }}
        />
        <span
          style={{
            fontFamily: "Oswald, sans-serif",
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.22em",
            color: "#00C7FF",
            fontWeight: 700,
            background: "rgba(0,199,255,0.10)",
            border: "1px solid rgba(0,199,255,0.4)",
            padding: "4px 10px",
            borderRadius: 999,
          }}
        >
          Vehicle Wrap Design System
        </span>
      </div>

      {/* Copy block — left half */}
      <div
        style={{
          position: "absolute",
          top: 78,
          left: 32,
          width: "44%",
          zIndex: 5,
        }}
      >
        <h1
          style={{
            fontFamily: "Oswald, sans-serif",
            fontSize: 38,
            fontWeight: 700,
            lineHeight: 1.0,
            letterSpacing: "-0.5px",
            textTransform: "uppercase",
            margin: 0,
            marginBottom: 6,
          }}
        >
          The Future of Wrap Design
        </h1>
        <p
          style={{
            fontFamily: "Oswald, sans-serif",
            fontSize: 24,
            fontWeight: 700,
            lineHeight: 1.0,
            letterSpacing: "-0.3px",
            textTransform: "uppercase",
            margin: 0,
            marginBottom: 12,
          }}
        >
          <span
            style={{
              background: "linear-gradient(90deg, #3B82F6, #D946EF)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            Design and Marketing Engine
          </span>
        </p>
        <p
          style={{
            fontSize: 13,
            color: "rgba(255,255,255,0.75)",
            lineHeight: 1.4,
            margin: 0,
            marginBottom: 14,
          }}
        >
          Design it. Show it. Close it.
        </p>

        {/* CTA + price line */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "11px 20px",
              borderRadius: 999,
              background: "linear-gradient(90deg, #3B82F6, #D946EF)",
              color: "#fff",
              fontFamily: "Oswald, sans-serif",
              fontSize: 13,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              boxShadow:
                "0 0 0 1px rgba(255,255,255,0.18) inset, 0 12px 36px rgba(217,70,239,0.4), 0 4px 16px rgba(0,199,255,0.3)",
            }}
          >
            Enter DesignProAI™ →
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", lineHeight: 1.5 }}>
            WePrintWraps customers · <strong style={{ color: "#fff" }}>$50 off every tier</strong> · from $350/mo
          </div>
        </div>
      </div>

      {/* Right half — clean row of 3 equal tiles */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          right: 24,
          transform: "translateY(-50%)",
          width: "50%",
          display: "flex",
          gap: 12,
          zIndex: 4,
        }}
      >
        {views.map((v, i) => (
          <BannerTile
            key={i}
            view={v}
            style={{ flex: 1, aspectRatio: "4 / 3" }}
          />
        ))}
      </div>
    </div>
  );
});
BannerFrame.displayName = "BannerFrame";

function BannerTile({
  view,
  style,
}: {
  view: typeof HERO_VIEWS[number];
  style: React.CSSProperties;
}) {
  const handleError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.src.endsWith(view.fallbackSrc)) return;
    img.src = view.fallbackSrc;
  };

  return (
    <div
      style={{
        ...style,
        position: "relative",
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid #48484a",
        background: "#1c1c1e",
        boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
      }}
    >
      <img
        src={view.src}
        alt={view.label}
        onError={handleError}
        crossOrigin="anonymous"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "contain",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: "6px 10px",
          background: "linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0.3), transparent)",
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: "#fff", lineHeight: 1.1 }}>
          {view.label}
        </div>
      </div>
    </div>
  );
}
