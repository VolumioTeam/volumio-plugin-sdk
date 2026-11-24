#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { check, load } from '../src/check.js';
import { deploy, followLog } from '../src/deploy.js';
import { initPlugin } from '../src/init.js';
import { declaredArches, packagePlugin } from '../src/package.js';
import { localSigner, releaseStatement, signRelease, verifyRelease } from '../src/sign.js';

const USAGE = `Usage:
  volumio-plugin init <dir> --id <id> --type <type> --function <function> --title <title> --description <text> [--author <name>] [--skip-install]
  volumio-plugin check [plugin-dir ...] [--built] [--json]
  volumio-plugin package [plugin-dir] [--out <dir>] [--report-only]
  volumio-plugin arch [plugin-dir]
  volumio-plugin deploy <device> [plugin-dir] [--zip <zip>]
  volumio-plugin logs <device> [--seconds <n>]
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

// A reader that stops early (volumio-plugin logs | head) closes stdout: not a failure.
const stdoutClosed = new Promise((resolve) => {
  process.stdout.on('error', (e) => {
    if (e.code !== 'EPIPE' && e.code !== 'ERR_STREAM_DESTROYED') throw e;
    resolve();
  });
});

const INIT_REQUIRED = ['id', 'type', 'function', 'title', 'description'];

const commands = {
  init(args) {
    const options = Object.fromEntries([...INIT_REQUIRED, 'author'].map((k) => [k, { type: 'string' }]));
    const { values, positionals: [dir] } = parse(args, { ...options, 'skip-install': { type: 'boolean' } });
    const missing = INIT_REQUIRED.filter((k) => !values[k]);
    if (!dir || missing.length) {
      if (missing.length) process.stderr.write(`Missing ${missing.map((k) => `--${k}`).join(', ')}. --function is an id from registry/functions.json\n`);
      return usage();
    }
    const written = initPlugin(dir, values);
    process.stdout.write(written.map((f) => `  ${f}\n`).join(''));
    if (!values['skip-install']) {
      // Writes package-lock.json, which the build needs.
      // npm is a .cmd shim on Windows, which only a shell runs.
      const npm = spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });
      if (npm.status !== 0) return 1;
    }
    process.stdout.write(`✔ ${values.id} in ${dir}: edit volumio-plugin.json and index.js, then npm test and volumio-plugin check\n`);
    return 0;
  },
  check(args) {
    const { values, positionals: dirs } = parse(args, { built: { type: 'boolean' }, json: { type: 'boolean' } });
    const results = (dirs.length ? dirs : ['.']).map((dir) => check(dir, { built: values.built }));
    process.stdout.write(values.json ? `${JSON.stringify(results, null, 2)}\n` : results.map(print).join(''));
    return results.some((r) => r.findings.some((f) => f.severity === 'error')) ? 1 : 0;
  },
  package(args) {
    const { values, positionals } = parse(args, { out: { type: 'string', default: 'dist-plugin' }, 'report-only': { type: 'boolean' } });
    const dir = positionals[0] ?? '.';
    const result = packagePlugin(dir, { out: values.out, epoch: epochOf(dir), meta });
    process.stdout.write(print({ id: result.provenance.id, findings: result.provenance.gates.findings }));
    process.stdout.write(`${result.zip}\nsha256 ${result.sha256}\n`);
    // --report-only: gate errors are reported, not fatal; a build that cannot run still exits 1.
    return result.ok || values['report-only'] ? 0 : 1;
  },
  // Installs on a device of the local network, starts the plugin, prints what it logged.
  async deploy(args) {
    const { values, positionals: [host, dir = '.'] } = parse(args, { zip: { type: 'string' } });
    if (!host) return usage();
    const loaded = load(dir);
    if (loaded.failure) throw new Error(loaded.failure.message);
    const plugin = { id: loaded.manifest.id, type: loaded.manifest.type };
    // Built here, unless --zip: a plugin with native modules is built for the device by scripts/build.sh.
    const out = values.zip ? undefined : mkdtempSync(join(tmpdir(), 'volumio-deploy-'));
    let result;
    try {
      let zip = values.zip;
      if (out) {
        const built = packagePlugin(dir, { out, epoch: Math.floor(Date.now() / 1000) });
        process.stdout.write(print({ id: plugin.id, findings: built.provenance.gates.findings }));
        if (!built.ok) return 1;
        zip = built.zip;
      }
      result = await deploy(host, plugin, zip, { progress: (line) => process.stdout.write(`${line}\n`) });
    } finally {
      if (out) rmSync(out, { recursive: true, force: true });
    }
    process.stdout.write(result.log);
    process.stdout.write(result.started
      ? `✔ ${plugin.id} is running on ${host}\n`
      : `✖ ${plugin.id} did not start on ${host}: the log above says why\n`);
    return result.started ? 0 : 1;
  },
  // The device's log as it is written, until Ctrl-C or --seconds.
  async logs(args) {
    const { values, positionals: [host] } = parse(args, { seconds: { type: 'string' } });
    const seconds = values.seconds === undefined ? undefined : Number(values.seconds);
    if (!host || (seconds !== undefined && !(seconds > 0))) return usage();
    // Ctrl-C ends it in both modes, so the device's live log is switched off again.
    const interrupted = new Promise((resolve) => process.once('SIGINT', resolve));
    const until = Promise.race([...(seconds ? [sleep(seconds * 1000)] : []), interrupted, stdoutClosed]);
    await followLog(host, (text) => process.stdout.write(text), until);
    return 0;
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

const [command, ...args] = process.argv.slice(2);
if (!commands[command]) {
  process.exitCode = usage();
} else {
  try {
    process.exitCode = await commands[command](args);
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = String(e?.code).startsWith('ERR_PARSE_ARGS') ? usage() : 1;
  }
}
