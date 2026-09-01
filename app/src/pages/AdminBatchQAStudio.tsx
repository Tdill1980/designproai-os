/**
 * Admin Batch QA Studio
 *
 * Dedicated curation page for reviewing, rating, and promoting batch renders.
 * Separate from AdminBatchResults - this is the hands-on curation workspace.
 *
 * Features:
 * - Grid of thumbnails with click-to-expand full 7-view gallery
 * - Star rating (1-5) with text notes, persists to Supabase
 * - Tag labels: winner / needs revision / trash / ISA demo
 * - Error feedback flags with re-render button
 * - Winner Pipeline: Test with VisionBoardIQ, MyVehiclePro, Test Revision
 * - Promote: Gallery, ISA Demo, Export
 * - Filter by batch, vehicle, tool, rating, status
 * - Sort by date, rating, vehicle
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Star, ArrowLeft, Camera, Wand2, Loader2,
  CheckCircle2, Image as ImageIcon, Send, RotateCw, Filter,
  Download, ExternalLink, Grid3X3, Tag, Trophy, Trash2,
  AlertTriangle, Flag, Palette, Car, Award, Share2,
  ArrowUpDown, Microscope,
} from "lucide-react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { MyVehicleProInline } from "@/components/tools/MyVehicleProInline";

/* ================================================================ */
/* Types                                                             */
/* ================================================================ */

interface QARender {
  id: string;
  render_urls: Record<string, string> | null;
  vehicle_year: number;
  vehicle_make: string;
  vehicle_model: string;
  color_name: string;
  color_hex: string;
  finish_type: string;
  mode_type: string | null;
  admin_notes: string | null;
  design_file_name: string | null;
  created_at: string | null;
  customer_email: string;
  batch_id: string;
  tool: string;
  original_prompt: string;
  design_name: string;
  panel_url: string | null;
  my_rating: number | null;
  my_feedback: string | null;
  avg_rating: number;
  total_ratings: number;
  tags: string[];
  error_flags: string[];
  deployed_to_gallery: boolean;
}

type RenderTag = "winner" | "needs_revision" | "trash" | "isa_demo";

const TAG_CONFIG: Record<RenderTag, { label: string; color: string; icon: typeof Trophy }> = {
  winner: { label: "Winner", color: "bg-green-600 text-white", icon: Trophy },
  needs_revision: { label: "Needs Revision", color: "bg-amber-600 text-white", icon: RotateCw },
  trash: { label: "Trash", color: "bg-red-600 text-white", icon: Trash2 },
  isa_demo: { label: "ISA Demo", color: "bg-blue-600 text-white", icon: Award },
};

const ERROR_FLAGS = [
  { key: "wrong_vehicle", label: "Wrong vehicle" },
  { key: "distorted_graphics", label: "Distorted graphics" },
  { key: "bad_color_match", label: "Bad color match" },
  { key: "missing_panels", label: "Missing panels" },
  { key: "not_photorealistic", label: "Cartoonish / not photorealistic" },
  { key: "other", label: "Other" },
] as const;

const VIEW_ORDER = ["side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof"];
const VIEW_LABELS: Record<string, string> = {
  side: "Driver Side",
  "passenger-side": "Passenger Side",
  hood_detail: "Hood",
  front: "Front",
  rear: "Rear",
  "close-up": "Close-Up",
  roof: "Roof Plan",
  panel: "Design Panel",
};

const TOOL_LABELS: Record<string, string> = {
  designpanelpro: "DesignProAI",
  colorpro: "ColorPro",
  fadewraps: "FadeWraps",
  wbty: "PatternPro",
  approvemode: "ApprovePro",
  designpro: "DesignProAI",
};

const TOOL_COLORS: Record<string, string> = {
  designpanelpro: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  designpro: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  colorpro: "border-green-500/30 bg-green-500/10 text-green-400",
  fadewraps: "border-orange-500/30 bg-orange-500/10 text-orange-400",
  wbty: "border-purple-500/30 bg-purple-500/10 text-purple-400",
  approvemode: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
};

const CAROUSEL_TABLE_MAP: Record<string, string> = {
  colorpro: "inkfusion_carousel",
  fadewraps: "fadewraps_carousel",
  designpanelpro: "designpanelpro_carousel",
  designpro: "designpanelpro_carousel",
  wbty: "wbty_carousel",
  approvemode: "approvemode_carousel",
};

/** Pick best thumbnail URL - DesignProAI prefers side (original branded render) */
function pickHeroUrl(render: { render_urls?: Record<string, any> | null; tool?: string; mode_type?: string }): string | null {
  const urls = render.render_urls;
  if (!urls) return null;
  const isDesignPro = render.tool === "designpanelpro" || render.tool === "designpro"
    || render.mode_type === "designpanelpro" || render.mode_type === "designpro";
  if (isDesignPro) return urls.side || urls.hero || null;
  return urls.hero || urls.side || null;
}

/* ================================================================ */
/* Star Rating Component                                             */
/* ================================================================ */

function StarRating({
  value,
  onChange,
  size = "md",
}: {
  value: number | null;
  onChange: (rating: number) => void;
  size?: "sm" | "md" | "lg";
}) {
  const [hover, setHover] = useState<number | null>(null);
  const displayValue = hover ?? value ?? 0;
  const sizeClass = size === "lg" ? "w-10 h-10" : size === "md" ? "w-7 h-7" : "w-5 h-5";

  return (
    <div className="flex items-center gap-1.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          className={cn("transition-all duration-150 hover:scale-110", sizeClass)}
          onMouseEnter={() => setHover(star)}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => { e.stopPropagation(); onChange(star); }}
        >
          <Star
            className={cn(
              "w-full h-full transition-colors",
              star <= displayValue
                ? "fill-yellow-400 text-yellow-400"
                : "fill-transparent text-zinc-600 hover:text-zinc-400"
            )}
          />
        </button>
      ))}
      {value && <span className="ml-1.5 text-sm font-semibold text-white">{value}/5</span>}
    </div>
  );
}

/* ================================================================ */
/* 7-View Gallery Viewer                                             */
/* ================================================================ */

