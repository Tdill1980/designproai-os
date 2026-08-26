import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const workflow = readFileSync(resolve(root, ".github/workflows/deploy-production.yml"), "utf8");
const diskMaintenance = readFileSync(resolve(root, ".github/workflows/disk-maintenance.yml"), "utf8");
const release = readFileSync(resolve(root, ".github/workflows/release.yml"), "utf8");
const remote = readFileSync(resolve(root, "ops/ci-dark-deploy.sh"), "utf8");
const backup = readFileSync(resolve(root, "ops/backup.sh"), "utf8");
const deploy = readFileSync(resolve(root, "ops/deploy.sh"), "utf8");
const inventoryScript = readFileSync(resolve(root, "ops/inventory.sh"), "utf8");
const configure = readFileSync(resolve(root, "ops/configure-env.sh"), "utf8");
const atlasSchemaAssertion = readFileSync(resolve(root, "ops/assert-atlas-production-schema.sh"), "utf8");
const caddyWorkflow = readFileSync(resolve(root, ".github/workflows/install-caddy.yml"), "utf8");

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

function runAtlasSchemaFixture(response, {
  projectRef = "wozyamlnygaddievzuwn",
  accessToken = "fixture-management-access-token",
} = {}) {
  const fixture = mkdtempSync(resolve(tmpdir(), "designproai-atlas-schema-"));
  const bin = resolve(fixture, "bin");
  const curlMarker = resolve(fixture, "curl-called");
  mkdirSync(bin);
  writeFileSync(resolve(bin, "curl"), `#!/usr/bin/env bash
set -Eeuo pipefail
: > "$CURL_MARKER"
printf '%s' "$MOCK_SCHEMA_RESPONSE"
`);
  chmodSync(resolve(bin, "curl"), 0o700);
  const result = spawnSync("bash", [resolve(root, "ops/assert-atlas-production-schema.sh")], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      CURL_MARKER: curlMarker,
      EXPECTED_PROJECT_REF: projectRef,
      MOCK_SCHEMA_RESPONSE: JSON.stringify(response),
      SUPABASE_ACCESS_TOKEN: accessToken,
    },
  });
  const curlCalled = existsSync(curlMarker);
  rmSync(fixture, { recursive: true, force: true });
  return { ...result, curlCalled, accessToken };
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
  const liveSchema = workflow.indexOf("Refuse deploy unless the live A.T.L.A.S. schema is installed");
  const storageConfig = workflow.indexOf("Reconcile the project-wide Storage upload limit with config.toml");
  const ssh = workflow.indexOf("Pin the new droplet SSH identity");
  const inventory = workflow.indexOf("Inventory the exact new droplet");
  const transfer = workflow.indexOf("Stage exact controls and artifact");
  assert.ok(providers >= 0 && liveSchema > providers);
  assert.ok(storageConfig > liveSchema && ssh > liveSchema, "live schema must be proven before project or host mutation");
  assert.ok(inventory >= 0 && transfer > inventory);
  assert.match(workflow, /ops\/inventory\.sh/);
  assert.match(workflow, /Unexpected DesignPro container/);
  assert.match(remote, /ALREADY_COMPLETE: exact release is locally accepted/);
  assert.match(remote, /acceptance\.sh" "\$EXACT_SHA"/);
  assert.doesNotMatch(`${workflow}\n${remote}`, /install-caddy\.sh|os\.designproai\.com.*curl|cloudflare|godaddy/i);
});

