#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const workbenchDir = path.resolve(process.argv[2] || process.env.NEURAL_WORKBENCH_DIR || path.join(os.homedir(), 'Downloads', 'neural-workbench'));
const serverPath = path.join(workbenchDir, 'server.ts');
if (!fs.existsSync(serverPath)) {
  console.error(`[screen-vision] Workbench server.ts not found: ${serverPath}`);
  process.exit(1);
}

let source = fs.readFileSync(serverPath, 'utf8');
const backup = `${serverPath}.before-rtb-screen-vision`;
if (!fs.existsSync(backup)) fs.copyFileSync(serverPath, backup);

const marker = '// ==========================================\n// 8. AGENTIC SCREEN VISION & UI PERCEPTION\n// ==========================================';
const proxyMarker = '// RTB_NATIVE_ARVIS_SCREEN_PROXY_V1';
if (!source.includes(proxyMarker)) {
  if (!source.includes(marker)) throw new Error('[screen-vision] Agentic screen vision marker not found; refusing blind patch.');
  const block = `${proxyMarker}\nconst ARVIS_LOCAL_URL = process.env.ARVIS_LOCAL_URL || 'http://127.0.0.1:8787';\n\nasync function proxyArvisJson(pathname, options = {}) {\n  const response = await fetch(\`${ARVIS_LOCAL_URL}\${pathname}\`, {\n    ...options,\n    headers: { 'content-type': 'application/json', ...(options.headers || {}) },\n    signal: AbortSignal.timeout(12000),\n  });\n  const text = await response.text();\n  let body;\n  try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text || 'Invalid A.R.V.I.S. response' }; }\n  if (!response.ok) {\n    const err = new Error(body?.error || \`A.R.V.I.S. request failed (\${response.status})\`);\n    err.status = response.status;\n    throw err;\n  }\n  return body;\n}\n\napp.get('/api/arvis/screen/status', async (_req, res) => {\n  try { res.json(await proxyArvisJson('/api/screen/status')); }\n  catch (err) { res.status(err.status || 503).json({ error: err.message }); }\n});\n\napp.post('/api/arvis/screen/watch', async (req, res) => {\n  try {\n    res.json(await proxyArvisJson('/api/screen/watch', { method: 'POST', body: JSON.stringify(req.body || {}) }));\n  } catch (err) { res.status(err.status || 503).json({ error: err.message }); }\n});\n\napp.get('/api/arvis/browser/screenshot', async (_req, res) => {\n  try { res.json(await proxyArvisJson('/api/browser/screenshot')); }\n  catch (err) { res.status(err.status || 503).json({ error: err.message }); }\n});\n\n`;
  source = source.replace(marker, `${block}${marker}`);
}

// Remove the dangerous fake perception fallback when Gemini is unavailable.
const fakeStart = `    const ai = getGenAI();\n    if (!ai) {\n      // Fallback structured perception response when API key is missing\n      return res.json({`;
if (source.includes(fakeStart)) {
  const start = source.indexOf(fakeStart);
  const endNeedle = `        isSimulated: true\n      });\n    }`;
  const end = source.indexOf(endNeedle, start);
  if (end < 0) throw new Error('[screen-vision] Fake fallback end marker not found.');
  const replacement = `    const ai = getGenAI();\n    if (!ai) {\n      return res.status(503).json({ error: 'Gemini is not configured for live screen perception. Synthetic perception is disabled.' });\n    }`;
  source = source.slice(0, start) + replacement + source.slice(end + endNeedle.length);
}

// Replace the JSON parse fallback with an explicit parse failure instead of invented state.
const parseFallback = `    } catch {\n      parsed = {\n        activeTabs: ['RTB OS - Main Console'],\n        detectedMetrics: { occupancy: 'Normal', activeChairs: 5 },\n        uiErrors: [],\n        recommendations: ['Maintain active monitoring buffer.'],\n        rawPerception: responseText\n      };\n    }`;
if (source.includes(parseFallback)) {
  source = source.replace(parseFallback, `    } catch {\n      return res.status(502).json({ error: 'Vision model returned a non-JSON perception result.', rawPerception: responseText });\n    }`);
}

fs.writeFileSync(serverPath, source);
console.log('[screen-vision] Native A.R.V.I.S. screen proxy installed; synthetic perception disabled.');
