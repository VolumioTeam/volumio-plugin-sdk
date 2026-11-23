#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { check } from '../src/check.js';
import { declaredArches, packagePlugin } from '../src/package.js';
import { sandboxInstall, SANDBOX_IMAGE } from '../src/sandbox.js';
import { localSigner, releaseStatement, signRelease, verifyRelease } from '../src/sign.js';

const USAGE = `Usage:
  volumio-plugin check [plugin-dir ...] [--built] [--json]
  volumio-plugin package [plugin-dir] [--out <dir>]
  volumio-plugin arch [plugin-dir]
  volumio-plugin sign <zip> --key <private.pem> --key-id <id>
  volumio-plugin verify <zip> --key <id>=<public.pem> [--key ...]
  volumio-plugin sandbox <zip> [--image <tag>] [--json]
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

// Strict: an unknown option, or an option whose value looks like another option, is a usage error.
const parse = (args, options = {}) => parseArgs({ args, options, allowPositionals: true });
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
    const { values, positionals: dirs } = parse(args, { built: { type: 'boolean' }, json: { type: 'boolean' } });
    const results = (dirs.length ? dirs : ['.']).map((dir) => check(dir, { built: values.built }));
    process.stdout.write(values.json ? `${JSON.stringify(results, null, 2)}\n` : results.map(print).join(''));
    return results.some((r) => r.findings.some((f) => f.severity === 'error')) ? 1 : 0;
  },
  package(args) {
    const { values, positionals } = parse(args, { out: { type: 'string', default: 'dist-plugin' } });
    const dir = positionals[0] ?? '.';
    const result = packagePlugin(dir, { out: values.out, epoch: epochOf(dir), meta });
    process.stdout.write(print({ id: result.provenance.id, findings: result.provenance.gates.findings }));
    process.stdout.write(`${result.zip}\nsha256 ${result.sha256}\n`);
    return result.ok ? 0 : 1;
  },
  arch(args) {
    process.stdout.write(`${JSON.stringify(declaredArches(parse(args).positionals[0] ?? '.'))}\n`);
    return 0;
  },
  // A development key: the store signs releases with its KMS key.
  sign(args) {
    const { values, positionals: [zip] } = parse(args, { key: { type: 'string' }, 'key-id': { type: 'string' } });
    const { key, 'key-id': keyId } = values;
    if (!zip || !key || !keyId) return usage();
    const provenance = JSON.parse(readFileSync(zip.replace(/\.zip$/, '.provenance.json'), 'utf8'));
    const statement = releaseStatement({ ...provenance, sha256: sha256Of(zip) });
    const envelope = signRelease(statement, { keyId, sign: localSigner(readFileSync(key, 'utf8')) });
    writeFileSync(`${zip}.sig`, `${JSON.stringify(envelope, null, 2)}\n`);
    process.stdout.write(`${zip}.sig\n`);
    return 0;
  },
  verify(args) {
    const { values, positionals: [zip] } = parse(args, { key: { type: 'string', multiple: true, default: [] } });
    const keys = Object.fromEntries(values.key.map(trustedKey));
    if (!zip || !Object.keys(keys).length) return usage();
    const envelope = JSON.parse(readFileSync(`${zip}.sig`, 'utf8'));
    const statement = verifyRelease(envelope, { keys, sha256: sha256Of(zip) });
    process.stdout.write(`✔ ${statement.id} ${statement.version} ${statement.arch} signed by a trusted key\n`);
    return 0;
  },
};

// G4: installs the amd64 package in the sandbox image (scripts/sandbox-image.sh).
commands.sandbox = (args) => {
  const { values, positionals: [zip] } = parse(args, { image: { type: 'string', default: SANDBOX_IMAGE }, json: { type: 'boolean' } });
  if (!zip) return usage();
  const result = sandboxInstall(zip, { image: values.image });
  process.stdout.write(values.json ? `${JSON.stringify(result, null, 2)}\n` : print({ dir: zip, ...result }));
  return result.findings.some((f) => f.severity === 'error') ? 1 : 0;
};

const [command, ...args] = process.argv.slice(2);
if (!commands[command]) {
  process.exitCode = usage();
} else {
  try {
    process.exitCode = commands[command](args);
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = String(e?.code).startsWith('ERR_PARSE_ARGS') ? usage() : 1;
  }
}
