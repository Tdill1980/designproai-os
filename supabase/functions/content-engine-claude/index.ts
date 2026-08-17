/**
 * content-engine-claude — Multi-turn Claude content partner.
 *
 * Caller flow:
 *   1. Admin UI resolves user's Supabase JWT and picks a brand_id +
 *      optional conversation_id (new conversations are created if omitted).
 *   2. UI POSTs { brand_id, conversation_id?, user_message } and receives
 *      { conversation_id, assistant_message, usage }.
 *   3. Message history + brand brain are reloaded server-side every turn so
 *      clients can't forge state and prompt caching hits the brand brain
 *      block on every request.
 *
 * Env:
 *   OPENAI_API_KEY           — required (copy brain; Anthropic was out of credits)
 *   SUPABASE_URL             — auto
 *   SUPABASE_SERVICE_ROLE_KEY — auto
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-6";
// Switched to OpenAI (Anthropic account out of credits). CLAUDE_* retained but unused.
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o";
const MAX_TOKENS = 4096;
const MAX_HISTORY_MESSAGES = 40;

type Role = "user" | "assistant";
type MessageContent =
  | string
  | Array<{ type: string; text?: string; [k: string]: unknown }>;

interface BrandRow {
  id: string;
  owner_id: string;
  slug: string;
  name: string;
  tagline: string | null;
  brand_brain: Record<string, unknown>;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function buildBrandSystemPrompt(brand: BrandRow): string {
  const brain = brand.brand_brain ?? {};
  const taglineLine = brand.tagline ? `Tagline: ${brand.tagline}\n` : "";
  return `You are the in-house content lead for ${brand.name}.
${taglineLine}
You write in this brand's voice at all times. When the operator gives vague
direction ("make me a reel about the new service"), you ask one sharp
clarifying question OR propose a complete first draft — never both. Default
to proposing a first draft and iterating from feedback.

You write finished copy, not instructions about copy. Give hooks, headlines,
body, and CTAs as clean deliverables the operator can paste into templates
or feed to an image generator. Use line breaks generously so the operator
can skim.

BRAND BRAIN (source of truth — weight every response against this):
\`\`\`json
${JSON.stringify(brain, null, 2)}
\`\`\`

Hard rules:
- Never invent features, prices, guarantees, or claims not in the brand brain.
- If the operator asks for something that contradicts the brand brain, push
  back in one sentence and offer the on-brand alternative.
- No "guaranteed results", "instant", "get rich", "no risk" — pure compliance.
- Keep replies under 400 words unless the operator asks for a full calendar
  or long-form script.`;
}

async function loadBrand(
  db: ReturnType<typeof createClient>,
  brandId: string,
  userId: string,
): Promise<BrandRow | null> {
  const { data, error } = await db
    .from("brands")
    .select("id, owner_id, slug, name, tagline, brand_brain")
    .eq("id", brandId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (error) {
    console.error("[content-engine] brand load error", error);
    return null;
  }
  return (data as BrandRow) ?? null;
}

async function loadHistory(
  db: ReturnType<typeof createClient>,
  conversationId: string,
  userId: string,
): Promise<Array<{ role: Role; content: MessageContent }>> {
  const { data, error } = await db
    .from("content_messages")
    .select("role, content, created_at")
    .eq("conversation_id", conversationId)
    .eq("owner_id", userId)
    .order("created_at", { ascending: true })
    .limit(MAX_HISTORY_MESSAGES);
  if (error) {
    console.error("[content-engine] history load error", error);
    return [];
  }
  return (data ?? []).map((r) => ({
    role: r.role as Role,
    content: r.content as MessageContent,
  }));
}

async function ensureConversation(
  db: ReturnType<typeof createClient>,
  opts: { conversationId: string | null; brandId: string; userId: string; seedTitle: string },
): Promise<string | null> {
  if (opts.conversationId) {
    const { data } = await db
      .from("content_conversations")
      .select("id")
      .eq("id", opts.conversationId)
      .eq("owner_id", opts.userId)
      .maybeSingle();
    if (data?.id) return data.id;
  }
  const title = opts.seedTitle.slice(0, 80) || "New conversation";
  const { data, error } = await db
    .from("content_conversations")
    .insert({ owner_id: opts.userId, brand_id: opts.brandId, title })
    .select("id")
    .single();
  if (error) {
    console.error("[content-engine] conversation create error", error);
    return null;
  }
  return data.id;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    return json({ error: "OPENAI_API_KEY not configured" }, 500);
  }

  // Identify caller from the forwarded JWT.
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Missing bearer token" }, 401);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  const { data: userData, error: userErr } = await authClient.auth.getUser(jwt);
  if (userErr || !userData?.user?.id) {
    return json({ error: "Unauthorized" }, 401);
  }
  const userId = userData.user.id;

  // Service-role client for DB writes bound to owner_id = userId (RLS-safe).
  const db = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  let payload: {
    brand_id?: string;
    conversation_id?: string | null;
    user_message?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { brand_id, conversation_id, user_message } = payload;
  if (!brand_id || !user_message?.trim()) {
    return json({ error: "brand_id and user_message are required" }, 400);
  }

  const brand = await loadBrand(db, brand_id, userId);
  if (!brand) return json({ error: "Brand not found" }, 404);

  const conversationId = await ensureConversation(db, {
    conversationId: conversation_id ?? null,
    brandId: brand_id,
    userId,
    seedTitle: user_message,
  });
  if (!conversationId) return json({ error: "Could not create conversation" }, 500);

  const history = await loadHistory(db, conversationId, userId);
  const messages = [
    ...history,
    { role: "user" as Role, content: user_message },
  ];

  // Persist the user turn immediately so a Claude failure doesn't lose it.
  await db.from("content_messages").insert({
    conversation_id: conversationId,
    owner_id: userId,
    role: "user",
    content: user_message,
  });

  // Prompt caching: mark the brand-brain system block as ephemeral so every
  // follow-up turn hits the cache. Saves ~90% on input tokens for repeat chats.
  const systemText = buildBrandSystemPrompt(brand);

  let claudeRes: Response;
  try {
    claudeRes = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: "system", content: systemText },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      }),
      signal: AbortSignal.timeout(55_000),
    });
  } catch (err) {
    console.error("[content-engine] OpenAI network error", err);
    return json({ error: "OpenAI request failed" }, 502);
  }

  if (!claudeRes.ok) {
    const errText = await claudeRes.text();
    console.error(`[content-engine] OpenAI ${claudeRes.status}: ${errText.slice(0, 400)}`);
    return json({ error: "OpenAI API error", status: claudeRes.status }, 502);
  }

  const result = await claudeRes.json();
  const assistantText = (result.choices?.[0]?.message?.content ?? "").trim();

  // Persist assistant turn. OpenAI returns a plain string; store it directly.
  await db.from("content_messages").insert({
    conversation_id: conversationId,
    owner_id: userId,
    role: "assistant",
    content: assistantText,
  });

  // Touch conversation updated_at so recent chats sort to the top.
  await db
    .from("content_conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("owner_id", userId);

  return json({
    conversation_id: conversationId,
    assistant_message: assistantText,
    usage: result.usage ?? null,
    stop_reason: result.choices?.[0]?.finish_reason ?? null,
  });
});
