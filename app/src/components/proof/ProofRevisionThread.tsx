/**
 * ProofRevisionThread — the design team's read-only window into the customer's
 * "Revise with AI" conversation. It calls the SAME proof-revise-thread endpoint
 * the customer's chat uses (keyed by the proof's view token), so the team sees
 * EXACTLY what the customer sees: every revise prompt, the reference images they
 * attached, and the resulting render at each turn — in order, with the live
 * version flagged.
 *
 * White UI + blue→magenta accent to match the AI-first workbench. Read-only:
 * the team acts via the existing Upload / Pull-from-QC / revert controls.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Sparkles, User, Bot, ImageIcon, RefreshCw } from "lucide-react";

interface Turn {
  version_number: number;
  created_by_role: string; // "system_upload" | "shop" | "customer" | "ai"
  created_at: string;
  prompt_text: string | null;
  render_url: string | null;
  reference_urls: string[];
  is_active: boolean;
}

interface Props {
  token: string;
  /** Bump to force a reload (e.g. after the team uploads a new version). */
  refreshKey?: number;
}

function roleLabel(role: string): { who: string; icon: typeof User } {
  switch (role) {
    case "customer": return { who: "Customer asked", icon: User };
    case "ai": return { who: "Ace (AI) generated", icon: Sparkles };
    case "shop": return { who: "Design team uploaded", icon: Bot };
    case "system_upload": return { who: "Original design", icon: ImageIcon };
    default: return { who: role, icon: ImageIcon };
  }
}

export function ProofRevisionThread({ token, refreshKey }: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [usage, setUsage] = useState<{ allowed: number; used: number; remaining: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        const { data, error } = await supabase.functions.invoke("proof-revise-thread", { body: { token } });
        if (cancelled) return;
        if (error || !data?.success) {
          setError((data as any)?.error || error?.message || "Couldn't load revisions");
          return;
        }
        setTurns(Array.isArray(data.turns) ? data.turns : []);
        setUsage(data.ai_revisions || null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, refreshKey]);

  // Only the turns that represent an actual revision conversation (a prompt, an
  // AI turn, or a customer turn) — the base design alone isn't a "revision".
  const revisionTurns = turns.filter(
    (t) => t.prompt_text || t.created_by_role === "customer" || t.created_by_role === "ai",
  );

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-[#ec4899]" />
        Revisions — what the customer sees
        {usage && (
          <span className="text-[10px] text-gray-700 ml-auto">
            {usage.used}/{usage.allowed} AI revisions used · {usage.remaining} left
          </span>
        )}
      </h3>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : revisionTurns.length === 0 ? (
        <p className="text-xs text-gray-500 italic">
          No customer revisions yet. When the customer uses “Revise with AI” on their portal, every prompt + result shows up here.
        </p>
      ) : (
        <ol className="space-y-2.5">
          {revisionTurns.map((t, i) => {
            const { who, icon: Icon } = roleLabel(t.created_by_role);
            const when = new Date(t.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
            return (
              <li key={`${t.version_number}-${i}`} className={`rounded-lg border p-3 ${t.is_active ? "border-blue-300 bg-blue-50/40" : "border-gray-200 bg-gray-50"}`}>
                <div className="flex items-center gap-2 mb-1.5">
                  <Icon className={`w-3.5 h-3.5 ${t.created_by_role === "ai" ? "text-[#ec4899]" : t.created_by_role === "customer" ? "text-blue-600" : "text-gray-500"}`} />
                  <span className="text-[12px] font-semibold text-gray-900">{who}</span>
                  <span className="text-[10px] text-gray-400">v{t.version_number} · {when}</span>
                  {t.is_active && (
                    <span className="ml-auto text-[9px] font-bold uppercase tracking-wide text-white px-1.5 py-0.5 rounded" style={{ background: "linear-gradient(90deg,#3b82f6,#ec4899)" }}>Live</span>
                  )}
                </div>
                {t.prompt_text && (
                  <p className="text-[13px] text-gray-800 leading-relaxed whitespace-pre-wrap mb-2">“{t.prompt_text}”</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {t.reference_urls.map((u, j) => (
                    <a key={`ref-${j}`} href={u} target="_blank" rel="noopener noreferrer" title="Reference the customer attached">
                      <img src={u} alt="reference" className="w-14 h-14 rounded object-cover border border-amber-300 ring-1 ring-amber-200" />
                    </a>
                  ))}
                  {t.render_url && (
                    <a href={t.render_url} target="_blank" rel="noopener noreferrer" title="Resulting design">
                      <img src={t.render_url} alt={`v${t.version_number}`} className="h-14 rounded object-cover border border-gray-300" />
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
