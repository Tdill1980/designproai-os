/**
 * On-page SEO scoring.
 *
 * Scores a single page (HTML string + intended meta) against a checklist
 * inspired by Yoast/Rank Math. Pure function — no external calls.
 *
 * Returns a score 0-100 and a list of findings (severity + message + fix).
 */

export type SeoFindingSeverity = "good" | "improve" | "issue" | "critical";

export interface SeoFinding {
  id: string;
  severity: SeoFindingSeverity;
  message: string;
  fix?: string;
}

export interface SeoScoreInput {
  html?: string;
  url?: string;
  title?: string;
  metaTitle?: string;
  metaDescription?: string;
  focusKeyword?: string;
  bodyText?: string;
  bodyHtml?: string;
  imagesWithoutAlt?: number;
  totalImages?: number;
  internalLinkCount?: number;
  externalLinkCount?: number;
  hasSchema?: boolean;
  hasH1?: boolean;
  h1Count?: number;
  wordCount?: number;
  hasOpenGraph?: boolean;
  hasCanonical?: boolean;
}

export interface SeoScoreResult {
  score: number;
  findings: SeoFinding[];
}

const META_TITLE_MIN = 30;
const META_TITLE_MAX = 60;
const META_DESC_MIN = 120;
const META_DESC_MAX = 160;
const MIN_WORD_COUNT = 600;
const RECOMMENDED_WORD_COUNT = 1200;
const MIN_INTERNAL_LINKS = 3;

export function scoreSeo(input: SeoScoreInput): SeoScoreResult {
  const findings: SeoFinding[] = [];
  let points = 0;
  let max = 0;

  function check(weight: number, pass: boolean, finding: SeoFinding) {
    max += weight;
    if (pass) {
      points += weight;
      findings.push({ ...finding, severity: "good" });
    } else {
      findings.push(finding);
    }
  }

  // 1. Meta title
  const mt = (input.metaTitle ?? input.title ?? "").trim();
  check(10, mt.length >= META_TITLE_MIN && mt.length <= META_TITLE_MAX, {
    id: "meta_title",
    severity: mt.length === 0 ? "critical" : "improve",
    message: mt.length === 0
      ? "Missing meta title."
      : mt.length < META_TITLE_MIN
      ? `Meta title is too short (${mt.length} chars). Aim for ${META_TITLE_MIN}-${META_TITLE_MAX}.`
      : `Meta title is too long (${mt.length} chars). It will get truncated in SERPs. Aim for ${META_TITLE_MIN}-${META_TITLE_MAX}.`,
    fix: "Rewrite the meta title to be 50-60 characters and include the focus keyword near the start.",
  });

  // 2. Meta description
  const md = (input.metaDescription ?? "").trim();
  check(10, md.length >= META_DESC_MIN && md.length <= META_DESC_MAX, {
    id: "meta_description",
    severity: md.length === 0 ? "critical" : "improve",
    message: md.length === 0
      ? "Missing meta description."
      : md.length < META_DESC_MIN
      ? `Meta description is too short (${md.length} chars). Aim for ${META_DESC_MIN}-${META_DESC_MAX}.`
      : `Meta description is too long (${md.length} chars). It will get truncated. Aim for ${META_DESC_MIN}-${META_DESC_MAX}.`,
    fix: "Write a 150-character description with a benefit + keyword + CTA.",
  });

  // 3. Focus keyword present in meta title
  if (input.focusKeyword) {
    const fk = input.focusKeyword.toLowerCase();
    check(8, mt.toLowerCase().includes(fk), {
      id: "fk_in_title",
      severity: "issue",
      message: `Focus keyword "${input.focusKeyword}" not found in meta title.`,
      fix: "Move the focus keyword into the first half of the meta title.",
    });
    check(5, md.toLowerCase().includes(fk), {
      id: "fk_in_desc",
      severity: "improve",
      message: `Focus keyword "${input.focusKeyword}" not found in meta description.`,
      fix: "Use the focus keyword once naturally in the meta description.",
    });

    // 4. Focus keyword density in body
    const body = (input.bodyText ?? "").toLowerCase();
    if (body.length > 0) {
      const occurrences = body.split(fk).length - 1;
      const wc = input.wordCount ?? body.split(/\s+/).filter(Boolean).length;
      const density = wc > 0 ? (occurrences / wc) * 100 : 0;
      check(8, density >= 0.5 && density <= 2.5 && occurrences >= 2, {
        id: "fk_density",
        severity: "improve",
        message: occurrences === 0
          ? `Focus keyword "${input.focusKeyword}" never appears in body.`
          : density < 0.5
          ? `Focus keyword density is low (${density.toFixed(2)}%, ${occurrences} occurrences). Aim for 0.5-2.5%.`
          : `Focus keyword density is high (${density.toFixed(2)}%). May read as keyword-stuffed.`,
        fix: "Use the focus keyword naturally 4-8 times across the post, including the first paragraph and one heading.",
      });
    }
  }

  // 5. Word count
  const wc = input.wordCount ?? 0;
  check(10, wc >= MIN_WORD_COUNT, {
    id: "word_count",
    severity: wc < 300 ? "issue" : "improve",
    message:
      wc === 0
        ? "No body content detected."
        : `Word count is ${wc}. Pages with ${RECOMMENDED_WORD_COUNT}+ words tend to rank higher for buyer-intent and comparison content.`,
    fix: "Expand to at least 1200 words. Add a FAQ section, a comparison table, or a how-to walkthrough.",
  });

  // 6. H1
  check(8, !!input.hasH1 && (input.h1Count ?? 1) === 1, {
    id: "h1",
    severity: "issue",
    message:
      !input.hasH1
        ? "No H1 detected."
        : (input.h1Count ?? 0) > 1
        ? `Multiple H1 tags (${input.h1Count}) found.`
        : "H1 missing.",
    fix: "Use exactly one H1 per page, and put the focus keyword in it.",
  });

  // 7. Image alt coverage
  if ((input.totalImages ?? 0) > 0) {
    const noAlt = input.imagesWithoutAlt ?? 0;
    const cov = 1 - noAlt / (input.totalImages as number);
    check(6, cov >= 0.95, {
      id: "alt_coverage",
      severity: "improve",
      message: `${noAlt} of ${input.totalImages} images are missing alt text.`,
      fix: "Add descriptive alt text to every image. Include keywords where natural.",
    });
  }

  // 8. Internal links
  const il = input.internalLinkCount ?? 0;
  check(8, il >= MIN_INTERNAL_LINKS, {
    id: "internal_links",
    severity: "improve",
    message: `Only ${il} internal link(s) found. Pages with 3+ contextual internal links rank better and convert more.`,
    fix: "Link to relevant product/category pages and 2-3 supporting blog posts.",
  });

  // 9. External links
  check(4, (input.externalLinkCount ?? 0) >= 1, {
    id: "external_links",
    severity: "improve",
    message: "No external links found. Linking to authoritative sources signals quality to Google.",
    fix: "Cite 1-3 authoritative external sources (manufacturer specs, reputable industry sites).",
  });

  // 10. Schema
  check(8, !!input.hasSchema, {
    id: "schema",
    severity: "issue",
    message: "No JSON-LD structured data detected.",
    fix: "Add Article (blog), Product (PDP), LocalBusiness (homepage), or FAQ schema.",
  });

  // 11. Open Graph
  check(5, !!input.hasOpenGraph, {
    id: "og",
    severity: "improve",
    message: "Open Graph tags missing — link previews on Facebook/Slack/LinkedIn will look broken.",
    fix: "Yoast/Rank Math generate these automatically once meta title/description and og_image are filled in.",
  });

  // 12. Canonical
  check(4, !!input.hasCanonical, {
    id: "canonical",
    severity: "improve",
    message: "Canonical URL not set.",
    fix: "Set a canonical URL pointing to the preferred version of this page.",
  });

  // 13. URL length / readability
  if (input.url) {
    const len = input.url.length;
    check(3, len <= 90, {
      id: "url_length",
      severity: "improve",
      message: `URL is long (${len} chars). Short URLs rank better.`,
      fix: "Shorten the slug to 3-5 keyword-rich words.",
    });
  }

  const score = max > 0 ? Math.round((points / max) * 100) : 0;
  // Sort findings: critical → issue → improve → good
  const severityOrder: Record<SeoFindingSeverity, number> = {
    critical: 0,
    issue: 1,
    improve: 2,
    good: 3,
  };
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  return { score, findings };
}

