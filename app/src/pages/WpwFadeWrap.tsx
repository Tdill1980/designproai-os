/**
 * WpwFadeWrap — WePrintWraps FadeWraps product powered by the existing
 * DesignProAI/RestylePro FadeWrapToolUI. This is intentionally a skin/route,
 * not a second renderer: the same tool owns the hero render, six additional
 * photoreal vehicle views, proof generation and saved FadeWrap design state.
 */
import { Helmet } from "react-helmet-async";
import { RotateCcw, FolderOpen } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FadeWrapToolUI } from "@/components/productTools/FadeWrapToolUI";
import { ToolContainer } from "@/components/layout/ToolContainer";

export default function WpwFadeWrap() {
  return (
    <div className="min-h-screen bg-white text-slate-950">
      <Helmet>
        <title>WePrintWraps x FadeWraps — See Your Fade on the Vehicle</title>
        <meta
          name="description"
          content="Choose a WePrintWraps FadeWrap, see it on your vehicle in photorealistic multi-angle proofs, then continue with the printed FadeWrap product."
        />
      </Helmet>

      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white px-4 py-3 md:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <img src="/wpw-logo-mark.png" alt="WePrintWraps" className="h-9 w-auto shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-black tracking-tight sm:text-base">
                WePrintWraps <span className="text-slate-400">×</span> <span className="text-blue-600">FadeWraps</span>
              </div>
              <div className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Pick your fade · proof it on the vehicle · order the wrap
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => window.location.assign(window.location.pathname)}>
              <RotateCcw className="h-4 w-4 md:mr-2" /><span className="hidden md:inline">Start fresh</span>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/designpro/jobs"><FolderOpen className="h-4 w-4 md:mr-2" /><span className="hidden md:inline">My designs</span></Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-4 pb-5 pt-8 text-center sm:px-6 md:pt-10">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-700">WePrintWraps x FadeWraps</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-5xl">See your FadeWrap before you order it.</h1>
        <p className="mx-auto mt-3 max-w-3xl text-sm leading-6 text-slate-600 sm:text-base">
          Choose the FadeWrap, select the vehicle, and generate the same photoreal multi-angle proof workflow used by PatternPro — driver side plus six supporting vehicle views.
        </p>
      </section>

      <section className="pb-16">
        <ToolContainer>
          <FadeWrapToolUI />
        </ToolContainer>
      </section>
    </div>
  );
}
