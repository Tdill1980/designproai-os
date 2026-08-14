/**
 * /admin/wotw-winners — manage the Wrap of the Week winners that power the
 * WPW × RestyleProAI Wrap Calculator carousel (embedded on weprintwraps.com).
 *
 * Add / edit / reorder / delete winners; upload an image OR paste a URL; edit
 * all text; toggle active. Writes to public.wotw_winners (admin RLS). The
 * public weprintwraps.com embed reads the live list via the wotw-winners edge
 * function, so edits here show for all visitors within ~a minute.
 *
 * Admin tooling stays on the dark theme (per the White UI standard).
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Trash2, Upload, Plus, Save, Loader2, Trophy, ExternalLink } from "lucide-react";

// Table isn't in the generated types yet — cast the client for this page.
const sb = supabase as any;

interface Winner {
  id: string;
  handle: string;
  vehicle: string | null;
  blurb: string | null;
  image_url: string;
  link_url: string | null;
  week_label: string | null;
  sort_order: number;
  is_active: boolean;
}

const BLANK: Omit<Winner, "id"> = {
  handle: "",
  vehicle: "",
  blurb: "",
  image_url: "",
  link_url: "",
  week_label: "This Week",
  sort_order: 0,
  is_active: true,
};

const field =
  "bg-neutral-900 border-neutral-700 text-white placeholder:text-neutral-500";

export default function AdminWotwWinners() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Omit<Winner, "id">>({ ...BLANK });
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  const { data: winners = [], isLoading } = useQuery({
    queryKey: ["wotw_winners_admin"],
    queryFn: async (): Promise<Winner[]> => {
      const { data, error } = await sb
        .from("wotw_winners")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Winner[];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["wotw_winners_admin"] });

  const createMut = useMutation({
    mutationFn: async (row: Omit<Winner, "id">) => {
      const { error } = await sb.from("wotw_winners").insert(row);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Winner added" });
      setDraft({ ...BLANK, sort_order: (winners.length ? Math.max(...winners.map((w) => w.sort_order)) + 1 : 0) });
      invalidate();
    },
    onError: (e: any) => toast({ title: "Couldn't add winner", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: async (row: Winner) => {
      const { id, ...rest } = row;
      const { error } = await sb.from("wotw_winners").update(rest).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Saved" }); invalidate(); },
    onError: (e: any) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("wotw_winners").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Deleted" }); invalidate(); },
    onError: (e: any) => toast({ title: "Couldn't delete", description: e.message, variant: "destructive" }),
  });

  async function uploadImage(file: File): Promise<string | null> {
    const ext = file.name.split(".").pop() || "jpg";
    const path = `winners/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from("wotw").upload(path, file, { upsert: true });
    if (error) { toast({ title: "Upload failed", description: error.message, variant: "destructive" }); return null; }
    const { data } = supabase.storage.from("wotw").getPublicUrl(path);
    return data.publicUrl;
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="h-1.5 bg-gradient-to-r from-[#3b82f6] to-[#ec4899]" />
      <div className="max-w-4xl mx-auto px-5 py-8">
        <button onClick={() => navigate("/admin")} className="inline-flex items-center gap-1.5 text-sm text-neutral-400 hover:text-white mb-6">
          <ArrowLeft className="w-4 h-4" /> Admin
        </button>

        <div className="flex items-center gap-3 mb-2">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#3b82f6] to-[#ec4899] flex items-center justify-center">
            <Trophy className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold">Wrap of the Week — Winners</h1>
            <p className="text-sm text-neutral-400">
              Powers the calculator carousel on weprintwraps.com. Edits go live within ~a minute.
            </p>
          </div>
        </div>

        {/* Add new */}
        <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-950 p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-neutral-300 mb-4 flex items-center gap-2">
            <Plus className="w-4 h-4 text-[#ec4899]" /> Add a winner
          </h2>
          <WinnerFields
            value={draft}
            onChange={setDraft}
            onUpload={async (f) => { const url = await uploadImage(f); if (url) setDraft((d) => ({ ...d, image_url: url })); }}
            uploading={uploadingId === "new"}
            setUploading={(v) => setUploadingId(v ? "new" : null)}
          />
          <Button
            className="mt-4 bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white border-0"
            disabled={!draft.handle || !draft.image_url || createMut.isPending}
            onClick={() => createMut.mutate(draft)}
          >
            {createMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
            Add winner
          </Button>
        </div>

        {/* Existing */}
        <div className="mt-8 space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wide text-neutral-400">
            {isLoading ? "Loading…" : `${winners.length} winner${winners.length === 1 ? "" : "s"}`}
          </h2>
          {winners.map((w) => (
            <WinnerRow
              key={w.id}
              winner={w}
              onSave={(row) => updateMut.mutate(row)}
              onDelete={() => { if (confirm(`Delete ${w.handle}?`)) deleteMut.mutate(w.id); }}
              onUpload={uploadImage}
              saving={updateMut.isPending}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function WinnerFields({
  value, onChange, onUpload, uploading, setUploading,
}: {
  value: Omit<Winner, "id">;
  onChange: (v: any) => void;
  onUpload: (f: File) => Promise<void>;
  uploading: boolean;
  setUploading: (v: boolean) => void;
}) {
  const set = (k: string, v: any) => onChange({ ...value, [k]: v });
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        <Label className="text-neutral-400 text-xs">Handle *</Label>
        <Input className={field} value={value.handle} onChange={(e) => set("handle", e.target.value)} placeholder="@pappiyanni" />
      </div>
      <div>
        <Label className="text-neutral-400 text-xs">Week label</Label>
        <Input className={field} value={value.week_label ?? ""} onChange={(e) => set("week_label", e.target.value)} placeholder="This Week" />
      </div>
      <div className="sm:col-span-2">
        <Label className="text-neutral-400 text-xs">Vehicle</Label>
        <Input className={field} value={value.vehicle ?? ""} onChange={(e) => set("vehicle", e.target.value)} placeholder="Purple BMW M3 — WPW × Paint Is Dead" />
      </div>
      <div className="sm:col-span-2">
        <Label className="text-neutral-400 text-xs">Blurb</Label>
        <Textarea className={field} rows={2} value={value.blurb ?? ""} onChange={(e) => set("blurb", e.target.value)} placeholder="Short caption shown under the handle." />
      </div>
      <div className="sm:col-span-2">
        <Label className="text-neutral-400 text-xs">Image URL *</Label>
        <div className="flex gap-2">
          <Input className={field} value={value.image_url} onChange={(e) => set("image_url", e.target.value)} placeholder="Paste a URL or upload →" />
          <label className="shrink-0">
            <input type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setUploading(true); await onUpload(f); setUploading(false); } }} />
            <span className="inline-flex items-center gap-1.5 h-10 px-3 rounded-md border border-neutral-700 bg-neutral-900 text-sm cursor-pointer hover:border-[#ec4899]">
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Upload
            </span>
          </label>
        </div>
        {value.image_url ? <img src={value.image_url} alt="" className="mt-2 h-24 rounded-lg border border-neutral-800 object-cover" /> : null}
      </div>
      <div>
        <Label className="text-neutral-400 text-xs">Link URL (optional)</Label>
        <Input className={field} value={value.link_url ?? ""} onChange={(e) => set("link_url", e.target.value)} placeholder="https://instagram.com/…" />
      </div>
      <div className="flex items-end gap-4">
        <div className="flex-1">
          <Label className="text-neutral-400 text-xs">Sort order</Label>
          <Input type="number" className={field} value={value.sort_order} onChange={(e) => set("sort_order", Number(e.target.value))} />
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Switch checked={value.is_active} onCheckedChange={(v) => set("is_active", v)} />
          <span className="text-sm text-neutral-300">Active</span>
        </div>
      </div>
    </div>
  );
}

