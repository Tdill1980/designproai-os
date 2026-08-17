/**
 * designpro-boat — DesignIQ AI generation for boat wraps.
 *
 * Accepts the same payload as design-panel-ai-generate (mode, prompt, finish,
 * vehicleMake, vehicleModel, etc.) but builds a boat-specific prompt
 * that knows about hulls, transoms, and console panels.
 *
 * Response shape matches design-panel-ai-generate so the frontend consumes
 * it identically: { renderUrl, directRender, designName, success, ... }
 *
 * Deploy trigger: ensure Supabase has the latest handler code so boat renders
 * don't silently fail via function-not-found.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleDesignProVehicle } from "../_shared/designpro-vehicle-handler.ts";

serve((req) => handleDesignProVehicle(req, "boat"));
