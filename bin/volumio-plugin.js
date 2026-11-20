#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { check } from '../src/check.js';
import { declaredArches, packagePlugin } from '../src/package.js';
import { localSigner, releaseStatement, signRelease, verifyRelease } from '../src/sign.js';

const USAGE = `Usage:
  volumio-plugin check [plugin-dir ...] [--built] [--json]
  volumio-plugin package [plugin-dir] [--out <dir>]
  volumio-plugin arch [plugin-dir]
  volumio-plugin sign <zip> --key <private.pem> --key-id <id>
  volumio-plugin verify <zip> --key <id>=<public.pem> [--key ...]
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

const VALUE_FLAGS = new Set(['--out', '--key', '--key-id']);
const valuesOf = (args, flag) => args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []));
const valueOf = (args, flag) => valuesOf(args, flag)[0];
const positional = (args) => args.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(args[i - 1]));
const usage = () => {
  process.stderr.write(USAGE);
  return 2;
};
const sha256Of = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
// <id>=<public.pem>
const trustedKey = (arg) => {
  const i = arg.indexOf('=');
  if (i < 1) throw new Error(`--key takes <key-id>=<public-key.pem>, got ${arg}`);
  return [arg.slice(0, i), readFileSync(arg.slice(i + 1), 'utf8')];
};

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
  // A development key: the store signs releases with its KMS key.
  sign(args) {
    const [zip] = positional(args);
    const key = valueOf(args, '--key');
    const keyId = valueOf(args, '--key-id');
    if (!zip || !key || !keyId) return usage();
    const provenance = JSON.parse(readFileSync(zip.replace(/\.zip$/, '.provenance.json'), 'utf8'));
    const statement = releaseStatement({ ...provenance, sha256: sha256Of(zip) });
    const envelope = signRelease(statement, { keyId, sign: localSigner(readFileSync(key, 'utf8')) });
    writeFileSync(`${zip}.sig`, `${JSON.stringify(envelope, null, 2)}\n`);
    process.stdout.write(`${zip}.sig\n`);
    return 0;
  },
  verify(args) {
    const [zip] = positional(args);
    const keys = Object.fromEntries(valuesOf(args, '--key').map(trustedKey));
    if (!zip || !Object.keys(keys).length) return usage();
    const envelope = JSON.parse(readFileSync(`${zip}.sig`, 'utf8'));
    const statement = verifyRelease(envelope, { keys, sha256: sha256Of(zip) });
    process.stdout.write(`✔ ${statement.id} ${statement.version} ${statement.arch} signed by a trusted key\n`);
    return 0;
  },
};

const [command, ...args] = process.argv.slice(2);
if (!commands[command]) {
  process.exitCode = usage();
} else {
  try {
    process.exitCode = commands[command](args);
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  }
}
