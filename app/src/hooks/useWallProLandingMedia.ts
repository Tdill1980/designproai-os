import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { LANDING_QUERY_KEY, resolveLandingMedia, type LandingMedia } from '@/lib/wallpro-landing-content';

export function useWallProLandingMedia() {
  const query = useQuery({
    queryKey: LANDING_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.from('wallpro_landing_media' as never).select('*');
      if (error) throw error;
      return data as unknown as LandingMedia[];
    },
    staleTime: 30_000,
    retry: 1,
  });
  return { ...query, media: resolveLandingMedia(query.data) };
}