test("dark deploy requires live Atlas schema evidence instead of migration history", () => {
  assert.match(workflow, /run: bash ops\/assert-atlas-production-schema\.sh/);
  assert.match(atlasSchemaAssertion, /database\/query\/read-only/);
  assert.match(atlasSchemaAssertion, /designpro_private\.calls_1_7_view_plan/);
  assert.match(atlasSchemaAssertion, /'sourceViewType'',''close-up'',''consumerRole'',''closeup'/);
  assert.match(atlasSchemaAssertion, /THENRAISEEXCEPTION''flat_first_atlas_new_run_required'';ENDIF;/);
  assert.match(atlasSchemaAssertion, /UPDATEpublic\.designpro_generation_views/);
  assert.match(atlasSchemaAssertion, /INSERTINTOpublic\.designpro_generation_slots/);
  assert.match(atlasSchemaAssertion, /designpro_revision_snapshot_contract/);
  assert.match(atlasSchemaAssertion, /renderAssets''\?''closeup/);
  assert.match(atlasSchemaAssertion, /renderAssets''\?''hero3d/);
  assert.match(atlasSchemaAssertion, /v_view\.consumer_role=''closeup''/);
  assert.match(atlasSchemaAssertion, /verify_revision_render_assets/);
  assert.match(atlasSchemaAssertion, /complete_designpro_stage/);
  assert.match(atlasSchemaAssertion, /flat_first_atlas_view_set_valid/);
  for (const path of [
    "{provider,atlasZoneContract}",
    "{provider,atlasZoneContentHash}",
    "{provider,atlasZoneSurfaceKey}",
    "{validation,authorityHash}",
    "{validation,zoneHash}",
    "{validation,zoneSurfaceKey}",
    "{authority,zoneContract}",
    "{authority,zoneContentHash}",
  ]) {
    assert.ok(atlasSchemaAssertion.includes(`'''${path}'''`), `missing exact JSON path ${path}`);
  }

  // THE SIBLING-SURFACE REFUSALS, LOCKED AS REFUSALS.
  //
  // `driverContentHash`, `deterministicMirror`, `passengerProducer` and
  // `atlasZonePassedToPassengerRepair` were REQUIREMENTS of every non-Driver
  // proof until the owner-approved fan-out inverted them: six sibling surface
  // authorities, each feeding its own proof, Driver keeping scheduling priority
  // only. This list pinned the path literal
  // '{provider,atlasZonePassedToPassengerRepair}', which ceased to exist the
  // moment the clause became a `?` key test -- so the lock kept the fence
  // pinned to a schema the migration had already replaced, and the fence
  // refused the deploy of 6e108ea8 against a database that was exactly right.
  //
  // Pinned as the refusals, never as "the old requirement is absent": deleting
  // these clauses outright would satisfy a mere-absence check and silently
  // restore the Driver hard-dependency the fence exists to stop.
  for (const refusal of [
    "ANDNOT((v.metadata->''provider'')?''driverContentHash'')",
    "ANDNOT((v.metadata->''provider'')?''deterministicMirror'')",
    "ANDNOT((v.metadata->''provider'')?''passengerProducer'')",
    "ANDNOT((v.metadata->''provider'')?''atlasZonePassedToPassengerRepair'')",
    "v.metadata#>''{provider,anchoredToView1}''=''false''",
  ]) {
    assert.ok(
      atlasSchemaAssertion.includes(`'${refusal}'`),
      `fence must assert the sibling-surface refusal ${refusal}`,
    );
  }
  assert.doesNotMatch(atlasSchemaAssertion, /strpos\(atlas_valid_definition,'''atlasZoneContract'''\)/);
  assert.match(atlasSchemaAssertion, /flat_first_atlas_requires_new_run/);
  assert.match(atlasSchemaAssertion, /designpro_flat_atlas_revision_paths/);
  assert.match(atlasSchemaAssertion, /designpro_owner_read_wrap_files/);
  assert.match(atlasSchemaAssertion, /designpro_owner_insert_revision_inputs/);
  assert.match(atlasSchemaAssertion, /revision_trigger_definition, 'hero3d'\) = 0/);
  assert.match(atlasSchemaAssertion, /FROMpublic\.designpro_revision_sourcesfrozen/);
  assert.match(atlasSchemaAssertion, /storage_insert_policy,'''hero3d'''\)=0/);
  assert.match(atlasSchemaAssertion, /migration history alone is not release evidence/);
  assert.doesNotMatch(atlasSchemaAssertion, /SUPABASE_DB_PASSWORD|service_role|SUPABASE_SERVICE_ROLE_KEY/);
});

