/**
 * /admin/designpro-v2-test — isolated test bench for the DesignPro v2
 * Object-Tracking engine (src/modules/designpro-v2/).
 *
 * Hidden from customers: admin-gated route, linked from nowhere in the
 * customer UI. Existing DesignPro / RevisionStudio code paths are untouched —
 * this page only READS render records to build object graphs in memory.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, Boxes, Eye, EyeOff, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { ObjectGraphCanvas } from "@/modules/designpro-v2/ObjectGraphCanvas";
import { useObjectGraph } from "@/modules/designpro-v2/useObjectGraph";
import { availableViews, buildGraphFromRender } from "@/modules/designpro-v2/importFromRender";
import { getForegroundObjects, type DesignObject } from "@/modules/designpro-v2/objectGraph";

const GRID_COLUMNS =
  "id, color_name, design_file_name, vehicle_year, vehicle_make, vehicle_model, render_urls, admin_notes, created_at";

export default function AdminDesignProV2Test() {
  const [selectedRenderId, setSelectedRenderId] = useState<string | null>(null);
  const [selectedView, setSelectedView] = useState<string>("side");
  const [removeMode, setRemoveMode] = useState(true);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);

  const { data: renders = [], isLoading } = useQuery({
    queryKey: ["designpro-v2-test-renders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("color_visualizations")
        .select(GRID_COLUMNS)
        .in("generation_status", ["completed", "complete"])
        .not("render_urls", "is", null)
        .order("created_at", { ascending: false })
        .limit(24);
      if (error) throw error;
      return data || [];
    },
  });

  const selectedRender = useMemo(
    () => renders.find((r: any) => r.id === selectedRenderId) || null,
    [renders, selectedRenderId],
  );

  const views = useMemo(
    () => (selectedRender ? availableViews(selectedRender as any) : []),
    [selectedRender],
  );

  const initialGraph = useMemo(() => {
    if (!selectedRender) return null;
    const view = views.includes(selectedView) ? selectedView : views[0];
    return view ? buildGraphFromRender(selectedRender as any, view) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRender, selectedView, views]);

  const { graph, reset, removeById, restore, setVisibility, undo } = useObjectGraph(initialGraph);

  // Rebuild the graph whenever the source render/view selection changes.
  const graphKey = `${selectedRenderId}:${selectedView}`;
  const [lastGraphKey, setLastGraphKey] = useState(graphKey);
  if (graphKey !== lastGraphKey) {
    setLastGraphKey(graphKey);
    reset(initialGraph);
    setSelectedObjectId(null);
  }

  const handleObjectClick = (obj: DesignObject) => {
    if (removeMode) {
      removeById(obj.id);
      setSelectedObjectId(null);
      toast.success(`Removed "${obj.name}" instantly — restore it from the bin anytime.`);
    } else {
      setSelectedObjectId(obj.id);
    }
  };

  const foreground = graph ? getForegroundObjects(graph) : [];

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/admin" className="text-zinc-400 hover:text-white">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <Boxes className="w-6 h-6 text-cyan-400" />
            <div>
              <h1 className="text-xl font-bold">
                DesignPro v2 — Object Graph Engine <Badge className="ml-2 bg-purple-600">EXPERIMENTAL</Badge>
              </h1>
              <p className="text-xs text-zinc-400">
                Deterministic object tracking: every registered element is an ID + bounding box. Removal is a pure
                state-array pop — no inpainting, no pixel blur. Isolated module; production tools untouched.
              </p>
            </div>
          </div>
        </div>

        {/* Render picker */}
        <div>
          <h2 className="text-sm font-bold text-zinc-300 mb-2">1. Pick a render</h2>
          {isLoading ? (
            <p className="text-zinc-500 text-sm">Loading renders…</p>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-2">
              {renders.map((r: any) => {
                const thumb = Object.entries(r.render_urls || {}).find(
                  ([k, u]) => typeof u === "string" && u && !k.includes("spin"),
                )?.[1] as string | undefined;
                return (
                  <button
                    key={r.id}
                    onClick={() => setSelectedRenderId(r.id)}
                    className={`shrink-0 w-32 rounded-lg overflow-hidden border-2 text-left ${
                      selectedRenderId === r.id ? "border-cyan-400" : "border-zinc-800 hover:border-zinc-600"
                    }`}
                  >
                    {thumb && <img src={thumb} alt="" className="w-full h-20 object-cover" />}
                    <div className="p-1.5 text-[10px] text-zinc-400 truncate">
                      {r.design_file_name || r.color_name || "Design"} · {r.vehicle_year} {r.vehicle_make}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {selectedRender && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Canvas */}
            <div className="lg:col-span-2 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                {views.map((v) => (
                  <Button
                    key={v}
                    size="sm"
                    variant={selectedView === v ? "default" : "outline"}
                    className={selectedView === v ? "bg-cyan-600" : "border-zinc-700 text-zinc-300"}
                    onClick={() => setSelectedView(v)}
                  >
                    {v}
                  </Button>
                ))}
                <div className="flex-1" />
                <Button
                  size="sm"
                  variant={removeMode ? "default" : "outline"}
                  className={removeMode ? "bg-red-600 hover:bg-red-500" : "border-zinc-700 text-zinc-300"}
                  onClick={() => setRemoveMode((v) => !v)}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                  {removeMode ? "Remove mode ON" : "Remove mode"}
                </Button>
                <Button size="sm" variant="outline" className="border-zinc-700 text-zinc-300" onClick={undo}>
                  <Undo2 className="w-3.5 h-3.5 mr-1.5" /> Undo
                </Button>
              </div>

              {graph ? (
                <ObjectGraphCanvas
                  graph={graph}
                  removeMode={removeMode}
                  selectedId={selectedObjectId}
                  onObjectClick={handleObjectClick}
                  onBackgroundClick={() => {
                    setSelectedObjectId(null);
                    if (removeMode) {
                      toast.info(
                        "That area is part of the background panel — it isn't a registered object yet, so there is nothing to pop. Register it as a layer first (lift once), then removal is instant forever.",
                      );
                    }
                  }}
                />
              ) : (
                <p className="text-zinc-500 text-sm">No image for this view.</p>
              )}
            </div>

            {/* Object list + removed bin */}
            <div className="space-y-4">
              <div className="rounded-lg border border-zinc-800 p-3">
                <h3 className="text-sm font-bold mb-2">Active objects ({foreground.length + 1})</h3>
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between rounded bg-zinc-900 px-2 py-1.5 text-zinc-400">
                    <span>🔒 Background Panel</span>
                    <span className="text-[10px]">base layer</span>
                  </div>
                  {foreground.map((o) => (
                    <div
                      key={o.id}
                      className={`flex items-center justify-between rounded px-2 py-1.5 ${
                        selectedObjectId === o.id ? "bg-cyan-900/40" : "bg-zinc-900"
                      }`}
                    >
                      <span className="truncate text-zinc-200">{o.name}</span>
                      <span className="flex items-center gap-1">
                        <button
                          className="p-1 text-zinc-400 hover:text-white"
                          onClick={() => setVisibility(o.id, !o.visible)}
                          title={o.visible ? "Hide" : "Show"}
                        >
                          {o.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          className="p-1 text-red-400 hover:text-red-300"
                          onClick={() => {
                            removeById(o.id);
                            toast.success(`Removed "${o.name}" instantly.`);
                          }}
                          title="Remove instantly"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    </div>
                  ))}
                  {foreground.length === 0 && (
                    <p className="text-zinc-500">
                      No registered foreground objects on this view yet. Renders that have lifted layers (logos /
                      extracted elements) show them here as instantly removable objects.
                    </p>
                  )}
                </div>
              </div>

              {graph && graph.removed.length > 0 && (
                <div className="rounded-lg border border-zinc-800 p-3">
                  <h3 className="text-sm font-bold mb-2">Removed bin ({graph.removed.length})</h3>
                  <div className="space-y-1.5 text-xs">
                    {graph.removed.map((o) => (
                      <div key={o.id} className="flex items-center justify-between rounded bg-zinc-900 px-2 py-1.5">
                        <span className="truncate text-zinc-400 line-through">{o.name}</span>
                        <button
                          className="p-1 text-cyan-400 hover:text-cyan-300"
                          onClick={() => restore(o.id)}
                          title="Restore"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
