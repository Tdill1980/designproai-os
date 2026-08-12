import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ============================================================================
// Types for the Admin Rating System
// ============================================================================

export interface RatableDesign {
  id: string;
  // From color_visualizations
  render_urls: Record<string, string> | null;
  vehicle_year: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  color_name: string | null;
  color_hex: string | null;
  finish_type: string | null;
  mode_type: string | null;
  manufacturer: string | null;
  customer_email: string | null;
  created_at: string;
  is_saved: boolean | null;
  // Rating fields (joined from neuralnetwork_design_dna if exists)
  dna_id: string | null;
  avg_rating: number;
  total_ratings: number;
  my_rating: number | null;
  my_feedback: string | null;
}

export type RatingFilter = 'all' | 'unrated' | 'rated' | 'low' | 'high';
export type SourceFilter = 'all' | 'live' | 'v1_legacy' | 'import';

// ============================================================================
// Fetch all renders with their ratings
// ============================================================================

export function useRatableDesigns(
  filter: RatingFilter = 'all',
  sourceFilter: SourceFilter = 'all',
  modeFilter: string = 'all'
) {
  return useQuery({
    queryKey: ['admin-ratable-designs', filter, sourceFilter, modeFilter],
    queryFn: async () => {
      // Fetch all renders from color_visualizations
      let query = supabase
        .from('color_visualizations')
        .select('*')
        .order('created_at', { ascending: false });

      if (modeFilter !== 'all') {
        query = query.eq('mode_type', modeFilter);
      }

      const { data: renders, error } = await query;
      if (error) throw error;
      if (!renders) return [];

      // Fetch all design DNA records (for ratings)
      const { data: dnaRecords } = await supabase
        .from('neuralnetwork_design_dna' as any)
        .select('id, vehicle_render_url, avg_rating, total_ratings, source')
        .order('created_at', { ascending: false });

      // Fetch current user's feedback
      const { data: { user } } = await supabase.auth.getUser();
      let myFeedback: Record<string, { rating: number; feedback_text: string }> = {};

      if (user) {
        const { data: feedback } = await supabase
          .from('neuralnetwork_feedback' as any)
          .select('design_dna_id, rating, feedback_text')
          .eq('user_id', user.id);

        if (feedback) {
          for (const fb of feedback as any[]) {
            myFeedback[fb.design_dna_id] = { rating: fb.rating, feedback_text: fb.feedback_text };
          }
        }
      }

      // Build the ratable designs list
      const designs: RatableDesign[] = renders.map((render: any) => {
        // Try to find matching DNA record by render URL (check multiple keys)
        const urls = render.render_urls || {};
        const heroUrl = urls.hero || urls.side || urls['driver-side'] || urls.front
          || urls['passenger-side'] || urls.rear
          || Object.values(urls).find((v: any) => typeof v === 'string' && v.startsWith('http'))
          || '';
        const matchingDna = (dnaRecords as any[] || []).find(
          (d: any) => d.vehicle_render_url === heroUrl
        );

        const dnaId = matchingDna?.id || null;
        const fb = dnaId ? myFeedback[dnaId] : null;

        return {
          id: render.id,
          render_urls: render.render_urls,
          vehicle_year: render.vehicle_year,
          vehicle_make: render.vehicle_make,
          vehicle_model: render.vehicle_model,
          color_name: render.color_name,
          color_hex: render.color_hex,
          finish_type: render.finish_type,
          mode_type: render.mode_type,
          manufacturer: render.infusion_color_id || null,
          customer_email: render.customer_email,
          created_at: render.created_at,
          is_saved: render.is_saved,
          dna_id: dnaId,
          avg_rating: matchingDna?.avg_rating || 0,
          total_ratings: matchingDna?.total_ratings || 0,
          my_rating: fb?.rating || null,
          my_feedback: fb?.feedback_text || null,
        };
      });

      // Apply rating filter
      if (filter === 'unrated') {
        return designs.filter(d => !d.my_rating);
      }
      if (filter === 'rated') {
        return designs.filter(d => !!d.my_rating);
      }
      if (filter === 'low') {
        return designs.filter(d => d.avg_rating > 0 && d.avg_rating < 3);
      }
      if (filter === 'high') {
        return designs.filter(d => d.avg_rating >= 4);
      }

      return designs;
    },
  });
}

// ============================================================================
// Submit a rating + optional feedback
// ============================================================================

export function useSubmitRating() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      visualizationId,
      rating,
      feedbackText,
      renderUrls,
      vehicleInfo,
      modeType,
    }: {
      visualizationId: string;
      rating: number;
      feedbackText?: string;
      renderUrls: Record<string, string> | null;
      vehicleInfo: { year?: string; make?: string; model?: string };
      modeType?: string;
    }) => {
      // Route through edge function (uses service_role to bypass RLS)
      const { data, error } = await supabase.functions.invoke('submit-design-rating', {
        body: {
          visualization_id: visualizationId,
          rating,
          feedback_text: feedbackText || undefined,
          render_urls: renderUrls,
          vehicle_info: vehicleInfo,
          mode_type: modeType,
        },
      });

      if (error) throw new Error(error.message || 'Rating submission failed');

      const result = typeof data === 'string' ? JSON.parse(data) : data;
      if (result?.error) throw new Error(result.error);

      return { dnaId: result?.dna_id, rating };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-ratable-designs'] });
      toast.success('Rating saved - NeuralNetwork learning');
    },
    onError: (error: any) => {
      console.error('Rating error:', error);
      toast.error(`Failed to save rating: ${error.message}`);
    },
  });
}

// ============================================================================
// Rating stats
// ============================================================================

export function useRatingStats() {
  return useQuery({
    queryKey: ['admin-rating-stats'],
    queryFn: async () => {
      const { data: renders } = await supabase
        .from('color_visualizations')
        .select('id', { count: 'exact' });

      const { data: { user } } = await supabase.auth.getUser();
      let ratedCount = 0;

      if (user) {
        const { count } = await supabase
          .from('neuralnetwork_feedback' as any)
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('feedback_type', 'admin');

        ratedCount = count || 0;
      }

      return {
        totalDesigns: renders?.length || 0,
        ratedCount,
        unratedCount: (renders?.length || 0) - ratedCount,
      };
    },
  });
}
