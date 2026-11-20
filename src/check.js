import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import semver from 'semver';
import { validateManifest } from './manifest.js';
import { fromV1 } from './fromV1.js';

const REGISTRY = JSON.parse(readFileSync(new URL('../registry/functions.json', import.meta.url), 'utf8')).map((f) => f.id);

/** @typedef {{ rule: string, severity: 'error' | 'warning' | 'todo', message: string, fix?: string, path?: string }} Finding */

const finding = (severity) => (rule, message, fix, path) => ({ rule, severity, message, ...(fix && { fix }), ...(path && { path }) });
const error = finding('error');
const warning = finding('warning');

const readJson = (file) => {
  try {
    return { value: JSON.parse(readFileSync(file, 'utf8')) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
};

/** Reads the manifest: volumio-plugin.json, else package.json through the v1 shim. */
const load = (dir) => {
  const v2File = join(dir, 'volumio-plugin.json');
  const pkgFile = join(dir, 'package.json');
  const pkg = existsSync(pkgFile) ? readJson(pkgFile) : { value: {} };
  if (pkg.error) return { failure: error('G1.json', `package.json is not valid JSON: ${pkg.error}`) };
  if (existsSync(v2File)) {
    const manifest = readJson(v2File);
    if (manifest.error) return { failure: error('G1.json', `volumio-plugin.json is not valid JSON: ${manifest.error}`) };
    return { source: 'v2', manifest: manifest.value, pkg: pkg.value, todo: [], dropped: [] };
  }
  if (!existsSync(pkgFile)) {
    return { failure: error('G1.manifest', 'No volumio-plugin.json or package.json in this folder', 'Run the command from the plugin root') };
  }
  return { source: 'v1', pkg: pkg.value, ...fromV1(pkg.value) };
};

const SCHEMA_FIXES = {
  '/id': 'Use 2-64 letters, digits and underscores; no hyphens, the crypter rejects them',
};

const schemaFindings = (manifest, todo) =>
  validateManifest(manifest)
    .filter((e) => !todo.includes(e.path.slice(1)))
    .map((e) => error('G1.schema', `${e.path.slice(1) || 'manifest'} ${e.message}`, SCHEMA_FIXES[e.path], e.path));

const ruleFindings = ({ manifest }, functions) => {
  const findings = [];
  if (manifest.function !== undefined && !functions.includes(manifest.function)) {
    findings.push(error('G1.function', `function "${manifest.function}" is not in the registry`, 'Pick a registry function, or ask a moderator for a new one in your proposal'));
  }
  const range = manifest.engines?.volumio;
  if (typeof range === 'string' && semver.validRange(range) === null) {
    findings.push(error('G1.engines', `engines.volumio "${range}" is not a semver range`, 'Use a range such as ">=4.0.0 <5.0.0"'));
  }
  return findings;
};

// The source may keep main and i18n in a build folder (TypeScript); the built package may not.
const builtFindings = (dir, { pkg }) => [
  pkg.main !== undefined && !['index.js', './index.js'].includes(pkg.main) &&
    error('G1.main', `package.json main is "${pkg.main}"`, 'The crypter needs main = index.js at the package root'),
  !existsSync(join(dir, 'i18n', 'strings_en.json')) && error('G1.file.i18n', 'i18n/strings_en.json is missing', 'Add the English strings file'),
].filter(Boolean);

const fileFindings = (dir, { source }) => {
  const names = readdirSync(dir);
  const has = (re) => names.some((n) => re.test(n));
  // v1 plugins already state a licence in package.json; the file is required from v2 on.
  const missingLicense = source === 'v1' ? warning : error;
  return [
    !has(/^readme/i) && error('G1.file.readme', 'README is missing', 'Add a README.md that says what the plugin does and how to set it up'),
    !has(/^licen[sc]e(\.(md|txt))?$/i) && missingLicense('G1.file.license', 'LICENSE is missing', 'Add a LICENSE file matching the license field'),
  ].filter(Boolean);
};

/**
 * Gate G1 on one plugin folder.
 * @param {string} dir
 * @param {{ functions?: string[], built?: boolean }} [options] built: dir is the package CI built, not the source
 * @returns {{ dir: string, source?: 'v1' | 'v2', id?: string, findings: Finding[], dropped?: string[] }}
 */
export function check(dir, { functions = REGISTRY, built = false } = {}) {
  const loaded = load(dir);
  if (loaded.failure) return { dir, findings: [loaded.failure] };
  const findings = [
    ...schemaFindings(loaded.manifest, loaded.todo),
    ...ruleFindings(loaded, functions),
    ...(built ? builtFindings(dir, loaded) : []),
    ...fileFindings(dir, loaded),
    ...(loaded.todo.length
      ? [{ rule: 'G1.v2-fields', severity: 'todo', message: `v1 plugin: add ${loaded.todo.join(' and ')} in volumio-plugin.json to move to v2` }]
      : []),
  ];
  return { dir, source: loaded.source, id: loaded.manifest.id, findings, ...(loaded.source === 'v1' && { dropped: loaded.dropped }) };
}
