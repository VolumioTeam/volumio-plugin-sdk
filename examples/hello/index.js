'use strict';

const libQ = require('kew');

module.exports = HelloVolumio;

function HelloVolumio(context) {
  this.context = context;
  this.logger = context.logger;
}

HelloVolumio.prototype.onVolumioStart = function () {
  return libQ.resolve();
};

HelloVolumio.prototype.onStart = function () {
  this.logger.info('Hello from hello_volumio');
  return libQ.resolve();
};

HelloVolumio.prototype.onStop = function () {
  return libQ.resolve();
};
