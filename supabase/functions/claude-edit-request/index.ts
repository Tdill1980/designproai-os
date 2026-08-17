// claude-edit-request
// Turns a board "Request Claude edit" into a GitHub issue that Claude Code
// picks up (via @claude mention). Uses the GITHUB_PAT secret server-side so no
// token is ever exposed to the browser.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const REPO = "Tdill1980/restylepro-os";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { taskId, title, request, requestedBy, boardUrl } = await req.json();
    if (!request || !String(request).trim()) {
      return json({ ok: false, error: "Empty request" }, 400);
    }
    const pat = Deno.env.get("GITHUB_PAT");
    if (!pat) return json({ ok: false, error: "GITHUB_PAT not configured" }, 500);

    const cardTitle = String(title || "marketing item").replace(/^🚫.*?·\s*|^⏳.*?·\s*/u, "").trim();
    const body = [
      `@claude please make this change to the marketing asset below, then push the fix and move the card back to **Needs Approval**.`,
      ``,
      `**Card:** ${cardTitle}`,
      taskId ? `**Card id:** \`${taskId}\`` : "",
      requestedBy ? `**Requested by:** ${requestedBy}` : "",
      boardUrl ? `**Board:** ${boardUrl}` : "",
      ``,
      `**Requested change:**`,
      `> ${String(request).trim().replace(/\n/g, "\n> ")}`,
      ``,
      `_Filed automatically from the Marketing Approval Board._`,
    ].filter(Boolean).join("\n");

    const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${pat}`,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "restylepro-approval-board",
      },
      body: JSON.stringify({
        title: `[Claude edit] ${cardTitle}`.slice(0, 120),
        body,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return json({ ok: false, error: data?.message || "GitHub issue create failed", status: res.status }, 502);
    }
    return json({ ok: true, issue_url: data.html_url, issue_number: data.number });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
