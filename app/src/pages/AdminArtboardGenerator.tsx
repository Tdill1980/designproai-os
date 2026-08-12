import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

export default function AdminArtboardGenerator() {
  const { toast } = useToast();
  const [jobId, setJobId] = useState("");
  const [vehicleName, setVehicleName] = useState("");
  const [designPrompt, setDesignPrompt] = useState("");
  const [approvedRenderUrl, setApprovedRenderUrl] = useState("");
  const [artboardUrl, setArtboardUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingJob, setLoadingJob] = useState(false);

  const lookupJob = async () => {
    if (!jobId.trim()) return;
    setLoadingJob(true);
    try {
      const { data, error } = await supabase
        .from("panelizer_jobs" as any)
        .select("vehicle_year, vehicle_make, vehicle_model, approved_render_url, concept_json")
        .eq("id", jobId.trim())
        .single();

      if (error || !data) {
        toast({ title: "Job not found", description: error?.message || "No job with that ID", variant: "destructive" });
        return;
      }

      const name = [data.vehicle_year, data.vehicle_make, data.vehicle_model].filter(Boolean).join(" ");
      setVehicleName(name || "");
      setApprovedRenderUrl(data.approved_render_url || "");

      const concept = data.concept_json as Record<string, unknown> | null;
      if (concept && typeof concept === "object" && "design_prompt" in concept) {
        setDesignPrompt(String(concept.design_prompt));
      }

      toast({ title: "Job loaded", description: name });
    } catch (err: unknown) {
      toast({ title: "Error", description: String(err), variant: "destructive" });
    } finally {
      setLoadingJob(false);
    }
  };

  const generate = async () => {
    if (!vehicleName || !designPrompt || !approvedRenderUrl) {
      toast({ title: "Missing fields", description: "Fill in vehicle name, design prompt, and render URL", variant: "destructive" });
      return;
    }

    setLoading(true);
    setArtboardUrl(null);

    try {
      const { data, error } = await supabase.functions.invoke("generate-artboard-simple", {
        body: {
          job_id: jobId.trim() || crypto.randomUUID(),
          vehicle_name: vehicleName,
          design_prompt: designPrompt,
          approved_render_url: approvedRenderUrl,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setArtboardUrl(data.artboard_url);
      toast({ title: "Artboard generated", description: `Specs: ${data.specs_source}` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Generation failed", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-6 md:p-10 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-6">Artboard Generator</h1>

      {/* Job ID lookup */}
      <div className="flex gap-2 mb-6">
        <Input
          placeholder="Job ID (optional — auto-fills fields)"
          value={jobId}
          onChange={(e) => setJobId(e.target.value)}
          className="flex-1"
        />
        <Button onClick={lookupJob} disabled={loadingJob || !jobId.trim()} variant="secondary">
          {loadingJob ? "Loading..." : "Lookup"}
        </Button>
      </div>

      {/* Fields */}
      <div className="space-y-4 mb-6">
        <div>
          <label className="text-sm text-zinc-400 mb-1 block">Vehicle Name</label>
          <Input
            placeholder="2024 Ford F-150"
            value={vehicleName}
            onChange={(e) => setVehicleName(e.target.value)}
          />
        </div>
        <div>
          <label className="text-sm text-zinc-400 mb-1 block">Design Prompt</label>
          <Input
            placeholder="Matte black with neon green racing stripes"
            value={designPrompt}
            onChange={(e) => setDesignPrompt(e.target.value)}
          />
        </div>
        <div>
          <label className="text-sm text-zinc-400 mb-1 block">Approved Render URL</label>
          <Input
            placeholder="https://..."
            value={approvedRenderUrl}
            onChange={(e) => setApprovedRenderUrl(e.target.value)}
          />
        </div>
      </div>

      {/* Render thumbnail */}
      {approvedRenderUrl && (
        <div className="mb-6">
          <p className="text-sm text-zinc-400 mb-2">Approved Render</p>
          <img
            src={approvedRenderUrl}
            alt="Approved render"
            className="rounded-lg border border-zinc-700 max-h-64 object-contain"
          />
        </div>
      )}

      {/* Generate button */}
      <Button
        onClick={generate}
        disabled={loading || !vehicleName || !designPrompt || !approvedRenderUrl}
        className="w-full mb-8 h-12 text-lg bg-cyan-600 hover:bg-cyan-500"
      >
        {loading ? "Generating artboard..." : "Generate Artboard"}
      </Button>

      {/* Result */}
      {artboardUrl && (
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">Generated Artboard</p>
          <img
            src={artboardUrl}
            alt="Generated artboard"
            className="rounded-lg border border-zinc-700 w-full"
          />
          <div className="flex gap-3">
            <a href={artboardUrl} download="artboard.png" target="_blank" rel="noopener noreferrer">
              <Button variant="secondary">Download PNG</Button>
            </a>
            <Button onClick={generate} disabled={loading} variant="outline">
              {loading ? "Regenerating..." : "Regenerate"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
