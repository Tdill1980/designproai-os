/**
 * WordPress + WooCommerce publishing adapter.
 *
 * Auth: WP Application Passwords (Basic auth header). Built into WP 5.6+.
 * Handles: blog post CRUD, Yoast/Rank Math meta injection, media upload,
 * category/author listing, WooCommerce product CRUD + product schema.
 */

export interface WordPressCredentials {
  site_url: string;
  username: string;
  app_password: string;
  seo_plugin?: "yoast" | "rankmath" | "aioseo" | "none";
}

export interface WPCategory {
  id: number;
  name: string;
  slug: string;
}

export interface WPAuthor {
  id: number;
  name: string;
  slug: string;
}

export interface WPMedia {
  id: number;
  source_url: string;
  title?: string;
}

export interface WPPostInput {
  title: string;
  slug?: string;
  content: string;
  excerpt?: string;
  status?: "draft" | "publish" | "future" | "private" | "pending";
  date?: string;
  categories?: number[];
  tags?: number[];
  author?: number;
  featured_media?: number;
  meta?: {
    title?: string;
    description?: string;
    focus_keyword?: string;
    og_image_url?: string;
    canonical_url?: string;
    schema_json?: unknown;
  };
}

export interface WPPostResult {
  id: number;
  link: string;
  status: string;
  slug: string;
  modified: string;
}

export interface WCProductSummary {
  id: number;
  name: string;
  slug: string;
  permalink: string;
  status: string;
  type: string;
  sku: string | null;
  price: string | null;
  short_description: string | null;
  description: string | null;
  meta_data: Array<{ id: number; key: string; value: unknown }>;
}

const ua = "RestyleProSEO/1.0";

function basicAuth(c: WordPressCredentials): string {
  const token = btoa(`${c.username}:${c.app_password}`);
  return `Basic ${token}`;
}

function trimUrl(u: string): string {
  return u.replace(/\/+$/, "");
}

