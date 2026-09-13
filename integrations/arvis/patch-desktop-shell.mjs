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
const marker = `// RTB_DESKTOP_SHELL_TARGET=${targetUrl}`;
if (source.includes(marker)) {
  console.log(`[desktop-shell] already targets ${targetUrl}`);
  process.exit(0);
}

const backup = `${main}.rtb-shell-original`;
if (!fs.existsSync(backup)) fs.copyFileSync(main, backup);

let changed = false;

// 1) Replace any explicit Workbench URL first.
const explicitPatterns = [
  /http:\/\/127\.0\.0\.1:3000\/?/g,
  /http:\/\/localhost:3000\/?/g,
];
for (const pattern of explicitPatterns) {
  if (pattern.test(source)) {
    source = source.replace(pattern, targetUrl);
    changed = true;
  }
}

// 2) If the URL is computed through a variable, patch the primary loadURL call.
if (!changed) {
  const loadUrlRe = /([A-Za-z_$][\w$.[\]]*)\.loadURL\(\s*([^\n;]+?)\s*\)/g;
  const candidates = [...source.matchAll(loadUrlRe)];
  const preferred = candidates.find((match) => /3000|workbench|app_?url|server_?url|localhost|127\.0\.0\.1/i.test(match[2])) || candidates[0];
  if (preferred) {
    const original = preferred[0];
    const object = preferred[1];
    source = source.replace(original, `${object}.loadURL('${targetUrl}')`);
    changed = true;
    console.log(`[desktop-shell] replaced loadURL expression: ${original.slice(0, 180)}`);
  }
}

// 3) Some Electron shells use webContents.loadURL instead of BrowserWindow.loadURL.
if (!changed) {
  const webContentsRe = /([A-Za-z_$][\w$.[\]]*\.webContents)\.loadURL\(\s*([^\n;]+?)\s*\)/;
  const match = source.match(webContentsRe);
  if (match) {
    source = source.replace(match[0], `${match[1]}.loadURL('${targetUrl}')`);
    changed = true;
    console.log(`[desktop-shell] replaced webContents.loadURL expression: ${match[0].slice(0, 180)}`);
  }
}

if (!changed) {
  const hints = source
    .split('\n')
    .map((line, index) => ({ line, index: index + 1 }))
    .filter(({ line }) => /loadURL|loadFile|BrowserWindow|3000|5173|workbench/i.test(line))
    .slice(0, 40)
    .map(({ line, index }) => `${index}: ${line.trim()}`)
    .join('\n');
  const diagnostic = path.join(root, 'logs', 'desktop-shell-routing-diagnostic.txt');
  fs.mkdirSync(path.dirname(diagnostic), { recursive: true });
  fs.writeFileSync(diagnostic, hints || 'No routing hints found in electron/main.cjs\n');
  console.error('[desktop-shell] could not identify a safe primary loadURL call; original left untouched');
  console.error(`[desktop-shell] diagnostic written to ${diagnostic}`);
  process.exit(3);
}

source = `${marker}\n${source}`;
fs.writeFileSync(main, source);
console.log(`[desktop-shell] A.R.V.I.S. now opens RTB OS at ${targetUrl}`);
console.log(`[desktop-shell] backup: ${backup}`);
