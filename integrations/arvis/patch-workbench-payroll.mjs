#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(process.argv[2] || process.env.NEURAL_WORKBENCH_DIR || path.join(os.homedir(), 'Downloads', 'neural-workbench'));
const appPath = path.join(root, 'src', 'App.tsx');
const sidebarPath = path.join(root, 'src', 'components', 'Sidebar.tsx');
const typesPath = path.join(root, 'src', 'types.ts');
const serverPath = path.join(root, 'server.ts');

for (const file of [appPath, sidebarPath, typesPath, serverPath]) {
  if (!fs.existsSync(file)) throw new Error(`[payroll] Missing Workbench file: ${file}`);
}

// Earlier payroll installers touched App.tsx, Sidebar.tsx and types.ts directly.
// Restore those exact pre-payroll snapshots so the AI Studio frontend returns to
// its known-good navigation/type layout. Payroll UI is now mounted through the
// controlled ProcessViews override instead of blind edits to generated files.
for (const file of [appPath, sidebarPath, typesPath]) {
  const backup = `${file}.before-rtb-payroll`;
  if (fs.existsSync(backup)) {
    fs.copyFileSync(backup, file);
    console.log(`[payroll] restored generated Workbench file: ${path.relative(root, file)}`);
  }
}

const serverBackup = `${serverPath}.before-rtb-payroll`;
if (!fs.existsSync(serverBackup)) fs.copyFileSync(serverPath, serverBackup);

let server = fs.readFileSync(serverPath, 'utf8');
const routeMarker = '// RTB_PAYROLL_INTELLIGENCE_V1';
if (!server.includes(routeMarker)) {
  const block = `${routeMarker}\napp.post('/api/payroll/assistant', async (req, res) => {\n  try {\n    const question = String(req.body?.question || '').trim();\n    const payrollContext = req.body?.payrollContext;\n    if (!question) return res.status(400).json({ error: 'Payroll question is required.' });\n    if (!payrollContext?.recentRuns?.length) return res.status(400).json({ error: 'Verified RTB OS payroll context is required.' });\n\n    const ai = getGenAI();\n    if (!ai) return res.status(503).json({ error: 'Gemini is not configured for payroll analysis. Synthetic payroll answers are disabled.' });\n\n    const promptText = 'Question: ' + question + '\\n\\nVerified payroll context:\\n' + JSON.stringify(payrollContext, null, 2);\n    const response = await ai.models.generateContent({\n      model: 'gemini-3.5-flash',\n      contents: [{ role: 'user', parts: [{ text: promptText }] }],\n      config: {\n        systemInstruction: 'You are A.R.V.I.S. Payroll Analyst for RTB Lounge and RTB Beauty Lounge. Use ONLY the verified RTB OS / Supabase payroll context supplied in the request. Never invent sales, tips, commission rates, deductions, expenses, taxes, staff, chair rent, or payroll status. If requested data is missing, say exactly what is missing. Focus on weekly payroll calculations, commission review, chair-rental impact when present, expense impact when present, missing entries, unusual payouts, corrections, and owner review items. Do not finalize, lock, pay, edit, or send payroll. Those actions remain governed by RTB OS. Keep the answer concise and operational.',\n        temperature: 0.15,\n      },\n    });\n\n    return res.json({\n      answer: response.text || 'No payroll analysis returned.',\n      sourceTruth: 'RTB OS / Supabase',\n      mode: 'read-only-analysis',\n    });\n  } catch (error) {\n    console.error('Error in /api/payroll/assistant:', error);\n    return res.status(500).json({ error: error?.message || 'Payroll analysis failed.' });\n  }\n});\n\n`;

  const markers = [
    '// 2. MULTI-TURN CHATBOT',
    "app.post('/api/chat'",
    'app.post("/api/chat"',
    "app.get('/api/health'",
    'app.get("/api/health"',
  ];
  const positions = markers
    .map((marker) => ({ marker, index: server.indexOf(marker) }))
    .filter((item) => item.index >= 0)
    .sort((a, b) => a.index - b.index);

  if (!positions.length) throw new Error('[payroll] No safe server insertion point found.');
  const index = positions[0].index;
  server = server.slice(0, index) + block + server.slice(index);
  fs.writeFileSync(serverPath, server, 'utf8');
}

console.log('[payroll] RTB Payroll Intelligence backend installed. Frontend navigation left untouched for stability.');