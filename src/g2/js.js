import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { Linter } from 'eslint';
import { rule } from './rule.js';

const FIXES = {
  'G2.js.sync-exec': 'Use execFile or spawn and wait on the result asynchronously',
  'G2.js.shell': 'Pass the command and its arguments as a list to execFile or spawn, without shell: true',
  'G2.js.process-exit': 'Throw or return an error and let Volumio handle it',
  'G2.js.global-handler': 'Handle errors where they happen',
  'G2.js.command-router-override': 'Ask for a capability instead of replacing a core method',
  'G2.js.console-log': 'Log through this.logger',
  'G2.js.parse': 'Fix the syntax error',
};

const JS = new Set(['.js', '.cjs', '.mjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'test', 'tests', '__tests__']);
const SKIP_FILES = /\.(test|spec|min)\.[cm]?js$/;

const linter = new Linter();
// noInlineConfig: a comment in the plugin must not switch a gate rule off.
const config = (sourceType) => ({
  languageOptions: { ecmaVersion: 'latest', sourceType },
  linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'off' },
  plugins: { volumio: { rules: { g2: rule } } },
  rules: { 'volumio/g2': 'error' },
});

const verify = (code, file) => {
  const first = extname(file) === '.mjs' ? 'module' : 'commonjs';
  const messages = linter.verify(code, config(first), { filename: file });
  // A .js file may still be an ES module; try again before calling it broken.
  if (first === 'commonjs' && messages.some((m) => m.fatal)) {
    const asModule = linter.verify(code, config('module'), { filename: file });
    if (!asModule.some((m) => m.fatal)) return asModule;
  }
  return messages;
};

/**
 * G2 JavaScript checks on one source text.
 * @param {string} code
 * @param {string} file path relative to the plugin root, used in findings
 * @returns {Array<{ rule: string, severity: 'error', file: string, line: number, message: string, fix: string }>}
 */
export function lintSource(code, file) {
  return verify(code, file).filter((m) => m.fatal || m.ruleId === 'volumio/g2').map((m) => {
    const id = m.fatal ? 'G2.js.parse' : m.messageId;
    return { rule: id, severity: 'error', file, line: m.line, message: m.message, fix: FIXES[id] };
  });
}

const sourceFiles = (root, rel = '') =>
  readdirSync(join(root, rel), { withFileTypes: true }).flatMap((entry) => {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : sourceFiles(root, path);
    return JS.has(extname(entry.name)) && !SKIP_FILES.test(entry.name) ? [path] : [];
  });

/** G2 JavaScript checks on every source file of a plugin, tests and node_modules excluded. */
export function lintDir(dir) {
  return sourceFiles(dir).flatMap((file) => lintSource(readFileSync(join(dir, file), 'utf8'), file));
}
