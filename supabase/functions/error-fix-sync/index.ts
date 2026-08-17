/**
 * error-fix-sync — closes the self-fix loop for the Error Dashboard.
 *
 * Runs every 5 minutes via pg_cron (migration 20260611120000_error_fix_sync.sql)
 * and uses the same GITHUB_PAT secret as error-fix-dispatch. Each run advances
 * every error through the pipeline with no human action required:
 *
 *   A. AUTO-DISPATCH — open errors with a usable stack (severity error/fatal)
 *      get a `claude-autofix` GitHub issue automatically, so the system
 *      self-fixes without anyone clicking "Fix with Claude". Rows whose
 *      dispatch previously failed (e.g. PAT missing) are retried.
 *   B. PR DISCOVERY — for dispatched issues, find Claude's fix branch
 *      (`claude/issue-<n>-…`). If the Claude Code Action pushed a branch but
 *      didn't open the PR, open it here — PAT-created PRs trigger CI normally
 *      (GITHUB_TOKEN-created ones don't).
 *   C. MERGE + DEPLOY — open fix PRs are squash-merged only when SAFE: every
 *      completed check green, no protected path touched (locked render
 *      pipeline, _shared, migrations, .github, build config), and a small
 *      diff. Merging to main triggers the Vercel production deploy, so the
 *      row becomes fix_status='deployed' and the error status='resolved'.
 *      Anything risky is HELD with the reason in fix_error for human review —
 *      nothing protected ever auto-deploys.
 *
 * Secrets: GITHUB_PAT (required), GITHUB_REPO (optional, defaults below).
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

// Same safety policy as .github/workflows/sprocket-safe-automerge.yml — any
// protected path or oversized diff means the PR is held for a human.
const PROTECTED = [
  /^supabase\/functions\/_shared\//,
  /^supabase\/functions\/generate-color-render\//,
  /^supabase\/functions\/design-panel-ai-generate\//,
  /^supabase\/functions\/panelizer-step-fill\//,
  /^supabase\/config\.toml$/,
  /^supabase\/migrations\//,
  /^\.github\//,
  /^package(-lock)?\.json$/,
  /^(vite|vitest|tailwind)\.config\.[tj]s$/,
  /^tsconfig.*\.json$/,
  /^src\/hooks\/use(ColorPro|DesignPro|FadeWrap)Logic\.ts$/,
];
const MAX_FILES = 10;
const MAX_LINES = 500;
const MAX_DISPATCH_PER_RUN = 3;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ghToken = Deno.env.get("GITHUB_PAT") ?? Deno.env.get("GITHUB_TOKEN");
  const repo = Deno.env.get("GITHUB_REPO") ?? DEFAULT_REPO;

  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  const summary = {
    ok: true,
    dispatched: 0,
    prs_opened: 0,
    merged: 0,
    held: [] as string[],
    failed: [] as string[],
  };

  if (!ghToken) {
    return json({ ok: false, reason: "GITHUB_PAT secret not configured — pipeline idle" });
  }

  const ghHeaders = {
    Authorization: `Bearer ${ghToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "restylepro-error-fix-sync",
    "Content-Type": "application/json",
  };
  const gh = async (path: string, init?: RequestInit) => {
    const res = await fetch(`https://api.github.com${path}`, { ...init, headers: ghHeaders });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  };

  try {
    const repoInfo = await gh(`/repos/${repo}`);
    if (!repoInfo.ok) {
      return json({ ok: false, reason: `GitHub auth/repo check failed: ${repoInfo.body?.message ?? repoInfo.status}` });
    }
    const baseBranch = repoInfo.body.default_branch ?? "main";

    // ── A. AUTO-DISPATCH new fixable errors ───────────────────────────────
    const { data: candidates } = await db
      .from("error_events")
      .select("*")
      .eq("status", "open")
      .in("severity", ["error", "fatal"])
      .or("fix_status.is.null,and(fix_status.eq.failed,fix_issue_number.is.null)")
      .order("last_seen_at", { ascending: false })
      .limit(25);

    const cutoff = Date.now() - 12 * 3600_000;
    const dispatchable = (candidates ?? [])
      .filter((ev) => (ev.stack ?? "").trim().length >= 40) // skip opaque "Script error." rows
      .filter((ev) => !ev.fix_attempted_at || new Date(ev.fix_attempted_at).getTime() < cutoff)
      .slice(0, MAX_DISPATCH_PER_RUN);

    if (dispatchable.length > 0) {
      // Best-effort: make sure the label exists.
      await gh(`/repos/${repo}/labels`, {
        method: "POST",
        body: JSON.stringify({ name: "claude-autofix", color: "7c3aed", description: "Auto-fix dispatched from the Error Dashboard" }),
      }).catch(() => {});
    }

    for (const ev of dispatchable) {
      await db.from("error_events").update({ fix_attempted_at: new Date().toISOString() }).eq("id", ev.id);

      const title = `[autofix] ${ev.error_name ? ev.error_name + ": " : ""}${String(ev.message).slice(0, 120)}`;
      const body = [
        "@claude — please investigate and fix this production error.",
        "",
        "A user-facing error was captured by the in-app error dashboard. Find the root",
        "cause in the codebase, implement a **minimal** fix, and open a PR that closes",
        "this issue (if you can't open the PR, push your fix branch and the pipeline",
        "will open it for you). Do **not** modify the locked render-pipeline files",
        "listed in `CLAUDE.md` without explicit approval.",
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
        `_Auto-dispatched by the self-fix pipeline (error-fix-sync) · error_events id \`${ev.id}\`_`,
      ]
        .filter(Boolean)
        .join("\n");

      const issue = await gh(`/repos/${repo}/issues`, {
        method: "POST",
        body: JSON.stringify({ title, body, labels: ["claude-autofix"] }),
      });

      if (issue.ok) {
        await db
          .from("error_events")
          .update({
            fix_status: "dispatched",
            fix_issue_number: issue.body.number,
            fix_issue_url: issue.body.html_url,
            fix_dispatched_at: new Date().toISOString(),
            fix_error: null,
            status: "acknowledged",
          })
          .eq("id", ev.id);
        summary.dispatched++;
      } else {
        const msg = String(issue.body?.message ?? `GitHub API ${issue.status}`).slice(0, 500);
        await db.from("error_events").update({ fix_status: "failed", fix_error: msg }).eq("id", ev.id);
        summary.failed.push(`dispatch ${ev.fingerprint}: ${msg}`);
      }
    }

    // ── B. PR DISCOVERY for dispatched issues ─────────────────────────────
    const { data: dispatched } = await db
      .from("error_events")
      .select("*")
      .eq("fix_status", "dispatched")
      .not("fix_issue_number", "is", null)
      .limit(20);

    // One PR listing shared across all dispatched rows.
    let recentPRs: any[] | null = null;
    if ((dispatched ?? []).length > 0) {
      const list = await gh(`/repos/${repo}/pulls?state=all&sort=created&direction=desc&per_page=50`);
      recentPRs = list.ok ? list.body : [];
    }

    for (const ev of dispatched ?? []) {
      const n = ev.fix_issue_number as number;
      const refRx = new RegExp(`#${n}(\\D|$)`);
      const pr = (recentPRs ?? []).find(
        (p) => p.head?.ref?.startsWith(`claude/issue-${n}-`) || refRx.test(p.body ?? ""),
      );

      if (pr) {
        if (pr.merged_at) {
          await db
            .from("error_events")
            .update({ fix_status: "deployed", fix_pr_url: pr.html_url, fix_merged_at: pr.merged_at, fix_error: null, status: "resolved" })
            .eq("id", ev.id);
          summary.merged++;
        } else if (pr.state === "open") {
          await db.from("error_events").update({ fix_status: "pr_opened", fix_pr_url: pr.html_url, fix_error: null }).eq("id", ev.id);
        } else {
          await db.from("error_events").update({ fix_status: "failed", fix_pr_url: pr.html_url, fix_error: "fix PR was closed without merging" }).eq("id", ev.id);
          summary.failed.push(`issue #${n}: PR closed unmerged`);
        }
        continue;
      }

      // No PR yet — did Claude push a fix branch?
      const refs = await gh(`/repos/${repo}/git/matching-refs/heads/claude/issue-${n}`);
      const branch = refs.ok && Array.isArray(refs.body) && refs.body.length > 0
        ? String(refs.body[0].ref).replace(/^refs\/heads\//, "")
        : null;

      if (branch) {
        const issue = await gh(`/repos/${repo}/issues/${n}`);
        const created = await gh(`/repos/${repo}/pulls`, {
          method: "POST",
          body: JSON.stringify({
            title: issue.ok ? issue.body.title : `[autofix] fix for issue #${n}`,
            head: branch,
            base: baseBranch,
            body: `Closes #${n}\n\nAutomated fix PR opened by the self-fix pipeline (error-fix-sync) from Claude's fix branch.`,
          }),
        });
        if (created.ok) {
          await db.from("error_events").update({ fix_status: "pr_opened", fix_pr_url: created.body.html_url, fix_error: null }).eq("id", ev.id);
          summary.prs_opened++;
        } else {
          const msg = String(created.body?.message ?? created.status).slice(0, 300);
          await db.from("error_events").update({ fix_error: `could not open PR from ${branch}: ${msg}` }).eq("id", ev.id);
          summary.failed.push(`issue #${n}: PR creation — ${msg}`);
        }
        continue;
      }

      // No branch either — if the issue got closed with no fix, record that.
      const issue = await gh(`/repos/${repo}/issues/${n}`);
      if (issue.ok && issue.body.state === "closed") {
        await db.from("error_events").update({ fix_status: "failed", fix_error: "issue closed without a fix branch/PR" }).eq("id", ev.id);
        summary.failed.push(`issue #${n}: closed without fix`);
      }
      // Otherwise Claude is still working (or the workflow hasn't run) — wait.
    }

    // ── C. MERGE + DEPLOY open fix PRs ────────────────────────────────────
    const { data: openPRs } = await db
      .from("error_events")
      .select("*")
      .eq("fix_status", "pr_opened")
      .not("fix_pr_url", "is", null)
      .limit(20);

    for (const ev of openPRs ?? []) {
      const prNum = Number((String(ev.fix_pr_url).match(/\/pull\/(\d+)/) ?? [])[1]);
      if (!prNum) continue;

      const prRes = await gh(`/repos/${repo}/pulls/${prNum}`);
      if (!prRes.ok) continue;
      const pr = prRes.body;

      if (pr.merged_at) {
        await db
          .from("error_events")
          .update({ fix_status: "deployed", fix_merged_at: pr.merged_at, fix_error: null, status: "resolved" })
          .eq("id", ev.id);
        summary.merged++;
        continue;
      }
      if (pr.state === "closed") {
        await db.from("error_events").update({ fix_status: "failed", fix_error: "fix PR was closed without merging" }).eq("id", ev.id);
        summary.failed.push(`PR #${prNum}: closed unmerged`);
        continue;
      }
      if (pr.draft) continue;

      // Safety: changed files + size.
      const filesRes = await gh(`/repos/${repo}/pulls/${prNum}/files?per_page=100`);
      const files: any[] = filesRes.ok ? filesRes.body : [];
      const touchedProtected = files.filter((f) => PROTECTED.some((rx) => rx.test(f.filename)));
      const changedLines = files.reduce((t, f) => t + (f.additions ?? 0) + (f.deletions ?? 0), 0);
      const reasons: string[] = [];
      if (touchedProtected.length) reasons.push(`touches protected files: ${touchedProtected.map((f) => f.filename).join(", ")}`);
      if (files.length > MAX_FILES) reasons.push(`too many files (${files.length} > ${MAX_FILES})`);
      if (changedLines > MAX_LINES) reasons.push(`too large (${changedLines} > ${MAX_LINES} lines)`);

      // CI: check runs + commit statuses on the head SHA must all be green.
      const sha = pr.head.sha;
      const checksRes = await gh(`/repos/${repo}/commits/${sha}/check-runs?per_page=100`);
      const runs: any[] = checksRes.ok ? checksRes.body.check_runs ?? [] : [];
      const statusRes = await gh(`/repos/${repo}/commits/${sha}/status`);
      const combined = statusRes.ok ? statusRes.body : { state: "pending", total_count: 0 };

      const pendingRuns = runs.filter((c) => c.status !== "completed");
      const failedRuns = runs.filter(
        (c) => c.status === "completed" && !["success", "neutral", "skipped"].includes(c.conclusion),
      );
      const statusesPending = combined.total_count > 0 && combined.state === "pending";
      const statusesFailed = combined.total_count > 0 && ["failure", "error"].includes(combined.state);
      const anyCi = runs.length > 0 || combined.total_count > 0;
      const prAgeMs = Date.now() - new Date(pr.created_at).getTime();

      if (pendingRuns.length || statusesPending) continue; // checks still running — re-evaluate next run
      if (!anyCi && prAgeMs < 20 * 60_000) continue; // give CI time to start
      if (failedRuns.length) reasons.push(`CI failed: ${failedRuns.map((c) => c.name).join(", ")}`);
      if (statusesFailed) reasons.push(`commit status ${combined.state}`);
      if (!anyCi) reasons.push("no CI checks ran");

      if (reasons.length) {
        await db.from("error_events").update({ fix_error: `held for review: ${reasons.join("; ")}` }).eq("id", ev.id);
        summary.held.push(`PR #${prNum}: ${reasons.join("; ")}`);
        continue;
      }

      const merge = await gh(`/repos/${repo}/pulls/${prNum}/merge`, {
        method: "PUT",
        body: JSON.stringify({ merge_method: "squash" }),
      });
      if (merge.ok) {
        await db
          .from("error_events")
          .update({ fix_status: "deployed", fix_merged_at: new Date().toISOString(), fix_error: null, status: "resolved" })
          .eq("id", ev.id);
        summary.merged++;
        // Merge to main auto-deploys via Vercel; close the issue if "Closes #n" didn't.
        if (ev.fix_issue_number) {
          await gh(`/repos/${repo}/issues/${ev.fix_issue_number}`, {
            method: "PATCH",
            body: JSON.stringify({ state: "closed" }),
          }).catch(() => {});
        }
        await gh(`/repos/${repo}/issues/${prNum}/comments`, {
          method: "POST",
          body: JSON.stringify({ body: "✅ **Auto-merged by the self-fix pipeline** — safe fix (CI green, no protected files). Vercel deploys `main` automatically; the error is marked resolved on the dashboard." }),
        }).catch(() => {});
      } else {
        const msg = String(merge.body?.message ?? merge.status).slice(0, 300);
        await db.from("error_events").update({ fix_error: `merge failed: ${msg}` }).eq("id", ev.id);
        summary.failed.push(`PR #${prNum}: merge — ${msg}`);
      }
    }

    return json(summary);
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
