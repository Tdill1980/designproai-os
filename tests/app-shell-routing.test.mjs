import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Static contracts for the DesignProAI shell.
 *
 * The shell was copied from a suite that served far more surfaces than this
 * standalone system does. Pruning the routes without pruning the navigation
 * left sidebar and tab entries pointing at paths the router does not serve, so
 * they landed on the 404 page. These tests make that class of defect fail the
 * release instead of reaching an operator.
 *
 * They are deliberately static: the release gate must not need a browser, a
 * Supabase project or a running gateway to prove the shell is coherent.
 */

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

/**
 * Comments explain why a thing is absent, so they name the very identifiers
 * the absence tests look for. Strip them, or the documentation fails the
 * contract it documents.
 */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const APP = read("app/src/App.tsx");
const NAV = read("app/src/lib/dashboard-nav.ts");
const TABS = read("app/src/components/layout/AppBottomTabs.tsx");
const API = read("app/src/lib/designpro-api.ts");
const IS_APP_ROUTE = read("app/src/hooks/useIsAppRoute.ts");

/** Every path the router declares, including the catch-all. */
function declaredRoutes() {
  return [...APP.matchAll(/<Route\s+path="([^"]+)"/g)].map((match) => match[1]);
}

/**
 * A declared route matches a concrete link when the literal segments line up
 * and every `:param` segment is filled by something.
 */
function routeServes(declared, link) {
  const declaredParts = declared.split("/");
  const linkParts = link.split("/");
  if (declaredParts.length !== linkParts.length) return false;
  return declaredParts.every(
    (part, index) => part.startsWith(":") || part === linkParts[index],
  );
}

function isServed(link) {
  return declaredRoutes().some((declared) => routeServes(declared, link));
}

test("every route the router declares is unique", () => {
  const routes = declaredRoutes();
  const duplicates = routes.filter((route, index) => routes.indexOf(route) !== index);
  assert.deepEqual(duplicates, [], `duplicate <Route path>: ${duplicates.join(", ")}`);
});

test("the DesignProAI operating path is routed end to end", () => {
  for (const route of [
    "/designpro/generate",
    "/designpro/revisions/new",
    "/designpro/jobs",
    "/designpro/jobs/:generationId",
    "/designpro/genie-qc",
    "/designpro/wrapbox",
    "/designpro/wrapbox/:packId",
  ]) {
    assert.ok(declaredRoutes().includes(route), `${route} is not declared in App.tsx`);
  }
});

test("every operating surface is behind the shell's auth guard", () => {
  // The gateway refuses an unauthenticated call anyway, but an operating
  // surface that renders before the guard shows an empty error state instead
  // of the sign-in the shell already knows how to run.
  for (const element of [
    "DesignProGenerate",
    "DesignProJobs",
    "DesignProWorkflow",
    "DesignProGenieQc",
    "DesignProNewRevision",
    "DesignProWrapBox",
    "DesignProWrapBoxPack",
  ]) {
    assert.match(
      APP,
      new RegExp(`<RequireAuth><${element}\\s*/></RequireAuth>`),
      `${element} must be wrapped in <RequireAuth>`,
    );
  }
});

test("the DesignPro surfaces keep the app shell chrome", () => {
  // AppShell only renders the sidebar and bottom tabs for paths listed here.
  assert.match(IS_APP_ROUTE, /"\/designpro"/);
});

