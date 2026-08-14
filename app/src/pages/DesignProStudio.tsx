import { useState, useRef, useCallback, useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { cn } from "@/lib/utils";
import { useDesignCanvas } from "@/components/designpanelpro/canvas/useDesignCanvas";
import { LayerCanvasEditor } from "@/components/designpanelpro/canvas/LayerCanvasEditor";
import {
  MousePointer2,
  Move,
  Maximize2,
  RotateCw,
  AlignCenterHorizontal,
  Layers as LayersIcon,
  Copy,
  Trash2,
  Eye,
  Undo2,
  Redo2,
  Upload,
  Type,
  Sparkles,
  Image as ImageIcon,
  Save,
  Share2,
  Download,
  Lock,
  HelpCircle,
  Settings,
  ChevronDown,
  Plus,
  GripVertical,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";

/**
 * DesignPro Studio — branded, Canva/Photoshop-style three-column editor shell.
 *
 * Layout mirrors the approved WrapStudio mockup, reskinned to DesignProAI
 * branding (black chrome, blue→magenta accent gradient, Poppins/Oswald/Inter):
 *   • LEFT  — collapsible tool rail (Design / Upload / Text / Logo / Adjust / Layers)
 *   • CENTER — large vehicle design canvas + multi-view thumbnails
 *   • RIGHT  — Active/Inactive layer panels with AI "revise" prompts + stack
 *
 * Intuitive "focus mode": the moment the user starts designing (picks a design
 * action on the canvas toolbar or begins editing on the stage) the LEFT and
 * RIGHT rails automatically collapse so the canvas gets maximum room — exactly
 * like the reference editor. Both rails can also be toggled manually, and the
 * collapsed state is remembered. Selecting the "Design" tool again, or tapping
 * an item in a collapsed rail, brings the rails back.
 *
 * The Konva editing engine (LayerCanvasEditor / useDesignCanvas) lives on the
 * DesignPro Studio branch; this page is the production-branded UI shell that
 * engine will mount into once the branches converge. State here is local so
 * the shell is fully interactive (selectable tools, view switching, layer
 * visibility, prompt fields) for design review.
 */

// ── Left tool rail items ───────────────────────────────────────────────
// Only tools backed by the real editor engine (Carley's canvas/useDesignCanvas
// + DesignPanelProToolUI). No invented Canva-style tools.
//   Upload / Add Text / Add Logo → addImageLayer / addTextLayer
//   Adjust                       → per-layer brightness/contrast/saturation/blur
//   Layers                       → the layer stack
const TOOL_ITEMS = [
  { id: "design", label: "Design", icon: LayersIcon },
  { id: "upload", label: "Upload", icon: Upload },
  { id: "text", label: "Add Text", icon: Type },
  { id: "logo", label: "Add Logo", icon: ImageIcon },
  { id: "adjust", label: "Adjust", icon: Sparkles },
  { id: "layers", label: "Layers", icon: LayersIcon },
] as const;

// ── Top canvas toolbar actions ─────────────────────────────────────────
const TOOLBAR_ACTIONS = [
  { id: "move", label: "Move", icon: Move },
  { id: "scale", label: "Scale", icon: Maximize2 },
  { id: "rotate", label: "Rotate", icon: RotateCw },
  { id: "align", label: "Align", icon: AlignCenterHorizontal },
  { id: "arrange", label: "Arrange", icon: LayersIcon },
  { id: "duplicate", label: "Duplicate", icon: Copy },
  { id: "delete", label: "Delete", icon: Trash2 },
] as const;

// ── Vehicle view tabs ──────────────────────────────────────────────────
// Canonical 7 views in LOCKED PRODUCTION ORDER — ids + labels mirror
// supabase/functions/_shared/view-angles-os.ts (VIEW_ORDER / VIEW_LABELS).
// Driver Side ('side') is the primary panel the customer approves first.
const VIEWS = [
  { id: "side", label: "Driver Side" },
  { id: "passenger-side", label: "Passenger Side" },
  { id: "hood_detail", label: "Hood" },
  { id: "front", label: "Front" },
  { id: "rear", label: "Rear" },
  { id: "close-up", label: "Close-Up" },
  { id: "roof", label: "Roof" },
] as const;

type ToolId = (typeof TOOL_ITEMS)[number]["id"];
type ViewId = (typeof VIEWS)[number]["id"];

/**
 * Trademark superscript — matches the ™ treatment used in Header.tsx
 * (muted, superscripted). Use on the FIRST prominent appearance of each mark:
 * DesignProAI™, DesignProAI™, DesignIQ™, LiftIQ™, VisionBoardIQ™,
 * RevisionStudioIQ™, GENIE™. See docs/TRADEMARKS.md.
 */
const Tm = () => <span className="align-super text-[0.6em] opacity-60">&#8482;</span>;

interface LayerRow {
  id: string;
  kind: "text" | "background";
  label: string;
  visible: boolean;
  locked: boolean;
}

export default function DesignProStudio() {
  const [activeTool, setActiveTool] = useState<ToolId>("design");
  const [activeView, setActiveView] = useState<ViewId>("side");
  const [activeLayerId, setActiveLayerId] = useState("text-logo");
  const [textPrompt, setTextPrompt] = useState("");
  const [bgPrompt, setBgPrompt] = useState("");
  const [zoom, setZoom] = useState(100);
  const [liftActive, setLiftActive] = useState(false);
  const [layers, setLayers] = useState<LayerRow[]>([
    { id: "text-logo", kind: "text", label: "Text & Logo Layer", visible: true, locked: false },
    { id: "background", kind: "background", label: "Background Layer", visible: true, locked: true },
  ]);
  const uploadRef = useRef<HTMLInputElement>(null);

  // ── Live editing engine (Carley's Konva canvas) — the real editor that
  // mounts into the canvas stage. The 3-column shell drives it via this hook.
  const studio = useDesignCanvas();

  // Upload → add an image layer the user can move/scale/rotate. Reads the
  // file as a data URL and measures it before handing to the engine.
  const handleUpload = useCallback((file: File | undefined | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      const img = new Image();
      img.onload = () => {
        studio.addImageLayer(src, img.naturalWidth, img.naturalHeight, file.name.replace(/\.[^.]+$/, ""));
        enterDesignModeRef.current?.();
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  }, [studio]);

  // forward-ref so handleUpload can trigger focus mode (defined below)
  const enterDesignModeRef = useRef<(() => void) | null>(null);

  // ── Focus mode: rails collapse while designing ────────────────────────
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  // Tracks whether the auto-collapse has already fired for this design session
  // so we don't fight the user if they manually re-open a rail.
  const autoCollapsedRef = useRef(false);

  // Entering "design mode" = the user has begun working on the canvas.
  // Auto-collapse both rails ONCE to hand the canvas maximum room.
  const enterDesignMode = useCallback(() => {
    if (autoCollapsedRef.current) return;
    autoCollapsedRef.current = true;
    setLeftCollapsed(true);
    setRightCollapsed(true);
  }, []);
  enterDesignModeRef.current = enterDesignMode;

  // Picking "Design" expands the rails back so the full toolset is visible;
  // any other tool keeps the focused canvas.
  const handleToolSelect = useCallback(
    (id: ToolId) => {
      setActiveTool(id);
      if (id === "design") {
        autoCollapsedRef.current = false;
        setLeftCollapsed(false);
        setRightCollapsed(false);
        return;
      }
      // Wire the rail tools to the live engine.
      if (id === "text") {
        studio.addTextLayer("Your text");
      } else if (id === "upload" || id === "logo") {
        uploadRef.current?.click();
      }
      enterDesignMode();
    },
    [enterDesignMode, studio],
  );

  const toggleLayerVisible = useCallback((id: string) => {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)));
  }, []);

  // Keyboard: Tab toggles focus mode (both rails) like pro editors.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) return;
      if (e.key === "Tab") {
        e.preventDefault();
        const next = !(leftCollapsed && rightCollapsed);
        setLeftCollapsed(next);
        setRightCollapsed(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leftCollapsed, rightCollapsed]);

  const activeLayer = layers.find((l) => l.id === activeLayerId) ?? layers[0];

  return (
    <div className="min-h-[100dvh] bg-black text-white" style={{ fontFamily: "Inter, sans-serif" }}>
      <Helmet>
        <title>DesignProAI™ Studio — Vehicle Wrap Design Editor | DesignProAI™</title>
        <meta
          name="description"
          content="DesignProAI™ Studio — a layer-based vehicle wrap design editor powered by DesignIQ™. Design, place text and logos with LiftIQ™, and export print-ready panels via the GENIE™ Universal Panelizer."
        />
      </Helmet>

      {/* ── Studio top bar (BLACK chrome — header contrast standard) ──── */}
      <div className="flex items-center justify-between border-b border-white/10 bg-black px-4 h-14">
        <div className="flex items-center gap-3 min-w-0">
          {/* Exact DesignProAI™ logo + wordmark (matches Header.tsx) */}
          <a href="/" className="flex items-center gap-0.5 shrink-0">
            <img
              src="/sproket-rocket-logo.png"
              alt="Sproket"
              className="h-9 w-auto object-contain -mr-1"
            />
            <span className="text-lg font-bold tracking-tight leading-none">
              <span className="text-white">Design</span>
              <span className="bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent">Pro</span>
              <span className="bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">AI</span>
              <span className="text-zinc-400 text-[10px] align-super ml-0.5">&#8482;</span>
            </span>
          </a>
          <span className="w-px h-6 bg-white/15 shrink-0" />
          {/* Tool title — DesignPro prominent (white "Design" + gradient "Pro" + AI™) */}
          <span className="font-bold text-base shrink-0 tracking-tight" style={{ fontFamily: "Poppins, sans-serif" }}>
            <span className="text-white">Design</span>
            <span className="bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent">Pro</span>
            <span className="bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">AI</span>
            <span className="text-zinc-400 text-[10px] align-super">&#8482;</span>
            <span className="text-white/45 font-medium text-sm"> Studio</span>
          </span>
          {/* LiftIQ™ hero badge — highlights the signature trademarked tool;
              also toggles the lift interaction so the badge is functional. */}
          <button
            onClick={() => {
              setLiftActive((v) => !v);
              enterDesignMode();
            }}
            title="LiftIQ™ — grab & move anything, or tap an item to change it"
            className={cn(
              "shrink-0 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs font-semibold transition-all",
              liftActive
                ? "bg-gradient-blue-magenta text-white shadow-[0_0_0_1px_rgba(255,255,255,0.15)]"
                : "text-white ring-1 ring-inset ring-white/20 hover:bg-white/10 bg-white/[0.04]",
            )}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>
              LiftIQ<span className="align-super text-[0.6em] opacity-70">&#8482;</span>
            </span>
          </button>
          <div className="hidden lg:flex items-center gap-2 text-sm text-white/55 min-w-0">
            <span className="truncate">· Untitled design</span>
            <button className="text-white/40 hover:text-white shrink-0" aria-label="Rename design">
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="p-2 rounded-md hover:bg-white/10 text-white/70" aria-label="Undo">
            <Undo2 className="w-4 h-4" />
          </button>
          <button className="p-2 rounded-md hover:bg-white/10 text-white/70" aria-label="Redo">
            <Redo2 className="w-4 h-4" />
          </button>
          <div className="w-px h-6 bg-white/10 mx-1" />
          <button className="px-3 h-9 rounded-md border border-white/15 text-sm font-medium hover:bg-white/10 flex items-center gap-1.5">
            <Save className="w-4 h-4" /> <span className="hidden sm:inline">Save</span>
          </button>
          <button className="px-3 h-9 rounded-md border border-white/15 text-sm font-medium hover:bg-white/10 flex items-center gap-1.5">
            <Share2 className="w-4 h-4" /> <span className="hidden sm:inline">Share</span>
          </button>
          <button
            title="Export print-ready panels via the GENIE™ Universal Panelizer"
            className="px-4 h-9 rounded-md btn-designiq text-white text-sm font-semibold flex items-center gap-1.5"
          >
            <Download className="w-4 h-4" /> Export <span className="hidden lg:inline text-white/80 font-normal">· GENIE<Tm /></span>
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Three-column body ──────────────────────────────────────── */}
      <div className="flex h-[calc(100dvh-3.5rem)]">
        {/* LEFT — tool rail (collapses to a thin icon strip in focus mode) */}
        <aside
          className={cn(
            "shrink-0 border-r border-white/10 bg-black flex flex-col items-center py-3 gap-1 overflow-y-auto overflow-x-hidden transition-[width] duration-300 ease-in-out",
            leftCollapsed ? "w-[52px]" : "w-[88px]",
          )}
        >
          {TOOL_ITEMS.map((tool) => {
            const Icon = tool.icon;
            const active = activeTool === tool.id;
            return (
              <button
                key={tool.id}
                onClick={() => handleToolSelect(tool.id)}
                title={tool.label}
                className={cn(
                  "flex flex-col items-center gap-1 py-2.5 rounded-lg text-[11px] font-medium transition-colors",
                  leftCollapsed ? "w-[40px]" : "w-[72px]",
                  active ? "bg-white/10 text-white" : "text-white/55 hover:text-white hover:bg-white/5",
                )}
              >
                <span
                  className={cn(
                    "w-8 h-8 rounded-md flex items-center justify-center",
                    active && "bg-gradient-blue-magenta",
                  )}
                >
                  <Icon className="w-4 h-4" />
                </span>
                {!leftCollapsed && tool.label}
              </button>
            );
          })}
          <div className="mt-auto flex flex-col items-center gap-1 pt-3 border-t border-white/10 w-full">
            {!leftCollapsed && (
              <>
                <button className="w-[72px] flex flex-col items-center gap-1 py-2.5 rounded-lg text-[11px] text-white/55 hover:text-white hover:bg-white/5">
                  <HelpCircle className="w-4 h-4" /> Help
                </button>
                <button className="w-[72px] flex flex-col items-center gap-1 py-2.5 rounded-lg text-[11px] text-white/55 hover:text-white hover:bg-white/5">
                  <Settings className="w-4 h-4" /> Settings
                </button>
              </>
            )}
            <button
              onClick={() => setLeftCollapsed((c) => !c)}
              title={leftCollapsed ? "Expand tools" : "Collapse tools"}
              aria-label={leftCollapsed ? "Expand tool rail" : "Collapse tool rail"}
              className="w-[40px] h-9 flex items-center justify-center rounded-lg text-white/45 hover:text-white hover:bg-white/10"
            >
              {leftCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
            </button>
          </div>
        </aside>

        {/* CENTER — canvas (grows to fill freed space) */}
        <main className="flex-1 min-w-0 flex flex-col bg-[#0a0a0a]">
          {/* Canvas toolbar */}
          <div className="flex items-center gap-1 border-b border-white/10 bg-black/60 px-3 h-12 overflow-x-auto">
            {/* Left rail re-open shortcut, visible only when collapsed */}
            {leftCollapsed && (
              <button
                onClick={() => setLeftCollapsed(false)}
                title="Show tools"
                aria-label="Show tools"
                className="p-2 rounded-md text-white/60 hover:text-white hover:bg-white/10 shrink-0"
              >
                <PanelLeftOpen className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={enterDesignMode}
              className="px-3 h-8 rounded-md bg-gradient-blue-magenta text-white text-sm font-medium flex items-center gap-1.5 shrink-0"
            >
              <MousePointer2 className="w-4 h-4" /> Select
            </button>
            {/* LiftIQ™ — one-tap reveal of text/logo objects (per customer-flow spec) */}
            <button
              onClick={() => {
                setLiftActive((v) => !v);
                enterDesignMode();
              }}
              title="LiftIQ™ — grab & move anything, or tap an item to change it"
              className={cn(
                "px-3 h-8 rounded-md text-sm font-semibold flex items-center gap-1.5 shrink-0 transition-colors",
                liftActive
                  ? "bg-gradient-blue-magenta text-white"
                  : "border border-white/15 text-white/80 hover:bg-white/10",
              )}
            >
              <Sparkles className="w-4 h-4" /> Tap LiftIQ<Tm />
            </button>
            <div className="w-px h-6 bg-white/10 mx-1 shrink-0" />
            {TOOLBAR_ACTIONS.map((a) => {
              const Icon = a.icon;
              return (
                <button
                  key={a.id}
                  onClick={enterDesignMode}
                  className="px-2.5 h-8 rounded-md text-white/65 hover:text-white hover:bg-white/10 text-xs font-medium flex flex-col items-center justify-center gap-0.5 shrink-0 min-w-[52px]"
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-[10px]">{a.label}</span>
                </button>
              );
            })}
            <div className="ml-auto flex items-center gap-2 shrink-0 pl-2">
              <button className="px-3 h-8 rounded-md border border-white/15 text-sm hover:bg-white/10 flex items-center gap-1.5">
                <Eye className="w-4 h-4" /> Preview
              </button>
              <button className="px-3 h-8 rounded-md border border-white/15 text-sm hover:bg-white/10 flex items-center gap-1.5">
                Fit <ChevronDown className="w-3.5 h-3.5" />
              </button>
              {/* Right rail re-open shortcut, visible only when collapsed */}
              {rightCollapsed && (
                <button
                  onClick={() => setRightCollapsed(false)}
                  title="Show layers"
                  aria-label="Show layers"
                  className="p-2 rounded-md text-white/60 hover:text-white hover:bg-white/10"
                >
                  <PanelRightOpen className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Canvas stage */}
          <div
            className="flex-1 relative overflow-hidden flex items-center justify-center p-6"
            onMouseDown={enterDesignMode}
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.04),transparent_70%)]" />
            <div className="relative w-full max-w-5xl aspect-video rounded-xl border border-white/10 bg-[#141414] flex items-center justify-center overflow-hidden shadow-2xl transition-all duration-300">
              {/* Live Konva editor (Carley's engine) — real, interactive canvas */}
              {studio.doc.layers.length > 0 ? (
                <LayerCanvasEditor
                  doc={studio.doc}
                  selectedId={studio.selectedId}
                  onSelect={studio.setSelectedId}
                  onChangeLayer={studio.updateLayer}
                  highlightOverlays={liftActive}
                />
              ) : (
                <div className="text-center px-6">
                  <div className="w-14 h-14 mx-auto rounded-xl bg-gradient-blue-magenta flex items-center justify-center mb-3">
                    <LayersIcon className="w-7 h-7 text-white" />
                  </div>
                  <p className="text-white/70 text-sm font-medium">Vehicle design canvas</p>
                  <p className="text-white/40 text-xs mt-1">
                    {VIEWS.find((v) => v.id === activeView)?.label} · DesignIQ<Tm /> editor
                  </p>
                  <button
                    onClick={() => { studio.addTextLayer("Your text"); enterDesignMode(); }}
                    className="mt-3 px-3 h-9 rounded-lg btn-designiq text-white text-sm font-semibold inline-flex items-center gap-2"
                  >
                    <Type className="w-4 h-4" /> Add your first element
                  </button>
                  {liftActive && (
                    <p className="text-white/40 text-[11px] mt-3">
                      LiftIQ<Tm /> active — grab &amp; move anything, or tap an item to change it
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Zoom controls */}
            <div className="absolute bottom-5 left-5 flex items-center gap-2 bg-black/70 border border-white/10 rounded-lg px-2 h-9">
              <button
                onClick={() => setZoom((z) => Math.max(25, z - 25))}
                className="text-white/70 hover:text-white px-1"
                aria-label="Zoom out"
              >
                −
              </button>
              <span className="text-xs text-white/70 w-10 text-center">{zoom}%</span>
              <button
                onClick={() => setZoom((z) => Math.min(400, z + 25))}
                className="text-white/70 hover:text-white px-1"
                aria-label="Zoom in"
              >
                +
              </button>
              <button className="text-white/70 hover:text-white px-1 ml-1" aria-label="Fit to screen">
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Multi-view thumbnails */}
          <div className="border-t border-white/10 bg-black/60 px-3 py-2.5 flex items-center gap-2 overflow-x-auto">
            <button className="shrink-0 w-20 h-16 rounded-lg border border-dashed border-white/20 text-white/50 hover:text-white hover:border-white/40 flex flex-col items-center justify-center gap-1 text-[11px]">
              <Plus className="w-4 h-4" /> Add View
            </button>
            {VIEWS.map((v) => {
              const active = activeView === v.id;
              return (
                <button
                  key={v.id}
                  onClick={() => setActiveView(v.id)}
                  className={cn(
                    "shrink-0 flex flex-col items-center gap-1 text-[11px]",
                    active ? "text-white" : "text-white/50 hover:text-white",
                  )}
                >
                  <span
                    className={cn(
                      "w-20 h-16 rounded-lg border bg-[#141414] flex items-center justify-center overflow-hidden",
                      active ? "border-transparent ring-2 ring-[#3b82f6]" : "border-white/15",
                    )}
                  >
                    <ImageIcon className="w-5 h-5 text-white/30" />
                  </span>
                  {v.label}
                </button>
              );
            })}
          </div>
        </main>

        {/* RIGHT — layer + AI revise panel (slides away in focus mode) */}
        <aside
          className={cn(
            "shrink-0 border-l border-white/10 bg-black flex flex-col overflow-y-auto transition-[width] duration-300 ease-in-out",
            rightCollapsed ? "w-0 border-l-0 overflow-hidden" : "w-[340px]",
          )}
        >
          {/* Collapse handle */}
          <div className="flex items-center justify-between px-4 h-11 border-b border-white/10 shrink-0">
            <span className="text-xs font-semibold uppercase tracking-wide text-white/50">
              RevisionStudioIQ<Tm />
            </span>
            <button
              onClick={() => setRightCollapsed(true)}
              title="Hide panel"
              aria-label="Collapse layer panel"
              className="p-1.5 rounded-md text-white/45 hover:text-white hover:bg-white/10"
            >
              <PanelRightClose className="w-4 h-4" />
            </button>
          </div>

          {/* Active layer */}
          <div className="p-4 border-b border-white/10">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-white/50">Active Layer</span>
              <span className="px-2.5 py-1 rounded-md bg-gradient-blue-magenta text-white text-xs font-semibold">
                {activeLayer.label}
              </span>
            </div>
            <button className="flex items-center gap-1.5 text-xs text-white/60 hover:text-white mb-3">
              <Lock className="w-3.5 h-3.5" /> Lock Layer
            </button>
            <p className="text-xs text-white/50 mb-2">Select objects and revise</p>
            <textarea
              value={textPrompt}
              onChange={(e) => setTextPrompt(e.target.value)}
              maxLength={1000}
              placeholder={"make text look 3D…\nchange colors of logo to red & white…\nmake text have a metal gradient…"}
              className="w-full h-28 rounded-lg bg-[#141414] border border-white/10 p-3 text-sm text-white placeholder:text-white/30 resize-none focus:outline-none focus:border-[#3b82f6]"
            />
            <div className="text-right text-[11px] text-white/30 mt-1">{textPrompt.length}/1000</div>
            <button
              onClick={() => uploadRef.current?.click()}
              className="w-full mt-2 h-10 rounded-lg border border-white/15 text-sm font-medium hover:bg-white/10 flex items-center justify-center gap-2"
            >
              <Upload className="w-4 h-4" /> Upload to VisionBoardIQ<Tm />
            </button>
            <input
              ref={uploadRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { handleUpload(e.target.files?.[0]); e.currentTarget.value = ""; }}
            />
            <button className="w-full mt-2 h-11 rounded-lg btn-designiq text-white text-sm font-semibold flex items-center justify-center gap-2">
              <Sparkles className="w-4 h-4" /> Revise with DesignIQ<Tm />
            </button>
          </div>

          {/* Inactive (background) layer */}
          <div className="p-4 border-b border-white/10">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-white/50">Inactive Layer</span>
              <span className="px-2.5 py-1 rounded-md bg-white/10 text-white/70 text-xs font-semibold">
                Background Layer
              </span>
            </div>
            <button className="flex items-center gap-1.5 text-xs text-white/60 hover:text-white mb-3">
              <Lock className="w-3.5 h-3.5" /> Lock Layer
            </button>
            <p className="text-xs text-white/50 mb-2">Revise background</p>
            <textarea
              value={bgPrompt}
              onChange={(e) => setBgPrompt(e.target.value)}
              maxLength={1000}
              placeholder={"change background color too…\nadjust the fade position…\nmake more like attached image…"}
              className="w-full h-24 rounded-lg bg-[#141414] border border-white/10 p-3 text-sm text-white placeholder:text-white/30 resize-none focus:outline-none focus:border-[#3b82f6]"
            />
            <div className="text-right text-[11px] text-white/30 mt-1">{bgPrompt.length}/1000</div>
            <button className="w-full mt-2 h-10 rounded-lg border border-white/15 text-sm font-medium hover:bg-white/10 flex items-center justify-center gap-2">
              <Upload className="w-4 h-4" /> Upload to VisionBoardIQ<Tm />
            </button>
            <button className="w-full mt-2 h-11 rounded-lg btn-designiq text-white text-sm font-semibold flex items-center justify-center gap-2">
              <Sparkles className="w-4 h-4" /> Revise with DesignIQ<Tm />
            </button>
          </div>

          {/* Layer stack */}
          <div className="p-4">
            <span className="text-xs font-semibold uppercase tracking-wide text-white/50">Layers</span>
            <div className="mt-3 space-y-1.5">
              {layers.map((layer) => {
                const active = activeLayerId === layer.id;
                return (
                  <button
                    key={layer.id}
                    onClick={() => setActiveLayerId(layer.id)}
                    className={cn(
                      "w-full flex items-center gap-2 px-2.5 h-11 rounded-lg text-sm transition-colors",
                      active ? "bg-gradient-blue-magenta text-white" : "bg-[#141414] text-white/70 hover:bg-white/10",
                    )}
                  >
                    <GripVertical className="w-3.5 h-3.5 opacity-50 shrink-0" />
                    {layer.kind === "text" ? (
                      <Type className="w-4 h-4 shrink-0" />
                    ) : (
                      <ImageIcon className="w-4 h-4 shrink-0" />
                    )}
                    <span className="truncate flex-1 text-left">{layer.label}</span>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleLayerVisible(layer.id);
                      }}
                      className="p-1 opacity-70 hover:opacity-100 shrink-0"
                      aria-label="Toggle visibility"
                    >
                      <Eye className={cn("w-3.5 h-3.5", !layer.visible && "opacity-30")} />
                    </span>
                    {layer.locked && <Lock className="w-3.5 h-3.5 opacity-70 shrink-0" />}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-white/30 mt-3">Only the active layer can be edited</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
