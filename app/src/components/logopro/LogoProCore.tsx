import { useEffect, useMemo, useState } from "react";
import { Sparkles, Stamp, Check, Download, Loader2, AlertCircle, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface LogoProCoreProps {
  mode: "embedded" | "standalone";
  returnToDesignProProjectId?: string;
  onLogoFinalized?: (urls: { png: string; svg: string; eps: string }) => void;
  initialCompanyName?: string;
  initialBrandColors?: string[];
}

type Step = "form" | "generating" | "concepts" | "qc_pending" | "finalized" | "failed";

interface Concept {
  conceptNumber: number;
  imageUrl: string;
  conceptId?: string;
}

interface ProjectRow {
  id: string;
  status: string;
  final_png_url: string | null;
  final_svg_url: string | null;
  final_eps_url: string | null;
}

const KEYWORD_SUGGESTIONS = [
  "modern",
  "bold",
  "minimalist",
  "rugged",
  "luxury",
  "playful",
  "vintage",
  "tech",
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export const LogoProCore = ({
  mode,
  returnToDesignProProjectId,
  onLogoFinalized,
  initialCompanyName,
  initialBrandColors,
}: LogoProCoreProps) => {
  const { toast } = useToast();

  const [step, setStep] = useState<Step>("form");
  const [companyName, setCompanyName] = useState(initialCompanyName || "");
  const [industry, setIndustry] = useState("");
  const [mascotDescription, setMascotDescription] = useState("");
  const [colorInput, setColorInput] = useState("");
  const [brandColors, setBrandColors] = useState<string[]>(initialBrandColors || []);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");

  const [projectId, setProjectId] = useState<string | null>(null);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [selectedConcept, setSelectedConcept] = useState<Concept | null>(null);
  const [feedback, setFeedback] = useState("");
  const [_ticketId, setTicketId] = useState<string | null>(null);
  const [finalUrls, setFinalUrls] = useState<{ png: string; svg: string; eps: string } | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const formInvalid = useMemo(() => {
    if (!companyName.trim()) return "Company name is required";
    if (companyName.length > 100) return "Company name must be 100 characters or fewer";
    if (mascotDescription.length > 500) return "Mascot description must be 500 characters or fewer";
    if (brandColors.length > 3) return "Up to 3 brand colors";
    if (keywords.length > 5) return "Up to 5 keywords";
    return null;
  }, [companyName, mascotDescription, brandColors, keywords]);

  // Poll project status while in QC
  useEffect(() => {
    if (step !== "qc_pending" || !projectId) return;
    let cancelled = false;
    let timer: number | undefined;

    const tick = async () => {
      const { data, error } = await supabase
        .from("logopro_projects")
        .select("id, status, final_png_url, final_svg_url, final_eps_url")
        .eq("id", projectId)
        .maybeSingle<ProjectRow>();
      if (cancelled) return;
      if (error) {
        console.error("[LogoProCore] poll error", error);
        return;
      }
      if (data && data.status === "finalized" && data.final_png_url && data.final_svg_url && data.final_eps_url) {
        const urls = {
          png: data.final_png_url,
          svg: data.final_svg_url,
          eps: data.final_eps_url,
        };
        setFinalUrls(urls);
        setStep("finalized");
        onLogoFinalized?.(urls);
        return;
      }
      if (data && (data.status === "failed" || data.status === "cancelled")) {
        setErrorMessage("Project ended before delivery. Please contact support.");
        setStep("failed");
        return;
      }
      timer = window.setTimeout(tick, 30_000);
    };

    timer = window.setTimeout(tick, 5_000);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [step, projectId, onLogoFinalized]);

  const addColor = () => {
    const v = colorInput.trim();
    if (!HEX_RE.test(v)) {
      toast({ title: "Use hex like #00C7FF", variant: "destructive" });
      return;
    }
    if (brandColors.includes(v)) return;
    if (brandColors.length >= 3) {
      toast({ title: "Up to 3 brand colors" });
      return;
    }
    setBrandColors([...brandColors, v]);
    setColorInput("");
  };

  const toggleKeyword = (k: string) => {
    if (keywords.includes(k)) {
      setKeywords(keywords.filter((x) => x !== k));
    } else if (keywords.length < 5) {
      setKeywords([...keywords, k]);
    }
  };

  const handleGenerate = async () => {
    if (formInvalid) {
      toast({ title: formInvalid, variant: "destructive" });
      return;
    }
    setStep("generating");
    setErrorMessage(null);

    try {
      const { data, error } = await supabase.functions.invoke<{
        projectId: string;
        concepts: Array<{ conceptNumber: number; imageUrl: string }>;
        partialFailure?: boolean;
        error?: string;
        upgradeUrl?: string;
      }>("logopro-generate-concepts", {
        body: {
          companyName: companyName.trim(),
          industry: industry.trim() || undefined,
          mascotDescription: mascotDescription.trim() || undefined,
          brandColors: brandColors.length ? brandColors : undefined,
          keywords: keywords.length ? keywords : undefined,
          phone: phone.trim() || undefined,
          website: website.trim() || undefined,
          sourceDesignProProjectId: returnToDesignProProjectId,
        },
      });
      if (error) throw error;
      if (!data) throw new Error("Empty response");
      if (data.error) throw new Error(data.error);

      setProjectId(data.projectId);

      // Pull concept IDs from DB so request-qc has them
      const { data: dbConcepts } = await supabase
        .from("logopro_concepts")
        .select("id, concept_number, image_url")
        .eq("project_id", data.projectId)
        .order("concept_number");

      const conceptList: Concept[] = (dbConcepts || []).map((c: any) => ({
        conceptNumber: c.concept_number,
        imageUrl: c.image_url,
        conceptId: c.id,
      }));
      setConcepts(conceptList);

      if (conceptList.length === 0) throw new Error("No concepts were generated");
      setStep("concepts");
      if (data.partialFailure) {
        toast({
          title: "Some concepts failed",
          description: `Showing ${conceptList.length} of 4. You can still continue or regenerate.`,
        });
      }
    } catch (err: any) {
      console.error("[LogoProCore] generate error", err);
      setErrorMessage(err?.message || "Concept generation failed");
      setStep("failed");
    }
  };

  const handleSelectConcept = (c: Concept) => setSelectedConcept(c);

  const handleSubmitForQC = async () => {
    if (!projectId || !selectedConcept?.conceptId) return;
    setErrorMessage(null);

    try {
      const { data, error } = await supabase.functions.invoke<{
        success: boolean;
        ticketId: string;
        status: string;
        estimatedReviewTime: string;
        error?: string;
      }>("logopro-request-qc", {
        body: {
          projectId,
          selectedConceptId: selectedConcept.conceptId,
          customerFeedback: feedback.trim() || undefined,
          priority: "normal",
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "QC submission failed");
      setTicketId(data.ticketId);
      setStep("qc_pending");
      toast({
        title: "Sent to our design team",
        description: data.estimatedReviewTime
          ? `Estimated turnaround: ${data.estimatedReviewTime}`
          : undefined,
      });
    } catch (err: any) {
      console.error("[LogoProCore] qc error", err);
      setErrorMessage(err?.message || "QC submission failed");
      toast({ title: "Something went wrong", description: err?.message, variant: "destructive" });
    }
  };

  const reset = () => {
    setStep("form");
    setProjectId(null);
    setConcepts([]);
    setSelectedConcept(null);
    setFeedback("");
    setTicketId(null);
    setFinalUrls(null);
    setErrorMessage(null);
  };

  // -------------------------------------------------------------------------
  // RENDER
  // -------------------------------------------------------------------------
  return (
    <div className="w-full">
      {step === "form" && (
        <Card className="p-6 md:p-8 space-y-6 bg-card/60 border-border">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Stamp className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Tell us about your brand</h2>
              <p className="text-sm text-muted-foreground">
                We'll use this to generate four logo concepts. Pick your favorite, our design team
                finishes it.
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="logopro-company">Company name *</Label>
              <Input
                id="logopro-company"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Acme Auto"
                maxLength={100}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="logopro-industry">Industry</Label>
              <Input
                id="logopro-industry"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="Wrap shop, plumber, mobile detailing, etc."
                maxLength={100}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="logopro-mascot">Mascot or icon idea</Label>
            <Textarea
              id="logopro-mascot"
              value={mascotDescription}
              onChange={(e) => setMascotDescription(e.target.value)}
              placeholder="A bear holding a wrench, an angular shield, a stylized lightning bolt..."
              maxLength={500}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              Optional. Leave blank for a wordmark-led design.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Brand colors</Label>
            <div className="flex gap-2">
              <Input
                value={colorInput}
                onChange={(e) => setColorInput(e.target.value)}
                placeholder="#00C7FF"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addColor();
                  }
                }}
                maxLength={7}
              />
              <Button type="button" variant="secondary" onClick={addColor}>
                Add
              </Button>
            </div>
            {brandColors.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {brandColors.map((c) => (
                  <button
                    type="button"
                    key={c}
                    onClick={() => setBrandColors(brandColors.filter((x) => x !== c))}
                    className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                  >
                    <span
                      className="h-4 w-4 rounded-sm border border-border"
                      style={{ backgroundColor: c }}
                    />
                    <span className="font-mono">{c}</span>
                    <span className="text-muted-foreground">×</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Brand personality</Label>
            <div className="flex flex-wrap gap-2">
              {KEYWORD_SUGGESTIONS.map((k) => {
                const active = keywords.includes(k);
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => toggleKeyword(k)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition-colors",
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {k}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">Pick up to 5.</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="logopro-phone">Phone</Label>
              <Input
                id="logopro-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(555) 123-4567"
                maxLength={50}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="logopro-website">Website</Label>
              <Input
                id="logopro-website"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="acmeauto.com"
                maxLength={120}
              />
            </div>
          </div>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button onClick={handleGenerate} disabled={!!formInvalid} size="lg">
              <Sparkles className="mr-2 h-4 w-4" />
              Generate 4 concepts
            </Button>
          </div>
        </Card>
      )}

      {step === "generating" && (
        <Card className="p-8 space-y-6">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <div>
              <h2 className="text-lg font-bold">Generating your concepts...</h2>
              <p className="text-sm text-muted-foreground">
                Our AI is sketching four directions. Usually under 60 seconds.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="aspect-square w-full" />
            ))}
          </div>
        </Card>
      )}

      {step === "concepts" && (
        <Card className="p-6 md:p-8 space-y-6">
          <div>
            <h2 className="text-xl font-bold">Pick your favorite</h2>
            <p className="text-sm text-muted-foreground">
              Our design team will refine the concept you choose into print-ready files.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {concepts.map((c) => {
              const isSelected = selectedConcept?.conceptNumber === c.conceptNumber;
              return (
                <button
                  key={c.conceptNumber}
                  type="button"
                  onClick={() => handleSelectConcept(c)}
                  className={cn(
                    "group relative aspect-square overflow-hidden rounded-lg border-2 transition-all",
                    isSelected
                      ? "border-primary ring-2 ring-primary/40"
                      : "border-border hover:border-primary/40",
                  )}
                >
                  <img
                    src={c.imageUrl}
                    alt={`Concept ${c.conceptNumber}`}
                    className="h-full w-full object-contain bg-white"
                  />
                  <Badge
                    variant="secondary"
                    className="absolute left-2 top-2 bg-black/70 text-white"
                  >
                    Concept {c.conceptNumber}
                  </Badge>
                  {isSelected && (
                    <div className="absolute right-2 top-2 rounded-full bg-primary p-1 text-primary-foreground">
                      <Check className="h-4 w-4" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div className="space-y-2">
            <Label htmlFor="logopro-feedback">Notes for our designer (optional)</Label>
            <Textarea
              id="logopro-feedback"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Make the icon a bit bolder, swap the text to all caps, etc."
              rows={3}
              maxLength={2000}
            />
          </div>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
            <Button variant="ghost" onClick={reset}>
              Start over
            </Button>
            <Button onClick={handleSubmitForQC} disabled={!selectedConcept} size="lg">
              Send to design team
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </Card>
      )}

      {step === "qc_pending" && (
        <Card className="p-8 space-y-4">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <h2 className="text-lg font-bold">In the design queue</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Our design team has been notified. You'll receive an email once your final logo is
            ready (typically 1-2 business days). You can safely close this page — we'll keep
            polling in the background while it's open.
          </p>
          {selectedConcept && (
            <div className="flex items-center gap-3 rounded-md border border-border p-3">
              <img
                src={selectedConcept.imageUrl}
                alt="Selected concept"
                className="h-16 w-16 rounded bg-white object-contain"
              />
              <div className="text-sm">
                <div className="font-medium">Concept {selectedConcept.conceptNumber} selected</div>
                <div className="text-muted-foreground">Status: pending designer review</div>
              </div>
            </div>
          )}
        </Card>
      )}

      {step === "finalized" && finalUrls && (
        <Card className="p-6 md:p-8 space-y-6 border-primary/40">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-primary/10 p-2">
              <Check className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Your logo is ready</h2>
              <p className="text-sm text-muted-foreground">
                Saved to your shop's brand kit. Available wherever you wrap.
              </p>
            </div>
          </div>

          <div className="rounded-lg bg-white p-6 flex justify-center">
            <img
              src={finalUrls.png}
              alt="Final logo"
              className="max-h-64 max-w-full object-contain"
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <Button asChild variant="outline">
              <a href={finalUrls.png} download>
                <Download className="mr-2 h-4 w-4" />
                PNG
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={finalUrls.svg} download>
                <Download className="mr-2 h-4 w-4" />
                SVG
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={finalUrls.eps} download>
                <Download className="mr-2 h-4 w-4" />
                EPS
              </a>
            </Button>
          </div>

          {mode === "embedded" ? (
            <div className="rounded-md bg-primary/10 p-4 text-sm">
              This logo will be applied to your DesignPro project automatically when you close
              this window.
            </div>
          ) : (
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
              <Button variant="ghost" onClick={reset}>
                Create another
              </Button>
              <Button asChild>
                <a href="/designpro">
                  Wrap your fleet with DesignPro
                  <ArrowRight className="ml-2 h-4 w-4" />
                </a>
              </Button>
            </div>
          )}
        </Card>
      )}

      {step === "failed" && (
        <Card className="p-8 space-y-4 border-destructive/40">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <h2 className="text-lg font-bold">Something went wrong</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            {errorMessage || "We couldn't complete this step. Please try again."}
          </p>
          <Button onClick={reset}>Try again</Button>
        </Card>
      )}
    </div>
  );
};

export default LogoProCore;
