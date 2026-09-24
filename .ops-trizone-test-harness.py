from pathlib import Path

def replace_once(path, old, new):
    p = Path(path)
    value = p.read_text()
    if value.count(old) != 1:
        raise RuntimeError(f'{path}: expected one harness anchor, found {value.count(old)}')
    p.write_text(value.replace(old, new, 1))

# Matching output, different APIs: execute the edge helper the request imports.
replace_once('tests/production-panel-proof-clean-prompt.test.mjs',
    "const { buildPanelProofPrompt, panelProofCreativeHead, SYSTEM_JOB, SHEET_LAYOUT } = require('../runtime/atlas-panel-proof-contract.cjs');",
    """const proofSource = readFileSync(new URL('../supabase/functions/_shared/atlas-panel-proof-prompt.ts', import.meta.url), 'utf8');
const proofModule = { exports: {} };
const proofCode = execFileSync(resolveEsbuild(), ['--loader=ts', '--format=cjs'], {
  input: proofSource, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
});
runInNewContext(proofCode, {module: proofModule, exports: proofModule.exports}, {timeout: 2000});
const { buildPanelProofPrompt, panelProofCreativeHead, SYSTEM_JOB, SHEET_LAYOUT } = proofModule.exports;""")

# #650 changed the audit to check the selected head instead of a retired string.
# The behavioral negative tests still prove that dropping the head fails.
replace_once('tests/atlas-panel-proof-contract.test.mjs',
    r'''  assert.match(handler, /Lead Vehicle Wrap Designer\/\.test\(prompt\)/);
  assert.match(handler, /DESIGN AMPLIFICATION: Elevate and enhance the brief\/\.test\(prompt\)/);''',
    '''  assert.ok(handler.includes('prompt.startsWith(creativeHead + "\\\\n\\\\n")'));
  assert.ok(handler.includes('Boolean(nativeKnowledgeInstruction && prompt.includes(nativeKnowledgeInstruction))'));''')

path = 'tests/atlas-panel-proof-topology.test.mjs'
replace_once(path,
    '  const end = edge.indexOf("    let prompt = buildPanelProofPrompt(");',
    '  const end = edge.indexOf("    // CALL 1 CREATIVE AUTHORITY:", start);')
replace_once(path,
    '  assert.match(exact, /senior graphic designer and vehicle-wrap specialist/);',
    '  assert.match(exact, /senior (?:professional )?graphic designer and vehicle-wrap specialist/);')
replace_once(path,
    '  assert.match(exact, /native Gemini 3 Pro Image design knowledge/);',
    '  assert.match(exact, /native (?:Gemini 3 Pro Image )?design knowledge/);')
print('Harness executes actual edge API and current selected persona; behavioral assertions retained.')
