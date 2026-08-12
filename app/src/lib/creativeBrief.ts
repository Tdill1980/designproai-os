/**
 * creativeBrief — the DETERMINISTIC decisions behind "make the creative".
 *
 * Kept free of the Supabase client (and therefore of env/network) so the
 * judgment calls are unit-testable in isolation, the same way
 * brandcastPlanner holds the cut rules. makeCreative.ts does the I/O.
 */

/**
 * The visual a post deserves depends on what it's SAYING. Copy about an
 * install shows install footage; copy about a finished wrap shows the vehicle.
 * Deterministic keyword mapping — no AI needed to make this call.
 */
export function preferredContentTypes(caption: string): string[] {
  const t = String(caption || "").toLowerCase();
  if (/\bunbox|roll|shipment|package|arrived\b/.test(t)) return ["unboxing", "product", "vehicle_only"];
  if (/\binstall|squeegee|heat gun|wrapping|apply|tuck\b/.test(t)) return ["install", "film", "vehicle_only"];
  if (/\bcustomer|testimonial|review|client said\b/.test(t)) return ["ugc", "vehicle_only", "install"];
  if (/\bshop|team|owner|behind the\b/.test(t)) return ["documentary", "install", "vehicle_only"];
  // Default: the finished work is the strongest social visual.
  return ["vehicle_only", "install", "film"];
}

/** First line of the caption, trimmed to a headline the composer can set. */
export function headlineFrom(caption: string): string {
  const first = String(caption || "")
    .split(/\n+/).map((l) => l.trim()).filter(Boolean)[0] || "";
  return first.replace(/^[🔥⚡✅👉💰🎯•\-\s]+/u, "").slice(0, 90);
}

/** Supporting bullet lines (the composer renders these as suggestion pills). */
export function bulletsFrom(caption: string): string[] {
  return String(caption || "")
    .split(/\n+/)
    .map((l) => l.replace(/^[🔥⚡✅👉💰🎯•\-\s]+/u, "").trim())
    .filter((l) => l.length > 3 && !/^#/.test(l))
    .slice(1, 5);
}
