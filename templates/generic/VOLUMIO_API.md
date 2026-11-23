# Volumio plugin API 1

How Volumio 4 runs a plugin whose manifest says `"engines": { "api": "1" }`: what it calls, what it expects back, and the mistakes that break a plugin on the device. A plugin written for a later API comes with its own version of this file; `AGENTS.md` stays the same.

## The plugin

- `index.js` exports a class. Volumio creates one instance, `new Plugin(context)`, and keeps it while the device runs.
- `context.coreCommand` is Volumio's command router (`this.commandRouter` in the template), `context.logger` its log.
- Node 20.5, CommonJS (`require`). Code that needs a build step keeps the built `index.js` at the package root.
- The plugin lives in `/data/plugins/<type>/<id>/`, its saved settings in `/data/configuration/<type>/<id>/config.json`.
- `v-conf` comes from Volumio's own copy, `/volumio/node_modules/v-conf`, as in the template; other dependencies go in `package.json`.

## Promises: kew only

Every method Volumio calls returns a kew promise (`const libQ = require('kew')`): `libQ.resolve(value)`, `libQ.reject(error)`, or `libQ.defer()` and its `promise`.

- Volumio checks the type of what each lifecycle method returns. An `async` method or a native `Promise` fails that check: the log says "does not return adequate promise" and an `onStart` that fails it leaves the plugin FAILED. Write these methods as plain functions.
- Volumio chains `.then` and `.fail` on what other methods return; a native `Promise` has no `.fail` and throws there.
- kew promises have `.then`, `.fail` and `.fin`, no `.catch`.
- `async` functions are fine inside the plugin. Turn their result into a kew promise where Volumio calls in:

  ```js
  onStart() {
    const defer = libQ.defer();
    this.connect().then(defer.resolve, defer.reject);
    return defer.promise;
  }
  ```

- Wait on a promise or an event, not on a timer. A timer or child process the plugin starts, `onStop` stops.

## Lifecycle

| Method | Volumio calls it | Returns |
| --- | --- | --- |
| `constructor(context)` | When Volumio loads an enabled plugin: at boot, or when the user enables it | Keeps `context`; does no work |
| `getConfigurationFiles()` | Before `onVolumioStart` | `['config.json']`, not a promise: Volumio copies it to the configuration folder the first time |
| `onVolumioStart()` | Right after loading | kew promise; loads the configuration |
| `onStart()` | After `onVolumioStart` | kew promise; starts the plugin's work |
| `onStop()` | When the plugin is disabled | kew promise; undoes everything `onStart` did |
| `onVolumioShutdown()`, `onVolumioReboot()` | Optional, before power off and reboot | kew promise |
| `getUIConfig()` | When the settings page opens | kew promise of the page |
| The `method` of a section's `onSave` | When the user presses Save | kew promise; gets `{ <field id>: value }` for the ids in `saveButton.data` |

At boot Volumio waits at most 30 seconds for all plugins' `onVolumioStart`, then for all `onStart`, and then goes on without the slow ones. Resolve quickly and do long work afterwards.

## Settings

- `config.json` holds each setting with its type and default: `{ "greeting": { "type": "string", "value": "Hello" } }`.
- Load it with `v-conf` in `onVolumioStart`, from `this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json')`. `this.config.get(key)` reads, `this.config.set(key, value)` writes and saves.
- `UIConfig.json` is the settings page: `sections`, each with `content` fields, an `onSave` of `{ "type": "controller", "endpoint": "<type>/<id>", "method": "<method>" }` and a `saveButton` with the field ids to send.
- Text is a key, `"TRANSLATE.GREETING"`, looked up in `i18n/strings_<language>.json`, English when a key is missing. `getUIConfig` builds the page with `this.commandRouter.i18nJson(<language file>, <English file>, <UIConfig.json>)` and fills in the saved values.

## Calling Volumio

Through `this.commandRouter`. Only these are covered by this contract:

| Call | Does |
| --- | --- |
| `pushToastMessage(type, title, message)` | Shows a notification: `success`, `info`, `warning` or `error` |
| `sharedVars.get('language_code')` | The user's language, as `en` |
| `pluginManager.getConfigurationFile(context, name)` | Where a configuration file lives |
| `i18nJson(languageFile, englishFile, jsonFile)` | A kew promise of `jsonFile` with its `TRANSLATE.` keys translated |
| `executeOnPlugin(type, id, method, data)` | Calls a method of another plugin; `undefined` when it is not installed |
| `broadcastMessage(event, payload)` | Sends a message to every open Volumio UI |
| `volumioAddToBrowseSources(source)`, `volumioRemoveToBrowseSources(name)` | A `music_service`'s entry in Browse |
| `servicePushState(state, id)` | A `music_service` that plays by itself tells Volumio what it plays |

Never assign to a `commandRouter` method, and never `require` Volumio's own files.

## music_service

### Browse

- `onStart` adds `{ name, uri, plugin_type: 'music_service', plugin_name: '<id>' }` with `volumioAddToBrowseSources`; `onStop` removes it by `name`.
- Every URI the plugin hands out starts with `music_service/<id>`. Volumio sends a Browse request to the first source whose `uri` starts the requested URI, after its own: favourites, playlists, search, `artists://`, `albums://`, `genres://`, upnp, radio. A root that is only the id can lose its pages to them.
- `handleBrowseUri(uri)` resolves `{ navigation: { prev: { uri }, lists: [{ title, availableListViews: ['list', 'grid'], items }] } }`. An item: `{ service: '<id>', type, title, artist, album, albumart or icon, uri }`; `type` `folder` opens with another `handleBrowseUri`, `song` plays. An unknown URI rejects.

### Play

- `explodeUri(uri)` resolves a list of tracks, even for one track: the queue adds them all, Favourites reads the first.
- A track `{ service: 'mpd', type: 'track', uri: <stream URL>, name, title, artist, album, albumart }` hands playback to MPD, which then handles pause, stop and seek. Use it whenever the service gives a stream URL.
- A plugin that plays by itself sets `service: '<id>'` and implements `clearAddPlayTrack(track)`, `stop()`, `pause()`, `resume()` and `seek(milliseconds)`, each returning a kew promise, and reports every change of state with `servicePushState`.

### Search

- `search({ value })` resolves `null` when nothing matches, or one list `{ title, availableListViews, items }` with items as in Browse.
- Never reject and never throw: Volumio searches every source together, and one failure can lose the whole result. On an error, log it and resolve `null`.
- Volumio stops waiting after 5 seconds.
