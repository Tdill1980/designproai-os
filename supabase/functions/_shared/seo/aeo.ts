/**
 * aeo.ts — Answer Engine Optimization (AEO) builders.
 *
 * AEO = getting cited by AI answer engines (Google AI Overviews, ChatGPT,
 * Perplexity, etc.) via structured data, answer-first content blocks, and an
 * llms.txt file.
 *
 * This is a PURE helper module: no serve(), no I/O, no side effects. Every
 * export is a deterministic builder that returns JSON-LD objects, ready-to-paste
 * HTML strings, or markdown. Everything is dependency-free, typed, and
 * defensive — undefined fields are skipped so the emitted JSON-LD stays clean
 * (no `"author": undefined` noise that breaks validators).
 */

const SCHEMA_CONTEXT = "https://schema.org";

// ── small internal helpers ────────────────────────────────────────────────

/** Drop keys whose value is undefined/null/empty-string so JSON-LD stays clean. */
function prune<T extends Record<string, unknown>>(obj: T): T {
  const out = {} as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out as T;
}

/** Escape text for safe inclusion in HTML text/attribute contexts. */
function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── types ──────────────────────────────────────────────────────────────────

export interface FaqItem {
  q: string;
  a: string;
}

export interface ArticleSchemaInput {
  headline: string;
  description: string;
  url: string;
  imageUrl?: string;
  authorName: string;
  authorTitle?: string;
  authorUrl?: string;
  orgName: string;
  orgUrl: string;
  orgLogoUrl?: string;
  datePublished?: string;
  dateModified?: string;
}

export interface HowToStep {
  name: string;
  text: string;
}

export interface HowToSchemaInput {
  name: string;
  description: string;
  steps: HowToStep[];
}

export interface OrganizationSchemaInput {
  name: string;
  url: string;
  logoUrl?: string;
  description?: string;
  sameAs?: string[];
  telephone?: string;
  email?: string;
}

export interface StoreSchemaInput {
  name: string;
  url: string;
  description?: string;
  logoUrl?: string;
  telephone?: string;
  email?: string;
  sameAs?: string[];
}

export interface WebsiteSchemaInput {
  name: string;
  url: string;
  searchUrlTemplate?: string;
}

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export interface LlmsTxtInput {
  brandName: string;
  siteUrl: string;
  summary: string;
  products?: Array<{ name: string; url: string }>;
  posts?: Array<{ title: string; url: string }>;
  facts?: string[];
  contact?: { email?: string; phone?: string; url?: string };
}

// ── JSON-LD builders ────────────────────────────────────────────────────────

/**
 * FAQPage JSON-LD. Returns null when there are no usable FAQ pairs so callers
 * can omit the node entirely (combineGraph filters nulls).
 */
export function buildFaqSchema(faqs: FaqItem[]): Record<string, unknown> | null {
  const clean = (faqs ?? []).filter(
    (f) => f && typeof f.q === "string" && f.q.trim() && typeof f.a === "string" && f.a.trim(),
  );
  if (clean.length === 0) return null;
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "FAQPage",
    mainEntity: clean.map((f) => ({
      "@type": "Question",
      name: f.q.trim(),
      acceptedAnswer: {
        "@type": "Answer",
        text: f.a.trim(),
      },
    })),
  };
}

/**
 * Article JSON-LD with author (Person) + publisher (Organization) for E-E-A-T.
 * Strong author/publisher signals are what answer engines lean on when deciding
 * whether content is trustworthy enough to cite.
 */
export function buildArticleSchema(input: ArticleSchemaInput): Record<string, unknown> {
  const author = prune({
    "@type": "Person",
    name: input.authorName,
    jobTitle: input.authorTitle,
    url: input.authorUrl,
  });

  const publisher = prune({
    "@type": "Organization",
    name: input.orgName,
    url: input.orgUrl,
    logo: input.orgLogoUrl
      ? { "@type": "ImageObject", url: input.orgLogoUrl }
      : undefined,
  });

  return prune({
    "@context": SCHEMA_CONTEXT,
    "@type": "Article",
    headline: input.headline,
    description: input.description,
    url: input.url,
    mainEntityOfPage: input.url ? { "@type": "WebPage", "@id": input.url } : undefined,
    image: input.imageUrl ? [input.imageUrl] : undefined,
    author,
    publisher,
    datePublished: input.datePublished,
    dateModified: input.dateModified ?? input.datePublished,
  });
}

