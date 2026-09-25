import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APPROVED } from '../scripts/edge-hotfix-policy.mjs';
import { CONFIRMATION, OWNER_ID, OWNER_LOGIN, REPOSITORY, REPOSITORY_ID, WORKFLOW, parseCommand, dispatchEdgeComment } from '../scripts/dispatch-edge-comment.mjs';
const sha = 'a'.repeat(40), mergeSha = 'b'.repeat(40);
const apiRoot = `https://api.github.com/repos/${REPOSITORY}`;
const user = { id: OWNER_ID, login: OWNER_LOGIN, type: 'User' };
const repository = { id: REPOSITORY_ID, full_name: REPOSITORY, default_branch: 'main' };
const command = (mode = 'deploy-edge', fn = 'render-wall-view') => `/${mode} ${fn} ${sha} ${CONFIRMATION}`;
function fixture() {
  const comment = { id: 1001, user: { ...user }, body: command(), created_at: '2026-09-25T07:00:00Z', updated_at: '2026-09-25T07:00:00Z', issue_url: `${apiRoot}/issues/704` };
  return {
    event: { action: 'created', repository: { ...repository }, sender: { ...user }, issue: { number: 704, pull_request: { url: `${apiRoot}/pulls/704` }, state: 'closed' }, comment: structuredClone(comment) },
    context: { eventName: 'issue_comment', repository: REPOSITORY, ref: 'refs/heads/main', sha, actor: OWNER_LOGIN, triggeringActor: OWNER_LOGIN, runAttempt: 1 },
    comment,
    pr: { number: 704, state: 'closed', merged: true, draft: false, merged_at: '2026-09-25T06:00:00Z', merge_commit_sha: mergeSha, changed_files: 1, base: { ref: 'main', repo: { ...repository } }, head: { repo: { ...repository } } },
    files: [{ filename: 'supabase/functions/render-wall-view/handler.ts', status: 'modified' }],
    main: { name: 'main', commit: { sha } },
    comparison: { status: 'ahead', merge_base_commit: { sha: mergeSha } },
  };
}
function harness(f = fixture(), intercept = () => undefined) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const call = { url, ...options }; calls.push(call);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    const intercepted = intercept(call, calls);
    if (intercepted !== undefined) return intercepted;
    if (options.method === 'POST') return new Response(null, { status: 204 });
    let data;
    if (url.endsWith('/branches/main')) data = f.main;
    else if (url.endsWith('/issues/comments/1001')) data = f.comment;
    else if (url.endsWith('/pulls/704')) data = f.pr;
    else if (url.includes('/compare/')) data = f.comparison;
    else if (url.includes('/pulls/704/files?')) data = f.files;
    else throw new Error('Unexpected API route ' + url);
    return Response.json(data);
  };
  return { calls, run: () => dispatchEdgeComment({ event: f.event, context: f.context, token: 'test-token-not-a-secret', fetchImpl }) };
}

test('valid owner request dispatches the EXISTING workflow once with exact inputs', async () => {
  const h = harness(); const result = await h.run();
  assert.equal(result.status, 'dispatched-not-deployed');
  const posts = h.calls.filter(c => c.method === 'POST');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, `${apiRoot}/actions/workflows/${WORKFLOW}/dispatches`);
  assert.deepEqual(JSON.parse(posts[0].body), { ref: 'main', inputs: { exact_main_sha: sha, function_name: 'render-wall-view', confirmation: CONFIRMATION } });
  assert.equal(h.calls.filter(c => c.url.endsWith('/branches/main')).length, 2);
  assert.equal(h.calls.filter(c => c.url.endsWith('/issues/comments/1001')).length, 2);
});

test('check command validates the real authorization path without any dispatch', async () => {
  const f = fixture(); f.comment.body = f.event.comment.body = command('check-edge');
  const h = harness(f); assert.equal((await h.run()).status, 'validated-no-dispatch');
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 0);
});

