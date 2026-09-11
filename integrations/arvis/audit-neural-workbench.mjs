#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(process.argv[2] || process.env.NEURAL_WORKBENCH_DIR || path.join(os.homedir(), 'Downloads', 'neural-workbench'));
const includeExt = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.mjs', '.cjs']);
const skipDirs = new Set(['node_modules', 'dist', '.git', '.vite']);
const findings = [];

const rules = [
  { severity: 'high', code: 'PUBLIC_BIND', re: /(?:listen|host)\s*[:=(][^\n]{0,80}(?:0\.0\.0\.0|::)/i, note: 'Server may be exposed beyond localhost.' },
  { severity: 'high', code: 'SERVICE_KEY', re: /SUPABASE_SERVICE_ROLE|service[_-]?role/i, note: 'Do not copy Supabase service-role credentials into Neural Workbench.' },
  { severity: 'medium', code: 'BASELINE_TELEMETRY', re: /baseline|seed(?:ed)?\s+(?:data|metric|telemetry)|mock(?:ed)?\s+(?:data|metric|telemetry)|fake\s+(?:data|metric|telemetry)/i, note: 'Review fallback telemetry before production use.' },
  { severity: 'medium', code: 'HARDCODED_BUSINESS_METRIC', re: /(?:revenue|sales|orders|tips|appointments|netSales|grossSales)\s*[:=]\s*[1-9][0-9]*(?:\.[0-9]+)?/i, note: 'Possible hard-coded operational metric.' },
  { severity: 'medium', code: 'FIREBASE_PATH', re: /firebase|firestore/i, note: 'Legacy Firebase path remains; confirm whether RTB OS snapshot should replace it.' },
  { severity: 'low', code: 'LOCAL_JSON_SOURCE', re: /rtb-(?:staff|operations)\.json|data\/rtb-/i, note: 'Legacy local JSON source remains.' },
];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) walk(path.join(dir, entry.name));
      continue;
    }
    const file = path.join(dir, entry.name);
    if (!includeExt.has(path.extname(entry.name))) continue;
    const rel = path.relative(root, file);
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const rule of rules) {
        if (rule.re.test(line)) findings.push({ ...rule, file: rel, line: index + 1, excerpt: line.trim().slice(0, 180) });
      }
    });
  }
}

if (!fs.existsSync(root)) {
  console.error(`[A.R.V.I.S. audit] Neural Workbench not found: ${root}`);
  process.exit(2);
}

walk(root);
const counts = findings.reduce((acc, f) => ({ ...acc, [f.severity]: (acc[f.severity] || 0) + 1 }), {});
const report = { root, generatedAt: new Date().toISOString(), counts, findings };
const reportDir = path.join(os.homedir(), '.local', 'state', 'rtb');
fs.mkdirSync(reportDir, { recursive: true });
const reportPath = path.join(reportDir, 'neural-workbench-audit.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

console.log(`[A.R.V.I.S. audit] ${findings.length} finding(s): ${counts.high || 0} high, ${counts.medium || 0} medium, ${counts.low || 0} low`);
console.log(`[A.R.V.I.S. audit] Report: ${reportPath}`);
for (const finding of findings.slice(0, 12)) {
  console.log(`  [${finding.severity}] ${finding.code} ${finding.file}:${finding.line} — ${finding.note}`);
}
if (findings.length > 12) console.log(`  ... ${findings.length - 12} more finding(s) in the JSON report.`);

// Audit is advisory during migration. High findings are surfaced but do not prevent local development startup.
process.exit(0);
