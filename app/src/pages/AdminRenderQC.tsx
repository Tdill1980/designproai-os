import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle2, XCircle, Flag, Eye, ChevronLeft, ChevronRight,
  Search, Filter, BarChart3, Clock, Loader2, RotateCcw, Download,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { MyVehicleProInline } from "@/components/tools/MyVehicleProInline";

// ---------------------------------------------------------------------------
// QC Status stored in admin_notes field with JSON prefix
// Format: {"qc":{"status":"pass|fail|flag","notes":"...","reviewed_at":"ISO"}}
// ---------------------------------------------------------------------------

interface QCStatus {
  status: "pass" | "fail" | "flag" | "unreviewed";
  notes: string;
  reviewed_at: string | null;
}

function parseQCStatus(adminNotes: string | null): QCStatus {
  if (!adminNotes) return { status: "unreviewed", notes: "", reviewed_at: null };
  try {
    const parsed = JSON.parse(adminNotes);
    if (parsed?.qc) return parsed.qc;
  } catch {
    // Not JSON - legacy admin_notes, treat as unreviewed
  }
  return { status: "unreviewed", notes: "", reviewed_at: null };
}

function buildAdminNotes(qc: QCStatus, existingNotes?: string): string {
  let existing: Record<string, any> = {};
  try { existing = JSON.parse(existingNotes || "{}"); } catch {}
  return JSON.stringify({ ...existing, qc });
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

const STATUS_COLORS: Record<string, string> = {
  pass: "bg-green-600",
  fail: "bg-red-600",
  flag: "bg-yellow-600",
  unreviewed: "bg-zinc-700",
};

export default function AdminRenderQC() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [modeFilter, setModeFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRender, setSelectedRender] = useState<any | null>(null);
  const [qcNotes, setQcNotes] = useState("");
  const [currentViewIndex, setCurrentViewIndex] = useState(0);

  // Fetch all completed renders
  const { data: renders, isLoading } = useQuery({
    queryKey: ["qc-renders", modeFilter, searchQuery],
    queryFn: async () => {
      let query = supabase
        .from("color_visualizations")
        .select("*")
        .eq("generation_status", "completed")
        .order("created_at", { ascending: false })
        .limit(500);

      if (modeFilter !== "all") {
        query = query.eq("mode_type", modeFilter);
      }

      if (searchQuery) {
        query = query.or(
          `vehicle_make.ilike.%${searchQuery}%,vehicle_model.ilike.%${searchQuery}%,color_name.ilike.%${searchQuery}%,customer_email.ilike.%${searchQuery}%`
        );
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  // Filter by QC status client-side
  const filteredRenders = useMemo(() => {
    if (!renders) return [];
    if (statusFilter === "all") return renders;
    return renders.filter((r) => {
      const qc = parseQCStatus(r.admin_notes);
      return qc.status === statusFilter;
    });
  }, [renders, statusFilter]);

  // Stats
  const stats = useMemo(() => {
    if (!renders) return { total: 0, pass: 0, fail: 0, flag: 0, unreviewed: 0 };
    const s = { total: renders.length, pass: 0, fail: 0, flag: 0, unreviewed: 0 };
    for (const r of renders) {
      const qc = parseQCStatus(r.admin_notes);
      s[qc.status]++;
    }
    return s;
  }, [renders]);

  // Update QC status mutation
  const updateQC = useMutation({
    mutationFn: async ({ id, status, notes, existingAdminNotes }: { id: string; status: "pass" | "fail" | "flag"; notes: string; existingAdminNotes?: string }) => {
      const qc: QCStatus = { status, notes, reviewed_at: new Date().toISOString() };
      const { error } = await supabase
        .from("color_visualizations")
        .update({ admin_notes: buildAdminNotes(qc, existingAdminNotes) } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qc-renders"] });
      toast.success("QC status updated");
    },
  });

  // Quick QC action (from grid view)
  const quickQC = (id: string, status: "pass" | "fail" | "flag") => {
    const render = renders?.find((r: any) => r.id === id);
    updateQC.mutate({ id, status, notes: "", existingAdminNotes: render?.admin_notes });
  };

  // Detailed QC action (from modal)
  const submitDetailedQC = (status: "pass" | "fail" | "flag") => {
    if (!selectedRender) return;
    updateQC.mutate({ id: selectedRender.id, status, notes: qcNotes, existingAdminNotes: selectedRender.admin_notes });
    setSelectedRender(null);
    setQcNotes("");
  };

  // Get sorted views for a render
  const getViews = (render: any): Array<{ key: string; url: string }> => {
    const urls = render.render_urls as Record<string, string> | null;
    if (!urls) return [];
    return VIEW_ORDER
      .filter((k) => urls[k])
      .map((k) => ({ key: k, url: urls[k] }));
  };

  // Navigate between renders in modal
  const goToRender = (direction: number) => {
    if (!selectedRender || !filteredRenders) return;
    const idx = filteredRenders.findIndex((r) => r.id === selectedRender.id);
    const nextIdx = idx + direction;
    if (nextIdx >= 0 && nextIdx < filteredRenders.length) {
      setSelectedRender(filteredRenders[nextIdx]);
      setCurrentViewIndex(0);
      setQcNotes("");
    }
  };

  const progressPercent = stats.total > 0
    ? Math.round(((stats.pass + stats.fail + stats.flag) / stats.total) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-black text-white p-3 sm:p-6">
      {/* Header */}
      <div className="max-w-[1800px] mx-auto">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-3xl font-bold">Render QC Dashboard</h1>
            <p className="text-zinc-400 mt-1">
              Review and approve renders before International Sign Expo launch
            </p>
          </div>
          <Badge variant="outline" className="text-lg px-4 py-2 border-blue-500 text-blue-400">
            {stats.pass + stats.fail + stats.flag} / {stats.total} reviewed ({progressPercent}%)
          </Badge>
        </div>

        {/* Progress Bar */}
        <div className="w-full h-3 bg-zinc-800 rounded-full mb-6 overflow-hidden">
          <div className="h-full flex">
            <div className="bg-green-500 transition-all" style={{ width: `${stats.total ? (stats.pass / stats.total) * 100 : 0}%` }} />
            <div className="bg-red-500 transition-all" style={{ width: `${stats.total ? (stats.fail / stats.total) * 100 : 0}%` }} />
            <div className="bg-yellow-500 transition-all" style={{ width: `${stats.total ? (stats.flag / stats.total) * 100 : 0}%` }} />
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 sm:gap-4 mb-6">
          {[
            { label: "Total", value: stats.total, color: "text-white", icon: BarChart3 },
            { label: "Unreviewed", value: stats.unreviewed, color: "text-zinc-400", icon: Clock },
            { label: "Pass", value: stats.pass, color: "text-green-400", icon: CheckCircle2 },
            { label: "Fail", value: stats.fail, color: "text-red-400", icon: XCircle },
            { label: "Flagged", value: stats.flag, color: "text-yellow-400", icon: Flag },
          ].map((s) => (
            <Card key={s.label} className="bg-zinc-900 border-zinc-800">
              <CardContent className="pt-4 pb-3 flex items-center gap-3">
                <s.icon className={`w-6 h-6 ${s.color}`} />
                <div>
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-zinc-500">{s.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mb-6">
          <div className="relative flex-1 sm:max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <Input
              placeholder="Search vehicle, color, or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-zinc-900 border-zinc-700"
            />
          </div>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-48 bg-zinc-900 border-zinc-700">
              <Filter className="w-4 h-4 mr-2" />
              <SelectValue placeholder="QC Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Renders</SelectItem>
              <SelectItem value="unreviewed">Unreviewed</SelectItem>
              <SelectItem value="pass">Pass</SelectItem>
              <SelectItem value="fail">Fail</SelectItem>
              <SelectItem value="flag">Flagged</SelectItem>
            </SelectContent>
          </Select>

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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
            {filteredRenders.map((render) => {
              const qc = parseQCStatus(render.admin_notes);
              const views = getViews(render);
              const heroUrl = views.find((v) => v.key === "roof")?.url || views[0]?.url;

              return (
                <Card
                  key={render.id}
                  className={`bg-zinc-900 border-zinc-800 overflow-hidden cursor-pointer hover:border-blue-600 transition-colors ${
                    qc.status === "pass" ? "border-green-800/50" :
                    qc.status === "fail" ? "border-red-800/50" :
                    qc.status === "flag" ? "border-yellow-800/50" : ""
                  }`}
                >
                  {/* Hero Image */}
                  <div
                    className="relative aspect-video bg-zinc-800"
                    onClick={() => {
                      setSelectedRender(render);
                      setCurrentViewIndex(0);
                      setQcNotes(qc.notes || "");
                    }}
                  >
                    {heroUrl ? (
                      <img src={heroUrl} alt="Hero" className="w-full h-full object-cover" />
                    ) : (
                      <div className="flex items-center justify-center h-full text-zinc-600">No render</div>
                    )}

                    {/* QC Status Badge */}
                    <div className={`absolute top-2 right-2 px-2 py-1 rounded text-xs font-bold uppercase ${STATUS_COLORS[qc.status]}`}>
                      {qc.status}
                    </div>

                    {/* View Count */}
                    <div className="absolute bottom-2 left-2 bg-black/70 px-2 py-1 rounded text-xs flex items-center gap-1">
                      <Eye className="w-3 h-3" /> {views.length} views
                    </div>
                  </div>

                  {/* Info */}
                  <CardContent className="p-3">
                    <p className="font-semibold text-sm truncate">
                      {render.vehicle_year} {render.vehicle_make} {render.vehicle_model}
                    </p>
                    <p className="text-xs text-zinc-400 truncate">
                      {render.color_name} • {render.finish_type}
                    </p>
                    <div className="flex items-center justify-between mt-2">
                      <Badge variant="outline" className="text-[10px]">
                        {render.mode_type || "unknown"}
                      </Badge>
                      <span className="text-[10px] text-zinc-500">
                        {render.created_at ? formatDistanceToNow(new Date(render.created_at), { addSuffix: true }) : ""}
                      </span>
                    </div>

                    {/* Quick QC Buttons */}
                    <div className="flex gap-2 mt-3">
                      <Button
                        size="sm"
                        variant={qc.status === "pass" ? "default" : "outline"}
                        className={`flex-1 text-xs h-8 ${qc.status === "pass" ? "bg-green-600 hover:bg-green-700" : ""}`}
                        onClick={(e) => { e.stopPropagation(); quickQC(render.id, "pass"); }}
                      >
                        <CheckCircle2 className="w-3 h-3 mr-1" /> Pass
                      </Button>
                      <Button
                        size="sm"
                        variant={qc.status === "fail" ? "default" : "outline"}
                        className={`flex-1 text-xs h-8 ${qc.status === "fail" ? "bg-red-600 hover:bg-red-700" : ""}`}
                        onClick={(e) => { e.stopPropagation(); quickQC(render.id, "fail"); }}
                      >
                        <XCircle className="w-3 h-3 mr-1" /> Fail
                      </Button>
                      <Button
                        size="sm"
                        variant={qc.status === "flag" ? "default" : "outline"}
                        className={`flex-1 text-xs h-8 ${qc.status === "flag" ? "bg-yellow-600 hover:bg-yellow-700" : ""}`}
                        onClick={(e) => { e.stopPropagation(); quickQC(render.id, "flag"); }}
                      >
                        <Flag className="w-3 h-3 mr-1" /> Flag
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {filteredRenders.length === 0 && !isLoading && (
          <div className="text-center py-20 text-zinc-500">
            No renders found matching your filters
          </div>
        )}
      </div>

      {/* Detail Modal */}
      <Dialog open={!!selectedRender} onOpenChange={(open) => { if (!open) setSelectedRender(null); }}>
        <DialogContent className="max-w-6xl w-[95vw] bg-zinc-900 border-zinc-700 text-white p-0 overflow-hidden">
          {selectedRender && (() => {
            const views = getViews(selectedRender);
            const qc = parseQCStatus(selectedRender.admin_notes);
            const currentView = views[currentViewIndex];
            const renderIdx = filteredRenders.findIndex((r) => r.id === selectedRender.id);

            return (
              <>
                {/* Top Bar: Navigation + Vehicle Info */}
                <div className="flex items-center justify-between px-6 py-3 border-b border-zinc-800 bg-zinc-950">
                  <div className="flex items-center gap-4">
                    <Button size="sm" variant="ghost" onClick={() => goToRender(-1)} disabled={renderIdx <= 0}>
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <span className="text-sm text-zinc-400">{renderIdx + 1} / {filteredRenders.length}</span>
                    <Button size="sm" variant="ghost" onClick={() => goToRender(1)} disabled={renderIdx >= filteredRenders.length - 1}>
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>

                  <div className="text-center">
                    <p className="font-bold">
                      {selectedRender.vehicle_year} {selectedRender.vehicle_make} {selectedRender.vehicle_model}
                    </p>
                    <p className="text-xs text-zinc-400">
                      {selectedRender.color_name} • {selectedRender.finish_type} • {selectedRender.mode_type}
                    </p>
                  </div>

                  <Badge className={`${STATUS_COLORS[qc.status]} text-white uppercase`}>
                    {qc.status}
                  </Badge>
                </div>

                {/* Main View */}
                <div className="relative bg-black">
                  {currentView ? (
                    <img
                      src={currentView.url}
                      alt={VIEW_LABELS[currentView.key]}
                      className="w-full max-h-[500px] object-contain"
                    />
                  ) : (
                    <div className="h-[500px] flex items-center justify-center text-zinc-600">No views available</div>
                  )}

                  {/* View label overlay */}
                  {currentView && (
                    <div className="absolute top-4 left-4 bg-black/70 px-3 py-1 rounded text-sm font-semibold">
                      {VIEW_LABELS[currentView.key] || currentView.key}
                    </div>
                  )}

                  {/* Arrow navigation */}
                  {views.length > 1 && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/80"
                        onClick={() => setCurrentViewIndex((i) => Math.max(0, i - 1))}
                        disabled={currentViewIndex === 0}
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/80"
                        onClick={() => setCurrentViewIndex((i) => Math.min(views.length - 1, i + 1))}
                        disabled={currentViewIndex === views.length - 1}
                      >
                        <ChevronRight className="w-5 h-5" />
                      </Button>
                    </>
                  )}
                </div>

                {/* View Thumbnails */}
                <div className="flex gap-2 px-6 py-3 bg-zinc-950 overflow-x-auto">
                  {views.map((v, i) => (
                    <button
                      key={v.key}
                      onClick={() => setCurrentViewIndex(i)}
                      className={`flex-shrink-0 w-24 h-16 rounded overflow-hidden border-2 transition-colors ${
                        i === currentViewIndex ? "border-blue-500" : "border-zinc-700 hover:border-zinc-500"
                      }`}
                    >
                      <img src={v.url} alt={VIEW_LABELS[v.key]} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>

                {/* QC Actions */}
                <div className="px-6 py-4 border-t border-zinc-800">
                  <div className="flex flex-col sm:flex-row gap-4 sm:items-end">
                    <div className="flex-1">
                      <label className="text-xs text-zinc-400 mb-1 block">QC Notes (optional)</label>
                      <Textarea
                        value={qcNotes}
                        onChange={(e) => setQcNotes(e.target.value)}
                        placeholder="Notes about this render (issues, observations...)"
                        className="bg-zinc-800 border-zinc-700 h-20 resize-none"
                      />
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <Button
                        size="lg"
                        className="bg-green-600 hover:bg-green-700"
                        onClick={() => submitDetailedQC("pass")}
                      >
                        <CheckCircle2 className="w-5 h-5 mr-2" /> Pass
                      </Button>
                      <Button
                        size="lg"
                        className="bg-red-600 hover:bg-red-700"
                        onClick={() => submitDetailedQC("fail")}
                      >
                        <XCircle className="w-5 h-5 mr-2" /> Fail
                      </Button>
                      <Button
                        size="lg"
                        className="bg-yellow-600 hover:bg-yellow-700"
                        onClick={() => submitDetailedQC("flag")}
                      >
                        <Flag className="w-5 h-5 mr-2" /> Flag
                      </Button>
                    </div>
                  </div>

                  {/* Custom design preview if exists */}
                  {selectedRender.custom_design_url && (
                    <div className="mt-4 p-3 bg-zinc-800 rounded-lg">
                      <p className="text-xs text-zinc-400 mb-2">Original Upload / VisionBoard Design</p>
                      <img
                        src={selectedRender.custom_design_url}
                        alt="Original design"
                        className="max-h-32 rounded border border-zinc-700"
                      />
                    </div>
                  )}

                  {/* MyVehiclePro */}
                  <div className="mt-4">
                    <MyVehicleProInline
                      colorName={selectedRender.color_name}
                      colorHex={selectedRender.color_hex}
                      finishType={selectedRender.finish_type}
                      modeType={selectedRender.mode_type || undefined}
                      vehicleYear={selectedRender.vehicle_year}
                      vehicleMake={selectedRender.vehicle_make}
                      vehicleModel={selectedRender.vehicle_model}
                    />
                  </div>

                  {/* Metadata row */}
                  <div className="flex flex-wrap gap-3 sm:gap-6 mt-4 text-xs text-zinc-500">
                    <span>Email: {selectedRender.customer_email}</span>
                    <span>Tier: {selectedRender.subscription_tier || "-"}</span>
                    <span>Created: {selectedRender.created_at ? new Date(selectedRender.created_at).toLocaleString() : "-"}</span>
                    <span>ID: {selectedRender.id.slice(0, 8)}...</span>
                  </div>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