// ─── HTML parsing helpers (used by seo-page-audit edge fn) ────────────────
export function extractFromHtml(html: string) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDescMatch = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i);
  const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']*)["']/i);
  const ogTitleMatch = html.match(/<meta[^>]+property=["']og:title["']/i);
  const h1Matches = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/gi) ?? [];
  const imgMatches = html.match(/<img[^>]*>/gi) ?? [];
  const imgsWithoutAlt = imgMatches.filter((t) => !/alt=["'][^"']+["']/i.test(t)).length;
  const ldJsonMatch = html.match(/<script[^>]+type=["']application\/ld\+json["']/i);

  // Strip tags for word count + body text
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : html;
  const bodyText = bodyHtml
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const wordCount = bodyText.split(/\s+/).filter(Boolean).length;

  // Internal vs external links — need a base URL to know "internal"
  const linkMatches = bodyHtml.match(/<a[^>]+href=["']([^"']+)["']/gi) ?? [];
  let internalLinkCount = 0;
  let externalLinkCount = 0;
  for (const a of linkMatches) {
    const href = a.match(/href=["']([^"']+)["']/i)?.[1] ?? "";
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
    if (href.startsWith("/") || href.startsWith("./") || href.startsWith("../")) internalLinkCount++;
    else if (/^https?:\/\//i.test(href)) externalLinkCount++;
    else internalLinkCount++; // relative
  }

  return {
    title: titleMatch?.[1]?.trim() ?? "",
    metaTitle: titleMatch?.[1]?.trim() ?? "",
    metaDescription: metaDescMatch?.[1] ?? "",
    hasCanonical: !!canonicalMatch,
    hasOpenGraph: !!ogTitleMatch,
    hasH1: h1Matches.length > 0,
    h1Count: h1Matches.length,
    totalImages: imgMatches.length,
    imagesWithoutAlt: imgsWithoutAlt,
    hasSchema: !!ldJsonMatch,
    bodyText,
    wordCount,
    internalLinkCount,
    externalLinkCount,
  };
}
