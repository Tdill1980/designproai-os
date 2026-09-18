"use strict";
/**
 * runtime/atlas-intake-parse.cjs — RAW CUSTOMER TEXT → THE STRUCTURED SCHEMA.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner ruling, Trish 2026-09-18, and it lands on a defect in the TEST rather
 * than in the product: "you shouldn't test it by giving it the same design
 * prompt as the example. How are we supposed to validate that it can design if
 * it's just recreating from the system example ... the pipeline must ingest
 * raw, unstructured customer natural language and dynamically parse it."
 *
 * SHE IS RIGHT, AND THE PROBE WAS WORSE THAN SHE SAYS. Its default brief was
 * "Bright Smiles Dental — clean flowing blue and teal wave design, a custom
 * tooth logo, the tagline HEALTHY SMILES BRIGHTER LIVES, and a professional
 * photograph of a smiling dental patient in a clinical chair inlaid into the
 * rear three-quarter of each side panel." That is not a customer's brief. It is
 * a DESCRIPTION OF THE PINNED EXAMPLE SHEET, which was attached to the same
 * request as the standard to match. So the strongest evidence I had that the
 * persona works is the one thing it could not prove: a model handed a picture
 * and a description of that picture will return the picture, with or without a
 * designer behind it. Every judgement made off those runs about design quality
 * is worth less than it looked.
 *
 * WHAT A REAL REQUEST LOOKS LIKE, which is what goes in now:
 *
 *   "need a wrap for my 2019 ford transit 250 high roof - company is Cedar &
 *    Stone Tree Care, we do tree removal stump grinding and storm cleanup ..."
 *
 * TWO STAGES, AND THE ORDER IS THE POINT.
 *
 * 1. DETERMINISTIC FIRST, for everything a regular expression can decide. A
 *    phone number, a web address and a model year are unambiguous in text, and
 *    they are exactly the fields that must never be invented -- the entire
 *    element-graph architecture exists because RestylePro measured a proof
 *    reading 877-555-0000 against a hero reading 555-0142. Asking a model to
 *    "extract" a phone number it can also hallucinate is spending a model call
 *    to make a certain answer uncertain.
 *
 * 2. THEN ONE SCHEMA-BOUND FLASH CALL for what genuinely is ambiguous: where a
 *    company name ends, which words are services, which are the promotional
 *    line, and which are the creative brief. No regex decides that "Cedar &
 *    Stone Tree Care, we do tree removal" splits after "Care". This is the same
 *    primitive `atlas-lettering-read.cjs` and `atlas-output-class.cjs` already
 *    use here: gemini-2.5-flash, temperature 0, response schema bound.
 *
 * AND THE DETERMINISTIC VALUES WIN ON CONFLICT. If the reader returns a phone
 * that is not the phone in the text, the text's phone is used. The model may
 * only fill fields nothing else could decide.
 *
 * IT IS NOT ON THE CUSTOMER CRITICAL PATH. CLAUDE.md forbids an LLM
 * classification stage in front of a customer generation ("that is latency on
 * the critical path before the customer sees anything"). This runs at INTAKE --
 * where a form is being parsed, before any design is asked for -- and a caller
 * that already has structured fields skips it entirely.
 */

const INTAKE_CONTRACT = "designpro.atlas-intake-parse.v1";
const INTAKE_MODEL = "gemini-2.5-flash";

/**
 * NANP, in the forms a customer actually types: 520-555-0192, (520) 555-0192,
 * 520.555.0192, +1 520 555 0192. Deliberately NOT a general international
 * matcher -- a loose pattern catches a year range or an order number and puts
 * it on a customer's vehicle as a phone number.
 */
const PHONE = /(?:\+?1[\s.-]*)?(\(?\d{3}\)?[\s.-]{1,2}\d{3}[\s.-]\d{4})/;

/** A bare domain, not an email address and not a sentence-ending word. */
const WEBSITE = /(?<![\w@.])((?:[a-z0-9][a-z0-9-]*\.)+(?:com|net|org|co|io|us|biz|shop|services|company))(?![\w@])/i;

const YEAR = /\b(19[8-9]\d|20[0-4]\d)\b/;

/**
 * The makes the GENIE catalog actually carries, lower-cased. A make list is a
 * closed set and a model name is not, so the make is matched and the model is
 * whatever follows it up to the next clause boundary.
 */
const MAKES = Object.freeze([
  "ford", "chevrolet", "chevy", "gmc", "ram", "dodge", "toyota", "honda", "nissan",
  "mercedes-benz", "mercedes", "sprinter", "freightliner", "isuzu", "hino", "jeep",
  "subaru", "mazda", "volkswagen", "vw", "hyundai", "kia", "tesla", "rivian", "bmw",
  "audi", "porsche", "lexus", "acura", "infiniti", "buick", "cadillac", "lincoln",
  "chrysler", "mitsubishi", "volvo", "land rover", "mini", "fiat", "genesis",
]);

const CANONICAL_MAKE = Object.freeze({ chevy: "Chevrolet", vw: "Volkswagen", mercedes: "Mercedes-Benz" });

// HYPHENS ARE WORD BOUNDARIES IN A MAKE. "mercedes-benz" title-cased on spaces
// alone becomes "Mercedes-benz", which is nobody's brand.
const titleCase = (value) => String(value || "").trim().split(/\s+/)
  .map((word) => (/^[0-9]/.test(word) || (word.length <= 3 && word === word.toUpperCase())
    ? word
    : word.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join("-")))
  .join(" ");

