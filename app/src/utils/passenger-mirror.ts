/**
 * Deterministic Passenger Mirror Utility
 * Takes the Driver Side image URL and returns a horizontally flipped DataURL.
 * 0ms render time. 0 API calls. 100% design symmetry.
 * Used by INSTANT_MIRROR system in view-angles-os.ts
 *
 * Uses fetch() → blob → objectURL to bypass CORS tainted canvas issues
 * with Supabase Storage URLs.
 */
export const generatePassengerMirror = async (driverImageUrl: string): Promise<string> => {
  // Fetch as blob to avoid CORS tainted canvas
  const response = await fetch(driverImageUrl);
  if (!response.ok) throw new Error(`Failed to fetch driver side image: ${response.status}`);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Canvas context not available'));
        return;
      }
      // MEMORY GUARD (iOS Safari tab-reload defense): a 4K driver render makes a
      // ~4096px canvas (~37MB) AND a full-size PNG data URL, then the upload copies
      // it again — a spike big enough to make mobile Safari silently reload the tab
      // ("the window refreshed / knocked me out of the job") mid-generation. Cap the
      // mirror's long edge and emit JPEG so the spike stays small. This is a
      // working/preview view (print resolution comes from the upscaler, and text
      // designs are re-rendered by fixMirrorText), so the cap costs nothing downstream.
      const MAX_MIRROR_EDGE = 2560;
      const longEdge = Math.max(img.width, img.height);
      const scale = longEdge > MAX_MIRROR_EDGE ? MAX_MIRROR_EDGE / longEdge : 1;
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      canvas.width = w;
      canvas.height = h;

      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, w, h);

      URL.revokeObjectURL(objectUrl);
      // JPEG q0.92 — a fraction of the PNG data-URL's memory footprint, visually
      // indistinguishable for a passenger preview.
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load driver side image for mirroring'));
    };
    img.src = objectUrl;
  });
};

/**
 * Detect if a wrap design likely contains text/lettering that would appear
 * backwards when mirrored. Returns true if text-fix AI pass is recommended.
 */
export function designLikelyHasText(opts: {
  modeType?: string;
  prompt?: string;
  designIQMode?: string;
}): boolean {
  // Commercial wraps almost always have text (company name, phone, URL)
  if (opts.designIQMode === "commercial" || opts.modeType === "commercial") return true;

  // DesignProAI wraps frequently generate text/logos even when not prompted.
  // RecreatePro reproduces REAL wraps, which almost always carry lettering —
  // it was missing from this list, so recreate passenger mirrors skipped the
  // text fix and shipped BACKWARDS lettering (baked into the saved view and
  // every proof composed from it).
  if (
    opts.modeType === "designpanelpro" ||
    opts.modeType === "designpro" ||
    opts.modeType === "recreatepro" ||
    opts.modeType === "restyle" ||
    opts.designIQMode === "restyle"
  ) return true;

  // Check prompt for text-related keywords
  if (opts.prompt) {
    const lower = opts.prompt.toLowerCase();
    const textKeywords = [
      "text", "letter", "font", "word", "name", "number", "phone",
      "url", "website", ".com", "logo", "brand", "slogan", "tagline",
      "company", "business", "sign", "label", "writing", "script",
      "sponsor", "racing", "livery", "decal", "graphic",
    ];
    if (textKeywords.some((kw) => lower.includes(kw))) return true;
  }

  return false;
}

/**
 * Upload a data URL to Supabase Storage and return the public URL.
 * Shared helper used by mirror flows across ColorPro, DesignPro, and RevisionStudioIQ.
 */
export async function uploadMirrorToStorage(
  supabaseClient: any,
  dataUrl: string,
  userId: string,
): Promise<string> {
  const base64 = dataUrl.split(",")[1];
  const mimeType = dataUrl.split(";")[0].split(":")[1] || "image/png";
  const ext = mimeType.includes("png") ? "png" : "jpg";
  const timestamp = Date.now();
  const filePath = `renders/${userId}/mirrors/passenger_${timestamp}.${ext}`;

  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  const { error } = await supabaseClient.storage
    .from("wrap-files")
    .upload(filePath, bytes, { contentType: mimeType, upsert: true });

  if (error) throw new Error(`Mirror upload failed: ${error.message}`);

  const { data: { publicUrl } } = supabaseClient.storage
    .from("wrap-files")
    .getPublicUrl(filePath);

  return publicUrl;
}

