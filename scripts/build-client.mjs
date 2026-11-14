#!/usr/bin/env node
// Emit the browser half as one module-loader factory bundle.
//
// The client module system loads a plugin's ./client as a single script that registers a factory
// and resolves its imports through a require the shell injects. The platform already supplies
// React and the UI primitives, so they stay external; everything else is bundled.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

await build({
  entryPoints: ['src/client/index.ts'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
  legalComments: 'none',
  logLevel: 'warning',
  banner: {
    js: 'window.__ModuleLoader__.load({ id: ' + JSON.stringify(manifest.name) + ', factory: (require) => { var module = { exports: {} }; var exports = module.exports;',
  },
  footer: { js: 'return module.exports; } });' },
});

console.log('built lib/client.js');
