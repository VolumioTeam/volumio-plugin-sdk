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
    return libQ.resolve();
  }

  onStop() {
    return libQ.resolve();
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
