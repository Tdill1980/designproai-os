// Semantic checks for the new dependency entry. Report unrelated legacy
// diagnostics separately; never replace or skip the repository release gate.
import ts from '../app/node_modules/typescript/lib/typescript.js';
import { resolve } from 'node:path';
const configPath = resolve('app/tsconfig.app.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, resolve('app'));
const program = ts.createProgram([resolve('app/src/pages/RecreatePro.tsx'), resolve('app/src/components/recreatepro/ProductionFlowEntry.tsx'), resolve('app/src/vite-env.d.ts')], { ...parsed.options, noEmit: true });
const diagnostics = ts.getPreEmitDiagnostics(program);
const scoped = diagnostics.filter(item => !item.file || /(?:RecreatePro\.tsx|recreatepro[^/]*\.ts|ProductionFlowEntry\.tsx)$/.test(item.file.fileName));
console.log(`RecreatePro semantic diagnostics: ${scoped.length}. Unrelated imported legacy diagnostics: ${diagnostics.length - scoped.length}.`);
if (scoped.length) { console.error(ts.formatDiagnosticsWithColorAndContext(scoped, { getCurrentDirectory: ts.sys.getCurrentDirectory, getCanonicalFileName: path => path, getNewLine: () => '\n' })); process.exit(1); }