/** HowTo JSON-LD — strong AEO signal for "how to wrap a …" intent. */
export function buildHowToSchema(input: HowToSchemaInput): Record<string, unknown> {
  const steps = (input.steps ?? [])
    .filter((s) => s && (s.name?.trim() || s.text?.trim()))
    .map((s, i) =>
      prune({
        "@type": "HowToStep",
        position: i + 1,
        name: s.name,
        text: s.text,
      }),
    );
  return prune({
    "@context": SCHEMA_CONTEXT,
    "@type": "HowTo",
    name: input.name,
    description: input.description,
    step: steps.length ? steps : undefined,
  });
}

/** Organization JSON-LD (+ sameAs social profiles when provided). */
export function buildOrganizationSchema(
  input: OrganizationSchemaInput,
): Record<string, unknown> {
  return prune({
    "@context": SCHEMA_CONTEXT,
    "@type": "Organization",
    name: input.name,
    url: input.url,
    description: input.description,
    logo: input.logoUrl ? { "@type": "ImageObject", url: input.logoUrl } : undefined,
    telephone: input.telephone,
    email: input.email,
    sameAs: input.sameAs && input.sameAs.length ? input.sameAs : undefined,
  });
}

/** Store / LocalBusiness JSON-LD (uses @type "Store"). */
export function buildStoreSchema(input: StoreSchemaInput): Record<string, unknown> {
  return prune({
    "@context": SCHEMA_CONTEXT,
    "@type": "Store",
    name: input.name,
    url: input.url,
    description: input.description,
    image: input.logoUrl,
    logo: input.logoUrl ? { "@type": "ImageObject", url: input.logoUrl } : undefined,
    telephone: input.telephone,
    email: input.email,
    sameAs: input.sameAs && input.sameAs.length ? input.sameAs : undefined,
  });
}

/** WebSite JSON-LD with a SearchAction (sitelinks search box / AEO crawl hint). */
export function buildWebsiteSchema(input: WebsiteSchemaInput): Record<string, unknown> {
  const base = (input.url ?? "").replace(/\/+$/, "");
  const template = input.searchUrlTemplate ?? `${base}/?s={search_term_string}`;
  return prune({
    "@context": SCHEMA_CONTEXT,
    "@type": "WebSite",
    name: input.name,
    url: input.url,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: template,
      },
      "query-input": "required name=search_term_string",
    },
  });
}

/** BreadcrumbList JSON-LD. */
export function buildBreadcrumbSchema(items: BreadcrumbItem[]): Record<string, unknown> {
  const clean = (items ?? []).filter((i) => i && i.name?.trim() && i.url?.trim());
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: clean.map((i, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: i.name,
      item: i.url,
    })),
  };
}

/**
 * SpeakableSpecification fragment — marks the CSS sections an assistant can read
 * aloud. Returned as a fragment so it can be merged into a WebPage/Article node.
 */
export function buildSpeakable(cssSelectors?: string[]): Record<string, unknown> {
  const selectors =
    cssSelectors && cssSelectors.length
      ? cssSelectors
      : [".aeo-key-takeaways", ".aeo-faq", "h1"];
  return {
    "@type": "SpeakableSpecification",
    cssSelector: selectors,
  };
}

/**
 * Wrap any number of (possibly null) JSON-LD nodes into a single @graph
 * document. Null/undefined nodes are dropped, so callers can pass the result of
 * buildFaqSchema() directly without guarding.
 */
export function combineGraph(
  ...nodes: Array<Record<string, unknown> | null | undefined>
): Record<string, unknown> {
  const graph = nodes
    .filter((n): n is Record<string, unknown> => !!n)
    // Strip the per-node @context — the wrapper supplies it once.
    .map((n) => {
      const { ["@context"]: _ctx, ...rest } = n;
      return rest;
    });
  return {
    "@context": SCHEMA_CONTEXT,
    "@graph": graph,
  };
}

// ── Answer-first HTML blocks ────────────────────────────────────────────────

/**
 * Self-contained "Key Takeaways" / answer-first box. Inline-styled, accessible,
 * no <script> and no external CSS — safe to paste into a blog post body or an
 * Elementor HTML widget. This is the answer-first block AEO engines reward.
 */
