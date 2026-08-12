// AdminComposer — the guided Content Composer (/admin/composer)
//
// "Go hunt" → "it's assembled, swap what you don't like": pick BRAND →
// FORMAT → DESTINATION and the system assembles 3 candidate posts on LIVE
// Konva canvases — template from the brand's library (wrap-files/
// canva-templates/{brand}/{type}), a hook from the Hooks Library
// (content_hooks, brand+platform filtered), AI copy (content-studio-ai-copy)
// and media matched from the Asset Library (agent_media_assets by brand +
// type). Every element is draggable right on the card; deeper refinement
// saves the canvas as a content_studio_works draft that opens in Content
// Studio (My Works) — same canvas_state contract, no second editor.
// Deploy renders the canvas to PNG and drops it into the Content Director
// queue (agent_social_posts, needs_review) like everything else.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Stage, Layer, Rect, Text as KText, Image as KImage } from "react-konva";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, Sparkles, RefreshCw, PencilRuler, Send } from "lucide-react";
import { brandMeta } from "@/lib/content-tags";
import MarketingSuiteGuide from "@/components/admin/MarketingSuiteGuide";

// Content Studio's brand naming (template folders + AI copy brand param)
const BRANDS: { cs: string; slug: string; label: string }[] = [
  { cs: "DesignProAI", slug: "designproai", label: "DesignProAI" },
  { cs: "WePrintWraps", slug: "weprintwraps", label: "WePrintWraps" },
  { cs: "RestyleProAI", slug: "restylepro", label: "RestyleProAI" },
  { cs: "WrapTV", slug: "wraptvworld", label: "WrapTVWorld" },
  { cs: "InkAndEdge", slug: "inkandedge", label: "Ink & Edge" },
];

// Formats — canvas dims + which template folder(s) to pull from
const FORMATS: { id: string; label: string; w: number; h: number; folders: string[]; media: "video" | "image" }[] = [
  { id: "reel", label: "Reel 9:16", w: 1080, h: 1920, folders: ["static-9x16"], media: "video" },
  { id: "static-1x1", label: "Static 1:1", w: 1080, h: 1080, folders: ["static-1x1"], media: "image" },
  { id: "static-4x5", label: "Static 4:5", w: 1080, h: 1350, folders: ["static-4x5"], media: "image" },
  { id: "carousel", label: "Carousel", w: 1080, h: 1350, folders: ["carousel", "static-4x5"], media: "image" },
  { id: "us-vs-them", label: "Us vs Them", w: 1080, h: 1350, folders: ["us-vs-them", "static-4x5"], media: "image" },
  { id: "grid", label: "Grid tile", w: 1080, h: 1080, folders: ["grid", "static-1x1"], media: "image" },
  { id: "editorial", label: "Editorial", w: 1200, h: 675, folders: ["editorial", "static-1x1"], media: "image" },
  { id: "google-ad", label: "Google ad", w: 1200, h: 628, folders: ["google-ad", "static-1x1"], media: "image" },
  { id: "newsletter", label: "Newsletter", w: 1200, h: 675, folders: ["newsletter", "static-1x1"], media: "image" },
];

const DESTINATIONS: { id: string; label: string }[] = [
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "x", label: "X" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "google", label: "Google" },
  { id: "substack", label: "Substack" },
];

// us-vs-them is ALSO a hook family in the Hooks Library — the format
// preselects the matching hook_type so copy and layout agree.
const FORMAT_HOOK_TYPE: Record<string, string> = { "us-vs-them": "us_vs_them" };

interface ComposerElement {
  id: string;
  type: "rect" | "text" | "image";
  x: number; y: number; width: number; height: number;
  fill?: string; opacity?: number; cornerRadius?: number;
  text?: string; fontFamily?: string; fontStyle?: string; align?: string;
  fontSize?: number;
  imageSrc?: string;
}

interface Candidate {
  templateUrl: string | null;
  mediaUrl: string | null;
  hookText: string;
  elements: ComposerElement[];
}

function useImg(src?: string | null): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) { setImg(null); return; }
    const im = new window.Image();
    im.crossOrigin = "anonymous";
    im.onload = () => setImg(im);
    im.onerror = () => setImg(null);
    im.src = src;
  }, [src]);
  return img;
}

const shuffle = <T,>(a: T[]) => [...a].sort(() => Math.random() - 0.5);

