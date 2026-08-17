/**
 * error-fix-dispatch — kick off the Claude Code fix pipeline for an error.
 *
 * Called by the admin Error Dashboard ("Fix with Claude"). Given an
 * error_events id it:
 *   1. Verifies the caller is an admin/tester.
 *   2. Loads the error row (stack, route, occurrence count, …).
 *   3. Opens a GitHub issue describing the bug, labelled `claude-autofix` and
 *      mentioning @claude so the claude-autofix workflow picks it up and opens
 *      a fix PR.
 *   4. Records the issue on the error row (fix_status / fix_issue_url / …).
 *
 * Secrets required (Supabase function secrets):
 *   - GITHUB_PAT (or GITHUB_TOKEN): repo-scoped token that can open issues.
 *   - GITHUB_REPO (optional): "owner/repo", defaults to Tdill1980/restylepro-os.
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY are injected.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const DEFAULT_REPO = "Tdill1980/restylepro-os";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const ghToken = Deno.env.get("GITHUB_PAT") ?? Deno.env.get("GITHUB_TOKEN");
    const repo = Deno.env.get("GITHUB_REPO") ?? DEFAULT_REPO;

    // ── Auth: identify the caller from their JWT ──────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Missing Authorization header" }, 401);
    }
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Not authenticated" }, 401);

    // Read the request body once (used by both the marketing-edit branch and
    // the error-fix flow below).
    const reqBody = await req.json().catch(() => ({}));

    // ── Marketing-edit branch ─────────────────────────────────────────────
    // The Approval Board's "Request Claude edit" hits this. Any authenticated
    // user may file one (the board is WPW-tenant guarded). Creates the same
    // @claude autofix issue the pipeline already knows how to handle.
    if (reqBody?.kind === "marketing_edit") {
      if (!ghToken) return json({ error: "GITHUB_PAT not configured" }, 500);
      const reqText = String(reqBody.request ?? "").trim();
      if (!reqText) return json({ error: "request is required" }, 400);
      const cardTitle = String(reqBody.title ?? "marketing item")
        .replace(/^🚫.*?·\s*|^⏳.*?·\s*/u, "").trim();
      const mTitle = `[Claude edit] ${cardTitle}`.slice(0, 120);
      const mBody = [
        "@claude — please make this change to the marketing asset and open a PR, then move the board card back to Needs Approval.",
        "",
        `**Card:** ${cardTitle}`,
        reqBody.taskId ? `**Card id:** \`${reqBody.taskId}\`` : "",
        `**Requested by:** ${user.email ?? user.id}`,
        reqBody.boardUrl ? `**Board:** ${reqBody.boardUrl}` : "",
        "",
        "**Requested change:**",
        `> ${reqText.replace(/\n/g, "\n> ")}`,
        "",
        "Respect the locks in `CLAUDE.md`.",
      ].filter(Boolean).join("\n");
      const gh = {
        Authorization: `Bearer ${ghToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "restylepro-marketing-edit",
        "Content-Type": "application/json",
      };
      await fetch(`https://api.github.com/repos/${repo}/labels`, {
        method: "POST", headers: gh,
        body: JSON.stringify({ name: "claude-autofix", color: "7c3aed" }),
      }).catch(() => {});
      const r = await fetch(`https://api.github.com/repos/${repo}/issues`, {
        method: "POST", headers: gh,
        body: JSON.stringify({ title: mTitle, body: mBody, labels: ["claude-autofix"] }),
      });
      const iss = await r.json();
      if (!r.ok) return json({ error: `GitHub: ${iss?.message ?? r.status}` }, 502);
      return json({ ok: true, issue_number: iss.number, issue_url: iss.html_url });
    }

    // ── Authorize: admin or tester only (error-fix flow) ──────────────────
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .in("role", ["admin", "tester"]);
    if (!roles || roles.length === 0) {
      return json({ error: "Forbidden — admin only" }, 403);
    }

    const errorId = reqBody?.errorId;
    if (!errorId) return json({ error: "errorId is required" }, 400);

    // ── Load the error ────────────────────────────────────────────────────
    const { data: ev, error: evErr } = await admin
      .from("error_events")
      .select("*")
      .eq("id", errorId)
      .maybeSingle();
    if (evErr) return json({ error: `DB error: ${evErr.message}` }, 500);
    if (!ev) return json({ error: "Error event not found" }, 404);

    if (!ghToken) {
      // Record the intent but tell the caller the pipeline isn't wired yet.
      await admin
        .from("error_events")
        .update({ fix_status: "failed", fix_error: "GITHUB_PAT secret not configured" })
        .eq("id", errorId);
      return json(
        { error: "GitHub is not configured. Set the GITHUB_PAT function secret to enable auto-fix." },
        500,
      );
    }

    // ── Build the issue ──────────────────────────────────────────────────
    const title = `[autofix] ${ev.error_name ? ev.error_name + ": " : ""}${String(ev.message).slice(0, 120)}`;
    const body = [
      "@claude — please investigate and fix this production error.",
      "",
      "A user-facing error was captured by the in-app error dashboard. Find the root",
      "cause in the codebase, implement a **minimal** fix, and open a PR that closes",
      "this issue. Do **not** modify the locked render-pipeline files listed in",
      "`CLAUDE.md` without explicit approval.",
      "",
      "### Error",
      "```",
      `${ev.error_name ?? "Error"}: ${ev.message}`,
      "```",
      "",
      "| Field | Value |",
      "| --- | --- |",
      `| Severity | \`${ev.severity}\` |`,
      `| Source | \`${ev.source}\` |`,
      `| Occurrences | ${ev.occurrence_count} |`,
      `| Route | \`${ev.route ?? "—"}\` |`,
      `| URL | ${ev.url ?? "—"} |`,
      `| App version | \`${ev.app_version ?? "unknown"}\` |`,
      `| First seen | ${ev.first_seen_at} |`,
      `| Last seen | ${ev.last_seen_at} |`,
      `| Fingerprint | \`${ev.fingerprint}\` |`,
      "",
      ev.stack ? "### Stack trace\n```\n" + String(ev.stack).slice(0, 6000) + "\n```" : "",
      ev.component_stack
        ? "### React component stack\n```\n" + String(ev.component_stack).slice(0, 3000) + "\n```"
        : "",
      "",
      "---",
      `_Dispatched from the Error Dashboard by ${user.email ?? user.id} · error_events id \`${ev.id}\`_`,
    ]
      .filter(Boolean)
      .join("\n");

    const ghHeaders = {
      Authorization: `Bearer ${ghToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "restylepro-error-fix-dispatch",
      "Content-Type": "application/json",
    };

    // Best-effort: ensure the label exists (ignore "already exists" 422).
    await fetch(`https://api.github.com/repos/${repo}/labels`, {
      method: "POST",
      headers: ghHeaders,
      body: JSON.stringify({ name: "claude-autofix", color: "7c3aed", description: "Auto-fix dispatched from the Error Dashboard" }),
    }).catch(() => {});

    // Create the issue.
    const ghRes = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: "POST",
      headers: ghHeaders,
      body: JSON.stringify({ title, body, labels: ["claude-autofix"] }),
    });
    const issue = await ghRes.json();

    if (!ghRes.ok) {
      const msg = issue?.message ?? `GitHub API ${ghRes.status}`;
      await admin
        .from("error_events")
        .update({ fix_status: "failed", fix_error: String(msg).slice(0, 500) })
        .eq("id", errorId);
      return json({ error: `GitHub: ${msg}` }, 502);
    }

    // Record success on the error row.
    await admin
      .from("error_events")
      .update({
        fix_status: "dispatched",
        fix_issue_number: issue.number,
        fix_issue_url: issue.html_url,
        fix_dispatched_at: new Date().toISOString(),
        fix_dispatched_by: user.id,
        fix_error: null,
        status: ev.status === "open" ? "acknowledged" : ev.status,
      })
      .eq("id", errorId);

    return json({ ok: true, issue_number: issue.number, issue_url: issue.html_url });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
