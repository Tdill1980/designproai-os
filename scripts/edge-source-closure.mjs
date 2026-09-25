// Raw-source deployment needs the syntactic import graph, not the optimized
// esbuild input graph. Parse only; never evaluate function code or fetch URLs.
import { lstatSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export function loadSourceParser() {
  if (!process.env.EDGE_TYPESCRIPT_PATH) throw new Error('Missing pinned Edge source parser');
  const ts = createRequire(import.meta.url)(process.env.EDGE_TYPESCRIPT_PATH);
  if (ts.version !== '5.8.3') throw new Error('Expected TypeScript source parser 5.8.3');
  return ts;
}

export function collectEdgeSourceFiles({ root, entrypoints, ts = loadSourceParser() }) {
  root = resolve(root);
  const seen = new Set();
  if (!Array.isArray(entrypoints) || !entrypoints.length) throw new Error('Missing Edge entrypoints');
  function visitFile(filename) {
    const absolute = resolve(root, filename);
    const name = relative(root, absolute);
    if (!name || name === '..' || name.startsWith('..' + sep) || isAbsolute(name)) {
      throw new Error(`Source escapes checkout: ${filename}`);
    }
    const parts = name.split(sep);
    if (parts[0] !== 'supabase' || parts[1] !== 'functions') throw new Error(`Source outside Edge tree: ${name}`);
    let current = root;
    for (const part of parts) {
      current = resolve(current, part);
      if (lstatSync(current).isSymbolicLink()) throw new Error(`Symlink in source path: ${name}`);
    }
    if (!lstatSync(absolute).isFile()) throw new Error(`Not a source file: ${name}`);
    if (seen.has(name)) return;
    seen.add(name);
    const text = readFileSync(absolute, 'utf8');
    if (name.endsWith('.json')) { JSON.parse(text); return; }
    if (!/\.[cm]?[jt]sx?$/.test(name)) throw new Error(`Unsupported source extension: ${name}`);
    const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
    if (source.parseDiagnostics.length) throw new Error(`Invalid source syntax: ${name}`);
    function dependency(specifier) {
      if (typeof specifier !== 'string' || !specifier || /[\\\0\r\n]/.test(specifier)) {
        throw new Error(`Invalid import in ${name}`);
      }
      if (/^(?:https?:\/\/|npm:|jsr:|node:)/.test(specifier)) return;
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
        throw new Error(`Unresolved import requires full dependency review: ${name}: ${specifier}`);
      }
      if (/[?#%]/.test(specifier)) throw new Error(`Unsupported local import: ${name}: ${specifier}`);
      visitFile(resolve(dirname(absolute), specifier));
    }
    function literal(node) {
      if (!node || (!ts.isStringLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node))) {
        throw new Error(`Nonliteral module import requires full dependency review: ${name}`);
      }
      dependency(node.text);
    }
    function walk(node) {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier) literal(node.moduleSpecifier);
      } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
        literal(node.moduleReference.expression);
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
        literal(node.argument.literal);
      } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
          || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
        literal(node.arguments[0]);
      }
      ts.forEachChild(node, walk);
    }
    for (const ref of source.referencedFiles) dependency(ref.fileName.startsWith('.') ? ref.fileName : './' + ref.fileName);
    walk(source);
  }
  for (const entrypoint of entrypoints) visitFile(entrypoint);
  return [...seen].map(name => name.split(sep).join('/')).sort();
}
