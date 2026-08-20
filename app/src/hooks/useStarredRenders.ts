import { useQuery } from "@tanstack/react-query";

/**
 * THE SHOWCASE CAROUSEL HAS NO SOURCE ON THIS SYSTEM YET.
 *
 * It read starred renders out of color_visualizations, filtered by the legacy
 * mode_type values. That table belongs to RestylePro; nothing in the standalone
 * runtime writes it or reads it, and a customer-facing carousel is not a reason
 * to keep a live query into the old system open on the DesignPro home page.
 *
 * Returning an empty list is the honest state, and both callers already handle
 * it -- the carousel simply does not rotate. When the runtime grows a way to
 * mark a finished design as showcase-worthy, this reads that instead.
 */
export const useStarredRenders = () => {
  return useQuery({
    queryKey: ["showcase-renders", "designpro"],
    queryFn: async (): Promise<string[]> => [],
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
};
