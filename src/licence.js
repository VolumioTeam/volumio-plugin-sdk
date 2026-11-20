import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PERMISSIVE = new Set(['MIT', 'MIT-0', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'Apache-2.0', 'MPL-2.0', 'Zlib', 'CC0-1.0', 'Unlicense', 'BlueOak-1.0.0']);
// Non-SPDX spellings such as GPLV3 are still GPL.
const COPYLEFT = /^(A|L)?GPL/i;
const RANK = { permissive: 0, unknown: 1, copyleft: 2, missing: 3 };

const ofId = (id) => (PERMISSIVE.has(id) ? 'permissive' : COPYLEFT.test(id) ? 'copyleft' : 'unknown');
const best = (classes) => classes.toSorted((a, b) => RANK[a] - RANK[b])[0];
const worst = (classes) => classes.toSorted((a, b) => RANK[b] - RANK[a])[0];

/**
 * Classifies an SPDX expression (or a legacy { type } object): an OR takes the best choice, an AND the worst.
 * @returns {'permissive' | 'copyleft' | 'unknown' | 'missing'}
 */
export function classify(licence) {
  const text = typeof licence === 'object' && licence ? licence.type : licence;
  if (!text || text === 'UNLICENSED' || /^SEE LICEN[CS]E IN/i.test(text)) return 'missing';
  const tokens = text.match(/[()]|[^\s()]+/g) ?? [];
  let at = 0;
  // SPDX precedence: parentheses, then WITH, then AND, then OR.
  const term = () => {
    if (tokens[at] === '(') {
      at += 1;
      const inner = anyOf();
      at += 1;
      return inner;
    }
    const id = tokens[at++];
    if (tokens[at] === 'WITH') at += 2;
    return ofId(id);
  };
  const allOf = () => {
    const parts = [term()];
    while (tokens[at] === 'AND') { at += 1; parts.push(term()); }
    return worst(parts);
  };
  const anyOf = () => {
    const choices = [allOf()];
    while (tokens[at] === 'OR') { at += 1; choices.push(allOf()); }
    return best(choices);
  };
  return anyOf();
}

// Every installed package folder, scoped and nested ones included.
const packageDirs = (root, modules = 'node_modules') => {
  if (!existsSync(join(root, modules))) return [];
  return readdirSync(join(root, modules), { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .flatMap((e) => (e.name.startsWith('@')
      ? readdirSync(join(root, modules, e.name), { withFileTypes: true }).filter((s) => s.isDirectory()).map((s) => `${modules}/${e.name}/${s.name}`)
      : [`${modules}/${e.name}`]))
    .flatMap((dir) => [dir, ...packageDirs(root, `${dir}/node_modules`)]);
};

const RULES = {
  missing: { rule: 'G2.licence.missing', fix: 'Replace the dependency: without a licence it cannot be redistributed' },
  copyleft: { rule: 'G2.licence.copyleft', fix: 'Fine for a community plugin; a plugin Verified for products needs a review of the source obligations' },
  unknown: { rule: 'G2.licence.unknown', fix: 'Check the licence by hand, or use an SPDX identifier' },
};

/**
 * G2: the licence of every installed production dependency. Missing or proprietary blocks v2;
 * copyleft and unrecognised licences are warnings.
 * @param {string} dir the built package, after the production install
 * @param {'v1' | 'v2' | undefined} source
 */
export function licenceFindings(dir, source) {
  return packageDirs(dir)
    .toSorted()
    .filter((pkgDir) => existsSync(join(dir, pkgDir, 'package.json')))
    .flatMap((pkgDir) => {
      const pkg = JSON.parse(readFileSync(join(dir, pkgDir, 'package.json'), 'utf8'));
      const licence = pkg.license ?? pkg.licenses?.[0];
      const kind = classify(licence);
      if (kind === 'permissive') return [];
      const text = (typeof licence === 'object' && licence ? licence.type : licence) || 'no licence';
      return [{
        rule: RULES[kind].rule,
        severity: kind === 'missing' && source !== 'v1' ? 'error' : 'warning',
        file: `${pkgDir}/package.json`,
        message: `${pkg.name}@${pkg.version}: ${text}`,
        fix: RULES[kind].fix,
      }];
    });
}
