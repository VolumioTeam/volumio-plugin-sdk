import { readFileSync } from 'node:fs';
import { lintDir } from './js.js';
import { shellDir } from './shell.js';
import { applyBaseline } from './baseline.js';

export const BASELINE = JSON.parse(readFileSync(new URL('../../registry/g2-baseline.json', import.meta.url), 'utf8'));

/** Every G2 finding of a plugin, before the baseline is applied. */
export const rawG2 = (dir) => [...lintDir(dir), ...shellDir(dir)];

/**
 * Gate G2 with the plugin's baseline applied.
 * @param {string} dir
 * @param {{ id?: string, source?: 'v1' | 'v2' }} plugin
 * @param {Record<string, Record<string, number>>} [baseline]
 */
export const g2 = (dir, { id, source }, baseline = BASELINE) => applyBaseline(rawG2(dir), id ? baseline[id] : undefined, source);
