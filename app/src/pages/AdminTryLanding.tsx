/**
 * /admin/try-landing — CMS for the public /try landing page.
 *
 * Two surfaces in one screen:
 *   - Page content card: edits the singleton `try_landing_config` row
 *     (headline, sub, "what you get" bullets, token-coin toggle,
 *     $299 production-pack section).
 *   - Image library card: CRUD over `try_landing_examples`, grouped
 *     by proof_type ('design' | '2d_proof' | '3d_proof') in tabs.
 *
 * Image uploads land in the existing `carousel-images` Supabase
 * bucket so we don't have to provision a new one. The public URL is
 * stored in `image_url`.
 *
 * Types: Supabase types.ts hasn't been regenerated for these new
 * tables yet (MCP regen is offline). All queries cast through `as
 * any`. Local types in `@/hooks/useTryLandingContent` keep the
 * consumer surface strict.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import {
  ArrowLeft,
  Plus,
  Save,
  Trash2,
  Upload,
  Eye,
  EyeOff,
  Image as ImageIcon,
  ExternalLink,
  Loader2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import type {
  TryLandingConfig,
  TryLandingExample,
  TryLandingProofType,
} from "@/hooks/useTryLandingContent";

const STORAGE_BUCKET = "carousel-images";
const STORAGE_PREFIX = "try-landing";

const PROOF_TYPE_LABEL: Record<TryLandingProofType, string> = {
  design: "Custom Wrap Designs",
  "2d_proof": "2D Flat-Panel Proofs",
  "3d_proof": "3D Photorealistic Proofs",
};

const PROOF_TYPE_HELP: Record<TryLandingProofType, string> = {
  design:
    "Showcase finished wrap designs the buyer can expect to receive. Recommended: 6+ examples, 4:3 ratio, distinct vehicle types.",
  "2d_proof":
    "Examples of the flat-panel 2D proof showing how a wrap maps to the vehicle. Recommended: 1-2 strong examples.",
  "3d_proof":
    "Photorealistic 3D renders showing the wrap on a vehicle from multiple angles. Recommended: 1-2 strong examples.",
};

// Cast helper — keeps consumer code clean while we can't regen types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const AdminTryLanding = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ── config ────────────────────────────────────────────────
  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ["admin_try_landing_config"],
    queryFn: async (): Promise<TryLandingConfig | null> => {
      const { data, error } = await db
        .from("try_landing_config")
        .select("*")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [headline, setHeadline] = useState("");
  const [subheadline, setSubheadline] = useState("");
  const [bullets, setBullets] = useState<string[]>([]);
  const [showTokenCoins, setShowTokenCoins] = useState(true);
  const [packEnabled, setPackEnabled] = useState(true);
  const [packPrice, setPackPrice] = useState(299);
  const [packCopy, setPackCopy] = useState("");

  useEffect(() => {
    if (!config) return;
    setHeadline(config.headline);
    setSubheadline(config.subheadline ?? "");
    setBullets(Array.isArray(config.what_you_get) ? config.what_you_get : []);
    setShowTokenCoins(config.show_token_coins);
    setPackEnabled(config.production_pack_enabled);
    setPackPrice(config.production_pack_price);
    setPackCopy(config.production_pack_copy ?? "");
  }, [config]);

  const saveConfig = useMutation({
    mutationFn: async () => {
      const payload = {
        id: 1,
        headline: headline.trim() || "Custom Wrap Design",
        subheadline: subheadline.trim() || null,
        what_you_get: bullets.map((b) => b.trim()).filter(Boolean),
        show_token_coins: showTokenCoins,
        production_pack_enabled: packEnabled,
        production_pack_price: Math.max(0, Math.round(packPrice || 0)),
        production_pack_copy: packCopy.trim() || null,
      };
      const { error } = await db
        .from("try_landing_config")
        .upsert(payload, { onConflict: "id" });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_try_landing_config"] });
      queryClient.invalidateQueries({ queryKey: ["try_landing_config"] });
      toast({
        title: "Saved",
        description: "Page content updated.",
      });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Save failed";
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    },
  });

  // ── examples ──────────────────────────────────────────────
  const { data: examples = [], isLoading: examplesLoading } = useQuery({
    queryKey: ["admin_try_landing_examples"],
    queryFn: async (): Promise<TryLandingExample[]> => {
      const { data, error } = await db
        .from("try_landing_examples")
        .select("*")
        .order("proof_type", { ascending: true })
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const [activeTab, setActiveTab] = useState<TryLandingProofType>("design");

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Helmet>
        <title>Try Landing CMS · Admin</title>
      </Helmet>

      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/admin")}
              className="gap-1.5 border-gray-300 text-gray-700"
            >
              <ArrowLeft className="h-4 w-4" />
              Admin
            </Button>
            <div>
              <h1 className="text-2xl font-extrabold leading-none">
                <span className="text-gray-900">Try Landing</span>{" "}
                <span className="bg-gradient-to-r from-[#0284C7] to-[#38BDF8] bg-clip-text text-transparent">
                  CMS
                </span>
              </h1>
              <p className="text-sm text-gray-600 mt-1">
                Edit the public{" "}
                <a
                  href="/try"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-[#0284C7] hover:underline inline-flex items-center gap-1"
                >
                  /try landing page
                  <ExternalLink className="h-3 w-3" />
                </a>{" "}
                — copy, bullets, image gallery, $299 production pack.
              </p>
            </div>
          </div>
          <Badge variant="outline" className="bg-white">
            {examples.length} image{examples.length === 1 ? "" : "s"}
          </Badge>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 grid grid-cols-1 gap-6">
        {/* Page content card */}
        <Card className="border-gray-200">
          <CardHeader className="border-b border-gray-100">
            <CardTitle className="text-lg flex items-center gap-2">
              <Save className="h-4 w-4 text-[#0284C7]" />
              Page content
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-5 space-y-5">
            {configLoading ? (
              <div className="text-sm text-gray-500">Loading…</div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs font-semibold uppercase tracking-wider text-gray-700">
                      Headline
                    </Label>
                    <Input
                      value={headline}
                      onChange={(e) => setHeadline(e.target.value)}
                      placeholder="Custom Wrap Design"
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-semibold uppercase tracking-wider text-gray-700">
                      Sub-headline
                    </Label>
                    <Input
                      value={subheadline}
                      onChange={(e) => setSubheadline(e.target.value)}
                      placeholder="Photorealistic AI wrap design…"
                      className="mt-1.5"
                    />
                  </div>
                </div>

                {/* What-you-get bullets */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-gray-700">
                      What you get — bullets
                    </Label>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setBullets([...bullets, ""])}
                      className="h-7 gap-1 text-xs"
                    >
                      <Plus className="h-3 w-3" />
                      Add bullet
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {bullets.map((b, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 w-5 shrink-0">
                          {i + 1}.
                        </span>
                        <Input
                          value={b}
                          onChange={(e) => {
                            const next = [...bullets];
                            next[i] = e.target.value;
                            setBullets(next);
                          }}
                          placeholder="Bullet text…"
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() =>
                            setBullets(bullets.filter((_, j) => j !== i))
                          }
                          className="h-8 w-8 shrink-0 text-gray-400 hover:text-red-600"
                          aria-label="Remove"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    {bullets.length === 0 && (
                      <p className="text-xs text-gray-400 italic py-2">
                        No bullets yet — click "Add bullet" to start.
                      </p>
                    )}
                  </div>
                </div>

                {/* Toggles */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50/50 px-3 py-2.5">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">
                        Show 3 token coins
                      </div>
                      <div className="text-xs text-gray-500">
                        RP $25 coin trio under the headline
                      </div>
                    </div>
                    <Switch
                      checked={showTokenCoins}
                      onCheckedChange={setShowTokenCoins}
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50/50 px-3 py-2.5">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">
                        Show $299 production-pack section
                      </div>
                      <div className="text-xs text-gray-500">
                        Post-approval upsell block
                      </div>
                    </div>
                    <Switch
                      checked={packEnabled}
                      onCheckedChange={setPackEnabled}
                    />
                  </div>
                </div>

                {/* Production-pack details */}
                {packEnabled && (
                  <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <Label className="text-xs font-semibold uppercase tracking-wider text-gray-700">
                          Pack price ($)
                        </Label>
                        <Input
                          type="number"
                          min={0}
                          value={packPrice}
                          onChange={(e) =>
                            setPackPrice(Number(e.target.value))
                          }
                          className="mt-1.5"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <Label className="text-xs font-semibold uppercase tracking-wider text-gray-700">
                          Pack copy
                        </Label>
                        <Textarea
                          rows={2}
                          value={packCopy}
                          onChange={(e) => setPackCopy(e.target.value)}
                          placeholder="Approve your design and unlock production-ready print files…"
                          className="mt-1.5"
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div className="pt-2 flex justify-end">
                  <Button
                    onClick={() => saveConfig.mutate()}
                    disabled={saveConfig.isPending}
                    className="gap-1.5 bg-gradient-to-r from-[#0284C7] to-[#38BDF8] text-white border-0 hover:brightness-110"
                  >
                    {saveConfig.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Save page content
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Image library */}
        <Card className="border-gray-200">
          <CardHeader className="border-b border-gray-100">
            <CardTitle className="text-lg flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-[#0284C7]" />
              Image library
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-5">
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as TryLandingProofType)}
            >
              <TabsList className="bg-gray-100">
                {(Object.keys(PROOF_TYPE_LABEL) as TryLandingProofType[]).map(
                  (type) => {
                    const count = examples.filter(
                      (e) => e.proof_type === type,
                    ).length;
                    return (
                      <TabsTrigger key={type} value={type} className="gap-2">
                        {PROOF_TYPE_LABEL[type]}
                        <Badge
                          variant="outline"
                          className="h-5 px-1.5 text-[10px] bg-white"
                        >
                          {count}
                        </Badge>
                      </TabsTrigger>
                    );
                  },
                )}
              </TabsList>

              {(Object.keys(PROOF_TYPE_LABEL) as TryLandingProofType[]).map(
                (type) => (
                  <TabsContent key={type} value={type} className="pt-5">
                    <p className="text-xs text-gray-600 mb-4">
                      {PROOF_TYPE_HELP[type]}
                    </p>
                    <ImagePanel
                      proofType={type}
                      examples={examples.filter((e) => e.proof_type === type)}
                      loading={examplesLoading}
                    />
                  </TabsContent>
                ),
              )}
            </Tabs>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

// ============================================================ ImagePanel

interface ImagePanelProps {
  proofType: TryLandingProofType;
  examples: TryLandingExample[];
  loading: boolean;
}

const ImagePanel = ({ proofType, examples, loading }: ImagePanelProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sortOrder, setSortOrder] = useState<number>(examples.length);

  // Re-default the sort_order suggestion as the panel fills.
  useEffect(() => {
    setSortOrder(examples.length);
  }, [examples.length]);

  const addExample = useMutation({
    mutationFn: async () => {
      let finalUrl = imageUrl.trim();
      if (file) {
        const path = `${STORAGE_PREFIX}/${proofType}/${Date.now()}_${file.name}`;
        const { error: upErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(path, file, { upsert: false });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage
          .from(STORAGE_BUCKET)
          .getPublicUrl(path);
        finalUrl = pub.publicUrl;
      }
      if (!finalUrl) throw new Error("Provide an image file or paste a URL.");
      if (!title.trim()) throw new Error("Title is required.");
      const { error } = await db.from("try_landing_examples").insert({
        proof_type: proofType,
        image_url: finalUrl,
        title: title.trim(),
        description: description.trim() || null,
        sort_order: sortOrder,
        is_active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["admin_try_landing_examples"],
      });
      queryClient.invalidateQueries({ queryKey: ["try_landing_examples"] });
      toast({ title: "Image added" });
      setFile(null);
      setImageUrl("");
      setTitle("");
      setDescription("");
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Upload failed";
      toast({ title: "Failed", description: msg, variant: "destructive" });
    },
  });

  const toggleActive = useMutation({
    mutationFn: async (row: TryLandingExample) => {
      const { error } = await db
        .from("try_landing_examples")
        .update({ is_active: !row.is_active })
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["admin_try_landing_examples"],
      });
      queryClient.invalidateQueries({ queryKey: ["try_landing_examples"] });
    },
  });

  const deleteRow = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db
        .from("try_landing_examples")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["admin_try_landing_examples"],
      });
      queryClient.invalidateQueries({ queryKey: ["try_landing_examples"] });
      toast({ title: "Deleted" });
    },
  });

  return (
    <div className="space-y-5">
      {/* Add row */}
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50/50 p-4 sm:p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs font-semibold uppercase tracking-wider text-gray-700">
              Upload image
            </Label>
            <Input
              type="file"
              accept="image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1.5"
            />
            {file && (
              <p className="text-[11px] text-gray-500 mt-1">
                Selected: {file.name}
              </p>
            )}
          </div>
          <div>
            <Label className="text-xs font-semibold uppercase tracking-wider text-gray-700">
              …or paste public URL
            </Label>
            <Input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://…/image.jpg"
              className="mt-1.5"
              disabled={!!file}
            />
          </div>
          <div>
            <Label className="text-xs font-semibold uppercase tracking-wider text-gray-700">
              Title
            </Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. 'Pearl White Tesla Model 3'"
              className="mt-1.5"
            />
          </div>
          <div>
            <Label className="text-xs font-semibold uppercase tracking-wider text-gray-700">
              Sort order
            </Label>
            <Input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value))}
              className="mt-1.5"
            />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-gray-700">
              Caption (optional)
            </Label>
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short caption shown under the image"
              className="mt-1.5"
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button
            onClick={() => addExample.mutate()}
            disabled={addExample.isPending}
            className="gap-1.5 bg-gradient-to-r from-[#0284C7] to-[#38BDF8] text-white border-0 hover:brightness-110"
          >
            {addExample.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            Add to gallery
          </Button>
        </div>
      </div>

      {/* Existing rows */}
      {loading ? (
        <div className="text-sm text-gray-500">Loading images…</div>
      ) : examples.length === 0 ? (
        <div className="text-sm text-gray-400 italic py-4 text-center">
          No images in this section yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {examples.map((row) => (
            <div
              key={row.id}
              className={cn(
                "rounded-xl border bg-white overflow-hidden flex flex-col",
                row.is_active ? "border-gray-200" : "border-gray-200 opacity-60",
              )}
            >
              <div className="aspect-[4/3] bg-gray-100 overflow-hidden">
                <img
                  src={row.image_url}
                  alt={row.title}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
              <div className="p-3 flex-1 flex flex-col gap-1">
                <div className="text-sm font-semibold text-gray-900 truncate">
                  {row.title}
                </div>
                {row.description && (
                  <div className="text-xs text-gray-600 line-clamp-2">
                    {row.description}
                  </div>
                )}
                <div className="text-[10px] uppercase tracking-wider text-gray-400 mt-1">
                  Sort #{row.sort_order}
                </div>
              </div>
              <div className="border-t border-gray-100 flex">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => toggleActive.mutate(row)}
                  className="flex-1 rounded-none h-9 text-xs font-medium"
                >
                  {row.is_active ? (
                    <>
                      <Eye className="h-3.5 w-3.5 mr-1" />
                      Active
                    </>
                  ) : (
                    <>
                      <EyeOff className="h-3.5 w-3.5 mr-1" />
                      Hidden
                    </>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (confirm(`Delete "${row.title}"?`)) {
                      deleteRow.mutate(row.id);
                    }
                  }}
                  className="rounded-none h-9 text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 border-l border-gray-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminTryLanding;
