// G4 install run: installs a plugin package in the sandbox image the way the backend's
// doInstallPlugin does, then hands what changed to g4(). Needs Docker and the image that
// scripts/sandbox-image.sh builds. Starting the plugin and watching its network come later:
// they need the backend running, so systemd booting in the container.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load } from './check.js';
import { g4, parseDiff } from './g4.js';

export const SANDBOX_IMAGE = 'volumio-sandbox:4.245-amd64';
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const LOG_LINES = 10;

const run = (cmd, args, options = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
const must = (cmd, args) => {
  const r = run(cmd, args);
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0, 2).join(' ')} failed: ${r.stderr.trim()}`);
  return r.stdout;
};
const lines = (text) => text.split('\n').filter(Boolean);
const tail = (r) => lines(`${r.stdout ?? ''}${r.stderr ?? ''}`).slice(-LOG_LINES).join('\n');

const installFinding = (r, timeout) => {
  const error = (message) => ({ rule: 'G4.install', severity: 'error', message, fix: 'Run install.sh in the sandbox and read its output' });
  if (r.error?.code === 'ETIMEDOUT') return error(`install.sh did not finish in ${timeout / 1000} s`);
  if (r.error) throw r.error;
  return r.status === 0 ? undefined : error(`install.sh exited with ${r.status}\n${tail(r)}`);
};

/**
 * Installs the package in a fresh sandbox container and judges the result with G4.
 * @param {string} zip  the amd64 package built by `volumio-plugin package`
 * @returns {{ id?: string, source?: string, findings: object[] }}
 */
export function sandboxInstall(zip, { image = SANDBOX_IMAGE, timeout = INSTALL_TIMEOUT_MS } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'volumio-g4-'));
  const name = `volumio-g4-${process.pid}-${Date.now()}`;
  try {
    must('unzip', ['-q', zip, '-d', dir]);
    const loaded = load(dir);
    if (loaded.failure) return { findings: [loaded.failure] };
    const { manifest, source } = loaded;
    const result = (findings) => ({ id: manifest.id, source, findings });
    // The backend refuses a plugin without install.sh (executeInstallationScript).
    if (!existsSync(join(dir, 'install.sh'))) {
      return result([{ rule: 'G4.install', severity: 'error', message: 'install.sh is missing: Volumio refuses the install', fix: 'Add an install.sh, even an empty one' }]);
    }
    const home = `/data/plugins/${manifest.type}/${manifest.id}`;
    must('docker', ['run', '-d', '--name', name, '--platform', 'linux/amd64', image, 'sleep', 'infinity']);
    const packages = () => lines(must('docker', ['exec', name, 'dpkg-query', '-W', '-f', '${Package}\\n']));
    const before = packages();

    must('docker', ['exec', name, 'mkdir', '-p', home]);
    must('docker', ['cp', `${dir}/.`, `${name}:${home}`]);
    must('docker', ['exec', name, 'chown', '-R', 'volumio:volumio', '/data/plugins']);
    // As the backend runs it: uid volumio, the backend's folder, sh (dash), sudo with the stock password.
    const install = run('docker', ['exec', '-u', 'volumio', '-w', '/volumio', name, 'sh', '-c', `echo volumio | sudo -S sh ${home}/install.sh`], { timeout });
    const failed = installFinding(install, timeout);

    const added = packages().filter((p) => !before.includes(p));
    const packageFiles = added.length ? lines(must('docker', ['exec', name, 'dpkg', '-L', ...added])) : [];
    const changes = parseDiff(must('docker', ['diff', name]));
    return result([...(failed ? [failed] : []), ...g4(manifest, { changes, packages: added, packageFiles, hosts: [] }, { source })]);
  } finally {
    run('docker', ['rm', '-f', name]);
    rmSync(dir, { recursive: true, force: true });
  }
}