test("protected Caddy install ships and verifies every exact-SHA control it executes", () => {
  for (const control of [
    "install-caddy.sh",
    "Caddyfile.fragment",
    "acceptance.sh",
    "validate-archive.py",
    "validate-release-tree.py",
    "validate-env.py",
    "release-files.txt",
  ]) {
    assert.match(caddyWorkflow, new RegExp(`ops/${control.replaceAll(".", "\\.")}`));
  }
  assert.match(caddyWorkflow, /sha256sum -c caddy-controls\.sha256/);
  assert.match(caddyWorkflow, /\[\[ -f \$control && ! -L \$control \]\]/);
});

test("protected Caddy install normalizes mobile SHA paste before checkout and reports safely", () => {
  const normalize = caddyWorkflow.indexOf("Normalize the exact SHA input");
  const checkout = caddyWorkflow.indexOf("actions/checkout@", normalize);
  assert.ok(normalize >= 0 && checkout > normalize);
  assert.match(caddyWorkflow, /normalized=\$\(printf '%s' "\$EXACT_SHA" \| tr -d '\[:space:\]'\)/);
  assert.match(caddyWorkflow, /ref: \$\{\{ steps\.exact\.outputs\.sha \}\}/);
  assert.match(caddyWorkflow, /-z \$\{key_file:-\}[\s\S]*Caddy report skipped because the SSH identity step did not complete/);
});

test("live Atlas schema assertion accepts exactly one all-true catalog verdict", () => {
  const result = runAtlasSchemaFixture([{
    view_plan_closeup: true,
    regenerate_guard_before_mutation: true,
    revision_constraint_history_compatible: true,
    handoff_carries_closeup: true,
    revision_trigger_closeup_only: true,
    revision_freeze_legacy_pinned_only: true,
    storage_write_closeup_read_hero: true,
    atlas_owner_read_quarantine: true,
    atlas_preview_quarantine: true,
  }]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.curlCalled, true);
  assert.match(result.stdout, /PASS: live A\.T\.L\.A\.S\./);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(result.accessToken));
});

test("live Atlas schema assertion fails closed on a false or malformed verdict", () => {
  for (const response of [
    [{
      view_plan_closeup: true,
      regenerate_guard_before_mutation: false,
      revision_constraint_history_compatible: true,
      handoff_carries_closeup: true,
      revision_trigger_closeup_only: true,
      revision_freeze_legacy_pinned_only: true,
      storage_write_closeup_read_hero: true,
      atlas_owner_read_quarantine: true,
      atlas_preview_quarantine: true,
    }],
    [],
    { view_plan_closeup: true },
  ]) {
    const result = runAtlasSchemaFixture(response);
    assert.equal(result.status, 1);
    assert.equal(result.curlCalled, true);
    assert.match(result.stderr, /migration history alone is not release evidence/);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(result.accessToken));
  }
});

test("live Atlas schema assertion refuses the wrong project before any request", () => {
  const result = runAtlasSchemaFixture([], { projectRef: "wrong-project" });

  assert.equal(result.status, 2);
  assert.equal(result.curlCalled, false);
  assert.match(result.stderr, /refused an unexpected Supabase project/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(result.accessToken));
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
  assert.match(workflow, /printf '(?:%s\\n){5}'/);
  assert.doesNotMatch(source, /supabase\s+(?:db|migration)|db\s+(?:push|reset)|APPLY_DESIGNPRO_PRODUCTION/);
  assert.match(remote, /runtime-1/);
  assert.match(remote, /runtime-2/);
  assert.match(remote, /gateway/);
  assert.match(remote, /docker volume ls[\s\S]*-eq 0/);
});

