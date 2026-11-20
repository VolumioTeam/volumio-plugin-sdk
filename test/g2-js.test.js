import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintSource } from '../src/g2/js.js';

const rules = (code, file = 'index.js') => lintSource(code, file).map((f) => `${f.rule}:${f.line}`);

test('execSync blocks the backend', () => {
  assert.deepEqual(rules("var execSync = require('child_process').execSync;\nexecSync('ls');"), ['G2.js.sync-exec:2']);
});

test('exec from a destructured require runs a shell', () => {
  assert.deepEqual(rules("const { exec } = require('child_process');\nexec('ls');"), ['G2.js.shell:2']);
});

test('a call on the module binding is caught', () => {
  assert.deepEqual(rules("const cp = require('node:child_process');\ncp.spawnSync('ls', []);"), ['G2.js.sync-exec:2']);
});

test('spawn with shell: true runs a shell; with an argument list it does not', () => {
  const code = "const { spawn } = require('child_process');\nspawn('ls', ['-l'], { shell: true });\nspawn('ls', ['-l']);";
  assert.deepEqual(rules(code), ['G2.js.shell:2']);
});

test('RegExp exec is not child_process', () => {
  assert.deepEqual(rules("const m = /a/.exec('a');\nconst re = /b/; re.exec('b');"), []);
});

test('ES module imports are tracked', () => {
  assert.deepEqual(rules("import { execSync } from 'node:child_process';\nexecSync('ls');", 'index.mjs'), ['G2.js.sync-exec:2']);
});

test('process.exit and process-wide error handlers', () => {
  const code = "process.on('uncaughtException', () => {});\nprocess.on('SIGTERM', () => {});\nprocess.exit(1);";
  assert.deepEqual(rules(code), ['G2.js.global-handler:1', 'G2.js.process-exit:3']);
});

test('replacing a commandRouter method; assigning commandRouter itself is fine', () => {
  const code = 'self.commandRouter = context.coreCommand;\nself.commandRouter.volumioStop = function () {};';
  assert.deepEqual(rules(code), ['G2.js.command-router-override:2']);
});

test('console.log, not console.error', () => {
  assert.deepEqual(rules("console.log('a');\nconsole.error('b');"), ['G2.js.console-log:1']);
});

test('a file that does not parse is a finding', () => {
  assert.deepEqual(rules('function ('), ['G2.js.parse:1']);
});

test('an inline eslint-disable neither silences a rule nor adds findings', () => {
  const code = "// eslint-disable-next-line no-console\nconsole.log('a');\n/* eslint-disable */\nconst x = 1;";
  assert.deepEqual(rules(code), ['G2.js.console-log:2']);
});

test('an executable script (shebang) runs as its own process: exit and handlers are its own business', () => {
  const code = "#!/usr/bin/env node\nprocess.on('uncaughtException', () => {});\nprocess.exit(2);\nconsole.log('x');";
  assert.deepEqual(rules(code, 'relay/relay.js'), ['G2.js.console-log:4']);
});
