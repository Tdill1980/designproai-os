/**
 * /admin/rep-marketing-kits — per-rep marketing kit uploader (white UI).
 *
 * Matches the MightyAffiliate white palette: bg-[#f3f4f6], white shadow
 * cards, gray-900 text, cyan #38BDF8 accents. Mobile-first.
 *
 * Each active rep has 7 seeded kit slots in affiliate_marketing_assets
 * (created by seed_rep_marketing_kit). Trish picks a rep, uploads to
 * each slot. Reps see only their own kit on /affiliate/marketing.
 */

import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  Upload,
  ExternalLink,
  Image as ImageIcon,
  Video,
  Mail,
  Link2,
  Loader2,
  Search,
  AlertCircle,
  CheckCircle2,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Save,
  CreditCard,
  RefreshCw,
  Copy,
  Pencil,
} from "lucide-react";

const db = supabase as never as { from: (t: string) => any; storage: any };

interface Rep {
  id: string;
  full_name: string;
  referral_code: string;
  status: string;
  headshot_url: string | null;
  stripe_onboarded: boolean | null;
  stripe_account_id: string | null;
}

interface KitSlot {
  id: string;
  affiliate_id: string;
  kit_slot: string;
  title: string;
  description: string;
  asset_type: string;
  file_url: string | null;
  thumbnail_url: string | null;
  caption_template: string;
  sort_order: number;
}

const SLOT_META: Record<
  string,
  { icon: any; ratio: string; accept: string; recommended: string }
> = {
  static_1:     { icon: ImageIcon, ratio: "aspect-[4/5]",  accept: "image/png,image/jpeg,image/webp", recommended: "1080 × 1350 (4:5)" },
  static_2:     { icon: ImageIcon, ratio: "aspect-[4/5]",  accept: "image/png,image/jpeg,image/webp", recommended: "1080 × 1350 (4:5)" },
  carousel:     { icon: ImageIcon, ratio: "aspect-[4/5]",  accept: "image/png,image/jpeg,image/webp", recommended: "First card of 5 — 4:5" },
  reel:         { icon: Video,     ratio: "aspect-[9/16]", accept: "video/mp4,video/quicktime,video/webm", recommended: "1080 × 1920 (9:16) MP4" },
  email:        { icon: Mail,      ratio: "aspect-[16/9]", accept: "image/png,image/jpeg,image/webp", recommended: "Optional banner 16:9" },
  landing_page: { icon: Link2,     ratio: "aspect-[16/9]", accept: "image/png,image/jpeg,image/webp", recommended: "Preview screenshot 16:9" },
  wpw_banner:   { icon: ImageIcon, ratio: "aspect-[16/9]", accept: "image/png,image/jpeg,image/webp", recommended: "2400 × 900 banner" },
};

const VIDEO_META = { icon: Video, ratio: "aspect-[9/16]", accept: "video/mp4,video/quicktime,video/webm", recommended: "1080 × 1920 (9:16) MP4" };
const CUSTOM_IMAGE_META = { icon: ImageIcon, ratio: "aspect-[4/5]", accept: "image/png,image/jpeg,image/webp", recommended: "Custom image — 4:5" };

const metaFor = (slot: { kit_slot: string; asset_type: string }) => {
  if (SLOT_META[slot.kit_slot]) return SLOT_META[slot.kit_slot];
  return slot.asset_type === "video" ? VIDEO_META : CUSTOM_IMAGE_META;
};

const isCustomSlot = (kitSlot: string) => kitSlot?.startsWith("custom_");

