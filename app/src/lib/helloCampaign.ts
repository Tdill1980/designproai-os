/**
 * helloCampaign — reach out to every past client and just say hello. 👋
 *
 * Owner, 2026-08-06: "Reach out to every past client and just say hello 👋 —
 * Gary Vee. I need this scheduled. We get it ready."
 *
 * ── THE ONE RULE THAT MAKES IT WORK ────────────────────────────────────────
 * THERE IS NO ASK. None. Not a soft one, not a P.S., not a signature link to a
 * pricing page.
 *
 * This is the whole mechanic and it is fragile in exactly one direction: the
 * moment it carries an offer it stops being a hello and becomes a re-engagement
 * campaign, which every recipient has received a hundred times and can smell
 * instantly. A hello with a discount code attached is worth less than no email
 * at all, because it teaches people that hearing from us always costs them
 * something.
 *
 * So `validateHello` is a HARD gate on the body, reusing the doctrine's own
 * ad-phrase list plus the things that only show up in this kind of email
 * (unsubscribe-bait urgency, "just checking in", a CTA button). It is the same
 * rule as the organic feed, applied to the inbox.
 *
 * ── IT DOES NOT SEND, AND CANNOT ───────────────────────────────────────────
 * This module BUILDS the campaign and nothing else. No function here calls
 * Klaviyo, Resend, or any transport.
 *
 * That is deliberate and non-negotiable: there are 9,287 unique past-client
 * addresses (measured 2026-08-06), and consent state lives in KLAVIYO, not in
 * this database. A blast sent from here would mail people who unsubscribed —
 * a CAN-SPAM violation and a fast route to a suspended sending domain that
 * also carries the transactional mail (design packs, WrapBox handoffs). That
 * exact risk is recorded in the Klaviyo work from 2026-08-05 and it has not
 * changed.
 *
 * The campaign is therefore prepared as a DRAFT for a human to review and send
 * from Klaviyo, where suppression is enforced by the platform.
 *
 * Pure by design: no database, no network. Locked by `tests/hello-campaign.test.ts`.
 */

// The SAME ad-phrase list the organic feed is judged by. An inbox is a higher
// bar than a feed, not a lower one — importing rather than re-listing means the
// two can never drift apart.
import { AD_PHRASES } from "./contentDoctrine";

/** Where past clients live, and roughly how many. Measured 2026-08-06. */
export const AUDIENCE_SOURCES = [
  { table: "customers", emailColumn: "email", uniqueEmails: 9287 },
  { table: "customer_quotes", emailColumn: "customer_email", uniqueEmails: 1024 },
] as const;

/**
 * Phrases that turn a hello into a campaign.
 *
 * Separate from the doctrine's ad list because these are specific to email and
 * mostly harmless elsewhere — "just checking in" is fine in a DM and fatal in
 * a mass send, where it is the universal opener of every lapsed-customer
 * sequence ever written.
 */
export const NOT_A_HELLO = [
  /\bjust checking in\b/i,
  /\bwe miss you\b/i, /\bwe'?ve missed you\b/i,
  /\bcome back\b/i,
  /\bit'?s been a while since your last\b/i,
  /\bbook (?:a|your) (?:call|demo|slot)\b/i,
  /\bschedule (?:a|your) (?:call|demo)\b/i,
  /\bany (?:projects|jobs) coming up\b/i,
  /\bhow can we help\b/i,
  /%\s*off\b/i, /\bpromo code\b/i,
];

export interface HelloDraft {
  brand: string;
  subject: string;
  preview?: string | null;
  body: string;
  /** Who it goes to — named, never "everyone". */
  audienceNote: string;
}

export interface HelloViolation {
  code: string;
  message: string;
}

/**
 * Judge a hello before it can be prepared.
 *
 * Every violation is HARD. There is no soft tier here, because the entire value
 * of the send is that it contains nothing — a "mostly no ask" hello is just an
 * ask with extra steps.
 */
