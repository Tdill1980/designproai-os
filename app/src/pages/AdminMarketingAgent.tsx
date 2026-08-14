/**
 * AdminMarketingAgent — the Marketing Agent's control panel in the Engine Room.
 *
 * ONE place to see and steer the agent that creates + manages marketing content
 * for every channel: email campaigns (→ Klaviyo WPW drafts), organic social
 * posts with real media (→ content-deploy publishes after approval), and Meta
 * Ads Launch Packs. The agent runs daily on its own; this panel shows what it
 * built, lets the team approve, set the standing GOAL, or force a run now.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Bot, Play, Target, Mail, Share2, Rocket, RefreshCw, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import MarketingAgentChat from "@/components/marketing/MarketingAgentChat";
import MarketingCanvaTemplates from "@/components/marketing/MarketingCanvaTemplates";

type Brand = "weprintwraps" | "restylepro" | "wraptv" | "inkandedge";

const AGENT = "marketing-agent";
const BRAND_LABELS: Record<Brand, string> = {
  weprintwraps: "WePrintWraps",
  restylepro: "DesignProAI",
  wraptv: "Wrap TV World",
  inkandedge: "Ink & Edge",
};

function useAgentData(brand: Brand) {
  return useQuery({
    queryKey: ["marketing-agent-panel", brand],
    queryFn: async () => {
      const db = supabase as any;
      const [runs, campaigns, posts, goals, ads] = await Promise.all([
        db.from("agent_recommendations").select("id, title, description, created_at")
          .eq("brand", brand).eq("category", "marketing_agent_run")
          .order("created_at", { ascending: false }).limit(8),
        db.from("agent_email_campaigns").select("id, campaign_name, subject_line, status, scheduled_date, klaviyo_campaign_id, list_segment, stats")
          .eq("brand", brand).eq("created_by", AGENT)
          .order("created_at", { ascending: false }).limit(20),
        db.from("agent_social_posts").select("id, caption, platform, post_type, status, scheduled_date, media_urls")
          .eq("brand", brand).eq("created_by", AGENT)
          .order("created_at", { ascending: false }).limit(20),
        db.from("slack_agent_tasks").select("id, title, status, created_at")
          .eq("brand", brand).ilike("title", "GOAL:%").eq("status", "pending")
          .order("created_at", { ascending: false }).limit(3),
        db.from("slack_agent_tasks").select("id, title, status, created_at, metadata")
          .eq("brand", brand).eq("created_by", AGENT).eq("task_type", "ad_campaign")
          .order("created_at", { ascending: false }).limit(5),
      ]);
      return {
        runs: runs.data ?? [], campaigns: campaigns.data ?? [],
        posts: posts.data ?? [], goals: goals.data ?? [], ads: ads.data ?? [],
      };
    },
    refetchInterval: 30_000,
  });
}

const statusChip = (s: string) =>
  s === "needs_review" || s === "draft" || s === "pending"
    ? "bg-amber-100 text-amber-700 border-amber-300"
    : s === "approved" || s === "scheduled"
      ? "bg-blue-100 text-blue-700 border-blue-300"
      : s === "in_klaviyo" || s === "posted" || s === "sent" || s === "completed"
        ? "bg-emerald-100 text-emerald-700 border-emerald-300"
        : "bg-slate-100 text-slate-600 border-slate-300";

export default function AdminMarketingAgent() {
  const [brand, setBrand] = useState<Brand>("weprintwraps");
  const [goalInput, setGoalInput] = useState("");
  const [running, setRunning] = useState(false);
  const [runNote, setRunNote] = useState<string | null>(null);
  const qc = useQueryClient();
  const { data, isLoading } = useAgentData(brand);
  const refresh = () => qc.invalidateQueries({ queryKey: ["marketing-agent-panel", brand] });

  const runNow = async () => {
    setRunning(true); setRunNote(null);
    try {
      const { data: res, error } = await supabase.functions.invoke("marketing-agent", {
        body: { action: "run", brands: [brand] },
      });
      if (error) throw error;
      const actions = res?.report?.[0]?.actions ?? [];
      setRunNote(actions.join(" · ") || "run complete");
    } catch (e: any) {
      setRunNote(`run failed: ${e?.message || e}`);
    } finally {
      setRunning(false); refresh();
    }
  };

  const setGoal = async () => {
    const g = goalInput.trim();
    if (!g) return;
    await (supabase as any).from("slack_agent_tasks").insert({
      brand, task_type: "other", status: "pending", priority: "high",
      title: `GOAL: ${g}`, description: "Standing order for the marketing agent — newest GOAL card wins.",
      created_by: "engine-room",
    });
    setGoalInput(""); refresh();
  };

  const approveCampaign = async (id: string) => {
    await (supabase as any).from("agent_email_campaigns").update({ status: "approved" }).eq("id", id);
    refresh();
  };
  const approvePost = async (id: string) => {
    await (supabase as any).from("agent_social_posts").update({ status: "scheduled" }).eq("id", id);
    refresh();
  };

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-5">
      {/* Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-pink-500 flex items-center justify-center">
          <Bot className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-[220px]">
          <h1 className="text-lg font-bold text-slate-900">Marketing Agent</h1>
          <p className="text-xs text-slate-500">
            Creates + manages email, organic social, and ad packs for every channel. Runs daily —
            it builds, you approve, the engines publish. It never sends anything unapproved.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(["weprintwraps", "restylepro", "wraptv", "inkandedge"] as Brand[]).map((b) => (
            <button key={b} onClick={() => setBrand(b)}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-semibold border",
                brand === b ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-300")}>
              {BRAND_LABELS[b]}
            </button>
          ))}
          <button onClick={runNow} disabled={running}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-blue-500 to-pink-500 flex items-center gap-1.5 disabled:opacity-60">
            {running ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {running ? "Running…" : "Run Agent Now"}
          </button>
        </div>
        {runNote && <div className="w-full text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-2">{runNote}</div>}
      </div>

      {/* Chat with the agent */}
      <MarketingAgentChat brand={brand} />

      {/* Design engine — Canva Brand Templates (real branding) */}
      <MarketingCanvaTemplates />

      {/* Goal */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Target className="w-4 h-4 text-pink-500" />
          <h2 className="text-sm font-semibold text-slate-700">Standing Goal</h2>
        </div>
        {data?.goals?.length ? (
          <p className="text-sm text-slate-800 mb-2">{data.goals[0].title.replace(/^GOAL:\s*/i, "")}</p>
        ) : (
          <p className="text-xs text-slate-400 mb-2">No GOAL card set — the agent uses its default brand goal.</p>
        )}
        <div className="flex gap-2">
          <input value={goalInput} onChange={(e) => setGoalInput(e.target.value)}
            placeholder="e.g. Push the summer fleet-branding promo to past customers"
            className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-2" />
          <button onClick={setGoal} className="px-3 py-2 rounded-lg text-xs font-semibold text-white bg-slate-900">
            Set Goal
          </button>
        </div>
      </div>

      {/* Three channel columns */}
      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Mail className="w-4 h-4 text-blue-500" />
            <h2 className="text-sm font-semibold text-slate-700">Email → Klaviyo</h2>
          </div>
          <div className="space-y-2">
            {(data?.campaigns ?? []).slice(0, 8).map((c: any) => (
              <div key={c.id} className="border border-slate-200 rounded-lg p-2">
                <p className="text-xs font-semibold text-slate-800">{c.campaign_name}</p>
                <p className="text-[11px] text-slate-500 truncate">{c.subject_line}</p>
                <div className="flex items-center justify-between mt-1">
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium", statusChip(c.status))}>{c.status}</span>
                  {c.status === "needs_review" && (
                    <button onClick={() => approveCampaign(c.id)}
                      className="text-[10px] font-semibold text-emerald-700 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Approve
                    </button>
                  )}
                  {/* Once a campaign is in Klaviyo its rendered design lives
                      ONLY there — the row here holds the subject line, not the
                      email. Without this link the reviewer has a status chip
                      and no way to look at what they are approving. */}
                  {c.klaviyo_campaign_id && (
                    <a
                      href={`https://www.klaviyo.com/campaign/${c.klaviyo_campaign_id}/wizard`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-semibold text-blue-700 hover:underline"
                    >
                      View in Klaviyo →
                    </a>
                  )}
                </div>
              </div>
            ))}
            {!data?.campaigns?.length && <p className="text-xs text-slate-400">Nothing yet — run the agent.</p>}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Share2 className="w-4 h-4 text-purple-500" />
            <h2 className="text-sm font-semibold text-slate-700">Organic Social</h2>
          </div>
          <div className="space-y-2">
            {(data?.posts ?? []).slice(0, 8).map((p: any) => (
              <div key={p.id} className="border border-slate-200 rounded-lg p-2">
                <p className="text-xs font-semibold text-slate-800">{p.platform} · {p.post_type}</p>
                <p className="text-[11px] text-slate-500 line-clamp-2">{p.caption}</p>
                <div className="flex items-center justify-between mt-1">
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium", statusChip(p.status))}>{p.status}</span>
                  {p.status === "draft" && (
                    <button onClick={() => approvePost(p.id)}
                      className="text-[10px] font-semibold text-emerald-700 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Approve & schedule
                    </button>
                  )}
                </div>
              </div>
            ))}
            {!data?.posts?.length && <p className="text-xs text-slate-400">Nothing yet — run the agent.</p>}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Rocket className="w-4 h-4 text-orange-500" />
            <h2 className="text-sm font-semibold text-slate-700">Ads Launch Packs</h2>
          </div>
          <div className="space-y-2">
            {(data?.ads ?? []).map((a: any) => (
              <div key={a.id} className="border border-slate-200 rounded-lg p-2">
                <p className="text-xs font-semibold text-slate-800 line-clamp-2">{a.title}</p>
                <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium mt-1 inline-block", statusChip(a.status))}>{a.status}</span>
              </div>
            ))}
            {!data?.ads?.length && <p className="text-xs text-slate-400">Nothing yet — run the agent.</p>}
          </div>
          <p className="text-[10px] text-slate-400 mt-2">Full copy + creative on each card in the <Link className="underline" to="/engine-room">Marketing Hub</Link>.</p>
        </div>
      </div>

      {/* Run log */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h2 className="text-sm font-semibold text-slate-700 mb-2">Agent Run Log</h2>
        {isLoading && <p className="text-xs text-slate-400">Loading…</p>}
        <div className="space-y-2">
          {(data?.runs ?? []).map((r: any) => (
            <div key={r.id} className="border border-slate-200 rounded-lg p-2">
              <p className="text-[11px] font-semibold text-slate-600">{new Date(r.created_at).toLocaleString()}</p>
              <pre className="text-[11px] text-slate-500 whitespace-pre-wrap font-sans">{r.description}</pre>
            </div>
          ))}
          {!data?.runs?.length && <p className="text-xs text-slate-400">No runs logged yet.</p>}
        </div>
      </div>
    </div>
  );
}
