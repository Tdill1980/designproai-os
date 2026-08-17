/**
 * render-bus — Dedicated edge function for bus / coach wrap renders.
 *
 * Push-button unlock: the frontend routes bus renders here instead of the
 * locked generate-color-render. All heavy lifting (spec lookup via Google
 * grounding for transit/coach dimensions, prompt building, Gemini call,
 * storage upload, DB insert) is in _shared/non-auto-render-handler.ts.
 *
 * Vehicle class: "bus"
 * Sub-types detected via Google grounding: transit_bus | school_bus |
 *   motorcoach | shuttle | double_decker | articulated
 *
 * Response shape: superset of generate-color-render, with added validation
 * metadata. See non-auto-render-handler.ts for the full list of fields.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleNonAutoRender } from "../_shared/non-auto-render-handler.ts";

serve((req) => handleNonAutoRender(req, "bus"));
