import { useEffect } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Stamp, Check, ArrowRight, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToolAccessGuard } from "@/components/ToolAccessGuard";
import { LogoProCore } from "@/components/logopro/LogoProCore";

const captureUtmParams = (params: URLSearchParams) => {
  if (typeof window === "undefined") return;
  const utmKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
  const captured: Record<string, string> = {};
  for (const k of utmKeys) {
    const v = params.get(k);
    if (v) captured[k] = v;
  }
  if (Object.keys(captured).length > 0) {
    try {
      sessionStorage.setItem("logopro_utm", JSON.stringify(captured));
    } catch {
      /* ignore quota errors */
    }
  }
};

const LogoPro = () => {
  const [params] = useSearchParams();

  useEffect(() => {
    captureUtmParams(params);
  }, [params]);

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <section className="border-b border-border bg-gradient-to-b from-primary/5 to-transparent">
        <div className="mx-auto max-w-5xl px-4 py-16 md:py-24 text-center">
          <div className="mb-4 flex items-center justify-center gap-2">
            <Stamp className="h-5 w-5 text-primary" />
            <span className="text-sm font-semibold uppercase tracking-wide text-primary">
              LogoPro&trade;
            </span>
          </div>
          <h1 className="font-display text-4xl md:text-6xl font-bold tracking-tight">
            Professional logos in minutes.
            <span className="block text-primary mt-2">
              Designed by AI, finished by real designers.
            </span>
          </h1>
          <p className="mt-6 text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            Generate four logo concepts instantly. Pick your favorite. Our design team finishes it
            in print-ready PNG, SVG, and EPS — ready for vehicle wraps, signage, and the web.
          </p>
        </div>
      </section>

      {/* Core experience (tier-gated) */}
      <section className="mx-auto max-w-5xl px-4 py-12">
        <ToolAccessGuard toolName="logopro">
          <LogoProCore mode="standalone" />
        </ToolAccessGuard>
      </section>

      {/* Trust strip */}
      <section className="border-t border-border bg-card/30">
        <div className="mx-auto max-w-5xl px-4 py-12">
          <div className="grid gap-6 md:grid-cols-3">
            <div className="flex gap-3">
              <ShieldCheck className="h-6 w-6 shrink-0 text-primary" />
              <div>
                <h3 className="font-semibold">Designer reviewed</h3>
                <p className="text-sm text-muted-foreground">
                  Every logo is finished by our in-house design team before delivery — never raw
                  AI output.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <Sparkles className="h-6 w-6 shrink-0 text-primary" />
              <div>
                <h3 className="font-semibold">Wrap-ready vectors</h3>
                <p className="text-sm text-muted-foreground">
                  Receive PNG, SVG, and EPS — print-ready for vinyl cutters, RIPs, and large-format
                  printers.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <Check className="h-6 w-6 shrink-0 text-primary" />
              <div>
                <h3 className="font-semibold">Saved to your brand kit</h3>
                <p className="text-sm text-muted-foreground">
                  Use your finished logo across DesignPro, GraphicsPro, and the rest of the
                  RestylePro suite.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Cross-sell footer */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-3xl px-4 py-16 text-center space-y-4">
          <h2 className="text-2xl md:text-3xl font-bold">Already have a logo?</h2>
          <p className="text-muted-foreground">
            Wrap your fleet, your storefront, or your next custom job with the rest of the
            RestylePro suite.
          </p>
          <Button asChild size="lg" variant="outline">
            <Link to="/designpro">
              Wrap your fleet with DesignPro
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>
    </div>
  );
};

export default LogoPro;
