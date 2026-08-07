import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
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
  const mutable = ["install.sh", "deploy.sh", "rollback.sh", "install-caddy.sh", "compose.yaml", "designproai.service"]
    .map(read).join("\n");
  assert.doesNotMatch(mutable, /\/opt\/restylepro|\bpm2\b|docker compose down|docker (?:system )?prune/);
});

test("compose binds only loopback and preserves the exact VectorizIt boundary", () => {
  const compose = read("compose.yaml");
  for (const binding of ["127.0.0.1:3001:3001", "127.0.0.1:3002:3001", "127.0.0.1:8787:8787"]) assert.match(compose, new RegExp(binding.replaceAll(".", "\\.")));
  assert.match(compose, /host\.docker\.internal:3200\/vectorize/);
  assert.doesNotMatch(compose, /0\.0\.0\.0:(3001|3002|8787)/);
  assert.ok((compose.match(/read_only: true/g) || []).length >= 2);
  assert.match(compose, /source: \/opt\/designproai\/shared\/spool/);
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
  assert.match(caddy, /root \* \/opt\/designproai\/public\/web\/dist/);
  const deploy = read("deploy.sh");
  assert.ok(deploy.lastIndexOf('acceptance.sh" "$sha"') < deploy.lastIndexOf('public.next'), "public web switches only after local acceptance");
});

test("role-specific env templates cannot cross the Supabase secret boundary", () => {
  const runtime = read("runtime.env.example");
  const gateway = read("gateway.env.example");
  assert.match(runtime, /SUPABASE_SERVICE_ROLE_KEY=/);
  assert.doesNotMatch(runtime, /SUPABASE_PUBLISHABLE_KEY=/);
  assert.match(gateway, /SUPABASE_PUBLISHABLE_KEY=/);
  assert.doesNotMatch(gateway, /SUPABASE_SERVICE_ROLE_KEY=/);
  assert.match(runtime, /RESEND_API_KEY=/);
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
    `RESEND_API_KEY=re_${"r".repeat(32)}`,
    "RESEND_FROM=DesignProAI WrapBox <delivery@designproai.com>",
    "RESEND_FROM_VERIFIED=true",
    "VECTORIZE_IT_URL=http://host.docker.internal:3200/vectorize",
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
  writeFileSync(gateway, readFileSync(gateway, "utf8") + `SUPABASE_SERVICE_ROLE_KEY=${"x".repeat(40)}\n`);
  chmodSync(gateway, 0o600);
  const result = spawnSync("python3", [join(root, "validate-env.py"), runtime, gateway], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unapproved keys: SUPABASE_SERVICE_ROLE_KEY/);
});