function ViewGallery({ renderUrls }: { renderUrls: Record<string, string> | null }) {
  const [activeView, setActiveView] = useState<string>("roof");

  if (!renderUrls) return <div className="text-zinc-500 text-sm">No renders available</div>;

  const views: { key: string; label: string; url: string }[] = [];
  for (const key of VIEW_ORDER) {
    if (renderUrls[key] && typeof renderUrls[key] === "string") {
      views.push({ key, label: VIEW_LABELS[key] || key, url: renderUrls[key] });
    }
  }
  if (renderUrls.panel && typeof renderUrls.panel === "string") {
    views.push({ key: "panel", label: "Design Panel", url: renderUrls.panel });
  }
  for (const [key, url] of Object.entries(renderUrls)) {
    if (typeof url === "string" && url.startsWith("http") && !views.find((v) => v.key === key)) {
      views.push({ key, label: VIEW_LABELS[key] || key, url });
    }
  }

  if (views.length === 0) return <div className="text-zinc-500 text-sm">No render images found</div>;
  const currentView = views.find((v) => v.key === activeView) || views[0];

  return (
    <div className="space-y-3">
      <div className="relative w-full aspect-video bg-zinc-950 rounded-xl overflow-hidden border border-zinc-800">
        <img src={currentView.url} alt={currentView.label} className="w-full h-full object-contain" loading="eager" />
        <div className="absolute top-3 left-3">
          <Badge className="bg-black/70 text-white border border-zinc-700 text-[10px]">{currentView.label}</Badge>
        </div>
        <div className="absolute top-3 right-3">
          <Badge className="bg-black/70 text-green-400 border border-zinc-700 text-[10px]">
            <Camera className="w-3 h-3 mr-1" /> {views.length} views
          </Badge>
        </div>
      </div>
      {views.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {views.map((view) => (
            <button
              key={view.key}
              onClick={() => setActiveView(view.key)}
              className={cn(
                "flex-shrink-0 w-20 h-14 rounded-lg overflow-hidden border-2 transition-all relative group",
                view.key === currentView.key
                  ? "border-blue-400 ring-2 ring-blue-400/30"
                  : "border-zinc-700 hover:border-zinc-500"
              )}
            >
              <img src={view.url} alt={view.label} className="w-full h-full object-cover" loading="lazy" />
              <span className="absolute bottom-0 left-0 right-0 bg-black/80 text-[7px] text-center py-0.5 text-zinc-400">
                {view.label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ================================================================ */
/* Grid Thumbnail Card                                               */
/* ================================================================ */

function QAGridCard({
  render,
  onClick,
  onQuickRate,
}: {
  render: QARender;
  onClick: () => void;
  onQuickRate: (id: string, rating: number) => void;
}) {
  const heroUrl = pickHeroUrl(render);
  const toolLabel = TOOL_LABELS[render.tool] || TOOL_LABELS[render.mode_type || ""] || render.tool;
  const toolColor = TOOL_COLORS[render.tool] || TOOL_COLORS[render.mode_type || ""] || "border-zinc-500/30 bg-zinc-500/10 text-zinc-400";
  const viewCount = render.render_urls
    ? Object.values(render.render_urls).filter((u) => typeof u === "string" && (u as string).startsWith("http")).length
    : 0;

  return (
    <Card
      className={cn(
        "bg-zinc-900 border-zinc-800 overflow-hidden cursor-pointer hover:border-zinc-600 transition-all group relative",
        render.tags.includes("winner") && "ring-1 ring-green-500/40",
        render.tags.includes("trash") && "opacity-50",
        render.tags.includes("isa_demo") && "ring-1 ring-blue-500/40",
      )}
      onClick={onClick}
    >
      <div className="relative aspect-video bg-zinc-800">
        {heroUrl ? (
          <img src={heroUrl} alt={render.design_name} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon className="w-8 h-8 text-zinc-700" />
          </div>
        )}

        {render.tags.length > 0 && (
          <div className="absolute top-1.5 left-1.5 flex gap-1 flex-wrap">
            {render.tags.map((tag) => {
              const cfg = TAG_CONFIG[tag as RenderTag];
              if (!cfg) return null;
              const Icon = cfg.icon;
              return (
                <Badge key={tag} className={cn("text-[8px] px-1 py-0", cfg.color)}>
                  <Icon className="w-2.5 h-2.5 mr-0.5" /> {cfg.label}
                </Badge>
              );
            })}
          </div>
        )}

        <div className="absolute top-1.5 right-1.5">
          <Badge className="bg-black/70 text-green-400 border-0 text-[8px] px-1 py-0">
            <Camera className="w-2.5 h-2.5 mr-0.5" /> {viewCount}
          </Badge>
        </div>

        {render.error_flags.length > 0 && (
          <div className="absolute bottom-1.5 right-1.5">
            <Badge className="bg-red-600/80 text-white text-[8px] px-1 py-0">
              <AlertTriangle className="w-2.5 h-2.5 mr-0.5" /> {render.error_flags.length} issues
            </Badge>
          </div>
        )}

        {render.deployed_to_gallery && (
          <div className="absolute bottom-1.5 left-1.5">
            <Badge className="bg-green-600/80 text-white text-[8px] px-1 py-0">
              <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" /> Live
            </Badge>
          </div>
        )}
      </div>

      <div className="p-2.5 space-y-1">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-white truncate flex-1">{render.design_name}</h3>
          <Badge className={cn("text-[8px] border ml-1 flex-shrink-0", toolColor)}>{toolLabel}</Badge>
        </div>
        <p className="text-[10px] text-zinc-500 truncate">
          {render.vehicle_year} {render.vehicle_make} {render.vehicle_model}
        </p>

        <div className="flex items-center gap-0.5 pt-0.5" onClick={(e) => e.stopPropagation()}>
          {[1, 2, 3, 4, 5].map((s) => (
            <button
              key={s}
              onClick={(e) => { e.stopPropagation(); onQuickRate(render.id, s); }}
              className="hover:scale-125 transition-transform"
            >
              <Star
                className={cn(
                  "w-4 h-4 transition-colors",
                  s <= (render.my_rating || 0) ? "fill-yellow-400 text-yellow-400" : "fill-transparent text-zinc-700 hover:text-zinc-500"
                )}
              />
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}

/* ================================================================ */
/* Detail Dialog - Full curation panel                               */
/* ================================================================ */

function QADetailDialog({
  render,
  open,
  onClose,
  onRate,
  onRevise,
  isRevising,
  onDeployToGallery,
  isDeploying,
  onTagToggle,
  onErrorFlagToggle,
  onReRenderWithFix,
  isReRendering,
  onTestVisionBoard,
  onTestMyVehiclePro,
  onAddToIsaDemo,
}: {
  render: QARender | null;
  open: boolean;
  onClose: () => void;
  onRate: (id: string, rating: number, feedback?: string) => void;
  onRevise: (id: string, prompt: string) => void;
  isRevising: boolean;
  onDeployToGallery: (render: QARender) => void;
  isDeploying: boolean;
  onTagToggle: (id: string, tag: RenderTag) => void;
  onErrorFlagToggle: (id: string, flag: string) => void;
  onReRenderWithFix: (id: string) => void;
  isReRendering: boolean;
  onTestVisionBoard: (render: QARender) => void;
  onTestMyVehiclePro: (render: QARender) => void;
  onAddToIsaDemo: (render: QARender) => void;
}) {
  const [showRevise, setShowRevise] = useState(false);
  const [revisionPrompt, setRevisionPrompt] = useState("");
  const [feedbackText, setFeedbackText] = useState("");
  const [localRating, setLocalRating] = useState<number | null>(null);
  const [otherErrorText, setOtherErrorText] = useState("");

  const currentId = render?.id;
  useEffect(() => {
    if (render) {
      setRevisionPrompt("");
      setFeedbackText(render.my_feedback || "");
      setLocalRating(render.my_rating);
      setShowRevise(false);
      setOtherErrorText("");
    }
  }, [currentId]);

  if (!render) return null;

  const vehicleLabel = `${render.vehicle_year} ${render.vehicle_make} ${render.vehicle_model}`;
  const toolLabel = TOOL_LABELS[render.tool] || TOOL_LABELS[render.mode_type || ""] || render.tool;
  const toolColor = TOOL_COLORS[render.tool] || TOOL_COLORS[render.mode_type || ""] || "border-zinc-500/30 bg-zinc-500/10 text-zinc-400";
  const isWinner = render.my_rating !== null && render.my_rating >= 3;
  const heroUrl = pickHeroUrl(render);

  const handleRate = (rating: number) => {
    setLocalRating(rating);
    onRate(render.id, rating, feedbackText || undefined);
  };

  const handleSubmitFeedback = () => {
    if (localRating) {
      onRate(render.id, localRating, feedbackText);
    }
  };

  const handleRevise = () => {
    onRevise(render.id, revisionPrompt);
    setShowRevise(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[1200px] max-h-[90vh] overflow-y-auto bg-zinc-950 border-zinc-800 text-white p-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <DialogTitle className="text-lg font-bold">{render.design_name}</DialogTitle>
            <Badge className={cn("text-[10px] border", toolColor)}>{toolLabel}</Badge>
            {render.tags.map((tag) => {
              const cfg = TAG_CONFIG[tag as RenderTag];
              if (!cfg) return null;
              return <Badge key={tag} className={cn("text-[9px]", cfg.color)}>{cfg.label}</Badge>;
            })}
          </div>
          <p className="text-xs text-zinc-500">{vehicleLabel} &middot; {render.finish_type} &middot; Batch: {render.batch_id}</p>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-0">
          {/* Left: Gallery (3/5) */}
          <div className="lg:col-span-3 p-5 border-r border-zinc-800">
            <ViewGallery renderUrls={render.render_urls} />
          </div>

          {/* Right: Actions panel (2/5) */}
          <div className="lg:col-span-2 p-5 space-y-4 overflow-y-auto max-h-[75vh]">
            {/* Star Rating */}
            <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800 space-y-3">
              <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Quality Rating</h4>
              <StarRating value={localRating} onChange={handleRate} size="lg" />
              <Textarea
                placeholder="Feedback notes - what works, what doesn't..."
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                className="bg-zinc-800 border-zinc-700 text-white text-xs placeholder:text-zinc-600 min-h-[60px]"
              />
              {feedbackText && localRating && (
                <Button size="sm" onClick={handleSubmitFeedback} className="w-full bg-blue-600 hover:bg-blue-700 text-xs">
                  <Send className="w-3 h-3 mr-1.5" /> Save Feedback
                </Button>
              )}
              {render.avg_rating > 0 && (
                <div className="flex items-center gap-2 text-[10px] text-zinc-500 pt-1 border-t border-zinc-800">
                  <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                  <span>Avg: {render.avg_rating.toFixed(1)} ({render.total_ratings} ratings)</span>
                </div>
              )}
            </div>

            {/* Tags */}
            <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800 space-y-2">
              <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                <Tag className="w-3 h-3 inline mr-1" /> Tags
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(TAG_CONFIG) as RenderTag[]).map((tag) => {
                  const cfg = TAG_CONFIG[tag];
                  const Icon = cfg.icon;
                  const isActive = render.tags.includes(tag);
                  return (
                    <button
                      key={tag}
                      onClick={() => onTagToggle(render.id, tag)}
                      className={cn(
                        "inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all border",
                        isActive
                          ? cfg.color + " border-transparent"
                          : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:border-zinc-500"
                      )}
                    >
                      <Icon className="w-3 h-3" /> {cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Error Feedback Loop */}
            <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800 space-y-2">
              <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                <Flag className="w-3 h-3 inline mr-1" /> Issue Flags
              </h4>
              <div className="space-y-1.5">
                {ERROR_FLAGS.map((flag) => (
                  <label
                    key={flag.key}
                    className="flex items-center gap-2 cursor-pointer hover:bg-zinc-800/50 px-2 py-1 rounded transition-colors"
                  >
                    <Checkbox
                      checked={render.error_flags.includes(flag.key)}
                      onCheckedChange={() => onErrorFlagToggle(render.id, flag.key)}
                      className="border-zinc-600 data-[state=checked]:bg-red-600 data-[state=checked]:border-red-600"
                    />
                    <span className="text-xs text-zinc-300">{flag.label}</span>
                  </label>
                ))}
                {render.error_flags.includes("other") && (
                  <Textarea
                    placeholder="Describe the issue..."
                    value={otherErrorText}
                    onChange={(e) => setOtherErrorText(e.target.value)}
                    className="bg-zinc-800 border-zinc-700 text-white text-xs min-h-[40px] mt-1"
                  />
                )}
              </div>
              {render.error_flags.length > 0 && (
                <Button
                  size="sm"
                  onClick={() => onReRenderWithFix(render.id)}
                  disabled={isReRendering}
                  className="w-full bg-red-600 hover:bg-red-700 text-xs mt-2"
                >
                  {isReRendering ? (
                    <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> Re-rendering...</>
                  ) : (
                    <><RotateCw className="w-3 h-3 mr-1.5" /> Re-render with Fix</>
                  )}
                </Button>
              )}
            </div>

            {/* Winner Testing Pipeline - only for 3+ star renders */}
            {isWinner && (
              <div className="bg-zinc-900 rounded-lg p-3 border border-green-500/20 space-y-2">
                <h4 className="text-[10px] font-bold text-green-400 uppercase tracking-wider">
                  <Trophy className="w-3 h-3 inline mr-1" /> Winner Testing Pipeline
                </h4>
                <div className="space-y-1.5">
                  <MyVehicleProInline
                    colorName={render.color_name}
                    colorHex={render.color_hex}
                    finishType={render.finish_type}
                    modeType={render.mode_type || render.tool}
                    vehicleYear={render.vehicle_year}
                    vehicleMake={render.vehicle_make}
                    vehicleModel={render.vehicle_model}
                    panelUrl={render.panel_url}
                    designName={render.design_name}
                    compact
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowRevise(!showRevise)}
                    className="w-full border-purple-500/30 text-purple-400 hover:bg-purple-500/10 text-xs justify-start"
                  >
                    <Wand2 className="w-3 h-3 mr-1.5" /> Test Revision
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onTestVisionBoard(render)}
                    className="w-full border-blue-500/30 text-blue-400 hover:bg-blue-500/10 text-xs justify-start"
                  >
                    <Palette className="w-3 h-3 mr-1.5" /> Test with VisionBoardIQ
                  </Button>
                </div>
              </div>
            )}

            {/* Revision Panel */}
            {(showRevise || !isWinner) && (
              <div className="space-y-2">
                {!isWinner && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowRevise(!showRevise)}
                    className="w-full border-purple-500/30 text-purple-400 hover:bg-purple-500/10 text-xs"
                  >
                    <Wand2 className="w-3 h-3 mr-1.5" /> Revise Design
                  </Button>
                )}
                {showRevise && (
                  <div className="bg-zinc-900 rounded-lg p-3 border border-purple-500/20 space-y-2">
                    <h4 className="text-[10px] font-bold text-purple-400 uppercase tracking-wider">Original Prompt</h4>
                    <p className="text-[10px] text-zinc-400 bg-zinc-800/50 rounded p-2 max-h-20 overflow-y-auto">{render.original_prompt || "-"}</p>
                    <h4 className="text-[10px] font-bold text-purple-400 uppercase tracking-wider">What needs changed?</h4>
                    <Textarea
                      value={revisionPrompt}
                      onChange={(e) => setRevisionPrompt(e.target.value)}
                      placeholder="e.g. 'Add same design to rear window', 'Change accent color to blue', 'Remove text from hood'"
                      className="bg-zinc-800 border-zinc-700 text-white text-xs min-h-[80px]"
                    />
                    <Button
                      size="sm"
                      onClick={handleRevise}
                      disabled={isRevising || !revisionPrompt.trim()}
                      className="w-full bg-purple-600 hover:bg-purple-700 text-xs"
                    >
                      {isRevising ? (
                        <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> Generating...</>
                      ) : (
                        <><RotateCw className="w-3 h-3 mr-1.5" /> Re-Render with Revised Prompt</>
                      )}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Promotion Actions */}
            <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800 space-y-2">
              <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                <Share2 className="w-3 h-3 inline mr-1" /> Promote
              </h4>
              <div className="grid grid-cols-2 gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onDeployToGallery(render)}
                  disabled={isDeploying || render.deployed_to_gallery}
                  className="border-green-500/30 text-green-400 hover:bg-green-500/10 text-[10px] h-8"
                >
                  {render.deployed_to_gallery ? (
                    <><CheckCircle2 className="w-3 h-3 mr-1" /> In Gallery</>
                  ) : isDeploying ? (
                    <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Deploying</>
                  ) : (
                    <><ExternalLink className="w-3 h-3 mr-1" /> Send to Gallery</>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onAddToIsaDemo(render)}
                  className={cn(
                    "text-[10px] h-8",
                    render.tags.includes("isa_demo")
                      ? "border-blue-500/50 text-blue-300 bg-blue-500/10"
                      : "border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                  )}
                >
                  <Award className="w-3 h-3 mr-1" /> ISA Demo Set
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { if (heroUrl) window.open(heroUrl, "_blank"); }}
                  disabled={!heroUrl}
                  className="border-zinc-600 text-zinc-300 hover:bg-zinc-800 text-[10px] h-8"
                >
                  <Download className="w-3 h-3 mr-1" /> Export
                </Button>
              </div>
            </div>

            {/* Original Prompt */}
            <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800">
              <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">Original Prompt</h4>
              <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap max-h-36 overflow-y-auto">
                {render.original_prompt}
              </p>
            </div>

            {/* Metadata */}
            <div className="text-[10px] text-zinc-600 space-y-0.5 pt-2 border-t border-zinc-800">
              <p>ID: {render.id}</p>
              <p>Batch: {render.batch_id}</p>
              {render.color_hex && (
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full border border-zinc-600" style={{ backgroundColor: render.color_hex }} />
                  <span>{render.color_hex}</span>
                </div>
              )}
              {render.created_at && (
                <p>{new Date(render.created_at).toLocaleDateString("en-US", {
                  month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
                })}</p>
              )}
            </div>
          </div>
        </div>

        {render.panel_url && (
          <div className="px-5 pb-5 pt-0 border-t border-zinc-800">
            <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2 mt-4">Design Panel</h4>
            <div className="rounded-lg overflow-hidden border border-zinc-700">
              <img src={render.panel_url} alt="Design Panel" className="w-full aspect-[21/9] object-contain bg-white" />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ================================================================ */
/* Data Hook - QA Studio                                             */
/* ================================================================ */

function useQAStudioData(batchFilter: string, toolFilter: string, vehicleFilter: string) {
  return useQuery({
    queryKey: ["qa-studio-data", batchFilter, toolFilter, vehicleFilter],
    queryFn: async () => {
      let query = supabase
        .from("color_visualizations")
        .select("*")
        .like("admin_notes", '%"batch":true%')
        .order("created_at", { ascending: false });

      if (toolFilter !== "all") {
        query = query.eq("mode_type", toolFilter);
      }

      if (vehicleFilter && vehicleFilter !== "all") {
        const parts = vehicleFilter.split("|");
        if (parts.length === 2) {
          query = query.eq("vehicle_make", parts[0]).eq("vehicle_model", parts[1]);
        }
      }

      const { data: renders, error } = await query;
      if (error) throw error;
      if (!renders) return { renders: [], batches: [], vehicles: [] };

      const { data: { user } } = await supabase.auth.getUser();
      const myFeedback: Record<string, { rating: number; feedback_text: string }> = {};

      const { data: dnaRecords } = await supabase
        .from("neuralnetwork_design_dna")
        .select("id, vehicle_render_url, avg_rating, total_ratings")
        .order("created_at", { ascending: false });

      if (user) {
        const { data: feedback } = await supabase
          .from("neuralnetwork_feedback")
          .select("design_dna_id, rating, feedback_text")
          .eq("user_id", user.id);

        if (feedback) {
          for (const fb of feedback) {
            myFeedback[fb.design_dna_id] = { rating: fb.rating, feedback_text: fb.feedback_text };
          }
        }
      }

      const qaRenders: QARender[] = renders
        .map((r: any) => {
          let parsed: any = {};
          try {
            parsed = JSON.parse(r.admin_notes || "{}");
          } catch {
            return null;
          }
          if (!parsed.batch) return null;

          const heroUrl = pickHeroUrl(r) || "";
          const matchingDna = (dnaRecords || []).find(
            (d) => d.vehicle_render_url === heroUrl
          );
          const dnaId = matchingDna?.id || null;
          const fb = dnaId ? myFeedback[dnaId] : null;

          return {
            id: r.id,
            render_urls: r.render_urls,
            vehicle_year: r.vehicle_year,
            vehicle_make: r.vehicle_make,
            vehicle_model: r.vehicle_model,
            color_name: r.color_name,
            color_hex: r.color_hex,
            finish_type: r.finish_type,
            mode_type: r.mode_type,
            admin_notes: r.admin_notes,
            design_file_name: r.design_file_name,
            created_at: r.created_at,
            customer_email: r.customer_email,
            batch_id: parsed.batch_id || "unknown",
            tool: parsed.tool || r.mode_type || "unknown",
            original_prompt: parsed.original_prompt || "",
            design_name: parsed.design_name || r.color_name || "Untitled",
            panel_url: parsed.panel_url || r.render_urls?.panel || null,
            my_rating: fb?.rating || null,
            my_feedback: fb?.feedback_text || null,
            avg_rating: matchingDna?.avg_rating || 0,
            total_ratings: matchingDna?.total_ratings || 0,
            tags: parsed.tags || [],
            error_flags: parsed.error_flags || [],
            deployed_to_gallery: !!parsed.deployed_to_gallery,
          } as QARender;
        })
        .filter(Boolean) as QARender[];

      let filtered = qaRenders;
      if (batchFilter && batchFilter !== "all") {
        filtered = qaRenders.filter((r) => r.batch_id === batchFilter);
      }

      const batchIds = [...new Set(qaRenders.map((r) => r.batch_id))].sort().reverse();
      const vehicleSet = new Set<string>();
      for (const r of qaRenders) {
        vehicleSet.add(`${r.vehicle_make}|${r.vehicle_model}`);
      }
      const vehicleList = [...vehicleSet].sort();

      return { renders: filtered, batches: batchIds, vehicles: vehicleList };
    },
  });
}

/* ================================================================ */
/* Rating Mutation                                                   */
/* ================================================================ */

function useQARateRender() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      visualizationId,
      rating,
      feedbackText,
      render,
    }: {
      visualizationId: string;
      rating: number;
      feedbackText?: string;
      render: QARender;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Must be logged in to rate");

      const heroUrl = pickHeroUrl(render) || "";

      let dnaId: string | null = null;
      const { data: existing } = await supabase
        .from("neuralnetwork_design_dna")
        .select("id")
        .eq("vehicle_render_url", heroUrl)
        .maybeSingle();

      if (existing?.id) {
        dnaId = existing.id;
      } else {
        const allUrls = render.render_urls
          ? Object.entries(render.render_urls).map(([type, url]) => ({ type, url }))
          : [];

        const { data: created } = await supabase
          .from("neuralnetwork_design_dna")
          .insert({
            creator_id: user.id,
            vehicle_year: String(render.vehicle_year),
            vehicle_make: render.vehicle_make,
            vehicle_model: render.vehicle_model,
            vehicle_render_url: heroUrl,
            all_render_urls: allUrls as Json,
            mode: render.mode_type || "unknown",
            source: "qa_studio",
          })
          .select("id")
          .single();

        dnaId = created?.id || null;
      }

      if (!dnaId) throw new Error("Failed to get or create design DNA record");

      const { data: existingFb } = await supabase
        .from("neuralnetwork_feedback")
        .select("id")
        .eq("design_dna_id", dnaId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (existingFb?.id) {
        const { error: updateErr } = await supabase
          .from("neuralnetwork_feedback")
          .update({
            rating,
            feedback_text: feedbackText || null,
            feedback_type: "admin",
          })
          .eq("id", existingFb.id);
        if (updateErr) throw updateErr;
      } else {
        const { error: insertErr } = await supabase
          .from("neuralnetwork_feedback")
          .insert({
            design_dna_id: dnaId,
            user_id: user.id,
            rating,
            feedback_text: feedbackText || null,
            feedback_type: "admin",
          });
        if (insertErr) throw insertErr;
      }

      if (rating <= 2) {
        await supabase.from("dev_agent_events").insert({
          event_type: "low_rating_pattern",
          severity: "warning",
          payload: {
            visualization_id: visualizationId,
            rating,
            vehicle: `${render.vehicle_year} ${render.vehicle_make} ${render.vehicle_model}`,
            tool: render.tool,
            design_name: render.design_name,
            source: "qa_studio",
          } as Json,
        });
      }

      return { dnaId, rating };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qa-studio-data"] });
      toast.success("Rating saved");
    },
    onError: (err: any) => {
      toast.error(`Failed to save rating: ${err.message}`);
    },
  });
}

/* ================================================================ */
/* Admin Notes Mutation (tags + error flags)                         */
/* ================================================================ */

function useQAUpdateAdminNotes() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      visualizationId,
      toggleTag,
      toggleErrorFlag,
      updates,
    }: {
      visualizationId: string;
      toggleTag?: string;
      toggleErrorFlag?: string;
      updates?: Record<string, unknown>;
    }) => {
      const { data: current, error: fetchErr } = await supabase
        .from("color_visualizations")
        .select("admin_notes")
        .eq("id", visualizationId)
        .single();

      if (fetchErr) throw fetchErr;

      let adminNotes: any = {};
      try {
        adminNotes = JSON.parse(current?.admin_notes || "{}");
      } catch { /* ignore */ }

      if (toggleTag) {
        const tags: string[] = adminNotes.tags || [];
        const idx = tags.indexOf(toggleTag);
        if (idx >= 0) tags.splice(idx, 1);
        else tags.push(toggleTag);
        adminNotes.tags = tags;
      }

      if (toggleErrorFlag) {
        const flags: string[] = adminNotes.error_flags || [];
        const idx = flags.indexOf(toggleErrorFlag);
        if (idx >= 0) flags.splice(idx, 1);
        else flags.push(toggleErrorFlag);
        adminNotes.error_flags = flags;
      }

      if (updates) Object.assign(adminNotes, updates);

      const { error: updateErr } = await supabase
        .from("color_visualizations")
        .update({ admin_notes: JSON.stringify(adminNotes) })
        .eq("id", visualizationId);

      if (updateErr) throw updateErr;
      return adminNotes;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qa-studio-data"] });
    },
    onError: (err: any) => {
      toast.error(`Update failed: ${err.message}`);
    },
  });
}

/* ================================================================ */
/* Revision Mutation                                                 */
/* ================================================================ */

function useQAReviseRender() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      visualizationId,
      revisedPrompt,
      render,
    }: {
      visualizationId: string;
      revisedPrompt: string;
      render: QARender;
    }) => {
      const session = await supabase.auth.getSession();
      const email = session.data.session?.user?.email;
      if (!email) throw new Error("Must be logged in");

      let renderUrl: string | null = null;
      const tool = render.tool || render.mode_type || "";
      const isDesignPro = tool === "designpro" || tool === "designpanelpro";

      const originalPrompt = render.original_prompt || render.design_name || "";

      // Get original render URL so the AI can see and modify the existing design
      const existingUrls = (render.render_urls || {}) as Record<string, string>;
      const originalRenderUrl = existingUrls.side || existingUrls.hero || existingUrls["driver-side"] || Object.values(existingUrls)[0] || null;

      // For revisions: send a short, focused revision prompt.
      // The original image is attached via originalRenderUrl so the AI can SEE the design.
      // Sending the full original prompt again causes the AI to regenerate from scratch.
      const revisionOnlyPrompt = `KEEP THE EXISTING DESIGN EXACTLY AS-IS. Only make this specific change: ${revisedPrompt}`;

      if (isDesignPro) {
        let mode: "commercial" | "restyle" = "restyle";
        let commercial: Record<string, unknown> = {};
        try {
          const notes = JSON.parse(render.admin_notes || "{}");
          if (notes.designiq_mode === "commercial") {
            mode = "commercial";
            commercial = {
              companyName: notes.company_name,
              phone: notes.phone,
              mascot: notes.mascot,
              industryType: notes.industry_type,
              bulletPoints: notes.brand_keywords,
            };
          }
        } catch {}

        const { data, error } = await supabase.functions.invoke("design-panel-ai-generate", {
          body: {
            mode,
            prompt: revisionOnlyPrompt,
            finish: render.finish_type,
            vehicleYear: String(render.vehicle_year),
            vehicleMake: render.vehicle_make,
            vehicleModel: render.vehicle_model,
            originalRenderUrl,
            panelUrl: render.panel_url || null,
            ...commercial,
          },
        });
        if (error) throw new Error(data?.message || data?.error || error.message);
        renderUrl = data?.renderUrl || data?.panel?.media_url || null;
      } else {
        const colorData: Record<string, unknown> = {
          colorName: render.color_name || render.design_name,
          hex: render.color_hex || "#000000",
          finish: render.finish_type,
        };

        if (tool === "approvemode" && render.panel_url) {
          colorData.colorLibrary = "approvemode";
          colorData.panelUrl = render.panel_url;
        }

        const { data, error } = await supabase.functions.invoke("generate-color-render", {
          body: {
            vehicleYear: String(render.vehicle_year),
            vehicleMake: render.vehicle_make,
            vehicleModel: render.vehicle_model,
            modeType: render.mode_type || tool,
            viewType: "side",
            userEmail: email,
            customStylingPrompt: revisionOnlyPrompt,
            colorData,
            originalRenderUrl,
          },
        });
        if (error) throw new Error(data?.message || data?.error || error.message);
        renderUrl = data?.renderUrl || null;
      }

      if (!renderUrl) throw new Error("No image returned from revision");

      // --- Build version history ---
      let parentNotes: any = {};
      try { parentNotes = JSON.parse(render.admin_notes || "{}"); } catch { /* ignore */ }

      // Determine version number from parent
      const parentVersion = parentNotes.version_number || 1;
      const newVersion = parentVersion + 1;

      // Preserve the TRUE original prompt (V1) - never overwrite it
      const trueOriginalPrompt = parentNotes.v1_original_prompt || originalPrompt;

      // Build full revision history chain
      const parentHistory = Array.isArray(parentNotes.revision_history) ? parentNotes.revision_history : [];
      const revisionHistory = [
        ...parentHistory,
        {
          version: newVersion,
          revision_prompt: revisedPrompt,
          parent_id: visualizationId,
          parent_version: parentVersion,
          created_at: new Date().toISOString(),
        },
      ];

      // Clone admin_notes with full history
      const cloneNotes: any = {
        ...parentNotes,
        v1_original_prompt: trueOriginalPrompt,
        revision_prompt: revisedPrompt,
        revision_history: revisionHistory,
        version_number: newVersion,
        parent_id: visualizationId,
        revised: true,
        revision_date: new Date().toISOString(),
      };

      // Version label: strip old (Vn) suffix, add new
      const baseName = (render.design_file_name || render.design_name || "Design")
        .replace(/\s*\(V\d+\)$/, "");

      const { error: insertError } = await supabase
        .from("color_visualizations")
        .insert({
          customer_email: render.customer_email,
          vehicle_year: render.vehicle_year,
          vehicle_make: render.vehicle_make,
          vehicle_model: render.vehicle_model,
          color_name: render.color_name,
          color_hex: render.color_hex,
          finish_type: render.finish_type,
          mode_type: render.mode_type,
          design_file_name: `${baseName} (V${newVersion})`,
          render_urls: { side: renderUrl } as unknown as Json,
          panel_url: render.panel_url,
          batch_id: render.batch_id,
          admin_notes: JSON.stringify(cloneNotes),
          custom_styling_prompt_key: trueOriginalPrompt,
        });

      if (insertError) {
        console.error("Clone insert failed, falling back to update:", insertError);
        await supabase
          .from("color_visualizations")
          .update({ render_urls: { ...existingUrls, side: renderUrl } as unknown as Json, admin_notes: JSON.stringify(cloneNotes) })
          .eq("id", visualizationId);
      }

      // Tag the original with its version number + has_revision flag
      if (!parentNotes.version_number) parentNotes.version_number = 1;
      parentNotes.has_revision = true;
      parentNotes.v1_original_prompt = trueOriginalPrompt;
      await supabase
        .from("color_visualizations")
        .update({ admin_notes: JSON.stringify(parentNotes) })
        .eq("id", visualizationId);

      return { renderUrl, version: newVersion };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qa-studio-data"] });
      toast.success("Revision cloned - original design preserved, new version created");
    },
    onError: (err: any) => {
      toast.error(`Revision failed: ${err.message}`);
    },
  });
}

/* ================================================================ */
/* Deploy to Gallery                                                 */
/* ================================================================ */

function useQADeployToGallery() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ render }: { render: QARender }) => {
      const tool = render.tool || render.mode_type || "colorpro";
      const carouselTable = CAROUSEL_TABLE_MAP[tool] || "inkfusion_carousel";

      const heroUrl =
        render.render_urls?.hero ||
        render.render_urls?.side ||
        (render.render_urls
          ? Object.values(render.render_urls).find((v) => typeof v === "string" && (v as string).startsWith("http"))
          : null);

      if (!heroUrl) throw new Error("No render image URL found to deploy");

      const vehicleName = `${render.vehicle_year} ${render.vehicle_make} ${render.vehicle_model}`;
      const title = render.design_name || render.color_name || "Batch Render";

      const insertData: Record<string, unknown> = {
        media_url: heroUrl,
        title,
        subtitle: `${render.finish_type || "Gloss"} \u2022 ${vehicleName}`,
        vehicle_name: vehicleName,
        is_active: true,
      };

      if (carouselTable === "inkfusion_carousel") {
        insertData.name = title;
        insertData.color_name = render.color_name;
      }
      if (carouselTable === "wbty_carousel") {
        insertData.pattern_name = render.design_name || render.color_name;
      }

      const { error } = await supabase.from(carouselTable as any).insert(insertData);
      if (error) throw error;

      let adminNotes: any = {};
      try { adminNotes = JSON.parse(render.admin_notes || "{}"); } catch { /* ignore */ }
      adminNotes.deployed_to_gallery = true;
      adminNotes.deployed_at = new Date().toISOString();
      adminNotes.deployed_table = carouselTable;

      await supabase
        .from("color_visualizations")
        .update({ admin_notes: JSON.stringify(adminNotes) })
        .eq("id", render.id);

      return { carouselTable };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qa-studio-data"] });
      queryClient.invalidateQueries({ queryKey: ["gallery-items"] });
      toast.success("Deployed to gallery!");
    },
    onError: (err: any) => {
      toast.error(`Deploy failed: ${err.message}`);
    },
  });
}

/* ================================================================ */
/* Main Page                                                         */
/* ================================================================ */

export default function AdminBatchQAStudio() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const initialBatch = searchParams.get("batch") || "all";

  const [batchFilter, setBatchFilter] = useState(initialBatch);
  const [toolFilter, setToolFilter] = useState("all");
  const [vehicleFilter, setVehicleFilter] = useState("all");
  const [ratingFilter, setRatingFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"date" | "rating" | "vehicle">("date");
  const [selectedRenderId, setSelectedRenderId] = useState<string | null>(null);

  const { data, isLoading } = useQAStudioData(batchFilter, toolFilter, vehicleFilter);
  const rateRender = useQARateRender();
  const reviseRender = useQAReviseRender();
  const deployToGallery = useQADeployToGallery();
  const updateAdminNotes = useQAUpdateAdminNotes();

  const allRenders = useMemo(() => data?.renders || [], [data?.renders]);
  const batches = useMemo(() => data?.batches || [], [data?.batches]);
  const vehicles = useMemo(() => data?.vehicles || [], [data?.vehicles]);

  // Apply client-side filters
  const filteredRenders = useMemo(() => {
    let result = allRenders;

    // Rating filter
    if (ratingFilter === "unrated") {
      result = result.filter((r) => r.my_rating === null);
    } else if (ratingFilter === "low") {
      result = result.filter((r) => r.my_rating !== null && r.my_rating <= 2);
    } else if (ratingFilter === "high") {
      result = result.filter((r) => r.my_rating !== null && r.my_rating >= 4);
    } else if (ratingFilter === "winners") {
      result = result.filter((r) => r.my_rating !== null && r.my_rating >= 3);
    }

    // Tag filter
    if (tagFilter !== "all") {
      result = result.filter((r) => r.tags.includes(tagFilter));
    }

    // Status filter
    if (statusFilter === "flagged") {
      result = result.filter((r) => r.error_flags.length > 0);
    } else if (statusFilter === "deployed") {
      result = result.filter((r) => r.deployed_to_gallery);
    } else if (statusFilter === "not_deployed") {
      result = result.filter((r) => !r.deployed_to_gallery);
    }

    // Sort
    if (sortBy === "rating") {
      result = [...result].sort((a, b) => (b.my_rating || 0) - (a.my_rating || 0));
    } else if (sortBy === "vehicle") {
      result = [...result].sort((a, b) =>
        `${a.vehicle_make} ${a.vehicle_model}`.localeCompare(`${b.vehicle_make} ${b.vehicle_model}`)
      );
    }

    return result;
  }, [allRenders, ratingFilter, tagFilter, statusFilter, sortBy]);

  const selectedRender = selectedRenderId ? filteredRenders.find((r) => r.id === selectedRenderId) || null : null;

  // Stats
  const totalRenders = filteredRenders.length;
  const ratedCount = filteredRenders.filter((r) => r.my_rating !== null).length;
  const avgRating = filteredRenders.filter((r) => r.my_rating).reduce((sum, r) => sum + (r.my_rating || 0), 0) / (ratedCount || 1);
  const winnerCount = filteredRenders.filter((r) => r.tags.includes("winner")).length;
  const issueCount = filteredRenders.filter((r) => r.error_flags.length > 0).length;
  const deployedCount = filteredRenders.filter((r) => r.deployed_to_gallery).length;

  const handleRate = useCallback((id: string, rating: number, feedback?: string) => {
    const render = allRenders.find((r) => r.id === id);
    if (!render) return;
    rateRender.mutate({ visualizationId: id, rating, feedbackText: feedback, render });
  }, [allRenders, rateRender]);

  const handleQuickRate = useCallback((id: string, rating: number) => {
    handleRate(id, rating);
  }, [handleRate]);

  const handleRevise = useCallback((id: string, prompt: string) => {
    const render = allRenders.find((r) => r.id === id);
    if (!render) return;
    reviseRender.mutate({ visualizationId: id, revisedPrompt: prompt, render });
  }, [allRenders, reviseRender]);

  const handleDeployToGallery = useCallback((render: QARender) => {
    deployToGallery.mutate({ render });
  }, [deployToGallery]);

  const handleTagToggle = useCallback((id: string, tag: RenderTag) => {
    const render = allRenders.find((r) => r.id === id);
    if (!render) return;
    const hasTag = render.tags.includes(tag);
    updateAdminNotes.mutate({ visualizationId: id, toggleTag: tag });
    toast.success(hasTag ? `Removed "${TAG_CONFIG[tag].label}" tag` : `Tagged as "${TAG_CONFIG[tag].label}"`);
  }, [allRenders, updateAdminNotes]);

  const handleErrorFlagToggle = useCallback((id: string, flag: string) => {
    updateAdminNotes.mutate({ visualizationId: id, toggleErrorFlag: flag });
  }, [updateAdminNotes]);

  const handleReRenderWithFix = useCallback((id: string) => {
    const render = allRenders.find((r) => r.id === id);
    if (!render) return;
    const flagLabels = render.error_flags
      .map((f) => ERROR_FLAGS.find((ef) => ef.key === f)?.label)
      .filter(Boolean);
    const fixPrompt = `${render.original_prompt}\n\nIMPORTANT FIXES REQUIRED:\n${flagLabels.map((l) => `- Fix: ${l}`).join("\n")}\n\nPlease correct these specific issues while maintaining the original design intent.`;
    reviseRender.mutate({ visualizationId: id, revisedPrompt: fixPrompt, render });
  }, [allRenders, reviseRender]);

  const handleTestVisionBoard = useCallback((render: QARender) => {
    const heroUrl = pickHeroUrl(render) || "";
    navigate(`/admin/bulk-design?ref=${encodeURIComponent(heroUrl)}&vehicle=${render.vehicle_year}+${render.vehicle_make}+${render.vehicle_model}`);
    toast.success("Opening VisionBoardIQ with winner as reference...");
  }, [navigate]);

  const handleTestMyVehiclePro = useCallback((render: QARender) => {
    const tool = render.tool || render.mode_type || "colorpro";
    const route = tool === "designpro" || tool === "designpanelpro" ? "/designpro" : `/${tool}`;
    navigate(`${route}?ref=${encodeURIComponent(pickHeroUrl(render) || "")}`);
    toast.success("Opening MyVehiclePro with winner design...");
  }, [navigate]);

  const handleAddToIsaDemo = useCallback((render: QARender) => {
    handleTagToggle(render.id, "isa_demo");
  }, [handleTagToggle]);

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="max-w-[1600px] mx-auto px-6 py-8 pt-24">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link to="/admin">
              <Button variant="ghost" size="sm" className="text-zinc-400 hover:text-white">
                <ArrowLeft className="w-4 h-4 mr-2" /> Admin
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-3">
                <Microscope className="w-6 h-6 text-blue-400" />
                Batch QA Studio
              </h1>
              <p className="text-zinc-400 text-sm">
                Curate &middot; Rate &middot; Flag &middot; Test winners &middot; Promote to production
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link to="/admin/batch-render">
              <Button variant="outline" size="sm" className="border-zinc-700 text-zinc-300 h-8 text-xs">
                Control Center
              </Button>
            </Link>
            <Link to="/admin/batch-results">
              <Button variant="outline" size="sm" className="border-zinc-700 text-zinc-300 h-8 text-xs">
                Batch Results
              </Button>
            </Link>
          </div>
        </div>

        {/* Stats Row */}
        {allRenders.length > 0 && (
          <div className="grid grid-cols-6 gap-3 mb-6">
            <Card className="bg-zinc-900 border-zinc-800 p-3">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Total</p>
              <p className="text-2xl font-bold text-white">{totalRenders}</p>
            </Card>
            <Card className="bg-zinc-900 border-zinc-800 p-3">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Rated</p>
              <p className="text-2xl font-bold text-blue-400">{ratedCount}/{totalRenders}</p>
              <Progress value={totalRenders > 0 ? (ratedCount / totalRenders) * 100 : 0} className="h-1 mt-1" />
            </Card>
            <Card className="bg-zinc-900 border-zinc-800 p-3">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Avg Rating</p>
              <div className="flex items-center gap-2">
                <p className="text-2xl font-bold text-yellow-400">
                  {ratedCount > 0 ? avgRating.toFixed(1) : "\u2014"}
                </p>
                {ratedCount > 0 && <Star className="w-5 h-5 fill-yellow-400 text-yellow-400" />}
              </div>
            </Card>
            <Card className="bg-zinc-900 border-zinc-800 p-3">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Winners</p>
              <div className="flex items-center gap-2">
                <p className="text-2xl font-bold text-green-400">{winnerCount}</p>
                <Trophy className="w-5 h-5 text-green-400" />
              </div>
            </Card>
            <Card className="bg-zinc-900 border-zinc-800 p-3">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Issues</p>
              <div className="flex items-center gap-2">
                <p className="text-2xl font-bold text-red-400">{issueCount}</p>
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
            </Card>
            <Card className="bg-zinc-900 border-zinc-800 p-3">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Deployed</p>
              <div className="flex items-center gap-2">
                <p className="text-2xl font-bold text-green-400">{deployedCount}</p>
                <ExternalLink className="w-5 h-5 text-green-400" />
              </div>
            </Card>
          </div>
        )}

        {/* Filter Bar */}
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <Filter className="w-4 h-4 text-zinc-500" />

          <Select value={batchFilter} onValueChange={setBatchFilter}>
            <SelectTrigger className="w-48 bg-zinc-900 border-zinc-700 text-white text-xs h-8">
              <SelectValue placeholder="Batch" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Batches</SelectItem>
              {batches.map((b) => (
                <SelectItem key={b} value={b}>{b.replace("batch_", "Batch ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={toolFilter} onValueChange={setToolFilter}>
            <SelectTrigger className="w-40 bg-zinc-900 border-zinc-700 text-white text-xs h-8">
              <SelectValue placeholder="Tool" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Tools</SelectItem>
              <SelectItem value="designpanelpro">DesignProAI</SelectItem>
              <SelectItem value="colorpro">ColorPro</SelectItem>
              <SelectItem value="fadewraps">FadeWraps</SelectItem>
              <SelectItem value="wbty">PatternPro</SelectItem>
              <SelectItem value="approvemode">ApprovePro</SelectItem>
            </SelectContent>
          </Select>

          <Select value={vehicleFilter} onValueChange={setVehicleFilter}>
            <SelectTrigger className="w-44 bg-zinc-900 border-zinc-700 text-white text-xs h-8">
              <SelectValue placeholder="Vehicle" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Vehicles</SelectItem>
              {vehicles.map((v) => (
                <SelectItem key={v} value={v}>{v.replace("|", " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={ratingFilter} onValueChange={setRatingFilter}>
            <SelectTrigger className="w-36 bg-zinc-900 border-zinc-700 text-white text-xs h-8">
              <SelectValue placeholder="Rating" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Ratings</SelectItem>
              <SelectItem value="unrated">Unrated</SelectItem>
              <SelectItem value="winners">Winners (3+)</SelectItem>
              <SelectItem value="high">High (4-5)</SelectItem>
              <SelectItem value="low">Low (1-2)</SelectItem>
            </SelectContent>
          </Select>

          <Select value={tagFilter} onValueChange={setTagFilter}>
            <SelectTrigger className="w-36 bg-zinc-900 border-zinc-700 text-white text-xs h-8">
              <SelectValue placeholder="Tag" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Tags</SelectItem>
              {(Object.keys(TAG_CONFIG) as RenderTag[]).map((tag) => (
                <SelectItem key={tag} value={tag}>{TAG_CONFIG[tag].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 bg-zinc-900 border-zinc-700 text-white text-xs h-8">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="flagged">Flagged Issues</SelectItem>
              <SelectItem value="deployed">Deployed</SelectItem>
              <SelectItem value="not_deployed">Not Deployed</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1 ml-auto">
            <ArrowUpDown className="w-3.5 h-3.5 text-zinc-500" />
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as "date" | "rating" | "vehicle")}>
              <SelectTrigger className="w-32 bg-zinc-900 border-zinc-700 text-white text-xs h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="date">Date</SelectItem>
                <SelectItem value="rating">Rating</SelectItem>
                <SelectItem value="vehicle">Vehicle</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <span className="text-xs text-zinc-500">
            {filteredRenders.length} render{filteredRenders.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <Skeleton key={i} className="aspect-[16/14] rounded-lg bg-zinc-800" />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && filteredRenders.length === 0 && (
          <Card className="bg-zinc-900 border-zinc-800 p-12 text-center">
            <Microscope className="w-16 h-16 mx-auto mb-4 text-zinc-700" />
            <h2 className="text-xl font-bold text-zinc-300 mb-2">
              {allRenders.length === 0 ? "No Batch Renders Found" : "No Renders Match Filters"}
            </h2>
            <p className="text-sm text-zinc-500 mb-6">
              {allRenders.length === 0
                ? "Run a batch pipeline first, then come back here to curate the results."
                : "Try adjusting your filters to see more results."
              }
            </p>
            {allRenders.length === 0 && (
              <Link to="/admin/batch-render">
                <Button className="bg-gradient-to-r from-blue-600 to-purple-600 hover:opacity-90">
                  Go to Batch Control Center
                </Button>
              </Link>
            )}
          </Card>
        )}

        {/* Grid View */}
        {!isLoading && filteredRenders.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {filteredRenders.map((render) => (
              <QAGridCard
                key={render.id}
                render={render}
                onClick={() => setSelectedRenderId(render.id)}
                onQuickRate={handleQuickRate}
              />
            ))}
          </div>
        )}

        {/* Detail Dialog */}
        <QADetailDialog
          render={selectedRender}
          open={!!selectedRenderId}
          onClose={() => setSelectedRenderId(null)}
          onRate={handleRate}
          onRevise={handleRevise}
          isRevising={reviseRender.isPending}
          onDeployToGallery={handleDeployToGallery}
          isDeploying={deployToGallery.isPending}
          onTagToggle={handleTagToggle}
          onErrorFlagToggle={handleErrorFlagToggle}
          onReRenderWithFix={handleReRenderWithFix}
          isReRendering={reviseRender.isPending}
          onTestVisionBoard={handleTestVisionBoard}
          onTestMyVehiclePro={handleTestMyVehiclePro}
          onAddToIsaDemo={handleAddToIsaDemo}
        />

        {/* Navigation */}
        <div className="mt-8 flex justify-between">
          <Link to="/admin">
            <Button variant="outline" className="border-zinc-700 text-zinc-300">
              Back to Admin
            </Button>
          </Link>
          <div className="flex gap-2">
            <Link to="/admin/batch-render">
              <Button variant="outline" className="border-zinc-700 text-zinc-300">
                Batch Control Center
              </Button>
            </Link>
            <Link to="/admin/batch-results">
              <Button variant="outline" className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10">
                QA &amp; Curation Studio
              </Button>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