/**
 * Fix mirrored/backwards text on a passenger-side mirror image via AI.
 * Sends the mirrored image to revise-render with a text-correction prompt.
 * Returns the corrected image URL, or the original mirror URL if the fix fails.
 */
export const ORIENTATION_W = 64;
export const ORIENTATION_H = 32;

/**
 * Load an image as a tiny grayscale signature for orientation comparison.
 *
 * 64x32 is deliberate: big enough that a vehicle's silhouette, greenhouse and
 * wheel positions dominate, small enough that lettering, compression noise and
 * the text-fix's own edits cannot. We are asking "which way is the car facing",
 * not "are these the same image". Measured on the live pair, full resolution
 * could NOT answer this — the Ridgeline views scored 32.2 as-is against 32.6
 * mirrored, indistinguishable, because fine design detail and reflections swamp
 * the silhouette. At this size the same pair reads 35,159 against 4,286.
 *
 * Returns null on any failure — the caller must treat that as "unknown" and
 * must not act on it.
 */
async function orientationSignature(url: string): Promise<Float64Array | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error("load failed"));
        i.src = objectUrl;
      });
      const canvas = document.createElement("canvas");
      canvas.width = ORIENTATION_W;
      canvas.height = ORIENTATION_H;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, ORIENTATION_W, ORIENTATION_H);
      const { data } = ctx.getImageData(0, 0, ORIENTATION_W, ORIENTATION_H);
      const out = new Float64Array(ORIENTATION_W * ORIENTATION_H);
      for (let i = 0; i < out.length; i++) {
        out[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
      }
      return out;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    return null;
  }
}

/**
 * The pure half of the orientation check: given two grayscale signatures, does
 * the candidate face the SAME way as the driver?
 *
 * Split from the fetch/canvas half so the decision itself is testable without a
 * DOM — this arithmetic is what protects the passenger panel, so it should not
 * only be reachable through an image load.
 *
 * true  = same direction (the mirror was undone)
 * false = properly opposite-facing
 * null  = cannot tell; the caller must keep its current behaviour
 */
export function orientationVerdict(
  driver: ArrayLike<number> | null,
  candidate: ArrayLike<number> | null,
  width: number,
  height: number,
): boolean | null {
  if (!driver || !candidate) return null;
  if (driver.length !== candidate.length) return null;
  if (driver.length !== width * height) return null;

  let asIs = 0, mirrored = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = driver[y * width + x];
      asIs += Math.abs(d - candidate[y * width + x]);
      mirrored += Math.abs(d - candidate[y * width + (width - 1 - x)]);
    }
  }

  // MARGIN, NOT A BARE COMPARISON. A near-symmetric design makes both scores
  // almost equal, and on a coin-flip we must keep the AI's text-corrected
  // image — it is the better asset whenever orientation is genuinely
  // ambiguous. Only a clear reading (one at least 10% more similar than the
  // other) counts as evidence. The live cases sit nowhere near this band: the
  // broken 911 reads 10,712 as-is against 23,515 mirrored (ratio 2.20) and the
  // correct Ridgeline reads 35,159 against 4,286 (ratio 0.12).
  if (asIs < mirrored * 0.9) return true;
  if (mirrored < asIs * 0.9) return false;
  return null;
}

/**
 * Did the text-fix pass UNDO the mirror?
 *
 * THE GUARD THIS FILE'S OWN DOCTRINE NEEDS.
 *
 * `producePassengerView` flips the driver view geometrically, and the header on
 * that function is right that "a geometric flip cannot face the wrong way". But
 * the very next step hands the flipped image to `revise-render` — a full AI
 * image edit — and returned whatever came back, unchecked. The model is free to
 * re-render the car facing the original direction, and nothing noticed. That is
 * the same "two driver sides" failure the doctrine says was eliminated; it just
 * moved one step later.
 *
 * Live on the 2024 Porsche 911 turbo (DID-9BD3BA61): the saved passenger view
 * faced the SAME way as the driver, the 2D proof faithfully drew two driver
 * sides, and the owner reported it.
 *
 * WHY THIS GUARD CAN WORK WHERE THE OLD ONE COULD NOT: the guard this file
 * rightly criticises compared the returned URL to the driver's URL, and every
 * render writes a new file, so a driver-facing result always arrived under a
 * fresh URL and sailed through. This compares PIXELS and asks only which way
 * the vehicle faces — a question a new filename cannot disguise.
 */
