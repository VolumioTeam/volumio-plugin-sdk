# {{title}}: instructions for coding agents

This folder is a Volumio plugin: id `{{id}}`, type `{{type}}`. The person you work for may not be a developer: tell them in plain words what you changed and why.

Before you write code, read `VOLUMIO_API.md`. It describes the plugin API that this plugin's Volumio runs (`engines.api` in `volumio-plugin.json`): what Volumio calls, what it expects back, and the mistakes that break a plugin on the device. This file stays the same from one API to the next; `VOLUMIO_API.md` is the part that changes.

## Files

| File | What it is |
| --- | --- |
| `volumio-plugin.json` | The manifest: id, version, title, permissions, system packages, hosts |
| `index.js` | The plugin: the class Volumio creates and calls |
| `UIConfig.json`, `config.json`, `i18n/` | The settings page, the saved values with their defaults, the text in each language |
| `install.sh`, `uninstall.sh` | Run as root on the device when the plugin is installed and removed |
| `test/` | Tests that run the plugin against a fake Volumio (`test/volumio.js`) |

`package.json` holds dependencies and scripts only. Never set its `name`, `version` or `volumio_info`: the build writes them from `volumio-plugin.json`.

## After every change

```bash
npm test
npx --package=@volumio/plugin-sdk volumio-plugin check .
```

Both must pass before you say the work is done. `check` runs the gates the store runs on every submission, and each finding comes with a `fix:` line. Fix the code, never the check: inline `eslint-disable` comments, `# shellcheck disable` directives and `.shellcheckrc` are ignored.

Add a test in `test/` for each behaviour you add. When the plugin calls a part of Volumio the fake does not have, add it to `test/volumio.js`, following `VOLUMIO_API.md`.

## Try it on a Volumio

```bash
npx --package=@volumio/plugin-sdk volumio-plugin deploy <device> .
npx --package=@volumio/plugin-sdk volumio-plugin logs <device> --seconds 30
```

`<device>` is the address of a Volumio on the same network, such as `volumio.local` or `192.168.1.20`: ask the person for it. `deploy` builds the plugin, installs it, starts it, and prints what the device logged meanwhile; read that log when something fails. When the plugin is already on the device, `deploy` reboots the device to load the new code, which stops the music for a minute or two: ask the person before the first deploy. `logs` prints the device's log as it is written. Both need Node 22 or later.

## Rules the gates enforce

- Log with `this.logger`, never `console.log`.
- Run a program with `execFile` or `spawn` and its arguments as a list. No `exec`, no `shell: true`, no `execSync` or `spawnSync`.
- No `process.exit` and no process-wide error handlers (`uncaughtException`, `unhandledRejection`).
- Never replace a Volumio method (`this.commandRouter.something = ...`).
- No secrets in any file: no API keys, tokens or private keys. A key the service needs is typed by the user in the settings page.
- `install.sh` runs with `sh` (dash) as root: POSIX shell only, `set -e`, no `pipefail`, no `|| true`. Install a system package only as `apt-get install -y <package>`, each package named in full and listed in `system.apt` in `volumio-plugin.json`. No npm, pip or dpkg there. Check every download with `sha256sum -c`. Never touch sudoers.
- Every production dependency has a licence and no high or critical `npm audit` advisory.

## Keep the plugin honest

- List in `network`, in `volumio-plugin.json`, every host the plugin connects to, streams included (`stream.example.com`, or `*.example.com` for a family of hosts). Volumio does not block other hosts: the list tells users and reviewers what the plugin talks to. Tell the person which hosts you added.
- Text the user sees is never written in code: it is a key in `i18n/strings_en.json`, in English, with the same key in `i18n/strings_<language>.json` for each other language, such as `strings_it.json`.

## Ask the person first

- Before you add an entry to `permissions` or `system` in `volumio-plugin.json`: each one widens what the plugin does on the user's device, and reviewers check it.
- Before you add a dependency: prefer what Node and Volumio already provide.
- Before you remove or weaken a test.

The manifest takes no other fields: the schema rejects them. Raise `version` (semver) for each release.
