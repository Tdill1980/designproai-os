import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Play, Copy, GitBranch, Eye, ChevronLeft, ChevronRight,
  Search, Clock, Loader2, Video, Maximize2, Download,
  RotateCcw, Edit3, History, ArrowRight, Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

// ---------------------------------------------------------------------------
// Version tracking via design_file_name field
// Format: "Design Name" or "Design Name (V2)" or "Design Name (V3)"
// Parent tracking via admin_notes JSON: {"version":{"parent_id":"uuid","version":2}}
// ---------------------------------------------------------------------------

interface VersionInfo {
  version: number;
  parentId: string | null;
  isRevision: boolean;
}

function parseVersionInfo(render: any): VersionInfo {
  const name = render.design_file_name || render.color_name || "";
  const versionMatch = name.match(/\(V(\d+)\)$/);
  const version = versionMatch ? parseInt(versionMatch[1]) : 1;

  let parentId: string | null = null;
  try {
    const notes = JSON.parse(render.admin_notes || "{}");
    parentId = notes?.version?.parent_id || null;
  } catch {}

  return { version, parentId, isRevision: version > 1 };
}

function getVersionLabel(render: any): string {
  const info = parseVersionInfo(render);
  return info.version > 1 ? `V${info.version}` : "V1";
}

const VIEW_ORDER = ["roof", "side", "passenger-side", "hood_detail", "front", "rear", "close-up"];
const VIEW_LABELS: Record<string, string> = {
  side: "Driver Side",
  "passenger-side": "Passenger Side",
  hood_detail: "Hood",
  front: "Front",
  rear: "Rear",
  "close-up": "Close-Up",
  roof: "Roof Plan",
  hero: "Hero",
};

