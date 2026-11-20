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

```bash
npm test
```
