/**
 * Admin Email Editor — Build branded retargeting emails
 *
 * Block-based editor with live preview:
 * - Logo block (shop logo from settings)
 * - Text block (editable rich text)
 * - CTA button block (configurable URL + label)
 * - Image block (upload or URL)
 * - Divider block
 * - Footer block (shop name, address, unsubscribe)
 */

import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, Plus, Trash2, GripVertical, Image, Type, MousePointer,
  Minus, Save, Eye, Code, ChevronUp, ChevronDown, Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { mergeTemplate, TONE_PRESETS, type ToneStyle } from "@/lib/retarget-templates";

// ── Block Types ──────────────────────────────────────────────────

type BlockType = "logo" | "text" | "cta" | "image" | "divider" | "footer";

interface EmailBlock {
  id: string;
  type: BlockType;
  content: string;
  url?: string;
  label?: string;
  align?: "left" | "center" | "right";
  bgColor?: string;
  textColor?: string;
}

const newBlock = (type: BlockType): EmailBlock => ({
  id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  type,
  content: type === "text" ? "Your message here..." :
           type === "cta" ? "View Your Quote" :
           type === "footer" ? "{shop} · Reply STOP to unsubscribe" :
           type === "divider" ? "" :
           type === "logo" ? "{shop_logo}" :
           type === "image" ? "" : "",
  url: type === "cta" ? "{quote_url}" : undefined,
  label: type === "cta" ? "View Your Quote" : undefined,
  align: "center",
  bgColor: type === "cta" ? "#0891b2" : undefined,
  textColor: type === "cta" ? "#ffffff" : undefined,
});

const DEFAULT_BLOCKS: EmailBlock[] = [
  { ...newBlock("logo"), id: "default-logo" },
  { ...newBlock("text"), id: "default-heading", content: "Hey {name}!", align: "center", textColor: "#111111" },
  { ...newBlock("text"), id: "default-body", content: "Your {vehicle} wrap quote of {price} is ready. We'd love to get your project on the schedule.", align: "left" },
  { ...newBlock("cta"), id: "default-cta" },
  { ...newBlock("divider"), id: "default-divider" },
  { ...newBlock("footer"), id: "default-footer" },
];

// ── Component ────────────────────────────────────────────────────

interface AdminEmailEditorProps {
  /** When rendered inside the MightyMail hub, hide the standalone page chrome. */
  embedded?: boolean;
}

