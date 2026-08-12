/**
 * useTryLandingContent — fetches the CMS-managed content for the /try
 * landing page (and any other surface that mounts the same offer).
 *
 * Hits two tables: `try_landing_config` (single row, id=1) and
 * `try_landing_examples` (multi-row, grouped by proof_type). Both
 * have public-read RLS so the hook works for logged-out visitors.
 *
 * Returns sensible defaults until the migration runs so the page
 * ships rather than blanks-out on missing data.
 *
 * Supabase types haven't been regenerated for the new tables yet
 * (MCP regen is offline), so the queries cast through `as any`. Local
 * TS types below keep the consumer surface strict.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type TryLandingProofType = "design" | "2d_proof" | "3d_proof";

export interface TryLandingExample {
  id: string;
  proof_type: TryLandingProofType;
  image_url: string;
  title: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TryLandingConfig {
  id: number;
  headline: string;
  subheadline: string | null;
  what_you_get: string[];
  show_token_coins: boolean;
  production_pack_enabled: boolean;
  production_pack_price: number;
  production_pack_copy: string | null;
  updated_at: string;
}

const DEFAULT_CONFIG: TryLandingConfig = {
  id: 1,
  headline: "Custom Wrap Design",
  subheadline:
    "Photorealistic AI wrap design rendered on your exact vehicle.",
  what_you_get: [
    "Custom AI wrap design on your exact year · make · model",
    "Photorealistic 3D proof — front, side, rear & 3/4 angles (6+ views)",
    "2D flat-panel proof showing exactly how the wrap maps to your vehicle",
    "3 revisions to refine color, layout, or concept",
    "Magic-link delivery — no signup form, no password",
    "One-time charge — no subscription",
  ],
  show_token_coins: true,
  production_pack_enabled: true,
  production_pack_price: 299,
  production_pack_copy:
    "Love your design? Unlock production-ready print files for $299 — full bleed, cut marks, color management, ready to send to your printer.",
  updated_at: new Date().toISOString(),
};

interface TryLandingContent {
  config: TryLandingConfig;
  examples: {
    design: TryLandingExample[];
    proof_2d: TryLandingExample[];
    proof_3d: TryLandingExample[];
  };
  isLoading: boolean;
  configMissing: boolean;
}

export function useTryLandingContent(): TryLandingContent {
  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ["try_landing_config"],
    queryFn: async (): Promise<TryLandingConfig | null> => {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => {
          select: (q: string) => {
            eq: (
              c: string,
              v: number,
            ) => {
              maybeSingle: () => Promise<{
                data: TryLandingConfig | null;
                error: unknown;
              }>;
            };
          };
        };
      })
        .from("try_landing_config")
        .select("*")
        .eq("id", 1)
        .maybeSingle();
      if (error) {
        // Table probably missing — caller falls back to defaults.
        return null;
      }
      return data;
    },
    staleTime: 60_000,
  });

  const { data: examples, isLoading: examplesLoading } = useQuery({
    queryKey: ["try_landing_examples"],
    queryFn: async (): Promise<TryLandingExample[]> => {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => {
          select: (q: string) => {
            eq: (
              c: string,
              v: boolean,
            ) => {
              order: (
                col: string,
                opts: { ascending: boolean },
              ) => Promise<{
                data: TryLandingExample[] | null;
                error: unknown;
              }>;
            };
          };
        };
      })
        .from("try_landing_examples")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error) return [];
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const resolvedConfig: TryLandingConfig = config ?? DEFAULT_CONFIG;
  const list = examples ?? [];

  return {
    config: resolvedConfig,
    examples: {
      design: list.filter((e) => e.proof_type === "design"),
      proof_2d: list.filter((e) => e.proof_type === "2d_proof"),
      proof_3d: list.filter((e) => e.proof_type === "3d_proof"),
    },
    isLoading: configLoading || examplesLoading,
    configMissing: !config,
  };
}
