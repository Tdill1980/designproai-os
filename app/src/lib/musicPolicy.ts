/**
 * musicPolicy — WHO gets a music bed, decided by code, not by whoever is
 * clicking. Owner rule (Trish 2026-07-30), verbatim intent:
 *
 *   "All UGC / documentary non-installer vids should be saved and documentary,
 *    ugc, reels made — NOT covered up with music. Music is for videos of
 *    installers, Behind The Install, only."
 *
 * The reason is craft, not preference: documentary and UGC footage IS someone
 * talking. A track over it competes with the only thing that makes the piece
 * worth watching. Behind-The-Install footage is the opposite — squeegees and
 * shop noise carry no meaning, so a track is what gives it shape.
 *
 * This is the same shape as the speech-craft rules in brandcastPlanner: the AI
 * may pick the footage and the order; CODE decides whether a bed is allowed.
 *
 * Content types come from `src/lib/assetContentType.ts` — the one classifier.
 */

/** Footage that is ABOUT its own sound. A bed would bury the point. */
export const NATIVE_SOUND_TYPES = ["documentary", "ugc"] as const;

/** Footage with no meaningful sound of its own — the music-video material. */
export const MUSIC_LED_TYPES = ["install", "vehicle_only", "unboxing", "product"] as const;

export interface MusicVerdict {
  /** May a track be laid under this cut? */
  allowMusic: boolean;
  /** Plain-language reason, shown in the UI — never a silent override. */
  reason: string;
  /** The types that drove the verdict, so a human can check the call. */
  blockedBy: string[];
}

/**
 * Decide from the content types of every clip in the cut.
 *
 * ONE documentary or UGC clip is enough to block the bed: a track laid across
 * the timeline plays over that clip too, so "mostly install" is not a
 * defence — the one person talking still gets buried.
 *
 * Unknown / unclassified footage does NOT unlock music. Defaulting to "sure,
 * add a track" over material nobody has listened to is exactly how speech gets
 * covered; the honest default is natural sound, and a human can override.
 */
export function musicPolicy(contentTypes: Array<string | null | undefined>): MusicVerdict {
  const types = contentTypes.map((t) => String(t || "").trim().toLowerCase()).filter(Boolean);

  const blockedBy = [...new Set(types.filter((t) => (NATIVE_SOUND_TYPES as readonly string[]).includes(t)))];
  if (blockedBy.length) {
    const label = blockedBy.map((t) => (t === "ugc" ? "UGC" : t)).join(" + ");
    return {
      allowMusic: false,
      blockedBy,
      reason: `This cut contains ${label} footage — the person talking leads. Music would cover them.`,
    };
  }

  const musicLed = types.filter((t) => (MUSIC_LED_TYPES as readonly string[]).includes(t));
  if (musicLed.length && musicLed.length === types.length) {
    return {
      allowMusic: true,
      blockedBy: [],
      reason: "Behind-the-install footage — a track carries it.",
    };
  }

  return {
    allowMusic: false,
    blockedBy: [],
    reason: types.length
      ? "Footage isn't classified as install-only yet — keeping its natural sound. Set the type in the Asset Library to unlock music."
      : "No classified footage — keeping natural sound.",
  };
}

/**
 * Resolve the audio fields for a render from the policy. Returns exactly what
 * the blueprint/render call should carry, so no caller has to re-derive it.
 *
 * An explicit human choice always wins — the rule is a DEFAULT that stops
 * accidental burial, not a lock that overrules the editor.
 */
export function resolveAudioForCut(opts: {
  contentTypes: Array<string | null | undefined>;
  /** A track the user deliberately picked, if any. */
  requestedMusicUrl?: string | null;
  /** Set only when a human explicitly toggled it. */
  explicitKeepNative?: boolean;
}): { musicUrl: string | null; keepNativeAudio: boolean; verdict: MusicVerdict } {
  const verdict = musicPolicy(opts.contentTypes);
  const musicUrl = verdict.allowMusic ? (opts.requestedMusicUrl || null) : null;
  const keepNativeAudio = opts.explicitKeepNative !== undefined
    ? opts.explicitKeepNative
    // No music on the cut → the footage's own sound is all there is, so keep
    // it. With music on install footage, the track leads (a music video).
    : (musicUrl ? false : true);
  return { musicUrl, keepNativeAudio, verdict };
}

/**
 * ── SPEECH BEATS THE LABEL ──────────────────────────────────────────────────
 * Owner rule (2026-08-05): "Any video with talking should not be music videos,
 * must be cut as orig content."
 *
 * The type-based check above is a good default but it judges a LABEL. Measured
 * 2026-08-05: all 419 raw videos have content_type NULL — nothing is
 * classified — while 122 of them carry a real transcript. So the label could
 * not distinguish a silent install from an installer explaining what he is
 * doing, and the one signal that could was never consulted.
 *
 * A transcript is EVIDENCE, not a guess: Whisper heard words. So any clip with
 * speech blocks the bed outright, whatever it is typed as. Talking footage
 * gets cut as original content with its own sound.
 */
export interface ClipAudioFacts {
  contentType?: string | null;
  /** True when this clip has a real transcript — someone is talking in it. */
  hasSpeech?: boolean;
}

/** Words shorter than this are noise/false positives, not speech. */
export const SPEECH_MIN_CHARS = 40;

export function transcriptHasSpeech(transcript?: string | null): boolean {
  return String(transcript || "").trim().length >= SPEECH_MIN_CHARS;
}

/**
 * The full verdict: speech first, then the content-type rule.
 *
 * ONE talking clip is enough. A track laid across the timeline plays over that
 * clip too, so "mostly install" is no defence — the person talking still gets
 * buried.
 */
export function musicPolicyForClips(clips: ClipAudioFacts[]): MusicVerdict {
  const talking = (clips || []).filter((c) => c?.hasSpeech).length;
  if (talking) {
    return {
      allowMusic: false,
      blockedBy: ["speech"],
      reason:
        `${talking} clip${talking === 1 ? " has" : "s have"} someone talking. ` +
        `Cut it as original content with its own sound — a track would bury the only thing worth hearing.`,
    };
  }
  return musicPolicy((clips || []).map((c) => c?.contentType));
}
