/**
 * CaptionAiPanel — "the copy on this is weak, fix it" in one place.
 *
 * Two buttons, because back-catalog content arrives in two states:
 *   WRITE IT   — the piece has no copy at all (an old reel someone exported,
 *                a photo off a phone). Writes a hook + caption from scratch,
 *                grounded in the image when there is one to read.
 *   REFINE IT  — copy exists but needs work. The reviewer types what to
 *                change and the brand voice does the rest.
 *
 * NOTHING here saves. Every result lands in the editor above it as a
 * proposal the human accepts, edits, or throws away — which is the point of a
 * review board. See `captionRefine.ts`.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sparkles, Wand2, Check, X } from "lucide-react";
import { toast } from "sonner";
import {
  writeCaption,
  refineCaption,
  loadHooksLibrary,
  HOOK_TYPES,
  type HookTypeKey,
  type CaptionDraft,
} from "@/lib/captionRefine";

export interface CaptionAiPanelProps {
  brand: string;
  /** Current caption in the editor — what "refine" works from. */
  caption: string;
  /** A still the model can read. Null for video-only content. */
  imageUrl?: string | null;
  /** "Reel" | "Post" | "Carousel" | "YouTube Thumbnail". */
  format?: string;
  /** What the piece shows, in the operator's words — grounds a from-scratch write. */
  context?: string;
  /** Accepted copy comes back here. The parent decides when to persist. */
  onAccept: (next: { caption: string; hook?: string; hashtags?: string[] }) => void;
}

export default function CaptionAiPanel({
  brand,
  caption,
  imageUrl,
  format = "Post",
  context,
  onAccept,
}: CaptionAiPanelProps) {
  const [busy, setBusy] = useState<"write" | "refine" | null>(null);
  const [instruction, setInstruction] = useState("");
  const [hookType, setHookType] = useState<HookTypeKey>("pain_aware");
  const [proposal, setProposal] = useState<{ caption: string; hook?: string; hashtags?: string[] } | null>(null);

  const runWrite = async () => {
    setBusy("write");
    setProposal(null);
    try {
      const hooksLibrary = await loadHooksLibrary(brand);
      const draft: CaptionDraft = await writeCaption({
        brand,
        imageUrl,
        format,
        hookType,
        context,
        hooksLibrary,
      });
      setProposal({ caption: draft.caption, hook: draft.hook });
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const runRefine = async () => {
    if (!caption.trim()) {
      toast.error("Nothing to refine yet — use “Write it for me” instead.");
      return;
    }
    setBusy("refine");
    setProposal(null);
    try {
      const out = await refineCaption({ brand, caption, instruction });
      setProposal({ caption: out.caption, hashtags: out.hashtags });
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Refine the hook &amp; caption
        </span>
        {!imageUrl && (
          <span className="text-[10px] text-slate-400">
            no still to read — writing from your notes
          </span>
        )}
      </div>

      {/* Write from scratch */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={hookType}
          onChange={(e) => setHookType(e.target.value as HookTypeKey)}
          className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
          aria-label="Hook style"
        >
          {HOOK_TYPES.map((h) => (
            <option key={h.key} value={h.key}>{h.label} hook</option>
          ))}
        </select>
        <Button
          size="sm"
          variant="outline"
          onClick={runWrite}
          disabled={busy !== null}
          className="h-8 border-slate-300 text-xs"
        >
          <Sparkles className="mr-1 h-3 w-3" />
          {busy === "write" ? "Writing…" : "Write it for me"}
        </Button>
      </div>

      {/* Refine what's there */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !busy) { e.preventDefault(); runRefine(); } }}
          placeholder="Punchier · shorter · add a CTA · drop the emoji"
          className="h-8 min-w-[180px] flex-1 border-slate-300 bg-white text-xs text-slate-900"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={runRefine}
          disabled={busy !== null || !instruction.trim()}
          className="h-8 border-slate-300 text-xs"
        >
          <Wand2 className="mr-1 h-3 w-3" />
          {busy === "refine" ? "Refining…" : "Refine"}
        </Button>
      </div>

      {/* The proposal — read it, then take it or leave it. */}
      {proposal && (
        <div className="space-y-2 rounded border border-blue-200 bg-white p-2">
          {proposal.hook && (
            <div className="text-xs">
              <span className="text-slate-400">Hook:</span>{" "}
              <span className="font-semibold text-slate-900">{proposal.hook}</span>
            </div>
          )}
          <p className="whitespace-pre-wrap text-sm text-slate-700">{proposal.caption}</p>
          {!!proposal.hashtags?.length && (
            <p className="text-xs text-blue-600">{proposal.hashtags.join(" ")}</p>
          )}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => { onAccept(proposal); setProposal(null); toast.success("Dropped into the caption — edit it, then save."); }}
              className="h-7 border-0 bg-gradient-to-r from-blue-600 to-pink-600 text-xs text-white"
            >
              <Check className="mr-1 h-3 w-3" />
              Use this
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setProposal(null)}
              className="h-7 text-xs text-slate-500"
            >
              <X className="mr-1 h-3 w-3" />
              Discard
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
