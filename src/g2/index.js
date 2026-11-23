import { readFileSync } from 'node:fs';
import { lintDir } from './js.js';
import { shellDir } from './shell.js';
import { secretFindings } from './secrets.js';
import { applyBaseline } from './baseline.js';

export const BASELINE = JSON.parse(readFileSync(new URL('../../registry/g2-baseline.json', import.meta.url), 'utf8'));

/** Every G2 finding of a plugin, before the baseline is applied; apt: the packages in system.apt. */
export const rawG2 = (dir, apt) => [...lintDir(dir), ...shellDir(dir, apt), ...secretFindings(dir)];

/**
 * Gate G2 with the plugin's baseline applied.
 * @param {string} dir
 * @param {{ id?: string, source?: 'v1' | 'v2', apt?: string[] }} plugin
 * @param {Record<string, Record<string, number>>} [baseline]
 */
export const g2 = (dir, { id, source, apt }, baseline = BASELINE) => applyBaseline(rawG2(dir, apt), id && Object.hasOwn(baseline, id) ? baseline[id] : undefined, source);
