/**
 * hook-frameworks — the nine Meta ad hook architectures, as a typed registry.
 *
 * Source: Dara Denney, "9 hook frameworks" — https://www.youtube.com/watch?v=I8tXqqfjIX4
 * Each entry carries the timestamp it is taught at, so a claim about what the
 * framework IS can be checked against the source rather than against memory.
 *
 * ── WHY THIS IS A REGISTRY AND NOT A GENERATOR ──────────────────────────────
 * A hook engine already exists in this codebase and is load-bearing:
 * `idea-hook.ts` holds organic doctrine, `ad-hook.ts` holds paid doctrine with
 * placement→surface mapping, brand facts and claim grounding, and its
 * MOVE_DIRECTION already encodes four opening moves. These nine families are a
 * richer, sourced vocabulary FOR that engine. Building a second generator would
 * leave two systems disagreeing about how an ad opens, which is the failure
 * this file is deliberately shaped to avoid.
 *
 * ── WHY THERE ARE NO WPW CLAIMS IN HERE ─────────────────────────────────────
 * The registry is tenant-agnostic by construction. A price, a turnaround, a
 * guarantee or a product fact belongs to a tenant's evidence records, not to a
 * framework definition — hardcoding one here would ship it to every tenant that
 * ever uses the registry, and would survive the day it stopped being true.
 *
 * ── WHAT `truthfulnessRisks` IS FOR ─────────────────────────────────────────
 * Every one of these frameworks has a way of becoming a lie while still
 * matching its own template. A trigger word can manufacture a danger; "one
 * thing" can be a list wearing a disguise; "a day without pain" can promise an
 * elimination nobody can deliver. Naming the specific failure per framework is
 * what lets a guard check for it, rather than checking for dishonesty in
 * general.
 */

export type HookModality = "verbal" | "text" | "visual" | "audio";

export type FunnelStage = "unaware" | "problem_aware" | "solution_aware" | "product_aware" | "most_aware";

export interface HookFramework {
  /** Stable key. Persisted on every candidate — renaming one orphans history. */
  key: string;
  displayName: string;
  /** Bumped when the DEFINITION changes, so a candidate records which rules made it. */
  frameworkVersion: string;
  sourceUrl: string;
  /** Where in the source this framework is taught. */
  sourceTimestamp: string;
  description: string;
  /** Why it works on a person, stated plainly. */
  mechanism: string;
  recommendedFunnelStages: FunnelStage[];
  /** Which channels the opening actually uses. A whisper hook is an AUDIO test. */
  modalities: HookModality[];
  requiredInputs: string[];
  commonMisuse: string;
  /** The specific way THIS framework becomes untrue while still looking correct. */
  truthfulnessRisks: string[];
  accessibility: string[];
  testingNotes: string;
  subtypes?: HookSubtype[];
}

export interface HookSubtype {
  key: string;
  displayName: string;
  description: string;
  audienceCondition: string;
  requiredInputs: string[];
}

const SOURCE = "https://www.youtube.com/watch?v=I8tXqqfjIX4";

/** Captions are not optional on any of these — sound-off is the default state. */
const CAPTIONS = "Accurate captions; the hook must be understandable with sound off.";