test('both existing allowlisted functions route through the same adapter', async () => {
  for (const [fn, spec] of Object.entries(APPROVED)) {
    const f = fixture(); f.comment.body = f.event.comment.body = command('deploy-edge', fn);
    f.files = [{ filename: spec.sources[0], status: 'modified' }];
    const h = harness(f); assert.equal((await h.run()).function_name, fn);
  }
});

for (const body of ['', null, command() + '\n', command() + '\r\n', ' ' + command(), command() + ' ', 'text\n' + command(), command() + '; echo bad', command().replace(sha, 'main'), command().replace(sha, 'abc123'), command().replace(sha, 'A'.repeat(40)), command().replace('render-wall-view', 'all'), command().replace('render-wall-view', '../other'), command().replace('render-wall-view', 'constructor'), command().replace(CONFIRMATION, 'DO_NOT_DEPLOY'), command().replace('/deploy-edge', '/other'), '/deploy-edge $(echo bad)', 'x'.repeat(221)]) {
  test(`reject malformed command ${JSON.stringify(body)}`, () => assert.throws(() => parseCommand(body)));
}

const badEvents = {
  'edited event': f => { f.event.action = 'edited'; },
  'deleted event': f => { f.event.action = 'deleted'; },
  'unrelated event': f => { f.context.eventName = 'pull_request_target'; },
  'rerun replay': f => { f.context.runAttempt = 2; },
  'repository id mismatch': f => { f.event.repository.id++; },
  'repository name mismatch': f => { f.context.repository = 'another/repo'; },
  'default branch mismatch': f => { f.event.repository.default_branch = 'dev'; },
  'PR checkout ref': f => { f.context.ref = 'refs/pull/704/head'; },
  'event SHA mismatch': f => { f.context.sha = 'c'.repeat(40); },
  'author wrong id': f => { f.event.comment.user.id++; },
  'author wrong login': f => { f.event.comment.user.login = 'other'; },
  'bot author': f => { f.event.comment.user.type = 'Bot'; },
  'sender wrong id': f => { f.event.sender.id++; },
  'actor not owner': f => { f.context.actor = 'other'; },
  'rerun actor not owner': f => { f.context.triggeringActor = 'other'; },
  'ordinary issue': f => { delete f.event.issue.pull_request; },
  'open PR event': f => { f.event.issue.state = 'open'; },
  'invalid PR number': f => { f.event.issue.number = '../1'; },
  'invalid comment id': f => { f.event.comment.id = '../1'; },
};
for (const [name, mutate] of Object.entries(badEvents)) test(`zero network calls for ${name}`, async () => {
  const f = fixture(); mutate(f); const h = harness(f);
  await assert.rejects(h.run()); assert.equal(h.calls.length, 0);
});

const badLive = {
  'main changed': f => { f.main.commit.sha = 'c'.repeat(40); },
  'comment author changed': f => { f.comment.user.id++; },
  'comment edited': f => { f.comment.updated_at = '2026-09-25T07:01:00Z'; },
  'comment body changed': f => { f.comment.body += ' '; },
  'comment moved to another PR': f => { f.comment.issue_url = `${apiRoot}/issues/705`; },
  'unmerged PR': f => { f.pr.merged = false; },
  'draft PR': f => { f.pr.draft = true; },
  'PR base not main': f => { f.pr.base.ref = 'dev'; },
  'PR from fork': f => { f.pr.head.repo.id++; },
  'PR into other repository': f => { f.pr.base.repo.id++; },
  'malformed merge SHA': f => { f.pr.merge_commit_sha = '--help'; },
  'command predates merge': f => { f.pr.merged_at = '2026-09-25T08:00:00Z'; },
  'bad merge timestamp': f => { f.pr.merged_at = null; },
  'non-ancestor merge': f => { f.comparison.status = 'diverged'; },
  'wrong merge base': f => { f.comparison.merge_base_commit.sha = 'c'.repeat(40); },
  'empty PR': f => { f.files = []; f.pr.changed_files = 0; },
  'incomplete PR listing': f => { f.pr.changed_files = 2; },
  'protected path': f => { f.files.push({ filename: 'runtime/index.js', status: 'modified' }); f.pr.changed_files++; },
  'mixed approved functions': f => { f.files.push({ filename: 'supabase/functions/production-panel-proof/index.ts', status: 'modified' }); f.pr.changed_files++; },
  'wrong function PR': f => { f.files[0].filename = 'supabase/functions/production-panel-proof/index.ts'; },
  'source deleted': f => { f.files[0].status = 'removed'; },
  'source renamed': f => { f.files[0].status = 'renamed'; },
  'source newly added': f => { f.files[0].status = 'added'; },
};
for (const [name, mutate] of Object.entries(badLive)) test(`no dispatch for ${name}`, async () => {
  const f = fixture(); mutate(f); const h = harness(f);
  await assert.rejects(h.run()); assert.equal(h.calls.filter(c => c.method === 'POST').length, 0);
});