function buildElements(fmt: (typeof FORMATS)[number], hook: string, copy: { headline?: string; body?: string; cta?: string }, mediaUrl: string | null, hasTemplate: boolean): ComposerElement[] {
  const { w, h } = fmt;
  const els: ComposerElement[] = [];
  // Media sits under the type; on a template it becomes an inset card so the
  // template's own art still reads.
  if (mediaUrl) {
    els.push(hasTemplate
      ? { id: "media", type: "image", x: w * 0.08, y: h * 0.3, width: w * 0.84, height: h * 0.38, imageSrc: mediaUrl, cornerRadius: 24 }
      : { id: "media", type: "image", x: 0, y: 0, width: w, height: h, imageSrc: mediaUrl });
  }
  els.push(
    { id: "hook", type: "text", x: w * 0.06, y: h * 0.06, width: w * 0.88, height: h * 0.2, text: hook, fontSize: Math.round(w / 14), fontFamily: "Oswald", fontStyle: "bold", align: "left", fill: "#ffffff" },
    { id: "headline", type: "text", x: w * 0.06, y: h * 0.72, width: w * 0.88, height: h * 0.1, text: copy.headline || "", fontSize: Math.round(w / 24), fontFamily: "Inter", fontStyle: "bold", align: "left", fill: "#ffffff" },
    { id: "cta", type: "text", x: w * 0.06, y: h * 0.88, width: w * 0.6, height: h * 0.07, text: copy.cta || "", fontSize: Math.round(w / 30), fontFamily: "Inter", fontStyle: "bold", align: "left", fill: "#00C7FF" },
  );
  return els;
}

function CandidateCanvas({ fmt, cand, onChange, stageRef }: {
  fmt: (typeof FORMATS)[number];
  cand: Candidate;
  onChange: (els: ComposerElement[]) => void;
  stageRef: (node: unknown) => void;
}) {
  const scale = 300 / fmt.w;
  const tplImg = useImg(cand.templateUrl);
  const [selected, setSelected] = useState<string | null>(null);
  const mediaEl = cand.elements.find((e) => e.type === "image");
  const mediaImg = useImg(mediaEl?.imageSrc);

  const patch = (id: string, p: Partial<ComposerElement>) =>
    onChange(cand.elements.map((e) => (e.id === id ? { ...e, ...p } : e)));

  return (
    <div>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-black" style={{ width: 300, height: Math.round(fmt.h * scale) }}>
        <Stage ref={stageRef as never} width={300} height={Math.round(fmt.h * scale)} scaleX={scale} scaleY={scale}
          onMouseDown={(e) => { if (e.target === e.target.getStage()) setSelected(null); }}>
          <Layer>
            <Rect x={0} y={0} width={fmt.w} height={fmt.h} fill="#0a0a0a" />
            {/* full-bleed media when no template */}
            {mediaEl && !tplImg && mediaImg && (
              <KImage image={mediaImg} x={mediaEl.x} y={mediaEl.y} width={mediaEl.width} height={mediaEl.height} draggable
                onDragEnd={(e) => patch(mediaEl.id, { x: e.target.x(), y: e.target.y() })} onClick={() => setSelected(mediaEl.id)} />
            )}
            {tplImg && <KImage image={tplImg} x={0} y={0} width={fmt.w} height={fmt.h} listening={false} />}
            {/* inset media over a template */}
            {mediaEl && tplImg && mediaImg && (
              <KImage image={mediaImg} x={mediaEl.x} y={mediaEl.y} width={mediaEl.width} height={mediaEl.height} cornerRadius={mediaEl.cornerRadius} draggable
                stroke={selected === mediaEl.id ? "#00C7FF" : undefined} strokeWidth={8}
                onDragEnd={(e) => patch(mediaEl.id, { x: e.target.x(), y: e.target.y() })} onClick={() => setSelected(mediaEl.id)} />
            )}
            {cand.elements.filter((e) => e.type === "text" && (e.text ?? "").trim()).map((e) => (
              <KText key={e.id} x={e.x} y={e.y} width={e.width} text={e.text} fontSize={e.fontSize} fontFamily={e.fontFamily}
                fontStyle={e.fontStyle} align={e.align as never} fill={e.fill} draggable shadowColor="#000" shadowBlur={8} shadowOpacity={0.7}
                stroke={selected === e.id ? "#00C7FF" : undefined} strokeWidth={selected === e.id ? 1 : 0}
                onDragEnd={(ev) => patch(e.id, { x: ev.target.x(), y: ev.target.y() })} onClick={() => setSelected(e.id)} onTap={() => setSelected(e.id)} />
            ))}
          </Layer>
        </Stage>
      </div>
      {selected && (
        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-gray-600">
          <span className="font-semibold">{selected}</span>
          {cand.elements.find((e) => e.id === selected)?.type === "text" && (
            <>
              <button className="rounded border border-gray-300 px-1.5" onClick={() => patch(selected, { fontSize: Math.round((cand.elements.find((e) => e.id === selected)?.fontSize ?? 40) * 1.15) })}>A+</button>
              <button className="rounded border border-gray-300 px-1.5" onClick={() => patch(selected, { fontSize: Math.max(12, Math.round((cand.elements.find((e) => e.id === selected)?.fontSize ?? 40) * 0.87)) })}>A−</button>
              <input className="w-40 rounded border border-gray-300 px-1.5 py-0.5" value={cand.elements.find((e) => e.id === selected)?.text ?? ""}
                onChange={(ev) => patch(selected, { text: ev.target.value })} />
            </>
          )}
          <span className="text-gray-400">drag to move</span>
        </div>
      )}
    </div>
  );
}

