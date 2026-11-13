#!/usr/bin/env node
// Release guard: tracked text files must not carry internal links, local paths, private identities
// or non-English (CJK) text.
// Extra private patterns (one regex per line) are read from ~/.config/check-public/deny.txt when it exists;
// keep them there, never in the repository.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SELF = 'scripts/check-public.mjs';
const rules = [
  [/[\w.-]+\.woa\.com|\btencent\.com\b/i, 'internal domain'],
  [new RegExp(`/(Users|home)/${os.userInfo().username}\\b`), 'local home path'],
  [/Mobile Documents|CloudDocs/, 'iCloud path'],
  [/"resolved": "https?:\/\/(?!registry\.npmjs\.org\/)/, 'non-npmjs registry in lockfile'],
];
// Any CJK range would put Chinese (or other CJK) text back into the repository.
const CJK = /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/;
const denyFile = path.join(os.homedir(), '.config/check-public/deny.txt');
if (fs.existsSync(denyFile))
  for (const line of fs.readFileSync(denyFile, 'utf8').split('\n').map(s => s.trim()))
    if (line && !line.startsWith('#')) rules.push([new RegExp(line, 'i'), 'private pattern from deny.txt']);

const problems = [];
const files = execFileSync('git', ['ls-files', '-z'], {encoding: 'utf8'}).split('\0').filter(f => f && f !== SELF);
for (const file of files) {
  // git lists a tracked file that a working tree may have deleted; nothing to scan.
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
  const bytes = fs.readFileSync(file);
  const binary = bytes.includes(0);
  const text = bytes.toString('utf8');
  text.split('\n').forEach((line, i) => {
    for (const [re, why] of rules) if (re.test(line)) problems.push(`${file}:${i + 1}: ${why}`);
    // Binary files are decoded as text, so the CJK rule only applies to text files.
    if (!binary && CJK.test(line)) problems.push(`${file}:${i + 1}: non-English text`);
  });
}

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (pkg.private) problems.push('package.json: "private" must be removed before publishing');
if (!/^git\+https:\/\/github\.com\/[\w-]+\/[\w.-]+\.git$/.test(pkg.repository?.url || ''))
  problems.push('package.json: repository.url must be the public GitHub repository');

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`check:public ok (${files.length} files, ${rules.length} rules, no CJK text)`);
