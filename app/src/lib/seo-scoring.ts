// Client-side mirror of the edge function scoring engine.
// Used for live score updates in the editor without round-tripping.
// Keep in sync with supabase/functions/_shared/seo/seo-scoring.ts

export type SeoFindingSeverity = "good" | "improve" | "issue" | "critical";

export interface SeoFinding {
  id: string;
  severity: SeoFindingSeverity;
  message: string;
  fix?: string;
}

export interface SeoScoreInput {
  url?: string;
  metaTitle?: string;
  metaDescription?: string;
  focusKeyword?: string;
  bodyHtml?: string;
  bodyText?: string;
  hasSchema?: boolean;
}

export interface SeoScoreResult {
  score: number;
  findings: SeoFinding[];
  wordCount: number;
}

const META_TITLE_MIN = 30;
const META_TITLE_MAX = 60;
const META_DESC_MIN = 120;
const META_DESC_MAX = 160;
const MIN_WORD_COUNT = 600;
const MIN_INTERNAL_LINKS = 3;

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function scoreSeoClient(input: SeoScoreInput): SeoScoreResult {
  const findings: SeoFinding[] = [];
  let points = 0;
  let max = 0;

  const bodyHtml = input.bodyHtml ?? "";
  const bodyText = input.bodyText ?? stripHtml(bodyHtml);
  const wordCount = bodyText.split(/\s+/).filter(Boolean).length;
  const internalLinkCount = (bodyHtml.match(/<a[^>]+href=["'](?:\/|\.\.?\/|#)/gi) ?? []).length;
  const externalLinkCount = (bodyHtml.match(/<a[^>]+href=["']https?:\/\//gi) ?? []).length;

  function check(weight: number, pass: boolean, finding: SeoFinding) {
    max += weight;
    if (pass) {
      points += weight;
      findings.push({ ...finding, severity: "good" });
    } else {
      findings.push(finding);
    }
  }

  const mt = (input.metaTitle ?? "").trim();
  check(10, mt.length >= META_TITLE_MIN && mt.length <= META_TITLE_MAX, {
    id: "meta_title",
    severity: mt.length === 0 ? "critical" : "improve",
    message:
      mt.length === 0
        ? "Missing meta title."
        : mt.length < META_TITLE_MIN
        ? `Meta title is too short (${mt.length} chars).`
        : `Meta title is too long (${mt.length} chars). It will get truncated.`,
    fix: "Aim for 50-60 characters with the focus keyword near the start.",
  });

  const md = (input.metaDescription ?? "").trim();
  check(10, md.length >= META_DESC_MIN && md.length <= META_DESC_MAX, {
    id: "meta_description",
    severity: md.length === 0 ? "critical" : "improve",
    message:
      md.length === 0
        ? "Missing meta description."
        : md.length < META_DESC_MIN
        ? `Meta description is too short (${md.length} chars).`
        : `Meta description is too long (${md.length} chars).`,
    fix: "Aim for 140-160 chars with focus keyword + benefit + soft CTA.",
  });

  if (input.focusKeyword) {
    const fk = input.focusKeyword.toLowerCase();
    check(8, mt.toLowerCase().includes(fk), {
      id: "fk_in_title",
      severity: "issue",
      message: `Focus keyword "${input.focusKeyword}" not in meta title.`,
      fix: "Move the focus keyword into the first half of the meta title.",
    });
    check(5, md.toLowerCase().includes(fk), {
      id: "fk_in_desc",
      severity: "improve",
      message: `Focus keyword "${input.focusKeyword}" not in meta description.`,
      fix: "Use the focus keyword once naturally in the meta description.",
    });

    const occ = bodyText.toLowerCase().split(fk).length - 1;
    const density = wordCount > 0 ? (occ / wordCount) * 100 : 0;
    check(8, density >= 0.5 && density <= 2.5 && occ >= 2, {
      id: "fk_density",
      severity: "improve",
      message:
        occ === 0
          ? `Focus keyword never appears in body.`
          : density < 0.5
          ? `Keyword density is low (${density.toFixed(2)}%, ${occ} hits).`
          : `Keyword density is high (${density.toFixed(2)}%) — risk of keyword stuffing.`,
      fix: "Use the focus keyword 4-8 times naturally, including the first paragraph and one heading.",
    });
  }

  check(10, wordCount >= MIN_WORD_COUNT, {
    id: "word_count",
    severity: wordCount < 300 ? "issue" : "improve",
    message: wordCount === 0
      ? "No body content yet."
      : `Body is ${wordCount} words. 1200+ tends to rank higher.`,
    fix: "Expand to 1200+ words with FAQ, comparisons, and how-tos.",
  });

  check(8, internalLinkCount >= MIN_INTERNAL_LINKS, {
    id: "internal_links",
    severity: "improve",
    message: `Only ${internalLinkCount} internal link(s).`,
    fix: "Add 3+ internal links to relevant product/service/blog pages.",
  });

  check(4, externalLinkCount >= 1, {
    id: "external_links",
    severity: "improve",
    message: "No external authority links found.",
    fix: "Cite 1-3 reputable external sources.",
  });

  check(6, !!input.hasSchema, {
    id: "schema",
    severity: "improve",
    message: "No structured data attached.",
    fix: "Add Article + FAQ schema (auto-generated by AI Writer).",
  });

  const score = max > 0 ? Math.round((points / max) * 100) : 0;
  const order: Record<SeoFindingSeverity, number> = {
    critical: 0,
    issue: 1,
    improve: 2,
    good: 3,
  };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return { score, findings, wordCount };
}
