const keyOf = (f) => `${f.rule}|${f.file}`;

// Local accumulator: a plugin can have thousands of findings, copying per step would be quadratic.
const groupByKey = (findings) => {
  const groups = new Map();
  for (const f of findings) {
    const group = groups.get(keyOf(f));
    if (group) group.push(f);
    else groups.set(keyOf(f), [f]);
  }
  return groups;
};

/** @param {Array<{ rule: string, file: string }>} findings @returns {Record<string, number>} */
export const countByKey = (findings) =>
  Object.fromEntries([...groupByKey(findings)].map(([key, group]) => [key, group.length]));

/**
 * Known violations (within the plugin's baseline count for that rule and file) become one warning;
 * any rule and file over its count blocks. With no baseline, v1 plugins are in their grace period.
 * @param {Array<{ rule: string, file: string, severity: string, message: string }>} findings
 * @param {Record<string, number> | undefined} baseline
 * @param {'v1' | 'v2' | undefined} source
 */
export function applyBaseline(findings, baseline, source) {
  if (!baseline) return findings.map((f) => ({ ...f, severity: source === 'v1' ? 'warning' : 'error' }));
  return [...groupByKey(findings)].flatMap(([key, group]) =>
    group.length <= (baseline[key] ?? 0)
      ? [{ rule: group[0].rule, severity: 'warning', file: group[0].file, message: `${group.length} known (baseline)` }]
      : group.map((f) => ({ ...f, severity: 'error' })));
}
