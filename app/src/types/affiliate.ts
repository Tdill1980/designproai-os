// Affiliate Partner Portal - TypeScript Types

export interface AffiliateToolAccess {
  colorpro?: boolean;
  graphicspro?: boolean;
  patternpro?: boolean;
  quickquote?: boolean;
  quickquote_admin?: boolean;
}

export interface AffiliatePartner {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  company_name: string | null;
  phone: string | null;
  website: string | null;
  instagram_handle: string | null;
  referral_code: string;
  referral_link: string | null;
  stripe_account_id: string | null;
  stripe_onboarded: boolean;
  status: 'pending' | 'approved' | 'active' | 'suspended';
  tier: 'partner' | 'pro' | 'elite';
  /** Initial / one-time commission, stored as a percent (20 = 20%). */
  commission_rate: number;
  /** Monthly recurring commission percent (0 = one-time only). */
  recurring_rate: number;
  total_referrals: number;
  total_earned: number;
  total_paid: number;
  pending_balance: number;
  next_payout_date: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  tool_access: AffiliateToolAccess | null;
}

export interface AffiliateReferral {
  id: string;
  affiliate_id: string;
  referred_user_id: string | null;
  referred_email: string | null;
  referral_code_used: string | null;
  status: 'clicked' | 'signed_up' | 'subscribed' | 'active' | 'churned';
  subscription_plan: string | null;
  monthly_value: number | null;
  commission_amount: number | null;
  converted_at: string | null;
  created_at: string;
}

export interface AffiliateCommission {
  id: string;
  affiliate_id: string;
  referral_id: string | null;
  amount: number;
  type: 'recurring' | 'bonus' | 'adjustment';
  status: 'pending' | 'approved' | 'paid' | 'cancelled';
  period_start: string | null;
  period_end: string | null;
  paid_at: string | null;
  stripe_transfer_id: string | null;
  created_at: string;
}

export interface AffiliatePayout {
  id: string;
  affiliate_id: string;
  amount: number;
  commission_ids: string[] | null;
  status: 'scheduled' | 'processing' | 'paid' | 'failed';
  scheduled_date: string;
  paid_at: string | null;
  stripe_transfer_id: string | null;
  stripe_payout_id: string | null;
  failure_reason: string | null;
  created_at: string;
}

export interface AffiliateMarketingAsset {
  id: string;
  title: string;
  description: string | null;
  asset_type: 'video_reel' | 'static_image' | 'story' | 'carousel' | 'email_copy' | 'social_caption';
  file_url: string;
  thumbnail_url: string | null;
  platform: 'instagram' | 'facebook' | 'tiktok' | 'linkedin' | 'email' | 'all' | null;
  caption_template: string | null;
  hashtags: string | null;
  is_featured: boolean;
  sort_order: number;
  created_at: string;
}

export interface AffiliateAssetShare {
  id: string;
  affiliate_id: string;
  asset_id: string;
  platform_shared_to: string | null;
  shared_at: string;
}

// Form types
export interface AffiliateSignupForm {
  full_name: string;
  email: string;
  company_name?: string;
  phone?: string;
  website?: string;
  instagram_handle?: string;
}

export interface AffiliateProfileUpdateForm {
  full_name: string;
  company_name?: string;
  phone?: string;
  website?: string;
  instagram_handle?: string;
}
