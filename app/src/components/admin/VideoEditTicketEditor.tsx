import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  VIDEO_EDIT_FILE_ACCEPT,
  WRAPTV_COLOR_LOGO_ASSET,
  WRAPTV_COLOR_LOGO_SHA256,
  defaultVideoEditTicket,
  editTicketFromGenerationMeta,
  nextVideoEditTicketState,
  validateVideoEditFile,
  validateVideoEditTicket,
  videoEditBrandForSeries,
  withVideoEditTicket,
  type VideoEditOutputKey,
  type VideoEditSeries,
  type VideoEditTicket,
} from "@/lib/videoEditTicket";
import { uploadVideoEditSource } from "@/lib/videoEditTicketUpload";

interface TicketCard {
  id: string;
  brand: string;
  generation_meta?: Record<string, unknown> | null;
}

interface Props {
  item: TicketCard;
  onSaved: () => void;
  initiallyOpen?: boolean;
}

const SERIES_LABELS: Array<[VideoEditSeries, string]> = [
  ["behind_the_install", "Behind the Install — music video"],
  ["behind_the_brand", "Behind the Brand — documentary / talking"],
  ["weprintwraps", "WePrintWraps content"],
];

function syncLockedFields(ticket: VideoEditTicket): VideoEditTicket {
  const bti = ticket.series === "behind_the_install";
  const primary: VideoEditOutputKey = ticket.outputs.longform.enabled ? "longform" : "reel";
  const primaryOutput = ticket.outputs[primary];
  return {
    ...ticket,
    aspect_ratio: primaryOutput.aspect_ratio,
    music_url: primaryOutput.music_url,
    music_title: primaryOutput.music_title,
    ticker_enabled: bti,
    ticker: {
      enabled: bti,
      moving: bti,
      installer_handle: ticket.installer_handle.trim(),
      installer_location: ticket.installer_location.trim(),
      show_song_title: bti,
    },
    logo_asset: WRAPTV_COLOR_LOGO_ASSET,
    logo_sha256: WRAPTV_COLOR_LOGO_SHA256,
    logo_locked: true,
  };
}

