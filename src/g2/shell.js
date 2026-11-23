import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const SET_E = /^\s*set\s+(-[a-zA-Z]*e|-o\s+errexit)/m;
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

// Volumio runs install.sh with sh, dash on Debian: the shebang is ignored.
const LINE_RULES = [
  { rule: 'G2.shell.pipefail', test: /\bpipefail\b/, message: 'pipefail stops install.sh: Volumio runs it with sh (dash), which has no pipefail', fix: 'Use set -eu' },
  { rule: 'G2.shell.or-true', test: /\|\|\s*(true|:)\s*($|[;&|)])/, message: '|| true hides a failure', fix: 'Let the command fail, or handle the failure explicitly' },
  {
    rule: 'G2.shell.package-manager',
    test: /\bdpkg\s+(-i|--install)\b|\b(npm|yarn|pnpm)\s+(i|install|add|ci)\b|\bpip3?\s+install\b/,
    message: 'install.sh runs a package manager',
    fix: 'Ship npm dependencies inside the package; install Debian packages with apt-get, declared in system.apt',
  },
  // On the raw line: a quoted sudoers path is still written.
  { rule: 'G2.shell.sudoers', raw: true, test: /\/etc\/sudoers/, message: 'install.sh writes sudoers rules', fix: 'Ask for the capability you need instead' },
];

// apt-get install is allowed for the packages the manifest declares in system.apt.
// ponytail: -o, -c and -t are the options that take a value; any other word starting with - is a flag.
const APT_INSTALL = /\b(?:apt-get|apt|aptitude)\s+(?:-\S+\s+)*install\b([^;&|)]*)/g;
const APT_ON = /\b(?:apt-get|apt|aptitude)\b/;
const APT_NAME = /^[a-z0-9][a-z0-9+.-]+$/;
// One finding per line at most, as for every other line rule: the baseline counts lines.
const aptFindings = (command, apt) => {
  const names = [...command.matchAll(APT_INSTALL)].map(([, rest]) => {
    const words = rest.trim().split(/\s+/).filter(Boolean);
    const packages = words.filter((w, i) => !w.startsWith('-') && !/^-[oct]$/.test(words[i - 1] ?? ''));
    // A version, architecture or release after the name: pkg=1.2, pkg:arm64, pkg/bookworm-backports.
    return packages.length ? packages.map((p) => p.split(/[=:/]/)[0]) : [''];
  });
  if (!names.length) return [];
  if (!names.flat().every((n) => APT_NAME.test(n))) {
    return [{ message: 'install.sh installs APT packages it does not name', fix: 'Name each package in the apt-get install line, as declared in system.apt' }];
  }
  const undeclared = [...new Set(names.flat())].filter((n) => !apt.includes(n));
  return undeclared.length
    ? [{ message: `install.sh installs ${undeclared.join(', ')}, not declared in system.apt`, fix: `Add ${undeclared.join(', ')} to system.apt in volumio-plugin.json` }]
    : [];
};
// The command a line starts, with the lines it continues on (a trailing backslash).
const continued = (code, i) => {
  let text = code[i];
  for (let j = i + 1; /\\\s*$/.test(text) && j < code.length; j++) text = text.replace(/\\\s*$/, ' ') + code[j];
  return text.replace(/\\\s*$/, '');
};

const DOWNLOAD = { rule: 'G2.shell.download', test: /\b(wget|curl)\b/, message: 'a download with no checksum check', fix: 'Verify the file with sha256sum -c before using it' };

/**
 * G2 rules on the text of install.sh.
 * @param {string} script
 * @param {string} file
 * @param {string[]} [apt] the packages the manifest declares in system.apt
 */
export function shellFindings(script, file, apt = []) {
  const lines = script.split('\n');
  const code = lines.map(codeOf);
  const rules = code.some((c) => HAS_CHECKSUM.test(c)) ? LINE_RULES : [...LINE_RULES, DOWNLOAD];
  const finding = (r, line) => ({ rule: r.rule, severity: 'error', file, line, message: r.message, fix: r.fix });
  const missingSetE = !SET_E.test(script)
    ? [{ rule: 'G2.shell.set-e', severity: 'error', file, line: 1, message: 'install.sh does not stop on the first error', fix: 'Add set -eu at the top. A -e on the shebang line does not count: Volumio runs install.sh with sh' }]
    : [];
  const perLine = lines.flatMap((text, i) => [
    ...rules.filter((r) => r.test.test(r.raw ? text.match(CODE)[0] : code[i])).map((r) => finding(r, i + 1)),
    // On the line apt-get is on, not on a line it continues from.
    ...(APT_ON.test(code[i]) ? aptFindings(continued(code, i), apt) : []).map((f) => finding({ rule: 'G2.shell.package-manager', ...f }, i + 1)),
  ]);
  return [...missingSetE, ...perLine];
}

/** @returns {string | undefined} the installed ShellCheck version */
export const shellcheckVersion = () => spawnSync('shellcheck', ['--version'], { encoding: 'utf8' }).stdout?.match(/version:\s*(\S+)/)?.[1];

// Line numbers are kept: each directive becomes an empty comment.
const DIRECTIVE = /^([ \t]*)#[ \t]*shellcheck\b.*$/gm;

// ShellCheck is optional on a laptop and required in CI, which installs it. The plugin cannot
// switch checks off: no .shellcheckrc (--norc), no '# shellcheck disable=' directives. Checked as
// dash, the shell Volumio runs install.sh with, whatever the shebang says.
const shellcheck = (script, file) => {
  const run = spawnSync('shellcheck', ['--norc', '--shell=dash', '-f', 'json1', '-S', 'warning', '-'], { input: script.replace(DIRECTIVE, '$1#'), encoding: 'utf8' });
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

/**
 * G2 shell checks on a plugin's install.sh, if it has one.
 * @param {string} dir
 * @param {string[]} [apt] the packages the manifest declares in system.apt
 */
export function shellDir(dir, apt) {
  const path = join(dir, 'install.sh');
  if (!existsSync(path)) return [];
  const script = readFileSync(path, 'utf8');
  return [...shellFindings(script, 'install.sh', apt), ...shellcheck(script, 'install.sh')];
}
