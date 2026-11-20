import { spawnSync } from 'node:child_process';

const BLOCKING = new Set(['high', 'critical']);

const unavailable = (report) => ({
  rule: 'G2.audit.unavailable',
  severity: 'warning',
  file: 'package-lock.json',
  message: `npm audit did not run${report?.error?.code ? `: ${report.error.code}` : ''}`,
  fix: 'Run the build again when the npm registry is reachable',
});

/**
 * G2: high and critical advisories on the production dependencies, from `npm audit --json`.
 * An audit that could not run is a warning: an npm outage must not block every release.
 * @param {{ vulnerabilities?: Record<string, { name: string, severity: string, range: string, fixAvailable: unknown, via: Array<string | { title?: string }> }>, error?: { code?: string } } | undefined} report
 * @param {'v1' | 'v2' | undefined} source
 */
export function auditFindings(report, source) {
  if (!report?.vulnerabilities) return [unavailable(report)];
  return Object.values(report.vulnerabilities)
    .filter((v) => BLOCKING.has(v.severity))
    .map((v) => {
      const advisories = [...new Set(v.via.filter((x) => typeof x === 'object').map((x) => x.title))];
      const cause = advisories.length ? advisories.join('; ') : `through ${v.via.join(', ')}`;
      return {
        rule: 'G2.audit',
        severity: source === 'v1' ? 'warning' : 'error',
        file: 'package-lock.json',
        message: `${v.name} ${v.range}: ${v.severity} (${cause})`,
        fix: v.fixAvailable ? `npm audit fix, or update ${v.name}` : `Replace ${v.name}: there is no fixed version`,
      };
    });
}

/** Runs npm audit on an installed package folder. npm exits non-zero when it finds advisories: the JSON is what counts. */
export function runAudit(dir, source) {
  const run = spawnSync('npm', ['audit', '--omit=dev', '--json'], { cwd: dir, encoding: 'utf8' });
  let report;
  try {
    report = JSON.parse(run.stdout);
  } catch {
    report = undefined;
  }
  return auditFindings(report, source);
}
