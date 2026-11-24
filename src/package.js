import { closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { check, load } from './check.js';
import { runAudit } from './audit.js';
import { licenceFindings } from './licence.js';
import { toV1 } from './fromV1.js';

const ARCH = { arm: 'armhf', x64: 'amd64', arm64: 'arm64' };
const ELF_MACHINE = { 40: 'armhf', 62: 'amd64', 183: 'arm64' };
// Top-level entries that never ship: the device installs what is left.
const NOT_SHIPPED = new Set(['.git', '.github', 'node_modules', 'test', 'tests', '__tests__']);
const SDK_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

/** @param {string} nodeArch process.arch */
export function archOf(nodeArch) {
  const arch = ARCH[nodeArch];
  if (!arch) throw new Error(`Unsupported architecture: ${nodeArch}`);
  return arch;
}

/** The architectures a plugin declares: the build runs once for each. @returns {string[]} */
export function declaredArches(dir) {
  const loaded = load(dir);
  if (loaded.failure) throw new Error(loaded.failure.message);
  const arches = loaded.manifest.arch ?? [];
  if (!arches.length) throw new Error('The manifest declares no architecture');
  const unknown = arches.filter((a) => !Object.values(ARCH).includes(a));
  if (unknown.length) throw new Error(`Unsupported architecture: ${unknown.join(', ')}`);
  return arches;
}

/** @param {Buffer} header the first bytes of a file @returns {string | undefined} */
export const elfArch = (header) =>
  header.length >= 20 && header.readUInt32BE(0) === 0x7f454c46 ? ELF_MACHINE[header.readUInt16LE(18)] : undefined;

// Regular files only, like the device-side submit: no symlinks, which miniunzip does not restore.
export const files = (root, rel = '') =>
  readdirSync(join(root, rel), { withFileTypes: true }).flatMap((e) => {
    const path = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) return files(root, path);
    return e.isFile() ? [path] : [];
  });

const header = (path) => {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(20);
    return buf.subarray(0, readSync(fd, buf, 0, 20, 0));
  } finally {
    closeSync(fd);
  }
};

