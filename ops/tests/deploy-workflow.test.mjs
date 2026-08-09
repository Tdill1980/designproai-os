import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const workflow = readFileSync(resolve(root, ".github/workflows/deploy-production.yml"), "utf8");
const release = readFileSync(resolve(root, ".github/workflows/release.yml"), "utf8");
const remote = readFileSync(resolve(root, "ops/ci-dark-deploy.sh"), "utf8");
const backup = readFileSync(resolve(root, "ops/backup.sh"), "utf8");
const deploy = readFileSync(resolve(root, "ops/deploy.sh"), "utf8");
const inventoryScript = readFileSync(resolve(root, "ops/inventory.sh"), "utf8");
const configure = readFileSync(resolve(root, "ops/configure-env.sh"), "utf8");

function sshPinScript() {
  const pinStart = workflow.indexOf("Pin the new droplet SSH identity");
  const runStart = workflow.indexOf("        run: |\n", pinStart) + "        run: |\n".length;
  const runEnd = workflow.indexOf("\n      - name: Inventory the exact new droplet", runStart);
  assert.ok(pinStart >= 0 && runStart > pinStart && runEnd > runStart);
  return workflow.slice(runStart, runEnd)
    .split("\n")
    .map((line) => line.startsWith("          ") ? line.slice(10) : line)
    .join("\n");
}

function runSshPinFixture({ expectedAutomation, expectedHost }) {
  const fixture = mkdtempSync(resolve(tmpdir(), "designproai-ssh-pin-"));
  const bin = resolve(fixture, "bin");
  const marker = resolve(fixture, "keyscan-called");
  mkdirSync(bin);
  writeFileSync(resolve(bin, "ssh-keygen"), `#!/usr/bin/env bash
if [[ $1 == -y ]]; then
  printf '%s\\n' 'ssh-ed25519 AAAATESTAUTOMATION automation'
elif [[ $2 == *.pub ]]; then
  printf '%s\\n' '256 SHA256:AUTOMATION automation (ED25519)'
else
  printf '%s\\n' '256 SHA256:OBSERVED host (ED25519)'
fi
`);
  writeFileSync(resolve(bin, "ssh-keyscan"), `#!/usr/bin/env bash
: > "$KEYSCAN_MARKER"
printf '%s\\n' '137.184.0.4 ssh-ed25519 AAAATESTHOST'
`);
  chmodSync(resolve(bin, "ssh-keygen"), 0o700);
  chmodSync(resolve(bin, "ssh-keyscan"), 0o700);
  const result = spawnSync("bash", ["-c", sshPinScript()], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      RUNNER_TEMP: fixture,
      GITHUB_OUTPUT: resolve(fixture, "outputs"),
      KEYSCAN_MARKER: marker,
      SSH_PRIVATE_KEY: "-----BEGIN OPENSSH PRIVATE KEY-----\\nfixture\\n-----END OPENSSH PRIVATE KEY-----",
      TARGET_HOST: "137.184.0.4",
      EXPECTED_AUTOMATION_KEY_FINGERPRINT: expectedAutomation,
      EXPECTED_HOST_FINGERPRINT: expectedHost,
    },
  });
  const keyscanCalled = existsSync(marker);
  rmSync(fixture, { recursive: true, force: true });
  return { ...result, keyscanCalled };
}

test("dark deploy is exact-main, environment protected, and new-host pinned", () => {
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /Exact DesignProAI release gate/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /AUDIT_ONLY_DESIGNPROAI_PROD_SFO3/);
  assert.match(workflow, /git log -1 --format=%B \| grep -Fq '\[dark-deploy\]'/);
  assert.match(workflow, /name: designproai-production/);
  assert.match(workflow, /TARGET_HOST: 137\.184\.0\.4/);
  assert.match(workflow, /TARGET_HOSTNAME: designproai-prod-sfo3/);
  assert.match(workflow, /SHA256:Kum4lu4ntmC5\+Q1WIwbPZUCDhEfa0GyeVbdCn4Nsiic/);
  assert.match(workflow, /SHA256:2MADGyqFCuZYrIRL\+\/qm1EcxQOuFdQXFSN4\/JWBjWng/);
  assert.match(workflow, /ssh-keyscan[\s\S]*ssh-keygen -lf[\s\S]*EXPECTED_HOST_FINGERPRINT/);
  assert.doesNotMatch(workflow, /143\.110\.237\.145/);
});