export default function VideoEditTicketEditor({ item, onSaved, initiallyOpen = false }: Props) {
  const stored = useMemo(() => editTicketFromGenerationMeta(item.generation_meta), [item.generation_meta]);
  const [open, setOpen] = useState(initiallyOpen || !!stored);
  const [ticket, setTicket] = useState<VideoEditTicket>(() => stored || defaultVideoEditTicket());
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const localPreviewUrl = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file]);

  useEffect(() => {
    return () => {
      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    };
  }, [localPreviewUrl]);

  useEffect(() => {
    const next = editTicketFromGenerationMeta(item.generation_meta);
    setTicket(next || defaultVideoEditTicket());
    setOpen(initiallyOpen || !!next);
    setFile(null);
    setUploadPercent(0);
  }, [item.id, item.generation_meta, initiallyOpen]);

  const patchOutput = (key: VideoEditOutputKey, patch: Partial<VideoEditTicket["outputs"][VideoEditOutputKey]>) => {
    setTicket((current) => ({
      ...current,
      outputs: { ...current.outputs, [key]: { ...current.outputs[key], ...patch } },
    }));
  };

  const save = async (forcedState?: VideoEditTicket["state"]) => {
    if (file) {
      const fileError = validateVideoEditFile(file);
      if (fileError) { toast.error(fileError); return; }
    }
    const locked = syncLockedFields(ticket);
    const expectedBrand = videoEditBrandForSeries(locked.series);
    if (item.brand.trim().toLowerCase() !== expectedBrand) {
      toast.error(`${locked.series === "weprintwraps" ? "WePrintWraps" : "WrapTVWorld"} owns this series. Create or open the ticket on that brand's card.`);
      return;
    }
    // Reopening must always work: an incomplete/invalid brief is precisely
    // why a completed or in-flight ticket may need to be reopened.
    if (forcedState !== "draft") {
      const ticketError = validateVideoEditTicket(locked);
      if (ticketError) { toast.error(ticketError); return; }
    }

    setSaving(true);
    setUploadPercent(0);
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) throw new Error("Sign in again before editing this ticket.");

      // Re-read first so saving one field never overwrites metadata another
      // Content OS process attached while this card was open. The exact brand
      // predicate prevents a stale/misrouted card from crossing brand lanes.
      const { data: row, error: rowError } = await (supabase as any)
        .from("agent_social_posts")
        .select("id, brand, generation_meta")
        .eq("id", item.id)
        .eq("brand", item.brand)
        .maybeSingle();
      if (rowError) throw rowError;
      if (!row || row.brand !== item.brand) throw new Error("This card no longer belongs to the selected brand. Refresh and try again.");

      let next: VideoEditTicket = {
        ...locked,
        owner_id: locked.owner_id || userData.user.id,
        state: forcedState || locked.state,
        revision: Math.max(1, locked.revision + 1),
        updated_at: new Date().toISOString(),
      };

      // Persist the ticket shell before uploading. Storage policy checks this
      // exact card id + brand + owner path; no service-role key is involved.
      const persist = async (value: VideoEditTicket) => {
        const meta = withVideoEditTicket(row.generation_meta, value);
        const { data: saved, error } = await (supabase as any)
          .from("agent_social_posts")
          .update({
            generation_meta: meta,
            post_type: "video_edit_ticket",
            updated_at: new Date().toISOString(),
          })
          .eq("id", item.id)
          .eq("brand", item.brand)
          .select("id, brand")
          .single();
        if (error) throw error;
        if (!saved || saved.brand !== item.brand) throw new Error("Ticket save did not match this brand card.");
      };

      await persist(next);

      if (file) {
        const uploaded = await uploadVideoEditSource({
          file,
          brand: item.brand,
          postId: item.id,
          onProgress: setUploadPercent,
        });
        next = {
          ...next,
          source_video_url: uploaded.publicUrl,
          state: forcedState || nextVideoEditTicketState({ ...next, source_video_url: uploaded.publicUrl }),
          progress: "Source uploaded — edit brief ready",
          updated_at: new Date().toISOString(),
        };
        await persist(next);
      } else if (!forcedState || forcedState === "draft") {
        next = { ...next, state: forcedState || nextVideoEditTicketState(next) };
        await persist(next);
      }

      setTicket(next);
      setFile(null);
      toast.success(forcedState === "draft" ? "Video edit ticket reopened." : "Video edit ticket saved on this card.");
      onSaved();
    } catch (error: any) {
      toast.error(error?.message || "Video edit ticket could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  if (!open && !stored) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2.5 w-full rounded-lg border border-dashed border-fuchsia-300 bg-fuchsia-50 px-3 py-2 text-left text-xs font-bold text-fuchsia-800 hover:border-fuchsia-500"
      >
        🎬 Make this card a video edit ticket
      </button>
    );
  }

  const lockedForRender = ticket.state === "rendering" || ticket.state === "complete";

  return (
    <div className="mt-2.5 rounded-lg border border-fuchsia-200 bg-fuchsia-50/60 p-3 text-xs text-gray-700">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-extrabold uppercase tracking-wide text-fuchsia-800">🎬 Video edit ticket</span>
        <span className="rounded-full bg-white px-2 py-0.5 font-bold text-fuchsia-700">{ticket.state.replaceAll("_", " ")}</span>
        {ticket.progress && <span className="text-[11px] text-gray-500">{ticket.progress}</span>}
        {!stored && (
          <button type="button" onClick={() => setOpen(false)} className="ml-auto text-gray-500 hover:text-gray-800">Cancel</button>
        )}
      </div>

      {lockedForRender && (
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900">
          {ticket.state === "rendering" ? "Rendering is in progress." : "This ticket is complete."} Reopen it before changing the brief.
        </div>
      )}

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="font-semibold text-gray-700">
          Series
          <select
            value={ticket.series}
            disabled={lockedForRender || saving}
            onChange={(event) => {
              const nextSeries = event.target.value as VideoEditSeries;
              setTicket((current) => syncLockedFields({ ...current, series: nextSeries }));
            }}
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 font-normal"
          >
            {SERIES_LABELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>

        <label className="font-semibold text-gray-700">
          Source video
          <span className="mt-1 flex min-h-8 items-center rounded-md border border-gray-300 bg-white px-2 py-1.5 font-normal">
            <span className="min-w-0 flex-1 truncate">{file?.name || (ticket.source_video_url ? "Source attached" : "No source attached")}</span>
            <span className="ml-2 cursor-pointer font-bold text-fuchsia-700">
              {ticket.source_video_url ? "Replace" : "Attach"}
              <input
                type="file"
                accept={VIDEO_EDIT_FILE_ACCEPT}
                disabled={lockedForRender || saving}
                className="hidden"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
              />
            </span>
          </span>
        </label>
      </div>

      {(ticket.source_video_url || file) && (
        <div className="mt-2 rounded-md bg-slate-950 p-1">
          <video
            src={localPreviewUrl || ticket.source_video_url}
            controls
            playsInline
            preload="metadata"
            className="max-h-48 w-full object-contain"
          />
        </div>
      )}

      <div className="mt-3 font-bold text-gray-800">Outputs</div>
      <div className="mt-1 grid gap-2 md:grid-cols-2">
        {(["longform", "reel"] as const).map((key) => {
          const out = ticket.outputs[key];
          return (
            <div key={key} className="rounded-md border border-gray-200 bg-white p-2">
              <label className="flex items-center gap-2 font-bold">
                <input
                  type="checkbox"
                  checked={out.enabled}
                  disabled={lockedForRender || saving}
                  onChange={(event) => patchOutput(key, { enabled: event.target.checked })}
                />
                {key === "longform" ? "16:9 longform / website" : "9:16 reel / short"}
              </label>
              {out.enabled && (
                <>
                  <select
                    value={out.music_mode}
                    disabled={lockedForRender || saving}
                    onChange={(event) => patchOutput(key, { music_mode: event.target.value as "auto_unique" | "manual" })}
                    className="mt-2 w-full rounded border border-gray-300 px-2 py-1"
                  >
                    <option value="auto_unique">Auto — next unique WrapTV song</option>
                    <option value="manual">Choose this output's song</option>
                  </select>
                  {out.music_mode === "manual" && (
                    <div className="mt-1.5 space-y-1.5">
                      <input
                        value={out.music_title}
                        disabled={lockedForRender || saving}
                        onChange={(event) => patchOutput(key, { music_title: event.target.value })}
                        placeholder="Song title"
                        className="w-full rounded border border-gray-300 px-2 py-1"
                      />
                      <input
                        value={out.music_url}
                        disabled={lockedForRender || saving}
                        onChange={(event) => patchOutput(key, { music_url: event.target.value })}
                        placeholder="Music URL (from song library)"
                        className="w-full rounded border border-gray-300 px-2 py-1"
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {ticket.series === "behind_the_install" && (
        <div className="mt-3 rounded-md border border-cyan-200 bg-cyan-50 p-2">
          <div className="font-bold text-cyan-950">Moving bottom ticker — required for BTI</div>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            <input
              value={ticket.installer_handle}
              disabled={lockedForRender || saving}
              onChange={(event) => setTicket((current) => ({ ...current, installer_handle: event.target.value }))}
              placeholder="Installer/shop Instagram — @handle"
              className="rounded border border-cyan-300 bg-white px-2 py-1.5"
            />
            <input
              value={ticket.installer_location}
              disabled={lockedForRender || saving}
              onChange={(event) => setTicket((current) => ({ ...current, installer_location: event.target.value }))}
              placeholder="City, State — or Country"
              className="rounded border border-cyan-300 bg-white px-2 py-1.5"
            />
          </div>
          <div className="mt-1 text-[10px] text-cyan-800">The ticker stays moving and shows installer credit, location, and the output's song title.</div>
        </div>
      )}

      <label className="mt-3 block font-bold text-gray-800">
        Requested edits
        <textarea
          value={ticket.requested_edits}
          disabled={lockedForRender || saving}
          onChange={(event) => setTicket((current) => ({ ...current, requested_edits: event.target.value }))}
          rows={3}
          placeholder="Hook, opening shot, trims, pacing, spoken sections, crop/reframe, CTA…"
          className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 font-normal"
        />
      </label>

      <div className="mt-2 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] text-emerald-900">
        <span className="font-bold">Logo locked:</span>
        <span>official colored WrapTVWorld logo · top right</span>
        <code className="hidden text-[9px] text-emerald-700 xl:inline">{WRAPTV_COLOR_LOGO_ASSET}</code>
      </div>

      {saving && file && <div className="mt-2 text-[11px] font-semibold text-fuchsia-700">Uploading source… {uploadPercent}%</div>}
      <div className="mt-3 flex flex-wrap gap-2">
        {!lockedForRender && (
          <Button size="sm" disabled={saving} onClick={() => save()} className="bg-fuchsia-700 text-white hover:bg-fuchsia-800">
            {saving ? (file ? `Uploading ${uploadPercent}%` : "Saving…") : "Save edit ticket"}
          </Button>
        )}
        {lockedForRender && (
          <Button size="sm" variant="outline" disabled={saving} onClick={() => save("draft")}>
            {saving ? "Reopening…" : "Reopen for changes"}
          </Button>
        )}
        {ticket.output_url && (
          <a href={ticket.output_url} target="_blank" rel="noreferrer" className="inline-flex items-center text-xs font-bold text-blue-700 hover:underline">
            Watch current output ↗
          </a>
        )}
      </div>
    </div>
  );
}
