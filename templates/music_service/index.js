'use strict';

const fs = require('fs');
const path = require('path');
const libQ = require('kew');

// Volumio's own copy, as every plugin on the device uses; the tests use the devDependency.
const volumioModule = (name) => {
  try {
    return require(`/volumio/node_modules/${name}`);
  } catch {
    return require(name);
  }
};
const VConf = volumioModule('v-conf');

// What the plugin offers. Replace it with calls to your service.
const catalog = require('./catalog.json');

// Every URI the plugin hands to Volumio starts with this. Volumio sends Browse to the
// first source whose URI starts the requested one, so no other source's URI may start it.
const ROOT = '{{id}}';
const trackUri = (track) => `${ROOT}/track/${track.id}`;

// Volumio creates one instance with `new` and calls the methods below.
// Every method Volumio calls returns a kew promise (libQ): Volumio rejects
// async functions and native Promises ("does not return adequate promise").
module.exports = class {{className}} {
  constructor(context) {
    this.context = context;
    this.commandRouter = context.coreCommand;
    this.logger = context.logger;
  }

  // Volumio copies these files to /data/configuration/<type>/<id>/ on first start.
  getConfigurationFiles() {
    return ['config.json'];
  }

  onVolumioStart() {
    this.config = new VConf();
    this.config.loadFile(this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json'));
    return libQ.resolve();
  }

  onStart() {
    this.strings = this.loadStrings();
    this.logger.info(`{{id}}: ${this.config.get('greeting')}`);
    this.commandRouter.volumioAddToBrowseSources(this.browseSource());
    return libQ.resolve();
  }

  onStop() {
    this.commandRouter.volumioRemoveToBrowseSources(this.browseSource().name);
    return libQ.resolve();
  }

  // The plugin's entry in Volumio's Browse page.
  browseSource() {
    return { name: this.strings.PLUGIN_NAME, uri: ROOT, plugin_type: 'music_service', plugin_name: '{{id}}' };
  }

  // Browse: the lists to show for a URI.
  handleBrowseUri(uri) {
    if (uri !== ROOT) return libQ.reject(new Error(`{{id}}: no page for ${uri}`));
    return libQ.resolve({
      navigation: {
        prev: { uri: '/' },
        lists: [{ availableListViews: ['list', 'grid'], items: catalog.map((track) => this.listItem(track)) }],
      },
    });
  }

  // Play: what a URI plays. service 'mpd' hands the stream URL to MPD, which then
  // handles pause, stop and seek; the plugin needs no playback code of its own.
  explodeUri(uri) {
    const track = catalog.find((t) => trackUri(t) === uri);
    if (!track) return libQ.reject(new Error(`{{id}}: nothing plays ${uri}`));
    const { title, artist, album } = track;
    return libQ.resolve({ service: 'mpd', type: 'track', uri: track.url, name: title, title, artist, album });
  }

  // Search: Volumio asks every source at once. Resolve null when nothing matches and
  // on any error: never reject, or the whole search may fail.
  search(query) {
    const value = String(query?.value ?? '').toLowerCase();
    const found = value ? catalog.filter((t) => [t.title, t.artist, t.album].some((f) => f.toLowerCase().includes(value))) : [];
    if (!found.length) return libQ.resolve(null);
    return libQ.resolve({ title: this.strings.PLUGIN_NAME, availableListViews: ['list', 'grid'], items: found.map((t) => this.listItem(t)) });
  }

  listItem(track) {
    const { title, artist, album } = track;
    return { service: '{{id}}', type: 'song', title, artist, album, icon: 'fa fa-music', uri: trackUri(track) };
  }

  // The settings page: UIConfig.json, translated, with the saved values filled in.
  getUIConfig() {
    const lang = this.commandRouter.sharedVars.get('language_code');
    return this.commandRouter
      .i18nJson(this.file(`i18n/strings_${lang}.json`), this.file('i18n/strings_en.json'), this.file('UIConfig.json'))
      .then((uiconf) => {
        uiconf.sections[0].content[0].value = this.config.get('greeting');
        return uiconf;
      });
  }

  // Called by the Save button of the settings page (onSave in UIConfig.json).
  saveSettings(data) {
    this.config.set('greeting', data.greeting);
    this.commandRouter.pushToastMessage('success', this.strings.PLUGIN_NAME, this.strings.SAVED);
    return libQ.resolve();
  }

  // The plugin's own strings in the user's language, English for any missing key.
  loadStrings() {
    const read = (lang) => {
      try {
        return JSON.parse(fs.readFileSync(this.file(`i18n/strings_${lang}.json`), 'utf8'));
      } catch {
        return {};
      }
    };
    return { ...read('en'), ...read(this.commandRouter.sharedVars.get('language_code')) };
  }

  file(name) {
    return path.join(__dirname, name);
  }
};
