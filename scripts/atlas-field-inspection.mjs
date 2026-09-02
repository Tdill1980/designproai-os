#!/usr/bin/env node
/**
 * PER-FILE BRANDING INSPECTION — harness telemetry, RECORD ONLY. Not a gate.
 * Not production.
 *
 * After the OS cuts the six canonical files from the one creative master, the
 * owner's question 6 is whether the commercial hierarchy survived the cut:
 * is the company name whole inside the Driver file, whole inside the
 * Passenger file, and did any lettering or mark get sliced by a territory
 * edge. This asks Gemini Flash that one question per file, at temperature 0,
 * exactly the way `runtime/atlas-output-class.cjs` asks its class question:
 * bounded JPEG transport, the answer bound to the file's own hash. The answer
 * is recorded beside the owner's eye and never overrules it.
 */
import { createHash } from "node:crypto";

export const INSPECTION_CONTRACT = "designpro.atlas-field-branding-inspection.v1";
export const INSPECTION_MODEL = "gemini-2.5-flash";
const MAX_TRANSPORT_DIMENSION = 1280;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const clean = (v, max = 300) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function brandingInspectionPrompt(inspectionId, companyName) {
  return [
    "You are a print-production inspector looking at ONE flat printed-vinyl artwork file. Report what is on it. Do not judge quality or style.",
    "",
    `The company name for this job is "${companyName}".`,
    "Answer three things:",
    "1. companyName — \"complete\" if the full company name is present and no letter touches or crosses the file edge; \"partial\" if some of it is present but cut by an edge or incomplete; \"absent\" if no company name lettering is present.",
    "2. brandMark — \"complete\", \"partial\" or \"absent\" for a logo / brand mark (an emblem or symbol, not plain lettering).",
    "3. cutAtEdge — true if ANY lettering, logo or focal graphic element is sliced by the file edge, else false.",
    "",
    `Respond with STRICT JSON only: {"inspectionId":"${inspectionId}","companyName":"complete"|"partial"|"absent","brandMark":"complete"|"partial"|"absent","cutAtEdge":true|false,"evidence":"one short sentence"}`,
  ].join("\n");
}

function parse(payload, inspectionId) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  const text = parts.filter((p) => typeof p?.text === "string").map((p) => p.text).join("\n").trim();
  const parsed = JSON.parse(text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim());
  if (parsed?.inspectionId !== inspectionId) throw new Error("inspector answered for different bytes");
  const tri = (v) => (["complete", "partial", "absent"].includes(v) ? v : "unparsed");
  return { companyName: tri(parsed.companyName), brandMark: tri(parsed.brandMark), cutAtEdge: parsed.cutAtEdge === true, evidence: clean(parsed.evidence) };
}

/**
 * @param sharp the runtime's sharp module (so the harness uses the deployed build)
 */
export async function inspectFileBranding({ provider, sharp, bytes, companyName, model = INSPECTION_MODEL, timeoutMs = 45_000 }) {
  const fileSha256 = sha256(bytes);
  const base = { contract: INSPECTION_CONTRACT, fileSha256, model, recordOnly: true };
  if (!provider || typeof provider.generateRaw !== "function") return { ...base, disposition: "unavailable", reason: "provider.generateRaw missing" };
  try {
    const transport = await sharp(bytes, { limitInputPixels: false })
      .resize({ width: MAX_TRANSPORT_DIMENSION, height: MAX_TRANSPORT_DIMENSION, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    const inspectionId = fileSha256.slice(0, 16);
    const result = await provider.generateRaw({
      model,
      body: {
        contents: [{ parts: [
          { inlineData: { mimeType: "image/jpeg", data: transport.toString("base64") } },
          { text: brandingInspectionPrompt(inspectionId, companyName) },
        ] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      },
      timeoutMs,
      label: "A.T.L.A.S. field harness — per-file branding inspection (record only)",
    });
    return { ...base, disposition: "inspected", ...parse(result?.payload, inspectionId) };
  } catch (error) {
    return { ...base, disposition: "unavailable", reason: clean(error?.message || error, 400) };
  }
}
