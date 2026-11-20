import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const SET_E = /^\s*set\s+(-[a-zA-Z]*e|-o\s+errexit)/m;
const SHEBANG_E = /^#!.*\s-[a-zA-Z]*e\b/;
const HAS_CHECKSUM = /\bsha(256|512)sum\b/;
// The ShellCheck of Debian Bookworm, as in the build container: the baseline is recorded with it.
export const SHELLCHECK_VERSION = '0.9.0';

// ponytail: line heuristics, not a shell parser; parse with shfmt's parser if evasions keep showing up.
// The line before its comment: a # that starts a word, outside quotes.
const CODE = /^(?:'[^']*'|"(?:[^"\\]|\\.)*"|\\.|[^'"\\#]|(?<=\S)#|['"\\])*/;
// The commands on a line and the separators between them, quotes kept whole.
const PIECES = /(?:'[^']*'|"(?:[^"\\]|\\.)*"|\\.|[^;&|'"\\]|['"\\])+|[;&|]+/g;
// Quoted text with no expansion or command substitution in it: echo and printf only print it.
const QUOTED = /'[^']*'|"(?:[^"\\$`]|\\.)*"/g;
const PRINTS = /^\s*(sudo\s+)?(echo|printf|logger)\b/;
const RUNS_TEXT = /\|\s*(sudo\s+)?(ba|da|z)?sh\b|\beval\b/;
/** The code on a line: no comment, and no text that a print command only prints. */
const codeOf = (line) => {
  const code = line.match(CODE)[0];
  if (RUNS_TEXT.test(code)) return code;
  return (code.match(PIECES) ?? []).map((piece) => (PRINTS.test(piece) ? piece.replace(QUOTED, "''") : piece)).join('');
};

const LINE_RULES = [
  { rule: 'G2.shell.or-true', test: /\|\|\s*(true|:)\s*($|[;&|)])/, message: '|| true hides a failure', fix: 'Let the command fail, or handle the failure explicitly' },
  {
    rule: 'G2.shell.package-manager',
    test: /\b(apt-get|apt|aptitude)\s+(-\S+\s+)*install\b|\bdpkg\s+(-i|--install)\b|\b(npm|yarn|pnpm)\s+(i|install|add|ci)\b|\bpip3?\s+install\b/,
    message: 'install.sh runs a package manager',
    fix: 'Declare APT packages in the manifest (system.apt) and ship npm dependencies inside the package',
  },
  // On the raw line: a quoted sudoers path is still written.
  { rule: 'G2.shell.sudoers', raw: true, test: /\/etc\/sudoers/, message: 'install.sh writes sudoers rules', fix: 'Ask for the capability you need instead' },
];
const DOWNLOAD = { rule: 'G2.shell.download', test: /\b(wget|curl)\b/, message: 'a download with no checksum check', fix: 'Verify the file with sha256sum -c before using it' };

/**
 * G2 rules on the text of install.sh.
 * @param {string} script
 * @param {string} file
 */
export function shellFindings(script, file) {
  const lines = script.split('\n');
  const code = lines.map(codeOf);
  const rules = code.some((c) => HAS_CHECKSUM.test(c)) ? LINE_RULES : [...LINE_RULES, DOWNLOAD];
  const finding = (r, line) => ({ rule: r.rule, severity: 'error', file, line, message: r.message, fix: r.fix });
  const missingSetE = !SET_E.test(script) && !SHEBANG_E.test(lines[0])
    ? [{ rule: 'G2.shell.set-e', severity: 'error', file, line: 1, message: 'install.sh does not stop on the first error', fix: 'Add set -e (better: set -euo pipefail) at the top' }]
    : [];
  const perLine = lines.flatMap((text, i) =>
    rules.filter((r) => r.test.test(r.raw ? text.match(CODE)[0] : code[i])).map((r) => finding(r, i + 1)));
  return [...missingSetE, ...perLine];
}

/** @returns {string | undefined} the installed ShellCheck version */
export const shellcheckVersion = () => spawnSync('shellcheck', ['--version'], { encoding: 'utf8' }).stdout?.match(/version:\s*(\S+)/)?.[1];

// Line numbers are kept: each directive becomes an empty comment.
const DIRECTIVE = /^([ \t]*)#[ \t]*shellcheck\b.*$/gm;

// ShellCheck is optional on a laptop and required in CI, which installs it. The plugin cannot
// switch checks off: no .shellcheckrc (--norc), no '# shellcheck disable=' directives.
const shellcheck = (script, file) => {
  const run = spawnSync('shellcheck', ['--norc', '-f', 'json1', '-S', 'warning', '-'], { input: script.replace(DIRECTIVE, '$1#'), encoding: 'utf8' });
  if (run.error || !run.stdout) return [];
  return JSON.parse(run.stdout).comments.map((c) => ({
    rule: `G2.shellcheck.SC${c.code}`,
    severity: 'error',
    file,
    line: c.line,
    message: c.message,
    fix: `https://www.shellcheck.net/wiki/SC${c.code}`,
  }));
};

/** G2 shell checks on a plugin's install.sh, if it has one. */
export function shellDir(dir) {
  const path = join(dir, 'install.sh');
  if (!existsSync(path)) return [];
  const script = readFileSync(path, 'utf8');
  return [...shellFindings(script, 'install.sh'), ...shellcheck(script, 'install.sh')];
}
