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

```bash
npm test
```
