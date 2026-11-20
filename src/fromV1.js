// volumio_info field -> v2 field. Every other volumio_info field is reported as dropped.
const RENAMED = { prettyName: 'title', details: 'description', icon: 'icon', changelog: 'changelog', boot_priority: 'bootPriority' };
const MAPPED = new Set(['plugin_type', 'architectures', ...Object.keys(RENAMED)]);

// Fields v1 cannot provide: the author adds them when moving to v2.
const V2_ONLY = ['function', 'permissions'];

const defined = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

/**
 * Reads a v1 package.json as a v2 manifest, without inventing missing values.
 * @param {{ name?: string, version?: string, license?: string, engines?: { volumio?: string }, volumio_info?: Record<string, unknown> }} pkg
 * @returns {{ manifest: Record<string, unknown>, todo: string[], dropped: string[] }}
 */
export function fromV1(pkg) {
  const info = pkg.volumio_info ?? {};
  const manifest = defined({
    id: pkg.name,
    version: pkg.version,
    type: info.plugin_type,
    ...Object.fromEntries(Object.entries(RENAMED).map(([from, to]) => [to, info[from]])),
    engines: defined({ volumio: pkg.engines?.volumio, api: '2' }),
    arch: Array.isArray(info.architectures) ? [...info.architectures] : info.architectures,
    license: pkg.license,
  });
  return {
    manifest,
    todo: [...V2_ONLY],
    dropped: Object.keys(info).filter((k) => !MAPPED.has(k)),
  };
}
