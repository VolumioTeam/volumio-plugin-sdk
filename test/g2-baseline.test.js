import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBaseline, countByKey } from '../src/g2/baseline.js';

const f = (rule, file, line) => ({ rule, file, line, severity: 'error', message: 'x' });
const log3 = [f('G2.js.console-log', 'index.js', 1), f('G2.js.console-log', 'index.js', 2), f('G2.js.console-log', 'index.js', 3)];
const brief = (findings) => findings.map((x) => `${x.severity} ${x.rule}${x.line ? `:${x.line}` : ''}`);

test('counts findings per rule and file', () => {
  assert.deepEqual(countByKey(log3), { 'G2.js.console-log|index.js': 3 });
});

test('known violations collapse into one warning', () => {
  const out = applyBaseline(log3, { 'G2.js.console-log|index.js': 3 }, 'v1');
  assert.deepEqual(brief(out), ['warning G2.js.console-log']);
  assert.match(out[0].message, /3 known/);
});

test('more than the baseline allows blocks every one of them', () => {
  const out = applyBaseline(log3, { 'G2.js.console-log|index.js': 2 }, 'v1');
  assert.deepEqual(brief(out), ['error G2.js.console-log:1', 'error G2.js.console-log:2', 'error G2.js.console-log:3']);
});

test('without a baseline, v1 plugins get warnings and v2 plugins errors', () => {
  assert.deepEqual(brief(applyBaseline(log3.slice(0, 1), undefined, 'v1')), ['warning G2.js.console-log:1']);
  assert.deepEqual(brief(applyBaseline(log3.slice(0, 1), undefined, 'v2')), ['error G2.js.console-log:1']);
});

test('a plugin whose id is an Object property name has no baseline', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { g2 } = await import('../src/g2/index.js');
  const dir = mkdtempSync(join(tmpdir(), 'g2b-'));
  writeFileSync(join(dir, 'index.js'), "console.log('x');");
  assert.deepEqual(brief(g2(dir, { id: 'constructor', source: 'v1' }, {})), ['warning G2.js.console-log:1']);
});