test("every sidebar destination is a route the router serves", () => {
  const routes = [...NAV.matchAll(/route:\s*"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(routes.length > 0, "the navigation registry declares no routes");
  const dead = routes.filter((route) => !isServed(route));
  assert.deepEqual(dead, [], `sidebar entries with no route: ${dead.join(", ")}`);
});

test("every mobile tab destination is a route the router serves", () => {
  const routes = [...TABS.matchAll(/route:\s*"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(routes.length > 0, "the mobile tab bar declares no routes");
  const dead = routes.filter((route) => !isServed(route));
  assert.deepEqual(dead, [], `mobile tabs with no route: ${dead.join(", ")}`);
});

test("the shell chrome links only to routes the router serves", () => {
  // Header and Footer render on every page, so a dead link here is the most
  // visible failure in the product. Both are built from the navigation
  // registry rather than hand-written lists, which is what keeps them honest;
  // this proves the rendered result, not just the intent.
  for (const path of ["app/src/components/Header.tsx", "app/src/components/Footer.tsx"]) {
    const source = read(path);
    const links = [
      ...new Set([...source.matchAll(/to="(\/[^"]*)"/g)].map((match) => match[1].split("?")[0])),
    ];
    const dead = links.filter((link) => !isServed(link));
    assert.deepEqual(dead, [], `${path} links to nothing: ${dead.join(", ")}`);
  }
});

test("the shell chrome carries no RestylePro wordmark", () => {
  // The shell is a duplicate of the RestylePro app. Every operator-visible
  // brand string in the persistent chrome has to be DesignProAI's.
  for (const path of ["app/src/components/Header.tsx", "app/src/components/Footer.tsx"]) {
    // Comments explain what was replaced and name the old brand doing it.
    assert.ok(
      !/Restyle\s*<\/span>|RestylePro|ProductionFlow™/.test(stripComments(read(path))),
      `${path} still renders a non-DesignProAI wordmark`,
    );
  }
});

test("no redirect points at a path the router does not serve", () => {
  const targets = [...APP.matchAll(/<Navigate\s+to="([^"]+)"/g)].map((match) => match[1]);
  const dead = targets.filter((target) => !isServed(target));
  assert.deepEqual(dead, [], `redirects to nowhere: ${dead.join(", ")}`);
});

test("every public asset the shell ships is one it references", () => {
  // The shell was pruned from 176 MB to 88 MB of public assets by deleting
  // what no reachable code names. This is the other half of that contract: a
  // file left in public/ that nothing references is dead weight in every
  // release archive and every deploy.
  //
  // Reachability is judged against the built bundles when they exist, because
  // src/ still holds hundreds of pages the router no longer mounts. Without a
  // build to compare against there is nothing to prove, so the check is
  // skipped rather than guessed at.
  const dist = resolve(root, "app/dist/assets");
  if (!existsSync(dist)) return;

  const distRoot = resolve(root, "app/dist");
  const walkFiles = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walkFiles(resolve(dir, entry.name))
        : [resolve(dir, entry.name)],
    );

  // The bundles, plus every standalone page: those are copied out of public/
  // and served straight off the filesystem, so the SPA never names them or the
  // images they use.
  const hay = walkFiles(distRoot)
    .filter((path) => /\.(js|css|html)$/.test(path))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");

  // Files the browser fetches by convention, which no bundle has to name.
  const byConvention =
    /^(favicon\.[^/]+|robots\.txt|sitemap[^/]*\.xml|site\.webmanifest|manifest\.json|_deploy-marker\.txt|placeholder\.svg|_redirects)$/;

  const publicRoot = resolve(root, "app/public");
  const walk = (dir, prefix = "") =>
    readdirSync(resolve(publicRoot, dir), { withFileTypes: true }).flatMap((entry) => {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      return entry.isDirectory() ? walk(rel, rel) : [rel];
    });

  const orphans = walk("").filter((rel) => {
    if (byConvention.test(rel) || rel.endsWith(".html")) return false;
    const name = rel.split("/").pop();
    const stem = name.replace(/\.[^.]+$/, "");
    return !hay.includes(`/${rel}`) && !hay.includes(name) && !hay.includes(stem);
  });

  assert.deepEqual(orphans, [], `public assets nothing references: ${orphans.join(", ")}`);
});

test("the browser never drives the orchestration the runtime owns", () => {
  // These edge functions belong to the source suite. The runtime owns proof,
  // panel, revision and logo work now, so a surface calling them would be a
  // second, divergent pipeline rather than a view of the real one.
  for (const fn of [
    "run-production-flow",
    "generate-2d-proof",
    "revise-render",
    "panelizer-step-validate",
    "proof-save-version",
    "designpro-clean-views",
  ]) {
    assert.ok(
      !stripComments(APP).includes(fn),
      `App.tsx must not reach the browser-orchestration function ${fn}`,
    );
  }
});

test("the gateway client never sends a server-owned generation control", () => {
  // prompt, model, seed and camera angle are frozen by the engine contract.
  // The gateway rejects them, and the browser must not try.
  const body = API.slice(API.indexOf("const input: Record<string, unknown>"));
  for (const control of ["prompt", "model", "seed", "cameraAngle", "viewAngle"]) {
    assert.ok(
      !new RegExp(`\\b${control}\\s*:`).test(body),
      `the generation request must not carry the server-owned control "${control}"`,
    );
  }
});

test("the seven view roles and their cameras stay in lockstep", () => {
  // sourceViewType and consumerRole are not interchangeable: the regenerate
  // route is keyed by the camera, every display surface by the role. A missing
  // pair silently disables regeneration for that angle.
  for (const [role, camera] of [
    ["driver", "side"],
    ["passenger", "passenger-side"],
    ["hood", "hood_detail"],
    ["roof", "roof"],
    ["front", "front"],
    ["rear", "rear"],
    ["hero3d", "hero-3d"],
  ]) {
    assert.match(
      API,
      new RegExp(`${role}:\\s*"${camera}"`),
      `${role} must map to the "${camera}" camera`,
    );
  }
  // close-up is retained by the server for historical rows only; it is not in
  // the plan and must never be presented as the hero view.
  assert.ok(
    !stripComments(API).includes("close-up"),
    "close-up is not part of the seven-view plan",
  );
});

test("the release ships the operator shell as the served application", () => {
  // web/dist is the archive's name for the web build, and the Caddy root, the
  // deploy pointer and the acceptance probe all read that path. What changed
  // is where those bytes come from. If the builder ever went back to sourcing
  // web/, the archive would still validate and the deploy would still go
  // green -- it would just serve the minimal control panel, and none of the
  // branded operating surfaces would exist in the browser.
  const builder = read("scripts/build-release.sh");
  assert.match(builder, /web_build="\$root\/app\/dist"/);
  assert.match(builder, /"\$stage\/web\/dist\/\$relative"/);

  // Whatever else moves, the served root must not.
  assert.match(read("ops/Caddyfile.fragment"), /root \* \/opt\/designproai-os\/public\/web\/dist/);
  assert.match(read("ops/acceptance.sh"), /current\/web\/dist\/index\.html/);

  // CI has to build the shell, or build-release.sh refuses for want of
  // app/dist and the release never gets made at all.
  assert.match(read(".github/workflows/release.yml"), /npm run build --prefix app/);
});

test("the shell authenticates the gateway with its own supabase session", () => {
  assert.match(API, /getSession\(\)/);
  assert.match(API, /authorization: `Bearer \$\{token\}`/);
});
