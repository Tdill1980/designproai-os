/**
 * render-boat — Dedicated edge function for boat / marine wrap renders.
 *
 * Push-button unlock: the frontend routes boat renders here instead of the
 * locked generate-color-render. All heavy lifting (spec lookup via Google
 * grounding for marine dimensions, prompt building, Gemini call, storage
 * upload, DB insert) is in _shared/non-auto-render-handler.ts.
 *
 * Vehicle class: "boat"
 * Sub-types detected via Google grounding: center_console | runabout |
 *   bowrider | cruiser | pontoon | yacht | bass_boat | sport_fishing
 *
 * Response shape: superset of generate-color-render, with added validation
 * metadata. See non-auto-render-handler.ts for the full list of fields.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleNonAutoRender } from "../_shared/non-auto-render-handler.ts";

serve((req) => handleNonAutoRender(req, "boat"));
