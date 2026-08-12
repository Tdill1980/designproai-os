/**
 * admin-health/types.ts — shared types for the System Health dashboard.
 *
 * Used by the dashboard page AND (in later sessions) the per-tool check
 * endpoints + cron runner. Keep shape stable so wire format matches UI.
 */

export type Status = "ok" | "fail" | "warn" | "checking";

export interface ToolCheck {
  id: string;
  name: string;
  status: Status;
  latency: number | null;   // milliseconds, null if not yet measured
  message: string;          // short human-readable detail
  lastChecked: string | null; // ISO timestamp or pretty string
}

export interface ToolDefinition {
  id: string;
  name: string;
}

export interface CheckGroup {
  label: string;
  tools: ToolDefinition[];
}
