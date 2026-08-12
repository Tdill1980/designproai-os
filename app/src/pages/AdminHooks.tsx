// AdminHooks — the AI Hooks Manager (/admin/hooks).
//
// The per-brand hook library, editable by the team and seeded by AI. This is
// the single source of truth the content generators read from:
//   • ✨ AI-suggest  → marketing-agent action:"hooks" (10 ranked, brand-voiced)
//   • add / edit / delete your own
//   • saved per brand to public.content_hooks
// Content Studio (static/reels/carousels) + Creator (long-form) pull the hook
// picker from here.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, Plus, Trash2, Check, X } from "lucide-react";
import { toast } from "sonner";
import MarketingSuiteGuide from "@/components/admin/MarketingSuiteGuide";

const BRANDS: { slug: string; label: string }[] = [
  { slug: "weprintwraps", label: "WePrintWraps" },
  { slug: "restylepro", label: "RestyleProAI" },
  { slug: "designproai", label: "DesignProAI" },
  { slug: "wraptvworld", label: "WrapTVWorld" },
  { slug: "inkandedge", label: "Ink & Edge" },
  { slug: "thewrap", label: "The Wrap" },
];

interface Hook {
  id: string;
  brand: string;
  text: string;
  source: "ai" | "manual";
  score?: number | null;
  active: boolean;
}

interface Suggestion { text: string; style?: string; score?: number }

