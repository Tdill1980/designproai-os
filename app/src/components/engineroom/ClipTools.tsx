// ClipTools — cut a long-form into reels + grab statics at every social size.
//
// Opens on any finished render. Scrub the video, then:
//  • CLIP REEL — set in/out, pick an aspect (9:16 / 1:1 / 4:5 / 16:9), and it
//    renders a trimmed, cropped video clip through video-render.
//  • GRAB STATIC — screenshot the current frame at any social size
//    (frame_grab blueprint), optional headline burned in.
// Both land in Renders like any other job.
import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

type Aspect = "9:16" | "1:1" | "4:5" | "16:9";
const ASPECTS: { key: Aspect; label: string }[] = [
  { key: "9:16", label: "9:16 Reel/Story" },
  { key: "1:1", label: "1:1 Square" },
  { key: "4:5", label: "4:5 Portrait" },
  { key: "16:9", label: "16:9 Landscape" },
];

export default function ClipTools({
  job, onClose, onQueued,
}: {
  job: { id: string; brand?: string; final_url?: string | null; blueprint?: any };
  onClose: () => void;
  onQueued: () => void;
}) {
  const url = job.final_url || "";
  const vref = useRef<HTMLVideoElement | null>(null);
  const [t, setT] = useState(0);
  const [clipIn, setClipIn] = useState(0);
  const [clipOut, setClipOut] = useState(15);
  const [aspect, setAspect] = useState<Aspect>("9:16");
  const [headline, setHeadline] = useState("");
  const brand = job.brand || job.blueprint?.brand || "wraptvworld";

  const now = () => Number(vref.current?.currentTime || 0);
  const sync = () => setT(now());

  const clipReel = useMutation({
    mutationFn: async () => {
      const start = Math.min(clipIn, clipOut), end = Math.max(clipIn, clipOut);
      if (end - start < 1) throw new Error("Clip must be at least 1 second");
      const blueprint = {
        id: `clip_${job.id}_${Date.now().toString(36)}`,
        platform: aspect === "16:9" ? "youtube" : "instagram",
        format: aspect === "16:9" ? "youtube" : "reel", aspectRatio: aspect,
        source: "clip_reel", brand, title: `${job.blueprint?.title || "Clip"} — ${aspect}`,
        keepNativeAudio: true,
        scenes: [{ sceneId: "c0", clipUrl: url, start, end, purpose: "hook", ...(headline ? { text: headline, textPosition: "top" } : {}) }],
        totalDuration: end - start,
      };
      const { data, error } = await supabase.functions.invoke("video-render", {
        body: { blueprint, brand, source_ref: "clip_reel" },
      });
      if (error) throw new Error(error.message);
      if (data?.ok === false) throw new Error(data?.error || "clip failed");
    },
    onSuccess: () => { toast.success(`${aspect} reel queued — watch it in Renders.`); onQueued(); },
    onError: (e: any) => toast.error(e?.message || "Clip failed"),
  });

  const grabStatic = useMutation({
    mutationFn: async (a: Aspect) => {
      const blueprint = {
        id: `grab_${job.id}_${a.replace(":", "x")}_${Date.now().toString(36)}`,
        kind: "frame_grab", aspectRatio: a, platform: "instagram", format: "static",
        source: "grab_static", brand, title: `Still ${a}`,
        ...(headline ? { headline, stylePack: "wpw_dark_clean" } : {}),
        scenes: [{ sceneId: "g0", clipUrl: url, start: now() }],
      };
      const { data, error } = await supabase.functions.invoke("video-render", {
        body: { blueprint, brand, source_ref: "grab_static" },
      });
      if (error) throw new Error(error.message);
      if (data?.ok === false) throw new Error(data?.error || "grab failed");
    },
    onSuccess: (_d, a) => { toast.success(`${a} still grabbed — in Renders.`); onQueued(); },
    onError: (e: any) => toast.error(e?.message || "Grab failed"),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-2xl max-h-[90vh] overflow-y-auto bg-white p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-gray-900">🎞️ Clip &amp; Grab — reels + stills at every size</DialogTitle>
        </DialogHeader>

        {!url ? (
          <p className="text-sm text-gray-500">This render has no video yet.</p>
        ) : (
          <div className="space-y-4">
            <video ref={vref} src={url} controls playsInline preload="metadata" onTimeUpdate={sync}
              className="max-h-72 w-full rounded bg-black" />
            <div className="text-center text-xs text-gray-500">Current time: <span className="font-mono text-gray-900">{t.toFixed(1)}s</span> — scrub the video to the frame you want</div>

            <div>
              <Input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Optional overlay text (hook line)"
                className="bg-white text-gray-900 border-gray-300 placeholder:text-gray-400" />
            </div>

            {/* GRAB STATIC — every social size */}
            <div className="rounded-lg border border-gray-200 p-3">
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">📸 Grab static @ {t.toFixed(1)}s</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {ASPECTS.map((a) => (
                  <Button key={a.key} variant="outline" size="sm" disabled={grabStatic.isPending}
                    onClick={() => grabStatic.mutate(a.key)}>
                    {grabStatic.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : a.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* CLIP REEL */}
            <div className="rounded-lg border border-gray-200 p-3">
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">✂️ Clip a reel</div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs text-gray-500">
                  in (s)
                  <div className="flex items-center gap-1">
                    <Input type="number" step="0.5" value={clipIn} onChange={(e) => setClipIn(Number(e.target.value))} className="w-20 bg-white text-gray-900 border-gray-300" />
                    <Button size="sm" variant="ghost" className="px-2 text-xs" onClick={() => setClipIn(Number(now().toFixed(1)))}>set</Button>
                  </div>
                </label>
                <label className="text-xs text-gray-500">
                  out (s)
                  <div className="flex items-center gap-1">
                    <Input type="number" step="0.5" value={clipOut} onChange={(e) => setClipOut(Number(e.target.value))} className="w-20 bg-white text-gray-900 border-gray-300" />
                    <Button size="sm" variant="ghost" className="px-2 text-xs" onClick={() => setClipOut(Number(now().toFixed(1)))}>set</Button>
                  </div>
                </label>
                <select value={aspect} onChange={(e) => setAspect(e.target.value as Aspect)}
                  className="rounded-md border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900">
                  {ASPECTS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                </select>
                <Button onClick={() => clipReel.mutate()} disabled={clipReel.isPending}
                  className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white hover:opacity-90">
                  {clipReel.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Make clip"}
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-gray-400">Use the video's play head + "set" to mark in/out, or type seconds.</p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
