#!/usr/bin/env node
// Smoke the built browser half: load lib/client.js under a stub module loader, run apply against a
// minimal context, and check that it registers the row's Configure page.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const react = require('react');

let entry;
const sandbox = {
  window: { __ModuleLoader__: { load: (value) => { entry = value; } } },
  fetch: async () => ({ ok: false, status: 401, json: async () => ({}) }),
  console,
};
vm.createContext(sandbox);
vm.runInContext(readFileSync('lib/client.js', 'utf8'), sandbox);

if (!entry || entry.id !== 'cursor-to-dsh') throw new Error('the bundle did not register under the package name');

const keys = [];
const context = {
  effect: (fn) => fn(),
  slots: {
    inject: (_name, callback) => { callback(); return () => {}; },
    register: (options) => { keys.push(options.key); return () => {}; },
  },
  remote: {},
};
const exports = entry.factory((specifier) => {
  if (specifier === 'react') return react;
  throw new Error('unexpected require: ' + specifier);
});
if (typeof exports.apply !== 'function' || !Array.isArray(exports.inject)) throw new Error('the bundle exports no plugin');
exports.apply(context);

if (!keys.includes('cursor-to-dsh#llm-cursor')) throw new Error('the row page was not registered: ' + JSON.stringify(keys));
console.log('client bundle ok: ' + JSON.stringify(keys));