/** Normalise a matched NANP number to the form a proof prints. */
function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (digits.length !== 10) return "";
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * Everything a regular expression can decide, and nothing it cannot.
 *
 * @returns {{phone,website,vehicleYear,vehicleMake,vehicleModel}} — "" where
 *          the text does not decide it. An empty string is an honest no-op;
 *          this function never guesses.
 */
function extractDeterministic(text) {
  const raw = String(text || "");
  const lower = raw.toLowerCase();

  const phoneMatch = PHONE.exec(raw);
  const websiteMatch = WEBSITE.exec(raw);
  const yearMatch = YEAR.exec(raw);

  let vehicleMake = "";
  let vehicleModel = "";
  // LONGEST MAKE FIRST, so "land rover" is not read as a model of nothing and
  // "mercedes-benz" is not truncated to "mercedes".
  const makes = [...MAKES].sort((a, b) => b.length - a.length);
  for (const make of makes) {
    const at = lower.indexOf(make);
    if (at < 0) continue;
    // It must be a whole word, or "ram" matches "frame" and "kia" matches "khaki".
    const before = at === 0 ? " " : lower[at - 1];
    const after = lower[at + make.length] ?? " ";
    if (/[a-z0-9]/.test(before) || /[a-z]/.test(after)) continue;
    vehicleMake = CANONICAL_MAKE[make] || titleCase(make);
    // The model runs to the next clause boundary: a comma, a dash, a full stop
    // or a conjunction. "2019 ford transit 250 high roof - company is ..." ends
    // the model at the dash, not at the end of the sentence.
    const tail = raw.slice(at + make.length);
    // THE COURTESY WORDS BELONG IN THE STOP LIST TOO. "sprinter 3500 please"
    // put "Please" on the customer's vehicle model, which then prints on the
    // proof and is looked up against the GENIE catalog.
    const stop = tail.search(
      /[,.;:!?]|\s[-–—]\s|\s+(?:and|with|company|business|we|for|our|it|please|thanks|thank|need|want|wrap|wrapped|call|text|email|phone)\b/i);
    vehicleModel = titleCase((stop < 0 ? tail : tail.slice(0, stop)).trim());
    break;
  }

  return {
    phone: phoneMatch ? normalizePhone(phoneMatch[1]) : "",
    website: websiteMatch ? websiteMatch[1].toLowerCase() : "",
    vehicleYear: yearMatch ? yearMatch[1] : "",
    vehicleMake,
    vehicleModel,
  };
}

/**
 * The response schema for the ambiguous half. Bound on the request, so the
 * reader cannot answer in prose and cannot add a field nobody asked for.
 */
const INTAKE_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    companyName: { type: "string" },
    tagline: { type: "string" },
    services: { type: "array", items: { type: "string" } },
    promo: { type: "string" },
    creativeDirection: { type: "string" },
    industryType: { type: "string" },
  },
  required: ["companyName", "creativeDirection"],
});

/**
 * WHAT THE READER IS ASKED, and every clause of it is a defence.
 *
 * "Copy, never compose" is the whole job: this stage separates the customer's
 * words into fields, and the moment it starts improving them it has become a
 * second creative authority in front of A.C.E. — which RULE 0.24 and the
 * one-source-design contract both forbid, and which is how a brief arrives at
 * the designer already averaged.
 */
function intakePrompt(text) {
  return [
    "Split this wrap customer's message into fields. You are a form, not a designer.",
    "",
    "COPY THE CUSTOMER'S OWN WORDS. Never invent, improve, expand or rephrase. A field the",
    "message does not contain is an empty string — never a plausible guess, and never a",
    "phone number, web address or price of any kind.",
    "",
    "companyName: the business name exactly as written.",
    "tagline: a slogan they asked to appear on the wrap. Not their services, not a description.",
    "services: what they do, as short phrases, only if they list them.",
    "promo: a promotional line they asked to appear (for example FREE ESTIMATES).",
    "industryType: two or three words naming the trade.",
    "creativeDirection: everything they said about how it should LOOK and FEEL — colours,",
    "  imagery, mood, placement — in their own words, with the vehicle, the phone number and",
    "  the web address left out. This is the design brief and it must not be shortened.",
    "",
    "CUSTOMER MESSAGE:",
    String(text || ""),
  ].join("\n");
}

/**
 * Merge, with the deterministic pass winning every field it decided.
 *
 * A reader that returns a different phone number than the text contains is
 * wrong by construction, and this is where that can never reach a print panel.
 */
function mergeIntake(deterministic = {}, parsed = {}) {
  const pick = (v) => String(v == null ? "" : v).trim();
  const services = Array.isArray(parsed.services)
    ? parsed.services.map(pick).filter(Boolean) : [];
  return {
    contract: INTAKE_CONTRACT,
    companyName: pick(parsed.companyName),
    tagline: pick(parsed.tagline),
    promo: pick(parsed.promo),
    industryType: pick(parsed.industryType),
    services,
    creativeDirection: pick(parsed.creativeDirection),
    // DETERMINISTIC WINS. Always, and without asking whether the model agreed.
    phone: pick(deterministic.phone),
    website: pick(deterministic.website),
    vehicleYear: pick(deterministic.vehicleYear),
    vehicleMake: pick(deterministic.vehicleMake),
    vehicleModel: pick(deterministic.vehicleModel),
  };
}

module.exports = {
  INTAKE_CONTRACT,
  INTAKE_MODEL,
  INTAKE_SCHEMA,
  MAKES,
  extractDeterministic,
  intakePrompt,
  mergeIntake,
  _test: { normalizePhone, titleCase, PHONE, WEBSITE, YEAR },
};
