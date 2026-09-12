#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(process.argv[2] || process.env.NEURAL_WORKBENCH_DIR || path.join(os.homedir(), 'Downloads', 'neural-workbench'));
const includeExt = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json']);
const sourceExt = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const skipDirs = new Set(['node_modules', 'dist', '.git', '.vite', 'coverage', 'backups']);
const skipFiles = new Set(['package-lock.json', 'bun.lock', 'bun.lockb', 'yarn.lock', 'pnpm-lock.yaml']);
const informationalConfigFiles = new Set(['firebase-applet-config.json', 'firebase-blueprint.json']);
const rawFindings = [];

const rules = [
  { severity: 'high', code: 'PUBLIC_BIND', re: /(?:listen|host)\s*[:=(][^\n]{0,80}(?:0\.0\.0\.0|::)/i, note: 'Server may be exposed beyond localhost.' },
  { severity: 'high', code: 'SERVICE_KEY', re: /SUPABASE_SERVICE_ROLE|service[_-]?role/i, note: 'Do not copy Supabase service-role credentials into Neural Workbench.' },
  { severity: 'medium', code: 'BASELINE_TELEMETRY', re: /baseline|seed(?:ed)?\s+(?:data|metric|telemetry)|mock(?:ed)?\s+(?:data|metric|telemetry)|fake\s+(?:data|metric|telemetry)/i, note: 'Review fallback telemetry before production use.' },
  { severity: 'medium', code: 'HARDCODED_BUSINESS_METRIC', re: /(?:revenue|sales|orders|tips|appointments|netSales|grossSales)\s*[:=]\s*[1-9][0-9]*(?:\.[0-9]+)?/i, note: 'Possible hard-coded operational metric.' },
  { severity: 'medium', code: 'FIREBASE_PATH', re: /firebase|firestore/i, note: 'Legacy Firebase path remains in executable source; confirm whether RTB OS snapshot should replace it.', sourceOnly: true },
  { severity: 'low', code: 'LOCAL_JSON_SOURCE', re: /rtb-(?:staff|operations)\.json|data\/rtb-/i, note: 'Legacy local JSON source remains.' },
];

function shouldSkipFile(rel, entryName) {
  if (skipFiles.has(entryName)) return true;
  if (rel.endsWith('.rtb-original') || rel.includes('.before-rtb-')) return true;
  return false;
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) walk(path.join(dir, entry.name));
      continue;
    }
    const file = path.join(dir, entry.name);
    const rel = path.relative(root, file);
    const ext = path.extname(entry.name);
    if (!includeExt.has(ext) || shouldSkipFile(rel, entry.name)) continue;

    // Firebase project metadata is useful for migration history but is not an
    // executable runtime path, so don't count it as an active warning.
    if (informationalConfigFiles.has(entry.name)) continue;

    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const rule of rules) {
        if (rule.sourceOnly && !sourceExt.has(ext)) continue;
        if (rule.re.test(line)) rawFindings.push({ ...rule, file: rel, line: index + 1, excerpt: line.trim().slice(0, 180) });
      }
    });
  }
}

if (!fs.existsSync(root)) {
  console.error(`[A.R.V.I.S. audit] Neural Workbench not found: ${root}`);
  process.exit(2);
}

walk(root);

// A file containing 70 Firebase imports is one migration concern, not 70
// separate active failures. Collapse repeated matches by rule + file while
// preserving how many occurrences were found in the JSON report.
const grouped = new Map();
for (const finding of rawFindings) {
  const key = `${finding.code}:${finding.file}`;
  const current = grouped.get(key);
  if (!current) grouped.set(key, { ...finding, occurrences: 1 });
  else current.occurrences += 1;
}
const findings = [...grouped.values()];
const counts = findings.reduce((acc, f) => ({ ...acc, [f.severity]: (acc[f.severity] || 0) + 1 }), {});
const occurrenceCounts = rawFindings.reduce((acc, f) => ({ ...acc, [f.severity]: (acc[f.severity] || 0) + 1 }), {});
const report = {
  root,
  generatedAt: new Date().toISOString(),
  counts,
  rawOccurrences: occurrenceCounts,
  findings,
  notes: [
    'Findings are grouped by rule and file.',
    'Dependency lockfiles, backups, generated output, and Firebase blueprint/config metadata are excluded from active warnings.',
    'Firebase is reported only when referenced by executable source code.'
  ],
};
const reportDir = path.join(os.homedir(), '.local', 'state', 'rtb');
fs.mkdirSync(reportDir, { recursive: true });
const reportPath = path.join(reportDir, 'neural-workbench-audit.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

console.log(`[A.R.V.I.S. audit] ${findings.length} actionable finding group(s): ${counts.high || 0} high, ${counts.medium || 0} medium, ${counts.low || 0} low`);
console.log(`[A.R.V.I.S. audit] Report: ${reportPath}`);
for (const finding of findings.slice(0, 10)) {
  const repeats = finding.occurrences > 1 ? ` (${finding.occurrences} matches in file)` : '';
  console.log(`  [${finding.severity}] ${finding.code} ${finding.file}:${finding.line}${repeats} — ${finding.note}`);
}
if (findings.length > 10) console.log(`  ... ${findings.length - 10} more actionable group(s) in the JSON report.`);

process.exit(0);
