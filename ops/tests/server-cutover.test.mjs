import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha = "a".repeat(40);
const fixed = readFileSync(join(root, "release-files.txt"), "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#") && !line.includes("*"));

const read = (name) => readFileSync(join(root, name), "utf8");

function releaseTree() {
  const dir = mkdtempSync(join(tmpdir(), "designpro-release-"));
  for (const name of fixed) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    if (name === "ops/release-files.txt") writeFileSync(path, readFileSync(join(root, "release-files.txt")));
    else writeFileSync(path, name.endsWith("package.json") ? "{}\n" : `fixture:${name}\n`);
  }
  mkdirSync(join(dir, "web/dist/assets"), { recursive: true });
  writeFileSync(join(dir, "web/dist/assets/app.js"), "console.log('dp');\n");
  return dir;
}

function archive(dir, output) {
  execFileSync("tar", ["-C", dir, "-czf", output, ".designpro-release.json", "runtime", "gateway", "web", "ops"]);
}

test("mutable scripts are DesignPro-only and contain no RP retirement path", () => {
  assert.equal(existsSync(join(root, "retire-rp-service.sh")), false);
  const mutable = ["install.sh", "deploy.sh", "rollback.sh", "install-caddy.sh", "compose.yaml", "designproai-os.service"]
    .map(read).join("\n");
  assert.doesNotMatch(mutable, /\/opt\/restylepro|\bpm2\b|docker compose down|docker (?:system )?prune/);
});