test("a new dark release refreshes provider credentials instead of discarding the secret pipe", () => {
  const start = remote.indexOf("runtime_env=/opt/designproai-os/shared/runtime.env");
  const end = remote.indexOf('"$control/deploy.sh"', start);
  assert.ok(start >= 0 && end > start, "dark-deploy environment block moved");
  const environment = remote.slice(start, end);

  assert.match(environment, /validate-env\.py/);
  assert.match(environment, /configure-env\.sh" CONFIGURE_DESIGNPRO_SECRETS_ONLY/);
  assert.doesNotMatch(environment, /cat >\/dev\/null/);
  assert.match(configure, /existing_worker_secret/);
  assert.ok(
    environment.indexOf("configure-env.sh") > environment.indexOf("validate-env.py"),
    "the fresh provider keys must replace the validated stale files before deploy",
  );
});

/**
 * Runs configure-env.sh's real secret-reading section against a given stdin,
 * so the channel is exercised rather than described. Everything after it needs
 * root and /opt/designproai-os; the reads do not.
 */
function runSecretChannel(stdin) {
  const start = configure.indexOf("read_secret() {");
  const lastCall = configure.indexOf('"the Stripe webhook signing secret"');
  assert.ok(start >= 0 && lastCall > start, "the secret-reading section moved");
  const section = configure.slice(start, configure.indexOf("\n", lastCall));
  return spawnSync("bash", ["-c", `set -Eeuo pipefail\n${section}\nprintf 'supabase=%s google=%s topaz=%s stripe=%s hook=%s\\n' "$service_key" "$google_key" "$topaz_key" "$stripe_secret" "$stripe_webhook"`], {
    encoding: "utf8",
    input: stdin,
  });
}

test("the secret channel consumes exactly the lines the deploy sends, in order", () => {
  const result = runSecretChannel("SUPABASE-KEY\nGOOGLE-KEY\nTOPAZ-KEY\nSTRIPE-KEY\nHOOK-SECRET\n");
  assert.equal(result.status, 0);
  assert.match(
    result.stdout,
    /supabase=SUPABASE-KEY google=GOOGLE-KEY topaz=TOPAZ-KEY stripe=STRIPE-KEY hook=HOOK-SECRET/,
  );
});

test("an empty optional line is a decision to leave that feature disabled, and is accepted", () => {
  const result = runSecretChannel("SUPABASE-KEY\nGOOGLE-KEY\n\n\n\n");
  assert.equal(result.status, 0);
  assert.match(result.stdout, /supabase=SUPABASE-KEY google=GOOGLE-KEY topaz= stripe= hook=$/m);
});

test("a pipe that stops after Call 12 fails loudly rather than silently disabling checkout", () => {
  // The same reasoning as the Topaz line one test down, and the reason the
  // checkout lines were added to BOTH callers' pipes rather than only to the
  // configuration workflow: a deploy that sent three lines would have written a
  // gateway with no Stripe configuration at all, turning checkout off on the
  // next release with nothing in the log to say so.
  const result = runSecretChannel("SUPABASE-KEY\nGOOGLE-KEY\nTOPAZ-KEY\n");
  assert.equal(result.status, 5);
  assert.match(result.stderr, /Secret input ended early: expected the Stripe secret key/);
  assert.doesNotMatch(result.stdout, /stripe=/);
});

test("a truncated pipe fails loudly instead of silently disabling Call 12", () => {
  // The regression this guards: a caller that sends only the two older secrets
  // used to abort at EOF under set -e with no explanation. Leaving Call 12
  // quietly off would have been worse - production packs would fail closed in
  // front of a customer, far from the cause.
  const result = runSecretChannel("SUPABASE-KEY\nGOOGLE-KEY\n");
  assert.equal(result.status, 5);
  assert.match(result.stderr, /Secret input ended early: expected the Topaz Labs API key/);
  assert.doesNotMatch(result.stdout, /topaz=/);
});

test("the deploy pipe sends exactly as many secrets as configure-env.sh reads", () => {
  const reads = configure.match(/^read_secret \w+/gm) || [];
  // Supabase service role, Google AI, Topaz (Call 12), Stripe secret key,
  // Stripe webhook secret. The literal is here so that adding a read is a
  // deliberate act that also updates both pipes, which is exactly the failure
  // this test caught when the checkout secrets were added to the reader alone.
  assert.equal(reads.length, 5);
  for (const source of [workflow, readFileSync(resolve(root, ".github/workflows/configure-droplet-env.yml"), "utf8")]) {
    const pipe = source.match(/printf '((?:%s\\n)+)' \\\n((?:[^\n]*\\\n)*[^\n]*\| \\\n)/);
    assert.ok(pipe, "the secret pipe is not in the expected printf form");
    assert.equal((pipe[1].match(/%s/g) || []).length, reads.length, "pipe width does not match the read count");
    assert.equal(pipe[2].trimEnd().split("\n").length, reads.length, "argument count does not match the read count");
  }
});

test("every remote step holds its connection open through a silent build", () => {
  // A dark deploy spends most of its time inside `docker build`, which sends
  // nothing down the SSH channel for many minutes at a stretch — output over
  // SSH is block-buffered, not line-buffered. Without keepalives a silent
  // connection is reaped by whatever NAT sits between the runner and the host,
  // and the deploy dies at exit 255 with "Timeout, server not responding" after
  // twenty minutes of apparent progress. That is precisely how the first real
  // dark deploy of this stack failed, mid-build, having already passed every
  // safety gate.
  //
  // The seam has the same shape for a different reason: it waits on a provider
  // to render.
  const dir = resolve(root, ".github/workflows");
  const longRunning = ["deploy-production.yml", "calls-1-7-seam.yml", "configure-droplet-env.yml"];
  for (const file of longRunning) {
    const text = readFileSync(resolve(dir, file), "utf8");
    const declarations = text.match(/ssh_args=\([^)]*\)/g) || [];
    assert.ok(declarations.length > 0, `${file} declares no ssh_args`);
    for (const declaration of declarations) {
      assert.match(declaration, /ServerAliveInterval=30/, `${file}: an ssh_args without a keepalive interval`);
      assert.match(declaration, /ServerAliveCountMax=20/, `${file}: an ssh_args without a keepalive ceiling`);
      // The pins are what make this connection trustworthy; a keepalive must
      // never arrive at the cost of one of them.
      assert.match(declaration, /StrictHostKeyChecking=yes/);
      assert.match(declaration, /BatchMode=yes/);
      assert.match(declaration, /IdentitiesOnly=yes/);
    }
  }
});