test("SSH pin diagnostics expose only public fingerprints and stay unauthenticated", () => {
  const pinStart = workflow.indexOf("Pin the new droplet SSH identity");
  const inventoryStart = workflow.indexOf("Inventory the exact new droplet");
  assert.ok(pinStart >= 0 && inventoryStart > pinStart);
  const pin = workflow.slice(pinStart, inventoryStart);

  assert.match(pin, /Observed automation public-key fingerprint: %s/);
  assert.match(pin, /Expected automation public-key fingerprint: %s/);
  assert.match(pin, /Observed public SSH host fingerprint\(s\):/);
  assert.match(pin, /Expected public SSH host fingerprint: %s/);
  assert.match(pin, /automation private key could not be parsed/);
  assert.match(pin, /unauthenticated ed25519 host-key scan failed/);
  assert.match(pin, /expected exactly one unique ed25519 host fingerprint/);
  assert.match(pin, /observed ed25519 host fingerprint does not match the protected pin/);
  assert.match(pin, /automation public-key fingerprint does not match the protected client pin/);
  assert.match(pin, /fail_identity_pin 38/);
  assert.match(pin, /fail_identity_pin 37/);
  assert.match(pin, /ssh-keyscan -T 10 -t ed25519/);
  assert.doesNotMatch(pin, /root@|\bscp\b|(?:^|\n)\s*ssh\s/m);
  assert.doesNotMatch(pin, /printf .*automation_public_key|cat .*automation_public_key/);
});

test("SSH pin mismatch reports both public fingerprints and fails before inventory", () => {
  const result = runSshPinFixture({
    expectedAutomation: "SHA256:AUTOMATION",
    expectedHost: "SHA256:EXPECTED",
  });

  assert.equal(result.status, 37);
  assert.equal(result.keyscanCalled, true);
  assert.match(result.stdout, /Observed automation public-key fingerprint: SHA256:AUTOMATION/);
  assert.match(result.stdout, /Expected automation public-key fingerprint: SHA256:AUTOMATION/);
  assert.match(result.stdout, /Observed public SSH host fingerprint\(s\):\n  SHA256:OBSERVED/);
  assert.match(result.stdout, /Expected public SSH host fingerprint: SHA256:EXPECTED/);
  assert.match(result.stderr, /::error title=SSH identity pin::observed ed25519 host fingerprint does not match the protected pin/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /AAAATESTAUTOMATION|AAAATESTHOST/);
});

test("automation key mismatch fails before host scan and inventory", () => {
  const result = runSshPinFixture({
    expectedAutomation: "SHA256:EXPECTED-AUTOMATION",
    expectedHost: "SHA256:OBSERVED",
  });

  assert.equal(result.status, 38);
  assert.equal(result.keyscanCalled, false);
  assert.match(result.stdout, /Observed automation public-key fingerprint: SHA256:AUTOMATION/);
  assert.match(result.stdout, /Expected automation public-key fingerprint: SHA256:EXPECTED-AUTOMATION/);
  assert.doesNotMatch(result.stdout, /Observed public SSH host fingerprint/);
  assert.match(result.stderr, /::error title=SSH identity pin::automation public-key fingerprint does not match the protected client pin/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /AAAATESTAUTOMATION|AAAATESTHOST/);
});

