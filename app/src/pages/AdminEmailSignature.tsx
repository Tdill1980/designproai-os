import { useState, useRef, forwardRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Copy, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

const COPY_VARIANTS = [
  {
    key: "ondemand",
    name: "WPW · On Demand",
    headline: "A Real Wrap Designer On Demand",
    body: "WPW exclusive · $50 off every tier. From $350/mo. You create it. You show it. You close it.",
    cta: "Claim $50 Off",
  },
  {
    key: "reimagined",
    name: "Short · Reimagined",
    headline: "Custom Wrap Design. Reimagined.",
    body: "DesignPro™ memberships start at $350/mo. ProductionPacks™ $299 — print-ready file ownership included.",
    cta: "Enter DesignProAI™",
  },
  {
    key: "future",
    name: "Long · The Future",
    headline: "The Future of Custom Wrap Design",
    body: "Hyper-realistic concepts. Real vehicle mockups. Customer proofs. Built for wrap shops. From $350/mo.",
    cta: "Join Now",
  },
  {
    key: "concise",
    name: "Compact · One-liner",
    headline: "Custom Wrap Design at your fingertips",
    body: "DesignPro™ from $350/mo · ProductionPacks™ $299",
    cta: "Try DesignProAI™",
  },
];

const SIGNATURE_HOSTED_URL = "https://designproai.com/email-signature.png";
const SIGNATURE_LINK = "https://designproai.com/pricing";

export default function AdminEmailSignature() {
  const navigate = useNavigate();
  const [variantKey, setVariantKey] = useState(COPY_VARIANTS[0].key);
  const [isExporting, setIsExporting] = useState(false);
  const sigRef = useRef<HTMLDivElement>(null);
  const variant = COPY_VARIANTS.find((v) => v.key === variantKey)!;

  const handleExport = async () => {
    if (!sigRef.current) return;
    setIsExporting(true);
    toast.loading("Generating signature PNG...");
    try {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(sigRef.current, {
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
        a.download = `weprintwraps-signature-${variant.key}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.dismiss();
        toast.success("Signature PNG downloaded");
      }, "image/png");
    } catch (err) {
      toast.dismiss();
      toast.error("Export failed");
      console.error(err);
    } finally {
      setIsExporting(false);
    }
  };

  const outlookSnippet = `<a href="${SIGNATURE_LINK}" target="_blank" rel="noopener" style="display:inline-block;text-decoration:none;border:0;outline:none;">
  <img src="${SIGNATURE_HOSTED_URL}" alt="DesignProAI - Custom Wrap Design" width="600" style="display:block;border:0;outline:none;text-decoration:none;max-width:600px;width:100%;height:auto;" />
</a>`;

  const handleCopySnippet = async () => {
    try {
      await navigator.clipboard.writeText(outlookSnippet);
      toast.success("HTML snippet copied to clipboard");
    } catch {
      toast.error("Copy failed — select the text manually");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-5xl mx-auto">
          <div className="mb-6 flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin")}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Admin
            </Button>
            <div>
              <h1 className="text-3xl font-bold text-foreground">WePrintWraps Email Signature</h1>
              <p className="text-muted-foreground text-sm">
                600×200 promo banner for the bottom of every Outlook email. Pick copy, export PNG, paste the snippet into Outlook signature settings.
              </p>
            </div>
          </div>

          <Card className="mb-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">Copy variant</CardTitle>
              <CardDescription>Pick the headline + body copy to render</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {COPY_VARIANTS.map((v) => (
                <Button
                  key={v.key}
                  size="sm"
                  variant={variantKey === v.key ? "default" : "outline"}
                  onClick={() => setVariantKey(v.key)}
                  className={variantKey === v.key ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500" : ""}
                >
                  {v.name}
                </Button>
              ))}
            </CardContent>
          </Card>

          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Preview · 600×200</h2>
            <Button onClick={handleExport} disabled={isExporting} className="bg-gradient-to-r from-cyan-500 to-fuchsia-500 hover:opacity-90 text-white font-semibold">
              <Download className="mr-2 h-4 w-4" /> {isExporting ? "Generating..." : "Export PNG"}
            </Button>
          </div>

          <div className="bg-white p-8 rounded-lg mb-6 flex justify-center">
            <SignatureFrame ref={sigRef} variant={variant} />
          </div>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Add to Outlook</CardTitle>
              <CardDescription>
                Two-step setup — upload the PNG to your site, then paste this HTML into Outlook's signature editor.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Step 1 — Host the PNG</div>
                <p className="text-sm text-muted-foreground">
                  Upload the exported PNG to <code className="text-cyan-400 bg-muted px-1.5 py-0.5 rounded text-xs">{SIGNATURE_HOSTED_URL}</code> (or any public URL). Outlook needs a hosted image — it can't embed a local file reliably across recipients.
                </p>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Step 2 — Outlook signature HTML</div>
                  <Button size="sm" variant="outline" onClick={handleCopySnippet}>
                    <Copy className="mr-2 h-3.5 w-3.5" /> Copy snippet
                  </Button>
                </div>
                <pre className="text-xs bg-muted p-4 rounded overflow-x-auto whitespace-pre-wrap text-foreground/90">
                  {outlookSnippet}
                </pre>
                <p className="text-xs text-muted-foreground mt-2">
                  In Outlook: <strong>File → Options → Mail → Signatures…</strong> → New signature → switch the editor to HTML mode (Insert → Source) → paste this snippet → Save. New emails will include it automatically.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

const SignatureFrame = forwardRef<
  HTMLDivElement,
  { variant: { headline: string; body: string; cta: string } }
>(({ variant }, ref) => {
  return (
    <div
      ref={ref}
      style={{
        width: 600,
        height: 200,
        background:
          "radial-gradient(ellipse 60% 80% at 22% 50%, rgba(0,199,255,0.22), transparent 60%), radial-gradient(ellipse 50% 70% at 78% 50%, rgba(217,70,239,0.20), transparent 60%), linear-gradient(135deg, #08081a 0%, #0a0a14 50%, #100515 100%)",
        borderRadius: 12,
        position: "relative",
        overflow: "hidden",
        fontFamily: "Inter, sans-serif",
        color: "#fff",
        boxShadow: "0 0 0 1px rgba(0,199,255,0.2)",
      }}
    >
      {/* Streak */}
      <div
        style={{
          position: "absolute",
          width: "200%",
          height: 1,
          top: "30%",
          left: "-50%",
          background: "linear-gradient(90deg, transparent, #00C7FF 40%, #D946EF 60%, transparent)",
          transform: "rotate(-6deg)",
          opacity: 0.5,
        }}
      />
      {/* Logo lockup */}
      <div
        style={{
          position: "absolute",
          top: 16,
          left: 18,
          display: "flex",
          alignItems: "center",
          gap: 8,
          zIndex: 5,
        }}
      >
        <img
          src="/sprocket/restyleproai-logo.png"
          alt="DesignProAI"
          style={{ height: 32, filter: "drop-shadow(0 4px 12px rgba(0,199,255,0.5))" }}
        />
      </div>

      {/* Copy block */}
      <div
        style={{
          position: "absolute",
          top: 60,
          left: 18,
          right: 200,
          zIndex: 5,
        }}
      >
        <h2
          style={{
            fontFamily: "Oswald, sans-serif",
            fontSize: 22,
            fontWeight: 700,
            lineHeight: 1.05,
            letterSpacing: "-0.3px",
            margin: 0,
            marginBottom: 8,
            textTransform: "uppercase",
          }}
        >
          {variant.headline.split(/(\bReimagined\b|\bFingertips\b|\bFuture\b|\bOn Demand\b)/).map((part, i) => {
            const isAccent = /Reimagined|Fingertips|Future|On Demand/.test(part);
            return isAccent ? (
              <span
                key={i}
                style={{
                  background: "linear-gradient(90deg, #00C7FF, #D946EF)",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                }}
              >
                {part}
              </span>
            ) : (
              <span key={i}>{part}</span>
            );
          })}
        </h2>
        <p
          style={{
            fontSize: 11.5,
            color: "rgba(255,255,255,0.85)",
            lineHeight: 1.4,
            margin: 0,
          }}
        >
          {variant.body}
        </p>
      </div>

      {/* CTA */}
      <div
        style={{
          position: "absolute",
          right: 18,
          top: "50%",
          transform: "translateY(-50%)",
          zIndex: 5,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "11px 18px",
            borderRadius: 999,
            background: "linear-gradient(90deg, #00C7FF, #D946EF)",
            color: "#fff",
            fontFamily: "Oswald, sans-serif",
            fontSize: 12,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            boxShadow:
              "0 0 0 1px rgba(255,255,255,0.18) inset, 0 8px 24px rgba(217,70,239,0.4), 0 4px 12px rgba(0,199,255,0.3)",
          }}
        >
          {variant.cta} →
        </div>
        <div
          style={{
            marginTop: 8,
            textAlign: "center",
            fontFamily: "Oswald, sans-serif",
            fontSize: 9,
            letterSpacing: "0.16em",
            color: "rgba(255,255,255,0.55)",
            textTransform: "uppercase",
          }}
        >
          restyleproai.com
        </div>
      </div>

      {/* Bottom border accent */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 3,
          background: "linear-gradient(90deg, #00C7FF, #D946EF)",
        }}
      />
    </div>
  );
});
SignatureFrame.displayName = "SignatureFrame";