async function wpFetch(
  c: WordPressCredentials,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = `${trimUrl(c.site_url)}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers ?? {});
  headers.set("Authorization", basicAuth(c));
  headers.set("User-Agent", ua);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, { ...init, headers });
  return res;
}

async function jsonOrThrow<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`[${label}] ${res.status} ${res.statusText}: ${txt.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

// ─── Connection test + plugin detection ────────────────────────────────────
export async function testConnection(c: WordPressCredentials) {
  // 1. Identify the WP install
  const rootRes = await wpFetch(c, "/wp-json/");
  const root = await jsonOrThrow<{ name: string; description?: string; namespaces?: string[]; url?: string; }>(
    rootRes,
    "wp-root",
  );

  // 2. Verify the app password actually authenticates by hitting /users/me
  const meRes = await wpFetch(c, "/wp-json/wp/v2/users/me");
  if (meRes.status === 401 || meRes.status === 403) {
    throw new Error(
      "Authentication failed. Check that the username and Application Password are correct. (Generate one at Users → Profile → Application Passwords in WP admin.)",
    );
  }
  const me = await jsonOrThrow<{ id: number; name: string; slug: string }>(meRes, "wp-me");

  // 3. Detect SEO plugin via the namespaces list (Yoast = 'yoast/v1', RankMath = 'rankmath/v1')
  const ns = root.namespaces ?? [];
  let seo_plugin: WordPressCredentials["seo_plugin"] = "none";
  if (ns.some((n) => n.toLowerCase().startsWith("yoast"))) seo_plugin = "yoast";
  else if (ns.some((n) => n.toLowerCase().startsWith("rankmath"))) seo_plugin = "rankmath";
  else if (ns.some((n) => n.toLowerCase().startsWith("aioseo"))) seo_plugin = "aioseo";

  // 4. Detect WooCommerce
  const has_woocommerce = ns.some((n) => n.toLowerCase().startsWith("wc/"));

  return {
    site_name: root.name,
    site_url: root.url ?? c.site_url,
    user: { id: me.id, name: me.name, slug: me.slug },
    namespaces: ns,
    seo_plugin,
    has_woocommerce,
  };
}

// ─── Reference data ────────────────────────────────────────────────────────
export async function listCategories(c: WordPressCredentials): Promise<WPCategory[]> {
  const res = await wpFetch(c, "/wp-json/wp/v2/categories?per_page=100&_fields=id,name,slug");
  return jsonOrThrow<WPCategory[]>(res, "wp-categories");
}

export async function listAuthors(c: WordPressCredentials): Promise<WPAuthor[]> {
  const res = await wpFetch(c, "/wp-json/wp/v2/users?per_page=100&_fields=id,name,slug&context=edit");
  // /users with context=edit requires edit_users cap — fall back to public list if 403
  if (res.status === 403) {
    const pub = await wpFetch(c, "/wp-json/wp/v2/users?per_page=100&_fields=id,name,slug");
    return jsonOrThrow<WPAuthor[]>(pub, "wp-authors-public");
  }
  return jsonOrThrow<WPAuthor[]>(res, "wp-authors");
}

// ─── Media upload ──────────────────────────────────────────────────────────
export async function uploadMediaFromUrl(
  c: WordPressCredentials,
  imageUrl: string,
  filename?: string,
): Promise<WPMedia> {
  const fileRes = await fetch(imageUrl);
  if (!fileRes.ok) throw new Error(`Could not fetch source image: ${fileRes.status}`);
  const blob = await fileRes.blob();
  const ct = fileRes.headers.get("content-type") ?? blob.type ?? "image/jpeg";
  const ext = ct.split("/")[1]?.split(";")[0] ?? "jpg";
  const name = filename ?? `seo-${Date.now()}.${ext}`;

  const headers = new Headers();
  headers.set("Authorization", basicAuth(c));
  headers.set("Content-Type", ct);
  headers.set("Content-Disposition", `attachment; filename="${name}"`);
  headers.set("User-Agent", ua);

  const url = `${trimUrl(c.site_url)}/wp-json/wp/v2/media`;
  const res = await fetch(url, { method: "POST", headers, body: blob });
  return jsonOrThrow<WPMedia>(res, "wp-media-upload");
}

// ─── Yoast / Rank Math meta payload ────────────────────────────────────────
function buildSeoMeta(plugin: WordPressCredentials["seo_plugin"], meta: WPPostInput["meta"]) {
  if (!meta) return {};
  const out: Record<string, unknown> = {};
  if (plugin === "yoast") {
    if (meta.title) out._yoast_wpseo_title = meta.title;
    if (meta.description) out._yoast_wpseo_metadesc = meta.description;
    if (meta.focus_keyword) out._yoast_wpseo_focuskw = meta.focus_keyword;
    if (meta.og_image_url) out["_yoast_wpseo_opengraph-image"] = meta.og_image_url;
    if (meta.canonical_url) out._yoast_wpseo_canonical = meta.canonical_url;
  } else if (plugin === "rankmath") {
    if (meta.title) out.rank_math_title = meta.title;
    if (meta.description) out.rank_math_description = meta.description;
    if (meta.focus_keyword) out.rank_math_focus_keyword = meta.focus_keyword;
    if (meta.og_image_url) out.rank_math_facebook_image = meta.og_image_url;
    if (meta.canonical_url) out.rank_math_canonical_url = meta.canonical_url;
  } else {
    if (meta.title) out.meta_title = meta.title;
    if (meta.description) out.meta_description = meta.description;
  }
  return out;
}

// ─── Post create / update ──────────────────────────────────────────────────
export async function createPost(
  c: WordPressCredentials,
  input: WPPostInput,
): Promise<WPPostResult> {
  const body = {
    title: input.title,
    slug: input.slug,
    content: input.content,
    excerpt: input.excerpt,
    status: input.status ?? "draft",
    date: input.date,
    categories: input.categories,
    tags: input.tags,
    author: input.author,
    featured_media: input.featured_media,
    meta: buildSeoMeta(c.seo_plugin, input.meta),
  };
  const res = await wpFetch(c, "/wp-json/wp/v2/posts", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return jsonOrThrow<WPPostResult>(res, "wp-post-create");
}

export async function updatePost(
  c: WordPressCredentials,
  externalId: string | number,
  input: Partial<WPPostInput>,
): Promise<WPPostResult> {
  const body: Record<string, unknown> = { ...input };
  if (input.meta) body.meta = buildSeoMeta(c.seo_plugin, input.meta);
  const res = await wpFetch(c, `/wp-json/wp/v2/posts/${externalId}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return jsonOrThrow<WPPostResult>(res, "wp-post-update");
}

export async function listPosts(
  c: WordPressCredentials,
  perPage = 50,
  page = 1,
): Promise<Array<{ id: number; title: { rendered: string }; slug: string; link: string; status: string; modified: string }>> {
  const res = await wpFetch(
    c,
    `/wp-json/wp/v2/posts?per_page=${perPage}&page=${page}&status=any&_fields=id,title,slug,link,status,modified`,
  );
  return jsonOrThrow(res, "wp-posts-list");
}

// ─── WooCommerce product (read-only for Phase 1) ───────────────────────────
export async function listWooProducts(
  c: WordPressCredentials,
  perPage = 50,
  page = 1,
): Promise<WCProductSummary[]> {
  const res = await wpFetch(
    c,
    `/wp-json/wc/v3/products?per_page=${perPage}&page=${page}`,
  );
  // wc/v3 honors the same Application Password basic auth.
  return jsonOrThrow<WCProductSummary[]>(res, "wc-products");
}

export async function updateWooProductSeoMeta(
  c: WordPressCredentials,
  productId: number,
  payload: {
    name?: string;
    short_description?: string;
    description?: string;
    meta?: WPPostInput["meta"];
  },
) {
  const seoMeta = buildSeoMeta(c.seo_plugin, payload.meta);
  const meta_data = Object.entries(seoMeta).map(([key, value]) => ({ key, value }));
  const body: Record<string, unknown> = {};
  if (payload.name) body.name = payload.name;
  if (payload.short_description) body.short_description = payload.short_description;
  if (payload.description) body.description = payload.description;
  if (meta_data.length) body.meta_data = meta_data;
  const res = await wpFetch(c, `/wp-json/wc/v3/products/${productId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return jsonOrThrow(res, "wc-product-update");
}