async function textFixUndidTheMirror(
  driverUrl: string,
  candidateUrl: string,
): Promise<boolean | null> {
  const [driver, candidate] = await Promise.all([
    orientationSignature(driverUrl),
    orientationSignature(candidateUrl),
  ]);
  return orientationVerdict(driver, candidate, ORIENTATION_W, ORIENTATION_H);
}

export async function fixMirrorText(
  mirrorImageUrl: string,
  opts: {
    vehicleYear?: string;
    vehicleMake?: string;
    vehicleModel?: string;
    toolType?: string;
    invokeEdgeFunction: (fnName: string, body: Record<string, any>) => Promise<{ data: any; error: any }>;
  },
): Promise<string> {
  console.log("[PassengerMirror] Sending mirrored image to AI for text correction...");

  // HARD TIMEOUT — this revise-render (AI) call had NONE, so a hung/slow render
  // could block whoever awaits the passenger mirror FOREVER. In RevisionStudio the
  // passenger mirror is awaited BEFORE the other views, so a hang here froze the
  // whole "generate missing views" run at "Generating Passenger Side… 0/6". If the
  // text-fix doesn't return in time, fall back to the raw (readable-enough) mirror
  // rather than hang. The mirror is already usable; the fix is a nicety.
  const TEXT_FIX_TIMEOUT_MS = 90_000;
  let data: any = null, error: any = null;
  try {
    const res = await Promise.race([
      opts.invokeEdgeFunction("revise-render", {
        originalRenderUrl: mirrorImageUrl,
        revisionPrompt: "This is a horizontally mirrored vehicle wrap. All text, lettering, numbers, URLs, and logos are BACKWARDS (mirror-reversed). Your ONLY task: flip every text/lettering element so it reads correctly left-to-right. Do NOT change the vehicle, design, colors, patterns, background, or any non-text element. CRITICAL: Keep the EXACT same straight-on side camera angle — do NOT rotate, tilt, or change the perspective in any way. The output must be a perfectly flat, straight-on side view identical to the input framing. Output the corrected image.",
        rawPrompt: true,
        toolType: opts.toolType || "colorpro",
        viewType: "passenger-side",
        vehicleYear: opts.vehicleYear,
        vehicleMake: opts.vehicleMake,
        vehicleModel: opts.vehicleModel,
      }),
      new Promise<{ data: any; error: any }>((resolve) =>
        setTimeout(() => resolve({ data: null, error: { message: `text-fix timed out after ${TEXT_FIX_TIMEOUT_MS / 1000}s` } }), TEXT_FIX_TIMEOUT_MS),
      ),
    ]);
    data = res.data; error = res.error;
  } catch (e: any) {
    error = { message: e?.message || "text-fix threw" };
  }

  if (error || !data?.renderUrl) {
    console.warn("[PassengerMirror] Text-fix AI pass failed/timed out, using mirror as-is:", error?.message);
    return mirrorImageUrl; // Graceful fallback - mirrored image still usable
  }

  console.log("[PassengerMirror] Text correction complete");
  return data.renderUrl;
}

/**
 * THE PASSENGER-SIDE PRODUCER — the ONE producer in the codebase.
 *
 * Every tool that needs a passenger-side view calls this. It is a deterministic
 * horizontal flip of the DRIVER view, followed by the AI text-direction repair
 * for lettering. It NEVER asks a render function for a passenger-side image.
 *
 * WHY THIS IS THE ONLY PRODUCER (do not add a second one):
 * An AI passenger render can — and repeatedly did — hand back a DRIVER-facing
 * image ("two driver sides"). Guards against that were tried and cannot work:
 * the guard in useDesignPanelProLogic compared the returned URL to the driver's
 * URL, but every render writes a NEW file, so a driver-facing result always
 * arrived under a fresh URL and passed. Every real occurrence sailed through,
 * which is why the regression came back dozens of times. A geometric flip cannot
 * face the wrong way, so routing every tool through here removes the failure
 * mode instead of guarding against it.
 *
 * Returns the passenger URL, or NULL for an honest gap. Null means "no passenger
 * view" — callers must NOT substitute an AI render, and must never fall back to
 * a generative passenger pass.
 */
