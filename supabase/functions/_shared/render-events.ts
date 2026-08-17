// Unified render-event emitter.
//
// Every render-producing edge function calls emitRenderEvent() once on
// completion (success OR failure). Writes one row to public.render_events
// using the service-role client so RLS does not block the insert.
//
// The function NEVER throws on its own — a logging failure must never
// abort the actual render response. All errors are caught and logged.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type RenderEventInput = {
  // Who
  userId?: string | null;
  email?: string | null;

  // Pipeline identity
  tool: string;                  // 'designpanelpro' | 'colorpro' | 'fadewraps' | 'graphicspro' | 'recreatepro' | 'wbty' | 'approvemode' | 'panelizer' | 'designpro_direct' | …
  mode?: string | null;          // 'restyle' | 'commercial' | 'spin' | 'reproduce_angle' | …
  engineVersion?: string | null;
  geminiModel?: string | null;
  geminiFinishReason?: string | null;

  // Vehicle
  vehicleYear?: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vehicleCanonical?: string | null;   // normalized: 'Tesla Cybertruck'
  viewType?: string | null;
  finish?: string | null;

  // Prompt
  rawPrompt?: string | null;
  enhancedPrompt?: string | null;     // hashed + length-tracked; not stored verbatim

  // Output
  renderUrl?: string | null;
  thumbnailUrl?: string | null;
  success?: boolean;                  // default true
  errorMessage?: string | null;
  latencyMs?: number | null;

  // Provenance
  sourceTable?: string | null;
  sourceId?: string | null;
};

let cachedClient: ReturnType<typeof createClient> | null = null;