export default function AdminComposer() {
  const navigate = useNavigate();
  const [brand, setBrand] = useState(BRANDS[0]);
  const [fmt, setFmt] = useState(FORMATS[1]);
  const [dest, setDest] = useState(DESTINATIONS[0]);
  // PAID vs ORGANIC is a first-class switch (owner requirement): it flips the
  // copy discipline (paid = direct-response pain→proof→hard CTA; organic =
  // value-first teach→connect→soft ask), the hook family, and how the item
  // is labeled in the Content Director queue.
  const [intent, setIntent] = useState<"organic" | "paid">("organic");
  const [assembling, setAssembling] = useState(false);
  const [cands, setCands] = useState<Candidate[]>([]);
  const [copy, setCopy] = useState<{ headline?: string; body?: string; cta?: string; caption?: string }>({});
  const [busyIdx, setBusyIdx] = useState<number | null>(null);
  const stageRefs = useRef<Record<number, { toDataURL: (o: { pixelRatio: number }) => string } | null>>({});

  // Pools the swap buttons draw from
  const pools = useRef<{ templates: string[]; hooks: string[]; media: string[] }>({ templates: [], hooks: [], media: [] });

  const { data: hookRows } = useQuery({
    queryKey: ["composer-hooks", brand.slug, dest.id, fmt.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("content_hooks").select("text, hook_type, supported_platforms").eq("brand", brand.slug).eq("active", true).limit(120);
      if (error) throw error;
      return (data ?? []) as { text: string; hook_type: string | null; supported_platforms: string[] | null }[];
    },
  });

  const eligibleHooks = useMemo(() => {
    const wantType = FORMAT_HOOK_TYPE[fmt.id];
    return (hookRows ?? [])
      .filter((h) => !h.supported_platforms?.length || h.supported_platforms.includes(dest.id) || h.supported_platforms.includes("meta"))
      .filter((h) => !wantType || !h.hook_type || h.hook_type === wantType)
      .map((h) => h.text);
  }, [hookRows, dest.id, fmt.id]);

  const assemble = async () => {
    setAssembling(true);
    try {
      // 1 · templates from the brand's library (first folder with content wins)
      let templates: string[] = [];
      for (const folder of fmt.folders) {
        const { data } = await (supabase as any).storage.from("wrap-files")
          .list(`canva-templates/${brand.cs}/${folder}`, { limit: 30, sortBy: { column: "created_at", order: "desc" } });
        const files = (data ?? []).filter((f: { name: string }) => /\.(png|jpe?g|webp)$/i.test(f.name));
        templates = files.map((f: { name: string }) =>
          (supabase as any).storage.from("wrap-files").getPublicUrl(`canva-templates/${brand.cs}/${folder}/${f.name}`).data.publicUrl);
        if (templates.length) break;
      }
      // 2 · media from the Asset Library, brand + kind matched
      const { data: assets } = await (supabase as any)
        .from("agent_media_assets")
        .select("storage_url, thumbnail_url, asset_type, content_type")
        .eq("brand", brand.slug)
        .eq("asset_type", fmt.media)
        .not(fmt.media === "video" ? "thumbnail_url" : "storage_url", "is", null)
        .neq("content_type", "render")
        .order("created_at", { ascending: false })
        .limit(40);
      const media = (assets ?? []).map((a: { storage_url: string; thumbnail_url: string | null }) =>
        fmt.media === "video" ? a.thumbnail_url! : a.storage_url).filter(Boolean);
      // 3 · one AI copy pass (hook/headline/body/cta in brand voice)
      let aiCopy: Record<string, string> = {};
      try {
        const { data } = await supabase.functions.invoke("content-studio-ai-copy", {
          body: {
            brand: brand.cs, format: fmt.id,
            tone: dest.id === "linkedin" ? "authoritative" : intent === "paid" ? "direct-response" : "punchy",
            context: intent === "paid"
              ? `PAID ${fmt.label} ad for ${dest.label}: direct-response — open on the burning pain, prove fast, ONE hard CTA.`
              : `ORGANIC ${fmt.label} for ${dest.label}: value-first — teach or entertain, soft CTA, never read like an ad.`,
            hookType: FORMAT_HOOK_TYPE[fmt.id] ?? (intent === "paid" ? "pain_aware" : "education_first"),
          },
        });
        if (data && !data.error) aiCopy = data;
      } catch { /* copy is optional — hooks still carry the card */ }

      const hooks = eligibleHooks.length ? shuffle(eligibleHooks) : [aiCopy.hook || "Your hook here"];
      pools.current = { templates: shuffle(templates), hooks, media: shuffle(media) };
      const next: Candidate[] = [0, 1, 2].map((i) => {
        const templateUrl = pools.current.templates[i % Math.max(1, pools.current.templates.length)] ?? null;
        const mediaUrl = pools.current.media[i % Math.max(1, pools.current.media.length)] ?? null;
        const hookText = hooks[i % hooks.length];
        return { templateUrl, mediaUrl, hookText, elements: buildElements(fmt, hookText, aiCopy, mediaUrl, !!templateUrl) };
      });
      setCopy(aiCopy);
      setCands(next);
      if (!templates.length) toast.info(`No ${fmt.label} templates in ${brand.label}'s library yet — composing on media + type only. Upload templates in Content Studio → Temp.`);
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    } finally { setAssembling(false); }
  };

  const swap = (idx: number, what: "template" | "hook" | "media") => {
    setCands((prev) => prev.map((c, i) => {
      if (i !== idx) return c;
      const pool = what === "template" ? pools.current.templates : what === "hook" ? pools.current.hooks : pools.current.media;
      if (!pool.length) { toast.info(`No more ${what}s in the pool.`); return c; }
      const cur = what === "template" ? c.templateUrl : what === "hook" ? c.hookText : c.mediaUrl;
      const nextVal = pool[(pool.indexOf(cur as string) + 1) % pool.length];
      if (what === "hook") {
        return { ...c, hookText: nextVal, elements: c.elements.map((e) => (e.id === "hook" ? { ...e, text: nextVal } : e)) };
      }
      if (what === "media") {
        return { ...c, mediaUrl: nextVal, elements: c.elements.map((e) => (e.type === "image" ? { ...e, imageSrc: nextVal } : e)) };
      }
      return { ...c, templateUrl: nextVal };
    }));
  };

  const canvasState = (c: Candidate) => ({
    canvasWidth: fmt.w, canvasHeight: fmt.h, formatLabel: fmt.label, bgColor: "#0a0a0a", videoUrl: null,
    elements: [
      ...(c.templateUrl ? [{ id: "template", type: "image", x: 0, y: 0, width: fmt.w, height: fmt.h, imageSrc: c.templateUrl }] : []),
      ...c.elements,
    ],
  });

  const refineInStudio = async (idx: number) => {
    setBusyIdx(idx);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u?.user) throw new Error("Sign in required");
      const { error } = await (supabase as any).from("content_studio_works").insert({
        user_id: u.user.id, user_email: u.user.email,
        title: `Composer · ${brand.label} · ${fmt.label} · ${dest.label}`,
        brand: brand.cs, format_label: fmt.label, status: "draft",
        canvas_state: canvasState(cands[idx]),
      });
      if (error) throw error;
      toast.success("Saved — opening Content Studio (find it under My Works).");
      navigate("/admin/content-studio");
    } catch (e) { toast.error(String((e as Error).message ?? e)); }
    finally { setBusyIdx(null); }
  };

  const deploy = async (idx: number) => {
    setBusyIdx(idx);
    try {
      const stage = stageRefs.current[idx];
      if (!stage) throw new Error("Canvas not ready");
      const dataUrl = stage.toDataURL({ pixelRatio: fmt.w / 300 });
      const bin = atob(dataUrl.split(",")[1]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const path = `content-studio-deploys/composer-${Date.now()}.png`;
      const { error: upErr } = await (supabase as any).storage.from("wrap-files").upload(path, bytes, { contentType: "image/png", upsert: true });
      if (upErr) throw upErr;
      const url = (supabase as any).storage.from("wrap-files").getPublicUrl(path).data.publicUrl;
      const { error } = await (supabase as any).from("agent_social_posts").insert({
        brand: brand.slug, platform: dest.id, post_type: `${fmt.id}-${intent}`,
        caption: [cands[idx].hookText, copy.body, copy.cta].filter(Boolean).join("\n\n"),
        media_urls: [url], status: "needs_review", created_by: `composer-${intent}`,
      });
      if (error) throw error;
      toast.success("Deployed to the Content Director queue — approve it there to publish.");
    } catch (e) { toast.error(String((e as Error).message ?? e)); }
    finally { setBusyIdx(null); }
  };

  const Chip = ({ active, onClick, children, color }: { active: boolean; onClick: () => void; children: React.ReactNode; color?: string }) => (
    <button onClick={onClick}
      className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold transition ${active ? "border-transparent text-white" : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"}`}
      style={active ? { background: color || "#111827" } : undefined}>
      {children}
    </button>
  );

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-6xl px-5 py-10">
        <div className="text-xs font-bold uppercase tracking-widest text-gray-500">Brand → format → destination → assembled. Swap what you don't like.</div>
        <h1 className="mt-1 text-4xl font-bold text-gray-900">
          Content <span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">Composer</span>
        </h1>
        <div className="mt-6"><MarketingSuiteGuide /></div>

        <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-gray-500">1 · Brand</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {BRANDS.map((b) => <Chip key={b.slug} active={brand.slug === b.slug} color={brandMeta(b.slug).color} onClick={() => { setBrand(b); setCands([]); }}>{b.label}</Chip>)}
        </div>

        <h2 className="mt-6 text-sm font-bold uppercase tracking-wide text-gray-500">2 · Format</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {FORMATS.map((f) => <Chip key={f.id} active={fmt.id === f.id} onClick={() => { setFmt(f); setCands([]); }}>{f.label}</Chip>)}
        </div>

        <h2 className="mt-6 text-sm font-bold uppercase tracking-wide text-gray-500">3 · Paid or organic</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          <Chip active={intent === "organic"} color="#10B981" onClick={() => { setIntent("organic"); setCands([]); }}>🌱 Organic — value-first, soft CTA</Chip>
          <Chip active={intent === "paid"} color="#ec4899" onClick={() => { setIntent("paid"); setCands([]); }}>💰 Paid ad — direct-response, hard CTA</Chip>
        </div>

        <h2 className="mt-6 text-sm font-bold uppercase tracking-wide text-gray-500">4 · Destination</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {DESTINATIONS.map((d) => <Chip key={d.id} active={dest.id === d.id} onClick={() => { setDest(d); setCands([]); }}>{d.label}</Chip>)}
        </div>

        <Button onClick={assemble} disabled={assembling} className="mt-6 bg-gradient-to-r from-[#3b82f6] to-[#ec4899] font-bold text-white">
          {assembling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
          Assemble 3 candidates
        </Button>

        {cands.length > 0 && (
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {cands.map((c, i) => (
              <div key={i} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                <CandidateCanvas fmt={fmt} cand={c}
                  stageRef={(node) => { stageRefs.current[i] = node as never; }}
                  onChange={(els) => setCands((prev) => prev.map((x, j) => (j === i ? { ...x, elements: els } : x)))} />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" className="border-gray-300 px-2 text-xs" onClick={() => swap(i, "hook")}><RefreshCw className="mr-1 h-3 w-3" />hook</Button>
                  <Button size="sm" variant="outline" className="border-gray-300 px-2 text-xs" onClick={() => swap(i, "template")}><RefreshCw className="mr-1 h-3 w-3" />template</Button>
                  <Button size="sm" variant="outline" className="border-gray-300 px-2 text-xs" onClick={() => swap(i, "media")}><RefreshCw className="mr-1 h-3 w-3" />media</Button>
                </div>
                <div className="mt-2 flex gap-1.5">
                  <Button size="sm" variant="outline" className="flex-1 border-gray-300 text-xs" disabled={busyIdx === i} onClick={() => refineInStudio(i)}>
                    <PencilRuler className="mr-1 h-3 w-3" /> Refine in Studio
                  </Button>
                  <Button size="sm" className="flex-1 bg-gray-900 text-xs text-white hover:bg-gray-800" disabled={busyIdx === i} onClick={() => deploy(i)}>
                    {busyIdx === i ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="mr-1 h-3 w-3" />} Deploy
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {cands.length > 0 && (
          <p className="mt-4 text-xs text-gray-500">
            Click any text to edit inline (drag to move, A+/A− to size). "Refine in Studio" saves the exact canvas to
            Content Studio → My Works for the full editor. "Deploy" renders the canvas at full size into the Content
            Director approval queue — nothing publishes without approval there.
          </p>
        )}
      </div>
    </div>
  );
}