export function buildKeyTakeawaysHtml(
  takeaways: string[],
  heading = "Key Takeaways",
): string {
  const items = (takeaways ?? []).filter((t) => typeof t === "string" && t.trim());
  if (items.length === 0) return "";
  const lis = items
    .map(
      (t) =>
        `<li style="margin:0 0 8px 0;padding-left:4px;line-height:1.5;">${escapeHtml(t.trim())}</li>`,
    )
    .join("");
  return `<aside class="aeo-key-takeaways" role="note" aria-label="${escapeHtml(heading)}" style="border:1px solid #e2e8f0;border-left:4px solid #3b82f6;background:#f8fafc;border-radius:10px;padding:18px 20px;margin:20px 0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <h2 style="margin:0 0 12px 0;font-size:18px;font-weight:700;color:#0f172a;">${escapeHtml(heading)}</h2>
  <ul style="margin:0;padding:0 0 0 20px;">${lis}</ul>
</aside>`;
}

/**
 * Self-contained accessible FAQ block using <details>/<summary>. Inline-styled,
 * no <script> — native disclosure behavior. Pairs with buildFaqSchema() so the
 * visible Q&A matches the structured data.
 */
export function buildFaqHtml(faqs: FaqItem[]): string {
  const clean = (faqs ?? []).filter(
    (f) => f && f.q?.trim() && f.a?.trim(),
  );
  if (clean.length === 0) return "";
  const blocks = clean
    .map(
      (f) => `  <details class="aeo-faq-item" style="border:1px solid #e2e8f0;border-radius:10px;margin:0 0 10px 0;padding:0;background:#ffffff;">
    <summary style="cursor:pointer;list-style:none;padding:14px 18px;font-weight:600;font-size:16px;color:#0f172a;">${escapeHtml(f.q.trim())}</summary>
    <div style="padding:0 18px 16px 18px;line-height:1.6;color:#334155;">${escapeHtml(f.a.trim())}</div>
  </details>`,
    )
    .join("\n");
  return `<section class="aeo-faq" aria-label="Frequently asked questions" style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;margin:20px 0;">
  <h2 style="margin:0 0 14px 0;font-size:22px;font-weight:700;color:#0f172a;">Frequently Asked Questions</h2>
${blocks}
</section>`;
}

// ── llms.txt ────────────────────────────────────────────────────────────────

/**
 * Generate a valid llms.txt (markdown) per the llms.txt convention:
 *   # Brand
 *   > one-line summary (blockquote)
 *   ## Products / ## Guides & Blog / ## Key Facts / ## Contact
 * Sections with no data are omitted. Returns a trailing-newline-terminated
 * markdown string.
 */
export function buildLlmsTxt(input: LlmsTxtInput): string {
  const lines: string[] = [];
  const brand = (input.brandName ?? "").trim() || "Brand";
  lines.push(`# ${brand}`);
  lines.push("");

  const summary = (input.summary ?? "").trim();
  if (summary) {
    lines.push(`> ${summary}`);
    lines.push("");
  }

  const site = (input.siteUrl ?? "").trim();
  if (site) {
    lines.push(`Website: ${site}`);
    lines.push("");
  }

  const products = (input.products ?? []).filter((p) => p && p.name?.trim() && p.url?.trim());
  if (products.length) {
    lines.push("## Products");
    lines.push("");
    for (const p of products) {
      lines.push(`- [${p.name.trim()}](${p.url.trim()})`);
    }
    lines.push("");
  }

  const posts = (input.posts ?? []).filter((p) => p && p.title?.trim() && p.url?.trim());
  if (posts.length) {
    lines.push("## Guides & Blog");
    lines.push("");
    for (const p of posts) {
      lines.push(`- [${p.title.trim()}](${p.url.trim()})`);
    }
    lines.push("");
  }

  const facts = (input.facts ?? []).filter((f) => typeof f === "string" && f.trim());
  if (facts.length) {
    lines.push("## Key Facts");
    lines.push("");
    for (const f of facts) {
      lines.push(`- ${f.trim()}`);
    }
    lines.push("");
  }

  const contact = input.contact;
  const hasContact =
    contact && (contact.email?.trim() || contact.phone?.trim() || contact.url?.trim());
  if (hasContact) {
    lines.push("## Contact");
    lines.push("");
    if (contact!.email?.trim()) lines.push(`- Email: ${contact!.email.trim()}`);
    if (contact!.phone?.trim()) lines.push(`- Phone: ${contact!.phone.trim()}`);
    if (contact!.url?.trim()) lines.push(`- Contact page: ${contact!.url.trim()}`);
    lines.push("");
  }

  // Collapse any accidental triple-blank runs and ensure a single trailing newline.
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
