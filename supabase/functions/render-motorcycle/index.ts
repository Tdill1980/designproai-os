/**
 * render-motorcycle — Dedicated edge function for motorcycle wrap renders.
 *
 * Push-button unlock: the frontend routes motorcycle renders here instead of
 * the locked generate-color-render. All heavy lifting (spec lookup, prompt
 * building, Gemini call, storage upload, DB insert) is in
 * _shared/non-auto-render-handler.ts so this file stays a one-liner.
 *
 * Vehicle class: "motorcycle"
 * Sub-types detected via Google grounding: sport_bike | cruiser | tourer |
 *   adventure | standard | scooter
 *
 * Response shape: superset of generate-color-render, with added validation
 * metadata. See non-auto-render-handler.ts for the full list of fields.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleNonAutoRender } from "../_shared/non-auto-render-handler.ts";

serve((req) => handleNonAutoRender(req, "motorcycle"));
