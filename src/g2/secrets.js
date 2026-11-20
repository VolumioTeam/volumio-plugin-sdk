import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Credentials with a recognisable shape. Anything shipped in a plugin is public, whatever the repository's visibility.
const PATTERNS = [
  { name: 'a private key', test: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/ },
  { name: 'an AWS access key', test: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'a GitHub token', test: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})/ },
  { name: 'a Slack token', test: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'a Google API key', test: /\bAIza[0-9A-Za-z_-]{35}/ },
  { name: 'a Stripe live key', test: /\b[rs]k_live_[0-9A-Za-z]{20,}/ },
];
const SKIPPED_DIRS = new Set(['node_modules', '.git']);
// ponytail: larger files are skipped, not streamed; stream them if a plugin ever ships one.
const MAX_BYTES = 10 * 1024 * 1024;
const FIX = 'Remove it and revoke it: it is already public. Read secrets from the plugin settings or the device at runtime';
// The gitleaks of the build container (scripts/install-tools.sh): the baseline is recorded with it.
export const GITLEAKS_VERSION = '8.30.1';
const GITLEAKS_CONFIG = fileURLToPath(new URL('./gitleaks.toml', import.meta.url));

const files = (root, rel = '') =>
  readdirSync(join(root, rel), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((e) => {
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) return SKIPPED_DIRS.has(e.name) ? [] : files(root, path);
      return e.isFile() ? [path] : [];
    });

/** Credentials in the plugin's own files. The finding names the kind of secret, never the secret. */
const patternFindings = (dir) =>
  files(dir).flatMap((file) => {
    if (statSync(join(dir, file)).size > MAX_BYTES) return [];
    const bytes = readFileSync(join(dir, file));
    if (bytes.includes(0)) return [];
    return bytes.toString('utf8').split('\n').flatMap((text, i) =>
      PATTERNS.filter((p) => p.test.test(text)).map((p) => ({
        rule: 'G2.secret',
        severity: 'error',
        file,
        line: i + 1,
        message: `${p.name} in the package`,
        fix: FIX,
      })));
  });

/** @returns {string | undefined} the installed gitleaks version */
export const gitleaksVersion = () => spawnSync('gitleaks', ['version'], { encoding: 'utf8' }).stdout?.trim() || undefined;

// gitleaks is optional on a laptop and required in CI, which installs it. The plugin cannot switch it
// off: our --config, gitleaks:allow ignored, and it scans a copy without the .gitleaksignore it would read.
const gitleaksFindings = (dir) => {
  const work = mkdtempSync(join(tmpdir(), 'g2gl-'));
  try {
    const copy = join(work, 'plugin');
    cpSync(dir, copy, { recursive: true, filter: (p) => !SKIPPED_DIRS.has(basename(p)) && basename(p) !== '.gitleaksignore' });
    const report = join(work, 'report.json');
    const run = spawnSync('gitleaks', ['dir', copy, '--config', GITLEAKS_CONFIG, '--gitleaks-ignore-path', work,
      '--ignore-gitleaks-allow', '--redact', '--no-banner', '--max-target-megabytes', '10', '--exit-code', '0',
      '--report-format', 'json', '--report-path', report], { cwd: work, encoding: 'utf8' });
    if (run.error?.code === 'ENOENT') return [];
    if (run.error || run.status !== 0) throw new Error(`gitleaks failed: ${run.error?.message ?? run.stderr}`);
    // gitleaks scans files in parallel: sorted, so the baseline is the same on every run.
    return JSON.parse(readFileSync(report, 'utf8')).map((leak) => ({
      rule: `G2.secret.${leak.RuleID}`,
      severity: 'error',
      file: relative(copy, leak.File),
      line: leak.StartLine,
      message: `${leak.RuleID} (gitleaks) in the package`,
      fix: FIX,
    })).toSorted((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
};

/** G2: the built-in patterns, plus gitleaks on the lines they did not flag. */
export function secretFindings(dir) {
  const own = patternFindings(dir);
  const flagged = new Set(own.map((f) => `${f.file}:${f.line}`));
  return [...own, ...gitleaksFindings(dir).filter((f) => !flagged.has(`${f.file}:${f.line}`))];
}