test("the droplet's remote configuration half is a staged script, not a heredoc", () => {
  const remote = readFileSync(resolve(root, "ops/ci-configure-env.sh"), "utf8");
  const configureWorkflow = readFileSync(resolve(root, ".github/workflows/configure-droplet-env.yml"), "utf8");
  assert.match(configureWorkflow, /ci-configure-env\.sh/);
  assert.match(remote, /configure-env\.sh" CONFIGURE_DESIGNPRO_SECRETS_ONLY/);
  assert.match(remote, /validate-env\.py"/);
  assert.match(remote, /REMOTE_STAGE == \/tmp\/designproai-env-\*/, "the staging path is constrained");
  // It configures. Deploy verbs belong to the deploy.
  assert.doesNotMatch(remote, /deploy\.sh|docker compose|systemctl|install-caddy\.sh|designproai\/current/);
});

test("configuring the droplet environment is protected, pinned, and deploys nothing", () => {
  const configureWorkflow = readFileSync(resolve(root, ".github/workflows/configure-droplet-env.yml"), "utf8");
  assert.match(configureWorkflow, /workflow_dispatch:/);
  assert.match(configureWorkflow, /default: DO_NOT_CONFIGURE/);
  assert.match(configureWorkflow, /WRITE_DESIGNPROAI_DROPLET_ENV/);
  assert.match(configureWorkflow, /name: designproai-production/);
  assert.match(configureWorkflow, /TARGET_HOST: 137\.184\.0\.4/);
  assert.match(configureWorkflow, /SHA256:Kum4lu4ntmC5\+Q1WIwbPZUCDhEfa0GyeVbdCn4Nsiic/);
  assert.match(configureWorkflow, /SHA256:2MADGyqFCuZYrIRL\+\/qm1EcxQOuFdQXFSN4\/JWBjWng/);
  // One canonical writer, and the same validator judges the result. Both are
  // reached through the staged remote half, not inlined into the workflow.
  const remoteHalf = readFileSync(resolve(root, "ops/ci-configure-env.sh"), "utf8");
  assert.match(configureWorkflow, /ops\/ci-configure-env\.sh/);
  assert.match(remoteHalf, /configure-env\.sh" CONFIGURE_DESIGNPRO_SECRETS_ONLY/);
  assert.match(remoteHalf, /validate-env\.py"/);
  // An absent Topaz key is a misplaced secret, not a decision, and it names
  // the environment the secret has to live in rather than just failing.
  assert.match(configureWorkflow, /DESIGNPRO_TOPAZ_API_KEY resolved to an empty value/);
  assert.match(configureWorkflow, /Settings -> Environments -> designproai-production/);
  // It configures. It does not deploy, restart, or touch public routing.
  assert.doesNotMatch(configureWorkflow, /deploy\.sh|ci-dark-deploy\.sh|gh run download|docker compose (?:up|restart)|systemctl (?:restart|start)|install-caddy\.sh/);
  assert.doesNotMatch(configureWorkflow, /designproai\/current['"]? *(?:->|=)|ln -sfn/);
  // The inspection path reports key names and file facts, never a value.
  assert.match(configureWorkflow, /sed -n 's\/\^\\\(\[A-Z\]\[A-Z0-9_\]\*\\\)=\.\*\/\\1\/p'/);
  assert.doesNotMatch(configureWorkflow, /cat .*\.env|source .*\.env|sha256sum .*\.env/);
});

test("no ssh invocation is both piped into and fed a heredoc", () => {
  // An `ssh ... bash -s <<'HEREDOC'` spends stdin on the script, so a pipe
  // feeding the same ssh is discarded without a word and the reader on the far
  // side consumes the tail of the script where it expected a secret. This is
  // not theoretical: it is exactly how the first droplet configuration run
  // failed, and only the reader's own EOF guard made it legible. Either use
  // stdin for the script or for the data, never both.
  const dir = resolve(root, ".github/workflows");
  const offenders = [];
  for (const file of readdirSync(dir).filter((name) => /\.ya?ml$/.test(name))) {
    const lines = readFileSync(resolve(dir, file), "utf8").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      if (!/(^|\s)ssh\s/.test(lines[index])) continue;
      // Walk back over the pipe's own continuations to see if this ssh is a
      // pipe target, and forward over the invocation's continuations to see
      // whether it also opens a heredoc.
      let back = index - 1;
      while (back >= 0 && /\\\s*$/.test(lines[back]) && !/\|\s*\\\s*$/.test(lines[back])) back -= 1;
      const piped = back >= 0 && /\|\s*\\\s*$/.test(lines[back]);
      let invocation = lines[index];
      let forward = index;
      while (/\\\s*$/.test(lines[forward]) && forward + 1 < lines.length) {
        forward += 1;
        invocation += `\n${lines[forward]}`;
      }
      if (piped && /<<-?\s*['"]?\w+/.test(invocation)) {
        offenders.push(`${file}:${index + 1}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `ssh cannot read a heredoc and a pipe at once: ${offenders.join(", ")}`);
});

test("the exact release gate asks Docker Compose itself to parse expanded production structure", () => {
  assert.match(release, /sudo env DESIGNPRO_SHA="\$EXACT_SHA" docker compose -f ops\/compose\.yaml config --quiet/);
});

test("fresh host deploy has no obsolete VectorizIt guard or host Node prerequisite", () => {
  assert.equal(existsSync(resolve(root, "ops/vectorize-guard.sh")), false);
  assert.doesNotMatch(backup, /vectorize-guard|:3200/);
  assert.doesNotMatch(deploy, /^for command in .*\bnode\b/m);
});

test("the cutover backup archives DesignProAI OS, never the neighboring app", () => {
  const tarLine = backup.split("\n").find((line) => line.includes("tar --one-file-system"));
  assert.equal(
    tarLine?.trim(),
    "tar --one-file-system --exclude='designproai-os/shared/spool' -C /opt -czf \"$dest/designproai-os-before.tgz\" designproai-os",
  );
});

test("disk reclamation cannot prune another app or let Caddy snapshots displace rollback backups", () => {
  assert.doesNotMatch(diskMaintenance, /docker (?:image|builder) prune/);
  assert.match(diskMaintenance, /\^\[0-9\]\{8\}T\[0-9\]\{6\}Z\$/);
  assert.match(diskMaintenance, /test ! -L "\$backups\/\$stamp"/);
  assert.doesNotMatch(diskMaintenance, /ls -1 "\$backups" \| sort \| head -n -3/);
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

// Storage enforces the smaller of two ceilings. The per-bucket limit is created
// by migration and visible in SQL; the project-wide limit lives only in hosted
// config, defaults to 50 MB, and is invisible from SQL. A bucket declared at
// 50 GB behind a project still at 50 MB reads as healthy and then rejects
// uploads with a bare "413 Maximum size exceeded" that names neither limit.
// Call 8's 48-megapixel flat wrap layout is well past 50 MB, so the deploy has
// to reconcile the project limit rather than trusting the bucket's.
test("the deploy reconciles the project-wide Storage limit from config.toml, not a literal", () => {
  const start = workflow.indexOf("Reconcile the project-wide Storage upload limit with config.toml");
  assert.ok(start > 0, "the deploy must reconcile the project-wide Storage upload limit");
  const step = workflow.slice(start, workflow.indexOf("\n      - name: Select the one successful exact-main release run", start));

  assert.match(step, /supabase\/config\.toml/, "the declared limit must be read from config.toml");
  assert.match(step, /config\/storage/, "it must read and write the project Storage config endpoint");
  assert.match(step, /-X PATCH/, "it must be able to correct drift, not merely report it");
  // A literal byte count here would silently diverge from config.toml the first
  // time either side is edited, which is the exact failure this step exists for.
  assert.doesNotMatch(step, /\b\d{9,}\b/, "the limit must come from config.toml rather than a hardcoded byte count");
  // Audit mode inspects; only a real dark deploy mutates the project.
  assert.match(step, /DEPLOY_MODE != DEPLOY_DARK_TO_DESIGNPROAI_PROD_SFO3/, "audit mode must not mutate the project");
  // A plan ceiling or bad payload can clamp the value server-side; deploying as
  // though it took would reproduce the original bug with a green checkmark.
  assert.match(step, /applied == "\$declared"|\[\[ \$applied == "\$declared" \]\]/, "the applied limit must be re-read and verified");
});

test("config.toml declares one project-wide Storage limit that outranks the bucket's", () => {
  const config = readFileSync(resolve(root, "supabase/config.toml"), "utf8");
  const storageSection = config.slice(config.indexOf("\n[storage]\n"));
  const declared = /file_size_limit\s*=\s*(\d+)/.exec(storageSection);
  assert.ok(declared, "[storage] must declare a file_size_limit for the deploy to reconcile against");
  // The layout raster is bounded at 48 megapixels; a limit at the hosted
  // default would reject it. Anything at or below 50 MB is the bug, not a
  // configuration choice.
  assert.ok(Number(declared[1]) > 50_000_000, "the project-wide limit must exceed the 50 MB hosted default");
});
