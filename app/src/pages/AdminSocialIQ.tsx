import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Heart, MessageCircle, Plus, RefreshCw, Send, ShieldCheck, Sparkles, TrendingUp, UserPlus, Workflow, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { brandMeta } from "@/lib/content-tags";
import { toast } from "sonner";

/**
 * SocialIQ — engage + insights (docs/SOCIALIQ_SPEC.md).
 *
 * WHITE UI page: white surface, gray-900/600/500 text, blue→magenta gradient
 * as accent only. Brand color coding comes from THE one system
 * (src/lib/content-tags.ts brandMeta — same colors as Marketing Hub / Brand
 * Board): cards carry their brand's signature color. Comment threads render
 * as DARK chat boxes on the white page.
 *
 * Engage: comments on our posts land here with an AI-suggested organic
 * reply. A human edits/approves and clicks Send — replies and likes go out
 * from the WPW account (social-engage-act; WPW-only until more brands are
 * enabled). Nothing auto-publishes.
 */

interface InteractionRow {
  id: string;
  brand: string;
  platform: string;
  external_post_id: string;
  author_name: string | null;
  author_handle: string | null;
  text: string | null;
  comment_created_at: string | null;
  is_question: boolean;
  suggested_reply: string | null;
  status: string;
  replied_text: string | null;
  liked: boolean;
}

interface MetricRow {
  id: string;
  post_id: string | null;
  brand: string;
  platform: string;
  external_post_id: string;
  captured_on: string;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  video_views: number | null;
}

interface PostRow {
  id: string;
  brand: string;
  platform: string;
  caption: string | null;
  media_urls: string[] | null;
  posted_date: string | null;
}

const BRAND_PRIORITY = ["weprintwraps", "designproai", "creatormarket"];
const brandRank = (b: string) => {
  const i = BRAND_PRIORITY.indexOf(b.toLowerCase());
  return i === -1 ? BRAND_PRIORITY.length : i;
};
const engagementOf = (m: MetricRow) =>
  (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) + (m.saves ?? 0);
const isIG = (platform: string) => platform.toLowerCase().includes("instagram") || platform === "ig";

/**
 * Brand chip — the Marketing Hub's brand color code: a gradient dot + label,
 * both read from THE registry (content-tags BRAND_META.gradient), so a brand
 * looks identical here and in the Hub's brand switcher.
 */
function BrandChip({ brand }: { brand: string }) {
  const meta = brandMeta(brand);
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold text-gray-700 border border-gray-200 bg-gray-50">
      <span className={`w-2 h-2 rounded-full bg-gradient-to-r ${meta.gradient}`} />
      {meta.label}
    </span>
  );
}