function WinnerRow({
  winner, onSave, onDelete, onUpload, saving,
}: {
  winner: Winner;
  onSave: (w: Winner) => void;
  onDelete: () => void;
  onUpload: (f: File) => Promise<string | null>;
  saving: boolean;
}) {
  const [local, setLocal] = useState<Winner>(winner);
  const [uploading, setUploading] = useState(false);
  const dirty = JSON.stringify(local) !== JSON.stringify(winner);
  return (
    <div className={`rounded-2xl border p-5 ${winner.is_active ? "border-neutral-800 bg-neutral-950" : "border-neutral-900 bg-neutral-950/50 opacity-70"}`}>
      <WinnerFields
        value={local}
        onChange={(v) => setLocal({ ...v, id: winner.id })}
        onUpload={async (f) => { setUploading(true); const url = await onUpload(f); if (url) setLocal((l) => ({ ...l, image_url: url })); setUploading(false); }}
        uploading={uploading}
        setUploading={setUploading}
      />
      <div className="flex items-center justify-between mt-4">
        <div className="flex items-center gap-3">
          <Button className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white border-0" disabled={!dirty || saving} onClick={() => onSave(local)}>
            <Save className="w-4 h-4 mr-2" /> Save
          </Button>
          {winner.link_url ? (
            <a href={winner.link_url} target="_blank" rel="noopener noreferrer" className="text-xs text-neutral-400 hover:text-white inline-flex items-center gap-1">
              <ExternalLink className="w-3 h-3" /> link
            </a>
          ) : null}
        </div>
        <Button variant="ghost" className="text-red-400 hover:text-red-300 hover:bg-red-950/40" onClick={onDelete}>
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