const AdminEmailEditor = ({ embedded = false }: AdminEmailEditorProps) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const templateId = searchParams.get("template") || "";

  const [blocks, setBlocks] = useState<EmailBlock[]>(DEFAULT_BLOCKS);
  const [subject, setSubject] = useState("Your {vehicle} wrap quote — {shop}");
  const [shopName, setShopName] = useState("");
  const [shopLogoUrl, setShopLogoUrl] = useState<string | null>(null);
  const [shopTone, setShopTone] = useState<ToneStyle>("casual");
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [saving, setSaving] = useState(false);

  // Image upload — mirrors the in-system pattern (wrap-files / email-assets).
  const [uploadingBlockId, setUploadingBlockId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadTargetRef = useRef<string | null>(null);

  const exit = () => {
    if (embedded) return;
    navigate("/quotes");
  };

  const uploadImage = async (file: File): Promise<string | null> => {
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const fileName = `email-assets/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("wrap-files")
        .upload(fileName, file, { upsert: true, contentType: file.type });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from("wrap-files").getPublicUrl(fileName);
      return publicUrl;
    } catch (err: any) {
      toast.error(err.message || "Failed to upload image");
      return null;
    }
  };

  const triggerUpload = (blockId: string) => {
    uploadTargetRef.current = blockId;
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const blockId = uploadTargetRef.current;
    if (!file || !blockId) return;
    setUploadingBlockId(blockId);
    const url = await uploadImage(file);
    if (url) {
      updateBlock(blockId, { content: url });
      toast.success("Image uploaded");
    }
    setUploadingBlockId(null);
    uploadTargetRef.current = null;
  };

  // Load shop settings
  useEffect(() => {
    supabase.from("shop_settings").select("*").limit(1).single().then(({ data }) => {
      if (data) {
        setShopName((data as any).shop_name || "");
        setShopLogoUrl((data as any).shop_logo_url || null);
        if ((data as any).tone_style) setShopTone((data as any).tone_style);
      }
    });
  }, []);

  // Load template if editing an existing one
  useEffect(() => {
    if (templateId) {
      supabase.from("retarget_templates").select("*").eq("id", templateId).single().then(({ data }) => {
        if (data) {
          setSubject((data as any).subject || "");
          // Try to parse blocks from metadata, otherwise use body as single text block
          const meta = (data as any).metadata;
          if (meta?.blocks) {
            setBlocks(meta.blocks);
          } else if ((data as any).body) {
            setBlocks([
              { ...newBlock("logo"), id: "loaded-logo" },
              { ...newBlock("text"), id: "loaded-body", content: (data as any).body },
              { ...newBlock("cta"), id: "loaded-cta" },
              { ...newBlock("footer"), id: "loaded-footer" },
            ]);
          }
        }
      });
    }
  }, [templateId]);

  // ── Block management ──
  const addBlock = (type: BlockType) => {
    setBlocks(prev => [...prev, newBlock(type)]);
  };

  const removeBlock = (id: string) => {
    setBlocks(prev => prev.filter(b => b.id !== id));
  };

  const updateBlock = (id: string, updates: Partial<EmailBlock>) => {
    setBlocks(prev => prev.map(b => b.id === id ? { ...b, ...updates } : b));
  };

  const moveBlock = (id: string, direction: "up" | "down") => {
    setBlocks(prev => {
      const idx = prev.findIndex(b => b.id === id);
      if (idx < 0) return prev;
      const newIdx = direction === "up" ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
  };

  // ── Preview merge data ──
  const previewData = {
    name: "Marcus",
    vehicle: "2024 BMW M4",
    shop: shopName || "Your Shop",
    quote_url: "https://restylepro.ai/quick-quote?...",
    price: "$2,373.00",
    shop_logo: shopLogoUrl || "",
    review_url: "https://g.page/review/...",
  };

  // ── Save ──
  const handleSave = async () => {
    setSaving(true);
    try {
      // Build the plain text body from blocks for backward compat
      const bodyText = blocks
        .filter(b => b.type === "text")
        .map(b => b.content)
        .join("\n\n");

      if (templateId) {
        await supabase.from("retarget_templates").update({
          subject,
          body: bodyText,
          metadata: { blocks },
        } as any).eq("id", templateId);
        toast.success("Email template saved!");
      } else {
        // Save as new custom template
        const id = `custom-email-${Date.now()}`;
        await supabase.from("retarget_templates").insert({
          id,
          tier: "3day",
          channel: "email",
          label: subject.slice(0, 40) || "Custom Email",
          description: "Custom email template",
          subject,
          body: bodyText,
          sort_order: 99,
          metadata: { blocks },
        } as any);
        toast.success("Email template created!");
      }
      exit();
    } catch (err: any) {
      toast.error(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // ── Block Renderer (Editor Mode) ──
  const renderBlockEditor = (block: EmailBlock) => {
    const isActive = activeBlockId === block.id;

    return (
      <div
        key={block.id}
        onClick={() => setActiveBlockId(block.id)}
        className={cn(
          "relative group border rounded-lg transition-all cursor-pointer",
          isActive ? "border-[#0891b2] ring-1 ring-[#0891b2]/30" : "border-[#e5e7eb] hover:border-[#d1d5db]"
        )}
      >
        {/* Block controls */}
        <div className={cn(
          "absolute -top-3 right-2 flex items-center gap-0.5 bg-white border border-[#e5e7eb] rounded-md shadow-sm px-1 py-0.5 z-10 transition-opacity",
          isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        )}>
          <button onClick={(e) => { e.stopPropagation(); moveBlock(block.id, "up"); }} className="w-5 h-5 flex items-center justify-center text-[#9ca3af] hover:text-[#111]">
            <ChevronUp className="w-3 h-3" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); moveBlock(block.id, "down"); }} className="w-5 h-5 flex items-center justify-center text-[#9ca3af] hover:text-[#111]">
            <ChevronDown className="w-3 h-3" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); removeBlock(block.id); }} className="w-5 h-5 flex items-center justify-center text-[#9ca3af] hover:text-red-500">
            <Trash2 className="w-3 h-3" />
          </button>
        </div>

        {/* Block content */}
        <div className="p-3">
          {block.type === "logo" && (() => {
            const logoSrc = block.content?.startsWith("http") ? block.content : shopLogoUrl;
            return (
              <div className="text-center space-y-2">
                {logoSrc ? (
                  <img src={logoSrc} alt="Shop Logo" className="h-12 mx-auto object-contain" />
                ) : (
                  <div className="h-12 flex items-center justify-center text-xs text-[#9ca3af] bg-[#f9fafb] rounded">
                    Upload a logo or set one in Settings
                  </div>
                )}
                {isActive && (
                  <div className="pt-2 border-t border-[#e5e7eb] flex items-center justify-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); triggerUpload(block.id); }}
                      disabled={uploadingBlockId === block.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#e5e7eb] text-[10px] font-semibold text-[#6b7280] hover:border-[#0891b2] hover:text-[#0891b2] disabled:opacity-50"
                    >
                      <Upload className="w-3 h-3" />
                      {uploadingBlockId === block.id ? "Uploading…" : logoSrc ? "Replace logo" : "Upload logo"}
                    </button>
                    {block.content?.startsWith("http") && (
                      <button
                        onClick={(e) => { e.stopPropagation(); updateBlock(block.id, { content: "{shop_logo}" }); }}
                        className="text-[10px] text-[#9ca3af] hover:text-red-500"
                      >
                        Use shop default
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {block.type === "text" && (
            <textarea
              value={block.content}
              onChange={(e) => updateBlock(block.id, { content: e.target.value })}
              className="w-full text-sm text-[#374151] bg-transparent resize-y min-h-[60px] focus:outline-none"
              style={{ textAlign: block.align || "left" }}
            />
          )}

          {block.type === "cta" && (
            <div className="space-y-2">
              <div className="flex justify-center">
                <div
                  className="px-6 py-2.5 rounded-lg text-sm font-bold"
                  style={{ backgroundColor: block.bgColor || "#0891b2", color: block.textColor || "#fff" }}
                >
                  {block.label || "View Your Quote"}
                </div>
              </div>
              {isActive && (
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#e5e7eb]">
                  <div>
                    <Label className="text-[9px] text-[#9ca3af]">Button Text</Label>
                    <Input
                      value={block.label || ""}
                      onChange={(e) => updateBlock(block.id, { label: e.target.value })}
                      className="h-7 text-xs border-[#e5e7eb]"
                    />
                  </div>
                  <div>
                    <Label className="text-[9px] text-[#9ca3af]">URL</Label>
                    <Input
                      value={block.url || ""}
                      onChange={(e) => updateBlock(block.id, { url: e.target.value })}
                      className="h-7 text-xs border-[#e5e7eb]"
                    />
                  </div>
                  <div>
                    <Label className="text-[9px] text-[#9ca3af]">Button Color</Label>
                    <Input
                      type="color"
                      value={block.bgColor || "#0891b2"}
                      onChange={(e) => updateBlock(block.id, { bgColor: e.target.value })}
                      className="h-7 w-full border-[#e5e7eb]"
                    />
                  </div>
                  <div>
                    <Label className="text-[9px] text-[#9ca3af]">Text Color</Label>
                    <Input
                      type="color"
                      value={block.textColor || "#ffffff"}
                      onChange={(e) => updateBlock(block.id, { textColor: e.target.value })}
                      className="h-7 w-full border-[#e5e7eb]"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {block.type === "image" && (
            <div className="space-y-2">
              {block.content ? (
                <img src={block.content} alt="" className="w-full rounded object-cover max-h-48" />
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); triggerUpload(block.id); }}
                  disabled={uploadingBlockId === block.id}
                  className="w-full h-24 flex flex-col items-center justify-center gap-1 bg-[#f9fafb] rounded border border-dashed border-[#d1d5db] hover:border-[#0891b2] disabled:opacity-50"
                >
                  <Upload className="w-4 h-4 text-[#9ca3af]" />
                  <span className="text-xs text-[#9ca3af]">
                    {uploadingBlockId === block.id ? "Uploading…" : "Upload an image or paste a URL below"}
                  </span>
                </button>
              )}
              {isActive && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); triggerUpload(block.id); }}
                      disabled={uploadingBlockId === block.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#e5e7eb] text-[10px] font-semibold text-[#6b7280] hover:border-[#0891b2] hover:text-[#0891b2] disabled:opacity-50 shrink-0"
                    >
                      <Upload className="w-3 h-3" />
                      {uploadingBlockId === block.id ? "Uploading…" : block.content ? "Replace" : "Upload"}
                    </button>
                    <Input
                      value={block.content}
                      onChange={(e) => updateBlock(block.id, { content: e.target.value })}
                      placeholder="…or paste an image URL"
                      className="h-7 text-xs border-[#e5e7eb]"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {block.type === "divider" && (
            <div className="py-2">
              <hr className="border-[#e5e7eb]" />
            </div>
          )}

          {block.type === "footer" && (
            <div className="text-center">
              <textarea
                value={block.content}
                onChange={(e) => updateBlock(block.id, { content: e.target.value })}
                className="w-full text-[10px] text-[#9ca3af] bg-transparent resize-none text-center focus:outline-none min-h-[40px]"
              />
            </div>
          )}
        </div>

        {/* Block type label */}
        <div className="absolute -top-2.5 left-3 bg-white px-1.5 text-[8px] font-bold text-[#9ca3af] uppercase tracking-wider">
          {block.type}
        </div>
      </div>
    );
  };

  // ── Block Renderer (Preview Mode) ──
  const renderBlockPreview = (block: EmailBlock) => {
    const merged = (text: string) => mergeTemplate(text, previewData);

    return (
      <tr key={block.id}>
        <td style={{ padding: block.type === "divider" ? "8px 24px" : "12px 24px" }}>
          {block.type === "logo" && (block.content?.startsWith("http") || shopLogoUrl) && (
            <div style={{ textAlign: "center" }}>
              <img src={block.content?.startsWith("http") ? block.content : shopLogoUrl} alt="" style={{ height: 48, margin: "0 auto" }} />
            </div>
          )}
          {block.type === "text" && (
            <p style={{ fontSize: 14, color: block.textColor || "#374151", textAlign: block.align || "left", lineHeight: 1.6, whiteSpace: "pre-wrap", margin: 0 }}>
              {merged(block.content)}
            </p>
          )}
          {block.type === "cta" && (
            <div style={{ textAlign: "center" }}>
              <a
                href={merged(block.url || "")}
                style={{
                  display: "inline-block", padding: "12px 32px",
                  backgroundColor: block.bgColor || "#0891b2", color: block.textColor || "#fff",
                  borderRadius: 8, fontWeight: 700, fontSize: 14, textDecoration: "none",
                }}
              >
                {merged(block.label || "View Your Quote")}
              </a>
            </div>
          )}
          {block.type === "image" && block.content && (
            <img src={block.content} alt="" style={{ width: "100%", borderRadius: 8, maxHeight: 200, objectFit: "cover" }} />
          )}
          {block.type === "divider" && (
            <hr style={{ border: "none", borderTop: "1px solid #e5e7eb", margin: 0 }} />
          )}
          {block.type === "footer" && (
            <p style={{ fontSize: 10, color: "#9ca3af", textAlign: "center", lineHeight: 1.5, margin: 0 }}>
              {merged(block.content)}
            </p>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className={embedded ? "" : "min-h-screen bg-[#fafafa]"}>
      {/* Hidden file input for image/logo uploads */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelected}
      />

      {/* Header */}
      <div className={cn(
        "flex items-center justify-between px-4 sm:px-6 py-4",
        embedded
          ? "border-b border-[#e5e7eb] bg-white rounded-t-lg"
          : "bg-[#111] border-b border-[#e5e7eb] sticky top-0 z-30",
      )}>
        <div className="flex items-center gap-3">
          {!embedded && (
            <>
              <button onClick={exit} className="text-sm text-gray-400 hover:text-white flex items-center gap-1">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <div className="h-5 w-px bg-gray-700" />
            </>
          )}
          <h1 className={cn("text-lg font-bold", embedded ? "text-[#111]" : "text-white")}>Email Editor</h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setPreviewMode(!previewMode)}
            className={cn(
              "h-9 px-4 text-sm font-semibold border rounded-lg flex items-center gap-1.5",
              embedded
                ? "text-[#374151] border-[#e5e7eb] hover:bg-[#f9fafb]"
                : "text-gray-300 bg-transparent border-gray-600 hover:bg-white/10 hover:text-white",
            )}
          >
            {previewMode ? <><Code className="w-3.5 h-3.5" /> Edit</> : <><Eye className="w-3.5 h-3.5" /> Preview</>}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="h-9 px-4 text-sm font-semibold text-white rounded-lg flex items-center gap-1.5"
            style={{ background: "linear-gradient(135deg, #0891b2, #2563eb)" }}
          >
            <Save className="w-3.5 h-3.5" /> {saving ? "Saving..." : "Save Template"}
          </button>
        </div>
      </div>

      <div className={embedded ? "py-6" : "max-w-4xl mx-auto px-4 sm:px-6 py-6"}>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6">

          {/* ── Left: Editor / Preview ── */}
          <div>
            {/* Subject line */}
            <div className="mb-4">
              <Label className="text-xs font-semibold text-[#111] mb-1 block">Subject Line</Label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="h-10 bg-white border-[#e5e7eb] text-sm text-[#111]"
                placeholder="Your {vehicle} wrap quote — {shop}"
              />
              <p className="text-[9px] text-[#9ca3af] mt-1">Preview: {mergeTemplate(subject, previewData)}</p>
            </div>

            {previewMode ? (
              /* ── Email Preview ── */
              <div className="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
                <div className="bg-[#f9fafb] px-4 py-2 border-b border-[#e5e7eb]">
                  <p className="text-[10px] text-[#9ca3af]">From: {shopName || "Your Shop"}</p>
                  <p className="text-xs font-semibold text-[#111]">{mergeTemplate(subject, previewData)}</p>
                </div>
                <div style={{ maxWidth: 600, margin: "0 auto", padding: "16px 0" }}>
                  <table cellPadding={0} cellSpacing={0} style={{ width: "100%", backgroundColor: "#ffffff" }}>
                    <tbody>
                      {blocks.map(renderBlockPreview)}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              /* ── Block Editor ── */
              <div className="space-y-4">
                {blocks.map(renderBlockEditor)}

                {/* Add block buttons */}
                <div className="flex flex-wrap gap-2 justify-center pt-2">
                  {([
                    { type: "text" as const, icon: Type, label: "Text" },
                    { type: "cta" as const, icon: MousePointer, label: "Button" },
                    { type: "image" as const, icon: Image, label: "Image" },
                    { type: "divider" as const, icon: Minus, label: "Divider" },
                    { type: "logo" as const, icon: Upload, label: "Logo" },
                    { type: "footer" as const, icon: Type, label: "Footer" },
                  ]).map(({ type, icon: Icon, label }) => (
                    <button
                      key={type}
                      onClick={() => addBlock(type)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-[#d1d5db] text-xs font-semibold text-[#6b7280] hover:border-[#0891b2] hover:text-[#0891b2] transition-all"
                    >
                      <Plus className="w-3 h-3" />
                      <Icon className="w-3 h-3" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Right: Settings Panel ── */}
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-[#e5e7eb] p-4">
              <p className="text-sm font-bold text-[#111] mb-3">Merge Fields</p>
              <div className="grid grid-cols-2 gap-1.5">
                {["{name}", "{vehicle}", "{shop}", "{price}", "{quote_url}", "{shop_logo}", "{review_url}"].map((field) => (
                  <button
                    key={field}
                    onClick={() => navigator.clipboard.writeText(field).then(() => toast.success(`Copied ${field}`))}
                    className="text-[10px] font-mono px-2 py-1.5 rounded border border-[#e5e7eb] text-[#6b7280] hover:bg-[#f0fdfa] hover:text-[#0891b2] text-left"
                  >
                    {field}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-[#e5e7eb] p-4">
              <p className="text-sm font-bold text-[#111] mb-2">Preview Data</p>
              <div className="space-y-1.5 text-[10px] text-[#6b7280]">
                <p>Name: <span className="text-[#111] font-medium">{previewData.name}</span></p>
                <p>Vehicle: <span className="text-[#111] font-medium">{previewData.vehicle}</span></p>
                <p>Shop: <span className="text-[#111] font-medium">{previewData.shop}</span></p>
                <p>Price: <span className="text-[#111] font-medium">{previewData.price}</span></p>
                <p>Tone: <span className="text-[#111] font-medium capitalize">{shopTone}</span></p>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-[#e5e7eb] p-4">
              <p className="text-sm font-bold text-[#111] mb-2">Tips</p>
              <ul className="space-y-1.5 text-[10px] text-[#6b7280]">
                <li>Keep subject under 50 characters</li>
                <li>One clear CTA button per email</li>
                <li>Use {"{name}"} to personalize</li>
                <li>Add your logo for brand recognition</li>
                <li>Short paragraphs — mobile-first</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminEmailEditor;