test("deploy consumes one existing successful exact-main artifact and never rebuilds it", () => {
  assert.match(workflow, /TRIGGER_RUN_ID: \$\{\{ github\.event\.workflow_run\.id \}\}/);
  assert.match(workflow, /actions\/runs\/\$TRIGGER_RUN_ID/);
  assert.match(workflow, /actions\/workflows\/release\.yml\/runs\?head_sha=\$EXACT_SHA/);
  assert.match(workflow, /event=push&status=success/);
  assert.match(workflow, /test "\$count" -eq 1/);
  assert.match(workflow, /gh run download/);
  assert.match(workflow, /designproai-release-\$EXACT_SHA/);
  assert.match(workflow, /validate-archive\.py "\$archive" "\$EXACT_SHA"/);
  assert.doesNotMatch(workflow, /npm (?:ci|run build)|docker build|build-release\.sh/);
});

test("inventory precedes transfer and dark acceptance changes no public routing", () => {
  const providers = workflow.indexOf("Fail closed on required dark-deploy secret classes");
  const ssh = workflow.indexOf("Pin the new droplet SSH identity");
  const inventory = workflow.indexOf("Inventory the exact new droplet");
  const transfer = workflow.indexOf("Stage exact controls and artifact");
  assert.ok(providers >= 0 && ssh > providers);
  assert.ok(inventory >= 0 && transfer > inventory);
  assert.match(workflow, /ops\/inventory\.sh/);
  assert.match(workflow, /Unexpected DesignPro container/);
  assert.match(remote, /ALREADY_COMPLETE: exact release is locally accepted/);
  assert.match(remote, /acceptance\.sh" "\$EXACT_SHA"/);
  assert.doesNotMatch(`${workflow}\n${remote}`, /install-caddy\.sh|os\.designproai\.com.*curl|cloudflare|godaddy/i);
});

test("dark deployment requires only its existing provider secrets and explicitly disables email", () => {
  const source = `${workflow}\n${remote}`;
  for (const name of [
    "DESIGNPROAI_SSH_PRIVATE_KEY",
    "DESIGNPRO_SUPABASE_ACCESS_TOKEN",
    "DESIGNPRO_GOOGLE_AI_API_KEY",
  ]) assert.match(source, new RegExp(name));
  assert.doesNotMatch(source, /DESIGNPRO_RESEND_API_KEY|api\.resend\.com/);
  assert.doesNotMatch(source, /secrets\.DESIGNPRO_SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /api\.supabase\.com\/v1\/projects\/\$EXPECTED_PROJECT_REF\/api-keys/);
  assert.match(source, /\.id == \$ref/);
  assert.match(source, /::add-mask::\$service_key/);
  assert.match(configure, /DESIGNPRO_OUTBOUND_EMAIL_ENABLED=false/);
  assert.doesNotMatch(configure, /RESEND_API_KEY|RESEND_FROM|RP_|WPW_/);
  assert.match(workflow, /printf '%s\\n%s\\n'/);
  assert.doesNotMatch(source, /supabase\s+(?:db|migration)|db\s+(?:push|reset)|APPLY_DESIGNPRO_PRODUCTION/);
  assert.match(remote, /runtime-1/);
  assert.match(remote, /runtime-2/);
  assert.match(remote, /gateway/);
  assert.match(remote, /docker volume ls[\s\S]*-eq 0/);
});

test("the exact release gate asks Docker Compose itself to parse expanded production structure", () => {
  assert.match(release, /sudo env DESIGNPRO_SHA="\$EXACT_SHA" docker compose -f ops\/compose\.yaml config --quiet/);
});

test("fresh host deploy has no obsolete VectorizIt guard or host Node prerequisite", () => {
  assert.equal(existsSync(resolve(root, "ops/vectorize-guard.sh")), false);
  assert.doesNotMatch(backup, /vectorize-guard|:3200/);
  assert.doesNotMatch(deploy, /^for command in .*\bnode\b/m);
});

test("inventory records every Docker state class before deployment without reading secrets", () => {
  for (const contract of [
    /docker ps -a --no-trunc/,
    /docker images --digests --no-trunc/,
    /docker volume ls/,
    /docker network ls/,
    /docker compose ls --all/,
    /find -P \/opt\/designproai/,
  ]) assert.match(inventoryScript, contract);
  assert.doesNotMatch(inventoryScript, /cat .*\.env|source .*\.env/);
});
