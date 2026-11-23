// G4: compares what a plugin did in the sandbox with what its manifest declares.
// Pure: the sandbox run collects the observations, this only judges them.

/**
 * @typedef {{ kind: 'A' | 'C' | 'D', path: string }} Change   one line of `docker diff`
 * @typedef {{ changes: Change[], packages: string[], packageFiles: string[], hosts: string[] }} Observation
 */

const UNIT_DIRS = ['/etc/systemd/system', '/lib/systemd/system', '/usr/lib/systemd/system'];
// A unit file, its enable symlink in *.wants, or a drop-in folder (mpd.service.d) that changes it.
const UNIT = /^(.+\.(service|timer|socket))(\.d)?$/;
// Paths that change on every install whatever the plugin is; apt's own state is judged by G4.apt.
// ponytail: fixed list, grows with what real runs show; the baseline run removes the backend's own noise.
const ALWAYS = ['/tmp', '/var/tmp', '/run', '/var/log', '/data/temp', '/data/configuration/plugins.json',
  '/var/lib/apt', '/var/cache/apt', '/var/lib/dpkg', '/var/cache/debconf', '/var/cache/ldconfig', '/etc/ld.so.cache'];

/** Parses `docker diff` output. */
export const parseDiff = (text) =>
  text.split('\n').filter(Boolean).map((line) => ({ kind: /** @type {Change['kind']} */ (line[0]), path: line.slice(2) }));

const under = (path, root) => path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`);
const underAny = (path, roots) => roots.some((root) => under(path, root));
// *.example.com covers every subdomain, not example.com itself.
const hostMatches = (host, pattern) => (pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) : host === pattern);
const minus = (list, baseline = []) => list.filter((x) => !baseline.includes(x));

// docker diff marks every parent of a change as changed (C): keep only real changes.
const leaves = (changes) =>
  changes.filter((c) => c.kind !== 'C' || !changes.some((o) => o !== c && under(o.path, c.path)));
// One finding for a new folder, not one per file inside it.
const topmost = (paths) => paths.filter((p) => !paths.some((o) => o !== p && under(p, o)));

const unitsOf = (paths) =>
  [...new Set(paths.filter((p) => underAny(p, UNIT_DIRS)).flatMap((p) => p.split('/').map((s) => s.match(UNIT)?.[1]).filter(Boolean)))];

/**
 * @param {Record<string, any>} manifest  v2 manifest, or the v1 shim's
 * @param {Observation} run               the sandbox with the plugin installed and started
 * @param {{ source?: 'v1' | 'v2', baseline?: Observation }} [options]  baseline: the same sandbox without the plugin
 */
export function g4(manifest, run, { source = 'v2', baseline } = {}) {
  const severity = source === 'v1' ? 'warning' : 'error';
  const finding = (rule, message, fix, path) => ({ rule, severity, message, fix, ...(path && { path }) });
  const declared = { network: [], ...manifest, system: { apt: [], services: [], writes: [], ...manifest.system } };
  const own = [`/data/plugins/${manifest.type}/${manifest.id}`, `/data/configuration/${manifest.type}/${manifest.id}`];

  const changed = minus(leaves(run.changes).map((c) => c.path), baseline && leaves(baseline.changes).map((c) => c.path));
  const units = unitsOf(changed);
  const packages = minus(run.packages, baseline?.packages);
  const hosts = minus(run.hosts, baseline?.hosts);

  // Units are judged by G4.service, so the systemd folders are left out of G4.write.
  const allowed = [...own, ...ALWAYS, ...UNIT_DIRS, ...declared.system.writes];
  // A folder created on the way to an allowed path (/data/plugins/<type>) is part of it.
  const writes = topmost(changed.filter((p) =>
    !underAny(p, allowed) && !allowed.some((root) => under(root, p)) && !run.packageFiles.includes(p)));

  return [
    ...packages.filter((p) => !declared.system.apt.includes(p)).map((p) =>
      finding('G4.apt', `installs the package ${p}`, 'Add it to system.apt')),
    ...units.filter((u) => !declared.system.services.includes(u)).map((u) =>
      finding('G4.service', `adds or changes the systemd unit ${u}`, 'Add it to system.services')),
    ...writes.map((p) =>
      finding('G4.write', `writes ${p}`, 'Add the path to system.writes, or keep the files in the plugin folder', p)),
    ...hosts.filter((h) => !declared.network.some((pattern) => hostMatches(h, pattern))).map((h) =>
      finding('G4.network', `contacts ${h}`, 'Add the host to network')),
  ];
}
