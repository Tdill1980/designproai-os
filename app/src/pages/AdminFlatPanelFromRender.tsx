import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Zap, Play, Loader2, CheckCircle2, XCircle, Image as ImageIcon,
  Plus, Trash2, Download, ArrowLeft, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";

interface RenderInput {
  id: string;
  url: string;
  sideName: string;
  status: "pending" | "running" | "done" | "failed";
  resultUrl: string | null;
  error: string | null;
}

const SIDE_OPTIONS = [
  { value: "driver_side", label: "Driver Side" },
  { value: "passenger_side", label: "Passenger Side" },
  { value: "hood", label: "Hood" },
  { value: "rear", label: "Rear" },
  { value: "roof", label: "Roof" },
  { value: "front_quarter", label: "Front Quarter" },
  { value: "rear_quarter", label: "Rear Quarter" },
  { value: "front_bumper", label: "Front Bumper" },
  { value: "rear_bumper", label: "Rear Bumper" },
];

const FINISHES = ["Gloss", "Satin", "Matte"] as const;

const downloadImage = async (url: string, name: string) => {
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch {
    toast.error("Download failed");
  }
};

export default function AdminFlatPanelFromRender() {
  const [renders, setRenders] = useState<RenderInput[]>([
    { id: crypto.randomUUID(), url: "", sideName: "driver_side", status: "pending", resultUrl: null, error: null },
  ]);
  const [prompt, setPrompt] = useState("");
  const [finish, setFinish] = useState<typeof FINISHES[number]>("Gloss");
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<"single" | "batch">("single");
  const abortRef = useRef(false);
  const [reviseNotes, setReviseNotes] = useState<Record<string, string>>({});
  const [revisingId, setRevisingId] = useState<string | null>(null);

  const addRender = () => {
    const usedSides = new Set(renders.map(r => r.sideName));
    const nextSide = SIDE_OPTIONS.find(s => !usedSides.has(s.value))?.value || "driver_side";
    setRenders(prev => [...prev, {
      id: crypto.randomUUID(),
      url: "",
      sideName: nextSide,
      status: "pending",
      resultUrl: null,
      error: null,
    }]);
  };

  const removeRender = (id: string) => {
    if (renders.length <= 1) return;
    setRenders(prev => prev.filter(r => r.id !== id));
  };

  const updateRender = (id: string, field: Partial<RenderInput>) => {
    setRenders(prev => prev.map(r => r.id === id ? { ...r, ...field } : r));
  };

  const runGeneration = async () => {
    const validRenders = renders.filter(r => r.url.trim());
    if (validRenders.length === 0) {
      toast.error("Add at least one render URL");
      return;
    }

    setRunning(true);
    abortRef.current = false;

    // Reset statuses
    setRenders(prev => prev.map(r => ({
      ...r,
      status: r.url.trim() ? "pending" : "pending",
      resultUrl: null,
      error: null,
    })));

    if (mode === "batch") {
      // Send all at once
      setRenders(prev => prev.map(r => r.url.trim() ? { ...r, status: "running" } : r));

      try {
        const { data, error } = await supabase.functions.invoke("generate-flat-panel-from-render", {
          body: {
            renders: validRenders.map(r => ({ url: r.url.trim(), sideName: r.sideName })),
            prompt,
            finish,
          },
        });

        if (error) throw error;

        if (data?.results) {
          setRenders(prev => prev.map(r => {
            const result = data.results.find((res: any) => res.sideName === r.sideName);
            if (!result) return r;
            return {
              ...r,
              status: result.success ? "done" : "failed",
              resultUrl: result.panelUrl,
              error: result.error || null,
            };
          }));
          toast.success(`${data.totalSuccess} panel${data.totalSuccess !== 1 ? "s" : ""} generated`);
        }
      } catch (err: any) {
        toast.error(err.message || "Generation failed");
        setRenders(prev => prev.map(r => r.status === "running" ? { ...r, status: "failed", error: err.message } : r));
      }
    } else {
      // Single mode — process one at a time
      for (const render of validRenders) {
        if (abortRef.current) break;

        setRenders(prev => prev.map(r => r.id === render.id ? { ...r, status: "running" } : r));

        try {
          const { data, error } = await supabase.functions.invoke("generate-flat-panel-from-render", {
            body: {
              renderUrl: render.url.trim(),
              sideName: render.sideName,
              prompt,
              finish,
            },
          });

          if (error) throw error;

          const result = data?.results?.[0];
          setRenders(prev => prev.map(r => r.id === render.id ? {
            ...r,
            status: result?.success ? "done" : "failed",
            resultUrl: result?.panelUrl || null,
            error: result?.error || null,
          } : r));
        } catch (err: any) {
          setRenders(prev => prev.map(r => r.id === render.id ? {
            ...r,
            status: "failed",
            error: err.message || "Failed",
          } : r));
        }
      }
    }

    setRunning(false);
  };

  const reviseRender = async (id: string) => {
    const render = renders.find(r => r.id === id);
    const note = reviseNotes[id]?.trim();
    if (!render || !render.url.trim() || !note) {
      toast.error("Enter revision notes first");
      return;
    }

    setRevisingId(id);
    setRenders(prev => prev.map(r => r.id === id ? { ...r, status: "running" as const, error: null } : r));

    const revisionPrompt = `${prompt}\n\nREVISION: The previous flat panel output needs these fixes: ${note}\nKeep everything else the same — only fix what was called out.`;

    try {
      const { data, error } = await supabase.functions.invoke("generate-flat-panel-from-render", {
        body: {
          renderUrl: render.url.trim(),
          sideName: render.sideName,
          prompt: revisionPrompt,
          finish,
        },
      });

      if (error) throw error;

      const result = data?.results?.[0];
      setRenders(prev => prev.map(r => r.id === id ? {
        ...r,
        status: result?.success ? "done" : "failed",
        resultUrl: result?.panelUrl || null,
        error: result?.error || null,
      } : r));

      if (result?.success) {
        setReviseNotes(prev => ({ ...prev, [id]: "" }));
        toast.success(`${render.sideName.replace(/_/g, " ")} revised`);
      } else {
        toast.error(`Revision failed: ${result?.error}`);
      }
    } catch (err: any) {
      setRenders(prev => prev.map(r => r.id === id ? { ...r, status: "failed", error: err.message } : r));
      toast.error(`Revision failed: ${err.message}`);
    } finally {
      setRevisingId(null);
    }
  };

  const doneCount = renders.filter(r => r.status === "done").length;
  const failedCount = renders.filter(r => r.status === "failed").length;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/admin" className="text-zinc-500 hover:text-white transition-colors">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
                <Zap className="h-6 w-6 text-cyan-400" />
                Flat Panel from 3D Render
              </h1>
              <p className="text-sm text-zinc-400 mt-0.5">
                Feed 3D renders in, get flat print-ready panels out. Same design, no drift.
              </p>
            </div>
          </div>
          <Badge variant="outline" className="text-cyan-400 border-cyan-500/30">
            {renders.filter(r => r.url.trim()).length} render{renders.filter(r => r.url.trim()).length !== 1 ? "s" : ""} queued
          </Badge>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column — Settings */}
          <div className="space-y-4">
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-zinc-400">Original Design Prompt</Label>
                  <Textarea
                    value={prompt}
                    onChange={e => setPrompt(e.target.value)}
                    placeholder="Paste the original prompt that created the 3D renders (helps Gemini understand design intent)"
                    rows={4}
                    className="bg-zinc-800 border-zinc-700 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-zinc-400">Finish</Label>
                  <Select value={finish} onValueChange={(v: any) => setFinish(v)}>
                    <SelectTrigger className="bg-zinc-800 border-zinc-700">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FINISHES.map(f => (
                        <SelectItem key={f} value={f}>{f}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-3 pt-2">
                  <Button
                    size="sm"
                    variant={mode === "single" ? "default" : "outline"}
                    onClick={() => setMode("single")}
                    className="text-xs"
                  >
                    One at a time
                  </Button>
                  <Button
                    size="sm"
                    variant={mode === "batch" ? "default" : "outline"}
                    onClick={() => setMode("batch")}
                    className="text-xs"
                  >
                    All at once
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Button
              onClick={runGeneration}
              disabled={running || renders.every(r => !r.url.trim())}
              className="w-full bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 gap-2 h-12 text-base font-bold"
            >
              {running ? (
                <><Loader2 className="h-5 w-5 animate-spin" /> Generating...</>
              ) : (
                <><Play className="h-5 w-5" /> Generate Flat Panels</>
              )}
            </Button>

            {(doneCount > 0 || failedCount > 0) && (
              <div className="flex gap-3 text-sm">
                {doneCount > 0 && (
                  <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                    <CheckCircle2 className="h-3 w-3 mr-1" /> {doneCount} done
                  </Badge>
                )}
                {failedCount > 0 && (
                  <Badge className="bg-red-500/10 text-red-400 border-red-500/20">
                    <XCircle className="h-3 w-3 mr-1" /> {failedCount} failed
                  </Badge>
                )}
              </div>
            )}
          </div>

          {/* Right column — Render inputs + results */}
          <div className="lg:col-span-2 space-y-3">
            {renders.map((render, idx) => (
              <Card key={render.id} className={cn(
                "bg-zinc-900 border-zinc-800 transition-all",
                render.status === "running" && "border-cyan-500/50 shadow-[0_0_20px_rgba(6,182,212,0.1)]",
                render.status === "done" && "border-emerald-500/30",
                render.status === "failed" && "border-red-500/30",
              )}>
                <CardContent className="pt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-zinc-500">#{idx + 1}</span>
                      <Select
                        value={render.sideName}
                        onValueChange={v => updateRender(render.id, { sideName: v })}
                      >
                        <SelectTrigger className="bg-zinc-800 border-zinc-700 w-44 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SIDE_OPTIONS.map(s => (
                            <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {render.status === "running" && <Loader2 className="h-4 w-4 text-cyan-400 animate-spin" />}
                      {render.status === "done" && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                      {render.status === "failed" && <XCircle className="h-4 w-4 text-red-400" />}
                    </div>
                    {renders.length > 1 && (
                      <Button variant="ghost" size="icon" onClick={() => removeRender(render.id)} className="h-7 w-7 text-zinc-600 hover:text-red-400">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-zinc-400">3D Render URL</Label>
                    <Input
                      value={render.url}
                      onChange={e => updateRender(render.id, { url: e.target.value })}
                      placeholder="https://...supabase.co/.../render.jpg"
                      className="bg-zinc-800 border-zinc-700 text-sm font-mono"
                    />
                  </div>

                  {/* Side-by-side: input render + output flat panel */}
                  <div className="grid grid-cols-2 gap-3">
                    {/* Input 3D render preview */}
                    {render.url.trim() ? (
                      <div className="space-y-1">
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">3D Render (input)</p>
                        <div className="rounded-lg overflow-hidden border border-zinc-700 bg-zinc-800 aspect-video">
                          <img
                            src={render.url}
                            alt="3D render"
                            className="w-full h-full object-cover"
                            onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">3D Render (input)</p>
                        <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-800/50 aspect-video flex items-center justify-center">
                          <ImageIcon className="h-8 w-8 text-zinc-700" />
                        </div>
                      </div>
                    )}

                    {/* Output flat panel */}
                    {render.resultUrl ? (
                      <div className="space-y-1">
                        <p className="text-[10px] text-emerald-400 uppercase tracking-wider font-bold">Flat Panel (output)</p>
                        <div className="rounded-lg overflow-hidden border border-emerald-500/30 bg-zinc-800 aspect-video relative group">
                          <img
                            src={render.resultUrl}
                            alt="Flat panel"
                            className="w-full h-full object-cover"
                          />
                          <button
                            onClick={() => downloadImage(render.resultUrl!, `flat-panel-${render.sideName}`)}
                            className="absolute bottom-2 right-2 bg-black/70 hover:bg-black/90 rounded-lg p-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Download className="h-4 w-4 text-white" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">Flat Panel (output)</p>
                        <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-800/50 aspect-video flex items-center justify-center">
                          {render.status === "running" ? (
                            <Loader2 className="h-8 w-8 text-cyan-400 animate-spin" />
                          ) : render.status === "failed" ? (
                            <div className="text-center px-3">
                              <XCircle className="h-6 w-6 text-red-400 mx-auto mb-1" />
                              <p className="text-[10px] text-red-400">{render.error || "Failed"}</p>
                            </div>
                          ) : (
                            <span className="text-xs text-zinc-600">Waiting...</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Revise input — appears after a panel is generated */}
                  {render.resultUrl && (
                    <div className="flex gap-1.5 mt-1">
                      <Input
                        value={reviseNotes[render.id] || ""}
                        onChange={(e) => setReviseNotes(prev => ({ ...prev, [render.id]: e.target.value }))}
                        placeholder="Revision notes... e.g. colors drifted, more contrast, add 4 inch bleed"
                        className="bg-zinc-800 border-zinc-700 text-xs h-8 flex-1"
                        disabled={revisingId === render.id}
                        onKeyDown={(e) => { if (e.key === "Enter") reviseRender(render.id); }}
                      />
                      <Button
                        variant="outline" size="sm"
                        className="h-8 px-3 text-xs text-purple-400 border-purple-500/30 hover:text-purple-300 hover:bg-purple-500/10 shrink-0"
                        onClick={() => reviseRender(render.id)}
                        disabled={!reviseNotes[render.id]?.trim() || revisingId === render.id}
                      >
                        {revisingId === render.id ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                        Revise
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}

            <Button
              variant="outline"
              onClick={addRender}
              className="w-full border-dashed border-zinc-700 text-zinc-500 hover:text-white gap-2"
            >
              <Plus className="h-4 w-4" /> Add Another Side
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
