/**
 * slack-agent — RestylePro Marketing Agent
 *
 * Slack Events API → Claude API (tool-use brain) → Supabase + Slack
 *
 * A senior-level marketing strategist, content creator, and dev partner
 * that lives in the RestylePro Slack workspace 24/7. Handles two brands:
 *   • RestyleProAi.com  — SaaS vehicle wrap visualizer
 *   • WePrintWraps.com  — print fulfillment / wrap shop
 *
 * Env vars required:
 *   SLACK_BOT_TOKEN           — Bot User OAuth Token (xoxb-...)
 *   SLACK_SIGNING_SECRET      — Webhook signature verification
 *   ANTHROPIC_API_KEY         — Claude API key
 *   SUPABASE_URL              — Auto-set by Supabase
 *   SUPABASE_SERVICE_ROLE_KEY — Auto-set by Supabase
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// ─── Constants ──────────────────────────────────────────────────────────────

const CLAUDE_MODEL = "claude-sonnet-4-20250514";
const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const MAX_TOOL_ROUNDS = 10;
const MAX_CONVERSATION_MESSAGES = 50;

// ─── System Prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the RestylePro Marketing Agent — a sharp, senior-level AI teammate embedded in the RestylePro Slack workspace.

## Your Identity
- Name: Marketing Agent
- Roles: Marketing strategist, content creator, data analyst, dev partner
- Style: Direct, strategic, creative. You speak like a senior team member who knows the product cold. No fluff.

## The Two Brands You Serve

### RestyleProAi.com (brand key: "restylepro")
SaaS vehicle wrap visualization platform. Targets wrap shops, designers, fleet managers.
Core tools: ColorPro (color viz), DesignPro (AI panel designs), FadeWraps (gradient effects), GraphicsPro (AI graphics), PrintPro (print-ready output), ApproveMode (client approval), WBTY (footage calculator), Visualizer (3D 360 spin), MaterialMode (texture viz).
Tiers: Free (0 renders), Starter ($29/mo, 10), Advanced ($79/mo, 50), Complete ($149/mo, 200), Agency (unlimited).
Stack: React + Vite + Tailwind + Supabase + Vercel. AI renders via Gemini.

### WePrintWraps.com (brand key: "weprintwraps")
Print fulfillment and vehicle wrap installation. Physical shop + e-commerce.
Blog: WordPress. Target audience: vehicle owners, fleet managers, wrap enthusiasts.
Focus: wrap care content, product showcases, before/after galleries, local SEO.

ALWAYS ask which brand a task is for if not obvious from context.

## What You Can Do
1. **Query the platform** — Pull render stats, customer data, subscription breakdowns, popular vehicles
2. **Create & track marketing tasks** — Email campaigns, social posts, design briefs, blog drafts, ad copy, SEO tasks. All stored in DB with brand tags.
3. **Draft content** — Blog posts, email copy, social captions, ad copy, product descriptions. You write publish-ready content, not outlines.
4. **Marketing strategy** — Campaign plans, audience analysis, funnel optimization, competitive positioning
5. **Dev partner** — Discuss architecture, suggest features, debug issues, prioritize backlog
6. **Answer questions** — Product, pricing, features, wrap industry knowledge

## Communication Style
- Use Slack mrkdwn: *bold*, _italic_, \`code\`, > quotes, bullet lists
- Be concise but thorough — senior team energy, not intern energy
- Format data as readable tables or lists
- Proactively suggest next steps
- When creating content, deliver the FULL draft, not bullet points

## Brand Voice Guidelines
- RestyleProAi: Professional, tech-forward, innovative. "The future of wrap visualization."
- WePrintWraps: Approachable, expert, trustworthy. "Your wrap, done right."`;

// ─── Tool Definitions ───────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "query_renders",
    description:
      "Query vehicle render images from the RestylePro database. Returns render history with vehicle info, product type, and timestamps.",
    input_schema: {
      type: "object" as const,
      properties: {
        vehicle_make: { type: "string", description: "Filter by vehicle make (partial match)" },
        vehicle_model: { type: "string", description: "Filter by vehicle model (partial match)" },
        product_type: { type: "string", description: "Filter by product type" },
        days_back: { type: "number", description: "Only show renders from the last N days (default: 30)" },
        limit: { type: "number", description: "Max results (default 10, max 50)" },
      },
    },
  },
  {
    name: "query_customers",
    description:
      "Look up customer/user subscription info: tier, status, render count, billing cycle.",
    input_schema: {
      type: "object" as const,
      properties: {
        email: { type: "string", description: "Search by email (partial match)" },
        tier: { type: "string", description: "Filter by tier (free, starter, advanced, complete, agency)" },
        status: { type: "string", description: "Filter by status (active, cancelled, etc.)" },
        limit: { type: "number", description: "Max results (default 10)" },
      },
    },
  },
  {
    name: "get_platform_stats",
    description: "Get aggregate platform statistics and metrics for RestylePro.",
    input_schema: {
      type: "object" as const,
      properties: {
        metric: {
          type: "string",
          enum: [
            "total_renders",
            "active_subscribers",
            "popular_vehicles",
            "recent_activity",
            "subscription_breakdown",
            "renders_today",
            "renders_this_week",
            "proof_stats",
          ],
          description: "Which metric to retrieve",
        },
      },
      required: ["metric"],
    },
  },
  {
    name: "create_marketing_task",
    description:
      "Create a tracked marketing task. Use for any marketing work: email campaigns, social posts, blog drafts, design briefs, ad copy, SEO tasks. Stores full draft content in metadata. ALWAYS specify the brand.",
    input_schema: {
      type: "object" as const,
      properties: {
        brand: {
          type: "string",
          enum: ["restylepro", "weprintwraps"],
          description: "Which brand this task is for",
        },
        task_type: {
          type: "string",
          enum: ["email_campaign", "social_post", "design_request", "blog_post", "ad_campaign", "seo_task", "other"],
        },
        title: { type: "string", description: "Short task title" },
        description: { type: "string", description: "Full task description or draft content" },
        priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
        details: {
          type: "object",
          description: "Structured details: target_audience, campaign_goals, draft_copy, design_specs, keywords, etc.",
        },
      },
      required: ["brand", "task_type", "title", "description"],
    },
  },
  {
    name: "list_marketing_tasks",
    description: "List existing marketing tasks, optionally filtered by brand, status, or type.",
    input_schema: {
      type: "object" as const,
      properties: {
        brand: { type: "string", enum: ["restylepro", "weprintwraps"], description: "Filter by brand" },
        status: { type: "string", enum: ["pending", "in_progress", "completed", "cancelled"] },
        task_type: { type: "string", description: "Filter by task type" },
        limit: { type: "number", description: "Max results (default 10)" },
      },
    },
  },
  {
    name: "update_marketing_task",
    description: "Update status or add notes to an existing marketing task.",
    input_schema: {
      type: "object" as const,
      properties: {
        task_id: { type: "string", description: "UUID of the task" },
        status: { type: "string", enum: ["pending", "in_progress", "completed", "cancelled"] },
        notes: { type: "string", description: "Notes or updated content to append" },
      },
      required: ["task_id"],
    },
  },
  {
    name: "query_proofs",
    description: "Query customer proofs/approvals. Shows which designs were sent for approval and their status.",
    input_schema: {
      type: "object" as const,
      properties: {
        customer_email: { type: "string", description: "Filter by customer email" },
        status: { type: "string", description: "Filter by status (pending, approved, etc.)" },
        tool_name: { type: "string", description: "Filter by tool (ColorPro, DesignPro, etc.)" },
        limit: { type: "number", description: "Max results (default 10)" },
      },
    },
  },
  {
    name: "query_email_subscribers",
    description: "Query email subscriber list. Useful for audience sizing and segmentation.",
    input_schema: {
      type: "object" as const,
      properties: {
        source: { type: "string", description: "Filter by signup source" },
        limit: { type: "number", description: "Max results (default 20)" },
      },
    },
  },
];

// ─── Supabase Client ────────────────────────────────────────────────────────

function getSupabase() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// ─── Slack Helpers ──────────────────────────────────────────────────────────

async function postToSlack(channel: string, text: string, threadTs?: string) {
  const token = Deno.env.get("SLACK_BOT_TOKEN");
  if (!token) {
    console.error("[SLACK-AGENT] SLACK_BOT_TOKEN not set");
    return;
  }

  // Slack has a 3000 char limit per message — split if needed
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 3000) {
    let splitAt = remaining.lastIndexOf("\n", 3000);
    if (splitAt < 1000) splitAt = 3000;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  chunks.push(remaining);

  for (const chunk of chunks) {
    const body: Record<string, string> = { channel, text: chunk };
    if (threadTs) body.thread_ts = threadTs;

    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const result = await res.json();
    if (!result.ok) {
      console.error("[SLACK-AGENT] Slack postMessage failed:", result.error);
    }
  }
}

async function addReaction(channel: string, timestamp: string, emoji: string) {
  const token = Deno.env.get("SLACK_BOT_TOKEN");
  if (!token) return;
  await fetch("https://slack.com/api/reactions.add", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ channel, timestamp, name: emoji }),
  }).catch(() => {});
}

// ─── Conversation Memory ────────────────────────────────────────────────────

async function loadConversation(supabase: ReturnType<typeof createClient>, channelId: string, threadTs: string | null) {
  const key = threadTs || channelId;
  const { data } = await supabase
    .from("slack_agent_conversations")
    .select("messages")
    .eq("thread_key", key)
    .maybeSingle();
  return data?.messages || [];
}

async function saveConversation(
  supabase: ReturnType<typeof createClient>,
  channelId: string,
  threadTs: string | null,
  messages: unknown[],
) {
  const key = threadTs || channelId;
  const trimmed = messages.slice(-MAX_CONVERSATION_MESSAGES);
  await supabase.from("slack_agent_conversations").upsert(
    {
      thread_key: key,
      channel_id: channelId,
      thread_ts: threadTs,
      messages: trimmed,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "thread_key" },
  );
}

// ─── Tool Executors ─────────────────────────────────────────────────────────

interface SlackContext {
  channel: string;
  threadTs?: string;
  userId?: string;
}

async function executeTool(
  supabase: ReturnType<typeof createClient>,
  toolName: string,
  input: Record<string, unknown>,
  ctx: SlackContext,
): Promise<string> {
  try {
    switch (toolName) {
      // ── Renders ───────────────────────────────────────────────────────
      case "query_renders": {
        let query = supabase
          .from("vehicle_render_images")
          .select("id, vehicle_make, vehicle_model, vehicle_type, product_type, swatch_id, is_active, created_at")
          .order("created_at", { ascending: false })
          .limit(Math.min((input.limit as number) || 10, 50));

        if (input.vehicle_make) query = query.ilike("vehicle_make", `%${input.vehicle_make}%`);
        if (input.vehicle_model) query = query.ilike("vehicle_model", `%${input.vehicle_model}%`);
        if (input.product_type) query = query.eq("product_type", input.product_type as string);
        if (input.days_back) {
          const since = new Date();
          since.setDate(since.getDate() - (input.days_back as number));
          query = query.gte("created_at", since.toISOString());
        }

        const { data, error } = await query;
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ count: data?.length || 0, renders: data || [] });
      }

      // ── Customers ─────────────────────────────────────────────────────
      case "query_customers": {
        let query = supabase
          .from("user_subscriptions")
          .select("id, email, tier, status, render_count, render_reset_date, billing_cycle_start, billing_cycle_end, created_at")
          .order("created_at", { ascending: false })
          .limit(Math.min((input.limit as number) || 10, 50));

        if (input.email) query = query.ilike("email", `%${input.email}%`);
        if (input.tier) query = query.eq("tier", input.tier as string);
        if (input.status) query = query.eq("status", input.status as string);

        const { data, error } = await query;
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ count: data?.length || 0, customers: data || [] });
      }

      // ── Platform Stats ────────────────────────────────────────────────
      case "get_platform_stats": {
        const metric = input.metric as string;

        if (metric === "total_renders") {
          const { count } = await supabase
            .from("vehicle_render_images")
            .select("*", { count: "exact", head: true });
          return JSON.stringify({ metric, value: count });
        }

        if (metric === "active_subscribers") {
          const { count } = await supabase
            .from("user_subscriptions")
            .select("*", { count: "exact", head: true })
            .eq("status", "active");
          return JSON.stringify({ metric, value: count });
        }

        if (metric === "subscription_breakdown") {
          const { data } = await supabase.from("user_subscriptions").select("tier, status");
          const breakdown: Record<string, number> = {};
          (data || []).forEach((s: { tier: string; status: string }) => {
            const key = `${s.tier}_${s.status}`;
            breakdown[key] = (breakdown[key] || 0) + 1;
          });
          return JSON.stringify({ metric, breakdown });
        }

        if (metric === "popular_vehicles") {
          const { data } = await supabase
            .from("vehicle_render_images")
            .select("vehicle_make, vehicle_model")
            .not("vehicle_make", "is", null)
            .limit(500);
          const counts: Record<string, number> = {};
          (data || []).forEach((r: { vehicle_make: string; vehicle_model: string }) => {
            const key = `${r.vehicle_make} ${r.vehicle_model}`.trim();
            if (key) counts[key] = (counts[key] || 0) + 1;
          });
          const sorted = Object.entries(counts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([vehicle, count]) => ({ vehicle, count }));
          return JSON.stringify({ metric, vehicles: sorted });
        }

        if (metric === "recent_activity") {
          const since = new Date();
          since.setDate(since.getDate() - 7);
          const { data } = await supabase
            .from("vehicle_render_images")
            .select("id, vehicle_make, vehicle_model, product_type, created_at")
            .gte("created_at", since.toISOString())
            .order("created_at", { ascending: false })
            .limit(20);
          return JSON.stringify({ metric, last_7_days: data || [] });
        }

        if (metric === "renders_today") {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const { count } = await supabase
            .from("vehicle_render_images")
            .select("*", { count: "exact", head: true })
            .gte("created_at", today.toISOString());
          return JSON.stringify({ metric, value: count });
        }

        if (metric === "renders_this_week") {
          const weekAgo = new Date();
          weekAgo.setDate(weekAgo.getDate() - 7);
          const { count } = await supabase
            .from("vehicle_render_images")
            .select("*", { count: "exact", head: true })
            .gte("created_at", weekAgo.toISOString());
          return JSON.stringify({ metric, value: count });
        }

        if (metric === "proof_stats") {
          const { count: total } = await supabase
            .from("proofs")
            .select("*", { count: "exact", head: true });
          const { count: approved } = await supabase
            .from("proofs")
            .select("*", { count: "exact", head: true })
            .eq("status", "approved");
          return JSON.stringify({ metric, total_proofs: total, approved });
        }

        return JSON.stringify({ error: `Unknown metric: ${metric}` });
      }

      // ── Marketing Tasks ───────────────────────────────────────────────
      case "create_marketing_task": {
        const { data, error } = await supabase
          .from("slack_agent_tasks")
          .insert({
            brand: input.brand || "restylepro",
            task_type: input.task_type,
            title: input.title,
            description: input.description,
            priority: input.priority || "medium",
            metadata: input.details || {},
            channel_id: ctx.channel,
            thread_ts: ctx.threadTs || null,
            created_by: ctx.userId || "unknown",
            status: "pending",
          })
          .select()
          .single();

        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ created: true, task: data });
      }

      case "list_marketing_tasks": {
        let query = supabase
          .from("slack_agent_tasks")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(Math.min((input.limit as number) || 10, 50));

        if (input.brand) query = query.eq("brand", input.brand as string);
        if (input.status) query = query.eq("status", input.status as string);
        if (input.task_type) query = query.eq("task_type", input.task_type as string);

        const { data, error } = await query;
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ count: data?.length || 0, tasks: data || [] });
      }

      case "update_marketing_task": {
        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (input.status) updates.status = input.status;

        if (input.notes) {
          const { data: existing } = await supabase
            .from("slack_agent_tasks")
            .select("metadata")
            .eq("id", input.task_id as string)
            .single();
          const meta = (existing?.metadata as Record<string, unknown>) || {};
          const notes = (meta.notes as Array<{ text: string; at: string }>) || [];
          notes.push({ text: input.notes as string, at: new Date().toISOString() });
          meta.notes = notes;
          updates.metadata = meta;
        }

        const { data, error } = await supabase
          .from("slack_agent_tasks")
          .update(updates)
          .eq("id", input.task_id as string)
          .select()
          .single();

        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ updated: true, task: data });
      }

      // ── Proofs ────────────────────────────────────────────────────────
      case "query_proofs": {
        let query = supabase
          .from("proofs")
          .select("id, customer_email, customer_name, tool_name, status, vehicle_info, film_or_design_name, created_at, approved_at")
          .order("created_at", { ascending: false })
          .limit(Math.min((input.limit as number) || 10, 50));

        if (input.customer_email) query = query.ilike("customer_email", `%${input.customer_email}%`);
        if (input.status) query = query.eq("status", input.status as string);
        if (input.tool_name) query = query.ilike("tool_name", `%${input.tool_name}%`);

        const { data, error } = await query;
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ count: data?.length || 0, proofs: data || [] });
      }

      // ── Email Subscribers ─────────────────────────────────────────────
      case "query_email_subscribers": {
        let query = supabase
          .from("email_subscribers")
          .select("id, email, source, created_at")
          .order("created_at", { ascending: false })
          .limit(Math.min((input.limit as number) || 20, 100));

        if (input.source) query = query.eq("source", input.source as string);

        const { data, error } = await query;
        if (error) return JSON.stringify({ error: error.message });

        const { count } = await supabase
          .from("email_subscribers")
          .select("*", { count: "exact", head: true });

        return JSON.stringify({ total_subscribers: count, showing: data?.length || 0, subscribers: data || [] });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (err) {
    console.error(`[SLACK-AGENT] Tool ${toolName} error:`, err);
    return JSON.stringify({ error: `Tool execution failed: ${(err as Error).message}` });
  }
}

// ─── Claude Tool-Use Loop ───────────────────────────────────────────────────

async function runClaudeLoop(
  supabase: ReturnType<typeof createClient>,
  userMessage: string,
  history: unknown[],
  ctx: SlackContext,
): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return "⚠️ ANTHROPIC_API_KEY not configured.";

  const messages = [...history, { role: "user", content: userMessage }];
  let rounds = 0;

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;

    const res = await fetch(CLAUDE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      }),
      signal: AbortSignal.timeout(55_000),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[SLACK-AGENT] Claude ${res.status}: ${errText.slice(0, 300)}`);
      return "⚠️ AI temporarily unavailable. Try again in a moment.";
    }

    const result = await res.json();
    messages.push({ role: "assistant", content: result.content });

    // Final text response — done
    if (result.stop_reason === "end_turn") {
      const text = result.content
        .filter((b: { type: string }) => b.type === "text")
        .map((b: { text: string }) => b.text)
        .join("\n");

      await saveConversation(supabase, ctx.channel, ctx.threadTs || null, messages);
      return text || "_(No response generated)_";
    }

    // Tool use — execute and loop
    if (result.stop_reason === "tool_use") {
      const toolBlocks = result.content.filter((b: { type: string }) => b.type === "tool_use");
      const toolResults: unknown[] = [];

      for (const tool of toolBlocks) {
        console.log(`[SLACK-AGENT] Tool: ${tool.name}`, JSON.stringify(tool.input).slice(0, 200));
        const output = await executeTool(supabase, tool.name, tool.input, ctx);
        toolResults.push({ type: "tool_result", tool_use_id: tool.id, content: output });
      }

      messages.push({ role: "user", content: toolResults });
    }
  }

  return "⚠️ Reached max processing rounds. Simplify your request.";
}

// ─── Slack Signature Verification ───────────────────────────────────────────

async function verifySlackSignature(req: Request, body: string): Promise<boolean> {
  const secret = Deno.env.get("SLACK_SIGNING_SECRET");
  if (!secret) {
    console.warn("[SLACK-AGENT] SLACK_SIGNING_SECRET not set — skipping verification");
    return true;
  }

  const timestamp = req.headers.get("x-slack-request-timestamp");
  const signature = req.headers.get("x-slack-signature");
  if (!timestamp || !signature) return false;

  // Reject if older than 5 minutes
  if (Math.abs(Math.floor(Date.now() / 1000) - parseInt(timestamp)) > 300) return false;

  const basestring = `v0:${timestamp}:${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(basestring));
  const computed =
    "v0=" +
    Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  return computed === signature;
}

// ─── Main Handler ───────────────────────────────────────────────────────────

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Slack retries — skip to avoid duplicate processing
  if (req.headers.get("x-slack-retry-num")) {
    console.log("[SLACK-AGENT] Skipping Slack retry");
    return new Response("ok", { status: 200 });
  }

  try {
    const bodyText = await req.text();
    const payload = JSON.parse(bodyText);

    // ── URL Verification Challenge (before sig check) ───────────────
    if (payload.type === "url_verification") {
      return new Response(JSON.stringify({ challenge: payload.challenge }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Verify Slack signature for all other requests
    if (!(await verifySlackSignature(req, bodyText))) {
      console.error("[SLACK-AGENT] Invalid Slack signature");
      return new Response("Invalid signature", { status: 401 });
    }

    // ── Event Callback ──────────────────────────────────────────────
    if (payload.type === "event_callback") {
      const event = payload.event;

      // Only handle messages and app_mention
      if (!event || !["message", "app_mention"].includes(event.type)) {
        return new Response("ok", { status: 200 });
      }

      // Skip bot messages (prevent infinite loops)
      if (event.bot_id || event.subtype === "bot_message") {
        return new Response("ok", { status: 200 });
      }

      // Skip edits, deletes, joins, etc.
      if (event.subtype && event.subtype !== "file_share") {
        return new Response("ok", { status: 200 });
      }

      const channel = event.channel;
      const threadTs = event.thread_ts || event.ts;
      const userId = event.user;

      // Strip bot mention from message text
      const cleanMessage = (event.text || "").replace(/<@[A-Z0-9]+>/g, "").trim();
      if (!cleanMessage) {
        return new Response("ok", { status: 200 });
      }

      console.log(`[SLACK-AGENT] ${userId} in ${channel}: ${cleanMessage.slice(0, 100)}`);

      const supabase = getSupabase();

      // Dedup check
      const eventId = payload.event_id || `${event.ts}-${channel}`;
      const { data: existing } = await supabase
        .from("slack_agent_processed_events")
        .select("event_id")
        .eq("event_id", eventId)
        .maybeSingle();

      if (existing) {
        console.log("[SLACK-AGENT] Duplicate event, skipping");
        return new Response("ok", { status: 200 });
      }

      // Mark as processing
      await supabase.from("slack_agent_processed_events").insert({ event_id: eventId }).single();

      // ── RETIRED ────────────────────────────────────────────────────────
      // Owner, 2026-08-06: "Retire 3100 Slack Agent."
      //
      // This used to forward every mention to an agent server on the shared
      // DigitalOcean droplet, defaulting to a HARDCODED `143.110.237.145:3100`
      // when AGENT_SERVER_URL was unset. That host is being repurposed, so the
      // fallback would have become a call into a dead or reassigned port —
      // and because the fetch was fire-and-forget with only a `.catch` that
      // logs, every message would have failed SILENTLY. Slack would show a
      // bot that read your message and never answered.
      //
      // So the forward is gone entirely, along with the hardcoded IP. Nothing
      // in this function reaches port 3100 any more.
      //
      // It ANSWERS rather than going quiet: a retired integration that still
      // ACKs the webhook but never replies is indistinguishable from a broken
      // one, and somebody would spend an afternoon debugging it. One clear
      // message, in-thread, and the event is done.
      //
      // Deliberately unchanged: WrapGuru and its "Free file check" (pure app
      // + `wpw-sales-chat` / `seo-aeo-publish` edge functions — they never
      // touched :3100), and VectorizIt on :3200, which is a different service
      // on the same host and stays live for DesignPro ProductionFlow.
      console.log("[SLACK-AGENT] Retired — not forwarding to the agent server");

      await postToSlack(
        channel,
        "The Slack Marketing Agent has been retired. Work happens in the Engine Room and the Brand Board now — this channel no longer routes to an agent.",
        threadTs,
      );

      return new Response("ok", { status: 200 });
    }

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("[SLACK-AGENT] Error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