export default function AdminHooks() {
  const qc = useQueryClient();
  const [brand, setBrand] = useState("weprintwraps");
  const [topic, setTopic] = useState("");
  const [newHook, setNewHook] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  const { data: hooks, isLoading } = useQuery({
    queryKey: ["content-hooks", brand],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("content_hooks")
        .select("id, brand, text, source, score, active")
        .eq("brand", brand)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Hook[];
    },
  });

  // ✨ AI-suggest — the existing Hook Creator (marketing-agent). Results go to a
  // staging list; nothing is saved until the team clicks Save on a suggestion.
  const suggest = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("marketing-agent", {
        body: { action: "hooks", brand, ...(topic.trim() ? { topic: topic.trim() } : {}), count: 10 },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return (data?.hooks ?? []) as Suggestion[];
    },
    onSuccess: (s) => {
      setSuggestions(s);
      if (!s.length) toast.info("No hooks came back — try a topic (e.g. 'fleet wrap before/after').");
    },
    onError: (e: any) => toast.error(e?.message || "AI suggest failed"),
  });

  const saveHook = useMutation({
    mutationFn: async (h: { text: string; source: "ai" | "manual"; score?: number }) => {
      const { error } = await (supabase as any).from("content_hooks").insert({
        brand, text: h.text, source: h.source, score: h.score ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["content-hooks", brand] }),
    onError: (e: any) => toast.error(e?.message || "Save failed"),
  });

  const updateHook = useMutation({
    mutationFn: async (p: { id: string; patch: Partial<Hook> }) => {
      const { error } = await (supabase as any)
        .from("content_hooks")
        .update({ ...p.patch, updated_at: new Date().toISOString() })
        .eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["content-hooks", brand] }),
    onError: (e: any) => toast.error(e?.message || "Update failed"),
  });

  const deleteHook = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("content_hooks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["content-hooks", brand] }),
    onError: (e: any) => toast.error(e?.message || "Delete failed"),
  });

  const addManual = () => {
    const t = newHook.trim();
    if (!t) return;
    saveHook.mutate({ text: t, source: "manual" }, { onSuccess: () => setNewHook("") });
  };

  const startEdit = (h: Hook) => { setEditingId(h.id); setEditText(h.text); };
  const commitEdit = () => {
    if (!editingId) return;
    const t = editText.trim();
    if (t) updateHook.mutate({ id: editingId, patch: { text: t } });
    setEditingId(null);
  };

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto max-w-4xl px-4 py-6">
        <h1 className="text-2xl font-bold">
          AI Hooks <span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">Manager</span>
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          Your per-brand hook library. AI suggests, you curate — it feeds Content Studio and Creator.
        </p>
        <div className="mt-4"><MarketingSuiteGuide /></div>

        {/* Brand picker */}
        <div className="mt-5 flex flex-wrap gap-2">
          {BRANDS.map((b) => (
            <button key={b.slug} onClick={() => { setBrand(b.slug); setSuggestions([]); }}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${brand === b.slug
                ? "border-transparent bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white"
                : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"}`}>
              {b.label}
            </button>
          ))}
        </div>

        {/* AI suggest */}
        <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">✨ AI-suggest hooks</div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={topic} onChange={(e) => setTopic(e.target.value)}
              placeholder="Optional topic — e.g. 'fleet wrap before/after' (blank = brand's core voice)"
              className="bg-white text-gray-900 border-gray-300 placeholder:text-gray-400" />
            <Button onClick={() => suggest.mutate()} disabled={suggest.isPending}
              className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white font-semibold hover:opacity-90 shrink-0">
              {suggest.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              Suggest 10
            </Button>
          </div>

          {suggestions.length > 0 && (
            <div className="mt-3 space-y-2">
              {suggestions.map((s, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
                  {s.score != null && <Badge className="bg-[#ec4899] text-white shrink-0">{s.score}</Badge>}
                  <span className="flex-1 text-sm">{s.text}</span>
                  <Button size="sm" variant="outline" className="shrink-0 border-gray-300"
                    onClick={() => saveHook.mutate({ text: s.text, source: "ai", score: s.score },
                      { onSuccess: () => setSuggestions((prev) => prev.filter((_, j) => j !== i)) })}>
                    <Plus className="mr-1 h-3.5 w-3.5" /> Save
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add manual */}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Input value={newHook} onChange={(e) => setNewHook(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addManual()}
            placeholder="Write your own hook…"
            className="bg-white text-gray-900 border-gray-300 placeholder:text-gray-400" />
          <Button onClick={addManual} disabled={saveHook.isPending} variant="outline" className="shrink-0 border-gray-300">
            <Plus className="mr-1 h-4 w-4" /> Add hook
          </Button>
        </div>

        {/* Library */}
        <div className="mt-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            {BRANDS.find((b) => b.slug === brand)?.label} hooks ({hooks?.length ?? 0})
          </div>
          {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
          {!isLoading && (hooks?.length ?? 0) === 0 && (
            <p className="text-sm text-gray-500">No hooks yet — use ✨ AI-suggest or add your own above.</p>
          )}
          <div className="space-y-2">
            {(hooks ?? []).map((h) => (
              <div key={h.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${h.active ? "border-gray-200 bg-white" : "border-gray-200 bg-gray-100 opacity-60"}`}>
                <Badge variant="outline" className={`shrink-0 ${h.source === "ai" ? "border-[#3b82f6] text-[#3b82f6]" : "border-gray-300 text-gray-600"}`}>
                  {h.source === "ai" ? "AI" : "you"}
                </Badge>
                {editingId === h.id ? (
                  <>
                    <Input value={editText} onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && commitEdit()}
                      className="flex-1 bg-white text-gray-900 border-gray-300" autoFocus />
                    <Button size="sm" variant="ghost" className="px-2" onClick={commitEdit}><Check className="h-4 w-4 text-emerald-600" /></Button>
                    <Button size="sm" variant="ghost" className="px-2" onClick={() => setEditingId(null)}><X className="h-4 w-4 text-gray-500" /></Button>
                  </>
                ) : (
                  <>
                    <button className="flex-1 text-left text-sm" onClick={() => startEdit(h)} title="Click to edit">{h.text}</button>
                    <button className="shrink-0 text-xs text-gray-400 hover:text-gray-700"
                      onClick={() => updateHook.mutate({ id: h.id, patch: { active: !h.active } })}
                      title={h.active ? "Mute (hide from pickers)" : "Unmute"}>
                      {h.active ? "mute" : "unmute"}
                    </button>
                    <Button size="sm" variant="ghost" className="px-2" onClick={() => deleteHook.mutate(h.id)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
