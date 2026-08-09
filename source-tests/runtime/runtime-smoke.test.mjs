import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const runtime = resolve(import.meta.dirname, "../../runtime");

async function waitForHealth(url, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.status === 200 || response.status === 503) return { status: response.status, body: await response.json() };
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error("runtime did not become healthy");
}

test("runtime boots fail-closed while dependencies are unavailable and rejects unauthenticated tools", async () => {
  const port = 41000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ["index.js"], {
    cwd: runtime,
    env: {
      ...process.env,
      PORT: String(port),
      SUPABASE_URL: "http://127.0.0.1:59999",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
      WORKER_SECRET: "test-worker-secret",
      GIT_SHA: "0123456789abcdef",
      PUBLIC_SITE_URL: "https://os.designproai.com",
      DESIGNPRO_WORKER_ID: "smoke-worker",
      GOOGLE_AI_API_KEY: "test-gemini-key",
      DESIGNPRO_SPOOL_DIR: "/tmp",
      DESIGNPRO_APP_ORIGIN: "https://os.designproai.com",
      DESIGNPRO_OUTBOUND_EMAIL_ENABLED: "false",
      DESIGNPRO_PANEL_POLLER_ENABLED: "false",
    },
    stdio: "ignore",
  });
  try {
    const health = await waitForHealth(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 503);
    assert.equal(health.body.ready, false);
    assert.equal(health.body.workerId, "smoke-worker");
    assert.equal(health.body.commit, "0123456789abcdef");
    assert.equal(health.body.workerLoopsStarted, false);
    assert.equal(health.body.publicGoLiveReady, false);
    assert.deepEqual(health.body.publicGoLiveBlockers, ["outbound_email_disabled"]);
    assert.equal(health.body.dependencies.notifications.configurationValid, true);
    assert.equal(health.body.dependencies.notifications.enabled, false);

    const claimant = await fetch(`http://127.0.0.1:${port}/designpro-os/claimant`);
    assert.equal(claimant.status, 404, "claimant route must not exist while the required Supabase dependency is unavailable");

    const denied = await fetch(`http://127.0.0.1:${port}/compose-proof-sheet`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(denied.status, 401);
  } finally {
    child.kill("SIGTERM");
  }
});

