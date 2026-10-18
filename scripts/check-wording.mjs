#!/usr/bin/env node
// Fails (exit 1) if banned claim wording appears in src/**/*.{ts,tsx} or README.md.
// Banned list: Notion → "Claims, Evidence & Safety". The exact text of the DISCLAIMER and
// NOT_A_DIAGNOSIS constants in src/lib/copy.ts is allowlisted wherever it appears.
//
// Usage: node scripts/check-wording.mjs [--root <dir>]

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BANNED = [
  'diagnose',
  'diagnosis',
  'abnormal',
  'normal',
  'healthy',
  'clinically validated',
  'hospital-grade',
  'predicts',
  'risk detected',
  'health score',
  'phone ECG',
  'AFib',
  'arrhythmia',
  'lungs are fine',
  'get care now',
  'urgent',
  'FDA approved',
  'FDA compliant',
  'replaces a doctor',
  'myopia',
  'vision loss',
  'needs glasses',
  'dry eye',
  'eye disease',
  'lung age',
  'screening result',
];

const ALLOWLISTED_KEYS = ['DISCLAIMER', 'NOT_A_DIAGNOSIS'];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Word-boundary, case-insensitive; multi-word phrases tolerate any whitespace between words.
const patterns = BANNED.map((phrase) => ({
  phrase,
  re: new RegExp(`(?<![A-Za-z0-9_])${phrase.split(/\s+/).map(escape).join('\\s+')}(?![A-Za-z0-9_])`, 'gi'),
}));

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

function allowlistedStrings(root) {
  const copyPath = join(root, 'src', 'lib', 'copy.ts');
  if (!existsSync(copyPath)) return [];
  const src = readFileSync(copyPath, 'utf8');
  const values = [];
  for (const key of ALLOWLISTED_KEYS) {
    const m = src.match(new RegExp(`export const ${key}\\s*=\\s*(['"\`])([\\s\\S]*?)\\1`));
    if (m) values.push(m[2].replace(/\\(['"`])/g, '$1'));
  }
  return values;
}

// Blank out allowlisted text (keeping newlines so line numbers stay right).
function maskAllowlisted(text, allowed) {
  let masked = text;
  for (const value of allowed) {
    masked = masked.split(value).join(value.replace(/[^\n]/g, ' '));
  }
  return masked;
}

export function checkWording(root = process.cwd()) {
  const files = walk(join(root, 'src'));
  const readme = join(root, 'README.md');
  if (existsSync(readme)) files.push(readme);
  const allowed = allowlistedStrings(root);
  const hits = [];
  for (const file of files) {
    const lines = maskAllowlisted(readFileSync(file, 'utf8'), allowed).split('\n');
    lines.forEach((line, i) => {
      for (const { phrase, re } of patterns) {
        re.lastIndex = 0;
        if (re.test(line)) hits.push({ file: relative(root, file), line: i + 1, phrase, text: line.trim() });
      }
    });
  }
  return hits;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const i = process.argv.indexOf('--root');
  const root = i > -1 ? process.argv[i + 1] : process.cwd();
  const hits = checkWording(root);
  if (hits.length) {
    console.error(`Banned wording found (${hits.length}). See Notion → Claims, Evidence & Safety.`);
    for (const h of hits) console.error(`  ${h.file}:${h.line}  "${h.phrase}"  →  ${h.text}`);
    process.exit(1);
  }
  console.log('Wording check passed.');
}
