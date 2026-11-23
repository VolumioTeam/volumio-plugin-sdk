// `volumio-plugin init`: a new plugin from a template, ready to pass every check.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest } from './manifest.js';
import { files } from './package.js';

const TEMPLATES = new URL('../templates/', import.meta.url);
export const TEMPLATE_NAMES = ['generic'];

// "my_radio" -> "MyRadio", "80s_radio" -> "Plugin80sRadio": the class name in index.js.
const classNameOf = (id) => {
  const name = id.split('_').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  return /^[A-Za-z]/.test(name) ? name : `Plugin${name}`;
};

/**
 * Writes a new plugin into dir, which must not exist or be empty.
 * @param {string} dir
 * @param {{ id: string, type: string, function: string, title: string, description: string, author?: string, template?: string }} options
 * @returns {string[]} the files written, relative to dir
 */
export function initPlugin(dir, { id, type, function: fn, title, description, author, template = 'generic' }) {
  if (!TEMPLATE_NAMES.includes(template)) throw new Error(`Unknown template "${template}": ${TEMPLATE_NAMES.join(', ')}`);
  if (existsSync(dir) && readdirSync(dir).length) throw new Error(`${dir} is not empty`);
  const values = {
    id, type, function: fn, title, description,
    author: author || `The ${title} authors`,
    className: classNameOf(id),
    year: String(new Date().getUTCFullYear()),
  };
  // The manifest is the template's, filled in: reject bad values before writing anything.
  const source = fileURLToPath(new URL(`${template}/`, TEMPLATES));
  const manifest = JSON.parse(fill(readFileSync(join(source, 'volumio-plugin.json'), 'utf8'), values, true));
  const errors = validateManifest(manifest);
  if (errors.length) throw new Error(errors.map((e) => `${e.path.slice(1) || 'manifest'} ${e.message}`).join('\n'));

  mkdirSync(dir, { recursive: true });
  cpSync(source, dir, { recursive: true });
  // npm drops .gitignore from published packages, so the template keeps it without the dot.
  renameSync(join(dir, 'gitignore'), join(dir, '.gitignore'));
  const written = files(dir);
  for (const file of written) {
    const path = join(dir, file);
    writeFileSync(path, fill(readFileSync(path, 'utf8'), values, file.endsWith('.json')));
  }
  return written.sort();
}

// {{name}} -> value; inside JSON the value is escaped as a JSON string.
const fill = (text, values, json) =>
  text.replace(/\{\{(\w+)\}\}/g, (match, name) => {
    if (!(name in values)) return match;
    return json ? JSON.stringify(values[name]).slice(1, -1) : values[name];
  });
