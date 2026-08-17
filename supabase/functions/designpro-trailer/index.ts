/**
 * designpro-trailer — DesignIQ AI generation for trailer wraps.
 *
 * Accepts the same payload as design-panel-ai-generate (mode, prompt, finish,
 * vehicleMake, vehicleModel, etc.) but builds a trailer-specific prompt
 * that knows about large flat side panels, rear doors, and trailer-class
 * geometry (enclosed cargo, race, gooseneck, utility, flatbed, etc.).
 *
 * Response shape matches design-panel-ai-generate so the frontend consumes
 * it identically: { renderUrl, directRender, designName, success, ... }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleDesignProVehicle } from "../_shared/designpro-vehicle-handler.ts";

serve((req) => handleDesignProVehicle(req, "trailer"));
