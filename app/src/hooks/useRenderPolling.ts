import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

/** Maximum time (ms) to poll before auto-stopping to prevent infinite spinners. */
const MAX_POLL_DURATION_MS = 5 * 60 * 1000;

interface RenderView {
  type: string;
  url: string;
}

export function useRenderPolling(visualizationId: string | null, expectedViewCount: number) {
  const [allViews, setAllViews] = useState<RenderView[]>([]);
  const [isPolling, setIsPolling] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const startPolling = () => {
    if (!visualizationId) return;
    setTimedOut(false);
    setIsPolling(true);
  };

  const stopPolling = () => {
    setIsPolling(false);
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    if (!isPolling || !visualizationId) {
      stopPolling();
      return;
    }

    // Safety timeout - stop polling after MAX_POLL_DURATION_MS
    pollTimeoutRef.current = setTimeout(() => {
      console.warn(`⏱ Render polling timed out after ${MAX_POLL_DURATION_MS / 1000}s for ${visualizationId}`);
      setTimedOut(true);
      stopPolling();
    }, MAX_POLL_DURATION_MS);

    const poll = async () => {
      try {
        const { data, error } = await supabase
          .from('color_visualizations')
          .select('render_urls')
          .eq('id', visualizationId)
          .single();

        if (error) throw error;

        if (data?.render_urls) {
          const views: RenderView[] = Object.entries(data.render_urls as Record<string, string>).map(
            ([type, url]) => ({ type, url })
          );

          setAllViews(views);

          // Stop polling if we have all expected views
          if (views.length >= expectedViewCount) {
            console.log('✅ All views generated, stopping poll');
            stopPolling();
          }
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    };

    // Poll immediately
    poll();

    // Then poll every 3 seconds
    pollIntervalRef.current = setInterval(poll, 3000);

    return () => stopPolling();
  }, [isPolling, visualizationId, expectedViewCount]);

  return { allViews, isPolling, startPolling, stopPolling, timedOut };
}
