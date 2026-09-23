#!/usr/bin/env python3
"""One-time, source-checked repair. Never invokes a provider or production API."""
from pathlib import Path
import hashlib

ROOT = Path(__file__).resolve().parents[1]

def replace_once(text, old, new, label):
    if text.count(old) != 1:
        raise RuntimeError(f'{label}: expected one source match, found {text.count(old)}')
    return text.replace(old, new, 1)

path = ROOT / 'supabase/functions/production-panel-proof/index.ts'
s = path.read_text()
blob = hashlib.sha1(b'blob ' + str(len(s.encode())).encode() + b'\0' + s.encode()).hexdigest()
if blob != 'fe3d5d11e33dc0fdb655744edba4592f30be260d':
    raise RuntimeError(f'Call 1 source changed; review instead of overwriting: {blob}')

# Keep every creative instruction; fix its declaration and give the audit the
# actual destination strings rather than independently handwritten old wording.
a = s.index('    prompt = [\n      creativeHead,')
b = s.index('    ].join("\\n\\n");', a) + len('    ].join("\\n\\n");')
old = s[a:b]
new = old.replace('    prompt = [\n      creativeHead,', '    const flatProductionInstructions = [', 1)
new = new.replace('    ].join("\\n\\n");', '    ];\n    let prompt = [creativeHead, ...flatProductionInstructions].join("\\n\\n");', 1)
s = s[:a] + new + s[b:]

a = s.index('    const phase1Audit = {')
b = s.index('    const missingPhase1 = ', a)
s = s[:a] + '''    // Validate the selected designer's output, not retired copies of its prose.
    // Only the opening identity can satisfy the role check; customer text cannot.
    const identity = creativeHead.split(/\\n\\s*\\n/, 1)[0];
    const intactCreativeHead = prompt.startsWith(`${creativeHead}\\n\\n`);
    const reproductionIdentity = /^You are a vehicle wrap REPRODUCTION specialist at WePrintWraps\\.com\\b/.test(identity);
    const phase1Audit = {
      contract: "designpro.vehiclepro.phase1.graphic-designer-flat-first-opaque-edge.v1",
      graphicDesignerPersonaInjected: intactCreativeHead && (mode === "restyle"
        ? (/^You are WePrintWraps\\.com Lead Vehicle Wrap Designer\\b/.test(identity) || reproductionIdentity)
        : /^You are (?:a|the) senior(?: professional)? graphic designer and vehicle-wrap specialist\\b/.test(identity)),
      nativeGeminiImageKnowledgeInjected: intactCreativeHead && (mode === "restyle"
        ? (/DESIGN AMPLIFICATION: Elevate and enhance the brief/.test(creativeHead) || reproductionIdentity)
        : /\\bnative (?:Gemini 3 Pro Image )?design knowledge\\b/i.test(creativeHead)),
      flatPanelProductionProofInjected: flatProductionInstructions.length === 5
        && prompt.includes(flatProductionInstructions[0]),
      templateLayoutLocked: flatProductionInstructions.length === 5
        && flatProductionInstructions.every(instruction => prompt.includes(instruction)),
    };
''' + s[b:]

# The optional intake reader already fails soft. Actually bound that wait; do
# not timeout/cancel a paid image request or buy a duplicate image.
a = s.index('async function parseCustomerIntake(')
b = s.index('\nconst BUCKET = ', a)
section = s[a:b]
section = replace_once(section, '        method: "POST",', '        method: "POST",\n        signal: AbortSignal.timeout(5_000),', 'intake deadline')
s = s[:a] + section + s[b:]
s = replace_once(s, '  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });', '  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });\n  const requestStartedAt = Date.now();', 'whole-request clock')
s = replace_once(s, 'elapsedMs: Date.now() - t0,', 'elapsedMs: Date.now() - requestStartedAt,\n      providerStartedAfterMs: t0 - requestStartedAt,\n      providerAndPostprocessMs: Date.now() - t0,', 'honest elapsed time')
path.write_text(s)

# The edge and runtime share this small, byte-locked pure helper. Recognize the
# current approved commercial identity and the existing exact-reference mode.
old = r'/senior graphic designer and vehicle-wrap specialist|You are WePrintWraps\.com Lead Vehicle Wrap Designer/.test(head)'
new = r'/^You are (?:a|the) senior(?: professional)? graphic designer and vehicle-wrap specialist\b|^You are WePrintWraps\.com Lead Vehicle Wrap Designer\b|^You are a vehicle wrap REPRODUCTION specialist at WePrintWraps\.com\b/.test(head)'
for name in ['runtime/atlas-panel-proof-contract.cjs', 'supabase/functions/_shared/atlas-panel-proof-prompt.ts']:
    p = ROOT / name
    p.write_text(replace_once(p.read_text(), old, new, name + ' persona recognition'))

p = ROOT / 'runtime/atlas-panel-proof-topology.cjs'
s = p.read_text()
s = replace_once(s, '    this.details = details;\n  }\n}', '    this.details = details;\n    if (typeof details.retryable === "boolean") this.retryable = details.retryable;\n  }\n}', 'refusal preserves explicit retry policy')
s = replace_once(s, '        { status: response.status });', '''        {
          status: response.status,
          retryable: typeof payload?.retryable === "boolean" ? payload.retryable : undefined,
          providerOutcome: payload?.providerOutcome ?? null,
          providerRetryDisposition: payload?.providerRetryDisposition ?? null,
          imageRequestCount: typeof payload?.imageRequestCount === "number" ? payload.imageRequestCount : null,
        });''', 'edge error evidence survives transport')
p.write_text(s)

p = ROOT / 'runtime/flat-first-atlas.cjs'
s = p.read_text()
s = replace_once(s, '''        const creativeRefusal = code === "flat_atlas_panel_proof_refused"
          && (HASH_RE.test(String(cause?.details?.sheet?.contentHash || ""))''', '''        const correctionRequired = ["operator_required", "correct_request"]
          .includes(cause?.details?.providerRetryDisposition);
        const knownUnsent = cause?.details?.imageRequestCount === 0
          && cause?.details?.providerOutcome === "not_sent";
        const creativeRefusal = code === "flat_atlas_panel_proof_refused"
          && !correctionRequired && !knownUnsent
          && (HASH_RE.test(String(cause?.details?.sheet?.contentHash || ""))''', 'do not spend a creative retry on a code fault')
s = replace_once(s, '''        refusal.retryable = creativeRefusal || attempt >= maxAuthoringAttempts ? false
          : (cause?.retryable === true || (Number.isFinite(edgeStatus) && edgeStatus >= 500));''', '''        refusal.retryable = creativeRefusal || attempt >= maxAuthoringAttempts ? false
          : (typeof cause?.retryable === "boolean" ? cause.retryable
            : (Number.isFinite(edgeStatus) && edgeStatus >= 500));''', 'explicit false wins over HTTP 500')
p.write_text(s)
print('Patched the declaration, source-aligned audit, bounded intake, elapsed clock, and terminal-error propagation. No provider call made.')
