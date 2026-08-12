/**
 * ProductionAgentReportsCard — admin dashboard surface for the Production
 * Pipeline Agent (api/production-pipeline-agent). Reads the per-job reports the
 * agent stamps onto panelizer_jobs.concept_json.agent_report and shows, per job:
 *   • job number   • Design ID (DID-XXXXXXXX)   • WPW WooCommerce order # (if any)
 *   • status (fixed / flagged / healthy / failed) + what the agent diagnosed &
 *     did (auto-fix safe actions; risky ones are flagged for a human).
 * Read-only; polls every 60s. Renders nothing when the agent has no reports yet.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Bot, CheckCircle2, AlertTriangle, XCircle, Wrench, ExternalLink } from "lucide-react";

interface AgentReport {
  id: string;
  status?: string;
  severity?: string;
  classification?: string;
  diagnosis?: string;
  engine?: string;
  action_taken?: string;
  job_number?: string;
  design_id?: string | null;
  design_did?: string | null;
  wpw_order_number?: string | null;
  is_wpw?: boolean;
  at?: string;
}

const STATUS_STYLE: Record<string, { icon: any; cls: string; label: string }> = {
  fixed: { icon: CheckCircle2, cls: "text-emerald-600 bg-emerald-50 border-emerald-200", label: "Auto-fixed" },
  flagged: { icon: AlertTriangle, cls: "text-amber-600 bg-amber-50 border-amber-200", label: "Needs review" },
  failed: { icon: XCircle, cls: "text-red-600 bg-red-50 border-red-200", label: "Failed" },
  healthy: { icon: CheckCircle2, cls: "text-gray-500 bg-gray-50 border-gray-200", label: "Healthy" },
};

export default function ProductionAgentReportsCard() {
  const { data: reports = [] } = useQuery<AgentReport[]>({
    queryKey: ["production-agent-reports"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("panelizer_jobs")
        .select("id, status, order_number, concept_json, updated_at")
        .not("concept_json->agent_report", "is", null)
        .order("updated_at", { ascending: false })
        .limit(50);
      return (data || [])
        .map((j: any) => ({ id: j.id, ...(j.concept_json?.agent_report || {}) }))
        .filter((r: AgentReport) => r && r.status);
    },
    refetchInterval: 60000,
    refetchOnWindowFocus: false,
  });

  if (!reports.length) return null;

  const flagged = reports.filter((r) => r.status === "flagged" || r.status === "failed").length;
  const fixed = reports.filter((r) => r.status === "fixed").length;

  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-gradient-to-r from-blue-500 to-fuchsia-500 p-2">
            <Bot className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-lg font-bold text-gray-900">Production Pipeline Agent</p>
            <p className="text-xs text-gray-500">
              Watches every job → auto-fixes safe failures (re-kicks Railway) → flags the rest. Scans every 5&nbsp;min.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold">
          {fixed > 0 && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">{fixed} auto-fixed</span>}
          {flagged > 0 && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">{flagged} need review</span>}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-[11px] uppercase tracking-wide text-gray-400">
              <th className="py-2 pr-3 font-semibold">Status</th>
              <th className="py-2 pr-3 font-semibold">Job #</th>
              <th className="py-2 pr-3 font-semibold">Design ID</th>
              <th className="py-2 pr-3 font-semibold">WPW order</th>
              <th className="py-2 pr-3 font-semibold">Diagnosis</th>
              <th className="py-2 pr-3 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => {
              const s = STATUS_STYLE[r.status || "healthy"] || STATUS_STYLE.healthy;
              const Icon = s.icon;
              return (
                <tr key={r.id} className="border-b border-gray-50 align-top">
                  <td className="py-2 pr-3">
                    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${s.cls}`}>
                      <Icon className="h-3 w-3" /> {s.label}
                    </span>
                  </td>
                  <td className="py-2 pr-3 font-mono text-gray-800">{r.job_number || "—"}</td>
                  <td className="py-2 pr-3">
                    <span className="font-mono text-[12px] font-semibold text-fuchsia-600">{r.design_did || "—"}</span>
                  </td>
                  <td className="py-2 pr-3">
                    {r.wpw_order_number ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 font-mono text-[12px] font-semibold text-blue-700">
                        WPW #{r.wpw_order_number}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-gray-600">
                    {r.diagnosis || r.classification || "—"}
                    {r.engine === "openai" && <span className="ml-1 text-[10px] font-semibold text-gray-400">· AI</span>}
                  </td>
                  <td className="py-2 pr-3">
                    {r.action_taken && r.action_taken.startsWith("retry_railway") ? (
                      <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-700"><Wrench className="h-3 w-3" /> Re-kicked Railway</span>
                    ) : r.action_taken && r.action_taken.startsWith("flagged") ? (
                      <span className="text-[12px] font-semibold text-amber-700">{r.action_taken.replace("flagged:", "→ ")}</span>
                    ) : (
                      <span className="text-gray-400 text-[12px]">none</span>
                    )}
                    {r.design_id && (
                      <a href={`/admin/studio-board?order=${encodeURIComponent(r.job_number || "")}`} className="ml-2 inline-flex items-center text-blue-500 hover:text-blue-700" title="Open in PanelPro Studio Board">
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
