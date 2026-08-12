import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Video, Play, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "studio_showcase_videos";

interface VideoSlot {
  id: string;
  label: string;
  url: string;
}

function parseEmbedUrl(url: string): { type: "youtube" | "vimeo" | "direct"; embedUrl: string } | null {
  if (!url) return null;

  // YouTube
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]+)/);
  if (ytMatch) {
    return { type: "youtube", embedUrl: `https://www.youtube.com/embed/${ytMatch[1]}?rel=0&modestbranding=1` };
  }

  // Vimeo
  const vimeoMatch = url.match(/(?:vimeo\.com\/)(\d+)/);
  if (vimeoMatch) {
    return { type: "vimeo", embedUrl: `https://player.vimeo.com/video/${vimeoMatch[1]}` };
  }

  // Direct video file
  if (url.match(/\.(mp4|webm|ogg)(\?|$)/i)) {
    return { type: "direct", embedUrl: url };
  }

  return null;
}

export function ShowcaseVideoPlayer() {
  const [videos, setVideos] = useState<VideoSlot[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [newLabel, setNewLabel] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [activeVideo, setActiveVideo] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(videos));
  }, [videos]);

  const addVideo = () => {
    if (!newUrl.trim()) return;
    const parsed = parseEmbedUrl(newUrl.trim());
    if (!parsed) return;

    setVideos((prev) => [
      ...prev,
      { id: crypto.randomUUID(), label: newLabel.trim() || "Demo Video", url: newUrl.trim() },
    ]);
    setNewLabel("");
    setNewUrl("");
  };

  const removeVideo = (id: string) => {
    setVideos((prev) => prev.filter((v) => v.id !== id));
    if (activeVideo === id) setActiveVideo(null);
  };

  const activeSlot = videos.find((v) => v.id === activeVideo);
  const activeParsed = activeSlot ? parseEmbedUrl(activeSlot.url) : null;

  return (
    <div className="space-y-6">
      {/* Add video form */}
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs text-zinc-400 mb-1 block">Label</label>
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="e.g. ColorPro Demo"
            className="bg-zinc-900 border-zinc-700 text-white h-9"
          />
        </div>
        <div className="flex-[2] min-w-[300px]">
          <label className="text-xs text-zinc-400 mb-1 block">Video URL (YouTube, Vimeo, or direct .mp4)</label>
          <Input
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="https://youtube.com/watch?v=... or https://vimeo.com/..."
            className="bg-zinc-900 border-zinc-700 text-white h-9"
            onKeyDown={(e) => e.key === "Enter" && addVideo()}
          />
        </div>
        <Button onClick={addVideo} disabled={!newUrl.trim()} className="bg-cyan-600 hover:bg-cyan-700 h-9">
          <Plus className="w-4 h-4 mr-1" /> Add
        </Button>
      </div>

      {/* Video list */}
      {videos.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {videos.map((video) => {
            const parsed = parseEmbedUrl(video.url);
            const isActive = activeVideo === video.id;
            return (
              <div
                key={video.id}
                className={cn(
                  "rounded-lg border bg-zinc-900 p-4 cursor-pointer transition-all",
                  isActive
                    ? "border-cyan-500 ring-1 ring-cyan-500/50"
                    : "border-zinc-800 hover:border-zinc-600"
                )}
                onClick={() => setActiveVideo(video.id)}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Video className="w-4 h-4 text-zinc-400" />
                    <span className="text-sm font-medium text-white truncate">{video.label}</span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-zinc-500 hover:text-red-400 h-7 w-7 p-0"
                    onClick={(e) => { e.stopPropagation(); removeVideo(video.id); }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
                    {parsed?.type || "unknown"}
                  </span>
                  <Play className="w-3 h-3 text-cyan-400" />
                  <span className="text-xs text-zinc-500 truncate flex-1">{video.url}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Active video player */}
      {activeSlot && activeParsed && (
        <div className="rounded-xl overflow-hidden border border-zinc-800 bg-black">
          <div className="flex items-center justify-between px-4 py-2 bg-zinc-950 border-b border-zinc-800">
            <span className="text-sm font-medium text-white">{activeSlot.label}</span>
            <a
              href={activeSlot.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-zinc-400 hover:text-cyan-400 flex items-center gap-1"
            >
              Open original <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <div className="aspect-video">
            {activeParsed.type === "direct" ? (
              <video
                src={activeParsed.embedUrl}
                controls
                className="w-full h-full"
                autoPlay
              />
            ) : (
              <iframe
                src={activeParsed.embedUrl}
                className="w-full h-full"
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen
              />
            )}
          </div>
        </div>
      )}

      {videos.length === 0 && (
        <div className="text-center py-16 text-zinc-500">
          <Video className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>No demo videos added yet.</p>
          <p className="text-sm mt-1">Paste a YouTube, Vimeo, or direct video URL above.</p>
        </div>
      )}
    </div>
  );
}