export default function AdminRepMarketingKits() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedRepId, setSelectedRepId] = useState<string | null>(null);
  const [uploadingSlot, setUploadingSlot] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const { data: reps = [], isLoading: repsLoading, error: repsError } = useQuery({
    queryKey: ["affiliate-partners-for-kits"],
    queryFn: async () => {
      const { data, error } = await db
        .from("affiliate_partners")
        .select("id, full_name, referral_code, status, headshot_url, stripe_onboarded, stripe_account_id")
        .in("status", ["active", "approved"])
        .order("full_name");
      if (error) throw error;
      return (data || []) as Rep[];
    },
  });

  const filteredReps = useMemo(() => {
    if (!search.trim()) return reps;
    const q = search.toLowerCase();
    return reps.filter(
      (r) =>
        r.full_name.toLowerCase().includes(q) ||
        r.referral_code.toLowerCase().includes(q)
    );
  }, [reps, search]);

  const {
    data: kit = [],
    isLoading: kitLoading,
    error: kitError,
  } = useQuery({
    queryKey: ["rep-kit", selectedRepId],
    queryFn: async () => {
      if (!selectedRepId) return [];
      const { data, error } = await db
        .from("affiliate_marketing_assets")
        .select("*")
        .eq("affiliate_id", selectedRepId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data || []) as KitSlot[];
    },
    enabled: !!selectedRepId,
  });

  const selectedRep = useMemo(
    () => reps.find((r) => r.id === selectedRepId) || null,
    [reps, selectedRepId]
  );

  const handleUpload = async (slot: KitSlot, file: File) => {
    setUploadingSlot(slot.id);
    try {
      const ext = file.name.split(".").pop() || "bin";
      const path = `rep-kits/${slot.affiliate_id}/${slot.kit_slot}-${Date.now()}.${ext}`;
      const { error: upErr } = await db.storage
        .from("wrap-files")
        .upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      const {
        data: { publicUrl },
      } = db.storage.from("wrap-files").getPublicUrl(path);

      const { error: updErr } = await db
        .from("affiliate_marketing_assets")
        .update({ file_url: publicUrl, thumbnail_url: publicUrl })
        .eq("id", slot.id);
      if (updErr) throw updErr;

      toast({
        title: "Uploaded",
        description: `${slot.title} now has creative attached.`,
      });
      queryClient.invalidateQueries({ queryKey: ["rep-kit", selectedRepId] });
    } catch (err: any) {
      toast({
        title: "Upload failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setUploadingSlot(null);
    }
  };

  const saveUrl = useMutation({
    mutationFn: async ({ id, url }: { id: string; url: string }) => {
      const { error } = await db
        .from("affiliate_marketing_assets")
        .update({ file_url: url || null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rep-kit", selectedRepId] });
      toast({ title: "Saved", description: "URL attached." });
    },
    onError: (err: any) => {
      toast({
        title: "Save failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const invalidateKit = () =>
    queryClient.invalidateQueries({ queryKey: ["rep-kit", selectedRepId] });

  const saveText = useMutation({
    mutationFn: async ({
      id,
      title,
      description,
      caption_template,
    }: {
      id: string;
      title: string;
      description: string;
      caption_template: string;
    }) => {
      const { error } = await db
        .from("affiliate_marketing_assets")
        .update({ title, description, caption_template })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateKit();
      toast({ title: "Saved", description: "Slot text updated." });
    },
    onError: (err: any) =>
      toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const addSlot = useMutation({
    mutationFn: async ({ assetType }: { assetType: "image" | "video" }) => {
      const nextOrder =
        (kit.reduce((m, s) => Math.max(m, s.sort_order ?? 0), 0) || 0) + 1;
      const { error } = await db.from("affiliate_marketing_assets").insert({
        affiliate_id: selectedRepId,
        kit_slot: `custom_${Date.now()}`,
        title: assetType === "video" ? "Custom Video" : "Custom Image",
        description: "Extra asset for this rep.",
        asset_type: assetType,
        caption_template: "",
        sort_order: nextOrder,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateKit();
      toast({ title: "Slot added", description: "New custom slot created." });
    },
    onError: (err: any) =>
      toast({ title: "Add failed", description: err.message, variant: "destructive" }),
  });

  const deleteSlot = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db
        .from("affiliate_marketing_assets")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateKit();
      toast({ title: "Slot removed" });
    },
    onError: (err: any) =>
      toast({ title: "Remove failed", description: err.message, variant: "destructive" }),
  });

  const moveSlot = useMutation({
    mutationFn: async ({ index, dir }: { index: number; dir: -1 | 1 }) => {
      const a = kit[index];
      const b = kit[index + dir];
      if (!a || !b) return;
      const aOrder = a.sort_order ?? index;
      const bOrder = b.sort_order ?? index + dir;
      const { error: e1 } = await db
        .from("affiliate_marketing_assets")
        .update({ sort_order: bOrder })
        .eq("id", a.id);
      if (e1) throw e1;
      const { error: e2 } = await db
        .from("affiliate_marketing_assets")
        .update({ sort_order: aOrder })
        .eq("id", b.id);
      if (e2) throw e2;
    },
    onSuccess: () => invalidateKit(),
    onError: (err: any) =>
      toast({ title: "Reorder failed", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="min-h-screen bg-[#f3f4f6] p-3 sm:p-6">
      <div className="container mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-5 flex items-center gap-3">
          <button
            onClick={() => navigate("/admin")}
            className="p-2 rounded-md hover:bg-white/80 text-gray-700"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
              Per-Rep Marketing Kits
            </h1>
            <p className="text-xs sm:text-sm text-gray-600">
              Each active rep has 7 personal slots. Pick a rep, upload to each.
              Reps see only their own kit on <code className="text-cyan-600">/affiliate/marketing</code>.
            </p>
          </div>
        </div>

        {repsError ? (
          <ErrorBanner message={(repsError as any).message || "Couldn't load reps"} />
        ) : null}

        <div className="grid grid-cols-1 lg:grid-cols-[300px,1fr] gap-3 sm:gap-4">
          {/* LEFT: rep list */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-3 border-b border-gray-100">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Search reps…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 bg-gray-50 border-gray-200 text-gray-900"
                />
              </div>
              <div className="mt-2 text-[10px] uppercase tracking-wider font-bold text-gray-500">
                {filteredReps.length} of {reps.length} reps
              </div>
            </div>
            <div className="max-h-[60vh] lg:max-h-[70vh] overflow-y-auto p-2 space-y-1">
              {repsLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                </div>
              ) : filteredReps.length === 0 ? (
                <div className="text-center text-sm text-gray-500 py-8">
                  No reps match "{search}"
                </div>
              ) : (
                filteredReps.map((rep) => (
                  <button
                    key={rep.id}
                    onClick={() => setSelectedRepId(rep.id)}
                    className={[
                      "w-full text-left p-2.5 rounded-lg transition-colors flex items-center gap-3 border",
                      selectedRepId === rep.id
                        ? "bg-cyan-50 border-cyan-300"
                        : "bg-white border-transparent hover:bg-gray-50",
                    ].join(" ")}
                  >
                    {rep.headshot_url ? (
                      <img
                        src={rep.headshot_url}
                        alt={rep.full_name}
                        className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-fuchsia-500 to-blue-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                        {rep.full_name.charAt(0)}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm text-gray-900 truncate">
                        {rep.full_name}
                      </div>
                      <div className="text-[11px] text-gray-500 font-mono truncate">
                        {rep.referral_code}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* RIGHT: kit slots */}
          <div className="space-y-3">
            {!selectedRep ? (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-10 text-center text-gray-500">
                <ImageIcon className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                <div className="font-semibold text-gray-700">
                  Pick a rep on the left
                </div>
                <div className="text-sm">
                  Their 7-slot kit (Static 1, Static 2, Carousel, Reel, Email,
                  Landing, WPW Banner) will appear here.
                </div>
              </div>
            ) : (
              <>
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    {selectedRep.headshot_url ? (
                      <img
                        src={selectedRep.headshot_url}
                        alt={selectedRep.full_name}
                        className="w-10 h-10 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-fuchsia-500 to-blue-500 flex items-center justify-center text-white font-bold">
                        {selectedRep.full_name.charAt(0)}
                      </div>
                    )}
                    <div>
                      <div className="font-bold text-gray-900">
                        {selectedRep.full_name}
                      </div>
                      <div className="text-xs text-gray-500 font-mono">
                        Code: {selectedRep.referral_code}
                      </div>
                    </div>
                  </div>
                  <a
                    href="/affiliate/marketing"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs rounded-md bg-cyan-500 text-white px-3 py-1.5 font-semibold hover:bg-cyan-600"
                  >
                    👁 Preview rep view <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                <RepStripeCard key={selectedRep.id} rep={selectedRep} />

                {kitError ? (
                  <ErrorBanner
                    message={(kitError as any).message || "Couldn't load kit"}
                  />
                ) : null}

                {kitLoading ? (
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-10 text-center">
                    <Loader2 className="h-6 w-6 animate-spin text-cyan-500 mx-auto" />
                    <div className="text-sm text-gray-500 mt-2">
                      Loading kit…
                    </div>
                  </div>
                ) : kit.length === 0 ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
                    <AlertCircle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
                    <div className="font-bold text-amber-900">
                      No kit slots for {selectedRep.full_name}
                    </div>
                    <div className="text-sm text-amber-700 mt-1">
                      This rep is missing the 7-slot seed. Tap the button below
                      to create it.
                    </div>
                    <Button
                      className="mt-3 bg-amber-500 hover:bg-amber-600 text-white"
                      onClick={async () => {
                        try {
                          const { error } = await (db as any).rpc(
                            "seed_rep_marketing_kit",
                            { p_affiliate_id: selectedRep.id }
                          );
                          if (error) throw error;
                          toast({
                            title: "Seeded",
                            description: `7 kit slots created for ${selectedRep.full_name}`,
                          });
                          queryClient.invalidateQueries({
                            queryKey: ["rep-kit", selectedRep.id],
                          });
                        } catch (err: any) {
                          toast({
                            title: "Seed failed",
                            description: err.message,
                            variant: "destructive",
                          });
                        }
                      }}
                    >
                      Create 7-slot kit for this rep
                    </Button>
                  </div>
                ) : (
                  kit.map((slot, index) => {
                    const meta = metaFor(slot);
                    const Icon = meta.icon;
                    const hasFile = !!slot.file_url;
                    const custom = isCustomSlot(slot.kit_slot);
                    return (
                      <div
                        key={slot.id}
                        className={[
                          "bg-white rounded-xl shadow-sm border-2 p-4",
                          hasFile ? "border-emerald-200" : "border-gray-200",
                        ].join(" ")}
                      >
                        <div className="flex items-start gap-3 flex-wrap">
                          <div
                            className={`relative w-20 sm:w-24 ${meta.ratio} bg-gray-100 rounded-lg overflow-hidden flex-shrink-0`}
                          >
                            {slot.file_url ? (
                              slot.file_url.match(/\.(mp4|mov|webm)$/i) ? (
                                <video
                                  src={slot.file_url}
                                  className="w-full h-full object-cover"
                                  muted
                                  playsInline
                                />
                              ) : (
                                <img
                                  src={slot.file_url}
                                  alt={slot.title}
                                  className="w-full h-full object-cover"
                                />
                              )
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-gray-400">
                                <Icon className="w-5 h-5" />
                              </div>
                            )}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="font-bold text-sm text-gray-900">
                                  {slot.title}
                                </h3>
                                {hasFile ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                                    <CheckCircle2 className="w-3 h-3" />
                                    Filled
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                                    Needs upload
                                  </span>
                                )}
                                {custom && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-100 text-cyan-700">
                                    Custom
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <button
                                  type="button"
                                  aria-label="Move up"
                                  disabled={index === 0 || moveSlot.isPending}
                                  onClick={() => moveSlot.mutate({ index, dir: -1 })}
                                  className="p-1 rounded text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                                >
                                  <ChevronUp className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  aria-label="Move down"
                                  disabled={index === kit.length - 1 || moveSlot.isPending}
                                  onClick={() => moveSlot.mutate({ index, dir: 1 })}
                                  className="p-1 rounded text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                                >
                                  <ChevronDown className="w-4 h-4" />
                                </button>
                                {custom && (
                                  <button
                                    type="button"
                                    aria-label="Remove slot"
                                    disabled={deleteSlot.isPending}
                                    onClick={() => {
                                      if (window.confirm(`Remove "${slot.title}" from this rep's kit?`))
                                        deleteSlot.mutate(slot.id);
                                    }}
                                    className="p-1 rounded text-red-500 hover:bg-red-50 disabled:opacity-30"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                            </div>
                            <p className="text-xs text-gray-600 mt-0.5">
                              {slot.description}
                            </p>
                            <p className="text-[10px] text-gray-400 italic mt-1">
                              Recommended: {meta.recommended}
                            </p>

                            <div className="mt-3 flex items-center gap-2 flex-wrap">
                              <label
                                htmlFor={`up-${slot.id}`}
                                className="inline-flex items-center gap-1.5 cursor-pointer rounded-md bg-cyan-500 text-white px-3 py-1.5 text-xs font-semibold hover:bg-cyan-600"
                              >
                                <Upload className="w-3 h-3" />
                                {uploadingSlot === slot.id
                                  ? "Uploading…"
                                  : hasFile
                                  ? "Replace"
                                  : "Upload"}
                                <input
                                  id={`up-${slot.id}`}
                                  type="file"
                                  accept={meta.accept}
                                  className="hidden"
                                  disabled={uploadingSlot === slot.id}
                                  onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f) handleUpload(slot, f);
                                    e.target.value = "";
                                  }}
                                />
                              </label>

                              <details className="text-xs">
                                <summary className="cursor-pointer text-gray-500 hover:text-gray-900">
                                  …or paste URL
                                </summary>
                                <div className="mt-2 flex gap-2">
                                  <Input
                                    defaultValue={slot.file_url || ""}
                                    placeholder="https://…"
                                    className="text-xs h-8 bg-gray-50 border-gray-200 text-gray-900"
                                    onBlur={(e) => {
                                      if (
                                        e.target.value !== (slot.file_url || "")
                                      ) {
                                        saveUrl.mutate({
                                          id: slot.id,
                                          url: e.target.value,
                                        });
                                      }
                                    }}
                                  />
                                </div>
                              </details>

                              {hasFile && (
                                <a
                                  href={slot.file_url!}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-xs text-cyan-600 hover:underline inline-flex items-center gap-1"
                                >
                                  Open <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>

                            <SlotTextEditor
                              slot={slot}
                              saving={saveText.isPending}
                              onSave={(vals) =>
                                saveText.mutate({ id: slot.id, ...vals })
                              }
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}

                {kit.length > 0 && (
                  <div className="bg-white rounded-xl shadow-sm border border-dashed border-gray-300 p-4 flex items-center gap-3 flex-wrap">
                    <span className="text-sm font-semibold text-gray-700">
                      Add an extra slot:
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={addSlot.isPending}
                      onClick={() => addSlot.mutate({ assetType: "image" })}
                      className="gap-1.5 border-cyan-300 text-cyan-700 hover:bg-cyan-50"
                    >
                      <Plus className="w-3.5 h-3.5" /> Image slot
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={addSlot.isPending}
                      onClick={() => addSlot.mutate({ assetType: "video" })}
                      className="gap-1.5 border-cyan-300 text-cyan-700 hover:bg-cyan-50"
                    >
                      <Plus className="w-3.5 h-3.5" /> Video slot
                    </Button>
                    {addSlot.isPending && (
                      <Loader2 className="w-4 h-4 animate-spin text-cyan-500" />
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mb-3 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
      <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
      <div className="text-sm text-red-700 break-words">{message}</div>
    </div>
  );
}

function SlotTextEditor({
  slot,
  saving,
  onSave,
}: {
  slot: KitSlot;
  saving: boolean;
  onSave: (vals: { title: string; description: string; caption_template: string }) => void;
}) {
  const [title, setTitle] = useState(slot.title || "");
  const [description, setDescription] = useState(slot.description || "");
  const [caption, setCaption] = useState(slot.caption_template || "");

  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-gray-500 hover:text-gray-900 inline-flex items-center gap-1">
        <Pencil className="w-3 h-3" /> Edit title / description / caption
      </summary>
      <div className="mt-2 space-y-2 border-l-2 border-gray-100 pl-3">
        <div>
          <Label className="text-[11px] text-gray-500">Title</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-8 text-xs bg-gray-50 border-gray-200 text-gray-900"
          />
        </div>
        <div>
          <Label className="text-[11px] text-gray-500">Description</Label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-md bg-gray-50 border border-gray-200 text-gray-900 text-xs p-2"
          />
        </div>
        <div>
          <Label className="text-[11px] text-gray-500">
            Caption template (what the rep copies for social)
          </Label>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={3}
            placeholder="e.g. Custom wrap designs from $25 — link in bio 🔥"
            className="w-full rounded-md bg-gray-50 border border-gray-200 text-gray-900 text-xs p-2"
          />
        </div>
        <Button
          size="sm"
          disabled={saving}
          onClick={() =>
            onSave({ title, description, caption_template: caption })
          }
          className="gap-1.5 bg-gray-900 hover:bg-gray-700 text-white h-8"
        >
          {saving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          Save text
        </Button>
      </div>
    </details>
  );
}

function RepStripeCard({ rep }: { rep: Rep }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [onboarded, setOnboarded] = useState(!!rep.stripe_onboarded);
  const [hasAccount, setHasAccount] = useState(!!rep.stripe_account_id);
  const [link, setLink] = useState<string | null>(null);

  const invokeStripe = async (action: string) => {
    const { data, error } = await supabase.functions.invoke(
      "affiliate-stripe-connect",
      {
        body: {
          action,
          affiliate_id: rep.id,
          return_url: window.location.origin + "/affiliate/settings",
        },
      }
    );
    if (error) throw error;
    if ((data as any)?.error) throw new Error((data as any).error);
    return data as any;
  };

  const generate = async () => {
    setLoading(true);
    try {
      const d = await invokeStripe("create_account");
      if (d?.url) {
        setLink(d.url);
        setHasAccount(true);
        try {
          await navigator.clipboard.writeText(d.url);
        } catch {}
        toast({
          title: "Onboarding link ready",
          description: "Copied to clipboard — send it to the rep.",
        });
      }
    } catch (e: any) {
      toast({ title: "Stripe error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const openDashboard = async () => {
    setLoading(true);
    try {
      const d = await invokeStripe("create_login_link");
      if (d?.url) window.open(d.url, "_blank");
    } catch (e: any) {
      toast({ title: "Stripe error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const d = await invokeStripe("check_status");
      setHasAccount(!!d?.has_account);
      setOnboarded(!!d?.onboarded);
      toast({
        title: d?.onboarded
          ? "Connected — payouts enabled"
          : d?.has_account
          ? "Onboarding not finished"
          : "No Stripe account yet",
      });
    } catch (e: any) {
      toast({ title: "Stripe error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-gray-500" />
          <span className="font-bold text-sm text-gray-900">Stripe Payouts</span>
          {onboarded ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
              <CheckCircle2 className="w-3 h-3" /> Connected
            </span>
          ) : hasAccount ? (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
              Onboarding incomplete
            </span>
          ) : (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
              Not connected
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            disabled={loading}
            onClick={generate}
            className="gap-1.5 bg-cyan-500 hover:bg-cyan-600 text-white h-8"
          >
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <CreditCard className="w-3.5 h-3.5" />
            )}
            {hasAccount ? "Regenerate link" : "Connect Stripe"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={refresh}
            className="gap-1.5 h-8 border-gray-200 text-gray-700"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
          {hasAccount && (
            <Button
              size="sm"
              variant="outline"
              disabled={loading}
              onClick={openDashboard}
              className="gap-1.5 h-8 border-gray-200 text-gray-700"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Dashboard
            </Button>
          )}
        </div>
      </div>

      {link && (
        <div className="mt-3 flex gap-2">
          <Input
            readOnly
            value={link}
            className="text-xs h-8 bg-gray-50 border-gray-200 text-gray-900"
          />
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8 border-gray-200"
            onClick={() => {
              navigator.clipboard.writeText(link);
              toast({ title: "Copied" });
            }}
          >
            <Copy className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
