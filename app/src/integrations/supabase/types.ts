export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      _artboard_key: {
        Row: {
          token: string | null
        }
        Insert: {
          token?: string | null
        }
        Update: {
          token?: string | null
        }
        Relationships: []
      }
      _scrub_background_url_backup: {
        Row: {
          generation_id: string | null
          id: string | null
          old_background_url: string | null
          reason: string | null
          scrubbed_at: string | null
        }
        Insert: {
          generation_id?: string | null
          id?: string | null
          old_background_url?: string | null
          reason?: string | null
          scrubbed_at?: string | null
        }
        Update: {
          generation_id?: string | null
          id?: string | null
          old_background_url?: string | null
          reason?: string | null
          scrubbed_at?: string | null
        }
        Relationships: []
      }
      affiliate_ad_submissions: {
        Row: {
          ad_type: string
          admin_notes: string | null
          affiliate_id: string
          affiliate_name: string
          caption: string | null
          created_at: string
          file_name: string
          file_url: string
          id: string
          status: string
        }
        Insert: {
          ad_type?: string
          admin_notes?: string | null
          affiliate_id: string
          affiliate_name: string
          caption?: string | null
          created_at?: string
          file_name: string
          file_url: string
          id?: string
          status?: string
        }
        Update: {
          ad_type?: string
          admin_notes?: string | null
          affiliate_id?: string
          affiliate_name?: string
          caption?: string | null
          created_at?: string
          file_name?: string
          file_url?: string
          id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_ad_submissions_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliate_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_asset_shares: {
        Row: {
          affiliate_id: string
          asset_id: string
          id: string
          platform_shared_to: string | null
          shared_at: string | null
        }
        Insert: {
          affiliate_id: string
          asset_id: string
          id?: string
          platform_shared_to?: string | null
          shared_at?: string | null
        }
        Update: {
          affiliate_id?: string
          asset_id?: string
          id?: string
          platform_shared_to?: string | null
          shared_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_asset_shares_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliate_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_asset_shares_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "affiliate_marketing_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_commissions: {
        Row: {
          affiliate_id: string
          amount: number
          created_at: string | null
          id: string
          paid_at: string | null
          period_end: string | null
          period_start: string | null
          referral_id: string | null
          status: string | null
          stripe_transfer_id: string | null
          type: string | null
        }
        Insert: {
          affiliate_id: string
          amount: number
          created_at?: string | null
          id?: string
          paid_at?: string | null
          period_end?: string | null
          period_start?: string | null
          referral_id?: string | null
          status?: string | null
          stripe_transfer_id?: string | null
          type?: string | null
        }
        Update: {
          affiliate_id?: string
          amount?: number
          created_at?: string | null
          id?: string
          paid_at?: string | null
          period_end?: string | null
          period_start?: string | null
          referral_id?: string | null
          status?: string | null
          stripe_transfer_id?: string | null
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_commissions_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliate_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_commissions_referral_id_fkey"
            columns: ["referral_id"]
            isOneToOne: false
            referencedRelation: "affiliate_referrals"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_coupons: {
        Row: {
          active: boolean | null
          affiliate_name: string
          affiliate_partner_id: string | null
          code: string
          commission_percent: number
          created_at: string | null
          current_uses: number | null
          discount_percent: number
          expires_at: string | null
          id: string
          max_uses: number | null
          stripe_coupon_id: string | null
        }
        Insert: {
          active?: boolean | null
          affiliate_name: string
          affiliate_partner_id?: string | null
          code: string
          commission_percent?: number
          created_at?: string | null
          current_uses?: number | null
          discount_percent?: number
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          stripe_coupon_id?: string | null
        }
        Update: {
          active?: boolean | null
          affiliate_name?: string
          affiliate_partner_id?: string | null
          code?: string
          commission_percent?: number
          created_at?: string | null
          current_uses?: number | null
          discount_percent?: number
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          stripe_coupon_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_coupons_affiliate_partner_id_fkey"
            columns: ["affiliate_partner_id"]
            isOneToOne: false
            referencedRelation: "affiliate_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_founders: {
        Row: {
          affiliate_code: string
          avatar_url: string | null
          bio: string | null
          commission_rate: number | null
          company_name: string | null
          created_at: string | null
          email: string
          full_name: string
          id: string
          is_active: boolean | null
          phone: string | null
          social_links: Json | null
          stripe_account_id: string | null
          stripe_onboarding_complete: boolean | null
          updated_at: string | null
        }
        Insert: {
          affiliate_code: string
          avatar_url?: string | null
          bio?: string | null
          commission_rate?: number | null
          company_name?: string | null
          created_at?: string | null
          email: string
          full_name: string
          id?: string
          is_active?: boolean | null
          phone?: string | null
          social_links?: Json | null
          stripe_account_id?: string | null
          stripe_onboarding_complete?: boolean | null
          updated_at?: string | null
        }
        Update: {
          affiliate_code?: string
          avatar_url?: string | null
          bio?: string | null
          commission_rate?: number | null
          company_name?: string | null
          created_at?: string | null
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean | null
          phone?: string | null
          social_links?: Json | null
          stripe_account_id?: string | null
          stripe_onboarding_complete?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      affiliate_login_tokens: {
        Row: {
          created_at: string | null
          expires_at: string
          founder_id: string
          id: string
          token: string
          used: boolean | null
        }
        Insert: {
          created_at?: string | null
          expires_at: string
          founder_id: string
          id?: string
          token: string
          used?: boolean | null
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          founder_id?: string
          id?: string
          token?: string
          used?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_login_tokens_founder_id_fkey"
            columns: ["founder_id"]
            isOneToOne: false
            referencedRelation: "affiliate_founders"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_marketing_assets: {
        Row: {
          affiliate_id: string | null
          asset_type: string
          caption_template: string | null
          created_at: string | null
          description: string | null
          file_url: string | null
          hashtags: string | null
          id: string
          is_featured: boolean | null
          kit_slot: string | null
          platform: string | null
          sort_order: number | null
          thumbnail_url: string | null
          title: string
        }
        Insert: {
          affiliate_id?: string | null
          asset_type: string
          caption_template?: string | null
          created_at?: string | null
          description?: string | null
          file_url?: string | null
          hashtags?: string | null
          id?: string
          is_featured?: boolean | null
          kit_slot?: string | null
          platform?: string | null
          sort_order?: number | null
          thumbnail_url?: string | null
          title: string
        }
        Update: {
          affiliate_id?: string | null
          asset_type?: string
          caption_template?: string | null
          created_at?: string | null
          description?: string | null
          file_url?: string | null
          hashtags?: string | null
          id?: string
          is_featured?: boolean | null
          kit_slot?: string | null
          platform?: string | null
          sort_order?: number | null
          thumbnail_url?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_marketing_assets_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliate_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_partners: {
        Row: {
          approved_at: string | null
          commission_rate: number | null
          company_name: string | null
          coupon_id: string | null
          coupon_percent_off: number | null
          created_at: string | null
          email: string
          full_name: string
          headshot_url: string | null
          id: string
          instagram_handle: string | null
          next_payout_date: string | null
          pending_balance: number | null
          phone: string | null
          recurring_rate: number
          referral_code: string
          referral_link: string | null
          spotlight_image_url: string | null
          spotlight_quote: string | null
          spotlight_video_url: string | null
          status: string | null
          stripe_account_id: string | null
          stripe_onboarded: boolean | null
          tier: string | null
          tool_access: Json | null
          total_earned: number | null
          total_paid: number | null
          total_referrals: number | null
          updated_at: string | null
          user_id: string | null
          website: string | null
        }
        Insert: {
          approved_at?: string | null
          commission_rate?: number | null
          company_name?: string | null
          coupon_id?: string | null
          coupon_percent_off?: number | null
          created_at?: string | null
          email: string
          full_name: string
          headshot_url?: string | null
          id?: string
          instagram_handle?: string | null
          next_payout_date?: string | null
          pending_balance?: number | null
          phone?: string | null
          recurring_rate?: number
          referral_code: string
          referral_link?: string | null
          spotlight_image_url?: string | null
          spotlight_quote?: string | null
          spotlight_video_url?: string | null
          status?: string | null
          stripe_account_id?: string | null
          stripe_onboarded?: boolean | null
          tier?: string | null
          tool_access?: Json | null
          total_earned?: number | null
          total_paid?: number | null
          total_referrals?: number | null
          updated_at?: string | null
          user_id?: string | null
          website?: string | null
        }
        Update: {
          approved_at?: string | null
          commission_rate?: number | null
          company_name?: string | null
          coupon_id?: string | null
          coupon_percent_off?: number | null
          created_at?: string | null
          email?: string
          full_name?: string
          headshot_url?: string | null
          id?: string
          instagram_handle?: string | null
          next_payout_date?: string | null
          pending_balance?: number | null
          phone?: string | null
          recurring_rate?: number
          referral_code?: string
          referral_link?: string | null
          spotlight_image_url?: string | null
          spotlight_quote?: string | null
          spotlight_video_url?: string | null
          status?: string | null
          stripe_account_id?: string | null
          stripe_onboarded?: boolean | null
          tier?: string | null
          tool_access?: Json | null
          total_earned?: number | null
          total_paid?: number | null
          total_referrals?: number | null
          updated_at?: string | null
          user_id?: string | null
          website?: string | null
        }
        Relationships: []
      }
      affiliate_payouts: {
        Row: {
          affiliate_id: string
          amount: number
          commission_ids: string[] | null
          created_at: string | null
          failure_reason: string | null
          id: string
          paid_at: string | null
          scheduled_date: string
          status: string | null
          stripe_payout_id: string | null
          stripe_transfer_id: string | null
        }
        Insert: {
          affiliate_id: string
          amount: number
          commission_ids?: string[] | null
          created_at?: string | null
          failure_reason?: string | null
          id?: string
          paid_at?: string | null
          scheduled_date: string
          status?: string | null
          stripe_payout_id?: string | null
          stripe_transfer_id?: string | null
        }
        Update: {
          affiliate_id?: string
          amount?: number
          commission_ids?: string[] | null
          created_at?: string | null
          failure_reason?: string | null
          id?: string
          paid_at?: string | null
          scheduled_date?: string
          status?: string | null
          stripe_payout_id?: string | null
          stripe_transfer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_payouts_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliate_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_referrals: {
        Row: {
          affiliate_id: string
          commission_amount: number | null
          converted_at: string | null
          created_at: string | null
          id: string
          monthly_value: number | null
          referral_code_used: string | null
          referred_email: string | null
          referred_user_id: string | null
          status: string | null
          subscription_plan: string | null
        }
        Insert: {
          affiliate_id: string
          commission_amount?: number | null
          converted_at?: string | null
          created_at?: string | null
          id?: string
          monthly_value?: number | null
          referral_code_used?: string | null
          referred_email?: string | null
          referred_user_id?: string | null
          status?: string | null
          subscription_plan?: string | null
        }
        Update: {
          affiliate_id?: string
          commission_amount?: number | null
          converted_at?: string | null
          created_at?: string | null
          id?: string
          monthly_value?: number | null
          referral_code_used?: string | null
          referred_email?: string | null
          referred_user_id?: string | null
          status?: string | null
          subscription_plan?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_referrals_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliate_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_transactions: {
        Row: {
          commission_amount_cents: number
          commission_rate: number
          coupon_id: string
          created_at: string | null
          customer_email: string | null
          id: string
          invoice_amount_cents: number
          is_initial_payment: boolean | null
          paid_at: string | null
          partner_id: string
          payout_period: string | null
          payout_status: string | null
          stripe_invoice_id: string
          stripe_subscription_id: string | null
          stripe_transfer_id: string | null
        }
        Insert: {
          commission_amount_cents: number
          commission_rate: number
          coupon_id: string
          created_at?: string | null
          customer_email?: string | null
          id?: string
          invoice_amount_cents: number
          is_initial_payment?: boolean | null
          paid_at?: string | null
          partner_id: string
          payout_period?: string | null
          payout_status?: string | null
          stripe_invoice_id: string
          stripe_subscription_id?: string | null
          stripe_transfer_id?: string | null
        }
        Update: {
          commission_amount_cents?: number
          commission_rate?: number
          coupon_id?: string
          created_at?: string | null
          customer_email?: string | null
          id?: string
          invoice_amount_cents?: number
          is_initial_payment?: boolean | null
          paid_at?: string | null
          partner_id?: string
          payout_period?: string | null
          payout_status?: string | null
          stripe_invoice_id?: string
          stripe_subscription_id?: string | null
          stripe_transfer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_transactions_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "affiliate_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_ad_campaigns: {
        Row: {
          ad_type: string | null
          body: string | null
          brand: string
          budget_daily: number | null
          campaign_name: string
          clicks: number | null
          conversions: number | null
          created_at: string
          created_by: string | null
          cta: string | null
          headline: string | null
          id: string
          impressions: number | null
          media_urls: string[] | null
          platform: string
          spend: number | null
          status: string
          target_audience: Json | null
          updated_at: string
        }
        Insert: {
          ad_type?: string | null
          body?: string | null
          brand?: string
          budget_daily?: number | null
          campaign_name: string
          clicks?: number | null
          conversions?: number | null
          created_at?: string
          created_by?: string | null
          cta?: string | null
          headline?: string | null
          id?: string
          impressions?: number | null
          media_urls?: string[] | null
          platform: string
          spend?: number | null
          status?: string
          target_audience?: Json | null
          updated_at?: string
        }
        Update: {
          ad_type?: string | null
          body?: string | null
          brand?: string
          budget_daily?: number | null
          campaign_name?: string
          clicks?: number | null
          conversions?: number | null
          created_at?: string
          created_by?: string | null
          cta?: string | null
          headline?: string | null
          id?: string
          impressions?: number | null
          media_urls?: string[] | null
          platform?: string
          spend?: number | null
          status?: string
          target_audience?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      agent_blog_posts: {
        Row: {
          body: string | null
          brand: string
          created_at: string
          created_by: string | null
          excerpt: string | null
          featured_image_url: string | null
          id: string
          meta_description: string | null
          meta_title: string | null
          platform: string | null
          publish_date: string | null
          published_url: string | null
          seo_keywords: string[] | null
          slug: string | null
          status: string
          title: string
          updated_at: string
          wordpress_post_id: number | null
        }
        Insert: {
          body?: string | null
          brand?: string
          created_at?: string
          created_by?: string | null
          excerpt?: string | null
          featured_image_url?: string | null
          id?: string
          meta_description?: string | null
          meta_title?: string | null
          platform?: string | null
          publish_date?: string | null
          published_url?: string | null
          seo_keywords?: string[] | null
          slug?: string | null
          status?: string
          title: string
          updated_at?: string
          wordpress_post_id?: number | null
        }
        Update: {
          body?: string | null
          brand?: string
          created_at?: string
          created_by?: string | null
          excerpt?: string | null
          featured_image_url?: string | null
          id?: string
          meta_description?: string | null
          meta_title?: string | null
          platform?: string | null
          publish_date?: string | null
          published_url?: string | null
          seo_keywords?: string[] | null
          slug?: string | null
          status?: string
          title?: string
          updated_at?: string
          wordpress_post_id?: number | null
        }
        Relationships: []
      }
      agent_content_calendar: {
        Row: {
          assigned_to: string | null
          brand: string
          content_type: string
          created_at: string
          date: string
          id: string
          media_url: string | null
          notes: string | null
          pipeline_id: string | null
          pipeline_table: string | null
          status: string
          title: string | null
        }
        Insert: {
          assigned_to?: string | null
          brand?: string
          content_type: string
          created_at?: string
          date: string
          id?: string
          media_url?: string | null
          notes?: string | null
          pipeline_id?: string | null
          pipeline_table?: string | null
          status?: string
          title?: string | null
        }
        Update: {
          assigned_to?: string | null
          brand?: string
          content_type?: string
          created_at?: string
          date?: string
          id?: string
          media_url?: string | null
          notes?: string | null
          pipeline_id?: string | null
          pipeline_table?: string | null
          status?: string
          title?: string | null
        }
        Relationships: []
      }
      agent_email_campaigns: {
        Row: {
          body_html: string | null
          body_text: string | null
          brand: string
          campaign_name: string
          campaign_type: string | null
          created_at: string
          created_by: string | null
          id: string
          klaviyo_campaign_id: string | null
          list_segment: string | null
          preview_text: string | null
          scheduled_date: string | null
          sent_date: string | null
          stats: Json | null
          status: string
          subject_line: string | null
          updated_at: string
        }
        Insert: {
          body_html?: string | null
          body_text?: string | null
          brand?: string
          campaign_name: string
          campaign_type?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          klaviyo_campaign_id?: string | null
          list_segment?: string | null
          preview_text?: string | null
          scheduled_date?: string | null
          sent_date?: string | null
          stats?: Json | null
          status?: string
          subject_line?: string | null
          updated_at?: string
        }
        Update: {
          body_html?: string | null
          body_text?: string | null
          brand?: string
          campaign_name?: string
          campaign_type?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          klaviyo_campaign_id?: string | null
          list_segment?: string | null
          preview_text?: string | null
          scheduled_date?: string | null
          sent_date?: string | null
          stats?: Json | null
          status?: string
          subject_line?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      agent_media_assets: {
        Row: {
          ai_labels: Json | null
          asset_type: string
          brand: string
          canva_design_id: string | null
          content_category: string | null
          created_at: string
          dimensions: string | null
          drive_file_id: string | null
          duration_seconds: number | null
          file_size: number | null
          file_size_bytes: number | null
          id: string
          metadata: Json | null
          organization_id: string | null
          original_filename: string | null
          source_folder: string | null
          storage_url: string | null
          tags: string[] | null
          thumbnail_url: string | null
          title: string | null
          transcript: string | null
          used_in: Json | null
          visual_tags: Json | null
        }
        Insert: {
          ai_labels?: Json | null
          asset_type: string
          brand?: string
          canva_design_id?: string | null
          content_category?: string | null
          created_at?: string
          dimensions?: string | null
          drive_file_id?: string | null
          duration_seconds?: number | null
          file_size?: number | null
          file_size_bytes?: number | null
          id?: string
          metadata?: Json | null
          organization_id?: string | null
          original_filename?: string | null
          source_folder?: string | null
          storage_url?: string | null
          tags?: string[] | null
          thumbnail_url?: string | null
          title?: string | null
          transcript?: string | null
          used_in?: Json | null
          visual_tags?: Json | null
        }
        Update: {
          ai_labels?: Json | null
          asset_type?: string
          brand?: string
          canva_design_id?: string | null
          content_category?: string | null
          created_at?: string
          dimensions?: string | null
          drive_file_id?: string | null
          duration_seconds?: number | null
          file_size?: number | null
          file_size_bytes?: number | null
          id?: string
          metadata?: Json | null
          organization_id?: string | null
          original_filename?: string | null
          source_folder?: string | null
          storage_url?: string | null
          tags?: string[] | null
          thumbnail_url?: string | null
          title?: string | null
          transcript?: string | null
          used_in?: Json | null
          visual_tags?: Json | null
        }
        Relationships: []
      }
      agent_recommendations: {
        Row: {
          action_url: string | null
          brand: string
          category: string
          created_at: string
          description: string | null
          id: string
          priority: string | null
          source: string | null
          status: string
          title: string
        }
        Insert: {
          action_url?: string | null
          brand?: string
          category: string
          created_at?: string
          description?: string | null
          id?: string
          priority?: string | null
          source?: string | null
          status?: string
          title: string
        }
        Update: {
          action_url?: string | null
          brand?: string
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          priority?: string | null
          source?: string | null
          status?: string
          title?: string
        }
        Relationships: []
      }
      agent_sms_campaigns: {
        Row: {
          audience: string | null
          brand: string
          created_at: string
          created_by: string
          id: string
          message_template: string
          name: string
          reviewed_by: string | null
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          audience?: string | null
          brand?: string
          created_at?: string
          created_by?: string
          id?: string
          message_template: string
          name: string
          reviewed_by?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          audience?: string | null
          brand?: string
          created_at?: string
          created_by?: string
          id?: string
          message_template?: string
          name?: string
          reviewed_by?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      agent_social_posts: {
        Row: {
          assigned_to: string | null
          brand: string
          canva_design_id: string | null
          canva_template_thumbnail_url: string | null
          caption: string | null
          created_at: string
          created_by: string | null
          engagement: Json | null
          hashtags: string[] | null
          id: string
          media_urls: string[] | null
          platform: string
          post_type: string | null
          posted_date: string | null
          publish_attempts: number
          publish_error: string | null
          published_post_id: string | null
          revision_note: string | null
          scheduled_date: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          brand?: string
          canva_design_id?: string | null
          canva_template_thumbnail_url?: string | null
          caption?: string | null
          created_at?: string
          created_by?: string | null
          engagement?: Json | null
          hashtags?: string[] | null
          id?: string
          media_urls?: string[] | null
          platform: string
          post_type?: string | null
          posted_date?: string | null
          publish_attempts?: number
          publish_error?: string | null
          published_post_id?: string | null
          revision_note?: string | null
          scheduled_date?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          brand?: string
          canva_design_id?: string | null
          canva_template_thumbnail_url?: string | null
          caption?: string | null
          created_at?: string
          created_by?: string | null
          engagement?: Json | null
          hashtags?: string[] | null
          id?: string
          media_urls?: string[] | null
          platform?: string
          post_type?: string | null
          posted_date?: string | null
          publish_attempts?: number
          publish_error?: string | null
          published_post_id?: string | null
          revision_note?: string | null
          scheduled_date?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      anon_design_trials: {
        Row: {
          created_at: string
          device_id: string
          id: string
          ip: string | null
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          device_id: string
          id?: string
          ip?: string | null
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          device_id?: string
          id?: string
          ip?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      app_internal_keys: {
        Row: {
          name: string
          secret: string
        }
        Insert: {
          name: string
          secret: string
        }
        Update: {
          name?: string
          secret?: string
        }
        Relationships: []
      }
      appointments: {
        Row: {
          cancellation_reason: string | null
          confirmation_sms_sent: boolean | null
          confirmation_sms_sent_at: string | null
          created_at: string | null
          customer_id: string | null
          customer_notes: string | null
          customer_quote_id: string | null
          deposit_amount_cents: number | null
          deposit_status: string | null
          duration_minutes: number | null
          entry_source: string | null
          id: string
          lead_id: string | null
          metadata: Json | null
          notes: string | null
          quote_id: string | null
          reminder_sms_sent: boolean | null
          reminder_sms_sent_at: string | null
          scheduled_at: string
          service: string | null
          shop_id: string
          status: string | null
          stripe_payment_intent_id: string | null
          updated_at: string | null
        }
        Insert: {
          cancellation_reason?: string | null
          confirmation_sms_sent?: boolean | null
          confirmation_sms_sent_at?: string | null
          created_at?: string | null
          customer_id?: string | null
          customer_notes?: string | null
          customer_quote_id?: string | null
          deposit_amount_cents?: number | null
          deposit_status?: string | null
          duration_minutes?: number | null
          entry_source?: string | null
          id?: string
          lead_id?: string | null
          metadata?: Json | null
          notes?: string | null
          quote_id?: string | null
          reminder_sms_sent?: boolean | null
          reminder_sms_sent_at?: string | null
          scheduled_at: string
          service?: string | null
          shop_id: string
          status?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string | null
        }
        Update: {
          cancellation_reason?: string | null
          confirmation_sms_sent?: boolean | null
          confirmation_sms_sent_at?: string | null
          created_at?: string | null
          customer_id?: string | null
          customer_notes?: string | null
          customer_quote_id?: string | null
          deposit_amount_cents?: number | null
          deposit_status?: string | null
          duration_minutes?: number | null
          entry_source?: string | null
          id?: string
          lead_id?: string | null
          metadata?: Json | null
          notes?: string | null
          quote_id?: string | null
          reminder_sms_sent?: boolean | null
          reminder_sms_sent_at?: string | null
          scheduled_at?: string
          service?: string | null
          shop_id?: string
          status?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      approvemode_carousel: {
        Row: {
          before_url: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          manufacturer: string | null
          media_url: string
          name: string
          sort_order: number | null
          subtitle: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          before_url?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          manufacturer?: string | null
          media_url: string
          name: string
          sort_order?: number | null
          subtitle?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          before_url?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          manufacturer?: string | null
          media_url?: string
          name?: string
          sort_order?: number | null
          subtitle?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      approvemode_examples: {
        Row: {
          after_url: string
          before_url: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          after_url: string
          before_url: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          after_url?: string
          before_url?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      approvemode_videos: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          media_url: string
          name: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          media_url: string
          name: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          media_url?: string
          name?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      approvepro_followup_deliveries: {
        Row: {
          created_at: string
          id: string
          idempotency_key: string
          kind: string
          proof_id: string
          provider_message_id: string | null
          recipient_email: string
          sent_at: string | null
          sequence: number
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          idempotency_key: string
          kind: string
          proof_id: string
          provider_message_id?: string | null
          recipient_email: string
          sent_at?: string | null
          sequence: number
          status?: string
          subject: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          idempotency_key?: string
          kind?: string
          proof_id?: string
          provider_message_id?: string | null
          recipient_email?: string
          sent_at?: string | null
          sequence?: number
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "approvepro_followup_deliveries_proof_id_fkey"
            columns: ["proof_id"]
            isOneToOne: false
            referencedRelation: "proof_approvals"
            referencedColumns: ["id"]
          },
        ]
      }
      blocked_users: {
        Row: {
          blocked_at: string | null
          blocked_by: string | null
          email: string
          id: string
          reason: string | null
        }
        Insert: {
          blocked_at?: string | null
          blocked_by?: string | null
          email: string
          id?: string
          reason?: string | null
        }
        Update: {
          blocked_at?: string | null
          blocked_by?: string | null
          email?: string
          id?: string
          reason?: string | null
        }
        Relationships: []
      }
      blog_posts: {
        Row: {
          author: string
          content: string
          created_at: string | null
          description: string
          featured_image_url: string | null
          id: string
          published_at: string | null
          read_time: string
          slug: string
          status: string
          tags: string[] | null
          title: string
          updated_at: string | null
        }
        Insert: {
          author?: string
          content?: string
          created_at?: string | null
          description?: string
          featured_image_url?: string | null
          id?: string
          published_at?: string | null
          read_time?: string
          slug: string
          status?: string
          tags?: string[] | null
          title: string
          updated_at?: string | null
        }
        Update: {
          author?: string
          content?: string
          created_at?: string | null
          description?: string
          featured_image_url?: string | null
          id?: string
          published_at?: string | null
          read_time?: string
          slug?: string
          status?: string
          tags?: string[] | null
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      brand_canva_templates: {
        Row: {
          brand: string
          created_at: string
          field_map: Json
          reel_field_map: Json
          reel_template_id: string | null
          reel_template_title: string | null
          template_id: string | null
          template_title: string | null
          updated_at: string
        }
        Insert: {
          brand: string
          created_at?: string
          field_map?: Json
          reel_field_map?: Json
          reel_template_id?: string | null
          reel_template_title?: string | null
          template_id?: string | null
          template_title?: string | null
          updated_at?: string
        }
        Update: {
          brand?: string
          created_at?: string
          field_map?: Json
          reel_field_map?: Json
          reel_template_id?: string | null
          reel_template_title?: string | null
          template_id?: string | null
          template_title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      brand_content_brains: {
        Row: {
          active: boolean
          audiences: Json
          brand: string
          created_at: string
          cross_brand_allowed: string[]
          enabled_content_types: string[]
          offers: Json
          platform_rules: Json
          prohibited_claims: string[]
          proof_points: Json
          required_terminology: string[]
          updated_at: string
          visual_identity: Json
        }
        Insert: {
          active?: boolean
          audiences?: Json
          brand: string
          created_at?: string
          cross_brand_allowed?: string[]
          enabled_content_types?: string[]
          offers?: Json
          platform_rules?: Json
          prohibited_claims?: string[]
          proof_points?: Json
          required_terminology?: string[]
          updated_at?: string
          visual_identity?: Json
        }
        Update: {
          active?: boolean
          audiences?: Json
          brand?: string
          created_at?: string
          cross_brand_allowed?: string[]
          enabled_content_types?: string[]
          offers?: Json
          platform_rules?: Json
          prohibited_claims?: string[]
          proof_points?: Json
          required_terminology?: string[]
          updated_at?: string
          visual_identity?: Json
        }
        Relationships: []
      }
      brand_kits: {
        Row: {
          active: boolean
          ad_format: Json
          colors: Json
          created_at: string
          default_cta: string | null
          domain: string | null
          fonts: Json
          gradient: string[]
          hook_styles: string[]
          logo_url: string | null
          name: string
          slug: string
          updated_at: string
          wordmark: string
        }
        Insert: {
          active?: boolean
          ad_format?: Json
          colors?: Json
          created_at?: string
          default_cta?: string | null
          domain?: string | null
          fonts?: Json
          gradient?: string[]
          hook_styles?: string[]
          logo_url?: string | null
          name: string
          slug: string
          updated_at?: string
          wordmark: string
        }
        Update: {
          active?: boolean
          ad_format?: Json
          colors?: Json
          created_at?: string
          default_cta?: string | null
          domain?: string | null
          fonts?: Json
          gradient?: string[]
          hook_styles?: string[]
          logo_url?: string | null
          name?: string
          slug?: string
          updated_at?: string
          wordmark?: string
        }
        Relationships: []
      }
      brand_pillars: {
        Row: {
          active: boolean | null
          brand: string | null
          category: string | null
          created_at: string
          description: string | null
          evidence_guidance: string | null
          id: string | null
          key: string
          name: string | null
          recommended_audiences: string[] | null
          recommended_formats: string[] | null
          slug: string | null
          sort_order: number | null
          source: string | null
          summary: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          brand?: string | null
          category?: string | null
          created_at?: string
          description?: string | null
          evidence_guidance?: string | null
          id?: string | null
          key: string
          name?: string | null
          recommended_audiences?: string[] | null
          recommended_formats?: string[] | null
          slug?: string | null
          sort_order?: number | null
          source?: string | null
          summary?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          brand?: string | null
          category?: string | null
          created_at?: string
          description?: string | null
          evidence_guidance?: string | null
          id?: string | null
          key?: string
          name?: string | null
          recommended_audiences?: string[] | null
          recommended_formats?: string[] | null
          slug?: string | null
          sort_order?: number | null
          source?: string | null
          summary?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      brands: {
        Row: {
          brand_brain: Json
          created_at: string
          id: string
          is_active: boolean
          name: string
          owner_id: string
          slug: string
          tagline: string | null
          updated_at: string
        }
        Insert: {
          brand_brain?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          owner_id: string
          slug: string
          tagline?: string | null
          updated_at?: string
        }
        Update: {
          brand_brain?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          owner_id?: string
          slug?: string
          tagline?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      campaign_settings: {
        Row: {
          key: string
          label: string | null
          updated_at: string
          updated_by: string | null
          value: string
        }
        Insert: {
          key: string
          label?: string | null
          updated_at?: string
          updated_by?: string | null
          value: string
        }
        Update: {
          key?: string
          label?: string | null
          updated_at?: string
          updated_by?: string | null
          value?: string
        }
        Relationships: []
      }
      carwrappro_assets: {
        Row: {
          bleed_inches: number | null
          created_at: string
          dpi: number | null
          height_inches: number | null
          id: string
          kind: string
          label: string | null
          panel_label: string | null
          run_id: string
          scale_pct: number | null
          sort_order: number | null
          storage_path: string | null
          url: string
          view_type: string | null
          width_inches: number | null
        }
        Insert: {
          bleed_inches?: number | null
          created_at?: string
          dpi?: number | null
          height_inches?: number | null
          id?: string
          kind: string
          label?: string | null
          panel_label?: string | null
          run_id: string
          scale_pct?: number | null
          sort_order?: number | null
          storage_path?: string | null
          url: string
          view_type?: string | null
          width_inches?: number | null
        }
        Update: {
          bleed_inches?: number | null
          created_at?: string
          dpi?: number | null
          height_inches?: number | null
          id?: string
          kind?: string
          label?: string | null
          panel_label?: string | null
          run_id?: string
          scale_pct?: number | null
          sort_order?: number | null
          storage_path?: string | null
          url?: string
          view_type?: string | null
          width_inches?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "carwrappro_assets_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "carwrappro_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      carwrappro_runs: {
        Row: {
          body_type: string | null
          company_name: string | null
          completed_at: string | null
          coverage_sq_ft: number | null
          created_at: string
          dims_source: string | null
          error: string | null
          finish: string | null
          id: string
          included_revisions: number
          mode: string | null
          paid: boolean
          panels: Json | null
          phone: string | null
          prompt: string | null
          reference_image_url: string | null
          revision_number: number
          revision_of: string | null
          status: string
          user_id: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_year: string | null
          website: string | null
        }
        Insert: {
          body_type?: string | null
          company_name?: string | null
          completed_at?: string | null
          coverage_sq_ft?: number | null
          created_at?: string
          dims_source?: string | null
          error?: string | null
          finish?: string | null
          id?: string
          included_revisions?: number
          mode?: string | null
          paid?: boolean
          panels?: Json | null
          phone?: string | null
          prompt?: string | null
          reference_image_url?: string | null
          revision_number?: number
          revision_of?: string | null
          status?: string
          user_id?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: string | null
          website?: string | null
        }
        Update: {
          body_type?: string | null
          company_name?: string | null
          completed_at?: string | null
          coverage_sq_ft?: number | null
          created_at?: string
          dims_source?: string | null
          error?: string | null
          finish?: string | null
          id?: string
          included_revisions?: number
          mode?: string | null
          paid?: boolean
          panels?: Json | null
          phone?: string | null
          prompt?: string | null
          reference_image_url?: string | null
          revision_number?: number
          revision_of?: string | null
          status?: string
          user_id?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "carwrappro_runs_revision_of_fkey"
            columns: ["revision_of"]
            isOneToOne: false
            referencedRelation: "carwrappro_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      color_visualizations: {
        Row: {
          admin_notes: string | null
          color_hex: string
          color_name: string
          created_at: string | null
          custom_design_url: string | null
          custom_styling_prompt_key: string | null
          custom_swatch_url: string | null
          customer_email: string
          design_file_name: string | null
          emailed_at: string | null
          finish_type: string
          generation_status: string | null
          has_360_spin: boolean | null
          has_metallic_flakes: boolean | null
          id: string
          infusion_color_id: string | null
          is_featured_hero: boolean | null
          is_saved: boolean | null
          lineage_root_id: string | null
          mode_type: string | null
          organization_id: string | null
          render_urls: Json | null
          shop_id: string | null
          show_on_quote_pdf: boolean
          source_photo_url: string | null
          spin_view_count: number | null
          subscription_tier: string | null
          tool_source: string | null
          updated_at: string | null
          uses_custom_design: boolean | null
          vehicle_make: string
          vehicle_model: string
          vehicle_type: string | null
          vehicle_year: number
        }
        Insert: {
          admin_notes?: string | null
          color_hex: string
          color_name: string
          created_at?: string | null
          custom_design_url?: string | null
          custom_styling_prompt_key?: string | null
          custom_swatch_url?: string | null
          customer_email: string
          design_file_name?: string | null
          emailed_at?: string | null
          finish_type: string
          generation_status?: string | null
          has_360_spin?: boolean | null
          has_metallic_flakes?: boolean | null
          id?: string
          infusion_color_id?: string | null
          is_featured_hero?: boolean | null
          is_saved?: boolean | null
          lineage_root_id?: string | null
          mode_type?: string | null
          organization_id?: string | null
          render_urls?: Json | null
          shop_id?: string | null
          show_on_quote_pdf?: boolean
          source_photo_url?: string | null
          spin_view_count?: number | null
          subscription_tier?: string | null
          tool_source?: string | null
          updated_at?: string | null
          uses_custom_design?: boolean | null
          vehicle_make: string
          vehicle_model: string
          vehicle_type?: string | null
          vehicle_year: number
        }
        Update: {
          admin_notes?: string | null
          color_hex?: string
          color_name?: string
          created_at?: string | null
          custom_design_url?: string | null
          custom_styling_prompt_key?: string | null
          custom_swatch_url?: string | null
          customer_email?: string
          design_file_name?: string | null
          emailed_at?: string | null
          finish_type?: string
          generation_status?: string | null
          has_360_spin?: boolean | null
          has_metallic_flakes?: boolean | null
          id?: string
          infusion_color_id?: string | null
          is_featured_hero?: boolean | null
          is_saved?: boolean | null
          lineage_root_id?: string | null
          mode_type?: string | null
          organization_id?: string | null
          render_urls?: Json | null
          shop_id?: string | null
          show_on_quote_pdf?: boolean
          source_photo_url?: string | null
          spin_view_count?: number | null
          subscription_tier?: string | null
          tool_source?: string | null
          updated_at?: string | null
          uses_custom_design?: boolean | null
          vehicle_make?: string
          vehicle_model?: string
          vehicle_type?: string | null
          vehicle_year?: number
        }
        Relationships: [
          {
            foreignKeyName: "color_visualizations_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      content_concepts: {
        Row: {
          angle: string | null
          approved_at: string | null
          approved_by: string | null
          audience_id: string | null
          awareness_level: string | null
          brand: string
          brand_pillar_id: string | null
          content_project_id: string
          created_at: string
          evidence: Json
          hook_template_id: string | null
          id: string
          objective: string | null
          output_format: string | null
          pillar_match: Json
          platform: string | null
          status: string
          title: string | null
        }
        Insert: {
          angle?: string | null
          approved_at?: string | null
          approved_by?: string | null
          audience_id?: string | null
          awareness_level?: string | null
          brand: string
          brand_pillar_id?: string | null
          content_project_id: string
          created_at?: string
          evidence?: Json
          hook_template_id?: string | null
          id?: string
          objective?: string | null
          output_format?: string | null
          pillar_match?: Json
          platform?: string | null
          status?: string
          title?: string | null
        }
        Update: {
          angle?: string | null
          approved_at?: string | null
          approved_by?: string | null
          audience_id?: string | null
          awareness_level?: string | null
          brand?: string
          brand_pillar_id?: string | null
          content_project_id?: string
          created_at?: string
          evidence?: Json
          hook_template_id?: string | null
          id?: string
          objective?: string | null
          output_format?: string | null
          pillar_match?: Json
          platform?: string | null
          status?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_concepts_brand_pillar_id_fkey"
            columns: ["brand_pillar_id"]
            isOneToOne: false
            referencedRelation: "brand_pillars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_concepts_content_project_id_fkey"
            columns: ["content_project_id"]
            isOneToOne: false
            referencedRelation: "content_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_concepts_hook_template_id_fkey"
            columns: ["hook_template_id"]
            isOneToOne: false
            referencedRelation: "content_hooks"
            referencedColumns: ["id"]
          },
        ]
      }
      content_conversations: {
        Row: {
          brand_id: string
          created_at: string
          id: string
          owner_id: string
          title: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          owner_id: string
          title?: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          owner_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_conversations_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      content_extracts: {
        Row: {
          created_at: string
          id: string
          kind: string
          lines: Json
          render_job_id: string | null
          shoot: string | null
          status: string
          thesis: string | null
          title: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          kind?: string
          lines?: Json
          render_job_id?: string | null
          shoot?: string | null
          status?: string
          thesis?: string | null
          title?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          lines?: Json
          render_job_id?: string | null
          shoot?: string | null
          status?: string
          thesis?: string | null
          title?: string | null
        }
        Relationships: []
      }
      content_hooks: {
        Row: {
          active: boolean
          approved_language: string[] | null
          audience_ids: string[] | null
          awareness: string | null
          awareness_levels: string[] | null
          blocked_language: string[] | null
          brand: string | null
          created_at: string
          created_by: string | null
          hook_text: string
          hook_type: string | null
          id: string
          objectives: string[] | null
          pillar_key: string | null
          pillar_slugs: string[] | null
          required_evidence_types: string[] | null
          required_opening_visual: string | null
          score: number | null
          source: string | null
          supported_platforms: string[] | null
          text: string | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean
          approved_language?: string[] | null
          audience_ids?: string[] | null
          awareness?: string | null
          awareness_levels?: string[] | null
          blocked_language?: string[] | null
          brand?: string | null
          created_at?: string
          created_by?: string | null
          hook_text: string
          hook_type?: string | null
          id?: string
          objectives?: string[] | null
          pillar_key?: string | null
          pillar_slugs?: string[] | null
          required_evidence_types?: string[] | null
          required_opening_visual?: string | null
          score?: number | null
          source?: string | null
          supported_platforms?: string[] | null
          text?: string | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean
          approved_language?: string[] | null
          audience_ids?: string[] | null
          awareness?: string | null
          awareness_levels?: string[] | null
          blocked_language?: string[] | null
          brand?: string | null
          created_at?: string
          created_by?: string | null
          hook_text?: string
          hook_type?: string | null
          id?: string
          objectives?: string[] | null
          pillar_key?: string | null
          pillar_slugs?: string[] | null
          required_evidence_types?: string[] | null
          required_opening_visual?: string | null
          score?: number | null
          source?: string | null
          supported_platforms?: string[] | null
          text?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_hooks_pillar_key_fkey"
            columns: ["pillar_key"]
            isOneToOne: false
            referencedRelation: "brand_pillars"
            referencedColumns: ["key"]
          },
        ]
      }
      content_messages: {
        Row: {
          content: Json
          conversation_id: string
          created_at: string
          id: string
          owner_id: string
          role: string
        }
        Insert: {
          content: Json
          conversation_id: string
          created_at?: string
          id?: string
          owner_id: string
          role: string
        }
        Update: {
          content?: Json
          conversation_id?: string
          created_at?: string
          id?: string
          owner_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "content_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      content_moments: {
        Row: {
          brands: string[] | null
          broll_score: number | null
          content_uses: string[] | null
          created_at: string
          end_time: number | null
          hook_score: number | null
          id: string
          install_stage: string | null
          music_matches: string[] | null
          people: string[] | null
          review_status: string
          soundbite_score: number | null
          source_id: string
          speaker: string | null
          start_time: number | null
          vehicles: string[] | null
          verbatim_quote: string | null
          visual_description: string | null
        }
        Insert: {
          brands?: string[] | null
          broll_score?: number | null
          content_uses?: string[] | null
          created_at?: string
          end_time?: number | null
          hook_score?: number | null
          id?: string
          install_stage?: string | null
          music_matches?: string[] | null
          people?: string[] | null
          review_status?: string
          soundbite_score?: number | null
          source_id: string
          speaker?: string | null
          start_time?: number | null
          vehicles?: string[] | null
          verbatim_quote?: string | null
          visual_description?: string | null
        }
        Update: {
          brands?: string[] | null
          broll_score?: number | null
          content_uses?: string[] | null
          created_at?: string
          end_time?: number | null
          hook_score?: number | null
          id?: string
          install_stage?: string | null
          music_matches?: string[] | null
          people?: string[] | null
          review_status?: string
          soundbite_score?: number | null
          source_id?: string
          speaker?: string | null
          start_time?: number | null
          vehicles?: string[] | null
          verbatim_quote?: string | null
          visual_description?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_moments_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "media_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      content_projects: {
        Row: {
          brand: string
          campaign_id: string | null
          created_at: string
          created_by: string | null
          id: string
          pillar_matches: Json
          source_media_id: string | null
          source_video_url: string | null
          status: string
          title: string | null
          transcript: string | null
          updated_at: string
        }
        Insert: {
          brand: string
          campaign_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          pillar_matches?: Json
          source_media_id?: string | null
          source_video_url?: string | null
          status?: string
          title?: string | null
          transcript?: string | null
          updated_at?: string
        }
        Update: {
          brand?: string
          campaign_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          pillar_matches?: Json
          source_media_id?: string | null
          source_video_url?: string | null
          status?: string
          title?: string | null
          transcript?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_projects_source_media_id_fkey"
            columns: ["source_media_id"]
            isOneToOne: false
            referencedRelation: "media_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      content_studio_works: {
        Row: {
          brand: string | null
          canvas_state: Json
          created_at: string
          format_label: string | null
          id: string
          organization_id: string | null
          shop_id: string | null
          status: string
          thumbnail_url: string | null
          title: string
          updated_at: string
          user_email: string | null
          user_id: string
          video_url: string | null
        }
        Insert: {
          brand?: string | null
          canvas_state: Json
          created_at?: string
          format_label?: string | null
          id?: string
          organization_id?: string | null
          shop_id?: string | null
          status?: string
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          user_email?: string | null
          user_id: string
          video_url?: string | null
        }
        Update: {
          brand?: string | null
          canvas_state?: Json
          created_at?: string
          format_label?: string | null
          id?: string
          organization_id?: string | null
          shop_id?: string | null
          status?: string
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          user_email?: string | null
          user_id?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_studio_works_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      creator_market_settings: {
        Row: {
          auto_approve_verified: boolean
          created_at: string | null
          creator_payout_percent: number
          hero_video_title: string | null
          hero_video_url: string | null
          id: string
          ig_auto_post_enabled: boolean
          ig_caption_style: string
          ig_custom_caption_template: string | null
          ig_hashtags: string | null
          max_listing_price: number
          min_listing_price: number
          platform_fee_percent: number
          updated_at: string | null
        }
        Insert: {
          auto_approve_verified?: boolean
          created_at?: string | null
          creator_payout_percent?: number
          hero_video_title?: string | null
          hero_video_url?: string | null
          id?: string
          ig_auto_post_enabled?: boolean
          ig_caption_style?: string
          ig_custom_caption_template?: string | null
          ig_hashtags?: string | null
          max_listing_price?: number
          min_listing_price?: number
          platform_fee_percent?: number
          updated_at?: string | null
        }
        Update: {
          auto_approve_verified?: boolean
          created_at?: string | null
          creator_payout_percent?: number
          hero_video_title?: string | null
          hero_video_url?: string | null
          id?: string
          ig_auto_post_enabled?: boolean
          ig_caption_style?: string
          ig_custom_caption_template?: string | null
          ig_hashtags?: string | null
          max_listing_price?: number
          min_listing_price?: number
          platform_fee_percent?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      custom_styling_jobs: {
        Row: {
          color_zones: Json | null
          created_at: string
          cut_file_urls: Json | null
          generation_completed_at: string | null
          generation_started_at: string | null
          hero_render_url: string | null
          id: string
          material_estimate: Json | null
          reference_image_url: string | null
          render_urls: Json | null
          shop_id: string | null
          status: string
          styling_prompt: string
          updated_at: string
          user_email: string | null
          user_id: string | null
          vehicle_make: string
          vehicle_model: string
          vehicle_year: string
          visualization_id: string | null
        }
        Insert: {
          color_zones?: Json | null
          created_at?: string
          cut_file_urls?: Json | null
          generation_completed_at?: string | null
          generation_started_at?: string | null
          hero_render_url?: string | null
          id?: string
          material_estimate?: Json | null
          reference_image_url?: string | null
          render_urls?: Json | null
          shop_id?: string | null
          status?: string
          styling_prompt: string
          updated_at?: string
          user_email?: string | null
          user_id?: string | null
          vehicle_make: string
          vehicle_model: string
          vehicle_year: string
          visualization_id?: string | null
        }
        Update: {
          color_zones?: Json | null
          created_at?: string
          cut_file_urls?: Json | null
          generation_completed_at?: string | null
          generation_started_at?: string | null
          hero_render_url?: string | null
          id?: string
          material_estimate?: Json | null
          reference_image_url?: string | null
          render_urls?: Json | null
          shop_id?: string | null
          status?: string
          styling_prompt?: string
          updated_at?: string
          user_email?: string | null
          user_id?: string | null
          vehicle_make?: string
          vehicle_model?: string
          vehicle_year?: string
          visualization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "custom_styling_jobs_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_bookings: {
        Row: {
          base_price: number | null
          created_at: string | null
          customer_email: string | null
          customer_name: string | null
          customer_phone: string | null
          duration_minutes: number
          entry_source: string
          id: string
          notes: string | null
          quote_id: string | null
          scheduled_at: string
          service_name: string
          service_slug: string
          shop_id: string
          status: string
          updated_at: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_year: string | null
        }
        Insert: {
          base_price?: number | null
          created_at?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          duration_minutes: number
          entry_source?: string
          id?: string
          notes?: string | null
          quote_id?: string | null
          scheduled_at: string
          service_name: string
          service_slug: string
          shop_id: string
          status?: string
          updated_at?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: string | null
        }
        Update: {
          base_price?: number | null
          created_at?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          duration_minutes?: number
          entry_source?: string
          id?: string
          notes?: string | null
          quote_id?: string | null
          scheduled_at?: string
          service_name?: string
          service_slug?: string
          shop_id?: string
          status?: string
          updated_at?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_bookings_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "customer_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_bookings_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_quotes: {
        Row: {
          created_at: string | null
          customer_email: string | null
          customer_name: string | null
          customer_phone: string | null
          expires_at: string | null
          film_cost_per_sqft: number
          film_finish: string | null
          film_manufacturer: string | null
          film_name: string | null
          film_total: number
          id: string
          labor_rate_per_sqft: number
          labor_total: number
          lead_source: string | null
          notes: string | null
          quote_number: string | null
          quote_total: number
          render_url: string | null
          shop_id: string | null
          status: string | null
          total_sqft: number
          updated_at: string | null
          user_id: string
          vehicle_make: string
          vehicle_model: string
          vehicle_year: string | null
          visualization_id: string | null
        }
        Insert: {
          created_at?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          expires_at?: string | null
          film_cost_per_sqft: number
          film_finish?: string | null
          film_manufacturer?: string | null
          film_name?: string | null
          film_total: number
          id?: string
          labor_rate_per_sqft: number
          labor_total: number
          lead_source?: string | null
          notes?: string | null
          quote_number?: string | null
          quote_total: number
          render_url?: string | null
          shop_id?: string | null
          status?: string | null
          total_sqft: number
          updated_at?: string | null
          user_id: string
          vehicle_make: string
          vehicle_model: string
          vehicle_year?: string | null
          visualization_id?: string | null
        }
        Update: {
          created_at?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          expires_at?: string | null
          film_cost_per_sqft?: number
          film_finish?: string | null
          film_manufacturer?: string | null
          film_name?: string | null
          film_total?: number
          id?: string
          labor_rate_per_sqft?: number
          labor_total?: number
          lead_source?: string | null
          notes?: string | null
          quote_number?: string | null
          quote_total?: number
          render_url?: string | null
          shop_id?: string | null
          status?: string | null
          total_sqft?: number
          updated_at?: string | null
          user_id?: string
          vehicle_make?: string
          vehicle_model?: string
          vehicle_year?: string | null
          visualization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_quotes_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_tags: {
        Row: {
          applied_at: string
          applied_by: string | null
          customer_id: string
          id: string
          shop_id: string
          source_event: string | null
          source_ref: string | null
          tag: string
        }
        Insert: {
          applied_at?: string
          applied_by?: string | null
          customer_id: string
          id?: string
          shop_id: string
          source_event?: string | null
          source_ref?: string | null
          tag: string
        }
        Update: {
          applied_at?: string
          applied_by?: string | null
          customer_id?: string
          id?: string
          shop_id?: string
          source_event?: string | null
          source_ref?: string | null
          tag?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_tags_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string | null
          email: string | null
          id: string
          industry: string | null
          is_test: boolean
          last_contact_at: string | null
          last_service: string | null
          last_vehicle: string | null
          lifetime_value: number | null
          metadata: Json | null
          name: string | null
          notes: string | null
          phone: string | null
          shop_id: string | null
          source: string | null
          total_booked: number | null
          total_inquiries: number | null
          total_quotes_sent: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          id?: string
          industry?: string | null
          is_test?: boolean
          last_contact_at?: string | null
          last_service?: string | null
          last_vehicle?: string | null
          lifetime_value?: number | null
          metadata?: Json | null
          name?: string | null
          notes?: string | null
          phone?: string | null
          shop_id?: string | null
          source?: string | null
          total_booked?: number | null
          total_inquiries?: number | null
          total_quotes_sent?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          id?: string
          industry?: string | null
          is_test?: boolean
          last_contact_at?: string | null
          last_service?: string | null
          last_vehicle?: string | null
          lifetime_value?: number | null
          metadata?: Json | null
          name?: string | null
          notes?: string | null
          phone?: string | null
          shop_id?: string | null
          source?: string | null
          total_booked?: number | null
          total_inquiries?: number | null
          total_quotes_sent?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      design_canvas_documents: {
        Row: {
          canvas: Json
          created_at: string
          flattened_url: string | null
          id: string
          layers: Json
          name: string
          org_id: string | null
          thumbnail_url: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          canvas?: Json
          created_at?: string
          flattened_url?: string | null
          id?: string
          layers?: Json
          name?: string
          org_id?: string | null
          thumbnail_url?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          canvas?: Json
          created_at?: string
          flattened_url?: string | null
          id?: string
          layers?: Json
          name?: string
          org_id?: string | null
          thumbnail_url?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      design_generation_assets: {
        Row: {
          alternate_overlays: Json
          background_url: string | null
          created_at: string
          generation_id: string
          hero_scrubbed: boolean | null
          id: string
          is_current: boolean
          iteration_index: number
          layer_layout: Json | null
          layer_manifest: Json
          organization_id: string | null
          overlay_pngs: Json
          panel_zones: Json
          parent_asset_id: string | null
          proof_2d_url: string | null
          proof_3d_url: string | null
          qc_stamped_at: string | null
          qc_stamped_by: string | null
          qc_status: string
          shop_id: string | null
          source: string
          source_prompt: string | null
          updated_at: string
          user_id: string | null
          view_urls: Json
        }
        Insert: {
          alternate_overlays?: Json
          background_url?: string | null
          created_at?: string
          generation_id: string
          hero_scrubbed?: boolean | null
          id?: string
          is_current?: boolean
          iteration_index?: number
          layer_layout?: Json | null
          layer_manifest?: Json
          organization_id?: string | null
          overlay_pngs?: Json
          panel_zones?: Json
          parent_asset_id?: string | null
          proof_2d_url?: string | null
          proof_3d_url?: string | null
          qc_stamped_at?: string | null
          qc_stamped_by?: string | null
          qc_status?: string
          shop_id?: string | null
          source?: string
          source_prompt?: string | null
          updated_at?: string
          user_id?: string | null
          view_urls?: Json
        }
        Update: {
          alternate_overlays?: Json
          background_url?: string | null
          created_at?: string
          generation_id?: string
          hero_scrubbed?: boolean | null
          id?: string
          is_current?: boolean
          iteration_index?: number
          layer_layout?: Json | null
          layer_manifest?: Json
          organization_id?: string | null
          overlay_pngs?: Json
          panel_zones?: Json
          parent_asset_id?: string | null
          proof_2d_url?: string | null
          proof_3d_url?: string | null
          qc_stamped_at?: string | null
          qc_stamped_by?: string | null
          qc_status?: string
          shop_id?: string | null
          source?: string
          source_prompt?: string | null
          updated_at?: string
          user_id?: string | null
          view_urls?: Json
        }
        Relationships: [
          {
            foreignKeyName: "design_generation_assets_parent_asset_id_fkey"
            columns: ["parent_asset_id"]
            isOneToOne: false
            referencedRelation: "design_generation_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      design_pack_purchases: {
        Row: {
          created_at: string | null
          customer_order_number: string | null
          delivered_at: string | null
          design_equity_id: string | null
          design_id: string
          download_expires_at: string | null
          download_url: string | null
          downloaded_at: string | null
          email: string
          generation_completed_at: string | null
          generation_id: string | null
          generation_started_at: string | null
          id: string
          include_front_bumper: boolean | null
          include_hood: boolean | null
          include_rear_plus_bumper: boolean | null
          order_metadata: Json | null
          order_number: string | null
          production_status: string | null
          prompt_fingerprint: string | null
          purchase_type: string
          qa_attempts: number | null
          qa_completed_at: string | null
          qa_started_at: string | null
          recommended_size: string | null
          roof_size: string | null
          selected_size: string | null
          size_was_overridden: boolean | null
          stripe_checkout_id: string
          updated_at: string | null
          user_id: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_year: string | null
          wrapbox_delivery_url: string | null
        }
        Insert: {
          created_at?: string | null
          customer_order_number?: string | null
          delivered_at?: string | null
          design_equity_id?: string | null
          design_id: string
          download_expires_at?: string | null
          download_url?: string | null
          downloaded_at?: string | null
          email: string
          generation_completed_at?: string | null
          generation_id?: string | null
          generation_started_at?: string | null
          id?: string
          include_front_bumper?: boolean | null
          include_hood?: boolean | null
          include_rear_plus_bumper?: boolean | null
          order_metadata?: Json | null
          order_number?: string | null
          production_status?: string | null
          prompt_fingerprint?: string | null
          purchase_type: string
          qa_attempts?: number | null
          qa_completed_at?: string | null
          qa_started_at?: string | null
          recommended_size?: string | null
          roof_size?: string | null
          selected_size?: string | null
          size_was_overridden?: boolean | null
          stripe_checkout_id: string
          updated_at?: string | null
          user_id?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: string | null
          wrapbox_delivery_url?: string | null
        }
        Update: {
          created_at?: string | null
          customer_order_number?: string | null
          delivered_at?: string | null
          design_equity_id?: string | null
          design_id?: string
          download_expires_at?: string | null
          download_url?: string | null
          downloaded_at?: string | null
          email?: string
          generation_completed_at?: string | null
          generation_id?: string | null
          generation_started_at?: string | null
          id?: string
          include_front_bumper?: boolean | null
          include_hood?: boolean | null
          include_rear_plus_bumper?: boolean | null
          order_metadata?: Json | null
          order_number?: string | null
          production_status?: string | null
          prompt_fingerprint?: string | null
          purchase_type?: string
          qa_attempts?: number | null
          qa_completed_at?: string | null
          qa_started_at?: string | null
          recommended_size?: string | null
          roof_size?: string | null
          selected_size?: string | null
          size_was_overridden?: boolean | null
          stripe_checkout_id?: string
          updated_at?: string | null
          user_id?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: string | null
          wrapbox_delivery_url?: string | null
        }
        Relationships: []
      }
      design_revision_history: {
        Row: {
          created_at: string | null
          customer_decision: string
          decided_at: string | null
          design_id: string | null
          id: string
          job_id: string | null
          layer_deltas: Json | null
          original_url: string | null
          revised_url: string | null
          revision_prompt: string
          shop_id: string | null
          tool: string
          user_id: string | null
          view_type: string | null
        }
        Insert: {
          created_at?: string | null
          customer_decision?: string
          decided_at?: string | null
          design_id?: string | null
          id?: string
          job_id?: string | null
          layer_deltas?: Json | null
          original_url?: string | null
          revised_url?: string | null
          revision_prompt: string
          shop_id?: string | null
          tool: string
          user_id?: string | null
          view_type?: string | null
        }
        Update: {
          created_at?: string | null
          customer_decision?: string
          decided_at?: string | null
          design_id?: string | null
          id?: string
          job_id?: string | null
          layer_deltas?: Json | null
          original_url?: string | null
          revised_url?: string | null
          revision_prompt?: string
          shop_id?: string | null
          tool?: string
          user_id?: string | null
          view_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "design_revision_history_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "panelizer_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "design_revision_history_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      design_revisions: {
        Row: {
          agent_used: string | null
          company_name: string | null
          completed_at: string | null
          coordinate_map: Json | null
          created_at: string | null
          crop_zones: Json | null
          current_panel_path: string | null
          design_description: string | null
          emergency_fallback_path: string | null
          error_message: string | null
          generation_ms: number | null
          id: string
          job_id: string
          last_known_good_path: string | null
          master_artboard_path: string | null
          panel_id: number | null
          panel_name: string
          processing_started_at: string | null
          retry_count: number | null
          revision_request: string | null
          shop_id: string | null
          size_kb: number | null
          state: Database["public"]["Enums"]["revision_state"]
          technical_instruction: string | null
          updated_at: string | null
          user_id: string | null
          vehicle_make: string | null
          vehicle_model: string | null
        }
        Insert: {
          agent_used?: string | null
          company_name?: string | null
          completed_at?: string | null
          coordinate_map?: Json | null
          created_at?: string | null
          crop_zones?: Json | null
          current_panel_path?: string | null
          design_description?: string | null
          emergency_fallback_path?: string | null
          error_message?: string | null
          generation_ms?: number | null
          id?: string
          job_id: string
          last_known_good_path?: string | null
          master_artboard_path?: string | null
          panel_id?: number | null
          panel_name: string
          processing_started_at?: string | null
          retry_count?: number | null
          revision_request?: string | null
          shop_id?: string | null
          size_kb?: number | null
          state?: Database["public"]["Enums"]["revision_state"]
          technical_instruction?: string | null
          updated_at?: string | null
          user_id?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
        }
        Update: {
          agent_used?: string | null
          company_name?: string | null
          completed_at?: string | null
          coordinate_map?: Json | null
          created_at?: string | null
          crop_zones?: Json | null
          current_panel_path?: string | null
          design_description?: string | null
          emergency_fallback_path?: string | null
          error_message?: string | null
          generation_ms?: number | null
          id?: string
          job_id?: string
          last_known_good_path?: string | null
          master_artboard_path?: string | null
          panel_id?: number | null
          panel_name?: string
          processing_started_at?: string | null
          retry_count?: number | null
          revision_request?: string | null
          shop_id?: string | null
          size_kb?: number | null
          state?: Database["public"]["Enums"]["revision_state"]
          technical_instruction?: string | null
          updated_at?: string | null
          user_id?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "design_revisions_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      design_version_commits: {
        Row: {
          angle_renders_json: Json
          change_type: string
          created_at: string
          hero_render_url: string | null
          id: string
          job_id: string
          master_artboard_url: string | null
          shop_id: string | null
          system_prompt_snapshot: string | null
          user_id: string | null
          user_prompt: string | null
          version_number: number
        }
        Insert: {
          angle_renders_json?: Json
          change_type?: string
          created_at?: string
          hero_render_url?: string | null
          id?: string
          job_id: string
          master_artboard_url?: string | null
          shop_id?: string | null
          system_prompt_snapshot?: string | null
          user_id?: string | null
          user_prompt?: string | null
          version_number: number
        }
        Update: {
          angle_renders_json?: Json
          change_type?: string
          created_at?: string
          hero_render_url?: string | null
          id?: string
          job_id?: string
          master_artboard_url?: string | null
          shop_id?: string | null
          system_prompt_snapshot?: string | null
          user_id?: string | null
          user_prompt?: string | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "design_version_commits_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      designer_qc_queue: {
        Row: {
          ai_output_url: string | null
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          customer_feedback: string | null
          designer_id: string | null
          designer_notes: string | null
          id: string
          priority: string
          project_id: string
          project_table: string
          shop_id: string
          status: string
          ticket_type: string
          user_id: string
        }
        Insert: {
          ai_output_url?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          customer_feedback?: string | null
          designer_id?: string | null
          designer_notes?: string | null
          id?: string
          priority?: string
          project_id: string
          project_table: string
          shop_id: string
          status?: string
          ticket_type: string
          user_id: string
        }
        Update: {
          ai_output_url?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          customer_feedback?: string | null
          designer_id?: string | null
          designer_notes?: string | null
          id?: string
          priority?: string
          project_id?: string
          project_table?: string
          shop_id?: string
          status?: string
          ticket_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "designer_qc_queue_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      designiq_generations: {
        Row: {
          brand_keywords: string[] | null
          company_name: string | null
          concept_fingerprint: string | null
          created_at: string | null
          design_config: Json | null
          design_equity_id: string | null
          design_name: string | null
          engine_version: string | null
          enhanced_prompt: string | null
          error_message: string | null
          finish: string | null
          flat_proof_url: string | null
          generation_status: string | null
          hero_render_url: string | null
          id: string
          industry_type: string | null
          mascot: string | null
          master_artboard_clean_url: string | null
          master_artboard_url: string | null
          mode: string
          panel_completed_at: string | null
          panel_id: string | null
          panel_mime_type: string | null
          panel_url: string | null
          prompt_fingerprint: string | null
          prompt_hash: string | null
          proof_pdf_url: string | null
          pt: string | null
          quote_id: string | null
          raw_prompt: string
          render_completed_at: string | null
          render_urls: Json | null
          shop_id: string | null
          spin_urls: Json | null
          style_preset: string | null
          truespec_metadata: Json | null
          updated_at: string | null
          user_email: string | null
          user_id: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_year: string | null
          visionboard_image_refs: string[] | null
        }
        Insert: {
          brand_keywords?: string[] | null
          company_name?: string | null
          concept_fingerprint?: string | null
          created_at?: string | null
          design_config?: Json | null
          design_equity_id?: string | null
          design_name?: string | null
          engine_version?: string | null
          enhanced_prompt?: string | null
          error_message?: string | null
          finish?: string | null
          flat_proof_url?: string | null
          generation_status?: string | null
          hero_render_url?: string | null
          id?: string
          industry_type?: string | null
          mascot?: string | null
          master_artboard_clean_url?: string | null
          master_artboard_url?: string | null
          mode: string
          panel_completed_at?: string | null
          panel_id?: string | null
          panel_mime_type?: string | null
          panel_url?: string | null
          prompt_fingerprint?: string | null
          prompt_hash?: string | null
          proof_pdf_url?: string | null
          pt?: string | null
          quote_id?: string | null
          raw_prompt: string
          render_completed_at?: string | null
          render_urls?: Json | null
          shop_id?: string | null
          spin_urls?: Json | null
          style_preset?: string | null
          truespec_metadata?: Json | null
          updated_at?: string | null
          user_email?: string | null
          user_id?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: string | null
          visionboard_image_refs?: string[] | null
        }
        Update: {
          brand_keywords?: string[] | null
          company_name?: string | null
          concept_fingerprint?: string | null
          created_at?: string | null
          design_config?: Json | null
          design_equity_id?: string | null
          design_name?: string | null
          engine_version?: string | null
          enhanced_prompt?: string | null
          error_message?: string | null
          finish?: string | null
          flat_proof_url?: string | null
          generation_status?: string | null
          hero_render_url?: string | null
          id?: string
          industry_type?: string | null
          mascot?: string | null
          master_artboard_clean_url?: string | null
          master_artboard_url?: string | null
          mode?: string
          panel_completed_at?: string | null
          panel_id?: string | null
          panel_mime_type?: string | null
          panel_url?: string | null
          prompt_fingerprint?: string | null
          prompt_hash?: string | null
          proof_pdf_url?: string | null
          pt?: string | null
          quote_id?: string | null
          raw_prompt?: string
          render_completed_at?: string | null
          render_urls?: Json | null
          shop_id?: string | null
          spin_urls?: Json | null
          style_preset?: string | null
          truespec_metadata?: Json | null
          updated_at?: string | null
          user_email?: string | null
          user_id?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: string | null
          visionboard_image_refs?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "designiq_generations_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "designiq_generations_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shop_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      designpanelpro_carousel: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          manufacturer: string | null
          media_url: string
          name: string
          pattern_name: string | null
          sort_order: number | null
          subtitle: string | null
          title: string | null
          updated_at: string | null
          vehicle_name: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          manufacturer?: string | null
          media_url: string
          name: string
          pattern_name?: string | null
          sort_order?: number | null
          subtitle?: string | null
          title?: string | null
          updated_at?: string | null
          vehicle_name?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          manufacturer?: string | null
          media_url?: string
          name?: string
          pattern_name?: string | null
          sort_order?: number | null
          subtitle?: string | null
          title?: string | null
          updated_at?: string | null
          vehicle_name?: string | null
        }
        Relationships: []
      }
      designpanelpro_patterns: {
        Row: {
          ai_generated_name: string | null
          category: string | null
          clean_display_url: string | null
          created_at: string | null
          example_render_url: string | null
          finish: string | null
          id: string
          is_active: boolean | null
          is_curated: boolean | null
          media_url: string
          name: string
          production_file_url: string | null
          prompt_text: string | null
          sort_order: number | null
          thumbnail_url: string | null
          updated_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          ai_generated_name?: string | null
          category?: string | null
          clean_display_url?: string | null
          created_at?: string | null
          example_render_url?: string | null
          finish?: string | null
          id?: string
          is_active?: boolean | null
          is_curated?: boolean | null
          media_url: string
          name: string
          production_file_url?: string | null
          prompt_text?: string | null
          sort_order?: number | null
          thumbnail_url?: string | null
          updated_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          ai_generated_name?: string | null
          category?: string | null
          clean_display_url?: string | null
          created_at?: string | null
          example_render_url?: string | null
          finish?: string | null
          id?: string
          is_active?: boolean | null
          is_curated?: boolean | null
          media_url?: string
          name?: string
          production_file_url?: string | null
          prompt_text?: string | null
          sort_order?: number | null
          thumbnail_url?: string | null
          updated_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: []
      }
      designpanelpro_videos: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          media_url: string
          name: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          media_url: string
          name: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          media_url?: string
          name?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      designpro_panel_manifests: {
        Row: {
          boxes: Json
          created_at: string
          id: string
          source_key: string
          source_url: string
          updated_at: string
        }
        Insert: {
          boxes?: Json
          created_at?: string
          id?: string
          source_key: string
          source_url: string
          updated_at?: string
        }
        Update: {
          boxes?: Json
          created_at?: string
          id?: string
          source_key?: string
          source_url?: string
          updated_at?: string
        }
        Relationships: []
      }
      designpro_production_jobs: {
        Row: {
          attempts: number
          blocked: Json
          completed_at: string | null
          created_at: string
          generation_id: string
          id: string
          idempotency_key: string
          last_error: string | null
          order_number: string
          panelizer_job_id: string
          result: Json | null
          stage: string
          state: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          blocked?: Json
          completed_at?: string | null
          created_at?: string
          generation_id: string
          id?: string
          idempotency_key: string
          last_error?: string | null
          order_number: string
          panelizer_job_id: string
          result?: Json | null
          stage?: string
          state?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          blocked?: Json
          completed_at?: string | null
          created_at?: string
          generation_id?: string
          id?: string
          idempotency_key?: string
          last_error?: string | null
          order_number?: string
          panelizer_job_id?: string
          result?: Json | null
          stage?: string
          state?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      dev_agent_events: {
        Row: {
          acknowledged: boolean | null
          created_at: string | null
          event_type: string
          id: string
          payload: Json
          resolved: boolean | null
          severity: string | null
        }
        Insert: {
          acknowledged?: boolean | null
          created_at?: string | null
          event_type: string
          id?: string
          payload: Json
          resolved?: boolean | null
          severity?: string | null
        }
        Update: {
          acknowledged?: boolean | null
          created_at?: string | null
          event_type?: string
          id?: string
          payload?: Json
          resolved?: boolean | null
          severity?: string | null
        }
        Relationships: []
      }
      dpa_early_access: {
        Row: {
          created_at: string
          email: string
          id: string
          marketing_opt_in: boolean
          name: string
          role: string | null
          shop_name: string | null
          source: string
          want_to_create: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          marketing_opt_in?: boolean
          name: string
          role?: string | null
          shop_name?: string | null
          source?: string
          want_to_create?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          marketing_opt_in?: boolean
          name?: string
          role?: string | null
          shop_name?: string | null
          source?: string
          want_to_create?: string | null
        }
        Relationships: []
      }
      email_campaign_events: {
        Row: {
          campaign_id: string
          created_at: string | null
          event_type: string
          id: string
          ip_address: string | null
          metadata: Json | null
          send_id: string | null
          user_agent: string | null
        }
        Insert: {
          campaign_id: string
          created_at?: string | null
          event_type: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          send_id?: string | null
          user_agent?: string | null
        }
        Update: {
          campaign_id?: string
          created_at?: string | null
          event_type?: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          send_id?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_campaign_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "email_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_campaign_events_send_id_fkey"
            columns: ["send_id"]
            isOneToOne: false
            referencedRelation: "email_campaign_sends"
            referencedColumns: ["id"]
          },
        ]
      }
      email_campaign_sends: {
        Row: {
          campaign_id: string
          clicked_at: string | null
          created_at: string | null
          error_message: string | null
          id: string
          opened_at: string | null
          recipient_email: string
          recipient_user_id: string | null
          resend_message_id: string | null
          status: string
        }
        Insert: {
          campaign_id: string
          clicked_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          opened_at?: string | null
          recipient_email: string
          recipient_user_id?: string | null
          resend_message_id?: string | null
          status?: string
        }
        Update: {
          campaign_id?: string
          clicked_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          opened_at?: string | null
          recipient_email?: string
          recipient_user_id?: string | null
          resend_message_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_campaign_sends_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "email_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      email_campaigns: {
        Row: {
          audience: string
          created_at: string | null
          created_by: string | null
          custom_emails: string[] | null
          from_email: string | null
          from_name: string | null
          html_content: string
          id: string
          name: string
          retarget_at: string | null
          retarget_status: string | null
          scheduled_at: string | null
          sent_at: string | null
          shop_id: string | null
          status: string
          subject: string
          subscriber_source: string | null
          text_content: string | null
          total_clicked: number | null
          total_failed: number | null
          total_opened: number | null
          total_recipients: number | null
          total_sent: number | null
          updated_at: string | null
        }
        Insert: {
          audience?: string
          created_at?: string | null
          created_by?: string | null
          custom_emails?: string[] | null
          from_email?: string | null
          from_name?: string | null
          html_content: string
          id?: string
          name: string
          retarget_at?: string | null
          retarget_status?: string | null
          scheduled_at?: string | null
          sent_at?: string | null
          shop_id?: string | null
          status?: string
          subject: string
          subscriber_source?: string | null
          text_content?: string | null
          total_clicked?: number | null
          total_failed?: number | null
          total_opened?: number | null
          total_recipients?: number | null
          total_sent?: number | null
          updated_at?: string | null
        }
        Update: {
          audience?: string
          created_at?: string | null
          created_by?: string | null
          custom_emails?: string[] | null
          from_email?: string | null
          from_name?: string | null
          html_content?: string
          id?: string
          name?: string
          retarget_at?: string | null
          retarget_status?: string | null
          scheduled_at?: string | null
          sent_at?: string | null
          shop_id?: string | null
          status?: string
          subject?: string
          subscriber_source?: string | null
          text_content?: string | null
          total_clicked?: number | null
          total_failed?: number | null
          total_opened?: number | null
          total_recipients?: number | null
          total_sent?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_campaigns_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shop_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_log: {
        Row: {
          body: string | null
          bounced_at: string | null
          complained_at: string | null
          customer_id: string | null
          delivered_at: string | null
          email_type: string | null
          id: string
          last_event_at: string | null
          last_event_type: string | null
          metadata: Json | null
          opened_at: string | null
          quote_id: string | null
          recipient: string | null
          resend_message_id: string | null
          sent_at: string | null
          shop_id: string | null
          status: string | null
          subject: string | null
        }
        Insert: {
          body?: string | null
          bounced_at?: string | null
          complained_at?: string | null
          customer_id?: string | null
          delivered_at?: string | null
          email_type?: string | null
          id?: string
          last_event_at?: string | null
          last_event_type?: string | null
          metadata?: Json | null
          opened_at?: string | null
          quote_id?: string | null
          recipient?: string | null
          resend_message_id?: string | null
          sent_at?: string | null
          shop_id?: string | null
          status?: string | null
          subject?: string | null
        }
        Update: {
          body?: string | null
          bounced_at?: string | null
          complained_at?: string | null
          customer_id?: string | null
          delivered_at?: string | null
          email_type?: string | null
          id?: string
          last_event_at?: string | null
          last_event_type?: string | null
          metadata?: Json | null
          opened_at?: string | null
          quote_id?: string | null
          recipient?: string | null
          resend_message_id?: string | null
          sent_at?: string | null
          shop_id?: string | null
          status?: string | null
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_log_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_log_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_log_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shop_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_sends: {
        Row: {
          claimed_at: string | null
          created_at: string
          day_n: number
          email: string
          error: string | null
          flow: string
          id: string
          merge_data: Json | null
          opened_at: string | null
          resend_id: string | null
          segment: string | null
          sent_at: string
          status: string
          template_slug: string | null
        }
        Insert: {
          claimed_at?: string | null
          created_at?: string
          day_n?: number
          email: string
          error?: string | null
          flow: string
          id?: string
          merge_data?: Json | null
          opened_at?: string | null
          resend_id?: string | null
          segment?: string | null
          sent_at?: string
          status?: string
          template_slug?: string | null
        }
        Update: {
          claimed_at?: string | null
          created_at?: string
          day_n?: number
          email?: string
          error?: string | null
          flow?: string
          id?: string
          merge_data?: Json | null
          opened_at?: string | null
          resend_id?: string | null
          segment?: string | null
          sent_at?: string
          status?: string
          template_slug?: string | null
        }
        Relationships: []
      }
      email_subscribers: {
        Row: {
          created_at: string
          email: string
          first_name: string | null
          id: string
          metadata: Json
          phone: string | null
          renders_unlocked: boolean | null
          sms_opt_in: boolean | null
          social_shared: boolean | null
          source: string
          unsubscribed: boolean | null
          unsubscribed_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          first_name?: string | null
          id?: string
          metadata?: Json
          phone?: string | null
          renders_unlocked?: boolean | null
          sms_opt_in?: boolean | null
          social_shared?: boolean | null
          source?: string
          unsubscribed?: boolean | null
          unsubscribed_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          first_name?: string | null
          id?: string
          metadata?: Json
          phone?: string | null
          renders_unlocked?: boolean | null
          sms_opt_in?: boolean | null
          social_shared?: boolean | null
          source?: string
          unsubscribed?: boolean | null
          unsubscribed_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      email_templates: {
        Row: {
          category: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          from_email: string | null
          from_name: string | null
          html_content: string
          id: string
          is_active: boolean | null
          merge_tags: Json | null
          name: string
          slug: string
          subject: string
          text_content: string | null
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          from_email?: string | null
          from_name?: string | null
          html_content?: string
          id?: string
          is_active?: boolean | null
          merge_tags?: Json | null
          name: string
          slug: string
          subject: string
          text_content?: string | null
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          from_email?: string | null
          from_name?: string | null
          html_content?: string
          id?: string
          is_active?: boolean | null
          merge_tags?: Json | null
          name?: string
          slug?: string
          subject?: string
          text_content?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      engine_room_issues: {
        Row: {
          body_markdown: string
          brand: string
          category: string
          created_at: string
          id: string
          page_url: string | null
          render_id: string | null
          reporter_email: string | null
          reporter_name: string | null
          reporter_user_id: string | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          status: string
          title: string
          tool: string | null
          user_agent: string | null
        }
        Insert: {
          body_markdown: string
          brand?: string
          category?: string
          created_at?: string
          id?: string
          page_url?: string | null
          render_id?: string | null
          reporter_email?: string | null
          reporter_name?: string | null
          reporter_user_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
          title: string
          tool?: string | null
          user_agent?: string | null
        }
        Update: {
          body_markdown?: string
          brand?: string
          category?: string
          created_at?: string
          id?: string
          page_url?: string | null
          render_id?: string | null
          reporter_email?: string | null
          reporter_name?: string | null
          reporter_user_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
          title?: string
          tool?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      engineroom_reports: {
        Row: {
          category: string
          claude_ticket: string | null
          console_errors: Json | null
          created_at: string
          description: string
          id: string
          page_title: string | null
          page_url: string | null
          reporter_email: string
          reporter_id: string | null
          screenshot_url: string | null
          severity: string
          status: string
          triaged_at: string | null
          triaged_by: string | null
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          category: string
          claude_ticket?: string | null
          console_errors?: Json | null
          created_at?: string
          description: string
          id?: string
          page_title?: string | null
          page_url?: string | null
          reporter_email: string
          reporter_id?: string | null
          screenshot_url?: string | null
          severity: string
          status?: string
          triaged_at?: string | null
          triaged_by?: string | null
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          category?: string
          claude_ticket?: string | null
          console_errors?: Json | null
          created_at?: string
          description?: string
          id?: string
          page_title?: string | null
          page_url?: string | null
          reporter_email?: string
          reporter_id?: string | null
          screenshot_url?: string | null
          severity?: string
          status?: string
          triaged_at?: string | null
          triaged_by?: string | null
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      error_events: {
        Row: {
          app_version: string | null
          component_stack: string | null
          created_at: string
          error_name: string | null
          fingerprint: string
          first_seen_at: string
          fix_attempted_at: string | null
          fix_dispatched_at: string | null
          fix_dispatched_by: string | null
          fix_error: string | null
          fix_issue_number: number | null
          fix_issue_url: string | null
          fix_merged_at: string | null
          fix_pr_url: string | null
          fix_status: string | null
          id: string
          last_seen_at: string
          message: string
          metadata: Json
          notified_at: string | null
          occurrence_count: number
          route: string | null
          severity: string
          source: string
          stack: string | null
          status: string
          url: string | null
          user_agent: string | null
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          app_version?: string | null
          component_stack?: string | null
          created_at?: string
          error_name?: string | null
          fingerprint: string
          first_seen_at?: string
          fix_attempted_at?: string | null
          fix_dispatched_at?: string | null
          fix_dispatched_by?: string | null
          fix_error?: string | null
          fix_issue_number?: number | null
          fix_issue_url?: string | null
          fix_merged_at?: string | null
          fix_pr_url?: string | null
          fix_status?: string | null
          id?: string
          last_seen_at?: string
          message: string
          metadata?: Json
          notified_at?: string | null
          occurrence_count?: number
          route?: string | null
          severity?: string
          source?: string
          stack?: string | null
          status?: string
          url?: string | null
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          app_version?: string | null
          component_stack?: string | null
          created_at?: string
          error_name?: string | null
          fingerprint?: string
          first_seen_at?: string
          fix_attempted_at?: string | null
          fix_dispatched_at?: string | null
          fix_dispatched_by?: string | null
          fix_error?: string | null
          fix_issue_number?: number | null
          fix_issue_url?: string | null
          fix_merged_at?: string | null
          fix_pr_url?: string | null
          fix_status?: string | null
          id?: string
          last_seen_at?: string
          message?: string
          metadata?: Json
          notified_at?: string | null
          occurrence_count?: number
          route?: string | null
          severity?: string
          source?: string
          stack?: string | null
          status?: string
          url?: string | null
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      extracted_elements: {
        Row: {
          bounding_box: Json
          clean_background_url: string
          created_at: string
          element_label: string | null
          element_type: string
          id: string
          render_id: string | null
          reuse_count: number
          shop_id: string | null
          transparent_png_url: string
          user_id: string
        }
        Insert: {
          bounding_box: Json
          clean_background_url: string
          created_at?: string
          element_label?: string | null
          element_type: string
          id?: string
          render_id?: string | null
          reuse_count?: number
          shop_id?: string | null
          transparent_png_url: string
          user_id: string
        }
        Update: {
          bounding_box?: Json
          clean_background_url?: string
          created_at?: string
          element_label?: string | null
          element_type?: string
          id?: string
          render_id?: string | null
          reuse_count?: number
          shop_id?: string | null
          transparent_png_url?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "extracted_elements_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      fadewrap_designs: {
        Row: {
          created_at: string | null
          fade_category: string | null
          fade_name: string | null
          finish: string | null
          gradient_settings: Json | null
          id: string
          pattern_id: string | null
          preview_image_url: string | null
          shop_id: string | null
          updated_at: string | null
          user_id: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_year: string | null
        }
        Insert: {
          created_at?: string | null
          fade_category?: string | null
          fade_name?: string | null
          finish?: string | null
          gradient_settings?: Json | null
          id?: string
          pattern_id?: string | null
          preview_image_url?: string | null
          shop_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: string | null
        }
        Update: {
          created_at?: string | null
          fade_category?: string | null
          fade_name?: string | null
          finish?: string | null
          gradient_settings?: Json | null
          id?: string
          pattern_id?: string | null
          preview_image_url?: string | null
          shop_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fadewrap_designs_pattern_id_fkey"
            columns: ["pattern_id"]
            isOneToOne: false
            referencedRelation: "fadewraps_patterns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fadewrap_designs_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      fadewraps_carousel: {
        Row: {
          created_at: string | null
          gradient_direction: string | null
          id: string
          is_active: boolean | null
          manufacturer: string | null
          media_url: string
          name: string
          sort_order: number | null
          subtitle: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          gradient_direction?: string | null
          id?: string
          is_active?: boolean | null
          manufacturer?: string | null
          media_url: string
          name: string
          sort_order?: number | null
          subtitle?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          gradient_direction?: string | null
          id?: string
          is_active?: boolean | null
          manufacturer?: string | null
          media_url?: string
          name?: string
          sort_order?: number | null
          subtitle?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      fadewraps_patterns: {
        Row: {
          category: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          media_type: string
          media_url: string
          name: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          media_type: string
          media_url: string
          name: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          media_type?: string
          media_url?: string
          name?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      fadewraps_videos: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          media_url: string
          name: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          media_url: string
          name: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          media_url?: string
          name?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      film_color_references: {
        Row: {
          approval_count: number
          approved_by: string | null
          created_at: string
          film_name: string
          id: string
          last_used_at: string | null
          manufacturer: string
          prompt_context: string | null
          render_count: number
          sku: string | null
          source: string
          submitted_by: string | null
          swatch_image_url: string | null
          updated_at: string
          vehicle_example_urls: Json
        }
        Insert: {
          approval_count?: number
          approved_by?: string | null
          created_at?: string
          film_name: string
          id?: string
          last_used_at?: string | null
          manufacturer: string
          prompt_context?: string | null
          render_count?: number
          sku?: string | null
          source: string
          submitted_by?: string | null
          swatch_image_url?: string | null
          updated_at?: string
          vehicle_example_urls?: Json
        }
        Update: {
          approval_count?: number
          approved_by?: string | null
          created_at?: string
          film_name?: string
          id?: string
          last_used_at?: string | null
          manufacturer?: string
          prompt_context?: string | null
          render_count?: number
          sku?: string | null
          source?: string
          submitted_by?: string | null
          swatch_image_url?: string | null
          updated_at?: string
          vehicle_example_urls?: Json
        }
        Relationships: []
      }
      flatpanelstudio_designs: {
        Row: {
          company_name: string | null
          created_at: string
          design_name: string | null
          finish: string | null
          id: string
          panels: Json
          prompt: string | null
          session_id: string
          user_id: string
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_type: string | null
          vehicle_year: string | null
        }
        Insert: {
          company_name?: string | null
          created_at?: string
          design_name?: string | null
          finish?: string | null
          id?: string
          panels?: Json
          prompt?: string | null
          session_id: string
          user_id?: string
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_type?: string | null
          vehicle_year?: string | null
        }
        Update: {
          company_name?: string | null
          created_at?: string
          design_name?: string | null
          finish?: string | null
          id?: string
          panels?: Json
          prompt?: string | null
          session_id?: string
          user_id?: string
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_type?: string | null
          vehicle_year?: string | null
        }
        Relationships: []
      }
      franchise_admins: {
        Row: {
          created_at: string
          franchise_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          franchise_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          franchise_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "franchise_admins_franchise_id_fkey"
            columns: ["franchise_id"]
            isOneToOne: false
            referencedRelation: "franchises"
            referencedColumns: ["id"]
          },
        ]
      }
      franchises: {
        Row: {
          brand_primary_color: string | null
          brand_secondary_color: string | null
          created_at: string
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
          slug: string
          updated_at: string
          website: string | null
        }
        Insert: {
          brand_primary_color?: string | null
          brand_secondary_color?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
          slug: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          brand_primary_color?: string | null
          brand_secondary_color?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
          slug?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      gallery_submissions: {
        Row: {
          admin_notes: string | null
          admin_reviewed_at: string | null
          admin_reviewed_by: string | null
          created_at: string | null
          design_dna_id: string
          featured_order: number | null
          id: string
          org_id: string | null
          shop_id: string | null
          social_post_urls: Json | null
          social_posted: boolean | null
          status: string | null
          user_id: string | null
        }
        Insert: {
          admin_notes?: string | null
          admin_reviewed_at?: string | null
          admin_reviewed_by?: string | null
          created_at?: string | null
          design_dna_id: string
          featured_order?: number | null
          id?: string
          org_id?: string | null
          shop_id?: string | null
          social_post_urls?: Json | null
          social_posted?: boolean | null
          status?: string | null
          user_id?: string | null
        }
        Update: {
          admin_notes?: string | null
          admin_reviewed_at?: string | null
          admin_reviewed_by?: string | null
          created_at?: string | null
          design_dna_id?: string
          featured_order?: number | null
          id?: string
          org_id?: string | null
          shop_id?: string | null
          social_post_urls?: Json | null
          social_posted?: boolean | null
          status?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gallery_submissions_design_dna_id_fkey"
            columns: ["design_dna_id"]
            isOneToOne: false
            referencedRelation: "neuralnetwork_design_dna"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gallery_submissions_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      gbp_scheduled_posts: {
        Row: {
          call_to_action: Json | null
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          media_url: string | null
          posted_at: string | null
          scheduled_for: string
          shop_id: string
          status: string
          summary: string
          topic_type: string
          updated_at: string
        }
        Insert: {
          call_to_action?: Json | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          media_url?: string | null
          posted_at?: string | null
          scheduled_for: string
          shop_id: string
          status?: string
          summary: string
          topic_type?: string
          updated_at?: string
        }
        Update: {
          call_to_action?: Json | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          media_url?: string | null
          posted_at?: string | null
          scheduled_for?: string
          shop_id?: string
          status?: string
          summary?: string
          topic_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      genie_extraction_log: {
        Row: {
          aspect_ratio: string | null
          created_at: string | null
          dimensions_inches: string | null
          error_message: string | null
          flat_panel_url: string | null
          generation_time_ms: number | null
          id: string
          job_id: string
          model_used: string | null
          panel_key: string | null
          prompt_used: string | null
          rating: number | null
          rating_notes: string | null
          render_url: string | null
          status: string | null
          vehicle: string | null
        }
        Insert: {
          aspect_ratio?: string | null
          created_at?: string | null
          dimensions_inches?: string | null
          error_message?: string | null
          flat_panel_url?: string | null
          generation_time_ms?: number | null
          id?: string
          job_id: string
          model_used?: string | null
          panel_key?: string | null
          prompt_used?: string | null
          rating?: number | null
          rating_notes?: string | null
          render_url?: string | null
          status?: string | null
          vehicle?: string | null
        }
        Update: {
          aspect_ratio?: string | null
          created_at?: string | null
          dimensions_inches?: string | null
          error_message?: string | null
          flat_panel_url?: string | null
          generation_time_ms?: number | null
          id?: string
          job_id?: string
          model_used?: string | null
          panel_key?: string | null
          prompt_used?: string | null
          rating?: number | null
          rating_notes?: string | null
          render_url?: string | null
          status?: string | null
          vehicle?: string | null
        }
        Relationships: []
      }
      graphics_pro_jobs: {
        Row: {
          approved_at: string | null
          business_industry: string | null
          business_logo_url: string | null
          business_name: string | null
          business_phone: string | null
          business_tagline: string | null
          business_website: string | null
          closeup_render_url: string | null
          concept_json: Json | null
          created_at: string | null
          cut_contour_overlay_url: string | null
          cut_files_zip_url: string | null
          cut_path_eps_url: string | null
          cut_path_pdf_url: string | null
          cut_path_svg_url: string | null
          design_prompt: string | null
          design_style: string | null
          detail_render_url: string | null
          error_message: string | null
          extracted_element_count: number | null
          flat_production_url: string | null
          id: string
          material_type: string | null
          mockup_render_url: string | null
          mode: string
          nested_height_inches: number | null
          nested_width_inches: number | null
          output_zip_url: string | null
          progress: number | null
          quote_id: string | null
          restyle_prompt: string | null
          retail_price: number | null
          shop_id: string | null
          stage: string | null
          status: string
          surface_image_url: string | null
          surface_source: string | null
          surface_subcategory: string | null
          surface_texture: string | null
          surface_type: string | null
          total_sqft: number | null
          updated_at: string | null
          uploaded_artwork_urls: string[] | null
          user_id: string
          vectorized_count: number | null
          vectorized_url: string | null
          vehicle_area: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_year: number | null
          vinyl_finish: string | null
          vinyl_zones: Json | null
          wholesale_price: number | null
          zone_overlay_url: string | null
        }
        Insert: {
          approved_at?: string | null
          business_industry?: string | null
          business_logo_url?: string | null
          business_name?: string | null
          business_phone?: string | null
          business_tagline?: string | null
          business_website?: string | null
          closeup_render_url?: string | null
          concept_json?: Json | null
          created_at?: string | null
          cut_contour_overlay_url?: string | null
          cut_files_zip_url?: string | null
          cut_path_eps_url?: string | null
          cut_path_pdf_url?: string | null
          cut_path_svg_url?: string | null
          design_prompt?: string | null
          design_style?: string | null
          detail_render_url?: string | null
          error_message?: string | null
          extracted_element_count?: number | null
          flat_production_url?: string | null
          id?: string
          material_type?: string | null
          mockup_render_url?: string | null
          mode: string
          nested_height_inches?: number | null
          nested_width_inches?: number | null
          output_zip_url?: string | null
          progress?: number | null
          quote_id?: string | null
          restyle_prompt?: string | null
          retail_price?: number | null
          shop_id?: string | null
          stage?: string | null
          status?: string
          surface_image_url?: string | null
          surface_source?: string | null
          surface_subcategory?: string | null
          surface_texture?: string | null
          surface_type?: string | null
          total_sqft?: number | null
          updated_at?: string | null
          uploaded_artwork_urls?: string[] | null
          user_id: string
          vectorized_count?: number | null
          vectorized_url?: string | null
          vehicle_area?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: number | null
          vinyl_finish?: string | null
          vinyl_zones?: Json | null
          wholesale_price?: number | null
          zone_overlay_url?: string | null
        }
        Update: {
          approved_at?: string | null
          business_industry?: string | null
          business_logo_url?: string | null
          business_name?: string | null
          business_phone?: string | null
          business_tagline?: string | null
          business_website?: string | null
          closeup_render_url?: string | null
          concept_json?: Json | null
          created_at?: string | null
          cut_contour_overlay_url?: string | null
          cut_files_zip_url?: string | null
          cut_path_eps_url?: string | null
          cut_path_pdf_url?: string | null
          cut_path_svg_url?: string | null
          design_prompt?: string | null
          design_style?: string | null
          detail_render_url?: string | null
          error_message?: string | null
          extracted_element_count?: number | null
          flat_production_url?: string | null
          id?: string
          material_type?: string | null
          mockup_render_url?: string | null
          mode?: string
          nested_height_inches?: number | null
          nested_width_inches?: number | null
          output_zip_url?: string | null
          progress?: number | null
          quote_id?: string | null
          restyle_prompt?: string | null
          retail_price?: number | null
          shop_id?: string | null
          stage?: string | null
          status?: string
          surface_image_url?: string | null
          surface_source?: string | null
          surface_subcategory?: string | null
          surface_texture?: string | null
          surface_type?: string | null
          total_sqft?: number | null
          updated_at?: string | null
          uploaded_artwork_urls?: string[] | null
          user_id?: string
          vectorized_count?: number | null
          vectorized_url?: string | null
          vehicle_area?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: number | null
          vinyl_finish?: string | null
          vinyl_zones?: Json | null
          wholesale_price?: number | null
          zone_overlay_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "graphics_pro_jobs_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "graphics_pro_jobs_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shop_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      graphics_pro_pricing: {
        Row: {
          created_at: string | null
          id: string
          includes_masking: boolean | null
          includes_weeding: boolean | null
          material_name: string
          material_type: string
          max_artwork_width_inches: number | null
          wholesale_price_sqft: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          includes_masking?: boolean | null
          includes_weeding?: boolean | null
          material_name: string
          material_type: string
          max_artwork_width_inches?: number | null
          wholesale_price_sqft: number
        }
        Update: {
          created_at?: string | null
          id?: string
          includes_masking?: boolean | null
          includes_weeding?: boolean | null
          material_name?: string
          material_type?: string
          max_artwork_width_inches?: number | null
          wholesale_price_sqft?: number
        }
        Relationships: []
      }
      graphicspro_batch_results: {
        Row: {
          business_name: string | null
          created_at: string | null
          design_prompt: string | null
          duration_seconds: number | null
          error: string | null
          id: string
          mockup_url: string | null
          mode: string
          payload: Json | null
          style: string
          surface_url: string | null
          test_id: number
          test_name: string
          vehicle: string | null
          zones: Json | null
        }
        Insert: {
          business_name?: string | null
          created_at?: string | null
          design_prompt?: string | null
          duration_seconds?: number | null
          error?: string | null
          id?: string
          mockup_url?: string | null
          mode: string
          payload?: Json | null
          style: string
          surface_url?: string | null
          test_id: number
          test_name: string
          vehicle?: string | null
          zones?: Json | null
        }
        Update: {
          business_name?: string | null
          created_at?: string | null
          design_prompt?: string | null
          duration_seconds?: number | null
          error?: string | null
          id?: string
          mockup_url?: string | null
          mode?: string
          payload?: Json | null
          style?: string
          surface_url?: string | null
          test_id?: number
          test_name?: string
          vehicle?: string | null
          zones?: Json | null
        }
        Relationships: []
      }
      guest_design_sales: {
        Row: {
          amount_cents: number
          created_at: string
          email: string
          id: string
          marketing_opt_in: boolean
          name: string | null
          paid: boolean
          paid_at: string | null
          phone: string | null
          ref: string | null
          stripe_session_id: string
          user_id: string | null
        }
        Insert: {
          amount_cents?: number
          created_at?: string
          email: string
          id?: string
          marketing_opt_in?: boolean
          name?: string | null
          paid?: boolean
          paid_at?: string | null
          phone?: string | null
          ref?: string | null
          stripe_session_id: string
          user_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          email?: string
          id?: string
          marketing_opt_in?: boolean
          name?: string | null
          paid?: boolean
          paid_at?: string | null
          phone?: string | null
          ref?: string | null
          stripe_session_id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      helper_chats: {
        Row: {
          conversation_id: string | null
          created_at: string
          id: string
          last_message_at: string
          message_count: number
          messages: Json
          page: string | null
          updated_at: string
          upsold_wpw: boolean
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          id?: string
          last_message_at?: string
          message_count?: number
          messages?: Json
          page?: string | null
          updated_at?: string
          upsold_wpw?: boolean
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          id?: string
          last_message_at?: string
          message_count?: number
          messages?: Json
          page?: string | null
          updated_at?: string
          upsold_wpw?: boolean
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      helper_tickets: {
        Row: {
          auto_shipped: boolean
          category: string
          contact_phone: string | null
          context: Json
          created_at: string
          dispatched_at: string | null
          github_issue_number: number | null
          github_issue_url: string | null
          id: string
          notified_at: string | null
          notify_email: boolean
          notify_sms: boolean
          page: string | null
          resolution_notes: string | null
          resolved_at: string | null
          status: string
          summary: string | null
          transcript: Json
          updated_at: string
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          auto_shipped?: boolean
          category?: string
          contact_phone?: string | null
          context?: Json
          created_at?: string
          dispatched_at?: string | null
          github_issue_number?: number | null
          github_issue_url?: string | null
          id?: string
          notified_at?: string | null
          notify_email?: boolean
          notify_sms?: boolean
          page?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          status?: string
          summary?: string | null
          transcript?: Json
          updated_at?: string
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          auto_shipped?: boolean
          category?: string
          contact_phone?: string | null
          context?: Json
          created_at?: string
          dispatched_at?: string | null
          github_issue_number?: number | null
          github_issue_url?: string | null
          id?: string
          notified_at?: string | null
          notify_email?: boolean
          notify_sms?: boolean
          page?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          status?: string
          summary?: string | null
          transcript?: Json
          updated_at?: string
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      hero_carousel: {
        Row: {
          created_at: string | null
          id: string
          image_url: string
          is_active: boolean | null
          link: string | null
          sort_order: number | null
          subtitle: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          image_url: string
          is_active?: boolean | null
          link?: string | null
          sort_order?: number | null
          subtitle?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          image_url?: string
          is_active?: boolean | null
          link?: string | null
          sort_order?: number | null
          subtitle?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      homepage_showcase: {
        Row: {
          alt_text: string
          created_at: string | null
          id: string
          image_url: string
          is_active: boolean | null
          name: string
          sort_order: number | null
          title: string
          updated_at: string | null
        }
        Insert: {
          alt_text: string
          created_at?: string | null
          id?: string
          image_url: string
          is_active?: boolean | null
          name: string
          sort_order?: number | null
          title: string
          updated_at?: string | null
        }
        Update: {
          alt_text?: string
          created_at?: string | null
          id?: string
          image_url?: string
          is_active?: boolean | null
          name?: string
          sort_order?: number | null
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      ig_push_log: {
        Row: {
          caption: string | null
          error_message: string | null
          id: string
          ig_media_id: string | null
          ig_permalink: string | null
          image_url: string | null
          pushed_at: string | null
          pushed_by: string | null
          render_id: string
          status: string
        }
        Insert: {
          caption?: string | null
          error_message?: string | null
          id?: string
          ig_media_id?: string | null
          ig_permalink?: string | null
          image_url?: string | null
          pushed_at?: string | null
          pushed_by?: string | null
          render_id: string
          status?: string
        }
        Update: {
          caption?: string | null
          error_message?: string | null
          id?: string
          ig_media_id?: string | null
          ig_permalink?: string | null
          image_url?: string | null
          pushed_at?: string | null
          pushed_by?: string | null
          render_id?: string
          status?: string
        }
        Relationships: []
      }
      inbound_leads: {
        Row: {
          assigned_affiliate_id: string | null
          assigned_at: string | null
          contacted_at: string | null
          converted_at: string | null
          created_at: string | null
          email: string | null
          full_name: string
          id: string
          page_url: string | null
          phone: string | null
          question: string | null
          source: string | null
          status: string
        }
        Insert: {
          assigned_affiliate_id?: string | null
          assigned_at?: string | null
          contacted_at?: string | null
          converted_at?: string | null
          created_at?: string | null
          email?: string | null
          full_name: string
          id?: string
          page_url?: string | null
          phone?: string | null
          question?: string | null
          source?: string | null
          status?: string
        }
        Update: {
          assigned_affiliate_id?: string | null
          assigned_at?: string | null
          contacted_at?: string | null
          converted_at?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string
          id?: string
          page_url?: string | null
          phone?: string | null
          question?: string | null
          source?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbound_leads_assigned_affiliate_id_fkey"
            columns: ["assigned_affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliate_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      inkfusion_carousel: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          manufacturer: string | null
          media_url: string
          name: string
          sort_order: number | null
          subtitle: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          manufacturer?: string | null
          media_url: string
          name: string
          sort_order?: number | null
          subtitle?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          manufacturer?: string | null
          media_url?: string
          name?: string
          sort_order?: number | null
          subtitle?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inkfusion_swatches: {
        Row: {
          color_library: string | null
          created_at: string | null
          finish: string | null
          hex: string | null
          id: string
          is_active: boolean | null
          media_type: string
          media_url: string
          name: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          color_library?: string | null
          created_at?: string | null
          finish?: string | null
          hex?: string | null
          id?: string
          is_active?: boolean | null
          media_type: string
          media_url: string
          name: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          color_library?: string | null
          created_at?: string | null
          finish?: string | null
          hex?: string | null
          id?: string
          is_active?: boolean | null
          media_type?: string
          media_url?: string
          name?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inkfusion_videos: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          media_url: string
          name: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          media_url: string
          name: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          media_url?: string
          name?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      intake_agent_runs: {
        Row: {
          cost_cents: number | null
          created_at: string
          draft_message: string | null
          draft_subject: string | null
          error: string | null
          file_check_id: string | null
          final_message: string | null
          id: string
          input_tokens: number | null
          model: string | null
          output_tokens: number | null
          recommendation: string
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source: string
          source_ref: string | null
          status: string
          summary: string | null
          tool_calls: Json
          updated_at: string
          user_id: string | null
        }
        Insert: {
          cost_cents?: number | null
          created_at?: string
          draft_message?: string | null
          draft_subject?: string | null
          error?: string | null
          file_check_id?: string | null
          final_message?: string | null
          id?: string
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          recommendation?: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source: string
          source_ref?: string | null
          status?: string
          summary?: string | null
          tool_calls?: Json
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          cost_cents?: number | null
          created_at?: string
          draft_message?: string | null
          draft_subject?: string | null
          error?: string | null
          file_check_id?: string | null
          final_message?: string | null
          id?: string
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          recommendation?: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string
          source_ref?: string | null
          status?: string
          summary?: string | null
          tool_calls?: Json
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "intake_agent_runs_file_check_id_fkey"
            columns: ["file_check_id"]
            isOneToOne: false
            referencedRelation: "intake_file_checks"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_channel_credentials: {
        Row: {
          access_token: string | null
          account_identifier: string
          channel: string
          connected_by: string | null
          created_at: string
          display_name: string | null
          id: string
          is_active: boolean
          refresh_token: string | null
          scopes: string | null
          token_expires_at: string | null
          updated_at: string
          webhook_expires_at: string | null
          webhook_subscription_id: string | null
        }
        Insert: {
          access_token?: string | null
          account_identifier: string
          channel: string
          connected_by?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_active?: boolean
          refresh_token?: string | null
          scopes?: string | null
          token_expires_at?: string | null
          updated_at?: string
          webhook_expires_at?: string | null
          webhook_subscription_id?: string | null
        }
        Update: {
          access_token?: string | null
          account_identifier?: string
          channel?: string
          connected_by?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_active?: boolean
          refresh_token?: string | null
          scopes?: string | null
          token_expires_at?: string | null
          updated_at?: string
          webhook_expires_at?: string | null
          webhook_subscription_id?: string | null
        }
        Relationships: []
      }
      intake_channel_messages: {
        Row: {
          agent_run_id: string | null
          attachment_check_ids: string[]
          attachment_count: number
          body: string | null
          channel: string
          channel_credential_id: string | null
          created_at: string
          external_message_id: string
          external_thread_id: string | null
          id: string
          intent: string | null
          raw_payload: Json
          sender_display_name: string | null
          sender_identifier: string | null
          subject: string | null
        }
        Insert: {
          agent_run_id?: string | null
          attachment_check_ids?: string[]
          attachment_count?: number
          body?: string | null
          channel: string
          channel_credential_id?: string | null
          created_at?: string
          external_message_id: string
          external_thread_id?: string | null
          id?: string
          intent?: string | null
          raw_payload?: Json
          sender_display_name?: string | null
          sender_identifier?: string | null
          subject?: string | null
        }
        Update: {
          agent_run_id?: string | null
          attachment_check_ids?: string[]
          attachment_count?: number
          body?: string | null
          channel?: string
          channel_credential_id?: string | null
          created_at?: string
          external_message_id?: string
          external_thread_id?: string | null
          id?: string
          intent?: string | null
          raw_payload?: Json
          sender_display_name?: string | null
          sender_identifier?: string | null
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "intake_channel_messages_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "intake_agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_channel_messages_channel_credential_id_fkey"
            columns: ["channel_credential_id"]
            isOneToOne: false
            referencedRelation: "intake_channel_credentials"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_file_checks: {
        Row: {
          agent_run_id: string | null
          checks: Json
          created_at: string
          file_name: string
          file_size_bytes: number | null
          id: string
          metadata: Json
          mime_type: string | null
          source: string
          source_ref: string | null
          status: string
          storage_bucket: string
          storage_path: string
          user_id: string | null
        }
        Insert: {
          agent_run_id?: string | null
          checks?: Json
          created_at?: string
          file_name: string
          file_size_bytes?: number | null
          id?: string
          metadata?: Json
          mime_type?: string | null
          source: string
          source_ref?: string | null
          status?: string
          storage_bucket: string
          storage_path: string
          user_id?: string | null
        }
        Update: {
          agent_run_id?: string | null
          checks?: Json
          created_at?: string
          file_name?: string
          file_size_bytes?: number | null
          id?: string
          metadata?: Json
          mime_type?: string | null
          source?: string
          source_ref?: string | null
          status?: string
          storage_bucket?: string
          storage_path?: string
          user_id?: string | null
        }
        Relationships: []
      }
      intake_graph_state: {
        Row: {
          backfill_done: boolean
          backfill_watermark: string | null
          mailbox: string
          updated_at: string
        }
        Insert: {
          backfill_done?: boolean
          backfill_watermark?: string | null
          mailbox: string
          updated_at?: string
        }
        Update: {
          backfill_done?: boolean
          backfill_watermark?: string | null
          mailbox?: string
          updated_at?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          assigned_to: string | null
          auto_texted_at: string | null
          caller_email: string | null
          caller_name: string | null
          caller_phone: string
          created_at: string | null
          customer_id: string | null
          email_sent_to_customer: boolean | null
          id: string
          is_hot: boolean | null
          lead_score: number | null
          metadata: Json | null
          quote_id: string | null
          quote_sent_at: string | null
          quote_url: string | null
          retarget_scheduled: boolean
          retarget_send_at: string | null
          retarget_template_slug: string | null
          service_requested: string | null
          shop_id: string | null
          sms_sent_to_customer: boolean | null
          sms_sent_to_shop: boolean | null
          source: string | null
          status: string | null
          transcription_confidence: number | null
          twilio_call_sid: string | null
          updated_at: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_year: string | null
          voicemail_recording_url: string | null
          voicemail_transcript: string | null
        }
        Insert: {
          assigned_to?: string | null
          auto_texted_at?: string | null
          caller_email?: string | null
          caller_name?: string | null
          caller_phone: string
          created_at?: string | null
          customer_id?: string | null
          email_sent_to_customer?: boolean | null
          id?: string
          is_hot?: boolean | null
          lead_score?: number | null
          metadata?: Json | null
          quote_id?: string | null
          quote_sent_at?: string | null
          quote_url?: string | null
          retarget_scheduled?: boolean
          retarget_send_at?: string | null
          retarget_template_slug?: string | null
          service_requested?: string | null
          shop_id?: string | null
          sms_sent_to_customer?: boolean | null
          sms_sent_to_shop?: boolean | null
          source?: string | null
          status?: string | null
          transcription_confidence?: number | null
          twilio_call_sid?: string | null
          updated_at?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: string | null
          voicemail_recording_url?: string | null
          voicemail_transcript?: string | null
        }
        Update: {
          assigned_to?: string | null
          auto_texted_at?: string | null
          caller_email?: string | null
          caller_name?: string | null
          caller_phone?: string
          created_at?: string | null
          customer_id?: string | null
          email_sent_to_customer?: boolean | null
          id?: string
          is_hot?: boolean | null
          lead_score?: number | null
          metadata?: Json | null
          quote_id?: string | null
          quote_sent_at?: string | null
          quote_url?: string | null
          retarget_scheduled?: boolean
          retarget_send_at?: string | null
          retarget_template_slug?: string | null
          service_requested?: string | null
          shop_id?: string | null
          sms_sent_to_customer?: boolean | null
          sms_sent_to_shop?: boolean | null
          source?: string | null
          status?: string | null
          transcription_confidence?: number | null
          twilio_call_sid?: string | null
          updated_at?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: string | null
          voicemail_recording_url?: string | null
          voicemail_transcript?: string | null
        }
        Relationships: []
      }
      logopro_concepts: {
        Row: {
          concept_number: number
          created_at: string
          generation_metadata: Json | null
          id: string
          image_url: string
          is_selected: boolean
          project_id: string
          prompt_used: string | null
          shop_id: string
        }
        Insert: {
          concept_number: number
          created_at?: string
          generation_metadata?: Json | null
          id?: string
          image_url: string
          is_selected?: boolean
          project_id: string
          prompt_used?: string | null
          shop_id: string
        }
        Update: {
          concept_number?: number
          created_at?: string
          generation_metadata?: Json | null
          id?: string
          image_url?: string
          is_selected?: boolean
          project_id?: string
          prompt_used?: string | null
          shop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "logopro_concepts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "logopro_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logopro_concepts_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      logopro_projects: {
        Row: {
          brand_colors: Json
          company_name: string
          created_at: string
          final_eps_url: string | null
          final_png_url: string | null
          final_svg_url: string | null
          finalized_at: string | null
          id: string
          industry: string | null
          keywords: string[]
          mascot_description: string | null
          phone: string | null
          selected_concept_id: string | null
          shop_id: string
          source_designpro_project_id: string | null
          status: string
          updated_at: string
          user_id: string
          website: string | null
        }
        Insert: {
          brand_colors?: Json
          company_name: string
          created_at?: string
          final_eps_url?: string | null
          final_png_url?: string | null
          final_svg_url?: string | null
          finalized_at?: string | null
          id?: string
          industry?: string | null
          keywords?: string[]
          mascot_description?: string | null
          phone?: string | null
          selected_concept_id?: string | null
          shop_id: string
          source_designpro_project_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
          website?: string | null
        }
        Update: {
          brand_colors?: Json
          company_name?: string
          created_at?: string
          final_eps_url?: string | null
          final_png_url?: string | null
          final_svg_url?: string | null
          finalized_at?: string | null
          id?: string
          industry?: string | null
          keywords?: string[]
          mascot_description?: string | null
          phone?: string | null
          selected_concept_id?: string | null
          shop_id?: string
          source_designpro_project_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_logopro_selected_concept"
            columns: ["selected_concept_id"]
            isOneToOne: false
            referencedRelation: "logopro_concepts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logopro_projects_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      manufacturer_colors: {
        Row: {
          created_at: string | null
          finish: string
          grounded_base_color: string | null
          grounded_description: string | null
          grounded_effect: string | null
          hex_confidence: number | null
          hex_source: string | null
          id: string
          is_ppf: boolean | null
          is_verified: boolean | null
          lab_a: number | null
          lab_b: number | null
          lab_l: number | null
          manufacturer: string
          official_hex: string | null
          official_name: string
          official_swatch_url: string | null
          product_code: string
          registry_version: string | null
          series: string | null
          show_in_picker: boolean
          source_file: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          finish?: string
          grounded_base_color?: string | null
          grounded_description?: string | null
          grounded_effect?: string | null
          hex_confidence?: number | null
          hex_source?: string | null
          id?: string
          is_ppf?: boolean | null
          is_verified?: boolean | null
          lab_a?: number | null
          lab_b?: number | null
          lab_l?: number | null
          manufacturer: string
          official_hex?: string | null
          official_name: string
          official_swatch_url?: string | null
          product_code: string
          registry_version?: string | null
          series?: string | null
          show_in_picker?: boolean
          source_file?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          finish?: string
          grounded_base_color?: string | null
          grounded_description?: string | null
          grounded_effect?: string | null
          hex_confidence?: number | null
          hex_source?: string | null
          id?: string
          is_ppf?: boolean | null
          is_verified?: boolean | null
          lab_a?: number | null
          lab_b?: number | null
          lab_l?: number | null
          manufacturer?: string
          official_hex?: string | null
          official_name?: string
          official_swatch_url?: string | null
          product_code?: string
          registry_version?: string | null
          series?: string | null
          show_in_picker?: boolean
          source_file?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      marketing_standing_tasks: {
        Row: {
          assigned_to: string
          brand: string
          cadence: string
          category: string
          created_at: string
          description: string | null
          due_dow: number
          id: string
          is_active: boolean
          priority: string
          task_type: string
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to: string
          brand?: string
          cadence?: string
          category?: string
          created_at?: string
          description?: string | null
          due_dow?: number
          id?: string
          is_active?: boolean
          priority?: string
          task_type?: string
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string
          brand?: string
          cadence?: string
          category?: string
          created_at?: string
          description?: string | null
          due_dow?: number
          id?: string
          is_active?: boolean
          priority?: string
          task_type?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      marketplace_listings: {
        Row: {
          admin_notes: string | null
          admin_reviewed_at: string | null
          admin_reviewed_by: string | null
          buyer_user_id: string | null
          created_at: string | null
          creator_id: string | null
          currency: string | null
          description: string | null
          design_dna_id: string | null
          design_style: string | null
          display_order: number | null
          favorite_count: number | null
          featured_creator_name: string | null
          id: string
          industry_title: string | null
          install_video_url: string | null
          is_hidden: boolean
          listed_at: string | null
          offers_printed_wrap: boolean
          org_id: string | null
          panel_2d_url: string | null
          panel_count: number | null
          preview_urls: Json | null
          price: number | null
          production_pack_metadata: Json | null
          production_pack_url: string | null
          purchase_mode: string | null
          render_urls: Json | null
          shipping_address: Json | null
          sold_at: string | null
          status: string | null
          tags: string[] | null
          thumbnail_url: string | null
          title: string
          trade_category: string | null
          transaction_id: string | null
          updated_at: string | null
          vehicle_fitment: Json | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_year: string | null
          view_count: number | null
        }
        Insert: {
          admin_notes?: string | null
          admin_reviewed_at?: string | null
          admin_reviewed_by?: string | null
          buyer_user_id?: string | null
          created_at?: string | null
          creator_id?: string | null
          currency?: string | null
          description?: string | null
          design_dna_id?: string | null
          design_style?: string | null
          display_order?: number | null
          favorite_count?: number | null
          featured_creator_name?: string | null
          id?: string
          industry_title?: string | null
          install_video_url?: string | null
          is_hidden?: boolean
          listed_at?: string | null
          offers_printed_wrap?: boolean
          org_id?: string | null
          panel_2d_url?: string | null
          panel_count?: number | null
          preview_urls?: Json | null
          price?: number | null
          production_pack_metadata?: Json | null
          production_pack_url?: string | null
          purchase_mode?: string | null
          render_urls?: Json | null
          shipping_address?: Json | null
          sold_at?: string | null
          status?: string | null
          tags?: string[] | null
          thumbnail_url?: string | null
          title: string
          trade_category?: string | null
          transaction_id?: string | null
          updated_at?: string | null
          vehicle_fitment?: Json | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: string | null
          view_count?: number | null
        }
        Update: {
          admin_notes?: string | null
          admin_reviewed_at?: string | null
          admin_reviewed_by?: string | null
          buyer_user_id?: string | null
          created_at?: string | null
          creator_id?: string | null
          currency?: string | null
          description?: string | null
          design_dna_id?: string | null
          design_style?: string | null
          display_order?: number | null
          favorite_count?: number | null
          featured_creator_name?: string | null
          id?: string
          industry_title?: string | null
          install_video_url?: string | null
          is_hidden?: boolean
          listed_at?: string | null
          offers_printed_wrap?: boolean
          org_id?: string | null
          panel_2d_url?: string | null
          panel_count?: number | null
          preview_urls?: Json | null
          price?: number | null
          production_pack_metadata?: Json | null
          production_pack_url?: string | null
          purchase_mode?: string | null
          render_urls?: Json | null
          shipping_address?: Json | null
          sold_at?: string | null
          status?: string | null
          tags?: string[] | null
          thumbnail_url?: string | null
          title?: string
          trade_category?: string | null
          transaction_id?: string | null
          updated_at?: string | null
          vehicle_fitment?: Json | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: string | null
          view_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_listings_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "neuralnetwork_creator_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_listings_design_dna_id_fkey"
            columns: ["design_dna_id"]
            isOneToOne: false
            referencedRelation: "neuralnetwork_design_dna"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_transactions: {
        Row: {
          buyer_user_id: string | null
          buyer_vault_entry_id: string | null
          created_at: string | null
          creator_id: string | null
          creator_payout: number
          currency: string | null
          delivery_url: string | null
          id: string
          listing_id: string
          payout_completed_at: string | null
          payout_status: string | null
          platform_fee: number
          production_pack_delivered: boolean | null
          status: string | null
          stripe_charge_id: string | null
          stripe_payment_intent_id: string | null
          stripe_transfer_id: string | null
          total_amount: number
          updated_at: string | null
        }
        Insert: {
          buyer_user_id?: string | null
          buyer_vault_entry_id?: string | null
          created_at?: string | null
          creator_id?: string | null
          creator_payout: number
          currency?: string | null
          delivery_url?: string | null
          id?: string
          listing_id: string
          payout_completed_at?: string | null
          payout_status?: string | null
          platform_fee: number
          production_pack_delivered?: boolean | null
          status?: string | null
          stripe_charge_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_transfer_id?: string | null
          total_amount: number
          updated_at?: string | null
        }
        Update: {
          buyer_user_id?: string | null
          buyer_vault_entry_id?: string | null
          created_at?: string | null
          creator_id?: string | null
          creator_payout?: number
          currency?: string | null
          delivery_url?: string | null
          id?: string
          listing_id?: string
          payout_completed_at?: string | null
          payout_status?: string | null
          platform_fee?: number
          production_pack_delivered?: boolean | null
          status?: string | null
          stripe_charge_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_transfer_id?: string | null
          total_amount?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_transactions_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "neuralnetwork_creator_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_transactions_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      media_sources: {
        Row: {
          brands: string[] | null
          created_at: string
          dedupe_key: string | null
          drive_id: string | null
          duration_seconds: number | null
          emotional_tone: string | null
          energy: string | null
          filename: string | null
          id: string
          kind: string
          orientation: string | null
          people: string[] | null
          product_relevance: string | null
          projects: string[] | null
          quality: string | null
          recommended_formats: string[] | null
          review_status: string
          script_ideas: Json | null
          shoot: string | null
          storage_url: string | null
          title: string | null
          transcript: string | null
          vehicles: string[] | null
        }
        Insert: {
          brands?: string[] | null
          created_at?: string
          dedupe_key?: string | null
          drive_id?: string | null
          duration_seconds?: number | null
          emotional_tone?: string | null
          energy?: string | null
          filename?: string | null
          id?: string
          kind: string
          orientation?: string | null
          people?: string[] | null
          product_relevance?: string | null
          projects?: string[] | null
          quality?: string | null
          recommended_formats?: string[] | null
          review_status?: string
          script_ideas?: Json | null
          shoot?: string | null
          storage_url?: string | null
          title?: string | null
          transcript?: string | null
          vehicles?: string[] | null
        }
        Update: {
          brands?: string[] | null
          created_at?: string
          dedupe_key?: string | null
          drive_id?: string | null
          duration_seconds?: number | null
          emotional_tone?: string | null
          energy?: string | null
          filename?: string | null
          id?: string
          kind?: string
          orientation?: string | null
          people?: string[] | null
          product_relevance?: string | null
          projects?: string[] | null
          quality?: string | null
          recommended_formats?: string[] | null
          review_status?: string
          script_ideas?: Json | null
          shoot?: string | null
          storage_url?: string | null
          title?: string | null
          transcript?: string | null
          vehicles?: string[] | null
        }
        Relationships: []
      }
      metro_swatch_colors: {
        Row: {
          color_name: string | null
          image_url: string | null
          pixels_used: number | null
          product_code: string
          sampled_hex: string | null
          source_url: string | null
          updated_at: string | null
        }
        Insert: {
          color_name?: string | null
          image_url?: string | null
          pixels_used?: number | null
          product_code: string
          sampled_hex?: string | null
          source_url?: string | null
          updated_at?: string | null
        }
        Update: {
          color_name?: string | null
          image_url?: string | null
          pixels_used?: number | null
          product_code?: string
          sampled_hex?: string | null
          source_url?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      mightymail_api_keys: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          scopes: Json
          shop_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
          scopes?: Json
          shop_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          scopes?: Json
          shop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mightymail_api_keys_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      mightymail_recipient_state: {
        Row: {
          email_address: string
          last_bounced_at: string | null
          last_clicked_at: string | null
          last_complained_at: string | null
          last_opened_at: string | null
          last_sent_at: string | null
          sends_24h: number
          sends_30d: number
          sends_7d: number
          shop_id: string
          updated_at: string
        }
        Insert: {
          email_address: string
          last_bounced_at?: string | null
          last_clicked_at?: string | null
          last_complained_at?: string | null
          last_opened_at?: string | null
          last_sent_at?: string | null
          sends_24h?: number
          sends_30d?: number
          sends_7d?: number
          shop_id: string
          updated_at?: string
        }
        Update: {
          email_address?: string
          last_bounced_at?: string | null
          last_clicked_at?: string | null
          last_complained_at?: string | null
          last_opened_at?: string | null
          last_sent_at?: string | null
          sends_24h?: number
          sends_30d?: number
          sends_7d?: number
          shop_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mightymail_recipient_state_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      mightymail_suppressions: {
        Row: {
          email_address: string
          id: string
          metadata: Json | null
          reason: string | null
          shop_id: string | null
          source: string
          suppressed_at: string
          suppression_type: string
        }
        Insert: {
          email_address: string
          id?: string
          metadata?: Json | null
          reason?: string | null
          shop_id?: string | null
          source?: string
          suppressed_at?: string
          suppression_type: string
        }
        Update: {
          email_address?: string
          id?: string
          metadata?: Json | null
          reason?: string | null
          shop_id?: string | null
          source?: string
          suppressed_at?: string
          suppression_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "mightymail_suppressions_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_log: {
        Row: {
          attempted_content: string | null
          blocked_term: string
          created_at: string | null
          id: string
          ip_address: string | null
          user_email: string
        }
        Insert: {
          attempted_content?: string | null
          blocked_term: string
          created_at?: string | null
          id?: string
          ip_address?: string | null
          user_email: string
        }
        Update: {
          attempted_content?: string | null
          blocked_term?: string
          created_at?: string | null
          id?: string
          ip_address?: string | null
          user_email?: string
        }
        Relationships: []
      }
      music_analysis: {
        Row: {
          beat_drops: Json | null
          best_footage_type: string | null
          bpm: number | null
          chorus_sections: Json | null
          created_at: string
          duration_seconds: number | null
          energy_curve: string | null
          explicit: boolean
          id: string
          intro_seconds: number | null
          lyrical_theme: string | null
          source_id: string | null
          storage_url: string | null
          suggested_structure: string | null
          track_title: string | null
        }
        Insert: {
          beat_drops?: Json | null
          best_footage_type?: string | null
          bpm?: number | null
          chorus_sections?: Json | null
          created_at?: string
          duration_seconds?: number | null
          energy_curve?: string | null
          explicit?: boolean
          id?: string
          intro_seconds?: number | null
          lyrical_theme?: string | null
          source_id?: string | null
          storage_url?: string | null
          suggested_structure?: string | null
          track_title?: string | null
        }
        Update: {
          beat_drops?: Json | null
          best_footage_type?: string | null
          bpm?: number | null
          chorus_sections?: Json | null
          created_at?: string
          duration_seconds?: number | null
          energy_curve?: string | null
          explicit?: boolean
          id?: string
          intro_seconds?: number | null
          lyrical_theme?: string | null
          source_id?: string | null
          storage_url?: string | null
          suggested_structure?: string | null
          track_title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "music_analysis_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "media_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      neuralnetwork_creator_profiles: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          avatar_url: string | null
          avg_design_rating: number | null
          bio: string | null
          created_at: string | null
          custom_payout_percent: number | null
          display_name: string | null
          featured: boolean | null
          id: string
          is_partner_shop: boolean
          org_id: string | null
          portfolio_header_url: string | null
          preferred_design_styles: string[] | null
          preferred_industries: string[] | null
          preferred_vehicle_types: string[] | null
          slug: string | null
          social_links: Json | null
          status: string | null
          stripe_connect_account_id: string | null
          stripe_connect_charges_enabled: boolean | null
          stripe_connect_onboarded: boolean | null
          stripe_connect_payouts_enabled: boolean | null
          style_dna_version: number | null
          style_preferences: Json | null
          total_designs: number | null
          total_earnings: number | null
          total_sales: number | null
          updated_at: string | null
          user_id: string
          verified: boolean | null
          website_url: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          avatar_url?: string | null
          avg_design_rating?: number | null
          bio?: string | null
          created_at?: string | null
          custom_payout_percent?: number | null
          display_name?: string | null
          featured?: boolean | null
          id?: string
          is_partner_shop?: boolean
          org_id?: string | null
          portfolio_header_url?: string | null
          preferred_design_styles?: string[] | null
          preferred_industries?: string[] | null
          preferred_vehicle_types?: string[] | null
          slug?: string | null
          social_links?: Json | null
          status?: string | null
          stripe_connect_account_id?: string | null
          stripe_connect_charges_enabled?: boolean | null
          stripe_connect_onboarded?: boolean | null
          stripe_connect_payouts_enabled?: boolean | null
          style_dna_version?: number | null
          style_preferences?: Json | null
          total_designs?: number | null
          total_earnings?: number | null
          total_sales?: number | null
          updated_at?: string | null
          user_id: string
          verified?: boolean | null
          website_url?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          avatar_url?: string | null
          avg_design_rating?: number | null
          bio?: string | null
          created_at?: string | null
          custom_payout_percent?: number | null
          display_name?: string | null
          featured?: boolean | null
          id?: string
          is_partner_shop?: boolean
          org_id?: string | null
          portfolio_header_url?: string | null
          preferred_design_styles?: string[] | null
          preferred_industries?: string[] | null
          preferred_vehicle_types?: string[] | null
          slug?: string | null
          social_links?: Json | null
          status?: string | null
          stripe_connect_account_id?: string | null
          stripe_connect_charges_enabled?: boolean | null
          stripe_connect_onboarded?: boolean | null
          stripe_connect_payouts_enabled?: boolean | null
          style_dna_version?: number | null
          style_preferences?: Json | null
          total_designs?: number | null
          total_earnings?: number | null
          total_sales?: number | null
          updated_at?: string | null
          user_id?: string
          verified?: boolean | null
          website_url?: string | null
        }
        Relationships: []
      }
      neuralnetwork_design_dna: {
        Row: {
          all_render_urls: Json | null
          avg_rating: number | null
          brand_compliant: boolean | null
          camera_angle: string | null
          company_name: string | null
          created_at: string | null
          creator_id: string | null
          design_anchor_text: string | null
          design_config: Json | null
          design_name: string | null
          design_tags: string[] | null
          embedding: string | null
          enhanced_prompt: string | null
          finish: string | null
          gallery_url: string | null
          generation_id: string | null
          id: string
          industry_type: string | null
          is_creator_design: boolean | null
          lock_type: string | null
          locked: boolean | null
          metadata: Json | null
          mode: string | null
          org_id: string | null
          panel_artwork_url: string | null
          production_pack_id: string | null
          prompt_text: string | null
          published: boolean | null
          render_url: string | null
          revision_parent_id: string | null
          revision_text: string | null
          source: string | null
          status: string | null
          total_ratings: number | null
          updated_at: string | null
          user_id: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_render_url: string | null
          vehicle_year: string | null
          view_type: string | null
          visionboard_image_refs: Json | null
        }
        Insert: {
          all_render_urls?: Json | null
          avg_rating?: number | null
          brand_compliant?: boolean | null
          camera_angle?: string | null
          company_name?: string | null
          created_at?: string | null
          creator_id?: string | null
          design_anchor_text?: string | null
          design_config?: Json | null
          design_name?: string | null
          design_tags?: string[] | null
          embedding?: string | null
          enhanced_prompt?: string | null
          finish?: string | null
          gallery_url?: string | null
          generation_id?: string | null
          id?: string
          industry_type?: string | null
          is_creator_design?: boolean | null
          lock_type?: string | null
          locked?: boolean | null
          metadata?: Json | null
          mode?: string | null
          org_id?: string | null
          panel_artwork_url?: string | null
          production_pack_id?: string | null
          prompt_text?: string | null
          published?: boolean | null
          render_url?: string | null
          revision_parent_id?: string | null
          revision_text?: string | null
          source?: string | null
          status?: string | null
          total_ratings?: number | null
          updated_at?: string | null
          user_id?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_render_url?: string | null
          vehicle_year?: string | null
          view_type?: string | null
          visionboard_image_refs?: Json | null
        }
        Update: {
          all_render_urls?: Json | null
          avg_rating?: number | null
          brand_compliant?: boolean | null
          camera_angle?: string | null
          company_name?: string | null
          created_at?: string | null
          creator_id?: string | null
          design_anchor_text?: string | null
          design_config?: Json | null
          design_name?: string | null
          design_tags?: string[] | null
          embedding?: string | null
          enhanced_prompt?: string | null
          finish?: string | null
          gallery_url?: string | null
          generation_id?: string | null
          id?: string
          industry_type?: string | null
          is_creator_design?: boolean | null
          lock_type?: string | null
          locked?: boolean | null
          metadata?: Json | null
          mode?: string | null
          org_id?: string | null
          panel_artwork_url?: string | null
          production_pack_id?: string | null
          prompt_text?: string | null
          published?: boolean | null
          render_url?: string | null
          revision_parent_id?: string | null
          revision_text?: string | null
          source?: string | null
          status?: string | null
          total_ratings?: number | null
          updated_at?: string | null
          user_id?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_render_url?: string | null
          vehicle_year?: string | null
          view_type?: string | null
          visionboard_image_refs?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "neuralnetwork_design_dna_revision_parent_id_fkey"
            columns: ["revision_parent_id"]
            isOneToOne: false
            referencedRelation: "neuralnetwork_design_dna"
            referencedColumns: ["id"]
          },
        ]
      }
      neuralnetwork_feedback: {
        Row: {
          created_at: string | null
          design_dna_id: string
          feedback_text: string | null
          feedback_type: string | null
          flag_reason: string | null
          id: string
          is_flagged: boolean | null
          rating: number | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          design_dna_id: string
          feedback_text?: string | null
          feedback_type?: string | null
          flag_reason?: string | null
          id?: string
          is_flagged?: boolean | null
          rating?: number | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          design_dna_id?: string
          feedback_text?: string | null
          feedback_type?: string | null
          flag_reason?: string | null
          id?: string
          is_flagged?: boolean | null
          rating?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "neuralnetwork_feedback_design_dna_id_fkey"
            columns: ["design_dna_id"]
            isOneToOne: false
            referencedRelation: "neuralnetwork_design_dna"
            referencedColumns: ["id"]
          },
        ]
      }
      neuralnetwork_knowledge: {
        Row: {
          approved_by: string | null
          collection: string
          content: string
          created_at: string | null
          embedding: string | null
          id: string
          locked: boolean | null
          name: string
          org_id: string | null
          status: string | null
          updated_at: string | null
          version: number | null
        }
        Insert: {
          approved_by?: string | null
          collection: string
          content: string
          created_at?: string | null
          embedding?: string | null
          id?: string
          locked?: boolean | null
          name: string
          org_id?: string | null
          status?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Update: {
          approved_by?: string | null
          collection?: string
          content?: string
          created_at?: string | null
          embedding?: string | null
          id?: string
          locked?: boolean | null
          name?: string
          org_id?: string | null
          status?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Relationships: []
      }
      orders: {
        Row: {
          accepted_at: string | null
          color_name: string | null
          created_at: string | null
          customer_id: string | null
          customer_total: number | null
          finish: string | null
          id: string
          line_items: Json | null
          manufacturer: string | null
          margin_percent: number | null
          metadata: Json | null
          notes: string | null
          order_number: string | null
          payment_status: string
          quote_id: string | null
          render_url: string | null
          shop_cost: number | null
          shop_id: string | null
          source: string
          status: string
          stripe_invoice_id: string | null
          stripe_payment_intent_id: string | null
          updated_at: string | null
          user_id: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_year: string | null
          visualization_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          color_name?: string | null
          created_at?: string | null
          customer_id?: string | null
          customer_total?: number | null
          finish?: string | null
          id?: string
          line_items?: Json | null
          manufacturer?: string | null
          margin_percent?: number | null
          metadata?: Json | null
          notes?: string | null
          order_number?: string | null
          payment_status?: string
          quote_id?: string | null
          render_url?: string | null
          shop_cost?: number | null
          shop_id?: string | null
          source?: string
          status?: string
          stripe_invoice_id?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: string | null
          visualization_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          color_name?: string | null
          created_at?: string | null
          customer_id?: string | null
          customer_total?: number | null
          finish?: string | null
          id?: string
          line_items?: Json | null
          manufacturer?: string | null
          margin_percent?: number | null
          metadata?: Json | null
          notes?: string | null
          order_number?: string | null
          payment_status?: string
          quote_id?: string | null
          render_url?: string | null
          shop_cost?: number | null
          shop_id?: string | null
          source?: string
          status?: string
          stripe_invoice_id?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: string | null
          visualization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shop_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      org_memberships: {
        Row: {
          created_at: string | null
          id: string
          location_address: string | null
          location_name: string | null
          org_id: string
          role: string
          status: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          location_address?: string | null
          location_name?: string | null
          org_id: string
          role: string
          status?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          location_address?: string | null
          location_name?: string | null
          org_id?: string
          role?: string
          status?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_memberships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          approved_colors: string[] | null
          approved_finishes: string[] | null
          approved_fonts: string[] | null
          avg_design_rating: number | null
          brand_guidelines_url: string | null
          brand_prompt_injection: string | null
          brand_rules: Json | null
          created_at: string | null
          forbidden_elements: Json | null
          id: string
          logo_placement_rules: Json | null
          logo_url: string | null
          name: string
          plan_type: string | null
          price_per_location: number | null
          required_elements: Json | null
          slug: string | null
          status: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          total_designs: number | null
          total_locations: number | null
          updated_at: string | null
        }
        Insert: {
          approved_colors?: string[] | null
          approved_finishes?: string[] | null
          approved_fonts?: string[] | null
          avg_design_rating?: number | null
          brand_guidelines_url?: string | null
          brand_prompt_injection?: string | null
          brand_rules?: Json | null
          created_at?: string | null
          forbidden_elements?: Json | null
          id?: string
          logo_placement_rules?: Json | null
          logo_url?: string | null
          name: string
          plan_type?: string | null
          price_per_location?: number | null
          required_elements?: Json | null
          slug?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          total_designs?: number | null
          total_locations?: number | null
          updated_at?: string | null
        }
        Update: {
          approved_colors?: string[] | null
          approved_finishes?: string[] | null
          approved_fonts?: string[] | null
          avg_design_rating?: number | null
          brand_guidelines_url?: string | null
          brand_prompt_injection?: string | null
          brand_rules?: Json | null
          created_at?: string | null
          forbidden_elements?: Json | null
          id?: string
          logo_placement_rules?: Json | null
          logo_url?: string | null
          name?: string
          plan_type?: string | null
          price_per_location?: number | null
          required_elements?: Json | null
          slug?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          total_designs?: number | null
          total_locations?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      panel_artboard_assets: {
        Row: {
          box: Json | null
          created_at: string
          dpi: number | null
          height_inches: number | null
          id: string
          job_id: string
          kind: string
          label: string | null
          panel_label: string | null
          qc: Json | null
          scale_pct: number | null
          sort_order: number | null
          storage_path: string | null
          url: string
          width_inches: number | null
        }
        Insert: {
          box?: Json | null
          created_at?: string
          dpi?: number | null
          height_inches?: number | null
          id?: string
          job_id: string
          kind: string
          label?: string | null
          panel_label?: string | null
          qc?: Json | null
          scale_pct?: number | null
          sort_order?: number | null
          storage_path?: string | null
          url: string
          width_inches?: number | null
        }
        Update: {
          box?: Json | null
          created_at?: string
          dpi?: number | null
          height_inches?: number | null
          id?: string
          job_id?: string
          kind?: string
          label?: string | null
          panel_label?: string | null
          qc?: Json | null
          scale_pct?: number | null
          sort_order?: number | null
          storage_path?: string | null
          url?: string
          width_inches?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "panel_artboard_assets_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "panel_artboard_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      panel_artboard_jobs: {
        Row: {
          bleed_inches: number | null
          body_type: string | null
          completed_at: string | null
          created_at: string
          dims_source: string | null
          error: string | null
          finish: string | null
          id: string
          mode: string | null
          panels: Json | null
          production_ctx: Json | null
          prompt: string | null
          reference_image_url: string | null
          status: string
          user_id: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_year: string | null
        }
        Insert: {
          bleed_inches?: number | null
          body_type?: string | null
          completed_at?: string | null
          created_at?: string
          dims_source?: string | null
          error?: string | null
          finish?: string | null
          id?: string
          mode?: string | null
          panels?: Json | null
          production_ctx?: Json | null
          prompt?: string | null
          reference_image_url?: string | null
          status?: string
          user_id?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: string | null
        }
        Update: {
          bleed_inches?: number | null
          body_type?: string | null
          completed_at?: string | null
          created_at?: string
          dims_source?: string | null
          error?: string | null
          finish?: string | null
          id?: string
          mode?: string | null
          panels?: Json | null
          production_ctx?: Json | null
          prompt?: string | null
          reference_image_url?: string | null
          status?: string
          user_id?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: string | null
        }
        Relationships: []
      }
      panel_designs: {
        Row: {
          created_at: string | null
          finish: string | null
          id: string
          panel_id: string | null
          preview_image_url: string | null
          prompt_state: Json
          shop_id: string | null
          updated_at: string | null
          user_id: string | null
          vector_file_url: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_year: string | null
        }
        Insert: {
          created_at?: string | null
          finish?: string | null
          id?: string
          panel_id?: string | null
          preview_image_url?: string | null
          prompt_state?: Json
          shop_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          vector_file_url?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: string | null
        }
        Update: {
          created_at?: string | null
          finish?: string | null
          id?: string
          panel_id?: string | null
          preview_image_url?: string | null
          prompt_state?: Json
          shop_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          vector_file_url?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "panel_designs_panel_id_fkey"
            columns: ["panel_id"]
            isOneToOne: false
            referencedRelation: "designpanelpro_patterns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "panel_designs_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      panelizer_job_events: {
        Row: {
          created_at: string | null
          data: Json | null
          event_type: string
          id: string
          job_id: string
          stage: string | null
        }
        Insert: {
          created_at?: string | null
          data?: Json | null
          event_type: string
          id?: string
          job_id: string
          stage?: string | null
        }
        Update: {
          created_at?: string | null
          data?: Json | null
          event_type?: string
          id?: string
          job_id?: string
          stage?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "panelizer_job_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "panelizer_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      panelizer_jobs: {
        Row: {
          all_view_urls: Json | null
          approved_render_url: string | null
          completed_at: string | null
          concept_json: Json | null
          created_at: string | null
          current_stage: number | null
          customer_inputs: Json | null
          delivered_at: string | null
          delivery_email_sent: boolean | null
          error_message: string | null
          error_stage: string | null
          extracted_elements: Json | null
          generation_id: string | null
          id: string
          job_type: string | null
          order_number: string | null
          panels: Json | null
          processing_time_ms: number | null
          purchase_id: string | null
          qa_issues_count: number | null
          qa_passed: boolean | null
          qa_requires_input: boolean | null
          qa_results: Json | null
          quote_id: string | null
          retry_count: number | null
          shop_id: string | null
          stage_progress: Json | null
          started_at: string | null
          status: string
          updated_at: string | null
          upsell_revenue: number | null
          upsells_offered: Json | null
          upsells_purchased: Json | null
          user_id: string
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_trim: string | null
          vehicle_year: number | null
          zip_expires_at: string | null
          zip_signed_url: string | null
          zip_storage_path: string | null
        }
        Insert: {
          all_view_urls?: Json | null
          approved_render_url?: string | null
          completed_at?: string | null
          concept_json?: Json | null
          created_at?: string | null
          current_stage?: number | null
          customer_inputs?: Json | null
          delivered_at?: string | null
          delivery_email_sent?: boolean | null
          error_message?: string | null
          error_stage?: string | null
          extracted_elements?: Json | null
          generation_id?: string | null
          id?: string
          job_type?: string | null
          order_number?: string | null
          panels?: Json | null
          processing_time_ms?: number | null
          purchase_id?: string | null
          qa_issues_count?: number | null
          qa_passed?: boolean | null
          qa_requires_input?: boolean | null
          qa_results?: Json | null
          quote_id?: string | null
          retry_count?: number | null
          shop_id?: string | null
          stage_progress?: Json | null
          started_at?: string | null
          status?: string
          updated_at?: string | null
          upsell_revenue?: number | null
          upsells_offered?: Json | null
          upsells_purchased?: Json | null
          user_id: string
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_trim?: string | null
          vehicle_year?: number | null
          zip_expires_at?: string | null
          zip_signed_url?: string | null
          zip_storage_path?: string | null
        }
        Update: {
          all_view_urls?: Json | null
          approved_render_url?: string | null
          completed_at?: string | null
          concept_json?: Json | null
          created_at?: string | null
          current_stage?: number | null
          customer_inputs?: Json | null
          delivered_at?: string | null
          delivery_email_sent?: boolean | null
          error_message?: string | null
          error_stage?: string | null
          extracted_elements?: Json | null
          generation_id?: string | null
          id?: string
          job_type?: string | null
          order_number?: string | null
          panels?: Json | null
          processing_time_ms?: number | null
          purchase_id?: string | null
          qa_issues_count?: number | null
          qa_passed?: boolean | null
          qa_requires_input?: boolean | null
          qa_results?: Json | null
          quote_id?: string | null
          retry_count?: number | null
          shop_id?: string | null
          stage_progress?: Json | null
          started_at?: string | null
          status?: string
          updated_at?: string | null
          upsell_revenue?: number | null
          upsells_offered?: Json | null
          upsells_purchased?: Json | null
          user_id?: string
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_trim?: string | null
          vehicle_year?: number | null
          zip_expires_at?: string | null
          zip_signed_url?: string | null
          zip_storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "panelizer_jobs_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "panelizer_jobs_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shop_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pattern_designs: {
        Row: {
          created_at: string | null
          finish: string | null
          id: string
          pattern_category: string | null
          pattern_image_url: string
          pattern_name: string | null
          pattern_scale: number | null
          preview_image_url: string | null
          product_id: string | null
          shop_id: string | null
          texture_profile: Json | null
          updated_at: string | null
          user_id: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_year: string | null
        }
        Insert: {
          created_at?: string | null
          finish?: string | null
          id?: string
          pattern_category?: string | null
          pattern_image_url: string
          pattern_name?: string | null
          pattern_scale?: number | null
          preview_image_url?: string | null
          product_id?: string | null
          shop_id?: string | null
          texture_profile?: Json | null
          updated_at?: string | null
          user_id?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: string | null
        }
        Update: {
          created_at?: string | null
          finish?: string | null
          id?: string
          pattern_category?: string | null
          pattern_image_url?: string
          pattern_name?: string | null
          pattern_scale?: number | null
          preview_image_url?: string | null
          product_id?: string | null
          shop_id?: string | null
          texture_profile?: Json | null
          updated_at?: string | null
          user_id?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pattern_designs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "wbty_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pattern_designs_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      precision_modifications: {
        Row: {
          applies_to: string[]
          badge_color: string | null
          base_price: number
          created_at: string
          description: string | null
          gemini_prompt_template: string
          id: string
          is_active: boolean
          key: string
          label: string
          sort_order: number
        }
        Insert: {
          applies_to?: string[]
          badge_color?: string | null
          base_price: number
          created_at?: string
          description?: string | null
          gemini_prompt_template: string
          id?: string
          is_active?: boolean
          key: string
          label: string
          sort_order?: number
        }
        Update: {
          applies_to?: string[]
          badge_color?: string | null
          base_price?: number
          created_at?: string
          description?: string | null
          gemini_prompt_template?: string
          id?: string
          is_active?: boolean
          key?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      presale_signups: {
        Row: {
          created_at: string | null
          email: string
          id: string
          name: string
          phone: string
          shop_name: string
          source: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          name: string
          phone: string
          shop_name: string
          source?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          name?: string
          phone?: string
          shop_name?: string
          source?: string | null
        }
        Relationships: []
      }
      pricing_tier_pdf_cards: {
        Row: {
          created_at: string
          cta_url: string
          id: string
          image_url: string | null
          label: string
          price: string
          sort_order: number
          tier_slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          cta_url: string
          id?: string
          image_url?: string | null
          label: string
          price: string
          sort_order?: number
          tier_slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          cta_url?: string
          id?: string
          image_url?: string | null
          label?: string
          price?: string
          sort_order?: number
          tier_slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      print_production_panels: {
        Row: {
          bleed_in: number
          created_at: string
          design_id: string | null
          dpi: number
          final_height_in: number | null
          final_width_in: number | null
          generated_file_urls: Json
          height: number | null
          id: string
          panel_name: string | null
          proof_image_url: string | null
          request_id: string
          scale_ratio: number | null
          status: string
          updated_at: string
          vehicle_view: string | null
          width: number | null
          x: number | null
          y: number | null
        }
        Insert: {
          bleed_in?: number
          created_at?: string
          design_id?: string | null
          dpi?: number
          final_height_in?: number | null
          final_width_in?: number | null
          generated_file_urls?: Json
          height?: number | null
          id?: string
          panel_name?: string | null
          proof_image_url?: string | null
          request_id: string
          scale_ratio?: number | null
          status?: string
          updated_at?: string
          vehicle_view?: string | null
          width?: number | null
          x?: number | null
          y?: number | null
        }
        Update: {
          bleed_in?: number
          created_at?: string
          design_id?: string | null
          dpi?: number
          final_height_in?: number | null
          final_width_in?: number | null
          generated_file_urls?: Json
          height?: number | null
          id?: string
          panel_name?: string | null
          proof_image_url?: string | null
          request_id?: string
          scale_ratio?: number | null
          status?: string
          updated_at?: string
          vehicle_view?: string | null
          width?: number | null
          x?: number | null
          y?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "print_production_panels_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "print_production_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      print_production_requests: {
        Row: {
          amount_cents: number
          approved_proof_url: string | null
          created_at: string
          customer_name: string | null
          design_id: string | null
          due_date: string | null
          final_files: Json
          id: string
          notes: string | null
          order_number: string | null
          panelizer_job_id: string | null
          payment_status: string
          production_status: Database["public"]["Enums"]["print_production_status"]
          requested_output_type: string | null
          shop_id: string | null
          stripe_session_id: string | null
          updated_at: string
          user_id: string
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_year: string | null
        }
        Insert: {
          amount_cents?: number
          approved_proof_url?: string | null
          created_at?: string
          customer_name?: string | null
          design_id?: string | null
          due_date?: string | null
          final_files?: Json
          id?: string
          notes?: string | null
          order_number?: string | null
          panelizer_job_id?: string | null
          payment_status?: string
          production_status?: Database["public"]["Enums"]["print_production_status"]
          requested_output_type?: string | null
          shop_id?: string | null
          stripe_session_id?: string | null
          updated_at?: string
          user_id?: string
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: string | null
        }
        Update: {
          amount_cents?: number
          approved_proof_url?: string | null
          created_at?: string
          customer_name?: string | null
          design_id?: string | null
          due_date?: string | null
          final_files?: Json
          id?: string
          notes?: string | null
          order_number?: string | null
          panelizer_job_id?: string | null
          payment_status?: string
          production_status?: Database["public"]["Enums"]["print_production_status"]
          requested_output_type?: string | null
          shop_id?: string | null
          stripe_session_id?: string | null
          updated_at?: string
          user_id?: string
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: string | null
        }
        Relationships: []
      }
      print_qc_jobs: {
        Row: {
          created_at: string
          flat_url: string | null
          generation_id: string | null
          height_inches: number | null
          id: string
          model: string | null
          notes: string | null
          print_url: string | null
          production_url: string | null
          qc_status: string
          qcproof_url: string | null
          reviewer: string | null
          side: string | null
          target_dpi: number | null
          trace_url: string | null
          updated_at: string
          width_inches: number | null
        }
        Insert: {
          created_at?: string
          flat_url?: string | null
          generation_id?: string | null
          height_inches?: number | null
          id?: string
          model?: string | null
          notes?: string | null
          print_url?: string | null
          production_url?: string | null
          qc_status?: string
          qcproof_url?: string | null
          reviewer?: string | null
          side?: string | null
          target_dpi?: number | null
          trace_url?: string | null
          updated_at?: string
          width_inches?: number | null
        }
        Update: {
          created_at?: string
          flat_url?: string | null
          generation_id?: string | null
          height_inches?: number | null
          id?: string
          model?: string | null
          notes?: string | null
          print_url?: string | null
          production_url?: string | null
          qc_status?: string
          qcproof_url?: string | null
          reviewer?: string | null
          side?: string | null
          target_dpi?: number | null
          trace_url?: string | null
          updated_at?: string
          width_inches?: number | null
        }
        Relationships: []
      }
      production_actions: {
        Row: {
          action_type: string
          before_after: Json | null
          completed_at: string | null
          created_at: string | null
          current_step: string | null
          file_in: string | null
          file_name: string | null
          file_out: string | null
          id: string
          job_id: string | null
          metrics: Json | null
          options: Json | null
          output_format: string | null
          package_id: string | null
          package_name: string | null
          rip_compatible: string[] | null
          service_id: string | null
          status: string | null
          step_results: Json | null
          steps_completed: number | null
          steps_total: number | null
          tokens_used: number | null
          user_id: string
        }
        Insert: {
          action_type?: string
          before_after?: Json | null
          completed_at?: string | null
          created_at?: string | null
          current_step?: string | null
          file_in?: string | null
          file_name?: string | null
          file_out?: string | null
          id?: string
          job_id?: string | null
          metrics?: Json | null
          options?: Json | null
          output_format?: string | null
          package_id?: string | null
          package_name?: string | null
          rip_compatible?: string[] | null
          service_id?: string | null
          status?: string | null
          step_results?: Json | null
          steps_completed?: number | null
          steps_total?: number | null
          tokens_used?: number | null
          user_id: string
        }
        Update: {
          action_type?: string
          before_after?: Json | null
          completed_at?: string | null
          created_at?: string | null
          current_step?: string | null
          file_in?: string | null
          file_name?: string | null
          file_out?: string | null
          id?: string
          job_id?: string | null
          metrics?: Json | null
          options?: Json | null
          output_format?: string | null
          package_id?: string | null
          package_name?: string | null
          rip_compatible?: string[] | null
          service_id?: string | null
          status?: string | null
          step_results?: Json | null
          steps_completed?: number | null
          steps_total?: number | null
          tokens_used?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_actions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "panelizer_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      production_approvals: {
        Row: {
          approval_id: string
          approved_at: string
          category: string | null
          design_name: string | null
          finish: string | null
          job_id: string | null
          panel_url: string
          prompt_text: string | null
          render_metadata: Json | null
          side: string
          storage_path: string | null
          user_id: string | null
          vehicle_meta: Json | null
        }
        Insert: {
          approval_id?: string
          approved_at?: string
          category?: string | null
          design_name?: string | null
          finish?: string | null
          job_id?: string | null
          panel_url: string
          prompt_text?: string | null
          render_metadata?: Json | null
          side: string
          storage_path?: string | null
          user_id?: string | null
          vehicle_meta?: Json | null
        }
        Update: {
          approval_id?: string
          approved_at?: string
          category?: string | null
          design_name?: string | null
          finish?: string | null
          job_id?: string | null
          panel_url?: string
          prompt_text?: string | null
          render_metadata?: Json | null
          side?: string
          storage_path?: string | null
          user_id?: string | null
          vehicle_meta?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "production_approvals_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "panelizer_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      production_flow_assets: {
        Row: {
          background_url: string
          branding_url: string
          created_at: string
          depth_mask_url: string
          dimensions_inches: Json
          final_pack_url: string
          id: string
          is_passenger_flipped: boolean | null
          job_id: string
          meta_metrics: Json | null
          side: string
          version: string
        }
        Insert: {
          background_url: string
          branding_url: string
          created_at?: string
          depth_mask_url: string
          dimensions_inches: Json
          final_pack_url: string
          id?: string
          is_passenger_flipped?: boolean | null
          job_id: string
          meta_metrics?: Json | null
          side: string
          version?: string
        }
        Update: {
          background_url?: string
          branding_url?: string
          created_at?: string
          depth_mask_url?: string
          dimensions_inches?: Json
          final_pack_url?: string
          id?: string
          is_passenger_flipped?: boolean | null
          job_id?: string
          meta_metrics?: Json | null
          side?: string
          version?: string
        }
        Relationships: []
      }
      production_notifications: {
        Row: {
          action_url: string | null
          created_at: string
          email_id: string | null
          email_sent: boolean
          id: string
          job_id: string | null
          message: string
          read: boolean
          title: string
          type: string
          user_id: string
        }
        Insert: {
          action_url?: string | null
          created_at?: string
          email_id?: string | null
          email_sent?: boolean
          id?: string
          job_id?: string | null
          message?: string
          read?: boolean
          title?: string
          type?: string
          user_id: string
        }
        Update: {
          action_url?: string | null
          created_at?: string
          email_id?: string | null
          email_sent?: boolean
          id?: string
          job_id?: string | null
          message?: string
          read?: boolean
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      production_pack_credits: {
        Row: {
          created_at: string
          granted_by: string | null
          id: string
          reason: string | null
          total_credits: number
          used_credits: number
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          id?: string
          reason?: string | null
          total_credits: number
          used_credits?: number
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          id?: string
          reason?: string | null
          total_credits?: number
          used_credits?: number
          user_id?: string
        }
        Relationships: []
      }
      production_pack_redeem_codes: {
        Row: {
          active: boolean
          code: string
          created_at: string
          created_by: string | null
          credits_per_redemption: number
          expires_at: string | null
          id: string
          max_redemptions: number
          reason: string | null
          redemption_count: number
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          created_by?: string | null
          credits_per_redemption: number
          expires_at?: string | null
          id?: string
          max_redemptions?: number
          reason?: string | null
          redemption_count?: number
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          created_by?: string | null
          credits_per_redemption?: number
          expires_at?: string | null
          id?: string
          max_redemptions?: number
          reason?: string | null
          redemption_count?: number
        }
        Relationships: []
      }
      production_pack_redemptions: {
        Row: {
          code_id: string
          credit_grant_id: string | null
          id: string
          redeemed_at: string
          user_id: string
        }
        Insert: {
          code_id: string
          credit_grant_id?: string | null
          id?: string
          redeemed_at?: string
          user_id: string
        }
        Update: {
          code_id?: string
          credit_grant_id?: string | null
          id?: string
          redeemed_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_pack_redemptions_code_id_fkey"
            columns: ["code_id"]
            isOneToOne: false
            referencedRelation: "production_pack_redeem_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_pack_redemptions_credit_grant_id_fkey"
            columns: ["credit_grant_id"]
            isOneToOne: false
            referencedRelation: "production_pack_credits"
            referencedColumns: ["id"]
          },
        ]
      }
      production_packs: {
        Row: {
          created_at: string
          design_name: string | null
          file_count: number | null
          finish_type: string | null
          generation_id: string | null
          id: string
          is_starred: boolean | null
          manifest_json: Json | null
          pack_url: string | null
          panel_proof_url: string | null
          panels_selected: Json
          payment_status: string
          pipeline_version: string | null
          quote_id: string | null
          shop_id: string | null
          size_validation: Json | null
          source: string | null
          three_d_proof_url: string | null
          thumbnail_url: string | null
          total_price_cents: number
          two_d_proof_url: string | null
          upscale_error: string | null
          upscale_progress: string | null
          upscale_status: string | null
          user_id: string
          vehicle_info: Json | null
          visualization_id: string | null
          wrapbox_pushed_at: string | null
          wrapbox_status: string | null
        }
        Insert: {
          created_at?: string
          design_name?: string | null
          file_count?: number | null
          finish_type?: string | null
          generation_id?: string | null
          id?: string
          is_starred?: boolean | null
          manifest_json?: Json | null
          pack_url?: string | null
          panel_proof_url?: string | null
          panels_selected: Json
          payment_status?: string
          pipeline_version?: string | null
          quote_id?: string | null
          shop_id?: string | null
          size_validation?: Json | null
          source?: string | null
          three_d_proof_url?: string | null
          thumbnail_url?: string | null
          total_price_cents?: number
          two_d_proof_url?: string | null
          upscale_error?: string | null
          upscale_progress?: string | null
          upscale_status?: string | null
          user_id: string
          vehicle_info?: Json | null
          visualization_id?: string | null
          wrapbox_pushed_at?: string | null
          wrapbox_status?: string | null
        }
        Update: {
          created_at?: string
          design_name?: string | null
          file_count?: number | null
          finish_type?: string | null
          generation_id?: string | null
          id?: string
          is_starred?: boolean | null
          manifest_json?: Json | null
          pack_url?: string | null
          panel_proof_url?: string | null
          panels_selected?: Json
          payment_status?: string
          pipeline_version?: string | null
          quote_id?: string | null
          shop_id?: string | null
          size_validation?: Json | null
          source?: string | null
          three_d_proof_url?: string | null
          thumbnail_url?: string | null
          total_price_cents?: number
          two_d_proof_url?: string | null
          upscale_error?: string | null
          upscale_progress?: string | null
          upscale_status?: string | null
          user_id?: string
          vehicle_info?: Json | null
          visualization_id?: string | null
          wrapbox_pushed_at?: string | null
          wrapbox_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_packs_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_packs_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shop_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      production_panels: {
        Row: {
          created_at: string
          dimensions_summary: string
          id: string
          mapping_payload: Json
          operator_notes: string | null
          panel_name: string | null
          preview_path: string | null
          project_id: string
          render_id: string
          status: string
          storage_path: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          dimensions_summary: string
          id?: string
          mapping_payload: Json
          operator_notes?: string | null
          panel_name?: string | null
          preview_path?: string | null
          project_id: string
          render_id: string
          status?: string
          storage_path?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          dimensions_summary?: string
          id?: string
          mapping_payload?: Json
          operator_notes?: string | null
          panel_name?: string | null
          preview_path?: string | null
          project_id?: string
          render_id?: string
          status?: string
          storage_path?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      proof_access_tokens: {
        Row: {
          created_at: string | null
          expires_at: string | null
          id: string
          proof_id: string
          revoked: boolean | null
          token: string
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          proof_id: string
          revoked?: boolean | null
          token?: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          proof_id?: string
          revoked?: boolean | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "proof_access_tokens_proof_id_fkey"
            columns: ["proof_id"]
            isOneToOne: false
            referencedRelation: "proofs"
            referencedColumns: ["id"]
          },
        ]
      }
      proof_ai_jobs: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          customer_ip: unknown
          customer_prompt: string
          error_message: string | null
          id: string
          idempotency_key: string
          proof_id: string
          result_version_id: string | null
          source_version_id: string
          started_at: string | null
          status: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          customer_ip?: unknown
          customer_prompt: string
          error_message?: string | null
          id?: string
          idempotency_key: string
          proof_id: string
          result_version_id?: string | null
          source_version_id: string
          started_at?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          customer_ip?: unknown
          customer_prompt?: string
          error_message?: string | null
          id?: string
          idempotency_key?: string
          proof_id?: string
          result_version_id?: string | null
          source_version_id?: string
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "proof_ai_jobs_proof_id_fkey"
            columns: ["proof_id"]
            isOneToOne: false
            referencedRelation: "proof_approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proof_ai_jobs_result_version_id_fkey"
            columns: ["result_version_id"]
            isOneToOne: false
            referencedRelation: "proof_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proof_ai_jobs_source_version_id_fkey"
            columns: ["source_version_id"]
            isOneToOne: false
            referencedRelation: "proof_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      proof_approvals: {
        Row: {
          ai_revisions_allowed: number
          ai_revisions_used: number
          assigned_at: string | null
          assigned_by: string | null
          assigned_to: string | null
          change_request: string | null
          created_at: string
          customer_email: string
          customer_name: string | null
          customer_phone: string | null
          decline_reason: string | null
          design_name: string | null
          expires_at: string | null
          finish_type: string | null
          has_line_items: boolean
          id: string
          internal_notes: string | null
          manage_token: string
          message_to_customer: string | null
          metadata: Json
          mode: string
          sent_at: string | null
          shop_id: string
          signature_storage_path: string | null
          signed_at: string | null
          signed_pdf_sha256: string | null
          signed_pdf_storage_path: string | null
          signer_ip: unknown
          signer_typed_name: string | null
          signer_user_agent: string | null
          source_visualization_id: string | null
          status: string
          updated_at: string
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_type: string | null
          vehicle_year: string | null
          view_token: string
          viewed_at: string | null
          white_label_logo_url: string | null
        }
        Insert: {
          ai_revisions_allowed?: number
          ai_revisions_used?: number
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_to?: string | null
          change_request?: string | null
          created_at?: string
          customer_email: string
          customer_name?: string | null
          customer_phone?: string | null
          decline_reason?: string | null
          design_name?: string | null
          expires_at?: string | null
          finish_type?: string | null
          has_line_items?: boolean
          id?: string
          internal_notes?: string | null
          manage_token: string
          message_to_customer?: string | null
          metadata?: Json
          mode: string
          sent_at?: string | null
          shop_id: string
          signature_storage_path?: string | null
          signed_at?: string | null
          signed_pdf_sha256?: string | null
          signed_pdf_storage_path?: string | null
          signer_ip?: unknown
          signer_typed_name?: string | null
          signer_user_agent?: string | null
          source_visualization_id?: string | null
          status?: string
          updated_at?: string
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_type?: string | null
          vehicle_year?: string | null
          view_token: string
          viewed_at?: string | null
          white_label_logo_url?: string | null
        }
        Update: {
          ai_revisions_allowed?: number
          ai_revisions_used?: number
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_to?: string | null
          change_request?: string | null
          created_at?: string
          customer_email?: string
          customer_name?: string | null
          customer_phone?: string | null
          decline_reason?: string | null
          design_name?: string | null
          expires_at?: string | null
          finish_type?: string | null
          has_line_items?: boolean
          id?: string
          internal_notes?: string | null
          manage_token?: string
          message_to_customer?: string | null
          metadata?: Json
          mode?: string
          sent_at?: string | null
          shop_id?: string
          signature_storage_path?: string | null
          signed_at?: string | null
          signed_pdf_sha256?: string | null
          signed_pdf_storage_path?: string | null
          signer_ip?: unknown
          signer_typed_name?: string | null
          signer_user_agent?: string | null
          source_visualization_id?: string | null
          status?: string
          updated_at?: string
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_type?: string | null
          vehicle_year?: string | null
          view_token?: string
          viewed_at?: string | null
          white_label_logo_url?: string | null
        }
        Relationships: []
      }
      proof_events: {
        Row: {
          actor_role: string | null
          actor_user_id: string | null
          created_at: string
          event_type: string
          id: string
          ip: unknown
          payload: Json
          proof_id: string
          user_agent: string | null
        }
        Insert: {
          actor_role?: string | null
          actor_user_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          ip?: unknown
          payload?: Json
          proof_id: string
          user_agent?: string | null
        }
        Update: {
          actor_role?: string | null
          actor_user_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          ip?: unknown
          payload?: Json
          proof_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proof_events_proof_id_fkey"
            columns: ["proof_id"]
            isOneToOne: false
            referencedRelation: "proof_approvals"
            referencedColumns: ["id"]
          },
        ]
      }
      proof_line_items: {
        Row: {
          approved_at: string | null
          change_request: string | null
          created_at: string
          decline_reason: string | null
          declined_at: string | null
          description: string | null
          id: string
          line_number: number
          metadata: Json
          proof_id: string
          reference_image_paths: Json
          render_url: string | null
          revision_requested_at: string | null
          status: string
          thumbnail_url: string | null
          title: string
          updated_at: string
          uploaded_file_paths: Json
        }
        Insert: {
          approved_at?: string | null
          change_request?: string | null
          created_at?: string
          decline_reason?: string | null
          declined_at?: string | null
          description?: string | null
          id?: string
          line_number: number
          metadata?: Json
          proof_id: string
          reference_image_paths?: Json
          render_url?: string | null
          revision_requested_at?: string | null
          status?: string
          thumbnail_url?: string | null
          title: string
          updated_at?: string
          uploaded_file_paths?: Json
        }
        Update: {
          approved_at?: string | null
          change_request?: string | null
          created_at?: string
          decline_reason?: string | null
          declined_at?: string | null
          description?: string | null
          id?: string
          line_number?: number
          metadata?: Json
          proof_id?: string
          reference_image_paths?: Json
          render_url?: string | null
          revision_requested_at?: string | null
          status?: string
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          uploaded_file_paths?: Json
        }
        Relationships: [
          {
            foreignKeyName: "proof_line_items_proof_id_fkey"
            columns: ["proof_id"]
            isOneToOne: false
            referencedRelation: "proof_approvals"
            referencedColumns: ["id"]
          },
        ]
      }
      proof_messages: {
        Row: {
          approved_by: string | null
          body: string
          channels: Json
          created_at: string
          id: string
          proof_id: string
          reply_to_message_id: string | null
          sender_name: string | null
          sender_role: string
          sent_at: string | null
          status: string
        }
        Insert: {
          approved_by?: string | null
          body: string
          channels?: Json
          created_at?: string
          id?: string
          proof_id: string
          reply_to_message_id?: string | null
          sender_name?: string | null
          sender_role: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          approved_by?: string | null
          body?: string
          channels?: Json
          created_at?: string
          id?: string
          proof_id?: string
          reply_to_message_id?: string | null
          sender_name?: string | null
          sender_role?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "proof_messages_proof_id_fkey"
            columns: ["proof_id"]
            isOneToOne: false
            referencedRelation: "proof_approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proof_messages_reply_to_message_id_fkey"
            columns: ["reply_to_message_id"]
            isOneToOne: false
            referencedRelation: "proof_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      proof_team_views: {
        Row: {
          last_viewed_at: string
          proof_id: string
          user_id: string
        }
        Insert: {
          last_viewed_at?: string
          proof_id: string
          user_id: string
        }
        Update: {
          last_viewed_at?: string
          proof_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "proof_team_views_proof_id_fkey"
            columns: ["proof_id"]
            isOneToOne: false
            referencedRelation: "proof_approvals"
            referencedColumns: ["id"]
          },
        ]
      }
      proof_versions: {
        Row: {
          ai_cost_estimate: number
          created_at: string
          created_by_role: string
          created_by_user_id: string | null
          id: string
          is_active: boolean
          prompt_text: string | null
          proof_id: string
          reference_image_paths: Json
          render_urls: Json
          uploaded_file_paths: Json
          version_number: number
        }
        Insert: {
          ai_cost_estimate?: number
          created_at?: string
          created_by_role: string
          created_by_user_id?: string | null
          id?: string
          is_active?: boolean
          prompt_text?: string | null
          proof_id: string
          reference_image_paths?: Json
          render_urls?: Json
          uploaded_file_paths?: Json
          version_number: number
        }
        Update: {
          ai_cost_estimate?: number
          created_at?: string
          created_by_role?: string
          created_by_user_id?: string | null
          id?: string
          is_active?: boolean
          prompt_text?: string | null
          proof_id?: string
          reference_image_paths?: Json
          render_urls?: Json
          uploaded_file_paths?: Json
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "proof_versions_proof_id_fkey"
            columns: ["proof_id"]
            isOneToOne: false
            referencedRelation: "proof_approvals"
            referencedColumns: ["id"]
          },
        ]
      }
      proofs: {
        Row: {
          approved_at: string | null
          created_at: string | null
          customer_email: string | null
          customer_name: string | null
          customer_notes: string | null
          film_or_design_name: string | null
          id: string
          manufacturer: string | null
          order_number: string | null
          owner_user_id: string
          pdf_url: string | null
          quote_number: string | null
          render_urls: Json
          shop_id: string | null
          status: string | null
          tool_name: string
          updated_at: string | null
          vehicle_info: Json | null
        }
        Insert: {
          approved_at?: string | null
          created_at?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_notes?: string | null
          film_or_design_name?: string | null
          id?: string
          manufacturer?: string | null
          order_number?: string | null
          owner_user_id: string
          pdf_url?: string | null
          quote_number?: string | null
          render_urls?: Json
          shop_id?: string | null
          status?: string | null
          tool_name: string
          updated_at?: string | null
          vehicle_info?: Json | null
        }
        Update: {
          approved_at?: string | null
          created_at?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_notes?: string | null
          film_or_design_name?: string | null
          id?: string
          manufacturer?: string | null
          order_number?: string | null
          owner_user_id?: string
          pdf_url?: string | null
          quote_number?: string | null
          render_urls?: Json
          shop_id?: string | null
          status?: string | null
          tool_name?: string
          updated_at?: string | null
          vehicle_info?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "proofs_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_assets: {
        Row: {
          asset_type: string
          created_at: string | null
          id: string
          label: string | null
          metadata: Json | null
          quote_id: string
          shop_id: string | null
          url: string
        }
        Insert: {
          asset_type: string
          created_at?: string | null
          id?: string
          label?: string | null
          metadata?: Json | null
          quote_id: string
          shop_id?: string | null
          url: string
        }
        Update: {
          asset_type?: string
          created_at?: string | null
          id?: string
          label?: string | null
          metadata?: Json | null
          quote_id?: string
          shop_id?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_assets_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_assets_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shop_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_events: {
        Row: {
          created_at: string | null
          event_type: string
          id: string
          metadata: Json | null
          product_type: string | null
          quote_id: string | null
          quote_ref: string | null
          shop_id: string | null
          source: string
        }
        Insert: {
          created_at?: string | null
          event_type: string
          id?: string
          metadata?: Json | null
          product_type?: string | null
          quote_id?: string | null
          quote_ref?: string | null
          shop_id?: string | null
          source?: string
        }
        Update: {
          created_at?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
          product_type?: string | null
          quote_id?: string | null
          quote_ref?: string | null
          shop_id?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_events_quote_ref_fkey"
            columns: ["quote_ref"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_events_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shop_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          base_render_url: string | null
          category: string | null
          color_name: string | null
          created_at: string | null
          created_by: string | null
          customer_id: string | null
          customer_total: number | null
          finish: string | null
          id: string
          is_test: boolean
          last_email_at: string | null
          last_email_type: string | null
          line_items: Json | null
          manufacturer: string | null
          margin_percent: number | null
          metadata: Json | null
          order_id: string | null
          precision_mod_renders: Json
          quote_number: string
          render_url: string | null
          share_token: string
          shop_cost: number | null
          shop_id: string | null
          sq_ft: number | null
          status: string | null
          tool_source: string | null
          updated_at: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_year: string | null
          visualization_id: string | null
          yards_needed: number | null
        }
        Insert: {
          base_render_url?: string | null
          category?: string | null
          color_name?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_id?: string | null
          customer_total?: number | null
          finish?: string | null
          id?: string
          is_test?: boolean
          last_email_at?: string | null
          last_email_type?: string | null
          line_items?: Json | null
          manufacturer?: string | null
          margin_percent?: number | null
          metadata?: Json | null
          order_id?: string | null
          precision_mod_renders?: Json
          quote_number: string
          render_url?: string | null
          share_token?: string
          shop_cost?: number | null
          shop_id?: string | null
          sq_ft?: number | null
          status?: string | null
          tool_source?: string | null
          updated_at?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: string | null
          visualization_id?: string | null
          yards_needed?: number | null
        }
        Update: {
          base_render_url?: string | null
          category?: string | null
          color_name?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_id?: string | null
          customer_total?: number | null
          finish?: string | null
          id?: string
          is_test?: boolean
          last_email_at?: string | null
          last_email_type?: string | null
          line_items?: Json | null
          manufacturer?: string | null
          margin_percent?: number | null
          metadata?: Json | null
          order_id?: string | null
          precision_mod_renders?: Json
          quote_number?: string
          render_url?: string | null
          share_token?: string
          shop_cost?: number | null
          shop_id?: string | null
          sq_ft?: number | null
          status?: string | null
          tool_source?: string | null
          updated_at?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: string | null
          visualization_id?: string | null
          yards_needed?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "quotes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shop_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      render_error_log: {
        Row: {
          created_at: string
          duration_ms: number | null
          error_code: string | null
          error_message: string | null
          function_name: string
          id: string
          request_meta: Json | null
          status_code: number | null
          tool: string
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          function_name: string
          id?: string
          request_meta?: Json | null
          status_code?: number | null
          tool: string
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          function_name?: string
          id?: string
          request_meta?: Json | null
          status_code?: number | null
          tool?: string
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      render_events: {
        Row: {
          created_at: string
          email: string | null
          engine_version: string | null
          enhanced_prompt_chars: number | null
          enhanced_prompt_hash: string | null
          error_message: string | null
          finish: string | null
          gemini_finish_reason: string | null
          gemini_model: string | null
          id: string
          latency_ms: number | null
          mode: string | null
          raw_prompt: string | null
          render_url: string | null
          source_id: string | null
          source_table: string | null
          success: boolean
          thumbnail_url: string | null
          tool: string
          user_id: string | null
          vehicle_canonical: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_year: string | null
          view_type: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          engine_version?: string | null
          enhanced_prompt_chars?: number | null
          enhanced_prompt_hash?: string | null
          error_message?: string | null
          finish?: string | null
          gemini_finish_reason?: string | null
          gemini_model?: string | null
          id?: string
          latency_ms?: number | null
          mode?: string | null
          raw_prompt?: string | null
          render_url?: string | null
          source_id?: string | null
          source_table?: string | null
          success?: boolean
          thumbnail_url?: string | null
          tool: string
          user_id?: string | null
          vehicle_canonical?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: string | null
          view_type?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          engine_version?: string | null
          enhanced_prompt_chars?: number | null
          enhanced_prompt_hash?: string | null
          error_message?: string | null
          finish?: string | null
          gemini_finish_reason?: string | null
          gemini_model?: string | null
          id?: string
          latency_ms?: number | null
          mode?: string | null
          raw_prompt?: string | null
          render_url?: string | null
          source_id?: string | null
          source_table?: string | null
          success?: boolean
          thumbnail_url?: string | null
          tool?: string
          user_id?: string | null
          vehicle_canonical?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: string | null
          view_type?: string | null
        }
        Relationships: []
      }
      render_quality_ratings: {
        Row: {
          auto_regenerated: boolean | null
          created_at: string | null
          customer_notified_at: string | null
          fix_deployed_at: string | null
          fix_notes: string | null
          flag_reason: string | null
          gradient_quality_score: number | null
          has_hard_line: boolean | null
          id: string
          is_flagged: boolean | null
          is_v2_feature: boolean | null
          notes: string | null
          rating: number | null
          render_id: string
          render_type: string
          updated_at: string | null
          user_email: string | null
          validation_details: Json | null
        }
        Insert: {
          auto_regenerated?: boolean | null
          created_at?: string | null
          customer_notified_at?: string | null
          fix_deployed_at?: string | null
          fix_notes?: string | null
          flag_reason?: string | null
          gradient_quality_score?: number | null
          has_hard_line?: boolean | null
          id?: string
          is_flagged?: boolean | null
          is_v2_feature?: boolean | null
          notes?: string | null
          rating?: number | null
          render_id: string
          render_type: string
          updated_at?: string | null
          user_email?: string | null
          validation_details?: Json | null
        }
        Update: {
          auto_regenerated?: boolean | null
          created_at?: string | null
          customer_notified_at?: string | null
          fix_deployed_at?: string | null
          fix_notes?: string | null
          flag_reason?: string | null
          gradient_quality_score?: number | null
          has_hard_line?: boolean | null
          id?: string
          is_flagged?: boolean | null
          is_v2_feature?: boolean | null
          notes?: string | null
          rating?: number | null
          render_id?: string
          render_type?: string
          updated_at?: string | null
          user_email?: string | null
          validation_details?: Json | null
        }
        Relationships: []
      }
      render_queue: {
        Row: {
          completed_at: string | null
          created_at: string
          design_name: string | null
          error: string | null
          generation_id: string | null
          id: string
          label: string | null
          progress: number
          prompt_summary: string | null
          result_url: string | null
          started_at: string | null
          status: string
          thumbnail_url: string | null
          tool: string
          user_id: string
          vehicle: string | null
          view_type: string | null
          window_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          design_name?: string | null
          error?: string | null
          generation_id?: string | null
          id?: string
          label?: string | null
          progress?: number
          prompt_summary?: string | null
          result_url?: string | null
          started_at?: string | null
          status?: string
          thumbnail_url?: string | null
          tool: string
          user_id: string
          vehicle?: string | null
          view_type?: string | null
          window_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          design_name?: string | null
          error?: string | null
          generation_id?: string | null
          id?: string
          label?: string | null
          progress?: number
          prompt_summary?: string | null
          result_url?: string | null
          started_at?: string | null
          status?: string
          thumbnail_url?: string | null
          tool?: string
          user_id?: string
          vehicle?: string | null
          view_type?: string | null
          window_id?: string | null
        }
        Relationships: []
      }
      render_templates: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          is_golden_template: boolean | null
          prompt_signature: string
          rating: number | null
          render_urls: Json
          source_visualization_id: string | null
          updated_at: string | null
          use_count: number | null
          vehicle_signature: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_golden_template?: boolean | null
          prompt_signature: string
          rating?: number | null
          render_urls?: Json
          source_visualization_id?: string | null
          updated_at?: string | null
          use_count?: number | null
          vehicle_signature: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_golden_template?: boolean | null
          prompt_signature?: string
          rating?: number | null
          render_urls?: Json
          source_visualization_id?: string | null
          updated_at?: string | null
          use_count?: number | null
          vehicle_signature?: string
        }
        Relationships: [
          {
            foreignKeyName: "render_templates_source_visualization_id_fkey"
            columns: ["source_visualization_id"]
            isOneToOne: false
            referencedRelation: "color_visualizations"
            referencedColumns: ["id"]
          },
        ]
      }
      render_usage: {
        Row: {
          billing_cycle_start: string
          created_at: string | null
          email: string
          id: string
          render_type: string
          tier: string
          user_id: string
        }
        Insert: {
          billing_cycle_start: string
          created_at?: string | null
          email: string
          id?: string
          render_type: string
          tier: string
          user_id: string
        }
        Update: {
          billing_cycle_start?: string
          created_at?: string | null
          email?: string
          id?: string
          render_type?: string
          tier?: string
          user_id?: string
        }
        Relationships: []
      }
      restylepro_contact_requests: {
        Row: {
          created_at: string
          email: string
          id: string
          message: string | null
          name: string | null
          page_path: string | null
          status: string
          tier_interest: string | null
          topic: string
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          message?: string | null
          name?: string | null
          page_path?: string | null
          status?: string
          tier_interest?: string | null
          topic?: string
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          message?: string | null
          name?: string | null
          page_path?: string | null
          status?: string
          tier_interest?: string | null
          topic?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      retarget_templates: {
        Row: {
          body: string
          channel: string
          created_at: string | null
          description: string
          enabled: boolean
          id: string
          label: string
          metadata: Json | null
          sort_order: number
          subject: string | null
          tier: string
          updated_at: string | null
        }
        Insert: {
          body: string
          channel: string
          created_at?: string | null
          description?: string
          enabled?: boolean
          id: string
          label: string
          metadata?: Json | null
          sort_order?: number
          subject?: string | null
          tier: string
          updated_at?: string | null
        }
        Update: {
          body?: string
          channel?: string
          created_at?: string | null
          description?: string
          enabled?: boolean
          id?: string
          label?: string
          metadata?: Json | null
          sort_order?: number
          subject?: string | null
          tier?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      rp_corporate_team: {
        Row: {
          avatar_url: string | null
          company: string
          created_at: string | null
          department: string | null
          email: string
          full_name: string | null
          hired_at: string | null
          id: string
          is_active: boolean | null
          notes: string | null
          permissions: Json | null
          phone: string | null
          role: string
          title: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          company?: string
          created_at?: string | null
          department?: string | null
          email: string
          full_name?: string | null
          hired_at?: string | null
          id?: string
          is_active?: boolean | null
          notes?: string | null
          permissions?: Json | null
          phone?: string | null
          role?: string
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          company?: string
          created_at?: string | null
          department?: string | null
          email?: string
          full_name?: string | null
          hired_at?: string | null
          id?: string
          is_active?: boolean | null
          notes?: string | null
          permissions?: Json | null
          phone?: string | null
          role?: string
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      scheduled_emails: {
        Row: {
          attempts: number
          created_at: string
          created_by: string | null
          id: string
          last_error: string | null
          merge_data: Json
          recipient_email: string
          send_at: string
          sent_at: string | null
          shop_id: string | null
          source: string
          source_ref: string | null
          status: string
          subject_override: string | null
          template_slug: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          created_by?: string | null
          id?: string
          last_error?: string | null
          merge_data?: Json
          recipient_email: string
          send_at: string
          sent_at?: string | null
          shop_id?: string | null
          source?: string
          source_ref?: string | null
          status?: string
          subject_override?: string | null
          template_slug: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          created_by?: string | null
          id?: string
          last_error?: string | null
          merge_data?: Json
          recipient_email?: string
          send_at?: string
          sent_at?: string | null
          shop_id?: string | null
          source?: string
          source_ref?: string | null
          status?: string
          subject_override?: string | null
          template_slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      scheduled_sms: {
        Row: {
          attempts: number
          body: string
          campaign_name: string | null
          created_at: string
          created_by: string | null
          id: string
          last_error: string | null
          recipient_name: string | null
          recipient_phone: string
          send_at: string
          sent_at: string | null
          source: string
          source_ref: string | null
          status: string
          twilio_sid: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          body: string
          campaign_name?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          last_error?: string | null
          recipient_name?: string | null
          recipient_phone: string
          send_at: string
          sent_at?: string | null
          source?: string
          source_ref?: string | null
          status?: string
          twilio_sid?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          body?: string
          campaign_name?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          last_error?: string | null
          recipient_name?: string | null
          recipient_phone?: string
          send_at?: string
          sent_at?: string | null
          source?: string
          source_ref?: string | null
          status?: string
          twilio_sid?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      script_lines: {
        Row: {
          created_at: string
          end_time: number | null
          evidence_type: string | null
          id: string
          line_index: number
          provenance_status: string
          role: string | null
          script_version_id: string
          start_time: number | null
          text: string
          transcript_segment_ids: string[]
          visual_direction: string | null
        }
        Insert: {
          created_at?: string
          end_time?: number | null
          evidence_type?: string | null
          id?: string
          line_index?: number
          provenance_status?: string
          role?: string | null
          script_version_id: string
          start_time?: number | null
          text: string
          transcript_segment_ids?: string[]
          visual_direction?: string | null
        }
        Update: {
          created_at?: string
          end_time?: number | null
          evidence_type?: string | null
          id?: string
          line_index?: number
          provenance_status?: string
          role?: string | null
          script_version_id?: string
          start_time?: number | null
          text?: string
          transcript_segment_ids?: string[]
          visual_direction?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "script_lines_script_version_id_fkey"
            columns: ["script_version_id"]
            isOneToOne: false
            referencedRelation: "script_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      script_versions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          brand_pillar_id: string | null
          caption: string | null
          content_concept_id: string
          created_at: string
          cta: string | null
          edit_plan: Json
          hook_template_id: string | null
          hook_text: string | null
          id: string
          render_job_id: string | null
          status: string
          strategy_metadata: Json
          version: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          brand_pillar_id?: string | null
          caption?: string | null
          content_concept_id: string
          created_at?: string
          cta?: string | null
          edit_plan?: Json
          hook_template_id?: string | null
          hook_text?: string | null
          id?: string
          render_job_id?: string | null
          status?: string
          strategy_metadata?: Json
          version?: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          brand_pillar_id?: string | null
          caption?: string | null
          content_concept_id?: string
          created_at?: string
          cta?: string | null
          edit_plan?: Json
          hook_template_id?: string | null
          hook_text?: string | null
          id?: string
          render_job_id?: string | null
          status?: string
          strategy_metadata?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "script_versions_brand_pillar_id_fkey"
            columns: ["brand_pillar_id"]
            isOneToOne: false
            referencedRelation: "brand_pillars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "script_versions_content_concept_id_fkey"
            columns: ["content_concept_id"]
            isOneToOne: false
            referencedRelation: "content_concepts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "script_versions_hook_template_id_fkey"
            columns: ["hook_template_id"]
            isOneToOne: false
            referencedRelation: "content_hooks"
            referencedColumns: ["id"]
          },
        ]
      }
      sentinel_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          meta: Json
          role: string
          thread: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          meta?: Json
          role: string
          thread?: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          meta?: Json
          role?: string
          thread?: string
        }
        Relationships: []
      }
      seo_audit_runs: {
        Row: {
          created_at: string
          findings: Json | null
          id: string
          score: number | null
          shop_id: string
          url: string
        }
        Insert: {
          created_at?: string
          findings?: Json | null
          id?: string
          score?: number | null
          shop_id: string
          url: string
        }
        Update: {
          created_at?: string
          findings?: Json | null
          id?: string
          score?: number | null
          shop_id?: string
          url?: string
        }
        Relationships: []
      }
      seo_blog_posts: {
        Row: {
          author_name: string | null
          body_html: string | null
          created_at: string
          created_by: string | null
          excerpt: string | null
          external_last_error: string | null
          external_platform: string | null
          external_post_id: string | null
          external_status: string | null
          external_synced_at: string | null
          external_url: string | null
          faq: Json | null
          featured_image_url: string | null
          focus_keyword: string | null
          id: string
          intent: string
          internal_links: Json | null
          keywords: string[] | null
          meta_description: string | null
          meta_title: string | null
          published_at: string | null
          reading_time_min: number | null
          schema_json: Json | null
          seo_findings: Json | null
          seo_score: number | null
          shop_id: string
          slug: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          author_name?: string | null
          body_html?: string | null
          created_at?: string
          created_by?: string | null
          excerpt?: string | null
          external_last_error?: string | null
          external_platform?: string | null
          external_post_id?: string | null
          external_status?: string | null
          external_synced_at?: string | null
          external_url?: string | null
          faq?: Json | null
          featured_image_url?: string | null
          focus_keyword?: string | null
          id?: string
          intent?: string
          internal_links?: Json | null
          keywords?: string[] | null
          meta_description?: string | null
          meta_title?: string | null
          published_at?: string | null
          reading_time_min?: number | null
          schema_json?: Json | null
          seo_findings?: Json | null
          seo_score?: number | null
          shop_id: string
          slug?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Update: {
          author_name?: string | null
          body_html?: string | null
          created_at?: string
          created_by?: string | null
          excerpt?: string | null
          external_last_error?: string | null
          external_platform?: string | null
          external_post_id?: string | null
          external_status?: string | null
          external_synced_at?: string | null
          external_url?: string | null
          faq?: Json | null
          featured_image_url?: string | null
          focus_keyword?: string | null
          id?: string
          intent?: string
          internal_links?: Json | null
          keywords?: string[] | null
          meta_description?: string | null
          meta_title?: string | null
          published_at?: string | null
          reading_time_min?: number | null
          schema_json?: Json | null
          seo_findings?: Json | null
          seo_score?: number | null
          shop_id?: string
          slug?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      seo_keywords: {
        Row: {
          created_at: string
          ctr: number | null
          current_clicks: number | null
          current_impressions: number | null
          current_position: number | null
          difficulty: number | null
          id: string
          intent: string
          keyword: string
          last_seen_at: string | null
          notes: string | null
          search_volume: number | null
          shop_id: string
          target_url: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          ctr?: number | null
          current_clicks?: number | null
          current_impressions?: number | null
          current_position?: number | null
          difficulty?: number | null
          id?: string
          intent?: string
          keyword: string
          last_seen_at?: string | null
          notes?: string | null
          search_volume?: number | null
          shop_id: string
          target_url?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          ctr?: number | null
          current_clicks?: number | null
          current_impressions?: number | null
          current_position?: number | null
          difficulty?: number | null
          id?: string
          intent?: string
          keyword?: string
          last_seen_at?: string | null
          notes?: string | null
          search_volume?: number | null
          shop_id?: string
          target_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seo_keywords_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      seo_pages: {
        Row: {
          ai_suggested_at: string | null
          ai_suggested_meta_description: string | null
          ai_suggested_schema: Json | null
          ai_suggested_short_description: string | null
          ai_suggested_title: string | null
          applied_at: string | null
          created_at: string
          current_h1: string | null
          current_meta_description: string | null
          current_title: string | null
          external_id: string | null
          external_platform: string | null
          id: string
          is_active: boolean
          last_audited_at: string | null
          last_findings: Json | null
          last_pagespeed: Json | null
          last_score: number | null
          last_search_console: Json | null
          page_type: string
          shop_id: string
          updated_at: string
          url: string
          word_count: number | null
        }
        Insert: {
          ai_suggested_at?: string | null
          ai_suggested_meta_description?: string | null
          ai_suggested_schema?: Json | null
          ai_suggested_short_description?: string | null
          ai_suggested_title?: string | null
          applied_at?: string | null
          created_at?: string
          current_h1?: string | null
          current_meta_description?: string | null
          current_title?: string | null
          external_id?: string | null
          external_platform?: string | null
          id?: string
          is_active?: boolean
          last_audited_at?: string | null
          last_findings?: Json | null
          last_pagespeed?: Json | null
          last_score?: number | null
          last_search_console?: Json | null
          page_type?: string
          shop_id: string
          updated_at?: string
          url: string
          word_count?: number | null
        }
        Update: {
          ai_suggested_at?: string | null
          ai_suggested_meta_description?: string | null
          ai_suggested_schema?: Json | null
          ai_suggested_short_description?: string | null
          ai_suggested_title?: string | null
          applied_at?: string | null
          created_at?: string
          current_h1?: string | null
          current_meta_description?: string | null
          current_title?: string | null
          external_id?: string | null
          external_platform?: string | null
          id?: string
          is_active?: boolean
          last_audited_at?: string | null
          last_findings?: Json | null
          last_pagespeed?: Json | null
          last_score?: number | null
          last_search_console?: Json | null
          page_type?: string
          shop_id?: string
          updated_at?: string
          url?: string
          word_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "seo_pages_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      sequence_enrollments: {
        Row: {
          current_step: number
          id: string
          last_advanced_at: string | null
          sequence_id: string
          shop_id: string
          source_tag: string | null
          started_at: string
          status: string
          subject_id: string
          subject_type: string
        }
        Insert: {
          current_step?: number
          id?: string
          last_advanced_at?: string | null
          sequence_id: string
          shop_id: string
          source_tag?: string | null
          started_at?: string
          status?: string
          subject_id: string
          subject_type: string
        }
        Update: {
          current_step?: number
          id?: string
          last_advanced_at?: string | null
          sequence_id?: string
          shop_id?: string
          source_tag?: string | null
          started_at?: string
          status?: string
          subject_id?: string
          subject_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "sequence_enrollments_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      sequence_steps: {
        Row: {
          delay_days: number
          id: string
          sequence_id: string
          step_order: number
          subject_override: string | null
          template_slug: string
        }
        Insert: {
          delay_days?: number
          id?: string
          sequence_id: string
          step_order: number
          subject_override?: string | null
          template_slug: string
        }
        Update: {
          delay_days?: number
          id?: string
          sequence_id?: string
          step_order?: number
          subject_override?: string | null
          template_slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "sequence_steps_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      sequences: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          lifecycle_stage: string
          name: string
          parent_sequence_id: string | null
          service: string
          shop_id: string | null
          system_type: string
          triggers_on_tag: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          lifecycle_stage: string
          name: string
          parent_sequence_id?: string | null
          service: string
          shop_id?: string | null
          system_type: string
          triggers_on_tag: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          lifecycle_stage?: string
          name?: string
          parent_sequence_id?: string | null
          service?: string
          shop_id?: string | null
          system_type?: string
          triggers_on_tag?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sequences_parent_sequence_id_fkey"
            columns: ["parent_sequence_id"]
            isOneToOne: false
            referencedRelation: "sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      service_catalog: {
        Row: {
          base_price: number
          created_at: string | null
          description: string | null
          duration_minutes: number
          id: string
          is_active: boolean
          name: string
          shop_id: string
          slug: string
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          base_price?: number
          created_at?: string | null
          description?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean
          name: string
          shop_id: string
          slug: string
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          base_price?: number
          created_at?: string | null
          description?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean
          name?: string
          shop_id?: string
          slug?: string
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_catalog_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_availability: {
        Row: {
          created_at: string | null
          day_of_week: number
          end_time: string
          id: string
          is_active: boolean
          shop_id: string
          start_time: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          day_of_week: number
          end_time: string
          id?: string
          is_active?: boolean
          shop_id: string
          start_time: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          day_of_week?: number
          end_time?: string
          id?: string
          is_active?: boolean
          shop_id?: string
          start_time?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shop_availability_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_members: {
        Row: {
          accepted_at: string | null
          created_at: string
          id: string
          invited_at: string | null
          invited_by: string | null
          role: Database["public"]["Enums"]["shop_member_role"]
          shop_id: string
          user_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          role?: Database["public"]["Enums"]["shop_member_role"]
          shop_id: string
          user_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          role?: Database["public"]["Enums"]["shop_member_role"]
          shop_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_members_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_pricing: {
        Row: {
          created_at: string | null
          film_cost_per_sqft: number
          finish: string
          id: string
          labor_rate_per_sqft: number
          manufacturer: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          film_cost_per_sqft?: number
          finish: string
          id?: string
          labor_rate_per_sqft?: number
          manufacturer: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          film_cost_per_sqft?: number
          finish?: string
          id?: string
          labor_rate_per_sqft?: number
          manufacturer?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      shop_pricing_config: {
        Row: {
          created_at: string | null
          default_markup_percentage: number | null
          id: string
          minimum_order_price: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          default_markup_percentage?: number | null
          id?: string
          minimum_order_price?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          default_markup_percentage?: number | null
          id?: string
          minimum_order_price?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      shop_products: {
        Row: {
          category: string | null
          cost: number | null
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          is_quotable: boolean | null
          logo_url: string | null
          metadata: Json | null
          name: string
          price: number
          price_unit: string | null
          shop_id: string | null
          sku: string | null
          sort_order: number | null
          updated_at: string | null
          user_id: string | null
          woo_product_id: number | null
          woo_product_url: string | null
        }
        Insert: {
          category?: string | null
          cost?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_quotable?: boolean | null
          logo_url?: string | null
          metadata?: Json | null
          name: string
          price?: number
          price_unit?: string | null
          shop_id?: string | null
          sku?: string | null
          sort_order?: number | null
          updated_at?: string | null
          user_id?: string | null
          woo_product_id?: number | null
          woo_product_url?: string | null
        }
        Update: {
          category?: string | null
          cost?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_quotable?: boolean | null
          logo_url?: string | null
          metadata?: Json | null
          name?: string
          price?: number
          price_unit?: string | null
          shop_id?: string | null
          sku?: string | null
          sort_order?: number | null
          updated_at?: string | null
          user_id?: string | null
          woo_product_id?: number | null
          woo_product_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shop_products_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shop_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_profiles: {
        Row: {
          address: string | null
          created_at: string | null
          custom_terms_text: string | null
          default_include_disclaimer: boolean | null
          email: string | null
          id: string
          is_test: boolean
          notification_emails: string[]
          onboarding_completed: boolean | null
          owner_name: string | null
          phone: string | null
          shop_logo_url: string | null
          shop_name: string | null
          shop_voice: string | null
          sms_opt_in: boolean
          stripe_account_id: string | null
          stripe_account_status: string | null
          stripe_charges_enabled: boolean | null
          stripe_connected_at: string | null
          stripe_details_submitted: boolean | null
          stripe_payouts_enabled: boolean | null
          updated_at: string | null
          user_id: string
          website: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string | null
          custom_terms_text?: string | null
          default_include_disclaimer?: boolean | null
          email?: string | null
          id?: string
          is_test?: boolean
          notification_emails?: string[]
          onboarding_completed?: boolean | null
          owner_name?: string | null
          phone?: string | null
          shop_logo_url?: string | null
          shop_name?: string | null
          shop_voice?: string | null
          sms_opt_in?: boolean
          stripe_account_id?: string | null
          stripe_account_status?: string | null
          stripe_charges_enabled?: boolean | null
          stripe_connected_at?: string | null
          stripe_details_submitted?: boolean | null
          stripe_payouts_enabled?: boolean | null
          updated_at?: string | null
          user_id: string
          website?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string | null
          custom_terms_text?: string | null
          default_include_disclaimer?: boolean | null
          email?: string | null
          id?: string
          is_test?: boolean
          notification_emails?: string[]
          onboarding_completed?: boolean | null
          owner_name?: string | null
          phone?: string | null
          shop_logo_url?: string | null
          shop_name?: string | null
          shop_voice?: string | null
          sms_opt_in?: boolean
          stripe_account_id?: string | null
          stripe_account_status?: string | null
          stripe_charges_enabled?: boolean | null
          stripe_connected_at?: string | null
          stripe_details_submitted?: boolean | null
          stripe_payouts_enabled?: boolean | null
          updated_at?: string | null
          user_id?: string
          website?: string | null
        }
        Relationships: []
      }
      shop_quote_pricing: {
        Row: {
          add_on_prices: Json | null
          created_at: string | null
          default_margin_percent: number | null
          default_region: string | null
          film_prices: Json | null
          id: string
          labor_rates: Json | null
          print_prices: Json | null
          shop_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          add_on_prices?: Json | null
          created_at?: string | null
          default_margin_percent?: number | null
          default_region?: string | null
          film_prices?: Json | null
          id?: string
          labor_rates?: Json | null
          print_prices?: Json | null
          shop_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          add_on_prices?: Json | null
          created_at?: string | null
          default_margin_percent?: number | null
          default_region?: string | null
          film_prices?: Json | null
          id?: string
          labor_rates?: Json | null
          print_prices?: Json | null
          shop_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shop_quote_pricing_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: true
            referencedRelation: "shop_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_sequence_settings: {
        Row: {
          is_enabled: boolean
          sequence_id: string
          shop_id: string
          updated_at: string
        }
        Insert: {
          is_enabled?: boolean
          sequence_id: string
          shop_id: string
          updated_at?: string
        }
        Update: {
          is_enabled?: boolean
          sequence_id?: string
          shop_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_sequence_settings_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_service_prices: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          label: string
          service_key: string
          shop_id: string
          unit: string
          unit_price: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          label: string
          service_key: string
          shop_id: string
          unit: string
          unit_price: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          service_key?: string
          shop_id?: string
          unit?: string
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_service_prices_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_settings: {
        Row: {
          created_at: string | null
          id: string
          shop_logo_url: string | null
          shop_name: string | null
          tone_style: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          shop_logo_url?: string | null
          shop_name?: string | null
          tone_style?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          shop_logo_url?: string | null
          shop_name?: string | null
          tone_style?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      shop_tags: {
        Row: {
          applied_at: string
          applied_by: string | null
          id: string
          shop_id: string
          source_event: string | null
          source_ref: string | null
          tag: string
        }
        Insert: {
          applied_at?: string
          applied_by?: string | null
          id?: string
          shop_id: string
          source_event?: string | null
          source_ref?: string | null
          tag: string
        }
        Update: {
          applied_at?: string
          applied_by?: string | null
          id?: string
          shop_id?: string
          source_event?: string | null
          source_ref?: string | null
          tag?: string
        }
        Relationships: []
      }
      shop_twilio_subaccounts: {
        Row: {
          a2p_brand_sid: string | null
          a2p_brand_status: string | null
          created_at: string | null
          forwarding_phone: string | null
          friendly_name: string | null
          id: string
          is_active: boolean | null
          phone_number: string
          phone_number_sid: string
          shop_id: string
          sms_webhook_url: string | null
          subaccount_sid: string
          updated_at: string | null
          voice_agent_enabled: boolean | null
          voice_webhook_url: string | null
        }
        Insert: {
          a2p_brand_sid?: string | null
          a2p_brand_status?: string | null
          created_at?: string | null
          forwarding_phone?: string | null
          friendly_name?: string | null
          id?: string
          is_active?: boolean | null
          phone_number: string
          phone_number_sid: string
          shop_id: string
          sms_webhook_url?: string | null
          subaccount_sid: string
          updated_at?: string | null
          voice_agent_enabled?: boolean | null
          voice_webhook_url?: string | null
        }
        Update: {
          a2p_brand_sid?: string | null
          a2p_brand_status?: string | null
          created_at?: string | null
          forwarding_phone?: string | null
          friendly_name?: string | null
          id?: string
          is_active?: boolean | null
          phone_number?: string
          phone_number_sid?: string
          shop_id?: string
          sms_webhook_url?: string | null
          subaccount_sid?: string
          updated_at?: string | null
          voice_agent_enabled?: boolean | null
          voice_webhook_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shop_twilio_subaccounts_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: true
            referencedRelation: "shop_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shopflow_jobs: {
        Row: {
          callback_sent_at: string | null
          callback_url: string | null
          created_at: string
          email: string
          error: string | null
          file_url: string
          id: string
          notes: string | null
          output_urls: Json | null
          paid_at: string | null
          price_cents: number
          service: string
          source: string
          status: string
          stripe_session_id: string | null
          updated_at: string
          vehicle: string | null
        }
        Insert: {
          callback_sent_at?: string | null
          callback_url?: string | null
          created_at?: string
          email: string
          error?: string | null
          file_url: string
          id?: string
          notes?: string | null
          output_urls?: Json | null
          paid_at?: string | null
          price_cents: number
          service: string
          source?: string
          status?: string
          stripe_session_id?: string | null
          updated_at?: string
          vehicle?: string | null
        }
        Update: {
          callback_sent_at?: string | null
          callback_url?: string | null
          created_at?: string
          email?: string
          error?: string | null
          file_url?: string
          id?: string
          notes?: string | null
          output_urls?: Json | null
          paid_at?: string | null
          price_cents?: number
          service?: string
          source?: string
          status?: string
          stripe_session_id?: string | null
          updated_at?: string
          vehicle?: string | null
        }
        Relationships: []
      }
      shops: {
        Row: {
          created_at: string
          default_include_disclaimer: boolean
          franchise_id: string | null
          id: string
          logo_eps_url: string | null
          logo_source: string | null
          logo_svg_url: string | null
          logo_url: string | null
          logopro_project_id: string | null
          name: string
          owner_user_id: string
          phone: string | null
          seat_limit: number
          slug: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          created_at?: string
          default_include_disclaimer?: boolean
          franchise_id?: string | null
          id?: string
          logo_eps_url?: string | null
          logo_source?: string | null
          logo_svg_url?: string | null
          logo_url?: string | null
          logopro_project_id?: string | null
          name: string
          owner_user_id: string
          phone?: string | null
          seat_limit?: number
          slug?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          created_at?: string
          default_include_disclaimer?: boolean
          franchise_id?: string | null
          id?: string
          logo_eps_url?: string | null
          logo_source?: string | null
          logo_svg_url?: string | null
          logo_url?: string | null
          logopro_project_id?: string | null
          name?: string
          owner_user_id?: string
          phone?: string | null
          seat_limit?: number
          slug?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shops_franchise_id_fkey"
            columns: ["franchise_id"]
            isOneToOne: false
            referencedRelation: "franchises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shops_logopro_project_id_fkey"
            columns: ["logopro_project_id"]
            isOneToOne: false
            referencedRelation: "logopro_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      slack_agent_conversations: {
        Row: {
          channel_id: string
          created_at: string
          id: string
          messages: Json
          thread_key: string
          thread_ts: string | null
          updated_at: string
        }
        Insert: {
          channel_id: string
          created_at?: string
          id?: string
          messages?: Json
          thread_key: string
          thread_ts?: string | null
          updated_at?: string
        }
        Update: {
          channel_id?: string
          created_at?: string
          id?: string
          messages?: Json
          thread_key?: string
          thread_ts?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      slack_agent_processed_events: {
        Row: {
          event_id: string
          processed_at: string
        }
        Insert: {
          event_id: string
          processed_at?: string
        }
        Update: {
          event_id?: string
          processed_at?: string
        }
        Relationships: []
      }
      slack_agent_tasks: {
        Row: {
          assigned_to: string | null
          brand: string
          category: string | null
          channel_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          id: string
          metadata: Json | null
          priority: string
          status: string
          task_type: string
          thread_ts: string | null
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          brand?: string
          category?: string | null
          channel_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          metadata?: Json | null
          priority?: string
          status?: string
          task_type: string
          thread_ts?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          brand?: string
          category?: string | null
          channel_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          metadata?: Json | null
          priority?: string
          status?: string
          task_type?: string
          thread_ts?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      social_templates: {
        Row: {
          aesthetic: string
          background_color: string
          brand: string
          canvas_state: Json
          created_at: string
          created_by: string | null
          description: string | null
          format: string
          height: number
          hook_type: string
          id: string
          is_active: boolean
          is_seed: boolean
          name: string
          series_parent_id: string | null
          slide_index: number | null
          slot_count: number
          thumbnail_url: string | null
          tools: string[]
          updated_at: string
          width: number
        }
        Insert: {
          aesthetic?: string
          background_color?: string
          brand?: string
          canvas_state: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          format: string
          height: number
          hook_type?: string
          id?: string
          is_active?: boolean
          is_seed?: boolean
          name: string
          series_parent_id?: string | null
          slide_index?: number | null
          slot_count?: number
          thumbnail_url?: string | null
          tools?: string[]
          updated_at?: string
          width: number
        }
        Update: {
          aesthetic?: string
          background_color?: string
          brand?: string
          canvas_state?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          format?: string
          height?: number
          hook_type?: string
          id?: string
          is_active?: boolean
          is_seed?: boolean
          name?: string
          series_parent_id?: string | null
          slide_index?: number | null
          slot_count?: number
          thumbnail_url?: string | null
          tools?: string[]
          updated_at?: string
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "social_templates_series_parent_id_fkey"
            columns: ["series_parent_id"]
            isOneToOne: false
            referencedRelation: "social_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      support_escalations: {
        Row: {
          assigned_to_user_id: string | null
          created_at: string
          escalated_by_role: string
          escalated_by_user_id: string | null
          id: string
          proof_id: string
          reason: string | null
          resolution_notes: string | null
          resolved_at: string | null
          slack_channel: string | null
          slack_message_ts: string | null
          slack_permalink: string | null
          snapshot: Json
          status: string
          updated_at: string
        }
        Insert: {
          assigned_to_user_id?: string | null
          created_at?: string
          escalated_by_role: string
          escalated_by_user_id?: string | null
          id?: string
          proof_id: string
          reason?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          slack_channel?: string | null
          slack_message_ts?: string | null
          slack_permalink?: string | null
          snapshot?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_to_user_id?: string | null
          created_at?: string
          escalated_by_role?: string
          escalated_by_user_id?: string | null
          id?: string
          proof_id?: string
          reason?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          slack_channel?: string | null
          slack_message_ts?: string | null
          slack_permalink?: string | null
          snapshot?: Json
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_escalations_proof_id_fkey"
            columns: ["proof_id"]
            isOneToOne: false
            referencedRelation: "proof_approvals"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          created_at: string | null
          email: string
          id: string
          organization_id: string
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          organization_id: string
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          organization_id?: string
        }
        Relationships: []
      }
      tenant_site_connections: {
        Row: {
          config: Json | null
          created_at: string
          display_name: string | null
          id: string
          is_active: boolean | null
          last_error: string | null
          last_synced_at: string | null
          metadata: Json | null
          platform: string
          shop_id: string
          site_url: string | null
          updated_at: string
        }
        Insert: {
          config?: Json | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_active?: boolean | null
          last_error?: string | null
          last_synced_at?: string | null
          metadata?: Json | null
          platform?: string
          shop_id: string
          site_url?: string | null
          updated_at?: string
        }
        Update: {
          config?: Json | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_active?: boolean | null
          last_error?: string | null
          last_synced_at?: string | null
          metadata?: Json | null
          platform?: string
          shop_id?: string
          site_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      token_transactions: {
        Row: {
          action_id: string | null
          amount: number
          balance_after: number
          created_at: string | null
          expires_at: string | null
          id: string
          reason: string | null
          user_id: string
        }
        Insert: {
          action_id?: string | null
          amount: number
          balance_after: number
          created_at?: string | null
          expires_at?: string | null
          id?: string
          reason?: string | null
          user_id: string
        }
        Update: {
          action_id?: string | null
          amount?: number
          balance_after?: number
          created_at?: string | null
          expires_at?: string | null
          id?: string
          reason?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "token_transactions_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "production_actions"
            referencedColumns: ["id"]
          },
        ]
      }
      tool_access_tiers: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          required_tier: string
          tool_name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          required_tier: string
          tool_name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          required_tier?: string
          tool_name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_subscriptions: {
        Row: {
          alacarte_renders_remaining: number
          billing_cycle_end: string
          billing_cycle_start: string
          created_at: string | null
          email: string
          id: string
          metadata: Json | null
          render_count: number | null
          render_reset_date: string | null
          status: string
          stripe_customer_id: string | null
          stripe_price_id: string | null
          stripe_subscription_id: string | null
          stripe_subscription_item_extra: string | null
          tier: string
          updated_at: string | null
          user_id: string
          woo_customer_id: number | null
        }
        Insert: {
          alacarte_renders_remaining?: number
          billing_cycle_end?: string
          billing_cycle_start?: string
          created_at?: string | null
          email: string
          id?: string
          metadata?: Json | null
          render_count?: number | null
          render_reset_date?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          stripe_subscription_item_extra?: string | null
          tier: string
          updated_at?: string | null
          user_id: string
          woo_customer_id?: number | null
        }
        Update: {
          alacarte_renders_remaining?: number
          billing_cycle_end?: string
          billing_cycle_start?: string
          created_at?: string | null
          email?: string
          id?: string
          metadata?: Json | null
          render_count?: number | null
          render_reset_date?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          stripe_subscription_item_extra?: string | null
          tier?: string
          updated_at?: string | null
          user_id?: string
          woo_customer_id?: number | null
        }
        Relationships: []
      }
      user_tokens: {
        Row: {
          balance: number
          total_purchased: number
          total_used: number
          unlimited_revisions: boolean
          updated_at: string | null
          user_id: string
        }
        Insert: {
          balance?: number
          total_purchased?: number
          total_used?: number
          unlimited_revisions?: boolean
          updated_at?: string | null
          user_id: string
        }
        Update: {
          balance?: number
          total_purchased?: number
          total_used?: number
          unlimited_revisions?: boolean
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      vehicle_dimensions: {
        Row: {
          back_height: number | null
          back_sqft: number | null
          back_width: number | null
          corrected_sqft: number | null
          created_at: string | null
          hood_length: number | null
          hood_sqft: number | null
          hood_width: number | null
          id: string
          make: string
          model: string
          overall_length: number | null
          recommended_size: string | null
          roof_length: number | null
          roof_sqft: number | null
          roof_width: number | null
          side_height: number | null
          side_sqft: number | null
          side_width: number | null
          total_sqft: number | null
          year_end: number | null
          year_range: string | null
          year_start: number | null
        }
        Insert: {
          back_height?: number | null
          back_sqft?: number | null
          back_width?: number | null
          corrected_sqft?: number | null
          created_at?: string | null
          hood_length?: number | null
          hood_sqft?: number | null
          hood_width?: number | null
          id?: string
          make: string
          model: string
          overall_length?: number | null
          recommended_size?: string | null
          roof_length?: number | null
          roof_sqft?: number | null
          roof_width?: number | null
          side_height?: number | null
          side_sqft?: number | null
          side_width?: number | null
          total_sqft?: number | null
          year_end?: number | null
          year_range?: string | null
          year_start?: number | null
        }
        Update: {
          back_height?: number | null
          back_sqft?: number | null
          back_width?: number | null
          corrected_sqft?: number | null
          created_at?: string | null
          hood_length?: number | null
          hood_sqft?: number | null
          hood_width?: number | null
          id?: string
          make?: string
          model?: string
          overall_length?: number | null
          recommended_size?: string | null
          roof_length?: number | null
          roof_sqft?: number | null
          roof_width?: number | null
          side_height?: number | null
          side_sqft?: number | null
          side_width?: number | null
          total_sqft?: number | null
          year_end?: number | null
          year_range?: string | null
          year_start?: number | null
        }
        Relationships: []
      }
      vehicle_measurements_custom: {
        Row: {
          back_h: number | null
          back_sq_ft: number | null
          back_w: number | null
          corr_sq_ft: number
          created_at: string | null
          hood_l: number | null
          hood_sq_ft: number | null
          hood_w: number | null
          id: string
          make: string
          model: string
          overall_height_in: number | null
          overall_length_in: number | null
          overall_width_in: number | null
          raw_response: Json | null
          roof_l: number | null
          roof_sq_ft: number | null
          roof_w: number | null
          side_h: number | null
          side_sq_ft: number | null
          side_w: number | null
          source: string
          total_sq_ft: number
          updated_at: string | null
          wheelbase_in: number | null
          year: string
        }
        Insert: {
          back_h?: number | null
          back_sq_ft?: number | null
          back_w?: number | null
          corr_sq_ft: number
          created_at?: string | null
          hood_l?: number | null
          hood_sq_ft?: number | null
          hood_w?: number | null
          id?: string
          make: string
          model: string
          overall_height_in?: number | null
          overall_length_in?: number | null
          overall_width_in?: number | null
          raw_response?: Json | null
          roof_l?: number | null
          roof_sq_ft?: number | null
          roof_w?: number | null
          side_h?: number | null
          side_sq_ft?: number | null
          side_w?: number | null
          source?: string
          total_sq_ft: number
          updated_at?: string | null
          wheelbase_in?: number | null
          year?: string
        }
        Update: {
          back_h?: number | null
          back_sq_ft?: number | null
          back_w?: number | null
          corr_sq_ft?: number
          created_at?: string | null
          hood_l?: number | null
          hood_sq_ft?: number | null
          hood_w?: number | null
          id?: string
          make?: string
          model?: string
          overall_height_in?: number | null
          overall_length_in?: number | null
          overall_width_in?: number | null
          raw_response?: Json | null
          roof_l?: number | null
          roof_sq_ft?: number | null
          roof_w?: number | null
          side_h?: number | null
          side_sq_ft?: number | null
          side_w?: number | null
          source?: string
          total_sq_ft?: number
          updated_at?: string | null
          wheelbase_in?: number | null
          year?: string
        }
        Relationships: []
      }
      vehicle_render_images: {
        Row: {
          created_at: string | null
          id: string
          image_url: string
          is_active: boolean | null
          product_type: string
          swatch_id: string
          updated_at: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_type: string
          vehicle_year: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          image_url: string
          is_active?: boolean | null
          product_type: string
          swatch_id: string
          updated_at?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_type: string
          vehicle_year?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          image_url?: string
          is_active?: boolean | null
          product_type?: string
          swatch_id?: string
          updated_at?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_type?: string
          vehicle_year?: string | null
        }
        Relationships: []
      }
      vehicle_renders: {
        Row: {
          color_data: Json
          created_at: string | null
          id: string
          is_canonical_demo: boolean | null
          mode_type: string
          quality_verified: boolean | null
          reference_count: number | null
          render_url: string
          updated_at: string | null
          vehicle_make: string
          vehicle_model: string
          vehicle_year: string
        }
        Insert: {
          color_data: Json
          created_at?: string | null
          id?: string
          is_canonical_demo?: boolean | null
          mode_type: string
          quality_verified?: boolean | null
          reference_count?: number | null
          render_url: string
          updated_at?: string | null
          vehicle_make: string
          vehicle_model: string
          vehicle_year: string
        }
        Update: {
          color_data?: Json
          created_at?: string | null
          id?: string
          is_canonical_demo?: boolean | null
          mode_type?: string
          quality_verified?: boolean | null
          reference_count?: number | null
          render_url?: string
          updated_at?: string | null
          vehicle_make?: string
          vehicle_model?: string
          vehicle_year?: string
        }
        Relationships: []
      }
      vehicle_specs_cache: {
        Row: {
          back_h: number | null
          back_w: number | null
          created_at: string | null
          hood_l: number | null
          hood_w: number | null
          id: string
          make: string
          model: string
          roof_l: number | null
          roof_w: number | null
          side_h: number | null
          side_w: number | null
          source: string | null
          total_sqft: number | null
          wheelbase_inches: number | null
          year_range: string
        }
        Insert: {
          back_h?: number | null
          back_w?: number | null
          created_at?: string | null
          hood_l?: number | null
          hood_w?: number | null
          id?: string
          make: string
          model: string
          roof_l?: number | null
          roof_w?: number | null
          side_h?: number | null
          side_w?: number | null
          source?: string | null
          total_sqft?: number | null
          wheelbase_inches?: number | null
          year_range: string
        }
        Update: {
          back_h?: number | null
          back_w?: number | null
          created_at?: string | null
          hood_l?: number | null
          hood_w?: number | null
          id?: string
          make?: string
          model?: string
          roof_l?: number | null
          roof_w?: number | null
          side_h?: number | null
          side_w?: number | null
          source?: string | null
          total_sqft?: number | null
          wheelbase_inches?: number | null
          year_range?: string
        }
        Relationships: []
      }
      vehicle_specs_universal: {
        Row: {
          confidence: string
          created_at: string
          id: string
          make: string
          model: string
          overall_height_in: number | null
          overall_length_in: number | null
          overall_width_in: number | null
          panels: Json | null
          raw_response: Json | null
          requires_validation: boolean
          source: string
          source_urls: string[] | null
          sub_type: string | null
          updated_at: string
          validated_at: string | null
          validated_by: string | null
          validation_notes: string | null
          vehicle_class: string
          wheelbase_in: number | null
          year: string | null
        }
        Insert: {
          confidence?: string
          created_at?: string
          id?: string
          make: string
          model: string
          overall_height_in?: number | null
          overall_length_in?: number | null
          overall_width_in?: number | null
          panels?: Json | null
          raw_response?: Json | null
          requires_validation?: boolean
          source?: string
          source_urls?: string[] | null
          sub_type?: string | null
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
          validation_notes?: string | null
          vehicle_class: string
          wheelbase_in?: number | null
          year?: string | null
        }
        Update: {
          confidence?: string
          created_at?: string
          id?: string
          make?: string
          model?: string
          overall_height_in?: number | null
          overall_length_in?: number | null
          overall_width_in?: number | null
          panels?: Json | null
          raw_response?: Json | null
          requires_validation?: boolean
          source?: string
          source_urls?: string[] | null
          sub_type?: string | null
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
          validation_notes?: string | null
          vehicle_class?: string
          wheelbase_in?: number | null
          year?: string | null
        }
        Relationships: []
      }
      vehicle_wrap_templates: {
        Row: {
          bbox_x1: number | null
          bbox_x2: number | null
          bbox_y1: number | null
          bbox_y2: number | null
          created_at: string | null
          file_size_bytes: number | null
          file_url: string
          height_inches: number | null
          id: string
          notes: string | null
          original_filename: string | null
          panel_type: string
          storage_path: string
          template_format: string
          updated_at: string | null
          uploaded_by: string | null
          vehicle_make: string
          vehicle_model: string
          vehicle_year_range: string | null
          width_inches: number | null
        }
        Insert: {
          bbox_x1?: number | null
          bbox_x2?: number | null
          bbox_y1?: number | null
          bbox_y2?: number | null
          created_at?: string | null
          file_size_bytes?: number | null
          file_url: string
          height_inches?: number | null
          id?: string
          notes?: string | null
          original_filename?: string | null
          panel_type?: string
          storage_path: string
          template_format?: string
          updated_at?: string | null
          uploaded_by?: string | null
          vehicle_make: string
          vehicle_model: string
          vehicle_year_range?: string | null
          width_inches?: number | null
        }
        Update: {
          bbox_x1?: number | null
          bbox_x2?: number | null
          bbox_y1?: number | null
          bbox_y2?: number | null
          created_at?: string | null
          file_size_bytes?: number | null
          file_url?: string
          height_inches?: number | null
          id?: string
          notes?: string | null
          original_filename?: string | null
          panel_type?: string
          storage_path?: string
          template_format?: string
          updated_at?: string | null
          uploaded_by?: string | null
          vehicle_make?: string
          vehicle_model?: string
          vehicle_year_range?: string | null
          width_inches?: number | null
        }
        Relationships: []
      }
      video_music_library: {
        Row: {
          bpm: number | null
          created_at: string
          duration_seconds: number | null
          energy: string | null
          genre: string | null
          id: string
          mood: string | null
          storage_url: string
          title: string | null
        }
        Insert: {
          bpm?: number | null
          created_at?: string
          duration_seconds?: number | null
          energy?: string | null
          genre?: string | null
          id?: string
          mood?: string | null
          storage_url: string
          title?: string | null
        }
        Update: {
          bpm?: number | null
          created_at?: string
          duration_seconds?: number | null
          energy?: string | null
          genre?: string | null
          id?: string
          mood?: string | null
          storage_url?: string
          title?: string | null
        }
        Relationships: []
      }
      video_parse_jobs: {
        Row: {
          attempts: number
          chunks: number | null
          claimed_at: string | null
          created_at: string
          created_by: string
          duration_seconds: number | null
          error: string | null
          filename: string | null
          id: string
          kind: string
          media_url: string
          parent_job_id: string | null
          segments: number | null
          status: string
          tags: string[]
          updated_at: string
          video_hydrated: boolean | null
        }
        Insert: {
          attempts?: number
          chunks?: number | null
          claimed_at?: string | null
          created_at?: string
          created_by?: string
          duration_seconds?: number | null
          error?: string | null
          filename?: string | null
          id?: string
          kind?: string
          media_url: string
          parent_job_id?: string | null
          segments?: number | null
          status?: string
          tags?: string[]
          updated_at?: string
          video_hydrated?: boolean | null
        }
        Update: {
          attempts?: number
          chunks?: number | null
          claimed_at?: string | null
          created_at?: string
          created_by?: string
          duration_seconds?: number | null
          error?: string | null
          filename?: string | null
          id?: string
          kind?: string
          media_url?: string
          parent_job_id?: string | null
          segments?: number | null
          status?: string
          tags?: string[]
          updated_at?: string
          video_hydrated?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "video_parse_jobs_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "video_parse_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      video_render_jobs: {
        Row: {
          attempts: number
          blueprint: Json
          brand: string
          bucket: string
          captions: Json
          claimed_at: string | null
          created_at: string
          error: string | null
          final_url: string | null
          id: string
          music_url: string | null
          slide_urls: string[] | null
          source_ref: string | null
          status: string
          thumbnail_url: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          blueprint: Json
          brand?: string
          bucket?: string
          captions?: Json
          claimed_at?: string | null
          created_at?: string
          error?: string | null
          final_url?: string | null
          id?: string
          music_url?: string | null
          slide_urls?: string[] | null
          source_ref?: string | null
          status?: string
          thumbnail_url?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          blueprint?: Json
          brand?: string
          bucket?: string
          captions?: Json
          claimed_at?: string | null
          created_at?: string
          error?: string | null
          final_url?: string | null
          id?: string
          music_url?: string | null
          slide_urls?: string[] | null
          source_ref?: string | null
          status?: string
          thumbnail_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      vinyl_reference_images: {
        Row: {
          color_characteristics: Json | null
          color_name: string
          created_at: string | null
          id: string
          image_type: string | null
          image_url: string
          is_verified: boolean | null
          manufacturer: string
          product_code: string | null
          score: number | null
          search_query: string | null
          source_url: string | null
          swatch_id: string | null
          updated_at: string | null
          verified_at: string | null
        }
        Insert: {
          color_characteristics?: Json | null
          color_name: string
          created_at?: string | null
          id?: string
          image_type?: string | null
          image_url: string
          is_verified?: boolean | null
          manufacturer: string
          product_code?: string | null
          score?: number | null
          search_query?: string | null
          source_url?: string | null
          swatch_id?: string | null
          updated_at?: string | null
          verified_at?: string | null
        }
        Update: {
          color_characteristics?: Json | null
          color_name?: string
          created_at?: string | null
          id?: string
          image_type?: string | null
          image_url?: string
          is_verified?: boolean | null
          manufacturer?: string
          product_code?: string | null
          score?: number | null
          search_query?: string | null
          source_url?: string | null
          swatch_id?: string | null
          updated_at?: string | null
          verified_at?: string | null
        }
        Relationships: []
      }
      vinyl_swatch_search_cache: {
        Row: {
          created_at: string
          id: string
          results_json: Json
          search_query: string
          swatch_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          results_json: Json
          search_query: string
          swatch_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          results_json?: Json
          search_query?: string
          swatch_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vinyl_swatch_search_cache_swatch_id_fkey"
            columns: ["swatch_id"]
            isOneToOne: false
            referencedRelation: "vinyl_swatches"
            referencedColumns: ["id"]
          },
        ]
      }
      vinyl_swatches: {
        Row: {
          ai_confidence: number | null
          chrome: boolean | null
          code: string | null
          color_type: string | null
          created_at: string | null
          created_by: string | null
          finish: string
          finish_profile: Json | null
          flake_level: string | null
          has_reference_bundle: boolean | null
          hex: string
          id: string
          is_flip_film: boolean | null
          lab: Json | null
          last_verified_at: string | null
          manufacturer: string
          material_type: string | null
          material_validated: boolean | null
          media_type: string | null
          media_url: string | null
          metallic: boolean | null
          metallic_flake: number | null
          name: string
          needs_reference_review: boolean | null
          pearl: boolean | null
          popularity_score: number | null
          ppf: boolean | null
          reference_image_count: number | null
          reflectivity: number | null
          search_count: number | null
          series: string | null
          source: string | null
          updated_at: string | null
          verified: boolean | null
        }
        Insert: {
          ai_confidence?: number | null
          chrome?: boolean | null
          code?: string | null
          color_type?: string | null
          created_at?: string | null
          created_by?: string | null
          finish: string
          finish_profile?: Json | null
          flake_level?: string | null
          has_reference_bundle?: boolean | null
          hex: string
          id?: string
          is_flip_film?: boolean | null
          lab?: Json | null
          last_verified_at?: string | null
          manufacturer: string
          material_type?: string | null
          material_validated?: boolean | null
          media_type?: string | null
          media_url?: string | null
          metallic?: boolean | null
          metallic_flake?: number | null
          name: string
          needs_reference_review?: boolean | null
          pearl?: boolean | null
          popularity_score?: number | null
          ppf?: boolean | null
          reference_image_count?: number | null
          reflectivity?: number | null
          search_count?: number | null
          series?: string | null
          source?: string | null
          updated_at?: string | null
          verified?: boolean | null
        }
        Update: {
          ai_confidence?: number | null
          chrome?: boolean | null
          code?: string | null
          color_type?: string | null
          created_at?: string | null
          created_by?: string | null
          finish?: string
          finish_profile?: Json | null
          flake_level?: string | null
          has_reference_bundle?: boolean | null
          hex?: string
          id?: string
          is_flip_film?: boolean | null
          lab?: Json | null
          last_verified_at?: string | null
          manufacturer?: string
          material_type?: string | null
          material_validated?: boolean | null
          media_type?: string | null
          media_url?: string | null
          metallic?: boolean | null
          metallic_flake?: number | null
          name?: string
          needs_reference_review?: boolean | null
          pearl?: boolean | null
          popularity_score?: number | null
          ppf?: boolean | null
          reference_image_count?: number | null
          reflectivity?: number | null
          search_count?: number | null
          series?: string | null
          source?: string | null
          updated_at?: string | null
          verified?: boolean | null
        }
        Relationships: []
      }
      wallpro_designs: {
        Row: {
          batch_id: string | null
          category: string
          created_at: string | null
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean | null
          mode: string | null
          name: string
          prompt: string | null
          rating: number | null
          sort_order: number | null
          storage_path: string | null
          subcategory: string | null
          surface_type: string | null
          tags: string[] | null
          thumb_gradient: string | null
          thumbnail_url: string | null
          updated_at: string | null
        }
        Insert: {
          batch_id?: string | null
          category: string
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          mode?: string | null
          name: string
          prompt?: string | null
          rating?: number | null
          sort_order?: number | null
          storage_path?: string | null
          subcategory?: string | null
          surface_type?: string | null
          tags?: string[] | null
          thumb_gradient?: string | null
          thumbnail_url?: string | null
          updated_at?: string | null
        }
        Update: {
          batch_id?: string | null
          category?: string
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          mode?: string | null
          name?: string
          prompt?: string | null
          rating?: number | null
          sort_order?: number | null
          storage_path?: string | null
          subcategory?: string | null
          surface_type?: string | null
          tags?: string[] | null
          thumb_gradient?: string | null
          thumbnail_url?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      wbty_carousel: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          manufacturer: string | null
          media_url: string
          name: string
          sort_order: number | null
          subtitle: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          manufacturer?: string | null
          media_url: string
          name: string
          sort_order?: number | null
          subtitle?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          manufacturer?: string | null
          media_url?: string
          name?: string
          sort_order?: number | null
          subtitle?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      wbty_orders: {
        Row: {
          additional_views: Json | null
          created_at: string | null
          customer_email: string
          customer_name: string
          customer_phone: string | null
          finish: string | null
          fulfillment_emailed_at: string | null
          id: string
          margin_cents: number | null
          metadata: Json | null
          notes: string | null
          order_type: string
          pattern_category: string | null
          pattern_id: string | null
          pattern_media_url: string | null
          pattern_name: string
          render_url: string | null
          retail_price_cents: number
          shipped_at: string | null
          shipping_address: string | null
          status: string
          stripe_payment_intent_id: string | null
          stripe_payment_status: string | null
          stripe_session_id: string | null
          tracking_carrier: string | null
          tracking_number: string | null
          updated_at: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_size: string | null
          vehicle_year: string | null
          wholesale_cost_cents: number | null
          yards: number | null
        }
        Insert: {
          additional_views?: Json | null
          created_at?: string | null
          customer_email: string
          customer_name: string
          customer_phone?: string | null
          finish?: string | null
          fulfillment_emailed_at?: string | null
          id?: string
          margin_cents?: number | null
          metadata?: Json | null
          notes?: string | null
          order_type: string
          pattern_category?: string | null
          pattern_id?: string | null
          pattern_media_url?: string | null
          pattern_name: string
          render_url?: string | null
          retail_price_cents: number
          shipped_at?: string | null
          shipping_address?: string | null
          status?: string
          stripe_payment_intent_id?: string | null
          stripe_payment_status?: string | null
          stripe_session_id?: string | null
          tracking_carrier?: string | null
          tracking_number?: string | null
          updated_at?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_size?: string | null
          vehicle_year?: string | null
          wholesale_cost_cents?: number | null
          yards?: number | null
        }
        Update: {
          additional_views?: Json | null
          created_at?: string | null
          customer_email?: string
          customer_name?: string
          customer_phone?: string | null
          finish?: string | null
          fulfillment_emailed_at?: string | null
          id?: string
          margin_cents?: number | null
          metadata?: Json | null
          notes?: string | null
          order_type?: string
          pattern_category?: string | null
          pattern_id?: string | null
          pattern_media_url?: string | null
          pattern_name?: string
          render_url?: string | null
          retail_price_cents?: number
          shipped_at?: string | null
          shipping_address?: string | null
          status?: string
          stripe_payment_intent_id?: string | null
          stripe_payment_status?: string | null
          stripe_session_id?: string | null
          tracking_carrier?: string | null
          tracking_number?: string | null
          updated_at?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_size?: string | null
          vehicle_year?: string | null
          wholesale_cost_cents?: number | null
          yards?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "wbty_orders_pattern_id_fkey"
            columns: ["pattern_id"]
            isOneToOne: false
            referencedRelation: "wbty_products"
            referencedColumns: ["id"]
          },
        ]
      }
      wbty_products: {
        Row: {
          category: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          media_type: string
          media_url: string
          name: string
          price: number | null
          sort_order: number | null
          updated_at: string | null
          wholesale_price_per_yard: number | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          media_type: string
          media_url: string
          name: string
          price?: number | null
          sort_order?: number | null
          updated_at?: string | null
          wholesale_price_per_yard?: number | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          media_type?: string
          media_url?: string
          name?: string
          price?: number | null
          sort_order?: number | null
          updated_at?: string | null
          wholesale_price_per_yard?: number | null
        }
        Relationships: []
      }
      wbty_videos: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          media_url: string
          name: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          media_url: string
          name: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          media_url?: string
          name?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      workforce_events: {
        Row: {
          claimed_at: string | null
          created_at: string
          dedupe_key: string
          error: string | null
          event_type: string
          id: string
          output: Json | null
          payload: Json
          processed_at: string | null
          source: string
          status: string
        }
        Insert: {
          claimed_at?: string | null
          created_at?: string
          dedupe_key: string
          error?: string | null
          event_type: string
          id?: string
          output?: Json | null
          payload?: Json
          processed_at?: string | null
          source?: string
          status?: string
        }
        Update: {
          claimed_at?: string | null
          created_at?: string
          dedupe_key?: string
          error?: string | null
          event_type?: string
          id?: string
          output?: Json | null
          payload?: Json
          processed_at?: string | null
          source?: string
          status?: string
        }
        Relationships: []
      }
      workforce_learning: {
        Row: {
          agent: string | null
          change_kind: string
          created_at: string
          final: Json
          id: string
          item_type: string | null
          original: Json
          reason: string | null
          source_id: string
          source_table: string
        }
        Insert: {
          agent?: string | null
          change_kind: string
          created_at?: string
          final: Json
          id?: string
          item_type?: string | null
          original: Json
          reason?: string | null
          source_id: string
          source_table: string
        }
        Update: {
          agent?: string | null
          change_kind?: string
          created_at?: string
          final?: Json
          id?: string
          item_type?: string | null
          original?: Json
          reason?: string | null
          source_id?: string
          source_table?: string
        }
        Relationships: []
      }
      workforce_runs: {
        Row: {
          created_at: string
          dry_run: boolean
          error: string | null
          finished_at: string | null
          id: string
          mode: string
          results: Json
          sends_enabled: boolean
          started_at: string
        }
        Insert: {
          created_at?: string
          dry_run?: boolean
          error?: string | null
          finished_at?: string | null
          id?: string
          mode?: string
          results?: Json
          sends_enabled?: boolean
          started_at?: string
        }
        Update: {
          created_at?: string
          dry_run?: boolean
          error?: string | null
          finished_at?: string | null
          id?: string
          mode?: string
          results?: Json
          sends_enabled?: boolean
          started_at?: string
        }
        Relationships: []
      }
      wotw_winners: {
        Row: {
          blurb: string | null
          created_at: string
          handle: string
          id: string
          image_url: string
          is_active: boolean
          link_url: string | null
          sort_order: number
          updated_at: string
          vehicle: string | null
          week_label: string | null
        }
        Insert: {
          blurb?: string | null
          created_at?: string
          handle: string
          id?: string
          image_url: string
          is_active?: boolean
          link_url?: string | null
          sort_order?: number
          updated_at?: string
          vehicle?: string | null
          week_label?: string | null
        }
        Update: {
          blurb?: string | null
          created_at?: string
          handle?: string
          id?: string
          image_url?: string
          is_active?: boolean
          link_url?: string | null
          sort_order?: number
          updated_at?: string
          vehicle?: string | null
          week_label?: string | null
        }
        Relationships: []
      }
      wprewards_tiers: {
        Row: {
          ai_revisions_per_proof: number
          display_name: string
          monthly_proof_limit: number
          overage_price_usd: number
          priority_support: boolean
          sort_order: number
          tier_key: string
          white_label_enabled: boolean
        }
        Insert: {
          ai_revisions_per_proof?: number
          display_name: string
          monthly_proof_limit: number
          overage_price_usd?: number
          priority_support?: boolean
          sort_order?: number
          tier_key: string
          white_label_enabled?: boolean
        }
        Update: {
          ai_revisions_per_proof?: number
          display_name?: string
          monthly_proof_limit?: number
          overage_price_usd?: number
          priority_support?: boolean
          sort_order?: number
          tier_key?: string
          white_label_enabled?: boolean
        }
        Relationships: []
      }
      wpw_calculator_leads: {
        Row: {
          area_sqft: number | null
          conversation_id: string | null
          created_at: string
          email: string
          est_cost: number | null
          geo_city: string | null
          geo_country: string | null
          geo_country_code: string | null
          geo_lat: number | null
          geo_lng: number | null
          geo_region: string | null
          id: string
          ip_address: string | null
          linear_ft: number | null
          linear_yd: number | null
          material: string | null
          page_path: string | null
          quantity: number | null
          roll_width: number | null
          total_sqft: number | null
          user_agent: string | null
          vehicle: string | null
          waste_pct: number | null
        }
        Insert: {
          area_sqft?: number | null
          conversation_id?: string | null
          created_at?: string
          email: string
          est_cost?: number | null
          geo_city?: string | null
          geo_country?: string | null
          geo_country_code?: string | null
          geo_lat?: number | null
          geo_lng?: number | null
          geo_region?: string | null
          id?: string
          ip_address?: string | null
          linear_ft?: number | null
          linear_yd?: number | null
          material?: string | null
          page_path?: string | null
          quantity?: number | null
          roll_width?: number | null
          total_sqft?: number | null
          user_agent?: string | null
          vehicle?: string | null
          waste_pct?: number | null
        }
        Update: {
          area_sqft?: number | null
          conversation_id?: string | null
          created_at?: string
          email?: string
          est_cost?: number | null
          geo_city?: string | null
          geo_country?: string | null
          geo_country_code?: string | null
          geo_lat?: number | null
          geo_lng?: number | null
          geo_region?: string | null
          id?: string
          ip_address?: string | null
          linear_ft?: number | null
          linear_yd?: number | null
          material?: string | null
          page_path?: string | null
          quantity?: number | null
          roll_width?: number | null
          total_sqft?: number | null
          user_agent?: string | null
          vehicle?: string | null
          waste_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "wpw_calculator_leads_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "wpw_chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      wpw_chat_conversations: {
        Row: {
          assigned_at: string | null
          assigned_email: string | null
          attachments: Json
          callback_at: string | null
          callback_done: boolean
          callback_name: string | null
          callback_note: string | null
          callback_phone: string | null
          callback_requested: boolean
          created_at: string
          email: string | null
          first_message_at: string
          geo_city: string | null
          geo_country: string | null
          geo_country_code: string | null
          geo_lat: number | null
          geo_lng: number | null
          geo_org: string | null
          geo_region: string | null
          handoff_at: string | null
          handoff_reason: string | null
          id: string
          ip_address: string | null
          klaviyo_synced: boolean
          last_message_at: string
          last_priced: Json | null
          lead_captured: boolean
          message_count: number
          messages: Json
          page_path: string | null
          quote_event_logged: boolean
          referrer: string | null
          resolved_at: string | null
          resolved_by: string | null
          retarget_enrolled: boolean
          session_id: string
          status: string
          team_notified: boolean
          team_unread: boolean
          user_agent: string | null
        }
        Insert: {
          assigned_at?: string | null
          assigned_email?: string | null
          attachments?: Json
          callback_at?: string | null
          callback_done?: boolean
          callback_name?: string | null
          callback_note?: string | null
          callback_phone?: string | null
          callback_requested?: boolean
          created_at?: string
          email?: string | null
          first_message_at?: string
          geo_city?: string | null
          geo_country?: string | null
          geo_country_code?: string | null
          geo_lat?: number | null
          geo_lng?: number | null
          geo_org?: string | null
          geo_region?: string | null
          handoff_at?: string | null
          handoff_reason?: string | null
          id?: string
          ip_address?: string | null
          klaviyo_synced?: boolean
          last_message_at?: string
          last_priced?: Json | null
          lead_captured?: boolean
          message_count?: number
          messages?: Json
          page_path?: string | null
          quote_event_logged?: boolean
          referrer?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          retarget_enrolled?: boolean
          session_id: string
          status?: string
          team_notified?: boolean
          team_unread?: boolean
          user_agent?: string | null
        }
        Update: {
          assigned_at?: string | null
          assigned_email?: string | null
          attachments?: Json
          callback_at?: string | null
          callback_done?: boolean
          callback_name?: string | null
          callback_note?: string | null
          callback_phone?: string | null
          callback_requested?: boolean
          created_at?: string
          email?: string | null
          first_message_at?: string
          geo_city?: string | null
          geo_country?: string | null
          geo_country_code?: string | null
          geo_lat?: number | null
          geo_lng?: number | null
          geo_org?: string | null
          geo_region?: string | null
          handoff_at?: string | null
          handoff_reason?: string | null
          id?: string
          ip_address?: string | null
          klaviyo_synced?: boolean
          last_message_at?: string
          last_priced?: Json | null
          lead_captured?: boolean
          message_count?: number
          messages?: Json
          page_path?: string | null
          quote_event_logged?: boolean
          referrer?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          retarget_enrolled?: boolean
          session_id?: string
          status?: string
          team_notified?: boolean
          team_unread?: boolean
          user_agent?: string | null
        }
        Relationships: []
      }
      wpw_email_log: {
        Row: {
          conversation_id: string | null
          created_at: string
          id: string
          kind: string
          ok: boolean
          session_id: string | null
          subject: string | null
          to_email: string | null
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          id?: string
          kind: string
          ok?: boolean
          session_id?: string | null
          subject?: string | null
          to_email?: string | null
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          ok?: boolean
          session_id?: string | null
          subject?: string | null
          to_email?: string | null
        }
        Relationships: []
      }
      wpw_homepage_sliders: {
        Row: {
          affiliate_id: string | null
          created_at: string | null
          cta_label: string | null
          cta_url: string | null
          headline: string
          id: string
          image_alt: string | null
          image_url: string | null
          is_active: boolean | null
          media_kind: string
          name: string
          pack_eyebrow: string | null
          pack_sub: string | null
          pack_title: string | null
          pill_text: string | null
          slot: number
          sort_order: number | null
          sub_headline: string | null
          updated_at: string | null
          video_url: string | null
        }
        Insert: {
          affiliate_id?: string | null
          created_at?: string | null
          cta_label?: string | null
          cta_url?: string | null
          headline: string
          id?: string
          image_alt?: string | null
          image_url?: string | null
          is_active?: boolean | null
          media_kind?: string
          name: string
          pack_eyebrow?: string | null
          pack_sub?: string | null
          pack_title?: string | null
          pill_text?: string | null
          slot: number
          sort_order?: number | null
          sub_headline?: string | null
          updated_at?: string | null
          video_url?: string | null
        }
        Update: {
          affiliate_id?: string | null
          created_at?: string | null
          cta_label?: string | null
          cta_url?: string | null
          headline?: string
          id?: string
          image_alt?: string | null
          image_url?: string | null
          is_active?: boolean | null
          media_kind?: string
          name?: string
          pack_eyebrow?: string | null
          pack_sub?: string | null
          pack_title?: string | null
          pill_text?: string | null
          slot?: number
          sort_order?: number | null
          sub_headline?: string | null
          updated_at?: string | null
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wpw_homepage_sliders_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliate_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      wpw_link_otps: {
        Row: {
          alt_email: string
          attempts: number
          code_hash: string
          created_at: string
          expires_at: string
          id: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          alt_email: string
          attempts?: number
          code_hash: string
          created_at?: string
          expires_at: string
          id?: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          alt_email?: string
          attempts?: number
          code_hash?: string
          created_at?: string
          expires_at?: string
          id?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      wpw_order_items: {
        Row: {
          created_at: string
          id: number
          image_url: string | null
          meta: Json | null
          name: string | null
          order_id: number
          product_id: number | null
          quantity: number | null
          sku: string | null
          subtotal: number | null
          total: number | null
          variation_id: number | null
        }
        Insert: {
          created_at?: string
          id: number
          image_url?: string | null
          meta?: Json | null
          name?: string | null
          order_id: number
          product_id?: number | null
          quantity?: number | null
          sku?: string | null
          subtotal?: number | null
          total?: number | null
          variation_id?: number | null
        }
        Update: {
          created_at?: string
          id?: number
          image_url?: string | null
          meta?: Json | null
          name?: string | null
          order_id?: number
          product_id?: number | null
          quantity?: number | null
          sku?: string | null
          subtotal?: number | null
          total?: number | null
          variation_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "wpw_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "wpw_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      wpw_order_status_changes: {
        Row: {
          changed_by: string
          changed_by_email: string | null
          created_at: string
          from_status: string
          id: string
          order_id: number
          order_number: string | null
          preview: boolean
          to_status: string
          woo_error: string | null
          woo_response_status: number | null
        }
        Insert: {
          changed_by: string
          changed_by_email?: string | null
          created_at?: string
          from_status: string
          id?: string
          order_id: number
          order_number?: string | null
          preview?: boolean
          to_status: string
          woo_error?: string | null
          woo_response_status?: number | null
        }
        Update: {
          changed_by?: string
          changed_by_email?: string | null
          created_at?: string
          from_status?: string
          id?: string
          order_id?: number
          order_number?: string | null
          preview?: boolean
          to_status?: string
          woo_error?: string | null
          woo_response_status?: number | null
        }
        Relationships: []
      }
      wpw_orders: {
        Row: {
          billing: Json | null
          created_at: string
          currency: string | null
          customer_email: string | null
          customer_name: string | null
          customer_note: string | null
          date_completed: string | null
          date_created: string | null
          date_modified: string | null
          fetched_at: string
          id: number
          order_key: string | null
          order_number: string | null
          pay_url: string | null
          payment_method: string | null
          raw: Json | null
          shipping: Json | null
          shipping_total: number | null
          status: string
          subtotal: number | null
          tax_total: number | null
          total: number | null
          tracking_carrier: string | null
          tracking_number: string | null
          tracking_url: string | null
          updated_at: string
          user_id: string | null
          woo_customer_id: number
        }
        Insert: {
          billing?: Json | null
          created_at?: string
          currency?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_note?: string | null
          date_completed?: string | null
          date_created?: string | null
          date_modified?: string | null
          fetched_at?: string
          id: number
          order_key?: string | null
          order_number?: string | null
          pay_url?: string | null
          payment_method?: string | null
          raw?: Json | null
          shipping?: Json | null
          shipping_total?: number | null
          status: string
          subtotal?: number | null
          tax_total?: number | null
          total?: number | null
          tracking_carrier?: string | null
          tracking_number?: string | null
          tracking_url?: string | null
          updated_at?: string
          user_id?: string | null
          woo_customer_id: number
        }
        Update: {
          billing?: Json | null
          created_at?: string
          currency?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_note?: string | null
          date_completed?: string | null
          date_created?: string | null
          date_modified?: string | null
          fetched_at?: string
          id?: number
          order_key?: string | null
          order_number?: string | null
          pay_url?: string | null
          payment_method?: string | null
          raw?: Json | null
          shipping?: Json | null
          shipping_total?: number | null
          status?: string
          subtotal?: number | null
          tax_total?: number | null
          total?: number | null
          tracking_carrier?: string | null
          tracking_number?: string | null
          tracking_url?: string | null
          updated_at?: string
          user_id?: string | null
          woo_customer_id?: number
        }
        Relationships: []
      }
      wpw_quote_leads: {
        Row: {
          created_at: string
          email: string
          id: string
          ip_address: string | null
          last_retarget_at: string | null
          lead_id: string | null
          name: string | null
          page_url: string | null
          phone: string | null
          quote_details: Json
          referrer: string | null
          retarget_count: number
          retarget_status: string
          service: string | null
          source: string
          updated_at: string
          user_agent: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          vehicle: string | null
          visitor_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          ip_address?: string | null
          last_retarget_at?: string | null
          lead_id?: string | null
          name?: string | null
          page_url?: string | null
          phone?: string | null
          quote_details?: Json
          referrer?: string | null
          retarget_count?: number
          retarget_status?: string
          service?: string | null
          source?: string
          updated_at?: string
          user_agent?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          vehicle?: string | null
          visitor_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          ip_address?: string | null
          last_retarget_at?: string | null
          lead_id?: string | null
          name?: string | null
          page_url?: string | null
          phone?: string | null
          quote_details?: Json
          referrer?: string | null
          retarget_count?: number
          retarget_status?: string
          service?: string | null
          source?: string
          updated_at?: string
          user_agent?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          vehicle?: string | null
          visitor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wpw_quote_leads_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      wpw_webhook_log: {
        Row: {
          created_at: string
          error: string | null
          headers: Json | null
          id: number
          payload: Json | null
          processed: boolean
          resource_id: number | null
          signature_ok: boolean | null
          source: string | null
          topic: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          headers?: Json | null
          id?: number
          payload?: Json | null
          processed?: boolean
          resource_id?: number | null
          signature_ok?: boolean | null
          source?: string | null
          topic?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          headers?: Json | null
          id?: number
          payload?: Json | null
          processed?: boolean
          resource_id?: number | null
          signature_ok?: boolean | null
          source?: string | null
          topic?: string | null
        }
        Relationships: []
      }
      wrap_panel_artboards: {
        Row: {
          background_url: string | null
          batch_id: string
          bleed_in: number
          created_at: string
          created_by: string | null
          design_brief: string | null
          dpi: number
          finish: string
          height_in: number
          id: string
          metadata: Json | null
          overlays: Json
          panel_name: string
          project_name: string | null
          status: string
          updated_at: string
          vehicle: string
          width_in: number
        }
        Insert: {
          background_url?: string | null
          batch_id: string
          bleed_in?: number
          created_at?: string
          created_by?: string | null
          design_brief?: string | null
          dpi?: number
          finish?: string
          height_in: number
          id?: string
          metadata?: Json | null
          overlays?: Json
          panel_name: string
          project_name?: string | null
          status?: string
          updated_at?: string
          vehicle: string
          width_in: number
        }
        Update: {
          background_url?: string | null
          batch_id?: string
          bleed_in?: number
          created_at?: string
          created_by?: string | null
          design_brief?: string | null
          dpi?: number
          finish?: string
          height_in?: number
          id?: string
          metadata?: Json | null
          overlays?: Json
          panel_name?: string
          project_name?: string | null
          status?: string
          updated_at?: string
          vehicle?: string
          width_in?: number
        }
        Relationships: []
      }
      wrapguru_kb: {
        Row: {
          category: string | null
          content: string
          created_at: string
          id: string
          is_active: boolean
          question: string
          search: unknown
          source: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          content: string
          created_at?: string
          id?: string
          is_active?: boolean
          question: string
          search?: unknown
          source?: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          content?: string
          created_at?: string
          id?: string
          is_active?: boolean
          question?: string
          search?: unknown
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      wraptv_site_content: {
        Row: {
          brand: string
          caption: string | null
          created_at: string
          credit: string | null
          id: string
          media_type: string
          media_url: string
          post_id: string | null
          published_at: string
          show_slug: string
          source: string
          status: string
          tags: string[] | null
          thumbnail_url: string | null
          title: string | null
        }
        Insert: {
          brand?: string
          caption?: string | null
          created_at?: string
          credit?: string | null
          id?: string
          media_type?: string
          media_url: string
          post_id?: string | null
          published_at?: string
          show_slug?: string
          source?: string
          status?: string
          tags?: string[] | null
          thumbnail_url?: string | null
          title?: string | null
        }
        Update: {
          brand?: string
          caption?: string | null
          created_at?: string
          credit?: string | null
          id?: string
          media_type?: string
          media_url?: string
          post_id?: string | null
          published_at?: string
          show_slug?: string
          source?: string
          status?: string
          tags?: string[] | null
          thumbnail_url?: string | null
          title?: string | null
        }
        Relationships: []
      }
      wtw_submissions: {
        Row: {
          admin_notes: Json
          contact_email: string
          created_at: string
          design_name: string | null
          episode_url: string | null
          id: string
          instagram: string | null
          location: string
          marketing_opt_in: boolean
          music_genre: string
          music_track: Json | null
          notes: string | null
          release_accepted: boolean
          shop_name: string
          status: string
          tiktok: string | null
          updated_at: string
          vehicle: string | null
          video_paths: string[]
          wrappers: string
          youtube: string | null
        }
        Insert: {
          admin_notes?: Json
          contact_email: string
          created_at?: string
          design_name?: string | null
          episode_url?: string | null
          id?: string
          instagram?: string | null
          location: string
          marketing_opt_in?: boolean
          music_genre: string
          music_track?: Json | null
          notes?: string | null
          release_accepted?: boolean
          shop_name: string
          status?: string
          tiktok?: string | null
          updated_at?: string
          vehicle?: string | null
          video_paths?: string[]
          wrappers: string
          youtube?: string | null
        }
        Update: {
          admin_notes?: Json
          contact_email?: string
          created_at?: string
          design_name?: string | null
          episode_url?: string | null
          id?: string
          instagram?: string | null
          location?: string
          marketing_opt_in?: boolean
          music_genre?: string
          music_track?: Json | null
          notes?: string | null
          release_accepted?: boolean
          shop_name?: string
          status?: string
          tiktok?: string | null
          updated_at?: string
          vehicle?: string | null
          video_paths?: string[]
          wrappers?: string
          youtube?: string | null
        }
        Relationships: []
      }
      youtube_metadata: {
        Row: {
          category: string | null
          created_at: string
          description: string | null
          format: string
          hashtags: string[] | null
          id: string
          post_id: string | null
          render_job_id: string | null
          song: string | null
          tags: string[] | null
          thumbnail_text: string | null
          title: string | null
          youtube_url: string | null
          youtube_video_id: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          description?: string | null
          format?: string
          hashtags?: string[] | null
          id?: string
          post_id?: string | null
          render_job_id?: string | null
          song?: string | null
          tags?: string[] | null
          thumbnail_text?: string | null
          title?: string | null
          youtube_url?: string | null
          youtube_video_id?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string
          description?: string | null
          format?: string
          hashtags?: string[] | null
          id?: string
          post_id?: string | null
          render_job_id?: string | null
          song?: string | null
          tags?: string[] | null
          thumbnail_text?: string | null
          title?: string | null
          youtube_url?: string | null
          youtube_video_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      mightymail_active_suppressions: {
        Row: {
          days_suppressed: number | null
          email_address: string | null
          id: string | null
          reason: string | null
          scope: string | null
          shop_id: string | null
          source: string | null
          suppressed_at: string | null
          suppression_type: string | null
        }
        Insert: {
          days_suppressed?: never
          email_address?: string | null
          id?: string | null
          reason?: string | null
          scope?: never
          shop_id?: string | null
          source?: string | null
          suppressed_at?: string | null
          suppression_type?: string | null
        }
        Update: {
          days_suppressed?: never
          email_address?: string | null
          id?: string | null
          reason?: string | null
          scope?: never
          shop_id?: string | null
          source?: string | null
          suppressed_at?: string | null
          suppression_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mightymail_suppressions_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      proof_usage_summary: {
        Row: {
          month: string | null
          proofs_approved: number | null
          proofs_declined: number | null
          proofs_revoked: number | null
          proofs_used: number | null
          user_id: string | null
        }
        Relationships: []
      }
      render_events_admin: {
        Row: {
          created_at: string | null
          email: string | null
          email_resolved: string | null
          engine_version: string | null
          enhanced_prompt_chars: number | null
          enhanced_prompt_hash: string | null
          error_message: string | null
          finish: string | null
          gemini_finish_reason: string | null
          gemini_model: string | null
          id: string | null
          latency_ms: number | null
          mode: string | null
          raw_prompt: string | null
          render_url: string | null
          source_id: string | null
          source_table: string | null
          success: boolean | null
          thumbnail_url: string | null
          tool: string | null
          user_created_at: string | null
          user_id: string | null
          vehicle_canonical: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_year: string | null
          view_type: string | null
        }
        Relationships: []
      }
      v_shop_revenue_summary: {
        Row: {
          cost: number | null
          created_at: string | null
          margin: number | null
          revenue: number | null
          shop_id: string | null
          source: string | null
          source_id: string | null
          status: string | null
        }
        Relationships: []
      }
      workforce_dormant_customers: {
        Row: {
          customer_email: string | null
          customer_name: string | null
          last_order_at: string | null
          lifetime_total: number | null
          orders_count: number | null
        }
        Relationships: []
      }
      workforce_event_stats: {
        Row: {
          event_type: string | null
          first_seen: string | null
          last_seen: string | null
          n: number | null
          status: string | null
        }
        Relationships: []
      }
      workforce_retarget_attribution: {
        Row: {
          amount: number | null
          book: string | null
          quote_created_at: string | null
          quote_id: string | null
          status: string | null
        }
        Relationships: []
      }
      workforce_scoreboard: {
        Row: {
          campaigns_approved_7d: number | null
          campaigns_built_7d: number | null
          cards_actioned_7d: number | null
          cards_created_7d: number | null
          drip_emails_queued: number | null
          events_failed_7d: number | null
          events_processed_7d: number | null
          human_edits_7d: number | null
          retarget_converted_quotes: number | null
          retarget_influenced_revenue: number | null
          social_built_7d: number | null
        }
        Relationships: []
      }
      wpw_outreach_segments: {
        Row: {
          email: string | null
          first_order_at: string | null
          has_account: boolean | null
          last_order_at: string | null
          ltv: number | null
          name: string | null
          orders: number | null
          segment: string | null
          woo_customer_id: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      _drive_sync_fetch_b64: {
        Args: { p_max?: number; p_path: string; p_q?: number }
        Returns: {
          b64: string
          b64_size: number
          mime: string
          status: number
        }[]
      }
      add_user_tokens: {
        Args: { p_amount: number; p_reason?: string; p_user_id: string }
        Returns: Json
      }
      admin_user_diagnostics: { Args: { p_email: string }; Returns: Json }
      advance_sequence_step: {
        Args: { p_enrollment_id: string }
        Returns: undefined
      }
      apply_customer_tag:
        | {
            Args: {
              p_customer_id: string
              p_merge_data?: Json
              p_shop_id: string
              p_source_event?: string
              p_source_ref?: string
              p_tag: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_customer_id: string
              p_source_event?: string
              p_source_ref?: string
              p_tag: string
            }
            Returns: {
              out_enrollment_id: string
              out_sequence_id: string
            }[]
          }
      apply_shop_tag: {
        Args: {
          p_shop_id: string
          p_source_event?: string
          p_source_ref?: string
          p_tag: string
        }
        Returns: {
          out_enrollment_id: string
          out_sequence_id: string
        }[]
      }
      approvepro_conversion_stats: { Args: never; Returns: Json }
      backfill_job_flat_proof: { Args: { p_job_id: string }; Returns: string }
      can_generate_render: { Args: { user_email: string }; Returns: Json }
      check_proof_allowance: {
        Args: { p_user_id: string }
        Returns: {
          ai_revisions_per_proof: number
          remaining: number
          tier: string
          white_label_enabled: boolean
        }[]
      }
      consume_production_pack_credit: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      convert_quote_to_order: {
        Args: { p_quote_id: string; p_source?: string }
        Returns: string
      }
      create_pack_redeem_code: {
        Args: {
          p_code?: string
          p_credits: number
          p_expires_at?: string
          p_max_redemptions?: number
          p_reason?: string
        }
        Returns: string
      }
      customer_proof_status: {
        Args: never
        Returns: {
          customer_name: string
          design_name: string
          id: string
          instructions_requested_at: string
          needs_instructions: boolean
          order_ref: string
          sent_at: string
          signed_at: string
          status: string
          updated_at: string
          vehicle_make: string
          vehicle_model: string
          vehicle_year: string
          view_token: string
        }[]
      }
      deduct_user_tokens: {
        Args: { p_amount: number; p_reason?: string; p_user_id: string }
        Returns: Json
      }
      expire_free_welcome_tokens: { Args: never; Returns: number }
      get_proof_by_view_token: {
        Args: { p_token: string }
        Returns: {
          active_version: Json
          ai_revisions_allowed: number
          ai_revisions_used: number
          customer_email: string
          customer_name: string
          design_name: string
          expires_at: string
          finish_type: string
          has_line_items: boolean
          id: string
          line_items: Json
          message_to_customer: string
          mode: string
          status: string
          vehicle_make: string
          vehicle_model: string
          vehicle_type: string
          vehicle_year: string
          version_history: Json
          white_label_logo_url: string
        }[]
      }
      get_public_quote_by_token: {
        Args: { p_token: string }
        Returns: {
          category: string
          color_name: string
          created_at: string
          customer_email: string
          customer_name: string
          customer_total: number
          finish: string
          is_wpw_shop: boolean
          line_items: Json
          manufacturer: string
          margin_percent: number
          quote_id: string
          quote_number: string
          render_url: string
          shop_logo_url: string
          shop_name: string
          shop_phone: string
          shop_website: string
          sq_ft: number
          status: string
          vehicle_make: string
          vehicle_model: string
          vehicle_year: string
          yards_needed: number
        }[]
      }
      get_tier_limit: { Args: { tier_name: string }; Returns: number }
      grant_production_pack_credits: {
        Args: { p_credits: number; p_email: string; p_reason?: string }
        Returns: string
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_affiliate_stats: {
        Args: {
          p_commission_cents: number
          p_is_initial: boolean
          p_partner_id: string
        }
        Returns: undefined
      }
      increment_campaign_stat: {
        Args: { p_campaign_id: string; p_stat: string }
        Returns: undefined
      }
      increment_customer_quotes: {
        Args: { p_customer_id: string }
        Returns: undefined
      }
      is_franchise_admin: {
        Args: { _franchise_id: string; _user_id: string }
        Returns: boolean
      }
      is_shop_admin: {
        Args: { _shop_id: string; _user_id: string }
        Returns: boolean
      }
      is_shop_member: {
        Args: { _shop_id: string; _user_id: string }
        Returns: boolean
      }
      kick_print_worker: {
        Args: { p_body: Json; p_secret: string; p_url: string }
        Returns: number
      }
      kick_production_slicer: {
        Args: { p_job_id: string; p_secret: string; p_url: string }
        Returns: number
      }
      log_client_error: {
        Args: {
          p_app_version?: string
          p_component_stack?: string
          p_error_name?: string
          p_fingerprint: string
          p_message: string
          p_metadata?: Json
          p_route?: string
          p_severity?: string
          p_source?: string
          p_stack?: string
          p_url?: string
          p_user_agent?: string
        }
        Returns: string
      }
      log_render_error: {
        Args: {
          p_duration_ms?: number
          p_error_code?: string
          p_error_message?: string
          p_function_name: string
          p_request_meta?: Json
          p_status_code?: number
          p_tool: string
          p_user_email?: string
          p_user_id?: string
        }
        Returns: string
      }
      match_wrapguru_kb: {
        Args: { match_count?: number; query_text: string }
        Returns: {
          content: string
          question: string
          rank: number
        }[]
      }
      mm_body: { Args: { paras: string[] }; Returns: string }
      mm_shell: {
        Args: {
          p_accent_color: string
          p_accent_label: string
          p_body_html: string
          p_cta_label: string
          p_cta_tag: string
          p_headline: string
        }
        Returns: string
      }
      my_team_shop_ids: { Args: never; Returns: string[] }
      polish_template_html:
        | {
            Args: {
              p_body_html: string
              p_cta_text: string
              p_cta_url: string
              p_headline_html: string
              p_hero_alt: string
              p_hero_url: string
              p_promo: string
              p_subject: string
            }
            Returns: string
          }
        | {
            Args: {
              p_body_html: string
              p_caption: string
              p_cta_text: string
              p_cta_url: string
              p_headline_html: string
              p_hero1_alt: string
              p_hero1_url: string
              p_hero2_alt: string
              p_hero2_url: string
              p_promo: string
              p_subject: string
            }
            Returns: string
          }
      proof_assign: {
        Args: { _assignee: string; _proof_id: string }
        Returns: {
          ai_revisions_allowed: number
          ai_revisions_used: number
          assigned_at: string | null
          assigned_by: string | null
          assigned_to: string | null
          change_request: string | null
          created_at: string
          customer_email: string
          customer_name: string | null
          customer_phone: string | null
          decline_reason: string | null
          design_name: string | null
          expires_at: string | null
          finish_type: string | null
          has_line_items: boolean
          id: string
          internal_notes: string | null
          manage_token: string
          message_to_customer: string | null
          metadata: Json
          mode: string
          sent_at: string | null
          shop_id: string
          signature_storage_path: string | null
          signed_at: string | null
          signed_pdf_sha256: string | null
          signed_pdf_storage_path: string | null
          signer_ip: unknown
          signer_typed_name: string | null
          signer_user_agent: string | null
          source_visualization_id: string | null
          status: string
          updated_at: string
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_type: string | null
          vehicle_year: string | null
          view_token: string
          viewed_at: string | null
          white_label_logo_url: string | null
        }
        SetofOptions: {
          from: "*"
          to: "proof_approvals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      proof_line_items_rollup: {
        Args: { p_proof_id: string }
        Returns: {
          all_approved: boolean
          all_resolved: boolean
          any_declined: boolean
          approved: number
          declined: number
          pending: number
          revising: number
          total: number
        }[]
      }
      proof_shop_shared_team: {
        Args: { _proof_shop: string }
        Returns: boolean
      }
      proof_team_shop_ids: { Args: { _user: string }; Returns: string[] }
      proof_version_merge_render_url: {
        Args: { p_key: string; p_url: string; p_version_id: string }
        Returns: undefined
      }
      redeem_pack_code: { Args: { p_code: string }; Returns: number }
      seed_rep_marketing_kit: {
        Args: { p_affiliate_id: string }
        Returns: undefined
      }
      shop_members_with_emails: {
        Args: { _shop_id: string }
        Returns: {
          accepted_at: string
          email: string
          role: string
          user_id: string
        }[]
      }
      team_shop_owners: {
        Args: never
        Returns: {
          owner_email: string
          shop_id: string
          shop_name: string
        }[]
      }
      transition_revision_state: {
        Args: {
          p_agent?: string
          p_error?: string
          p_ms?: number
          p_new_state: Database["public"]["Enums"]["revision_state"]
          p_panel_path?: string
          p_revision_id: string
        }
        Returns: {
          agent_used: string | null
          company_name: string | null
          completed_at: string | null
          coordinate_map: Json | null
          created_at: string | null
          crop_zones: Json | null
          current_panel_path: string | null
          design_description: string | null
          emergency_fallback_path: string | null
          error_message: string | null
          generation_ms: number | null
          id: string
          job_id: string
          last_known_good_path: string | null
          master_artboard_path: string | null
          panel_id: number | null
          panel_name: string
          processing_started_at: string | null
          retry_count: number | null
          revision_request: string | null
          shop_id: string | null
          size_kb: number | null
          state: Database["public"]["Enums"]["revision_state"]
          technical_instruction: string | null
          updated_at: string | null
          user_id: string | null
          vehicle_make: string | null
          vehicle_model: string | null
        }
        SetofOptions: {
          from: "*"
          to: "design_revisions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      user_email_domain: { Args: { uid: string }; Returns: string }
      user_shop_ids: { Args: { _user_id: string }; Returns: string[] }
      user_shop_profile_ids: { Args: { _user_id: string }; Returns: string[] }
      verify_wpw_internal_key: {
        Args: { provided_key: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user" | "tester" | "designer"
      print_production_status:
        | "awaiting_payment"
        | "paid_submitted"
        | "in_production"
        | "files_ready"
        | "completed"
      revision_state:
        | "pending"
        | "processing"
        | "validating"
        | "live"
        | "failed"
        | "emergency"
      shop_member_role: "owner" | "admin" | "member"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user", "tester", "designer"],
      print_production_status: [
        "awaiting_payment",
        "paid_submitted",
        "in_production",
        "files_ready",
        "completed",
      ],
      revision_state: [
        "pending",
        "processing",
        "validating",
        "live",
        "failed",
        "emergency",
      ],
      shop_member_role: ["owner", "admin", "member"],
    },
  },
} as const
