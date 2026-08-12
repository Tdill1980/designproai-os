/**
 * useFootageIdeas — the I/O half of the footage-first ideas lane.
 *
 * Fetches raw moments from `marketing-agent`, runs them through the PURE rules
 * in `src/lib/footageIdeas.ts` (music gate, Whisper-artifact gates, the
 * speech↔vision join, viral + interest ranking, per-clip dedupe), and exposes
 * the three actions the lane needs.
 *
 * The split is deliberate and matches `hookEngine.ts` / `ideaFanOut.ts`: rules
 * that decide what a human sees live in a pure module with tests; this file only
 * moves bytes. A gate implemented inside a component is a gate nobody can run in
 * a test.
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  buildFootageLane, generationTargets, suppressionSummary, emptyReason,
  GENERATE_MAX_CLIPS,
  type FootageMoment, type FootageLane, type RankedMoment,
} from "@/lib/footageIdeas";

interface MomentsResponse {
  moments: FootageMoment[];
  clips: number;
  music_excluded: number;
  note?: string;
}

export interface FootageApproveResult {
  hook_id: string;
  reused_hook: boolean;
  signals: string;
  evidence: {
    clip: string | null;
    start_time: number | null;
    quote: string | null;
    visual: string[];
  };
  /** …plus everything actionIdeaApprove returns, because the footage lane
   * hands the hook to the EXISTING fan-out rather than duplicating it. */
  drafts?: Array<{ platform: string }>;
  builds?: Array<{ aspect: string; surfaces: string[] }>;
  build_gaps?: string[];
  media_match?: { matchedOn: string[]; label: string | null } | null;
}

export interface FootageGenerateResult {
  generated: Array<{
    hook_id: string; hook: string; why: string; clip: string | null;
    start_time: number | null; pillar: string; signals: string;
    evidence_quote: string | null; evidence_visual: string[];
  }>;
  skipped: Array<{ moment_id: string; why: string }>;
  requested: number;
  note?: string | null;
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("marketing-agent", { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export function useFootageIdeas(brand?: string) {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  /**
   * Cards a human waved away this session.
   *
   * Deliberately LOCAL and not persisted. There is no row to retire — nothing is
   * minted until approval — and writing a "rejected" flag onto the transcript
   * moment would be a claim about the FOOTAGE ("this second of video is bad")
   * rather than about this idea, which is not what the human said.
   */
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const brandKey = brand && brand !== "all" ? brand : undefined;

  const query = useQuery<MomentsResponse>({
    queryKey: ["footage-ideas", brandKey || "all"],
    queryFn: () => invoke<MomentsResponse>({ action: "footage_ideas", ...(brandKey ? { brand: brandKey } : {}) }),
    // Parsing is slow and manual; polling this hard would just re-rank the same
    // rows. Long interval on purpose.
    refetchInterval: 5 * 60_000,
  });

  /**
   * THE GATES RUN HERE, over the raw rows, every render.
   *
   * Not in the query function: the brand changes what "interesting" means (the
   * doctrine's declared interests differ per brand), so the same fetched rows
   * must be able to re-rank without a round trip.
   */
  const lane: FootageLane = useMemo(() => {
    const built = buildFootageLane(query.data?.moments || [], { brand: brandKey });
    if (!dismissed.size) return built;
    return { ...built, cards: built.cards.filter((c) => !dismissed.has(c.id)) };
  }, [query.data?.moments, brandKey, dismissed]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["footage-ideas"] });
    // Approving mints a hook and fans it out — both lanes below change, and not
    // refreshing them makes a successful approve look like it did nothing.
    qc.invalidateQueries({ queryKey: ["content-director-ideas"] });
    qc.invalidateQueries({ queryKey: ["content-director-queue"] });
  };

  const approve = useMutation<FootageApproveResult, Error, RankedMoment>({
    mutationFn: async (m) => {
      setBusyId(m.id);
      return invoke<FootageApproveResult>({
        action: "footage_approve",
        moment_id: m.id,
        ...(brandKey ? { brand: brandKey } : {}),
      });
    },
    onSuccess: refresh,
    onSettled: () => setBusyId(null),
  });

  /**
   * Generation is OPT-IN and CAPPED. It is never called on mount, and the
   * targets come off the ALREADY-GATED lane, so a music line or a Whisper
   * hallucination can never reach a paid call.
   */
  const generate = useMutation<FootageGenerateResult, Error, void>({
    mutationFn: async () => {
      setGenerating(true);
      const targets = generationTargets(lane);
      if (!targets.length) {
        throw new Error("No footage passes the quality gates, so there is nothing to generate from.");
      }
      return invoke<FootageGenerateResult>({
        action: "footage_generate",
        brand: brandKey,
        moment_ids: targets.map((t) => t.id),
      });
    },
    onSuccess: refresh,
    onSettled: () => setGenerating(false),
  });

  return {
    lane,
    isLoading: query.isLoading,
    error: query.error as Error | null,
    /** Clips the lane could draw from, before any gate. */
    clips: query.data?.clips ?? 0,
    /** Music-track lines excluded before the client even saw them. */
    musicExcluded: query.data?.music_excluded ?? 0,
    /** One line stating what was hidden and why — shown, not logged. */
    suppression: suppressionSummary(lane),
    /** The honest empty state. Never doctrine hooks wearing a clip's name. */
    emptyReason: emptyReason(lane, brandKey),
    approve,
    dismiss: (m: RankedMoment) => setDismissed((prev) => new Set(prev).add(m.id)),
    dismissedCount: dismissed.size,
    generate,
    generateCap: GENERATE_MAX_CLIPS,
    generateTargets: generationTargets(lane).length,
    busyId,
    generating,
  };
}