export default function AdminStudioReplay() {
  const queryClient = useQueryClient();
  const [modeFilter, setModeFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRender, setSelectedRender] = useState<any | null>(null);
  const [currentViewIndex, setCurrentViewIndex] = useState(0);
  const [isStudioMode, setIsStudioMode] = useState(false);
  const [showReviseDialog, setShowReviseDialog] = useState(false);
  const [revisionNotes, setRevisionNotes] = useState("");
  const [showVersionHistory, setShowVersionHistory] = useState(false);

  // Fetch all completed renders
  const { data: renders, isLoading } = useQuery({
    queryKey: ["studio-replay-renders", modeFilter, searchQuery],
    queryFn: async () => {
      let query = supabase
        .from("color_visualizations")
        .select("*")
        .eq("generation_status", "completed")
        .order("created_at", { ascending: false })
        .limit(300);

      if (modeFilter !== "all") {
        query = query.eq("mode_type", modeFilter);
      }

      if (searchQuery) {
        query = query.or(
          `vehicle_make.ilike.%${searchQuery}%,vehicle_model.ilike.%${searchQuery}%,color_name.ilike.%${searchQuery}%,design_file_name.ilike.%${searchQuery}%`
        );
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch version chain for selected render
  const { data: versionChain } = useQuery({
    queryKey: ["version-chain", selectedRender?.id],
    queryFn: async () => {
      if (!selectedRender) return [];

      // Get the base design name (without version suffix)
      const baseName = (selectedRender.design_file_name || selectedRender.color_name || "")
        .replace(/\s*\(V\d+\)$/, "");

      const { data, error } = await supabase
        .from("color_visualizations")
        .select("*")
        .eq("vehicle_make", selectedRender.vehicle_make)
        .eq("vehicle_model", selectedRender.vehicle_model)
        .eq("generation_status", "completed")
        .or(`design_file_name.ilike.%${baseName}%,color_name.ilike.%${baseName}%`)
        .order("created_at", { ascending: true });

      if (error) return [selectedRender];
      return data || [selectedRender];
    },
    enabled: !!selectedRender,
  });

  // Clone & Revise mutation
  const cloneAndRevise = useMutation({
    mutationFn: async ({ sourceRender, notes }: { sourceRender: any; notes: string }) => {
      const currentVersion = parseVersionInfo(sourceRender);
      const newVersion = currentVersion.version + 1;
      const baseName = (sourceRender.design_file_name || sourceRender.color_name || "Design")
        .replace(/\s*\(V\d+\)$/, "");

      const versionMeta = JSON.stringify({
        version: {
          parent_id: sourceRender.id,
          version: newVersion,
          revision_notes: notes,
          cloned_at: new Date().toISOString(),
        },
        ...(sourceRender.admin_notes ? (() => { try { return JSON.parse(sourceRender.admin_notes); } catch { return {}; } })() : {}),
      });

      const { data, error } = await supabase
        .from("color_visualizations")
        .insert({
          customer_email: sourceRender.customer_email,
          vehicle_year: sourceRender.vehicle_year,
          vehicle_make: sourceRender.vehicle_make,
          vehicle_model: sourceRender.vehicle_model,
          vehicle_type: sourceRender.vehicle_type,
          color_hex: sourceRender.color_hex,
          color_name: sourceRender.color_name,
          finish_type: sourceRender.finish_type,
          mode_type: sourceRender.mode_type,
          render_urls: sourceRender.render_urls,
          custom_design_url: sourceRender.custom_design_url,
          custom_swatch_url: sourceRender.custom_swatch_url,
          uses_custom_design: sourceRender.uses_custom_design,
          design_file_name: `${baseName} (V${newVersion})`,
          generation_status: "completed",
          subscription_tier: sourceRender.subscription_tier,
          organization_id: sourceRender.organization_id,
          admin_notes: versionMeta,
        } as any)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (newRender) => {
      queryClient.invalidateQueries({ queryKey: ["studio-replay-renders"] });
      queryClient.invalidateQueries({ queryKey: ["version-chain"] });
      toast.success(`V${parseVersionInfo(newRender).version} created - original preserved`);
      setSelectedRender(newRender);
      setShowReviseDialog(false);
      setRevisionNotes("");
    },
    onError: (err: any) => {
      toast.error(`Clone failed: ${err.message}`);
    },
  });

  // Get sorted views
  const getViews = (render: any): Array<{ key: string; url: string }> => {
    const urls = render.render_urls as Record<string, string> | null;
    if (!urls) return [];
    return VIEW_ORDER
      .filter((k) => urls[k])
      .map((k) => ({ key: k, url: urls[k] }));
  };

  const selectedViews = selectedRender ? getViews(selectedRender) : [];

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Studio Mode - Full Screen Presentation */}
      {isStudioMode && selectedRender && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          {/* Studio Header */}
          <div className="flex items-center justify-between px-6 py-3 bg-zinc-950 border-b border-zinc-800">
            <div className="flex items-center gap-4">
              <Button size="sm" variant="ghost" onClick={() => setIsStudioMode(false)}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Exit Studio
              </Button>
              <Badge variant="outline" className="border-blue-500 text-blue-400">
                <Video className="w-3 h-3 mr-1" /> STUDIO MODE
              </Badge>
            </div>

            <div className="text-center">
              <p className="font-bold text-lg">
                {selectedRender.vehicle_year} {selectedRender.vehicle_make} {selectedRender.vehicle_model}
              </p>
              <p className="text-sm text-zinc-400">
                {selectedRender.color_name} • {selectedRender.finish_type}
                {selectedRender.design_file_name ? ` • ${selectedRender.design_file_name}` : ""}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Badge className="bg-blue-600">{getVersionLabel(selectedRender)}</Badge>
              <Badge variant="outline" className="border-zinc-600">{selectedRender.mode_type}</Badge>
            </div>
          </div>

          {/* Main View - LARGE */}
          <div className="flex-1 flex items-center justify-center relative bg-black">
            {selectedViews[currentViewIndex] ? (
              <img
                src={selectedViews[currentViewIndex].url}
                alt={VIEW_LABELS[selectedViews[currentViewIndex].key]}
                className="max-w-full max-h-full object-contain"
              />
            ) : (
              <div className="text-zinc-600">No views</div>
            )}

            {/* View label */}
            <div className="absolute top-6 left-6 bg-black/80 px-4 py-2 rounded-lg">
              <p className="text-lg font-bold text-blue-400">
                {selectedViews[currentViewIndex] ? VIEW_LABELS[selectedViews[currentViewIndex].key] : ""}
              </p>
            </div>

            {/* Navigation arrows */}
            <Button
              size="lg"
              variant="ghost"
              className="absolute left-4 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/80 h-16 w-12"
              onClick={() => setCurrentViewIndex((i) => Math.max(0, i - 1))}
              disabled={currentViewIndex === 0}
            >
              <ChevronLeft className="w-8 h-8" />
            </Button>
            <Button
              size="lg"
              variant="ghost"
              className="absolute right-4 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/80 h-16 w-12"
              onClick={() => setCurrentViewIndex((i) => Math.min(selectedViews.length - 1, i + 1))}
              disabled={currentViewIndex === selectedViews.length - 1}
            >
              <ChevronRight className="w-8 h-8" />
            </Button>
          </div>

          {/* Studio Info Bar */}
          <div className="bg-zinc-950 border-t border-zinc-800">
            {/* Original Upload / VisionBoard */}
            {selectedRender.custom_design_url && (
              <div className="flex items-center gap-4 px-6 py-2 border-b border-zinc-800">
                <span className="text-xs text-zinc-500 uppercase font-bold">VisionBoard Upload:</span>
                <img src={selectedRender.custom_design_url} alt="Original" className="h-12 rounded border border-zinc-700" />
                <span className="text-xs text-zinc-400">Original customer proof / design reference</span>
              </div>
            )}

            {/* View Thumbnails */}
            <div className="flex gap-3 px-6 py-3 overflow-x-auto">
              {selectedViews.map((v, i) => (
                <button
                  key={v.key}
                  onClick={() => setCurrentViewIndex(i)}
                  className={`flex-shrink-0 relative rounded-lg overflow-hidden border-2 transition-all ${
                    i === currentViewIndex ? "border-blue-500 scale-105" : "border-zinc-700 hover:border-zinc-500"
                  }`}
                >
                  <img src={v.url} alt={VIEW_LABELS[v.key]} className="w-32 h-20 object-cover" />
                  <span className="absolute bottom-0 left-0 right-0 bg-black/80 text-[10px] text-center py-0.5">
                    {VIEW_LABELS[v.key]}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Normal Page Layout */}
      <div className="p-6 max-w-[1800px] mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold">Studio Replay</h1>
            <p className="text-zinc-400 mt-1">
              Load past renders in studio view for video recording, client review, and revisions
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-4 mb-6">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <Input
              placeholder="Search vehicle, color, design name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-zinc-900 border-zinc-700"
            />
          </div>

          <Select value={modeFilter} onValueChange={setModeFilter}>
            <SelectTrigger className="w-48 bg-zinc-900 border-zinc-700">
              <SelectValue placeholder="Tool" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Tools</SelectItem>
              <SelectItem value="colorpro">ColorPro</SelectItem>
              <SelectItem value="designpanelpro">DesignProAI™</SelectItem>
              <SelectItem value="fadewraps">FadeWraps</SelectItem>
              <SelectItem value="approvemode">ApprovePro</SelectItem>
              <SelectItem value="wbty">WBTY</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Render Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {renders?.map((render) => {
              const views = getViews(render);
              const heroUrl = views.find((v) => v.key === "roof")?.url || views[0]?.url;
              const versionLabel = getVersionLabel(render);

              return (
                <Card
                  key={render.id}
                  className="bg-zinc-900 border-zinc-800 overflow-hidden hover:border-blue-600 transition-colors cursor-pointer"
                  onClick={() => {
                    setSelectedRender(render);
                    setCurrentViewIndex(0);
                  }}
                >
                  <div className="relative aspect-video bg-zinc-800">
                    {heroUrl ? (
                      <img src={heroUrl} alt="Hero" className="w-full h-full object-cover" />
                    ) : (
                      <div className="flex items-center justify-center h-full text-zinc-600">No render</div>
                    )}

                    {/* Version badge */}
                    <Badge className={`absolute top-2 right-2 ${versionLabel !== "V1" ? "bg-purple-600" : "bg-zinc-700"}`}>
                      {versionLabel}
                    </Badge>

                    {/* Custom design indicator */}
                    {render.custom_design_url && (
                      <div className="absolute top-2 left-2 bg-blue-600/80 p-1 rounded">
                        <Sparkles className="w-3 h-3" />
                      </div>
                    )}
                  </div>

                  <CardContent className="p-3">
                    <p className="font-semibold text-sm truncate">
                      {render.vehicle_year} {render.vehicle_make} {render.vehicle_model}
                    </p>
                    <p className="text-xs text-zinc-400 truncate">
                      {render.design_file_name || render.color_name} • {render.finish_type}
                    </p>
                    <div className="flex items-center justify-between mt-2">
                      <Badge variant="outline" className="text-[10px]">{render.mode_type}</Badge>
                      <span className="text-[10px] text-zinc-500">
                        {render.created_at ? formatDistanceToNow(new Date(render.created_at), { addSuffix: true }) : ""}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Selected Render Panel (bottom dock) */}
      {selectedRender && !isStudioMode && (
        <div className="fixed bottom-0 left-0 right-0 bg-zinc-950 border-t border-zinc-800 shadow-2xl z-40">
          <div className="max-w-[1800px] mx-auto p-4">
            <div className="flex gap-6">
              {/* Thumbnail strip */}
              <div className="flex gap-2 overflow-x-auto flex-shrink-0">
                {selectedViews.map((v, i) => (
                  <button
                    key={v.key}
                    onClick={() => setCurrentViewIndex(i)}
                    className={`flex-shrink-0 rounded overflow-hidden border-2 transition-colors ${
                      i === currentViewIndex ? "border-blue-500" : "border-zinc-700"
                    }`}
                  >
                    <img src={v.url} alt={VIEW_LABELS[v.key]} className="w-20 h-14 object-cover" />
                  </button>
                ))}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-bold truncate">
                    {selectedRender.vehicle_year} {selectedRender.vehicle_make} {selectedRender.vehicle_model}
                  </p>
                  <Badge className="bg-blue-600 flex-shrink-0">{getVersionLabel(selectedRender)}</Badge>
                </div>
                <p className="text-xs text-zinc-400 truncate">
                  {selectedRender.design_file_name || selectedRender.color_name} • {selectedRender.finish_type} • {selectedRender.mode_type}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2 flex-shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowVersionHistory(true)}
                >
                  <History className="w-4 h-4 mr-1" /> Versions
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="border-purple-500 text-purple-400 hover:bg-purple-900/30"
                  onClick={() => setShowReviseDialog(true)}
                >
                  <GitBranch className="w-4 h-4 mr-1" /> Clone & Revise
                </Button>

                <Button
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700"
                  onClick={() => setIsStudioMode(true)}
                >
                  <Play className="w-4 h-4 mr-1" /> Studio Mode
                </Button>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedRender(null)}
                >
                  Close
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Clone & Revise Dialog */}
      <Dialog open={showReviseDialog} onOpenChange={setShowReviseDialog}>
        <DialogContent className="bg-zinc-900 border-zinc-700 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitBranch className="w-5 h-5 text-purple-400" />
              Clone & Revise as {selectedRender ? `V${parseVersionInfo(selectedRender).version + 1}` : ""}
            </DialogTitle>
          </DialogHeader>

          {selectedRender && (
            <div className="space-y-4">
              <div className="p-3 bg-zinc-800 rounded-lg text-sm">
                <p className="text-zinc-400 mb-1">Cloning from:</p>
                <p className="font-semibold">
                  {selectedRender.vehicle_year} {selectedRender.vehicle_make} {selectedRender.vehicle_model}
                </p>
                <p className="text-zinc-400">
                  {selectedRender.design_file_name || selectedRender.color_name} ({getVersionLabel(selectedRender)})
                </p>
              </div>

              <div className="p-3 bg-purple-900/20 border border-purple-800 rounded-lg text-sm">
                <p className="text-purple-300 font-semibold mb-1">What happens:</p>
                <ul className="text-purple-200/70 space-y-1 text-xs">
                  <li>- Original {getVersionLabel(selectedRender)} is preserved untouched</li>
                  <li>- New V{parseVersionInfo(selectedRender).version + 1} copy created with all render views</li>
                  <li>- Version history links both together</li>
                  <li>- You can then re-render specific views on the new version</li>
                </ul>
              </div>

              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Revision Notes</label>
                <Textarea
                  value={revisionNotes}
                  onChange={(e) => setRevisionNotes(e.target.value)}
                  placeholder="What's changing in this revision? (e.g., 'Customer wants blue instead of red', 'Adjust fade position')"
                  className="bg-zinc-800 border-zinc-700 h-24"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowReviseDialog(false)}>Cancel</Button>
            <Button
              className="bg-purple-600 hover:bg-purple-700"
              onClick={() => {
                if (selectedRender) {
                  cloneAndRevise.mutate({ sourceRender: selectedRender, notes: revisionNotes });
                }
              }}
              disabled={cloneAndRevise.isPending}
            >
              {cloneAndRevise.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Cloning...</>
              ) : (
                <><Copy className="w-4 h-4 mr-2" /> Clone as V{selectedRender ? parseVersionInfo(selectedRender).version + 1 : ""}</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Version History Dialog */}
      <Dialog open={showVersionHistory} onOpenChange={setShowVersionHistory}>
        <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="w-5 h-5 text-blue-400" /> Version History
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            {versionChain?.map((version, i) => {
              const views = getViews(version);
              const heroUrl = views.find((v) => v.key === "roof")?.url || views[0]?.url;
              const vInfo = parseVersionInfo(version);
              const isSelected = version.id === selectedRender?.id;

              let revNotes = "";
              try {
                const notes = JSON.parse(version.admin_notes || "{}");
                revNotes = notes?.version?.revision_notes || "";
              } catch {}

              return (
                <div
                  key={version.id}
                  className={`flex gap-4 p-3 rounded-lg cursor-pointer transition-colors ${
                    isSelected ? "bg-blue-900/30 border border-blue-700" : "bg-zinc-800 hover:bg-zinc-750 border border-transparent"
                  }`}
                  onClick={() => {
                    setSelectedRender(version);
                    setCurrentViewIndex(0);
                  }}
                >
                  {/* Timeline dot */}
                  <div className="flex flex-col items-center gap-1 flex-shrink-0">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                      isSelected ? "bg-blue-600" : "bg-zinc-700"
                    }`}>
                      V{vInfo.version}
                    </div>
                    {i < (versionChain?.length || 0) - 1 && (
                      <div className="w-0.5 h-8 bg-zinc-700" />
                    )}
                  </div>

                  {/* Thumbnail */}
                  {heroUrl && (
                    <img src={heroUrl} alt="" className="w-24 h-16 object-cover rounded flex-shrink-0" />
                  )}

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">
                      {version.design_file_name || version.color_name}
                    </p>
                    <p className="text-xs text-zinc-400">
                      {version.created_at ? new Date(version.created_at).toLocaleString() : ""}
                    </p>
                    {revNotes && (
                      <p className="text-xs text-purple-300 mt-1">
                        <Edit3 className="w-3 h-3 inline mr-1" /> {revNotes}
                      </p>
                    )}
                  </div>

                  {isSelected && (
                    <Badge className="bg-blue-600 flex-shrink-0 self-center">Current</Badge>
                  )}
                </div>
              );
            })}

            {(!versionChain || versionChain.length === 0) && (
              <p className="text-center text-zinc-500 py-6">No version history found</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
