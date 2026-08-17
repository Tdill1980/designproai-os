/**
 * designpro-rv — DesignIQ AI generation for RV/motorhome wraps.
 *
 * Accepts the same payload as design-panel-ai-generate (mode, prompt, finish,
 * vehicleMake, vehicleModel, etc.) but builds an RV-specific prompt
 * that knows about slide-outs, rear caps, and large side panels.
 *
 * Response shape matches design-panel-ai-generate so the frontend consumes
 * it identically: { renderUrl, directRender, designName, success, ... }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleDesignProVehicle } from "../_shared/designpro-vehicle-handler.ts";

serve((req) => handleDesignProVehicle(req, "rv"));
