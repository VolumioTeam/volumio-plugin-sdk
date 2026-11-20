import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditFindings } from '../src/audit.js';

// The shape of `npm audit --json` (auditReportVersion 2).
const report = {
  auditReportVersion: 2,
  vulnerabilities: {
    minimist: {
      name: 'minimist', severity: 'critical', range: '<0.2.4', fixAvailable: true,
      via: [{ title: 'Prototype Pollution in minimist', url: 'https://github.com/advisories/GHSA-xvch-5gv4-984h', severity: 'critical' }],
    },
    mkdirp: { name: 'mkdirp', severity: 'critical', range: '0.4.1 - 0.5.1', fixAvailable: false, via: ['minimist'] },
    debug: { name: 'debug', severity: 'moderate', range: '<2.6.9', fixAvailable: true, via: [{ title: 'ReDoS in debug', severity: 'moderate' }] },
  },
};
const brief = (findings) => findings.map((f) => `${f.severity} ${f.rule} ${f.message}`);

test('high and critical vulnerabilities in production dependencies: errors for v2, warnings for v1', () => {
  assert.deepEqual(brief(auditFindings(report, 'v2')), [
    'error G2.audit minimist <0.2.4: critical (Prototype Pollution in minimist)',
    'error G2.audit mkdirp 0.4.1 - 0.5.1: critical (through minimist)',
  ]);
  assert.deepEqual(auditFindings(report, 'v1').map((f) => f.severity), ['warning', 'warning']);
});

test('the fix says whether a fixed version exists', () => {
  const [minimist, mkdirp] = auditFindings(report, 'v2');
  assert.match(minimist.fix, /npm audit fix/);
  assert.match(mkdirp.fix, /no fixed version/);
});

test('an audit that could not run is a warning, not a pass and not a block', () => {
  assert.deepEqual(brief(auditFindings(undefined, 'v2')), ['warning G2.audit.unavailable npm audit did not run']);
  assert.deepEqual(brief(auditFindings({ error: { code: 'ENOTFOUND' } }, 'v2')), ['warning G2.audit.unavailable npm audit did not run: ENOTFOUND']);
});