function EngageCard({ item }: { item: InteractionRow }) {
  const queryClient = useQueryClient();
  const [reply, setReply] = useState(item.suggested_reply || "");
  const [busy, setBusy] = useState<string | null>(null);
  const meta = brandMeta(item.brand);

  const act = async (action: "reply" | "like" | "dismiss") => {
    setBusy(action);
    try {
      const { data, error } = await supabase.functions.invoke("social-engage-act", {
        body: { interaction_id: item.id, action, text: action === "reply" ? reply : undefined },
      });
      if (error) throw error;
      if (data?.success === false) throw new Error(data.error);
      toast.success(action === "reply" ? "Reply sent" : action === "like" ? "Liked" : "Dismissed");
      queryClient.invalidateQueries({ queryKey: ["socialiq-engage"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className={`h-1 bg-gradient-to-r ${meta.gradient}`} />
      <div className="flex items-center justify-between px-4 pt-3">
        <div className="flex items-center gap-2">
          <BrandChip brand={item.brand} />
          <span className="text-xs text-gray-500 capitalize">{item.platform}</span>
          {item.is_question && (
            <span className="text-xs font-semibold text-white px-2 py-0.5 rounded-full bg-gradient-to-r from-blue-500 to-pink-500">
              question
            </span>
          )}
        </div>
        <span className="text-xs text-gray-500">
          {item.comment_created_at ? new Date(item.comment_created_at).toLocaleDateString() : ""}
        </span>
      </div>

      {/* The conversation — dark chat boxes on the white page */}
      <div className="p-4 space-y-3">
        <div className="bg-gray-900 text-white rounded-2xl rounded-tl-sm px-4 py-3 max-w-[85%]">
          <div className="text-xs text-gray-400 mb-1">
            {item.author_handle ? `@${item.author_handle}` : item.author_name || "Commenter"}
          </div>
          <p className="text-sm leading-relaxed">{item.text}</p>
        </div>

        {item.status === "replied" ? (
          <div className="bg-gray-800 text-white rounded-2xl rounded-br-sm px-4 py-3 max-w-[85%] ml-auto">
            <div className={`text-xs mb-1 bg-gradient-to-r ${meta.gradient} bg-clip-text text-transparent font-semibold`}>
              {meta.label} · sent
            </div>
            <p className="text-sm leading-relaxed">{item.replied_text}</p>
          </div>
        ) : (
          <div className="bg-gray-800 rounded-2xl rounded-br-sm px-4 py-3 max-w-[85%] ml-auto">
            <div className="text-xs text-gray-400 mb-1.5">
              {item.suggested_reply ? "Suggested reply — edit before sending" : "Write a reply"}
            </div>
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={2}
              className="w-full bg-transparent text-white text-sm leading-relaxed resize-none outline-none placeholder:text-gray-500"
              placeholder="Type an organic reply…"
            />
          </div>
        )}
      </div>

      {item.status === "new" && (
        <div className="flex items-center gap-2 px-4 pb-4">
          <Button
            size="sm"
            disabled={busy !== null || !reply.trim()}
            onClick={() => act("reply")}
            className="bg-gradient-to-r from-blue-500 to-pink-500 text-white hover:opacity-90"
          >
            <Send className="w-3.5 h-3.5 mr-1.5" />
            {busy === "reply" ? "Sending…" : "Send reply"}
          </Button>
          {!isIG(item.platform) && (
            <Button size="sm" variant="outline" disabled={busy !== null || item.liked} onClick={() => act("like")} className="text-gray-600">
              <Heart className={`w-3.5 h-3.5 mr-1.5 ${item.liked ? "fill-pink-500 text-pink-500" : ""}`} />
              {item.liked ? "Liked" : busy === "like" ? "Liking…" : "Like"}
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => act("dismiss")} className="text-gray-500 ml-auto">
            <X className="w-3.5 h-3.5 mr-1" /> Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}

interface ReplyRule {
  id: string;
  brand: string;
  name: string;
  trigger_words: string[];
  template: string;
  auto_send: boolean;
  active: boolean;
}

interface IdentityRow {
  id: string;
  brand: string;
  platform: string | null;
  handle: string | null;
  email: string;
  klaviyo_profile_id: string | null;
  source_post_id: string | null;
  created_at: string;
}

/** Capture tab — Klaviyo-style trigger rules + the contacts they earned. */
function CaptureTab() {
  const queryClient = useQueryClient();
  const [newRule, setNewRule] = useState({ name: "", words: "", template: "" });

  const { data: rules } = useQuery({
    queryKey: ["socialiq-rules"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("social_reply_rules")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as ReplyRule[];
    },
  });

  const { data: identities } = useQuery({
    queryKey: ["socialiq-identities"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("social_identities")
        .select("id, brand, platform, handle, email, klaviyo_profile_id, source_post_id, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data || []) as IdentityRow[];
    },
  });

  const saveRule = useMutation({
    mutationFn: async (patch: Partial<ReplyRule> & { id?: string }) => {
      const table = (supabase as any).from("social_reply_rules");
      const { error } = patch.id
        ? await table.update({ ...patch, updated_at: new Date().toISOString() }).eq("id", patch.id)
        : await table.insert(patch);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["socialiq-rules"] });
      setNewRule({ name: "", words: "", template: "" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-xl">
        <div className="flex items-center gap-2 p-4 border-b border-gray-200">
          <Zap className="w-4 h-4 text-pink-500" />
          <h2 className="font-semibold">Trigger-word rules</h2>
          <span className="text-xs text-gray-500">
            comment matches a word → templated reply with your capture link. Auto only if you flip it.
          </span>
        </div>
        <div className="divide-y divide-gray-100">
          {(rules || []).map((r) => (
            <div key={r.id} className="p-4 space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-semibold text-sm">{r.name}</span>
                <span className="text-xs text-gray-500">{(r.trigger_words || []).join(" · ")}</span>
                <label className="flex items-center gap-1.5 text-xs text-gray-600 ml-auto cursor-pointer">
                  <input
                    type="checkbox"
                    checked={r.auto_send}
                    onChange={(e) => saveRule.mutate({ id: r.id, auto_send: e.target.checked })}
                    className="accent-pink-500"
                  />
                  auto-send
                </label>
                <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={r.active}
                    onChange={(e) => saveRule.mutate({ id: r.id, active: e.target.checked })}
                    className="accent-pink-500"
                  />
                  active
                </label>
              </div>
              <p className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">{r.template}</p>
            </div>
          ))}
        </div>
        <div className="p-4 border-t border-gray-200 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input
            value={newRule.name}
            onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
            placeholder="Rule name"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <input
            value={newRule.words}
            onChange={(e) => setNewRule({ ...newRule, words: e.target.value })}
            placeholder="Trigger words (comma-separated)"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <Button
            size="sm"
            disabled={!newRule.name || !newRule.words || !newRule.template || saveRule.isPending}
            onClick={() =>
              saveRule.mutate({
                brand: "weprintwraps",
                name: newRule.name,
                trigger_words: newRule.words.split(",").map((w) => w.trim()).filter(Boolean),
                template: newRule.template,
              } as Partial<ReplyRule>)
            }
            className="bg-gradient-to-r from-blue-500 to-pink-500 text-white"
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> Add
          </Button>
          <textarea
            value={newRule.template}
            onChange={(e) => setNewRule({ ...newRule, template: e.target.value })}
            placeholder="Reply template — use {{capture_url}} for the sign-up link, {{handle}} for their name"
            rows={2}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm sm:col-span-3"
          />
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl">
        <div className="flex items-center gap-2 p-4 border-b border-gray-200">
          <UserPlus className="w-4 h-4 text-pink-500" />
          <h2 className="font-semibold">Captured contacts</h2>
          <span className="text-xs text-gray-500">each one tagged with the post that drove them → Klaviyo</span>
        </div>
        {!identities?.length ? (
          <p className="p-6 text-sm text-gray-500">
            No captures yet — they appear here the moment someone signs up from a reply link.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="p-3 font-medium">Email</th>
                  <th className="p-3 font-medium">Handle</th>
                  <th className="p-3 font-medium">Brand</th>
                  <th className="p-3 font-medium">Source post</th>
                  <th className="p-3 font-medium">Klaviyo</th>
                  <th className="p-3 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {identities.map((p) => (
                  <tr key={p.id} className="border-b border-gray-100">
                    <td className="p-3 text-gray-900">{p.email}</td>
                    <td className="p-3 text-gray-600">{p.handle ? `@${p.handle}` : "—"}</td>
                    <td className="p-3"><BrandChip brand={p.brand} /></td>
                    <td className="p-3 text-gray-600 truncate max-w-[12rem]">{p.source_post_id || "direct"}</td>
                    <td className="p-3">{p.klaviyo_profile_id ? "✓" : "—"}</td>
                    <td className="p-3 text-gray-600">{new Date(p.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

interface SequenceRow {
  id: string;
  brand: string;
  name: string;
  trigger: string;
  active: boolean;
}
interface SequenceStepRow {
  id: string;
  sequence_id: string;
  step_order: number;
  delay_hours: number;
  channel: string;
  subject: string | null;
  body: string;
  active: boolean;
}
interface EnrollmentRow {
  id: string;
  email: string;
  brand: string;
  next_step: number;
  next_run_at: string;
  status: string;
  source_post_id: string | null;
}

/**
 * Flows tab — the nurture half, OWNED. Klaviyo charges for cross-channel
 * flows; these run on our own worker (social-sequence-run) using the senders
 * already in the stack. Copy is human-written and editable here.
 */
function FlowsTab() {
  const { data: sequences } = useQuery({
    queryKey: ["socialiq-sequences"],
    queryFn: async () => {
      const [seq, steps, enroll] = await Promise.all([
        (supabase as any).from("social_sequences").select("*").order("created_at"),
        (supabase as any).from("social_sequence_steps").select("*").order("step_order"),
        (supabase as any)
          .from("social_sequence_enrollments")
          .select("id, email, brand, next_step, next_run_at, status, source_post_id")
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
      if (seq.error) throw seq.error;
      return {
        sequences: (seq.data || []) as SequenceRow[],
        steps: (steps.data || []) as SequenceStepRow[],
        enrollments: (enroll.data || []) as EnrollmentRow[],
      };
    },
  });

  const list = sequences?.sequences || [];
  const active = (sequences?.enrollments || []).filter((e) => e.status === "active").length;

  return (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center gap-2">
          <Workflow className="w-4 h-4 text-pink-500" />
          <h2 className="font-semibold">Nurture flows — ours, not rented</h2>
          <span className="ml-auto text-sm text-gray-600">
            <b className="text-gray-900">{active}</b> people currently in a flow
          </span>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          A capture enrolls automatically. The worker sends each step when it's due, re-checks
          the unsubscribe list before every send, and can never send a step twice.
        </p>
      </div>

      {list.map((seq) => {
        const meta = brandMeta(seq.brand);
        const steps = (sequences?.steps || []).filter((s) => s.sequence_id === seq.id);
        return (
          <div key={seq.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className={`h-1 bg-gradient-to-r ${meta.gradient}`} />
            <div className="flex items-center gap-2 p-4 border-b border-gray-100">
              <BrandChip brand={seq.brand} />
              <span className="font-semibold text-sm">{seq.name}</span>
              <span className="text-xs text-gray-500">trigger: {seq.trigger}</span>
              <span
                className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-full ${
                  seq.active ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"
                }`}
              >
                {seq.active ? "active" : "paused"}
              </span>
            </div>
            <ol className="divide-y divide-gray-100">
              {steps.map((s) => (
                <li key={s.id} className="p-4 flex gap-3">
                  <div className="shrink-0 w-16 text-xs text-gray-500">
                    {s.delay_hours === 0 ? "immediately" : `+${s.delay_hours}h`}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold uppercase text-gray-500">{s.channel}</span>
                      {s.subject && <span className="text-sm font-medium text-gray-900">{s.subject}</span>}
                    </div>
                    <p className="text-sm text-gray-600 mt-1 whitespace-pre-line line-clamp-3">{s.body}</p>
                  </div>
                </li>
              ))}
              {steps.length === 0 && <li className="p-4 text-sm text-gray-500">No steps yet.</li>}
            </ol>
          </div>
        );
      })}

      {list.length === 0 && (
        <div className="border border-gray-200 rounded-xl p-10 text-center text-gray-500">
          No flows yet — the WPW welcome flow seeds with the migration.
        </div>
      )}
    </div>
  );
}

interface CommentStyle {
  id: string;
  brand: string;
  channel: string;
  name: string;
  style_prompt: string;
  sample_output: string | null;
  status: string;
}
interface OutreachAction {
  id: string;
  brand: string;
  platform: string;
  target_handle: string | null;
  post_excerpt: string | null;
  action: string;
  draft_text: string | null;
  status: string;
  manual_reason: string | null;
  created_at: string;
}

const OUTREACH_BRANDS = ["weprintwraps", "designproai"];
const OUTREACH_CHANNELS = ["wrapfeed", "instagram", "facebook"];

/**
 * Outreach tab — proactive AI like + comment on followers and industry
 * shops, gated by a per-brand, per-channel comment style the owner approves.
 *
 * Honest about the platform: Meta's API only permits comment/like on media
 * the connected account OWNS, so only WrapFeed auto-engages; IG/FB drafts
 * queue for a human. Automating those would breach Meta's terms and risk
 * the account.
 */
function OutreachTab() {
  const queryClient = useQueryClient();
  const [brand, setBrand] = useState("weprintwraps");
  const [channel, setChannel] = useState("wrapfeed");
  const [running, setRunning] = useState(false);

  const { data } = useQuery({
    queryKey: ["socialiq-outreach"],
    queryFn: async () => {
      const [styles, actions] = await Promise.all([
        (supabase as any).from("social_comment_styles").select("*").order("brand"),
        (supabase as any)
          .from("social_outreach_actions")
          .select("id, brand, platform, target_handle, post_excerpt, action, draft_text, status, manual_reason, created_at")
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
      if (styles.error) throw styles.error;
      return {
        styles: (styles.data || []) as CommentStyle[],
        actions: (actions.data || []) as OutreachAction[],
      };
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await (supabase as any)
        .from("social_comment_styles")
        .update({ status, approved_at: status === "approved" ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["socialiq-outreach"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const startRun = async () => {
    setRunning(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("social-outreach-run", {
        body: { brand, channel, limit: 10 },
      });
      if (error) throw error;
      if (res?.needs_style_approval) {
        toast.error(res.error);
      } else if (res?.success === false) {
        throw new Error(res.error);
      } else if (channel === "wrapfeed") {
        toast.success(`Engaged — ${res.commented ?? 0} comments, ${res.liked ?? 0} likes as ${brandMeta(brand).label}`);
      } else {
        toast.success(`${res.drafted ?? 0} drafts queued for manual posting (Meta can't auto-comment on others' posts)`);
      }
      queryClient.invalidateQueries({ queryKey: ["socialiq-outreach"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const styles = data?.styles || [];
  const approvedFor = styles.find((s) => s.brand === brand && s.channel === channel && s.status === "approved");

  return (
    <div className="space-y-6">
      {/* The run control */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className={`h-1 bg-gradient-to-r ${brandMeta(brand).gradient}`} />
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-pink-500" />
            <h2 className="font-semibold">AI engagement run</h2>
          </div>
          <p className="text-xs text-gray-500">
            Likes and comments on followers &amp; industry shops in the approved voice for this brand + channel.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              {OUTREACH_BRANDS.map((b) => <option key={b} value={b}>{brandMeta(b).label}</option>)}
            </select>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              {OUTREACH_CHANNELS.map((c) => (
                <option key={c} value={c}>{c === "wrapfeed" ? "The Feed (ours — auto)" : `${c} (drafts only)`}</option>
              ))}
            </select>
            <Button
              onClick={startRun}
              disabled={running || !approvedFor}
              className="bg-gradient-to-r from-blue-500 to-pink-500 text-white hover:opacity-90"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              {running ? "Engaging…" : "Start AI engagement run"}
            </Button>
          </div>
          {!approvedFor && (
            <p className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              No approved style for {brandMeta(brand).label} on {channel} — approve one below first. The AI won't
              comment in a voice you haven't signed off.
            </p>
          )}
          {channel !== "wrapfeed" && (
            <p className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <b>Drafts only on {channel}.</b> Meta's API can only comment or like on posts the connected account
              owns — there's no sanctioned way to engage someone else's post. Automating it would breach Meta's
              terms and risk the account, so these queue for a human to post. On The Feed it's fully automatic.
            </p>
          )}
        </div>
      </div>

      {/* Style approval — per brand, per channel */}
      <div className="bg-white border border-gray-200 rounded-xl">
        <div className="flex items-center gap-2 p-4 border-b border-gray-200">
          <ShieldCheck className="w-4 h-4 text-pink-500" />
          <h2 className="font-semibold">Comment styles — approve per brand &amp; channel</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {styles.map((s) => (
            <div key={s.id} className="p-4 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <BrandChip brand={s.brand} />
                <span className="text-xs text-gray-500">{s.channel}</span>
                <span className="text-sm font-semibold">{s.name}</span>
                <span
                  className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    s.status === "approved"
                      ? "bg-emerald-50 text-emerald-700"
                      : s.status === "retired"
                        ? "bg-gray-100 text-gray-500"
                        : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {s.status}
                </span>
                <div className="ml-auto flex gap-2">
                  {s.status !== "approved" ? (
                    <Button size="sm" onClick={() => setStatus.mutate({ id: s.id, status: "approved" })}
                      className="bg-gradient-to-r from-blue-500 to-pink-500 text-white">
                      Approve
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: s.id, status: "draft" })}
                      className="text-gray-600">
                      Unapprove
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-xs text-gray-600">{s.style_prompt}</p>
              {s.sample_output && (
                <p className="text-sm text-gray-900 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  “{s.sample_output}”
                </p>
              )}
            </div>
          ))}
          {styles.length === 0 && <p className="p-6 text-sm text-gray-500">No styles yet.</p>}
        </div>
      </div>

      {/* What the run did */}
      <div className="bg-white border border-gray-200 rounded-xl">
        <div className="flex items-center gap-2 p-4 border-b border-gray-200">
          <MessageCircle className="w-4 h-4 text-pink-500" />
          <h2 className="font-semibold">Engagement log</h2>
        </div>
        {!data?.actions.length ? (
          <p className="p-6 text-sm text-gray-500">Nothing yet — start a run above.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {data.actions.map((a) => (
              <div key={a.id} className="p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <BrandChip brand={a.brand} />
                  <span className="text-xs text-gray-500">{a.platform} · {a.action}</span>
                  {a.target_handle && <span className="text-xs text-gray-700">→ {a.target_handle}</span>}
                  <span
                    className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-full ${
                      a.status === "sent" ? "bg-emerald-50 text-emerald-700"
                        : a.status === "manual_required" ? "bg-amber-50 text-amber-700"
                        : a.status === "failed" ? "bg-red-50 text-red-700"
                        : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {a.status === "manual_required" ? "post by hand" : a.status}
                  </span>
                </div>
                {a.draft_text && <p className="text-gray-900 mt-1.5">“{a.draft_text}”</p>}
                {a.post_excerpt && <p className="text-xs text-gray-500 mt-1 truncate">on: {a.post_excerpt}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface AttributionRow {
  identity_id: string;
  email: string;
  brand: string;
  platform: string | null;
  handle: string | null;
  source_post_id: string | null;
  quote_number: string | null;
  quote_total: number | null;
  order_number: string | null;
  order_total: number | null;
  stage: string;
  captured_at: string;
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

/**
 * Attribution — did the DM/comment become a quote, and the quote a job?
 * Reads the social_attribution_v view (email join: capture → quote → Woo
 * order). Read-only and retroactive; it cannot affect order processing.
 */
function AttributionPanel() {
  const { data: rows } = useQuery({
    queryKey: ["socialiq-attribution"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("social_attribution_v")
        .select("*")
        .order("captured_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data || []) as AttributionRow[];
    },
  });

  const list = rows || [];
  const captured = list.length;
  const quoted = list.filter((r) => r.stage === "quoted" || r.stage === "won").length;
  const won = list.filter((r) => r.stage === "won").length;
  const revenue = list.reduce((sum, r) => sum + (r.stage === "won" ? Number(r.order_total || 0) : 0), 0);

  return (
    <div className="bg-white border border-gray-200 rounded-xl">
      <div className="flex items-center gap-2 p-4 border-b border-gray-200">
        <TrendingUp className="w-4 h-4 text-pink-500" />
        <h2 className="font-semibold text-gray-900">DM → quote → job</h2>
        <span className="text-xs text-gray-500">
          captures matched to WePrintWraps quotes and Woo orders by email
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-gray-100 border-b border-gray-100">
        {[
          { label: "Captured", value: String(captured) },
          { label: "Quoted", value: String(quoted) },
          { label: "Jobs won", value: String(won) },
          { label: "Revenue", value: money(revenue) },
        ].map((s) => (
          <div key={s.label} className="p-4">
            <div className="text-xs text-gray-500">{s.label}</div>
            <div className="text-xl font-bold text-gray-900">{s.value}</div>
          </div>
        ))}
      </div>
      {captured === 0 ? (
        <p className="p-6 text-sm text-gray-500">
          Nothing attributed yet — this fills in as captures turn into quotes and orders.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200">
                <th className="p-3 font-medium">Contact</th>
                <th className="p-3 font-medium">Brand</th>
                <th className="p-3 font-medium">From post</th>
                <th className="p-3 font-medium">Quote</th>
                <th className="p-3 font-medium">Order</th>
                <th className="p-3 font-medium text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, 50).map((r) => (
                <tr key={r.identity_id} className="border-b border-gray-100">
                  <td className="p-3 text-gray-900">{r.email}</td>
                  <td className="p-3"><BrandChip brand={r.brand} /></td>
                  <td className="p-3 text-gray-600 truncate max-w-[10rem]">
                    {r.source_post_id || "direct"}
                  </td>
                  <td className="p-3 text-gray-600">{r.quote_number || "—"}</td>
                  <td className="p-3 text-gray-600">{r.order_number || "—"}</td>
                  <td className="p-3 text-right">
                    <span
                      className={`font-semibold ${r.stage === "won" ? "text-emerald-700" : "text-gray-500"}`}
                    >
                      {r.stage === "won"
                        ? money(Number(r.order_total || 0))
                        : r.quote_total
                          ? `${money(Number(r.quote_total))} quoted`
                          : "—"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AdminSocialIQ() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"engage" | "capture" | "flows" | "outreach" | "insights">("engage");
  const [sweeping, setSweeping] = useState(false);

  const { data: engageData, isLoading: engageLoading } = useQuery({
    queryKey: ["socialiq-engage"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("social_interactions")
        .select("*")
        .in("status", ["new", "replied"])
        .order("comment_created_at", { ascending: false, nullsFirst: false })
        .limit(200);
      if (error) throw error;
      return (data || []) as InteractionRow[];
    },
  });

  const { data: insightsData, isLoading: insightsLoading } = useQuery({
    queryKey: ["socialiq-insights"],
    enabled: tab === "insights",
    queryFn: async () => {
      const since = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
      const [metricsRes, postsRes] = await Promise.all([
        (supabase as any)
          .from("social_post_metrics")
          .select("id, post_id, brand, platform, external_post_id, captured_on, reach, likes, comments, shares, saves, video_views")
          .gte("captured_on", since)
          .order("captured_on", { ascending: false })
          .limit(2000),
        supabase
          .from("agent_social_posts")
          .select("id, brand, platform, caption, media_urls, posted_date")
          .eq("status", "posted")
          .order("posted_date", { ascending: false })
          .limit(500),
      ]);
      if (metricsRes.error) throw metricsRes.error;
      if (postsRes.error) throw postsRes.error;
      return {
        metrics: (metricsRes.data || []) as MetricRow[],
        posts: (postsRes.data || []) as PostRow[],
      };
    },
  });

  const runSweep = async () => {
    setSweeping(true);
    try {
      const [engage, metrics] = await Promise.all([
        supabase.functions.invoke("social-engage-sweep", { body: {} }),
        supabase.functions.invoke("social-metrics-sweep", { body: {} }),
      ]);
      if (engage.error) throw engage.error;
      if (metrics.error) throw metrics.error;
      toast.success(
        `Swept — ${engage.data?.ingested ?? 0} comments (${engage.data?.suggested ?? 0} new suggestions), ${metrics.data?.swept ?? 0} posts' metrics`,
      );
      queryClient.invalidateQueries({ queryKey: ["socialiq-engage"] });
      queryClient.invalidateQueries({ queryKey: ["socialiq-insights"] });
    } catch (e) {
      toast.error(`Sweep failed: ${(e as Error).message}`);
    } finally {
      setSweeping(false);
    }
  };

  const { brandCards, topPosts } = useMemo(() => {
    const metrics = insightsData?.metrics || [];
    const posts = new Map((insightsData?.posts || []).map((p) => [p.id, p]));
    const latest = new Map<string, MetricRow>();
    for (const m of metrics) if (!latest.has(m.external_post_id)) latest.set(m.external_post_id, m);
    const latestRows = [...latest.values()];

    const byBrand = new Map<string, { posts: number; reach: number; engagement: number; comments: number }>();
    for (const m of latestRows) {
      const agg = byBrand.get(m.brand) || { posts: 0, reach: 0, engagement: 0, comments: 0 };
      agg.posts += 1;
      agg.reach += m.reach ?? 0;
      agg.engagement += engagementOf(m);
      agg.comments += m.comments ?? 0;
      byBrand.set(m.brand, agg);
    }
    const brandCards = [...byBrand.entries()]
      .map(([brand, agg]) => ({ brand, ...agg }))
      .sort((a, b) => brandRank(a.brand) - brandRank(b.brand) || b.engagement - a.engagement);

    const topPosts = latestRows
      .map((m) => ({ metric: m, post: m.post_id ? posts.get(m.post_id) : undefined, engagement: engagementOf(m) }))
      .sort((a, b) => b.engagement - a.engagement)
      .slice(0, 25);

    return { brandCards, topPosts };
  }, [insightsData]);

  const newCount = (engageData || []).filter((i) => i.status === "new").length;

  return (
    <div className="min-h-screen bg-white text-gray-900 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">
              Social<span className="bg-gradient-to-r from-blue-500 to-pink-500 bg-clip-text text-transparent">IQ</span>
            </h1>
            <p className="text-sm text-gray-600">
              Comments are leads. Reply like a human, from the WPW account — every send is your click.
            </p>
          </div>
          <Button onClick={runSweep} disabled={sweeping} variant="outline" className="text-gray-700">
            <RefreshCw className={`w-4 h-4 mr-2 ${sweeping ? "animate-spin" : ""}`} />
            {sweeping ? "Sweeping…" : "Refresh"}
          </Button>
        </div>

        <div className="flex gap-1 border-b border-gray-200">
          {([
            { key: "engage", label: "Engage", icon: MessageCircle, badge: newCount },
            { key: "capture", label: "Capture", icon: UserPlus, badge: 0 },
            { key: "flows", label: "Flows", icon: Workflow, badge: 0 },
            { key: "outreach", label: "Outreach", icon: Sparkles, badge: 0 },
            { key: "insights", label: "Insights", icon: BarChart3, badge: 0 },
          ] as const).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                tab === t.key ? "border-pink-500 text-gray-900" : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
              {t.badge > 0 && (
                <span className="text-xs text-white px-1.5 py-0.5 rounded-full bg-gradient-to-r from-blue-500 to-pink-500">
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {tab === "engage" && (
          engageLoading ? (
            <p className="text-gray-500">Loading comments…</p>
          ) : !engageData?.length ? (
            <div className="border border-gray-200 rounded-xl p-10 text-center text-gray-500">
              No comments in the inbox yet. Hit <b className="text-gray-700">Refresh</b> to sweep your published
              WPW posts. If Meta hasn't granted comment access yet, the sweep will say so — Phase 1 needs
              <code className="mx-1 text-xs bg-gray-100 px-1.5 py-0.5 rounded">instagram_manage_comments</code>
              approved.
            </div>
          ) : (
            <div className="space-y-4">
              {engageData.map((item) => <EngageCard key={item.id} item={item} />)}
            </div>
          )
        )}

        {tab === "capture" && <CaptureTab />}

        {tab === "flows" && <FlowsTab />}

        {tab === "outreach" && <OutreachTab />}

        {tab === "insights" && <AttributionPanel />}

        {tab === "insights" && (
          insightsLoading ? (
            <p className="text-gray-500">Loading insights…</p>
          ) : brandCards.length === 0 ? (
            <div className="border border-gray-200 rounded-xl p-10 text-center text-gray-500">
              No metrics yet. Hit <b className="text-gray-700">Refresh</b> — the hourly cron keeps it current
              after that (sql/setup-social-metrics-cron.sql).
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {brandCards.map((c) => {
                  const meta = brandMeta(c.brand);
                  return (
                    <div key={c.brand} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                      <div className={`h-1 bg-gradient-to-r ${meta.gradient}`} />
                      <div className="flex items-center justify-between p-4 pb-0">
                        <BrandChip brand={c.brand} />
                        {brandRank(c.brand) < BRAND_PRIORITY.length && (
                          <span className="text-[10px] font-semibold uppercase tracking-wide bg-gradient-to-r from-blue-500 to-pink-500 bg-clip-text text-transparent">
                            revenue focus
                          </span>
                        )}
                      </div>
                      <div className="mt-3 p-4 pt-0 grid grid-cols-2 gap-2 text-sm">
                        <div><span className="text-gray-500">Posts</span><div className="font-bold text-gray-900">{c.posts}</div></div>
                        <div><span className="text-gray-500">Reach</span><div className="font-bold text-gray-900">{c.reach.toLocaleString()}</div></div>
                        <div><span className="text-gray-500">Engagement</span><div className="font-bold text-gray-900">{c.engagement.toLocaleString()}</div></div>
                        <div>
                          <span className="text-gray-500">Comments</span>
                          <div className={`font-bold bg-gradient-to-r ${meta.gradient} bg-clip-text text-transparent`}>
                            {c.comments.toLocaleString()}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="bg-white border border-gray-200 rounded-xl">
                <div className="flex items-center gap-2 p-4 border-b border-gray-200">
                  <TrendingUp className="w-4 h-4 text-pink-500" />
                  <h2 className="font-semibold text-gray-900">Top posts (latest snapshot, 90 days)</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 border-b border-gray-200">
                        <th className="p-3 font-medium">Post</th>
                        <th className="p-3 font-medium">Brand</th>
                        <th className="p-3 font-medium">Platform</th>
                        <th className="p-3 font-medium text-right">Reach</th>
                        <th className="p-3 font-medium text-right">Likes</th>
                        <th className="p-3 font-medium text-right">Comments</th>
                        <th className="p-3 font-medium text-right">Engagement</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topPosts.map(({ metric, post, engagement }) => (
                        <tr key={metric.external_post_id} className="border-b border-gray-100">
                          <td className="p-3 max-w-md">
                            <div className="flex items-center gap-2">
                              {post?.media_urls?.[0] && (
                                <img src={post.media_urls[0]} alt="" className="w-9 h-9 rounded object-cover shrink-0" />
                              )}
                              <span className="truncate text-gray-900">{post?.caption?.slice(0, 90) || metric.external_post_id}</span>
                            </div>
                          </td>
                          <td className="p-3"><BrandChip brand={metric.brand} /></td>
                          <td className="p-3 capitalize text-gray-600">{metric.platform}</td>
                          <td className="p-3 text-right text-gray-900">{metric.reach?.toLocaleString() ?? "—"}</td>
                          <td className="p-3 text-right text-gray-900">{metric.likes?.toLocaleString() ?? "—"}</td>
                          <td className="p-3 text-right text-gray-900">{metric.comments?.toLocaleString() ?? "—"}</td>
                          <td className="p-3 text-right font-semibold text-gray-900">{engagement.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )
        )}
      </div>
    </div>
  );
}
