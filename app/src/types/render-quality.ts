import { Json } from "@/integrations/supabase/types";

export interface RenderQualityRating {
  id: string;
  render_id: string;
  render_type: string;
  rating: number | null;
  is_flagged: boolean | null;
  notes: string | null;
  flag_reason: string | null;
  user_email: string | null;
  gradient_quality_score: number | null;
  has_hard_line: boolean | null;
  auto_regenerated: boolean | null;
  validation_details: Json | null;
  fix_deployed_at: string | null;
  fix_notes: string | null;
  customer_notified_at: string | null;
  is_v2_feature: boolean | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface QualityStats {
  totalRatings: number;
  averageScore: number;
  flaggedCount: number;
  autoRegeneratedCount: number;
  fixDeployedCount: number;
  needsCustomerReply: number;
}

export type ToolFilter = "all" | "colorpro" | "designpanelpro" | "fadewraps" | "wbty" | "approvemode";

export type TabFilter = "all" | "flagged" | "needs-reply" | "v2-features";
