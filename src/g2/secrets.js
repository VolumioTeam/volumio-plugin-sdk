import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

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

const files = (root, rel = '') =>
  readdirSync(join(root, rel), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((e) => {
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) return SKIPPED_DIRS.has(e.name) ? [] : files(root, path);
      return e.isFile() ? [path] : [];
    });

/** G2: credentials in the plugin's own files. The finding names the kind of secret, never the secret. */
export function secretFindings(dir) {
  return files(dir).flatMap((file) => {
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
        fix: 'Remove it and revoke it: it is already public. Read secrets from the plugin settings or the device at runtime',
      })));
  });
}
