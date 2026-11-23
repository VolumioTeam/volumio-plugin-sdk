# @volumio/plugin-sdk

The Volumio plugin manifest v2 (`volumio-plugin.json`), its JSON Schema, and the `volumio-plugin` CLI.

## A new plugin

```bash
npx --package=@volumio/plugin-sdk volumio-plugin init <dir> --id <id> --type <type> --function <function> --title <title> --description <text>
```

`init` writes a plugin that runs on today's Volumio and passes every check: `volumio-plugin.json`, `index.js` (the lifecycle methods Volumio calls, each returning a kew promise), a settings page (`UIConfig.json`, `config.json`, `i18n/`), `install.sh`, tests against a fake Volumio (`npm test`), README and LICENSE (MIT). A `music_service` plugin also gets Browse, play and search: `catalog.json` holds placeholder tracks for the developer to replace with their service, `explodeUri` hands each stream URL to MPD, which then handles pause, stop and seek. Its settings page sets the name shown in Browse, and it declares the `browse-source` and `playback` permissions. Then `init` runs `npm install`, which writes the `package-lock.json` the build needs (`--skip-install` to leave it out).

### Coding agents

Every new plugin carries instructions for coding agents, so that someone who does not write code can build a plugin by asking one:

- `AGENTS.md`: the files, the commands to run after each change (`npm test`, `check`), the rules the gates enforce, what to ask the person before doing. Codex, Cursor and Copilot read it; `CLAUDE.md` loads it for Claude Code.
- `VOLUMIO_API.md`: the plugin API Volumio runs today (`engines.api` `"1"`): the lifecycle, kew promises, settings, the calls into Volumio, and Browse, play and search for a `music_service`.

`AGENTS.md` stays the same across plugin APIs. `VOLUMIO_API.md` is the one file that changes with the API: a test fails when the schema's `engines.api` and the file's title disagree.

The developer edits only `volumio-plugin.json`: `package` writes `name`, `version`, `description`, `license`, `engines.volumio` and `volumio_info` into the `package.json` that ships, which is what Volumio reads today. `engines.api` is `"1"`: the code follows the plugin API Volumio runs today; `"2"` is kept for framework v2.

## Checks

```bash
npx --package=@volumio/plugin-sdk volumio-plugin check [plugin-dir ...] [--built] [--json]
```

`check` runs gate G1 and exits 1 when any error is found. `--built` checks the package CI built rather than the source: a TypeScript source may keep `main` and i18n in a build folder, the built package may not. A folder without `volumio-plugin.json` is read through the v1 shim (`package.json` → `volumio_info`): the v2-only fields (`function`, `permissions`) show as `todo`, not as errors.

| Rule | Checks |
| --- | --- |
| `G1.schema` | The manifest against `schema/manifest.schema.json` |
| `G1.function` | `function` is in `registry/functions.json`, the closed registry moderators curate |
| `G1.engines` | `engines.volumio` is a semver range |
| `G1.file.readme` | A README exists |
| `G1.package-json` | A v2 source's `package.json` sets no `name`, `version` or `volumio_info`: `package` generates them from the manifest |
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
| `G2.shell.*` | `set -e` in the script; no `pipefail`; no `\|\| true`; no package managers, except `apt-get install` of the packages `system.apt` declares, named one by one (no variables, no local `.deb`); no download without a `sha256sum` check; no sudoers. Volumio runs `install.sh` with `sh` (dash): the shebang is ignored, so a `-e` there does not count, and dash has no `pipefail` |
| `G2.shellcheck.SC*` | ShellCheck warnings and errors, checked as dash, when `shellcheck` is installed (CI always has it) |
| `G2.secret` | No private key or service token (AWS, GitHub, Slack, Google API, Stripe) in the plugin's files; the finding names the kind, never the secret |
| `G2.secret.*` | gitleaks' default rules on the lines the built-in patterns did not flag, when `gitleaks` is installed (CI always has it). The plugin's `.gitleaks.toml`, `.gitleaksignore` and `gitleaks:allow` comments are ignored |
| `G2.audit` (`package`) | No high or critical `npm audit` advisory on the production dependencies; a warning for v1, and a warning when the audit cannot run |
| `G2.licence` (`package`) | Every production dependency has a licence: none, `UNLICENSED` or `SEE LICENSE IN` is an error (a warning for v1); copyleft (GPL, LGPL, AGPL) and unrecognised licences are warnings |

Inline `eslint-disable` comments, `# shellcheck` directives and `.shellcheckrc` are ignored: a plugin cannot switch a check off. `registry/g2-baseline.json` holds the violations each published plugin has today: they show as one warning per rule and file, and any new one blocks. A v1 plugin with no baseline gets warnings; a v2 plugin gets errors. Regenerate it with `node scripts/g2-baseline.js <plugins-dir>`, in the build container, which has the ShellCheck and gitleaks versions CI pins (`scripts/install-tools.sh`).

## Build

A plugin repository builds its release with the reusable workflow:

```yaml
jobs:
  build:
    uses: VolumioTeam/volumio-plugin-sdk/.github/workflows/build.yml@v0.2.0
    with:
      path: .   # plugin folder inside the repository
```

It runs one build per architecture the manifest declares (`volumio-plugin arch`), each through `scripts/build.sh`, in the Volumio build container: Debian Bookworm, Node 20, ShellCheck from Bookworm, gitleaks pinned by version and sha256, under QEMU for ARM. Run the same build locally with Docker:

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

The store signs each release it accepts: `<zip>.sig` is a [DSSE](https://github.com/secure-systems-lab/dsse) envelope whose payload (`volumio.plugin.release/v1`) binds the zip's sha256 to the plugin id, version, architecture and source commit, signed with Ed25519. The device trusts two keys, the active one and the next, so rotating the key needs no device update. `src/sign.js` (`@volumio/plugin-sdk/sign`) uses only Node's `crypto`; the device verifier follows it and is tested against envelopes it signs. Key ids use letters, digits, dot, dash and underscore.

```bash
volumio-plugin sign <zip> --key <private.pem> --key-id <id>       # development key; the store signs with its KMS key
volumio-plugin verify <zip> --key <id>=<public.pem> [--key ...]
```

## Releasing

Bump `version` in `package.json` and the `sdk-ref` default in `.github/workflows/build.yml` together (a test fails otherwise), merge, then tag `v<version>` on `main`. Release tags cannot be moved or deleted. Plugin repositories call the workflow at a tag, never at `main`; actions are pinned by commit and the build image by digest.

```bash
npm test
```
