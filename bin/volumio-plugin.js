#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { check } from '../src/check.js';
import { declaredArches, packagePlugin } from '../src/package.js';

const USAGE = `Usage:
  volumio-plugin check [plugin-dir ...] [--built] [--json]
  volumio-plugin package [plugin-dir] [--out <dir>]
  volumio-plugin arch [plugin-dir]
`;

const print = (result) => {
  const errors = result.findings.filter((f) => f.severity === 'error').length;
  const head = `${errors ? '✖' : '✔'} ${result.id ?? result.dir}${result.source ? ` (${result.source})` : ''}`;
  const lines = result.findings.flatMap((f) => [
    `  ${f.severity.padEnd(7)} ${f.rule}  ${f.file ? `${f.file}${f.line ? `:${f.line}` : ''}  ` : ''}${f.message}`,
    ...(f.fix ? [`        fix: ${f.fix}`] : []),
  ]);
  return [head, ...lines].join('\n') + '\n';
};

const valueOf = (args, flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = (args) => args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');

// The commit time keeps the zip reproducible; CI may set SOURCE_DATE_EPOCH instead.
const epochOf = (dir) => {
  if (process.env.SOURCE_DATE_EPOCH) return Number(process.env.SOURCE_DATE_EPOCH);
  const git = spawnSync('git', ['-C', dir, 'log', '-1', '--format=%ct'], { encoding: 'utf8' });
  const epoch = Number(git.stdout?.trim());
  if (!epoch) throw new Error('No commit time: run inside a git checkout or set SOURCE_DATE_EPOCH');
  return epoch;
};

const env = process.env;
const meta = {
  repository: env.GITHUB_REPOSITORY,
  commit: env.GITHUB_SHA,
  ref: env.GITHUB_REF,
  runId: env.GITHUB_RUN_ID,
  runAttempt: env.GITHUB_RUN_ATTEMPT,
  workflowRef: env.GITHUB_WORKFLOW_REF,
};

const commands = {
  check(args) {
    const built = args.includes('--built');
    const dirs = positional(args);
    const results = (dirs.length ? dirs : ['.']).map((dir) => check(dir, { built }));
    process.stdout.write(args.includes('--json') ? `${JSON.stringify(results, null, 2)}\n` : results.map(print).join(''));
    return results.some((r) => r.findings.some((f) => f.severity === 'error')) ? 1 : 0;
  },
  package(args) {
    const dir = positional(args)[0] ?? '.';
    const result = packagePlugin(dir, { out: valueOf(args, '--out') ?? 'dist-plugin', epoch: epochOf(dir), meta });
    process.stdout.write(print({ id: result.provenance.id, findings: result.provenance.gates.findings }));
    process.stdout.write(`${result.zip}\nsha256 ${result.sha256}\n`);
    return result.ok ? 0 : 1;
  },
  arch(args) {
    process.stdout.write(`${JSON.stringify(declaredArches(positional(args)[0] ?? '.'))}\n`);
    return 0;
  },
};

const [command, ...args] = process.argv.slice(2);
if (!commands[command]) {
  process.stderr.write(USAGE);
  process.exit(2);
}
try {
  process.exitCode = commands[command](args);
} catch (e) {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
}
