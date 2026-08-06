import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const runtime = resolve(import.meta.dirname, "../runtime");

async function waitForHealth(url, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error("runtime did not become healthy");
}

test("runtime boots, reports readiness, and rejects unauthenticated tools", async () => {
  const port = 41000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ["standalone-index.js"], {
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
      DESIGNPRO_PANEL_POLLER_ENABLED: "false",
    },
    stdio: "ignore",
  });
  try {
    const health = await waitForHealth(`http://127.0.0.1:${port}/health`);
    assert.equal(health.ready, true);
    assert.equal(health.workerId, "smoke-worker");
    assert.equal(health.commit, "0123456789abcdef");

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
