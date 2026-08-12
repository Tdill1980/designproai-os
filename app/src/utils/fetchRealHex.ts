import { renderClient } from "@/integrations/supabase/renderClient";

/**
 * Fetches the real hex color for a vinyl swatch using AI.
 * Returns the hex code or "NOT_FOUND" if unable to determine.
 */
export async function fetchRealHex(manufacturer: string, colorName: string): Promise<string> {
  // Skip if inputs are empty
  if (!manufacturer || !colorName) return "NOT_FOUND";
  
  try {
    const { data, error } = await renderClient.functions.invoke('get-vinyl-hex', {
      body: { manufacturer, colorName }
    });

    if (error) {
      console.error("AI color fetch failed:", error);
      return "NOT_FOUND";
    }

    const hex = data?.hex?.trim() || "";
    if (!hex || !hex.startsWith("#")) return "NOT_FOUND";
    return hex.toUpperCase();
  } catch (err) {
    console.error("AI color fetch failed:", err);
    return "NOT_FOUND";
  }
}

/**
 * Hook-friendly version that caches results to avoid repeated API calls
 */
const hexCache = new Map<string, string>();

export async function fetchRealHexCached(manufacturer: string, colorName: string): Promise<string> {
  const cacheKey = `${manufacturer}:${colorName}`;
  
  if (hexCache.has(cacheKey)) {
    return hexCache.get(cacheKey)!;
  }
  
  const hex = await fetchRealHex(manufacturer, colorName);
  hexCache.set(cacheKey, hex);
  return hex;
}
