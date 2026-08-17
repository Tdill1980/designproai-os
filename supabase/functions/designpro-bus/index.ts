/**
 * designpro-bus — DesignIQ AI generation for bus wraps.
 *
 * Accepts the same payload as design-panel-ai-generate (mode, prompt, finish,
 * vehicleMake, vehicleModel, etc.) but builds a bus-specific prompt
 * that knows about large flat side panels and commercial scale.
 *
 * Response shape matches design-panel-ai-generate so the frontend consumes
 * it identically: { renderUrl, directRender, designName, success, ... }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleDesignProVehicle } from "../_shared/designpro-vehicle-handler.ts";

serve((req) => handleDesignProVehicle(req, "bus"));