export async function producePassengerView(opts: {
  /** The driver-side image to flip. Required — no driver, no passenger. */
  driverUrl: string;
  /** Uploads the mirrored data URL and returns a public URL. */
  uploadDataUrl: (dataUrl: string) => Promise<string>;
  /** Inputs for the has-text heuristic that decides whether to run the repair. */
  textDetection?: { modeType?: string; prompt?: string; designIQMode?: string };
  vehicleYear?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  toolType?: string;
  invokeEdgeFunction: (fnName: string, body: Record<string, any>) => Promise<{ data: any; error: any }>;
  /** Mirror attempts before reporting an honest gap. Default 2. */
  attempts?: number;
  /** Label for logs, e.g. "DesignIQ" / "ColorPro". */
  logLabel?: string;
}): Promise<string | null> {
  const label = opts.logLabel || "PassengerMirror";
  const maxAttempts = opts.attempts ?? 2;
  let passengerUrl: string | null = null;

  if (!opts.driverUrl) {
    console.warn(`[${label}] No driver image — passenger view is an honest gap`);
    return null;
  }

  // Deterministic flip. Retried for transient fetch/canvas failures only; a
  // repeat failure is an honest gap, never a generative substitute.
  for (let attempt = 1; attempt <= maxAttempts && !passengerUrl; attempt++) {
    try {
      const mirrorDataUrl = await generatePassengerMirror(opts.driverUrl);
      passengerUrl = await opts.uploadDataUrl(mirrorDataUrl);
    } catch (mirrorErr: any) {
      console.error(`[${label}] Passenger mirror attempt ${attempt} failed:`, mirrorErr);
    }
  }

  if (!passengerUrl) {
    console.error(`[${label}] Passenger mirror failed — honest gap (never a driver-facing render)`);
    return null;
  }

  // A mirror flips ALL lettering backwards. Repair it when the design carries
  // text. Non-fatal: the raw mirror is still a correct opposite-facing view.
  if (designLikelyHasText(opts.textDetection || {})) {
    const rawMirrorUrl = passengerUrl;
    try {
      console.log(`[${label}] Passenger mirror has text — AI text-direction fix`);
      const fixedUrl = await fixMirrorText(rawMirrorUrl, {
        vehicleYear: opts.vehicleYear,
        vehicleMake: opts.vehicleMake,
        vehicleModel: opts.vehicleModel,
        toolType: opts.toolType,
        invokeEdgeFunction: opts.invokeEdgeFunction,
      });

      // ORIENTATION IS NON-NEGOTIABLE; READABLE TEXT IS A NICETY.
      //
      // The text-fix is a full AI re-render, so it can hand back a
      // DRIVER-facing image — and it was returned unchecked, which is how the
      // 911 shipped two driver sides. A backwards-lettering mirror is a
      // cosmetic defect on a CORRECT view; a driver-facing "passenger" is the
      // wrong panel, and every proof and print file composed from it inherits
      // that. So when the check reads clearly, orientation wins.
      //
      // Only a DEFINITE reading reverts. Null — undeterminable, or a
      // near-symmetric design where the scores are too close to call — keeps
      // the text-corrected image, so a broken or ambiguous check can never
      // cost a good fix.
      if (fixedUrl && fixedUrl !== rawMirrorUrl) {
        const undone = await textFixUndidTheMirror(opts.driverUrl, fixedUrl);
        if (undone === true) {
          console.warn(
            `[${label}] Text-fix returned a DRIVER-facing image — discarding it, keeping the raw mirror`,
          );
          passengerUrl = rawMirrorUrl;
        } else {
          passengerUrl = fixedUrl;
        }
      } else {
        passengerUrl = fixedUrl || rawMirrorUrl;
      }
    } catch (txtErr: any) {
      console.warn(`[${label}] Passenger text-fix failed, keeping raw mirror:`, txtErr?.message || txtErr);
      passengerUrl = rawMirrorUrl;
    }
  }

  return passengerUrl;
}
