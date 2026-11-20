#!/usr/bin/env node
import { check } from '../src/check.js';

const USAGE = 'Usage: volumio-plugin check [plugin-dir ...] [--built] [--json]\n';

const print = (result) => {
  const errors = result.findings.filter((f) => f.severity === 'error').length;
  const head = `${errors ? '✖' : '✔'} ${result.id ?? result.dir}${result.source ? ` (${result.source})` : ''}`;
  const lines = result.findings.flatMap((f) => [
    `  ${f.severity.padEnd(7)} ${f.rule}  ${f.file ? `${f.file}${f.line ? `:${f.line}` : ''}  ` : ''}${f.message}`,
    ...(f.fix ? [`        fix: ${f.fix}`] : []),
  ]);
  return [head, ...lines].join('\n') + '\n';
};

const [command, ...args] = process.argv.slice(2);
if (command !== 'check') {
  process.stderr.write(USAGE);
  process.exit(2);
}

const asJson = args.includes('--json');
const built = args.includes('--built');
const dirs = args.filter((a) => !a.startsWith('--'));
const results = (dirs.length ? dirs : ['.']).map((dir) => check(dir, { built }));

process.stdout.write(asJson ? `${JSON.stringify(results, null, 2)}\n` : results.map(print).join(''));
process.exitCode = results.some((r) => r.findings.some((f) => f.severity === 'error')) ? 1 : 0;
