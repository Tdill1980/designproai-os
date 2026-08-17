/**
 * Serve the DesignPro edge functions from this droplet.
 *
 * Supabase gave each function its own URL under /functions/v1/<name>. This
 * reproduces that routing locally so the migrated frontend and the runtime call
 * the same paths they always did, with nothing rewritten on either side.
 *
 * WHY A ROUTER AND NOT 470 CONTAINERS. Each function is a Deno module that
 * calls serve() at import time. Importing one on demand and handing it the
 * request keeps a single process, a single module cache, and a single set of
 * credentials, while preserving per-function isolation of code.
 *
 * The functions are unmodified. If one behaves differently here than it did on
 * Supabase, that is a difference in environment or routing, not in the design
 * logic - which is the property the whole migration depends on.
 */

const FUNCTIONS_ROOT = new URL("./functions/", import.meta.url);
const PORT = Number(Deno.env.get("PORT") ?? "3003");

/**
 * The routing allowlist. The migrated frontend carries every RestylePro product,
 * so "what the app can invoke" is far wider than the DesignPro chain; routing all
 * of it would put unrelated marketing, video and storefront functions on this
 * droplet with nothing in DesignPro calling them. Only names proven reachable
 * from the DesignPro chain are served - the proof lives beside each name in
 * ops/designpro-functions.txt and is recomputed by ops/designpro-function-graph.mjs.
 */
const ALLOWED = new Set(
  (await Deno.readTextFile(new URL("./designpro-functions.txt", import.meta.url)))
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#")),
);
if (ALLOWED.size === 0) throw new Error("designpro_functions_allowlist_empty");

// A function's handler, captured the moment it registers itself. Deno's
// std/http serve() starts listening, so each module is loaded with a shim in
// place that records the handler instead of binding a second port.
const handlers = new Map<string, (request: Request) => Response | Promise<Response>>();
const loading = new Map<string, Promise<void>>();

/** Only names that exist on disk as a function directory are routable. */
function isRoutableName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(name) && !name.startsWith("_");
}

async function loadFunction(name: string): Promise<void> {
  const entry = new URL(`${name}/index.ts`, FUNCTIONS_ROOT);
  try {
    await Deno.stat(entry);
  } catch {
    throw new Error(`function_not_found:${name}`);
  }
  // The shim: std/http's serve() is what each function calls to start. Capture
  // the handler it passes rather than opening a listener.
  const globalAny = globalThis as Record<string, unknown>;
  const previous = globalAny.__designproCaptureServe;
  globalAny.__designproCaptureServe = (handler: (request: Request) => Response | Promise<Response>) => {
    handlers.set(name, handler);
  };
  try {
    await import(entry.href);
  } finally {
    globalAny.__designproCaptureServe = previous;
  }
  if (!handlers.has(name)) throw new Error(`function_registered_no_handler:${name}`);
}

function functionName(pathname: string): string | null {
  // Supabase's shape, preserved exactly: /functions/v1/<name>[/...]
  const match = pathname.match(/^\/functions\/v1\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

Deno.serve({ port: PORT, hostname: "0.0.0.0" }, async (request) => {
  const url = new URL(request.url);

  if (url.pathname === "/health") {
    return Response.json({ ok: true, routable: ALLOWED.size, loaded: handlers.size });
  }

  const name = functionName(url.pathname);
  if (!name || !isRoutableName(name)) {
    return Response.json({ error: "function_not_found" }, { status: 404 });
  }
  if (!ALLOWED.has(name)) {
    // Distinct from function_not_found on purpose: the function may well exist
    // on disk. It is simply not part of the DesignPro chain, so a call to it
    // from this droplet is a wiring mistake worth naming rather than a 404.
    return Response.json({ error: `function_not_in_designpro_allowlist:${name}` }, { status: 404 });
  }

  if (!handlers.has(name)) {
    // Collapse concurrent first-hits on the same function into one import, so a
    // burst of seven view requests does not load the module seven times.
    let pending = loading.get(name);
    if (!pending) {
      pending = loadFunction(name).finally(() => loading.delete(name));
      loading.set(name, pending);
    }
    try {
      await pending;
    } catch (error) {
      const message = String((error as Error)?.message || error);
      const status = message.startsWith("function_not_found") ? 404 : 500;
      return Response.json({ error: message }, { status });
    }
  }

  const handler = handlers.get(name)!;
  try {
    return await handler(request);
  } catch (error) {
    // Surface the function's own failure rather than a generic 500, so a broken
    // function is legible in the same terms it was on Supabase.
    return Response.json({ error: String((error as Error)?.message || error) }, { status: 500 });
  }
});