export const HOOK_FRAMEWORKS: HookFramework[] = [
  {
    key: "trigger_word",
    displayName: "Trigger Word",
    frameworkVersion: "1.0.0",
    sourceUrl: SOURCE,
    sourceTimestamp: "01:16",
    description:
      "Add one truthful, emotionally resonant word or short phrase to a message that already works, so it lands harder without changing what it means.",
    mechanism:
      "A single charged word raises the stakes of a familiar sentence, so an already-relevant claim stops reading as routine.",
    recommendedFunnelStages: ["problem_aware", "solution_aware", "product_aware"],
    modalities: ["verbal", "text"],
    requiredInputs: [
      "An existing proven message, fact, pain, desire or objection",
      "The word being introduced, stated explicitly",
      "Why that word is truthful for this offer",
    ],
    commonMisuse:
      "Reaching for a dramatic word the evidence does not support, so the sentence gets louder and less true.",
    truthfulnessRisks: [
      "Manufacturing danger, urgency, loss or controversy that the source message never contained",
      "Turning an uncertain observation into a factual accusation by word choice alone",
      "Changing the meaning of the original message while claiming only a word changed",
    ],
    accessibility: [CAPTIONS],
    testingNotes:
      "The control is the UNMODIFIED message. One word is the only difference, which makes this one of the few genuinely single-variable tests in the set.",
  },
  {
    key: "why_important",
    displayName: "Why Is It Important?",
    frameworkVersion: "1.0.0",
    sourceUrl: SOURCE,
    sourceTimestamp: "01:58",
    description:
      "Explain why a feature, material, process or standard actually matters to the person buying — feature, then consequence, then the decision it changes.",
    mechanism:
      "Buyers discount features they cannot price. Naming the consequence converts a spec into a reason to choose.",
    recommendedFunnelStages: ["solution_aware", "product_aware"],
    modalities: ["verbal", "text", "visual"],
    requiredInputs: [
      "The feature, material, process or standard",
      "The practical consequence for the customer",
      "The objection or knowledge gap being closed",
    ],
    commonMisuse: "Lecturing. The explanation becomes a seminar and the ad stops being an ad.",
    truthfulnessRisks: [
      "Asserting a consequence no evidence supports",
      "Implying a competitor's approach causes harm without support",
    ],
    accessibility: [CAPTIONS, "Show the feature on screen while it is named."],
    testingNotes: "Hold the feature constant and vary only which consequence is led with.",
  },
  {
    key: "day_without_pain",
    displayName: "A Day Without Pain",
    frameworkVersion: "1.0.0",
    sourceUrl: SOURCE,
    sourceTimestamp: "02:50",
    description:
      "Open inside the customer's believable after-state, once a recurring frustration has been removed.",
    mechanism:
      "A concrete relieved day is easier to want than an abstract benefit, because the viewer recognises the day they are having now.",
    recommendedFunnelStages: ["problem_aware", "solution_aware"],
    modalities: ["verbal", "visual"],
    requiredInputs: [
      "A pain observed REPEATEDLY in approved customer data, not once",
      "A concrete described after-state",
      "The real mechanism connecting the offer to the improvement",
    ],
    commonMisuse: "Generic lifestyle filler — a calm person and a coffee, standing in for a real change.",
    truthfulnessRisks: [
      "Promising complete elimination of a problem when the evidence supports reduction",
      "Building the after-state on a single complaint generalised into a universal pain",
      "Describing a mechanism the product does not actually have",
    ],
    accessibility: [CAPTIONS],
    testingNotes: "Vary the pain being relieved while holding offer, proof and CTA constant.",
  },
  {
    key: "how_to",
    displayName: "How-To",
    frameworkVersion: "1.0.0",
    sourceUrl: SOURCE,
    sourceTimestamp: "03:32",
    description:
      "Answer the practical question the customer is already asking, at the stage they are asking it.",
    mechanism:
      "Teaching earns attention before asking for it, and the teaching itself demonstrates competence.",
    recommendedFunnelStages: ["unaware", "problem_aware", "solution_aware"],
    modalities: ["verbal", "text", "visual"],
    requiredInputs: [
      "The customer question, in customer words",
      "A short educational answer",
      "Proof",
      "A transition to the offer that does not feel like a bait-and-switch",
      "A CTA appropriate to that stage",
    ],
    commonMisuse: "Teaching nothing — a 'how to' that withholds the answer until the CTA.",
    truthfulnessRisks: [
      "Presenting a preference as a standard",
      "Advice that serves the seller rather than the asker",
    ],
    accessibility: [CAPTIONS, "Steps legible as on-screen text, not narration alone."],
    testingNotes:
      "The three subtypes address DIFFERENT funnel stages and should not be compared against each other as if they were variants of one hook.",
    subtypes: [
      {
        key: "how_to_know_if",
        displayName: "How to know if…",
        description: "For someone who may not yet recognise they have the problem.",
        audienceCondition: "Unaware or newly problem-aware",
        requiredInputs: ["The symptom the viewer can check themselves", "What it indicates"],
      },
      {
        key: "how_to_choose",
        displayName: "How to choose…",
        description: "For someone comparing products, materials, vendors or workflows.",
        audienceCondition: "Solution-aware, actively comparing",
        requiredInputs: ["The real decision criteria", "The trade-off between options"],
      },
      {
        key: "how_to_start",
        displayName: "How to start…",
        description: "For someone convinced who needs a first step.",
        audienceCondition: "Product-aware, not yet acted",
        requiredInputs: ["The genuine first step", "What happens immediately after it"],
      },
    ],
  },
  {
    key: "if_you",
    displayName: "If You…",
    frameworkVersion: "1.0.0",
    sourceUrl: SOURCE,
    sourceTimestamp: "05:11",
    description:
      "Call out one precise customer by their condition, behaviour, pain or goal, so the right person recognises themselves.",
    mechanism: "Self-identification. A viewer who thinks 'that's me' has already stopped scrolling.",
    recommendedFunnelStages: ["problem_aware", "solution_aware", "product_aware"],
    modalities: ["verbal", "text"],
    requiredInputs: [
      "The customer group, in CUSTOMER-facing language",
      "The condition that makes them recognisable to themselves",
      "A direct link from the callout to the offer",
    ],
    commonMisuse:
      "Using an internal CRM label as the callout, so the ad addresses a segment name no customer would use about themselves.",
    truthfulnessRisks: [
      "Targeting language based on protected or prohibited personal attributes",
      "A callout so broad it is not a callout",
    ],
    accessibility: [CAPTIONS],
    testingNotes:
      "Materially different customer groups need SEPARATE variants. One 'if you' covering two groups tests nothing.",
  },
  {
    key: "this_one_thing",
    displayName: "This One Thing",
    frameworkVersion: "1.0.0",
    sourceUrl: SOURCE,
    sourceTimestamp: "06:11",
    description:
      "Reduce an overwhelming subject to one credible action, check, decision or feature — and say what it produces.",
    mechanism: "A single next step is actionable where a complete explanation is paralysing.",
    recommendedFunnelStages: ["problem_aware", "solution_aware", "product_aware"],
    modalities: ["verbal", "text", "visual"],
    requiredInputs: [
      "One genuinely primary thing",
      "The concrete result of doing it",
      "Proof that it matters",
    ],
    commonMisuse: "A list wearing a disguise — 'one thing' that turns out to be five things.",
    truthfulnessRisks: [
      "Presenting several actions as one",
      "Withholding the answer so long that the ad is clickbait rather than teaching",
      "Overstating what the single action achieves on its own",
    ],
    accessibility: [CAPTIONS],
    testingNotes:
      "Produce an outcome-led and a problem-led version where both stay true, and reveal the answer early enough that the hook is not a tease.",
  },
  {
    key: "sorry_welcome",
    displayName: "I'm Sorry / You're Welcome",
    frameworkVersion: "1.0.0",
    sourceUrl: SOURCE,
    sourceTimestamp: "06:49",
    description:
      "Open with a culturally familiar conversational phrase as a pattern interrupt, then earn it in the body.",
    mechanism:
      "The phrase implies a relationship and a punchline, so the viewer stays for the resolution.",
    recommendedFunnelStages: ["solution_aware", "product_aware", "most_aware"],
    modalities: ["verbal", "text"],
    requiredInputs: [
      "The tone: helpful, playful, apologetic or confident — chosen, not accidental",
      "A body that justifies the opening",
      "A control WITHOUT the gimmick",
    ],
    commonMisuse: "Smugness. 'You're welcome' with nothing behind it reads as arrogance.",
    truthfulnessRisks: [
      "A fake confession — apologising for something that did not happen",
      "False scarcity or manufactured urgency smuggled in behind the friendly tone",
    ],
    accessibility: [CAPTIONS, "Tone must not depend on audio alone; the text carries it too."],
    testingNotes: "Always ship the plain control alongside, or the gimmick cannot be attributed.",
  },
  {
    key: "native_filter_visual",
    displayName: "Native Filter Visual",
    frameworkVersion: "1.0.0",
    sourceUrl: SOURCE,
    sourceTimestamp: "07:47",
    description:
      "Make the opening VISUAL treatment the variable — social-native, imperfect, unexpected — while the spoken message stays constant.",
    mechanism:
      "A frame that looks like the platform rather than like an ad delays the reflex to scroll past advertising.",
    recommendedFunnelStages: ["unaware", "problem_aware", "solution_aware"],
    modalities: ["visual"],
    requiredInputs: [
      "The exact first-frame treatment, described",
      "Real approved footage — preferred over generated imagery",
      "Confirmation of usage rights for any third-party filter or effect",
    ],
    commonMisuse:
      "A treatment so heavy it hides the thing being sold, so attention is bought and then wasted.",
    truthfulnessRisks: [
      "Fabricating a customer reaction",
      "Obscuring wrap quality, safety detail or text the viewer needs to understand the ad",
      "Using platform-owned filter IP without confirmed rights",
    ],
    accessibility: [
      CAPTIONS,
      "The treatment must not reduce text contrast below legibility on a phone.",
    ],
    testingNotes:
      "THE VISUAL IS THE TEST VARIABLE. Hold the spoken hook constant or the result attributes to the wrong thing.",
  },
  {
    key: "whisper_asmr",
    displayName: "Whisper / ASMR",
    frameworkVersion: "1.0.0",
    sourceUrl: SOURCE,
    sourceTimestamp: "08:41",
    description:
      "Make the opening AUDIO delivery the variable — quiet, close, intimate — against an identical script.",
    mechanism:
      "A quiet voice in a loud feed is an interrupt, and intimacy implies the speaker is talking to you rather than at an audience.",
    recommendedFunnelStages: ["unaware", "problem_aware"],
    modalities: ["audio", "verbal"],
    requiredInputs: [
      "A script held IDENTICAL to the normal-voice control",
      "A normal-voice control recording",
      "Real sounds only where matching footage exists",
      "Documented consent for any voice used",
    ],
    commonMisuse: "Whispering past the point of intelligibility on phone speakers.",
    truthfulnessRisks: [
      "Cloned voices without documented consent",
      "Foley implying a process the shop does not perform",
    ],
    accessibility: [
      CAPTIONS,
      "Speech must be intelligible on a phone speaker at moderate volume.",
      "On-screen text must carry the full hook, since the audio treatment is the point of failure for anyone sound-off.",
    ],
    testingNotes:
      "AUDIO IS THE TEST VARIABLE. Same words, same visual, different delivery — otherwise the whisper gets credit for a rewrite.",
  },
];

export const HOOK_FRAMEWORK_KEYS = HOOK_FRAMEWORKS.map((f) => f.key);

export function frameworkByKey(key: string): HookFramework | undefined {
  return HOOK_FRAMEWORKS.find((f) => f.key === key);
}

export function subtypeByKey(frameworkKey: string, subtypeKey: string): HookSubtype | undefined {
  return frameworkByKey(frameworkKey)?.subtypes?.find((s) => s.key === subtypeKey);
}

/**
 * A framework's declared test variable — what an experiment using it is
 * actually isolating. Returned rather than inferred at the call site, because
 * a whisper test that records "verbal" as its variable will credit the wrong
 * change when it wins.
 */
export function testVariableFor(key: string): HookModality | "bundled" {
  const f = frameworkByKey(key);
  if (!f) return "bundled";
  if (f.modalities.length === 1) return f.modalities[0];
  if (f.key === "native_filter_visual") return "visual";
  if (f.key === "whisper_asmr") return "audio";
  // Several modalities and no declared primary: an experiment using this is a
  // bundled concept test, and calling it single-variable would be a lie about
  // what the result proves.
  return "bundled";
}
