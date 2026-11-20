import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';

export const schema = JSON.parse(readFileSync(new URL('../schema/manifest.schema.json', import.meta.url), 'utf8'));

const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

/** @param {import('ajv').ErrorObject} e */
const pathOf = (e) => {
  if (e.keyword === 'required') return `${e.instancePath}/${e.params.missingProperty}`;
  if (e.keyword === 'additionalProperties') return `${e.instancePath}/${e.params.additionalProperty}`;
  return e.instancePath || '/';
};

/** @param {import('ajv').ErrorObject} e */
const messageOf = (e) => {
  if (e.keyword === 'required') return 'is missing';
  if (e.keyword === 'additionalProperties') return 'is not a v2 manifest field';
  if (e.keyword === 'enum') return `must be one of: ${e.params.allowedValues.join(', ')}`;
  return e.message ?? 'is invalid';
};

/**
 * Validates a v2 manifest. One error per path: anyOf branches would otherwise repeat it.
 * @param {unknown} manifest
 * @returns {Array<{ path: string, message: string }>}
 */
export function validateManifest(manifest) {
  if (validate(manifest)) return [];
  const byPath = new Map();
  for (const e of validate.errors ?? []) {
    const path = pathOf(e);
    if (!byPath.has(path)) byPath.set(path, { path, message: messageOf(e) });
  }
  return [...byPath.values()];
}
