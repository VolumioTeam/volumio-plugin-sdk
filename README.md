# @volumio/plugin-sdk

The Volumio plugin manifest v2 (`volumio-plugin.json`), its JSON Schema, and the `volumio-plugin` CLI.

```bash
npx volumio-plugin check [plugin-dir ...] [--built] [--json]
```

`check` runs gate G1 and exits 1 when any error is found. `--built` checks the package CI built rather than the source: a TypeScript source may keep `main` and i18n in a build folder, the built package may not. A folder without `volumio-plugin.json` is read through the v1 shim (`package.json` → `volumio_info`): the v2-only fields (`function`, `permissions`) show as `todo`, not as errors.

| Rule | Checks |
| --- | --- |
| `G1.schema` | The manifest against `schema/manifest.schema.json` |
| `G1.function` | `function` is in `registry/functions.json`, the closed registry moderators curate |
| `G1.engines` | `engines.volumio` is a semver range |
| `G1.file.readme` | A README exists |
| `G1.file.license` | A LICENSE file exists; a warning for v1 plugins, which state the licence in `package.json` |
| `G1.main` (`--built`) | `package.json` `main` is `index.js`, as the crypter needs |
| `G1.file.i18n` (`--built`) | `i18n/strings_en.json` exists |

## Function registry

`registry/functions.json` lists one entry per function: `id`, `title`, the one `plugin` kept, and the `duplicates` that move to Deprecated. `plugin: null` means Volumio has not picked one yet.

## G2: static checks

`check` also runs G2 on every JavaScript file (tests and `node_modules` excluded) and on `install.sh`.

| Rule | Checks |
| --- | --- |
| `G2.js.sync-exec` | No `execSync`, `execFileSync`, `spawnSync` |
| `G2.js.shell` | No `exec`, no `shell: true`: commands only as an argument list |
| `G2.js.process-exit`, `G2.js.global-handler` | No `process.exit` and no process-wide `uncaughtException`/`unhandledRejection` handlers, except in executables (shebang) |
| `G2.js.command-router-override` | No replacing `commandRouter` methods |
| `G2.js.console-log` | No `console.log` |
| `G2.shell.*` | `set -e`; no `|| true`; no package managers; no download without a `sha256sum` check; no sudoers |
| `G2.shellcheck.SC*` | ShellCheck warnings and errors, when `shellcheck` is installed (CI always has it) |

Inline `eslint-disable` comments are ignored. `registry/g2-baseline.json` holds the violations each published plugin has today: they show as one warning per rule and file, and any new one blocks. A v1 plugin with no baseline gets warnings; a v2 plugin gets errors. Regenerate it with `node scripts/g2-baseline.js <plugins-dir>`, using the ShellCheck version CI pins.

## Build

A plugin repository builds its release with the reusable workflow:

```yaml
jobs:
  build:
    uses: VolumioTeam/volumio-plugin-sdk/.github/workflows/build.yml@main
    with:
      path: .   # plugin folder inside the repository
```

It runs one build per architecture the manifest declares (`volumio-plugin arch`), each through `scripts/build.sh`, in the Volumio build container: Debian Bookworm, Node 20, ShellCheck from Bookworm, under QEMU for ARM. Run the same build locally with Docker:

```bash
scripts/build.sh <plugin-dir> <armhf|amd64|arm64> [out-dir]
```

`volumio-plugin package` copies the plugin without `.git`, `.github`, `node_modules` and test folders, installs the production dependencies (after `npm run build` when the plugin has one), runs G1 `--built` and G2 on the result, and writes:

- `<id>-<version>-<arch>.zip`: files at the root, sorted, one mtime (the commit time, or `SOURCE_DATE_EPOCH`), so the same commit gives the same bytes
- `<zip>.sha256`
- `<id>-<version>-<arch>.provenance.json`: source repository and commit, workflow run, SDK version, every gate finding

| Rule | Checks |
| --- | --- |
| `G3.native-arch` | Every `.node` module is built for the target architecture |
| `G3.lockfile` | `package-lock.json` is committed; a warning for v1 plugins |

## Signing

The store signs each release it accepts: `<zip>.sig` is a [DSSE](https://github.com/secure-systems-lab/dsse) envelope whose payload (`volumio.plugin.release/v1`) binds the zip's sha256 to the plugin id, version, architecture and source commit, signed with Ed25519. The device trusts two keys, the active one and the next, so rotating the key needs no device update. `src/sign.js` uses only Node's `crypto`, so the device verifies with the same code.

```bash
volumio-plugin sign <zip> --key <private.pem> --key-id <id>       # development key; the store signs with its KMS key
volumio-plugin verify <zip> --key <id>=<public.pem> [--key ...]
```

```bash
npm test
```