// The npm package a file belongs to: the last node_modules/<name> or node_modules/@scope/<name> in its path.
const owner = (file) => /^((?:.*\/)?node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(file)?.[1] ?? '';
// node-gyp-build loads build/ before prebuilds/: a binary there must match even when a prebuild does.
const loadedFirst = (file) => /^\/?build\//.test(file.slice(owner(file).length));

/**
 * G3: every package with native modules must have one built for the target architecture. A package may ship
 * a binary per platform and pick one at runtime (prebuilds/, gpiox_arm64.node next to gpiox_arm32.node).
 */
export function nativeFindings(dir, arch) {
  const binaries = files(dir)
    .filter((f) => f.endsWith('.node'))
    .map((file) => ({ file, found: elfArch(header(join(dir, file))) }));
  const covered = new Set(binaries.filter(({ found }) => found === arch).map(({ file }) => owner(file)));
  return binaries
    .filter(({ file, found }) => found !== arch && (loadedFirst(file) || !covered.has(owner(file))))
    .map(({ file, found }) => ({
      rule: 'G3.native-arch',
      severity: 'error',
      file,
      message: `native module built for ${found ?? 'an unknown architecture'}, not ${arch}`,
      fix: 'Build inside the target architecture container, as the Volumio workflow does',
    }));
}

// npm's output goes to stderr: stdout carries only what package reports (findings, zip, sha256).
const run = (cmd, args, cwd) => {
  const result = spawnSync(cmd, args, { cwd, stdio: ['ignore', 2, 'inherit'] });
  if (result.error || result.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed in ${cwd}`);
};

const hasProdDeps = (pkg) => Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies }).length > 0;

/** Installs the production dependencies inside the package, building the plugin first if it has a build script. */
const installDependencies = (stage, pkg, source) => {
  const hasDeps = hasProdDeps(pkg);
  const build = pkg.scripts?.build;
  if (!hasDeps && !build) return [];
  const locked = existsSync(join(stage, 'package-lock.json'));
  const install = (prodOnly) => run('npm', [locked ? 'ci' : 'install', '--no-audit', '--no-fund', ...(prodOnly ? ['--omit=dev'] : [])], stage);
  if (build) {
    install(false);
    run('npm', ['run', 'build'], stage);
    run('npm', ['prune', '--omit=dev'], stage);
  } else {
    install(true);
  }
  return locked ? [] : [{
    rule: 'G3.lockfile',
    severity: source === 'v1' ? 'warning' : 'error',
    file: 'package-lock.json',
    message: 'no package-lock.json: the dependencies are not reproducible',
    fix: 'Commit package-lock.json',
  }];
};

/** Deterministic zip: sorted entries, one fixed mtime, no extra attributes, UTC. */
const zip = (stage, target, epoch) => {
  const entries = files(stage).sort();
  for (const f of entries) utimesSync(join(stage, f), epoch, epoch);
  const result = spawnSync('zip', ['-X', '-D', '-q', '-9', target, '-@'], {
    cwd: stage,
    input: entries.join('\n'),
    env: { ...process.env, TZ: 'UTC' },
  });
  if (result.error || result.status !== 0) throw new Error(`zip failed: ${result.error?.message ?? result.stderr}`);
};

/**
 * Builds the installable package of a plugin for one architecture, runs the gates on it,
 * and writes <id>-<version>-<arch>.zip, its .sha256 and the provenance next to it.
 * @param {string} src plugin source folder
 * @param {{ out: string, arch?: string, epoch: number, meta?: Record<string, unknown>,
 *   functions?: string[], baseline?: Record<string, Record<string, number>> }} options
 */
export function packagePlugin(src, { out, arch = archOf(process.arch), epoch, meta = {}, functions, baseline }) {
  const stage = mkdtempSync(join(tmpdir(), 'volumio-plugin-'));
  cpSync(src, stage, { recursive: true, filter: (p) => !NOT_SHIPPED.has(relative(src, p).split('/')[0]) });
  const pkgFile = join(stage, 'package.json');
  const source = load(stage);
  // The gates run on the tree that ships: the build can write files.
  const installed = installDependencies(stage, source.pkg ?? {}, source.source);
  // Volumio reads package.json: a v2 plugin's is generated from volumio-plugin.json as the build left it.
  const built = load(stage);
  if (built.source === 'v2') writeFileSync(pkgFile, `${JSON.stringify(toV1(built.manifest, built.pkg), null, 2)}\n`);
  const gates = check(stage, { built: true, functions, baseline });
  // The build can add dependencies: decide on the manifest that ships.
  const shipped = existsSync(pkgFile) ? JSON.parse(readFileSync(pkgFile, 'utf8')) : {};
  const dependencies = hasProdDeps(shipped) ? [...runAudit(stage, gates.source), ...licenceFindings(stage, gates.source)] : [];
  const findings = [...gates.findings, ...installed, ...dependencies, ...nativeFindings(stage, arch)]
    .filter((f) => f.severity !== 'todo');

  const name = `${gates.id}-${gates.version}-${arch}`;
  mkdirSync(out, { recursive: true });
  const zipPath = join(out, `${name}.zip`);
  zip(stage, zipPath, epoch);
  const sha256 = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
  writeFileSync(`${zipPath}.sha256`, `${sha256}  ${name}.zip\n`);

  const count = (severity) => findings.filter((f) => f.severity === severity).length;
  const provenance = {
    id: gates.id,
    version: gates.version,
    arch,
    sha256,
    sdk: SDK_VERSION,
    epoch,
    source: { repository: meta.repository, commit: meta.commit, ref: meta.ref },
    build: { runId: meta.runId, runAttempt: meta.runAttempt, workflowRef: meta.workflowRef },
    gates: { errors: count('error'), warnings: count('warning'), findings },
  };
  writeFileSync(join(out, `${name}.provenance.json`), `${JSON.stringify(provenance, null, 2)}\n`);
  return { ok: provenance.gates.errors === 0, zip: zipPath, sha256, provenance };
}
