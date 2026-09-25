// Restricted command adapter for the existing Fast Edge deployment workflow.
// Comments are data, never shell/JavaScript. Only trusted default-branch code runs.
import { readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { APPROVED, classify, requireSha } from './edge-hotfix-policy.mjs';

export const REPOSITORY = 'Tdill1980/designproai-os';
export const REPOSITORY_ID = 1325983419;
export const OWNER_LOGIN = 'Tdill1980';
export const OWNER_ID = 210197216;
export const CONFIRMATION = 'DEPLOY_EDGE_TO_DESIGNPROAI_PRODUCTION';
export const WORKFLOW = 'deploy-edge-hotfix.yml';
const apiRoot = `https://api.github.com/repos/${REPOSITORY}`;
const requireTrue = (value, message) => { if (!value) throw new Error(message); };
const isOwner = user => user?.id === OWNER_ID && user?.login === OWNER_LOGIN && user?.type === 'User';

export function parseCommand(body) {
  requireTrue(typeof body === 'string' && body.length <= 220, 'Invalid command');
  // Exact full-string match: no extra text, newlines, shell fragments or substitutions.
  const match = /^\/(deploy-edge|check-edge) ([a-z0-9-]+) ([0-9a-f]{40}) DEPLOY_EDGE_TO_DESIGNPROAI_PRODUCTION$/.exec(body);
  requireTrue(match && match[0] === body, 'Use the exact single-line deployment command');
  requireTrue(Object.hasOwn(APPROVED, match[2]), 'Function is not Fast Edge approved');
  return { mode: match[1], functionName: match[2], sha: requireSha(match[3]) };
}

export function validateEvent(event, context) {
  requireTrue(context.eventName === 'issue_comment' && event?.action === 'created', 'Only newly created comments are accepted');
  requireTrue(context.runAttempt === 1, 'Do not rerun a command event; post a fresh authorized command');
  requireTrue(context.repository === REPOSITORY && event.repository?.full_name === REPOSITORY && event.repository?.id === REPOSITORY_ID, 'Wrong repository');
  requireTrue(event.repository?.default_branch === 'main' && context.ref === 'refs/heads/main', 'Default branch must be main');
  requireTrue(isOwner(event.sender) && isOwner(event.comment?.user) && context.actor === OWNER_LOGIN && context.triggeringActor === OWNER_LOGIN, 'Only the repository owner may request deployment');
  requireTrue(Number.isSafeInteger(event.issue?.number) && event.issue.number > 0 && !!event.issue.pull_request && event.issue.state === 'closed', 'Command must be on a closed, merged PR');
  requireTrue(Number.isSafeInteger(event.comment?.id) && event.comment.id > 0, 'Invalid comment ID');
  const command = parseCommand(event.comment.body);
  requireTrue(context.sha === command.sha, 'Command SHA differs from event main SHA; resolve current main and post again');
  return { ...command, prNumber: event.issue.number, commentId: event.comment.id };
}

export async function dispatchEdgeComment({ event, context, token, fetchImpl = fetch }) {
  const command = validateEvent(event, context);
  requireTrue(typeof token === 'string' && token.length > 0, 'GitHub workflow token is required');
  async function api(path, body) {
    // Paths are built only from fixed strings and validated integers/hex/function names.
    const result = await fetchImpl(apiRoot + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error', signal: AbortSignal.timeout(30_000),
    });
    requireTrue(result.ok, `GitHub ${body === undefined ? 'read' : 'dispatch'} failed: HTTP ${result.status}`);
    if (body !== undefined) {
      requireTrue(result.status === 204, 'Unexpected dispatch response; inspect Actions before retrying');
      return null;
    }
    return result.json();
  }
  async function checkCurrentMain() {
    const main = await api('/branches/main');
    requireTrue(main.name === 'main' && main.commit?.sha === command.sha, 'Main moved; resolve current main and post a fresh command');
  }
  async function checkComment() {
    const comment = await api(`/issues/comments/${command.commentId}`);
    requireTrue(comment.id === command.commentId && isOwner(comment.user), 'Comment identity changed');
    requireTrue(comment.body === event.comment.body && comment.created_at === comment.updated_at && comment.created_at === event.comment.created_at, 'Edited comments are not deployment authorization');
    requireTrue(comment.issue_url === `${apiRoot}/issues/${command.prNumber}`, 'Comment belongs to a different PR');
  }
  await checkCurrentMain();
  await checkComment();
  const pr = await api(`/pulls/${command.prNumber}`);
  requireTrue(pr.number === command.prNumber && pr.state === 'closed' && pr.merged === true && pr.draft === false, 'PR is not merged');
  requireTrue(pr.base?.ref === 'main' && pr.base.repo?.id === REPOSITORY_ID && pr.base.repo?.full_name === REPOSITORY && pr.head?.repo?.id === REPOSITORY_ID && pr.head.repo?.full_name === REPOSITORY, 'PR must originate and merge in this repository');
  const mergeSha = requireSha(pr.merge_commit_sha);
  const mergedAt = Date.parse(pr.merged_at), commentedAt = Date.parse(event.comment.created_at);
  requireTrue(Number.isFinite(mergedAt) && Number.isFinite(commentedAt) && mergedAt <= commentedAt, 'Command must be posted after the PR was merged');
  const comparison = await api(`/compare/${mergeSha}...${command.sha}`);
  requireTrue(['ahead', 'identical'].includes(comparison.status) && comparison.merge_base_commit?.sha === mergeSha, 'Merged PR is not an ancestor of the requested main');
  const files = [];
  let complete = false;
  for (let page = 1; page <= 30; page++) {
    const batch = await api(`/pulls/${command.prNumber}/files?per_page=100&page=${page}`);
    requireTrue(Array.isArray(batch), 'Invalid PR file response');
    files.push(...batch);
    if (batch.length < 100) { complete = true; break; }
  }
  requireTrue(complete && Number.isSafeInteger(pr.changed_files) && files.length === pr.changed_files, 'PR file listing is incomplete');
  const entries = files.map(file => ({ path: file.filename, status: file.status === 'modified' ? 'M' : file.status === 'added' ? 'A' : 'REJECT' }));
  const scope = classify(entries);
  requireTrue(scope.lane === 'fast-edge' && scope.function_name === command.functionName && scope.source_changed, `PR is not an isolated ${command.functionName} hotfix: ${scope.reason || 'function/scope mismatch'}`);
  // Revalidate immediately before dispatch. The existing deploy script independently
  // checks main again before writing Supabase, and owns all source/JWT/mutex checks.
  await checkComment();
  await checkCurrentMain();
  const inputs = { exact_main_sha: command.sha, function_name: command.functionName, confirmation: CONFIRMATION };
  if (command.mode === 'deploy-edge') await api(`/actions/workflows/${WORKFLOW}/dispatches`, { ref: 'main', inputs });
  return { status: command.mode === 'deploy-edge' ? 'dispatched-not-deployed' : 'validated-no-dispatch', repository: REPOSITORY, pr: command.prNumber, comment_id: command.commentId, workflow: WORKFLOW, ...inputs };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await dispatchEdgeComment({
      event: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')),
      context: { eventName: process.env.GITHUB_EVENT_NAME, repository: process.env.GITHUB_REPOSITORY, ref: process.env.GITHUB_REF, sha: process.env.GITHUB_SHA, actor: process.env.GITHUB_ACTOR, triggeringActor: process.env.GITHUB_TRIGGERING_ACTOR, runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT) },
      token: process.env.GH_TOKEN,
    });
    const summary = `## Fast Edge command\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n\nDispatch acceptance is not deployment verification. The existing Fast Edge workflow must complete its focused tests and Supabase readback.\n`;
    console.log(JSON.stringify(result));
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Command rejected');
    process.exitCode = 1;
  }
}