test("nothing of ours claims the shared 'designproai' project or tree", () => {
  // The droplet is shared. A RestylePro worker deploy holds the bare
  // `designproai` Compose project name and the /opt/designproai tree, wired to
  // the RestylePro Supabase project. Our systemd unit runs
  // `docker compose up -d --remove-orphans`, so a single bare project name
  // anywhere in our tooling is enough to delete two healthy containers that are
  // serving traffic — which is exactly what the inventory guard caught.
  //
  // Coexistence that relies on nobody retyping the old name is not
  // coexistence, so it is checked here rather than remembered.
  const opsDir = root;
  const repoRoot = resolve(root, "..");
  const workflowDir = join(repoRoot, ".github/workflows");
  const files = [
    ...readdirSync(opsDir).filter((name) => /\.(sh|yaml|yml|service|txt|md|example)$/.test(name)).map((name) => join(opsDir, name)),
    ...readdirSync(workflowDir).filter((name) => /\.ya?ml$/.test(name)).map((name) => join(workflowDir, name)),
  ];
  const offenders = [];
  for (const file of files) {
    // The RestylePro bootstrap writes into the RestylePro tree on purpose. It
    // is their path, and moving it is not ours to do.
    if (file.endsWith("bootstrap-restylepro-worker-access.yml")) continue;
    for (const [index, line] of readFileSync(file, "utf8").split("\n").entries()) {
      // inventory.sh reports on their unit deliberately; reporting is not claiming.
      if (/stat -c|for path in/.test(line)) continue;
      if (/com\.docker\.compose\.project=designproai(?![-\w])/.test(line)
        || /\/opt\/designproai(?![-\w])/.test(line)
        || /^name: designproai$/.test(line)
        || /COMPOSE_PROJECT_NAME=designproai(?![-\w])/.test(line)) {
        offenders.push(`${file.slice(repoRoot.length + 1)}:${index + 1}  ${line.trim().slice(0, 90)}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `these claim the RestylePro stack's project or tree:\n${offenders.join("\n")}`);
});

test("the unit that runs --remove-orphans is scoped to our own project", () => {
  const unit = read("designproai-os.service");
  assert.match(unit, /Environment=COMPOSE_PROJECT_NAME=designproai-os$/m);
  assert.match(unit, /--remove-orphans/, "kept deliberately: it is safe once the project is ours alone");
  assert.match(unit, /WorkingDirectory=\/opt\/designproai-os\/current$/m);
  assert.match(read("compose.yaml"), /^name: designproai-os$/m);
});

test("compose binds only loopback with two internal workers, shared spool, and no external executor", () => {
  const compose = read("compose.yaml");
  for (const binding of ["127.0.0.1:3001:3001", "127.0.0.1:3002:3001", "127.0.0.1:8787:8787"]) assert.match(compose, new RegExp(binding.replaceAll(".", "\\.")));
  assert.equal((compose.match(/^  runtime-[12]:$/gm) || []).length, 2);
  assert.match(compose, /DESIGNPRO_WORKER_ID: "designpro-worker-1"/);
  assert.match(compose, /DESIGNPRO_WORKER_ID: "designpro-worker-2"/);
  assert.ok(compose.includes('      DESIGNPRO_WORKER_ID: "designpro-worker-1"\n      DESIGNPRO_SPOOL_DIR: "/var/lib/designproai/spool"'));
  assert.ok(compose.includes('      DESIGNPRO_WORKER_ID: "designpro-worker-2"\n      DESIGNPRO_SPOOL_DIR: "/var/lib/designproai/spool"'));
  assert.equal(compose.includes('        DESIGNPRO_SPOOL_DIR: "/var/lib/designproai/spool"'), false);
  assert.doesNotMatch(compose, /host\.docker\.internal:3200|VECTORIZE_IT_URL/);
  assert.doesNotMatch(compose, /0\.0\.0\.0:(3001|3002|8787)/);
  assert.ok((compose.match(/read_only: true/g) || []).length >= 2);
  assert.match(compose, /source: \/opt\/designproai-os\/shared\/spool/);
  assert.match(compose, /target: \/var\/lib\/designproai\/spool/);
  assert.ok((compose.match(/mem_limit: 6g/g) || []).length >= 1);
  assert.ok((compose.match(/cpus: "3\.0"/g) || []).length >= 1);
});

test("Caddy exposes only UI/gateway and explicitly denies worker routes", () => {
  const caddy = read("Caddyfile.fragment");
  const worker = caddy.match(/handle \/worker\/\* \{([\s\S]*?)\n  \}/)?.[1] || "";
  assert.match(worker, /respond 404/);
  assert.doesNotMatch(worker, /reverse_proxy/);
  assert.match(caddy, /handle \/api\/\*/);
  assert.doesNotMatch(caddy, /127\.0\.0\.1:300[12]/);
  assert.match(caddy, /root \* \/opt\/designproai-os\/public\/web\/dist/);
  assert.doesNotMatch(caddy, /redir https:\/\/os\.designproai\.com/);
  assert.match(caddy, /www\.designproai\.com \{\s+redir https:\/\/designproai\.com\{uri\} 301/);
  const apex = caddy.match(/designproai\.com \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(apex, /file_server/);
  assert.doesNotMatch(apex, /reverse_proxy|\/api\/|\/designpro-worker\//);
  const deploy = read("deploy.sh");
  assert.ok(deploy.lastIndexOf('acceptance.sh" "$sha"') < deploy.lastIndexOf('public.next'), "public web switches only after local acceptance");
});

test("Caddy installer safely replaces only the known legacy DesignProAI site", () => {
  const install = read("install-caddy.sh");
  assert.match(install, /legacy_site=\/etc\/caddy\/sites\/os\.designproai\.caddy/);
  assert.match(install, /cp -a "\$legacy_site" "\$backup_dir\/os\.designproai\.caddy\.before"/);
  assert.ok(
    install.indexOf('cp -a "$legacy_site" "$backup_dir/os.designproai.caddy.before"')
      < install.indexOf('unlink "$legacy_site"'),
    "legacy site must be backed up before removal",
  );
  assert.match(install, /cp -a "\$backup_dir\/os\.designproai\.caddy\.before" "\$legacy_site"/);
  assert.match(install, /\$existing == "\$site" \|\| \$existing == "\$legacy_site"/);
  assert.match(install, /already appears in another Caddy config/);
});

test("acceptance validates the regular exact release target, never the current symlink", () => {
  const acceptance = read("acceptance.sh");
  assert.match(acceptance, /release="\$ROOT\/releases\/\$sha"/);
  assert.match(acceptance, /readlink -f "\$ROOT\/current"\) == "\$release"/);
  assert.match(acceptance, /\[\[ -d \$release && ! -L \$release \]\]/);
  assert.match(acceptance, /validate-release-tree\.py" "\$release" "\$sha"/);
  assert.doesNotMatch(acceptance, /validate-release-tree\.py" "\$ROOT\/current"/);
});

test("role-specific env templates cannot cross the Supabase secret boundary", () => {
  const runtime = read("runtime.env.example");
  const gateway = read("gateway.env.example");
  assert.match(runtime, /SUPABASE_SERVICE_ROLE_KEY=/);
  assert.doesNotMatch(runtime, /SUPABASE_PUBLISHABLE_KEY=/);
  assert.match(gateway, /SUPABASE_PUBLISHABLE_KEY=/);
  assert.doesNotMatch(gateway, /SUPABASE_SERVICE_ROLE_KEY=/);
  assert.match(runtime, /DESIGNPRO_OUTBOUND_EMAIL_ENABLED=false/);
  assert.doesNotMatch(runtime, /RESEND_API_KEY=|RESEND_FROM=/);
  assert.match(runtime, /SUPABASE_TUS_ENDPOINT=/);
  assert.match(runtime, /DESIGNPRO_SPOOL_DIR=/);
  assert.match(gateway, /WORKER_SECRET=/);
  for (const text of [runtime, gateway]) assert.match(text, /https:\/\/wozyamlnygaddievzuwn\.supabase\.co/);
});

test("manifest-bound exact release archive validates", () => {
  const dir = releaseTree();
  execFileSync("python3", [join(root, "build-release-manifest.py"), dir, sha]);
  const tgz = join(dir, "release.tgz");
  archive(dir, tgz);
  execFileSync("python3", [join(root, "validate-archive.py"), tgz, sha]);
});

test("archive validation rejects a different claimed Git SHA", () => {
  const dir = releaseTree();
  execFileSync("python3", [join(root, "build-release-manifest.py"), dir, sha]);
  const tgz = join(dir, "release.tgz");
  archive(dir, tgz);
  const result = spawnSync("python3", [join(root, "validate-archive.py"), tgz, "b".repeat(40)], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not bound to the requested Git SHA/);
});

test("archive validation rejects content changed after manifest generation", () => {
  const dir = releaseTree();
  execFileSync("python3", [join(root, "build-release-manifest.py"), dir, sha]);
  writeFileSync(join(dir, "runtime/index.js"), "tampered after exact-head validation\n");
  const tgz = join(dir, "tampered.tgz");
  archive(dir, tgz);
  const result = spawnSync("python3", [join(root, "validate-archive.py"), tgz, sha], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /content digest mismatch: runtime\/index\.js/);
});

test("archive validation rejects an RP retirement script", () => {
  const dir = releaseTree();
  execFileSync("python3", [join(root, "build-release-manifest.py"), dir, sha]);
  writeFileSync(join(dir, "runtime/retire-rp-service.sh"), "#!/bin/false\n");
  const tgz = join(dir, "rp-tool.tgz");
  archive(dir, tgz);
  const result = spawnSync("python3", [join(root, "validate-archive.py"), tgz, sha], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unapproved release file: runtime\/retire-rp-service\.sh/);
});

test("archive validation rejects links even when their path is allowlisted", () => {
  const dir = releaseTree();
  execFileSync("python3", [join(root, "build-release-manifest.py"), dir, sha]);
  const target = join(dir, "runtime/index.js");
  unlinkSync(target);
  symlinkSync("/opt/restylepro/should-never-be-read", target);
  const tgz = join(dir, "link.tgz");
  archive(dir, tgz);
  const result = spawnSync("python3", [join(root, "validate-archive.py"), tgz, sha], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /links and special files are rejected/);
});

test("env validator accepts only root-mode role-separated values", () => {
  const dir = mkdtempSync(join(tmpdir(), "designpro-env-"));
  const runtime = join(dir, "runtime.env");
  const gateway = join(dir, "gateway.env");
  writeFileSync(runtime, [
    "SUPABASE_URL=https://wozyamlnygaddievzuwn.supabase.co",
    `SUPABASE_SERVICE_ROLE_KEY=sb_secret_${"s".repeat(40)}`,
    `WORKER_SECRET=${"w".repeat(40)}`,
    `GOOGLE_AI_API_KEY=${"g".repeat(32)}`,
    "GOOGLE_IMAGE_MODEL=gemini-3-pro-image",
    "DESIGNPRO_APP_ORIGIN=https://os.designproai.com",
    "DESIGNPRO_SPOOL_DIR=/var/lib/designproai/spool",
    "SUPABASE_TUS_ENDPOINT=https://wozyamlnygaddievzuwn.storage.supabase.co/storage/v1/upload/resumable",
    "DESIGNPRO_OUTBOUND_EMAIL_ENABLED=false",
    "DESIGNPRO_TOPAZ_ENABLED=false",
    "",
  ].join("\n"));
  writeFileSync(gateway, [
    "SUPABASE_URL=https://wozyamlnygaddievzuwn.supabase.co",
    `SUPABASE_PUBLISHABLE_KEY=sb_publishable_${"p".repeat(32)}`,
    "DESIGNPRO_APP_ORIGIN=https://os.designproai.com",
    "DESIGNPRO_RUNTIME_INTERNAL_URL=http://runtime-1:3001",
    `WORKER_SECRET=${"w".repeat(40)}`,
    "",
  ].join("\n"));
  chmodSync(runtime, 0o600);
  chmodSync(gateway, 0o600);
  execFileSync("python3", [join(root, "validate-env.py"), runtime, gateway]);
  const darkRuntime = readFileSync(runtime, "utf8");
  writeFileSync(runtime, darkRuntime + `RESEND_API_KEY=re_${"r".repeat(32)}\n`);
  chmodSync(runtime, 0o600);
  const staleEmail = spawnSync("python3", [join(root, "validate-env.py"), runtime, gateway], { encoding: "utf8" });
  assert.notEqual(staleEmail.status, 0);
  assert.match(staleEmail.stderr, /unapproved keys: RESEND_API_KEY/);
  writeFileSync(runtime, darkRuntime);
  chmodSync(runtime, 0o600);
  writeFileSync(gateway, readFileSync(gateway, "utf8") + `SUPABASE_SERVICE_ROLE_KEY=${"x".repeat(40)}\n`);
  chmodSync(gateway, 0o600);
  const result = spawnSync("python3", [join(root, "validate-env.py"), runtime, gateway], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unapproved keys: SUPABASE_SERVICE_ROLE_KEY/);
});

test("env validator fails closed when email is enabled without an exact provider contract", () => {
  const dir = mkdtempSync(join(tmpdir(), "designpro-email-env-"));
  const runtime = join(dir, "runtime.env");
  const gateway = join(dir, "gateway.env");
  const baseRuntime = [
    "SUPABASE_URL=https://wozyamlnygaddievzuwn.supabase.co",
    `SUPABASE_SERVICE_ROLE_KEY=sb_secret_${"s".repeat(40)}`,
    `WORKER_SECRET=${"w".repeat(40)}`,
    `GOOGLE_AI_API_KEY=${"g".repeat(32)}`,
    "GOOGLE_IMAGE_MODEL=gemini-3-pro-image",
    "DESIGNPRO_APP_ORIGIN=https://os.designproai.com",
    "DESIGNPRO_SPOOL_DIR=/var/lib/designproai/spool",
    "SUPABASE_TUS_ENDPOINT=https://wozyamlnygaddievzuwn.storage.supabase.co/storage/v1/upload/resumable",
    "DESIGNPRO_TOPAZ_ENABLED=false",
  ];
  writeFileSync(runtime, [...baseRuntime, "DESIGNPRO_OUTBOUND_EMAIL_ENABLED=true", ""].join("\n"));
  writeFileSync(gateway, [
    "SUPABASE_URL=https://wozyamlnygaddievzuwn.supabase.co",
    `SUPABASE_PUBLISHABLE_KEY=sb_publishable_${"p".repeat(32)}`,
    "DESIGNPRO_APP_ORIGIN=https://os.designproai.com",
    "DESIGNPRO_RUNTIME_INTERNAL_URL=http://runtime-1:3001",
    `WORKER_SECRET=${"w".repeat(40)}`,
    "",
  ].join("\n"));
  chmodSync(runtime, 0o600);
  chmodSync(gateway, 0o600);
  const missing = spawnSync("python3", [join(root, "validate-env.py"), runtime, gateway], { encoding: "utf8" });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /missing keys: RESEND_API_KEY,RESEND_FROM,RESEND_FROM_VERIFIED/);

  writeFileSync(runtime, [
    ...baseRuntime,
    "DESIGNPRO_OUTBOUND_EMAIL_ENABLED=true",
    `RESEND_API_KEY=re_${"r".repeat(32)}`,
    "RESEND_FROM=DesignProAI WrapBox <delivery@designproai.com>",
    "RESEND_FROM_VERIFIED=true",
    "",
  ].join("\n"));
  chmodSync(runtime, 0o600);
  execFileSync("python3", [join(root, "validate-env.py"), runtime, gateway]);
});