function getServiceClient() {
  if (cachedClient) return cachedClient;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  cachedClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Canonicalize a vehicle make+model+year combo to a stable display string.
 * Used both for prompt building and analytics grouping.
 *
 * Examples:
 *   ('tesla', 'cyber truck', '2024')   → 'Tesla Cybertruck'
 *   ('chevy', 'silverado 1500', '2023') → 'Chevrolet Silverado 1500'
 *
 * Conservative on purpose — only collapses well-known aliases. Anything
 * unrecognized falls through with title-casing applied so we still get a
 * readable canonical form.
 */
export function canonicalizeVehicle(
  make?: string | null,
  model?: string | null,
  _year?: string | null,
): string | null {
  if (!make && !model) return null;
  const m = (make || "").toLowerCase().trim();
  const mo = (model || "").toLowerCase().trim();

  const makeAliases: Record<string, string> = {
    "tesla": "Tesla",
    "chevy": "Chevrolet",
    "chevrolet": "Chevrolet",
    "gmc": "GMC",
    "vw": "Volkswagen",
    "volkswagen": "Volkswagen",
    "bmw": "BMW",
    "mercedes": "Mercedes-Benz",
    "mercedes-benz": "Mercedes-Benz",
    "mercedes benz": "Mercedes-Benz",
    "mb": "Mercedes-Benz",
    "ford": "Ford",
    "ram": "RAM",
    "dodge": "Dodge",
    "toyota": "Toyota",
    "honda": "Honda",
    "nissan": "Nissan",
    "porsche": "Porsche",
    "audi": "Audi",
    "lexus": "Lexus",
    "kia": "Kia",
    "hyundai": "Hyundai",
    "subaru": "Subaru",
    "jeep": "Jeep",
    "cadillac": "Cadillac",
    "buick": "Buick",
    "rivian": "Rivian",
    "lucid": "Lucid",
    "polestar": "Polestar",
  };

  // Brand-specific model normalizations — only the ones that actually
  // matter for vehicle SHAPE (so Gemini renders the correct geometry).
  const modelAliases: Record<string, Record<string, string>> = {
    "Tesla": {
      "cyber truck": "Cybertruck",
      "cybertruck": "Cybertruck",
      "cyber-truck": "Cybertruck",
      "ct": "Cybertruck",
      "model s": "Model S",
      "model 3": "Model 3",
      "model x": "Model X",
      "model y": "Model Y",
      "roadster": "Roadster",
      "semi": "Semi",
    },
    "Chevrolet": {
      "silverado": "Silverado 1500",
      "silverado 1500": "Silverado 1500",
      "silverado 2500": "Silverado 2500 HD",
      "silverado 3500": "Silverado 3500 HD",
      "corvette": "Corvette",
      "camaro": "Camaro",
      "tahoe": "Tahoe",
      "suburban": "Suburban",
    },
    "Ford": {
      "f150": "F-150",
      "f 150": "F-150",
      "f-150": "F-150",
      "f250": "F-250",
      "f-250": "F-250",
      "f350": "F-350",
      "f-350": "F-350",
      "mustang": "Mustang",
      "bronco": "Bronco",
    },
    "RAM": {
      "1500": "1500",
      "2500": "2500",
      "3500": "3500",
      "trx": "1500 TRX",
    },
    "GMC": {
      "sierra": "Sierra 1500",
      "sierra 1500": "Sierra 1500",
      "yukon": "Yukon",
      "hummer ev": "Hummer EV",
    },
  };

  const canonicalMake = makeAliases[m] ?? titleCase(m);

  let canonicalModel = "";
  if (mo) {
    const brandTable = modelAliases[canonicalMake];
    canonicalModel = brandTable?.[mo] ?? titleCase(mo);
  }

  const out = [canonicalMake, canonicalModel].filter(Boolean).join(" ");
  return out || null;
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

/**
 * Emit one render event. Safe to call from anywhere in an edge function:
 * never throws, always returns. Pass `success: false` + `errorMessage` for
 * failed renders so we can triage from the same ledger.
 */
export async function emitRenderEvent(input: RenderEventInput): Promise<void> {
  try {
    const supabase = getServiceClient();
    if (!supabase) {
      console.warn("[render-events] missing SUPABASE_URL / SERVICE_ROLE_KEY — skipping emit");
      return;
    }

    const enhanced = input.enhancedPrompt ?? "";
    const enhancedHash = enhanced ? await sha256Hex(enhanced) : null;
    const enhancedChars = enhanced ? enhanced.length : null;

    const vehicleCanonical =
      input.vehicleCanonical ??
      canonicalizeVehicle(input.vehicleMake, input.vehicleModel, input.vehicleYear);

    const row = {
      user_id: input.userId ?? null,
      email: input.email ?? null,
      tool: input.tool,
      mode: input.mode ?? null,
      engine_version: input.engineVersion ?? null,
      gemini_model: input.geminiModel ?? null,
      gemini_finish_reason: input.geminiFinishReason ?? null,
      vehicle_year: input.vehicleYear ?? null,
      vehicle_make: input.vehicleMake ?? null,
      vehicle_model: input.vehicleModel ?? null,
      vehicle_canonical: vehicleCanonical,
      view_type: input.viewType ?? null,
      finish: input.finish ?? null,
      raw_prompt: input.rawPrompt ?? null,
      enhanced_prompt_chars: enhancedChars,
      enhanced_prompt_hash: enhancedHash,
      render_url: input.renderUrl ?? null,
      thumbnail_url: input.thumbnailUrl ?? null,
      success: input.success ?? true,
      error_message: input.errorMessage ?? null,
      latency_ms: input.latencyMs ?? null,
      source_table: input.sourceTable ?? null,
      source_id: input.sourceId ?? null,
    };

    // Upsert on (source_table, source_id) so retries of the same source
    // row don't double-log. If those are null we just insert.
    const useUpsert = !!(row.source_table && row.source_id);
    const builder = supabase.from("render_events");
    const { error } = useUpsert
      ? await builder.upsert(row, { onConflict: "source_table,source_id" })
      : await builder.insert(row);

    if (error) {
      console.error("[render-events] insert failed:", error.message, error.details);
    }
  } catch (err) {
    // Never let logging break the render response.
    console.error("[render-events] unexpected error:", err);
  }
}
