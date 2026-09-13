#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2];
const targetUrl = process.argv[3] || 'http://127.0.0.1:5173';
if (!root) {
  console.error('[desktop-shell] missing A.R.V.I.S. root');
  process.exit(2);
}

const main = path.join(root, 'electron', 'main.cjs');
if (!fs.existsSync(main)) {
  console.error(`[desktop-shell] missing ${main}`);
  process.exit(2);
}

let source = fs.readFileSync(main, 'utf8');
if (source.includes(`RTB_DESKTOP_SHELL_TARGET=${targetUrl}`)) {
  console.log(`[desktop-shell] already targets ${targetUrl}`);
  process.exit(0);
}

const backup = `${main}.rtb-shell-original`;
if (!fs.existsSync(backup)) fs.copyFileSync(main, backup);

const marker = `// RTB_DESKTOP_SHELL_TARGET=${targetUrl}`;
let changed = false;

const directPatterns = [
  /loadURL\(\s*(['"])http:\/\/127\.0\.0\.1:3000\/?\1\s*\)/,
  /loadURL\(\s*(['"])http:\/\/localhost:3000\/?\1\s*\)/,
];
for (const pattern of directPatterns) {
  if (pattern.test(source)) {
    source = source.replace(pattern, `loadURL('${targetUrl}')`);
    changed = true;
    break;
  }
}

if (!changed) {
  const exact = /http:\/\/127\.0\.0\.1:3000\/?/;
  if (exact.test(source)) {
    source = source.replace(exact, targetUrl);
    changed = true;
  }
}

if (!changed) {
  console.error('[desktop-shell] could not find the Workbench URL in electron/main.cjs; original left untouched');
  process.exit(3);
}

source = `${marker}\n${source}`;
fs.writeFileSync(main, source);
console.log(`[desktop-shell] A.R.V.I.S. now opens RTB OS at ${targetUrl}`);
console.log(`[desktop-shell] backup: ${backup}`);
