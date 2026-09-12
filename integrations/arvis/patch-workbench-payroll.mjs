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
  if (source.includes("| 'payroll-intelligence'")) return source;
  const marker = "  | 'marketing-war-room';";
  if (!source.includes(marker)) throw new Error('[payroll] ActiveProcessType marker not found.');
  return source.replace(marker, "  | 'marketing-war-room'\n  | 'payroll-intelligence';");
});

patchFile(appPath, (source) => {
  let next = source;
  if (!next.includes("./components/PayrollIntelligence")) {
    const marker = "import { SalonIntelView, MarketingWarRoomView } from './components/ProcessViews';";
    if (!next.includes(marker)) throw new Error('[payroll] App import marker not found.');
    next = next.replace(marker, `${marker}\nimport { PayrollIntelligence } from './components/PayrollIntelligence';`);
  }
  if (!next.includes("activeProcess === 'payroll-intelligence'")) {
    const marker = `          {activeProcess === 'salon-intel' && (\n            <SalonIntelView onTriggerAction={() => {}} />\n          )}`;
    if (!next.includes(marker)) throw new Error('[payroll] App view marker not found.');
    next = next.replace(marker, `${marker}\n\n          {activeProcess === 'payroll-intelligence' && (\n            <PayrollIntelligence />\n          )}`);
  }
  return next;
});

patchFile(sidebarPath, (source) => {
  if (source.includes("setActiveProcess('payroll-intelligence')")) return source;
  const marker = `            <li>\n              <button\n                onClick={() => setActiveProcess('salon-intel')}`;
  if (!source.includes(marker)) throw new Error('[payroll] Sidebar insertion marker not found.');
  const payrollItem = `            <li>\n              <button\n                onClick={() => setActiveProcess('payroll-intelligence')}\n                className={\`w-full flex items-center gap-2.5 px-3 py-2 rounded text-left transition-all \${\n                  activeProcess === 'payroll-intelligence'\n                    ? 'bg-violet-500/15 text-violet-300 border-l-2 border-violet-400 font-bold'\n                    : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'\n                }\`}\n              >\n                <FileText className=\"w-4 h-4 shrink-0 text-violet-400\" />\n                <div className=\"truncate\">\n                  <div>Payroll Intelligence</div>\n                  <div className=\"text-[9px] text-gray-500\">RTB payroll + AI review</div>\n                </div>\n              </button>\n            </li>\n`;
  return source.replace(marker, `${payrollItem}${marker}`);
});

patchFile(serverPath, (source) => {
  const routeMarker = '// RTB_PAYROLL_INTELLIGENCE_V1';
  if (source.includes(routeMarker)) return source;
  const insertBefore = '// 2. MULTI-TURN CHATBOT';
  if (!source.includes(insertBefore)) throw new Error('[payroll] Server chat marker not found.');
  const block = `${routeMarker}\napp.post('/api/payroll/assistant', async (req, res) => {\n  try {\n    const question = String(req.body?.question || '').trim();\n    const payrollContext = req.body?.payrollContext;\n    if (!question) return res.status(400).json({ error: 'Payroll question is required.' });\n    if (!payrollContext?.recentRuns?.length) return res.status(400).json({ error: 'Verified RTB OS payroll context is required.' });\n\n    const ai = getGenAI();\n    if (!ai) return res.status(503).json({ error: 'Gemini is not configured for payroll analysis. Synthetic payroll answers are disabled.' });\n\n    const promptText = 'Question: ' + question + '\\n\\nVerified payroll context:\\n' + JSON.stringify(payrollContext, null, 2);\n    const response = await ai.models.generateContent({\n      model: 'gemini-3.5-flash',\n      contents: [{ role: 'user', parts: [{ text: promptText }] }],\n      config: {\n        systemInstruction: 'You are A.R.V.I.S. Payroll Analyst for RTB Lounge and RTB Beauty Lounge. Use ONLY the verified RTB OS / Supabase payroll context supplied in the request. Never invent sales, tips, commission rates, deductions, expenses, taxes, staff, chair rent, or payroll status. If requested data is missing, say exactly what is missing. Focus on weekly payroll calculations, commission review, chair-rental impact when present, expense impact when present, missing entries, unusual payouts, corrections, and owner review items. Do not finalize, lock, pay, edit, or send payroll. Those actions remain governed by RTB OS. Keep the answer concise and operational.',\n        temperature: 0.15,\n      },\n    });\n\n    return res.json({\n      answer: response.text || 'No payroll analysis returned.',\n      sourceTruth: 'RTB OS / Supabase',\n      mode: 'read-only-analysis',\n    });\n  } catch (error) {\n    console.error('Error in /api/payroll/assistant:', error);\n    return res.status(500).json({ error: error?.message || 'Payroll analysis failed.' });\n  }\n});\n\n`;
  return source.replace(insertBefore, `${block}${insertBefore}`);
});

console.log('[payroll] RTB Payroll Intelligence installed: live payroll snapshot + read-only A.R.V.I.S. analysis.');
