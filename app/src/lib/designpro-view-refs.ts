/**
 * Turn the render library's DesignPro view references into displayable URLs.
 *
 * A design's views live in the private wrap-files bucket, and the gateway is the
 * only thing allowed to hand out a URL for them — it mints a five-minute signed
 * URL behind the owner's own token. A durable table therefore cannot store a
 * URL, so `color_visualizations.render_urls` / `designiq_generations.render_urls`
 * store `dp://<requestId>/<sourceViewType>` references instead (see the
 * project_generation_into_library migration).
 *
 * The product's surfaces read those maps and use the values as image sources.
 * Rather than teach every one of them about signing, the maps are resolved once
 * where a design ENTERS the UI — the library query, the selected design — and
 * everything downstream keeps working on a plain Record<string, string> exactly
 * as it always has.
 */
import { dpApi } from "@/lib/designpro-api";

const REF = /^dp:\/\/([0-9a-fA-F-]{36})\/([A-Za-z0-9_-]{1,24})$/;

/** Signed URLs last 300s; re-sign a little early so nothing expires mid-render. */
const TTL_MS = 240_000;

type Entry = { at: number; urls: Map<string, string> };
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<Map<string, string>>>();

export function isDesignProViewRef(value: unknown): value is string {
  return typeof value === "string" && REF.test(value);
}

async function signedUrlsFor(requestId: string): Promise<Map<string, string>> {
  const hit = cache.get(requestId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.urls;

  const pending = inflight.get(requestId);
  if (pending) return pending;

  const run = (async () => {
    const urls = new Map<string, string>();
    try {
      for (const view of await dpApi.listGenerationViews(requestId)) {
        if (view?.signedUrl && view.sourceViewType) urls.set(view.sourceViewType, view.signedUrl);
      }
      cache.set(requestId, { at: Date.now(), urls });
    } catch (err) {
      // A design whose views can't be signed right now renders as pending, the
      // same way a half-finished generation always did. Don't poison the cache.
      console.warn("[DesignPro] could not resolve view URLs for", requestId, err);
    } finally {
      inflight.delete(requestId);
    }
    return urls;
  })();

  inflight.set(requestId, run);
  return run;
}

/**
 * Resolve one render_urls map. Values that aren't DesignPro references (legacy
 * rows, MyVehiclePro renders, anything already a URL) are passed through
 * untouched, so this is safe to apply to every row in the library.
 */
export async function resolveRenderUrls<T extends Record<string, unknown> | null | undefined>(
  renderUrls: T,
): Promise<T> {
  if (!renderUrls || typeof renderUrls !== "object") return renderUrls;

  const refs: Array<[string, string, string]> = []; // key, requestId, sourceViewType
  for (const [key, value] of Object.entries(renderUrls)) {
    const m = typeof value === "string" ? REF.exec(value) : null;
    if (m) refs.push([key, m[1].toLowerCase(), m[2]]);
  }
  if (!refs.length) return renderUrls;

  const byRequest = new Map<string, Map<string, string>>();
  await Promise.all(
    [...new Set(refs.map(([, requestId]) => requestId))].map(async (requestId) => {
      byRequest.set(requestId, await signedUrlsFor(requestId));
    }),
  );

  const out: Record<string, unknown> = { ...renderUrls };
  for (const [key, requestId, sourceViewType] of refs) {
    const signed = byRequest.get(requestId)?.get(sourceViewType);
    // An unresolved reference is dropped rather than left as `dp://…`: the
    // product treats a missing key as "this view isn't ready", which is exactly
    // what an unsignable view means. Leaving the marker would render a broken
    // image instead.
    if (signed) out[key] = signed;
    else delete out[key];
  }
  return out as T;
}

/**
 * The single-URL columns on a library row that the product renders directly —
 * a card thumbnail reads custom_design_url, not render_urls, so leaving these
 * as references puts `dp://…` straight into an <img src>.
 */
const URL_COLUMNS = ["custom_design_url", "custom_swatch_url", "hero_render_url"] as const;

/**
 * Resolve the render_urls on a batch of library rows in place-by-copy. Rows
 * without references come back as the same object, so this is cheap on legacy
 * data.
 */
export async function resolveRowRenderUrls<T extends { render_urls?: unknown }>(rows: T[]): Promise<T[]> {
  return Promise.all(
    rows.map(async (row) => {
      const record = row as unknown as Record<string, unknown>;
      const refCols = URL_COLUMNS.filter((c) => isDesignProViewRef(record[c]));
      const resolved = await resolveRenderUrls(row.render_urls as Record<string, unknown> | null);
      if (resolved === row.render_urls && !refCols.length) return row;

      const next: Record<string, unknown> = { ...record, render_urls: resolved };
      for (const column of refCols) next[column] = await resolveViewRef(record[column]);
      return next as T;
    }),
  );
}

/** Resolve a single value that may be a DesignPro reference. */
export async function resolveViewRef(value: unknown): Promise<string | null> {
  if (typeof value !== "string") return null;
  const m = REF.exec(value);
  if (!m) return value;
  return (await signedUrlsFor(m[1].toLowerCase())).get(m[2]) ?? null;
}
