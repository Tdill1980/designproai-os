from pathlib import Path

def replace_once(path, old, new):
    p = Path(path)
    value = p.read_text()
    if value.count(old) != 1:
        raise RuntimeError(f'{path}: expected one harness anchor, found {value.count(old)}')
    p.write_text(value.replace(old, new, 1))

# The edge helper and runtime helper produce matching output but have DIFFERENT
# APIs. The test must execute the edge helper that the request actually imports.
replace_once('tests/production-panel-proof-clean-prompt.test.mjs',
    "const { buildPanelProofPrompt, panelProofCreativeHead, SYSTEM_JOB, SHEET_LAYOUT } = require('../runtime/atlas-panel-proof-contract.cjs');",
    """const proofSource = readFileSync(new URL('../supabase/functions/_shared/atlas-panel-proof-prompt.ts', import.meta.url), 'utf8');
const proofModule = { exports: {} };
const proofCode = execFileSync(resolveEsbuild(), ['--loader=ts', '--format=cjs'], {
  input: proofSource, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
});
runInNewContext(proofCode, {module: proofModule, exports: proofModule.exports}, {timeout: 2000});
const { buildPanelProofPrompt, panelProofCreativeHead, SYSTEM_JOB, SHEET_LAYOUT } = proofModule.exports;""")

# #650 changed the audit to check the selected designer head, not a retired
# literal string. Behavioral negative tests still prove a missing head fails.
replace_once('tests/atlas-panel-proof-contract.test.mjs',
    r'''  assert.match(handler, /Lead Vehicle Wrap Designer\/\.test\(prompt\)/);
  assert.match(handler, /DESIGN AMPLIFICATION: Elevate and enhance the brief\/\.test\(prompt\)/);''',
    '''  assert.ok(handler.includes('prompt.startsWith(creativeHead + "\\\\n\\\\n")'));
  assert.ok(handler.includes('Boolean(nativeKnowledgeInstruction && prompt.includes(nativeKnowledgeInstruction))'));''')

# Parameter mapping ends when the creative head has been built. The old marker
# depended on a particular formatting of the next, unrelated output assignment.
replace_once('tests/atlas-panel-proof-topology.test.mjs',
    '  const end = edge.indexOf("    let prompt = buildPanelProofPrompt(");',
    '  const end = edge.indexOf("    // CALL 1 CREATIVE AUTHORITY:", start);')
print('Test harness now uses the edge API and current source seams; production assertions retained.')
