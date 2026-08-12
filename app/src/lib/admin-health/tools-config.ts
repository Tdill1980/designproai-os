/**
 * admin-health/tools-config.ts — static definition of every tool the
 * health dashboard monitors. Grouped by category for layout + ops clarity.
 *
 * Add or remove tools here — the dashboard auto-renders from this list.
 * Future per-tool check endpoints will key off `id`.
 */

import type { CheckGroup } from "./types";

export const TOOL_GROUPS: CheckGroup[] = [
  {
    label: "Core Platform",
    tools: [
      { id: "login",          name: "Login / Auth" },
      { id: "supabase-db",    name: "Supabase DB" },
      { id: "vercel-uptime",  name: "Vercel Uptime" },
      { id: "jwt-sessions",   name: "JWT Sessions" },
      { id: "quickquote",     name: "QuickQuote" },
      { id: "approvepro",     name: "ApprovePro" },
    ],
  },
  {
    label: "Design Tools",
    tools: [
      { id: "colorpro",       name: "ColorPro" },
      { id: "patternpro",     name: "PatternPro" },
      { id: "revisionstudio", name: "RevisionStudio" },
      { id: "designpro",      name: "DesignPro" },
      { id: "wrapbox",        name: "WrapBox" },
    ],
  },
  {
    label: "Production Tools",
    tools: [
      { id: "genie-pipeline", name: "GENIE Pipeline" },
      { id: "topaz-upscale",  name: "Topaz Upscale" },
      { id: "zip-output",     name: "ZIP Output" },
    ],
  },
  {
    label: "External Services",
    tools: [
      { id: "gemini-pro",     name: "Gemini Pro" },
      { id: "gemini-flash",   name: "Gemini Flash" },
      { id: "replicate",      name: "Replicate" },
      { id: "slack-webhook",  name: "Slack Webhook" },
    ],
  },
];