test('main moving immediately before dispatch fails closed', async () => {
  const h = harness(fixture(), (call, calls) => call.url.endsWith('/branches/main') && calls.filter(c => c.url.endsWith('/branches/main')).length === 2 ? Response.json({ name: 'main', commit: { sha: 'c'.repeat(40) } }) : undefined);
  await assert.rejects(h.run(), /Main moved/);
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 0);
});

test('comment edited during validation fails closed', async () => {
  const f = fixture();
  const h = harness(f, (call, calls) => call.url.endsWith('/issues/comments/1001') && calls.filter(c => c.url.endsWith('/issues/comments/1001')).length === 2 ? Response.json({ ...f.comment, body: 'changed' }) : undefined);
  await assert.rejects(h.run(), /Edited comments/);
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 0);
});

test('all PR-file pages are read; a protected file on page two is rejected', async () => {
  const f = fixture(); f.pr.changed_files = 101;
  const h = harness(f, call => call.url.includes('/files?') ? Response.json(call.url.endsWith('page=1') ? Array.from({ length: 100 }, () => f.files[0]) : [{ filename: 'runtime/hidden.js', status: 'modified' }]) : undefined);
  await assert.rejects(h.run(), /not an isolated/);
  assert.equal(h.calls.filter(c => c.url.includes('/files?')).length, 2);
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 0);
});

test('read failures never dispatch; dispatch errors are never blindly retried', async () => {
  const readFailure = harness(fixture(), () => new Response(null, { status: 403 }));
  await assert.rejects(readFailure.run(), /HTTP 403/); assert.equal(readFailure.calls.length, 1);
  const dispatchFailure = harness(fixture(), c => c.method === 'POST' ? new Response(null, { status: 500 }) : undefined);
  await assert.rejects(dispatchFailure.run(), /HTTP 500/);
  assert.equal(dispatchFailure.calls.filter(c => c.method === 'POST').length, 1);
});

test('workflow executes only default-branch code with narrow job permissions', () => {
  const text = readFileSync(new URL('../.github/workflows/dispatch-edge-comment.yml', import.meta.url), 'utf8');
  for (const required of ['issue_comment:', 'types: [created]', 'permissions: {}', 'ref: ${{ github.sha }}', 'persist-credentials: false', 'contents: read', 'issues: read', 'pull-requests: read', 'actions: write', 'GH_TOKEN: ${{ github.token }}', 'node scripts/dispatch-edge-comment.mjs']) assert.ok(text.includes(required), required);
  assert.doesNotMatch(text, /secrets\.|pull_request_target:|head\.sha|contents: write|issues: write|pull-requests: write|write-all/);
  assert.doesNotMatch(text, /run:[\s\S]*?\$\{\{\s*github\.event\.comment\.body/);
  assert.doesNotMatch(text, /ssh |docker |db push|secrets set|supabase functions deploy/);
});

test('adapter contains no shell evaluation or direct production write path', () => {
  const text = readFileSync(new URL('../scripts/dispatch-edge-comment.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(text, /child_process|execSync|eval\(|new Function\(|supabase\.co|SUPABASE_ACCESS_TOKEN/);
  assert.equal(WORKFLOW, 'deploy-edge-hotfix.yml');
});
