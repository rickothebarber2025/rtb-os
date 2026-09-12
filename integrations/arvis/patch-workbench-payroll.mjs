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
  const backup = `${file}.before-rtb-payroll`;
  if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
}

function patchFile(file, transform) {
  const before = fs.readFileSync(file, 'utf8');
  const after = transform(before);
  if (after !== before) fs.writeFileSync(file, after, 'utf8');
}

patchFile(typesPath, (source) => {
  if (source.includes("'payroll-intelligence'") || source.includes('"payroll-intelligence"')) return source;

  // AI Studio has changed the formatting of ActiveProcessType across exports.
  // Anchor to the existing process literal instead of one exact whitespace layout.
  const single = "'marketing-war-room'";
  const double = '"marketing-war-room"';
  if (source.includes(single)) return source.replace(single, `${single}\n  | 'payroll-intelligence'`);
  if (source.includes(double)) return source.replace(double, `${double}\n  | 'payroll-intelligence'`);

  throw new Error('[payroll] Could not find marketing-war-room in Workbench process types; refusing a blind type edit.');
});

patchFile(appPath, (source) => {
  let next = source;

  if (!next.includes("./components/PayrollIntelligence")) {
    const processImport = next.match(/^import .*ProcessViews.*;$/m)?.[0];
    if (!processImport) throw new Error('[payroll] ProcessViews import not found in App.tsx.');
    next = next.replace(processImport, `${processImport}\nimport { PayrollIntelligence } from './components/PayrollIntelligence';`);
  }

  if (!next.includes("activeProcess === 'payroll-intelligence'") && !next.includes('activeProcess === "payroll-intelligence"')) {
    const salonBlock = next.match(/\{activeProcess === ['"]salon-intel['"] && \(\s*<SalonIntelView[\s\S]*?\/>\s*\)\}/)?.[0];
    if (!salonBlock) throw new Error('[payroll] Salon Intel render block not found in App.tsx.');
    const payrollBlock = `{activeProcess === 'payroll-intelligence' && (\n            <PayrollIntelligence />\n          )}`;
    next = next.replace(salonBlock, `${salonBlock}\n\n          ${payrollBlock}`);
  }

  return next;
});

patchFile(sidebarPath, (source) => {
  if (source.includes("setActiveProcess('payroll-intelligence')") || source.includes('setActiveProcess("payroll-intelligence")')) return source;

  const salonTokenMatch = source.match(/setActiveProcess\(['"]salon-intel['"]\)/);
  if (!salonTokenMatch || salonTokenMatch.index == null) {
    throw new Error('[payroll] Salon Intel navigation target not found in Sidebar.tsx.');
  }

  const listItemStart = source.lastIndexOf('<li', salonTokenMatch.index);
  if (listItemStart < 0) throw new Error('[payroll] Could not locate Salon Intel list item in Sidebar.tsx.');
  const indentStart = source.lastIndexOf('\n', listItemStart) + 1;
  const indent = source.slice(indentStart, listItemStart);

  const payrollItem = `${indent}<li>\n${indent}  <button\n${indent}    onClick={() => setActiveProcess('payroll-intelligence')}\n${indent}    className={\`w-full flex items-center gap-2.5 px-3 py-2 rounded text-left transition-all \${\n${indent}      activeProcess === 'payroll-intelligence'\n${indent}        ? 'bg-violet-500/15 text-violet-300 border-l-2 border-violet-400 font-bold'\n${indent}        : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'\n${indent}    }\`}\n${indent}  >\n${indent}    <span className=\"w-4 h-4 shrink-0 text-violet-400 font-mono font-bold\">$</span>\n${indent}    <div className=\"truncate\">\n${indent}      <div>Payroll Intelligence</div>\n${indent}      <div className=\"text-[9px] text-gray-500\">RTB payroll + AI review</div>\n${indent}    </div>\n${indent}  </button>\n${indent}</li>\n`;

  return source.slice(0, indentStart) + payrollItem + source.slice(indentStart);
});

patchFile(serverPath, (source) => {
  const routeMarker = '// RTB_PAYROLL_INTELLIGENCE_V1';
  if (source.includes(routeMarker)) return source;

  const block = `${routeMarker}\napp.post('/api/payroll/assistant', async (req, res) => {\n  try {\n    const question = String(req.body?.question || '').trim();\n    const payrollContext = req.body?.payrollContext;\n    if (!question) return res.status(400).json({ error: 'Payroll question is required.' });\n    if (!payrollContext?.recentRuns?.length) return res.status(400).json({ error: 'Verified RTB OS payroll context is required.' });\n\n    const ai = getGenAI();\n    if (!ai) return res.status(503).json({ error: 'Gemini is not configured for payroll analysis. Synthetic payroll answers are disabled.' });\n\n    const promptText = 'Question: ' + question + '\\n\\nVerified payroll context:\\n' + JSON.stringify(payrollContext, null, 2);\n    const response = await ai.models.generateContent({\n      model: 'gemini-3.5-flash',\n      contents: [{ role: 'user', parts: [{ text: promptText }] }],\n      config: {\n        systemInstruction: 'You are A.R.V.I.S. Payroll Analyst for RTB Lounge and RTB Beauty Lounge. Use ONLY the verified RTB OS / Supabase payroll context supplied in the request. Never invent sales, tips, commission rates, deductions, expenses, taxes, staff, chair rent, or payroll status. If requested data is missing, say exactly what is missing. Focus on weekly payroll calculations, commission review, chair-rental impact when present, expense impact when present, missing entries, unusual payouts, corrections, and owner review items. Do not finalize, lock, pay, edit, or send payroll. Those actions remain governed by RTB OS. Keep the answer concise and operational.',\n        temperature: 0.15,\n      },\n    });\n\n    return res.json({\n      answer: response.text || 'No payroll analysis returned.',\n      sourceTruth: 'RTB OS / Supabase',\n      mode: 'read-only-analysis',\n    });\n  } catch (error) {\n    console.error('Error in /api/payroll/assistant:', error);\n    return res.status(500).json({ error: error?.message || 'Payroll analysis failed.' });\n  }\n});\n\n`;

  const markers = [
    '// 2. MULTI-TURN CHATBOT',
    "app.post('/api/chat'",
    'app.post("/api/chat"',
    "app.get('/api/health'",
    'app.get("/api/health"',
  ];
  const positions = markers
    .map((marker) => ({ marker, index: source.indexOf(marker) }))
    .filter((item) => item.index >= 0)
    .sort((a, b) => a.index - b.index);

  if (!positions.length) throw new Error('[payroll] No safe server insertion point found.');
  const index = positions[0].index;
  return source.slice(0, index) + block + source.slice(index);
});

console.log('[payroll] RTB Payroll Intelligence installed: live payroll snapshot + read-only A.R.V.I.S. analysis.');