export function validateHello(draft: HelloDraft | null | undefined): HelloViolation[] {
  const out: HelloViolation[] = [];
  if (!draft) return [{ code: "empty", message: "No draft." }];

  const text = `${draft.subject || ""}\n${draft.preview || ""}\n${draft.body || ""}`;

  for (const re of AD_PHRASES) {
    const hit = text.match(re);
    if (hit) {
      out.push({
        code: "ad_speak",
        message: `"${hit[0]}" is an ask. A hello has none — that is the only reason it lands. Remove it.`,
      });
      break;
    }
  }
  for (const re of NOT_A_HELLO) {
    const hit = text.match(re);
    if (hit) {
      out.push({
        code: "reengagement_speak",
        message: `"${hit[0]}" is re-engagement copy. Every recipient has had a hundred of those and will read this as one. Say hello and stop.`,
      });
      break;
    }
  }

  // A link is a destination, and a destination is an ask.
  if (/https?:\/\//i.test(draft.body || "")) {
    out.push({
      code: "has_link",
      message: "A hello contains no link. Somewhere to click is somewhere we want them to go, which makes it a campaign.",
    });
  }

  if (!String(draft.body || "").trim()) {
    out.push({ code: "empty_body", message: "Nothing written." });
  }
  // Length is the tell. A genuine hello is short; nobody writes six paragraphs
  // to say hello without wanting something.
  const words = String(draft.body || "").trim().split(/\s+/).filter(Boolean).length;
  if (words > 120) {
    out.push({
      code: "too_long",
      message: `${words} words. A hello is short — past about 120 words it reads as a pitch with a greeting on the front.`,
    });
  }
  if (!String(draft.subject || "").trim()) {
    out.push({ code: "no_subject", message: "No subject line." });
  }
  return out;
}

export function isRealHello(draft: HelloDraft | null | undefined): boolean {
  return validateHello(draft).length === 0;
}

/**
 * The reference hello, per brand.
 *
 * Written to pass its own gate — no link, no ask, under 120 words, signed by a
 * person. Kept in code so it is reviewable in a diff rather than pasted into a
 * campaign tool where nobody can see it change.
 */
export const HELLO_TEMPLATES: Record<string, HelloDraft> = {
  weprintwraps: {
    brand: "weprintwraps",
    subject: "Hey — just saying hello 👋",
    preview: "No pitch. Genuinely just hello.",
    body: [
      "Hi {{ first_name|default:\"there\" }},",
      "",
      "No pitch here — I just wanted to say hello.",
      "",
      "You printed with us at some point, and I've been thinking lately that we only ever",
      "email people when we want something. That's a bad habit, so I'm breaking it.",
      "",
      "Hope the shop's busy and the install season is treating you well.",
      "",
      "If you ever want to talk shop — materials, a job that's fighting you, anything —",
      "just reply. I read these.",
      "",
      "— Trish",
    ].join("\n"),
    audienceNote: "Past printing clients. Suppression enforced by Klaviyo.",
  },
  restylepro: {
    brand: "restylepro",
    subject: "Hey — just saying hello 👋",
    preview: "No pitch. Genuinely just hello.",
    body: [
      "Hi {{ first_name|default:\"there\" }},",
      "",
      "No pitch, no offer. Just hello.",
      "",
      "You've used DesignProAI at some point, and I realised we only ever show up in your",
      "inbox when there's something to announce. Felt worth fixing.",
      "",
      "Hope the shop's full and the quotes are closing.",
      "",
      "If there's something you wish the tool did, hit reply and tell me. That's it.",
      "",
      "— Trish",
    ].join("\n"),
    audienceNote: "Past DesignProAI users. Suppression enforced by Klaviyo.",
  },
};

export interface PreparedHello {
  brand: string;
  subject: string;
  preview: string | null;
  body: string;
  /** ISO date this is queued for. NEVER acted on by this module. */
  scheduledFor: string | null;
  /** Always false. Nothing here can transmit. */
  sent: false;
  /** The exact human step still required. */
  requiresHuman: string;
  audienceNote: string;
}

/**
 * Prepare a hello for review. Throws if it is not actually a hello.
 *
 * Refusing loudly is the point: a silently-downgraded hello that still carries
 * an ask would go out looking approved.
 */
export function prepareHello(draft: HelloDraft, scheduledFor?: string | null): PreparedHello {
  const violations = validateHello(draft);
  if (violations.length) {
    throw new Error(
      `This is not a hello:\n${violations.map((v) => `  · ${v.message}`).join("\n")}`,
    );
  }
  return {
    brand: draft.brand,
    subject: draft.subject,
    preview: draft.preview ?? null,
    body: draft.body,
    scheduledFor: scheduledFor ?? null,
    sent: false,
    requiresHuman:
      "Review and send from Klaviyo. Consent and suppression live there, not in this database — " +
      "sending from here would mail people who unsubscribed.",
    audienceNote: draft.audienceNote,
  };
}
