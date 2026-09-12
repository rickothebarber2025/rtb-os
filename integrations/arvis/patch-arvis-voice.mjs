import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] || process.env.ARVIS_DESKTOP_ROOT || join(process.env.HOME || '', 'Documents/RTB DAtabase/local-assistant 2'));
const serverPath = join(root, 'server.mjs');
const uiPath = join(root, 'ui.html');

if (!existsSync(serverPath) || !existsSync(uiPath)) {
  console.log(`[voice] skipped: ${root} does not contain server.mjs + ui.html`);
  process.exit(0);
}

for (const path of [serverPath, uiPath]) {
  const backup = `${path}.before-rtb-voice`;
  if (!existsSync(backup)) copyFileSync(path, backup);
}

let server = readFileSync(serverPath, 'utf8');
let ui = readFileSync(uiPath, 'utf8');

function replaceExact(text, oldValue, newValue, label) {
  if (text.includes(newValue)) return text;
  if (!text.includes(oldValue)) throw new Error(`[voice] ${label} marker not found; refusing a blind patch.`);
  return text.replace(oldValue, newValue);
}

// Server: expose richer voice status.
server = replaceExact(
  server,
  `function voiceStatus() {\n  return {\n    configured: Boolean(ELEVENLABS_API_KEY),\n    voiceId: ELEVENLABS_VOICE_ID,\n    ttsModel: ELEVENLABS_TTS_MODEL,\n    sttModel: ELEVENLABS_STT_MODEL,\n  };\n}`,
  `function voiceStatus() {\n  return {\n    configured: Boolean(ELEVENLABS_API_KEY),\n    voiceId: ELEVENLABS_VOICE_ID,\n    ttsModel: ELEVENLABS_TTS_MODEL,\n    sttModel: ELEVENLABS_STT_MODEL,\n    defaults: { rate: 1.08, pitch: 0.86, compact: true, maxSpokenChars: 360 },\n    controls: { voiceSelection: true, speed: true, pitch: true, interrupt: true, compactReplies: true },\n  };\n}`,
  'voiceStatus',
);

if (!server.includes('async function elevenLabsVoices()')) {
  const oldSpeakStart = 'async function elevenLabsSpeak(input) {';
  const healthStart = '\n\nasync function elevenLabsHealth() {';
  const start = server.indexOf(oldSpeakStart);
  const end = server.indexOf(healthStart, start);
  if (start < 0 || end < 0) throw new Error('[voice] ElevenLabs speech block not found; refusing a blind patch.');

  const speechBlock = `function compactVoiceText(input, compact = true) {\n  const raw = String(input || "").replace(/https?:\\/\\/\\S+/g, "").replace(/[>#*_~]+/g, " ").replace(/\\s+/g, " ").trim();\n  if (!compact || raw.length <= 360) return raw.slice(0, 1200);\n  const sentences = raw.match(/[^.!?]+[.!?]?/g) || [raw];\n  const spoken = sentences.slice(0, 2).join(" ").trim();\n  return spoken.length > 360 ? spoken.slice(0, 357) + "..." : spoken;\n}\n\nasync function elevenLabsVoices() {\n  if (!ELEVENLABS_API_KEY) return [];\n  const response = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": ELEVENLABS_API_KEY }, signal: AbortSignal.timeout(8000) });\n  const body = await response.json().catch(() => ({}));\n  if (!response.ok) throw Object.assign(new Error(body?.detail?.message || body?.message || "ElevenLabs voice list failed."), { status: response.status });\n  return (body.voices || []).map((voice) => ({ id: voice.voice_id, name: voice.name || voice.voice_id, category: voice.category || null }));\n}\n\nasync function elevenLabsSpeak(input, options = {}) {\n  if (!ELEVENLABS_API_KEY) throw Object.assign(new Error("ElevenLabs is not configured."), { status: 400 });\n  const requestedVoice = String(options.voiceId || "").trim();\n  const voiceId = /^[A-Za-z0-9_-]{8,128}$/.test(requestedVoice) ? requestedVoice : ELEVENLABS_VOICE_ID;\n  const text = compactVoiceText(input, options.compact !== false);\n  if (!text) throw Object.assign(new Error("Nothing to speak."), { status: 400 });\n  const response = await fetch(\`https://api.elevenlabs.io/v1/text-to-speech/\${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128\`, {\n    method: "POST",\n    headers: { "content-type": "application/json", accept: "audio/mpeg", "xi-api-key": ELEVENLABS_API_KEY },\n    body: JSON.stringify({ text, model_id: ELEVENLABS_TTS_MODEL, voice_settings: { stability: 0.62, similarity_boost: 0.78, style: 0.12, use_speaker_boost: true } }),\n  });\n  if (!response.ok) {\n    const detail = await response.text().catch(() => "");\n    throw Object.assign(new Error(detail || \`ElevenLabs speech failed with status \${response.status}.\`), { status: response.status });\n  }\n  return Buffer.from(await response.arrayBuffer());\n}`;
  server = server.slice(0, start) + speechBlock + server.slice(end);
}

// Server routes: list voices and allow per-request voice selection.
if (!server.includes('url.pathname === "/api/voice/voices"')) {
  const oldRoute = `    if (req.method === "POST" && url.pathname === "/api/speak") {\n      const body = await parseBody(req);\n      const audio = await elevenLabsSpeak(body.text || body.message || "");\n      return binary(res, 200, audio, "audio/mpeg");\n    }`;
  const newRoute = `    if (req.method === "GET" && url.pathname === "/api/voice/voices") {\n      try {\n        return json(res, 200, { voices: await elevenLabsVoices(), defaultVoiceId: ELEVENLABS_VOICE_ID });\n      } catch (error) {\n        return json(res, error.status || 500, { error: error.message, voices: [], defaultVoiceId: ELEVENLABS_VOICE_ID });\n      }\n    }\n\n    if (req.method === "POST" && url.pathname === "/api/speak") {\n      const body = await parseBody(req);\n      const audio = await elevenLabsSpeak(body.text || body.message || "", body);\n      return binary(res, 200, audio, "audio/mpeg");\n    }`;
  server = replaceExact(server, oldRoute, newRoute, 'voice routes');
}

// UI header controls.
const oldHeader = `      <button class="pill on" id="voicebtn" onclick="toggleVoiceReply()" title="Toggle spoken replies">🔊 On</button>`;
const newHeader = `${oldHeader}\n      <button class="pill" id="voicesettingsbtn" onclick="openVoiceSettings()" title="Voice settings">Voice</button>\n      <button class="pill" id="voicestopbtn" onclick="stopVoicePlayback()" title="Stop A.R.V.I.S. speaking">Stop</button>`;
ui = replaceExact(ui, oldHeader, newHeader, 'voice header controls');

// UI state.
ui = replaceExact(
  ui,
  `let voiceReplyOn=true, recognizing=false, mediaStream=null, mediaRecorder=null, audioChunks=[], audioTimer=null, audioContext=null, analyser=null, lastVoiceAt=0, webSpeechRecognition=null;`,
  `let voiceReplyOn=true, recognizing=false, mediaStream=null, mediaRecorder=null, audioChunks=[], audioTimer=null, audioContext=null, analyser=null, lastVoiceAt=0, webSpeechRecognition=null, activeVoiceAudio=null;\nlet voicePreferences=(()=>{try{return {...{voiceId:'',browserVoice:'',rate:1.08,pitch:0.86,compact:true},...JSON.parse(localStorage.getItem('arvis.voice.preferences')||'{}')}}catch{return {voiceId:'',browserVoice:'',rate:1.08,pitch:0.86,compact:true}}})();`,
  'voice state',
);

// UI speech implementation. Marker makes repeated startup safe.
if (!ui.includes('/* RTB_ARVIS_VOICE_V2 */')) {
  const start = ui.indexOf('async function speak(textValue){');
  const end = ui.indexOf('function speakableText(data){', start);
  if (start < 0 || end < 0) throw new Error('[voice] speak() markers not found; refusing a blind patch.');

  const voiceUi = `/* RTB_ARVIS_VOICE_V2 */\nfunction compactVoiceForSpeech(value){\n  const raw=String(value||'').replace(/\\s+/g,' ').trim();\n  if(!voicePreferences.compact||raw.length<=360)return raw.slice(0,1200);\n  const parts=raw.match(/[^.!?]+[.!?]?/g)||[raw];\n  const out=parts.slice(0,2).join(' ').trim();\n  return out.length>360?out.slice(0,357)+'...':out;\n}\nfunction stopVoicePlayback(){\n  try{if(activeVoiceAudio){activeVoiceAudio.pause();activeVoiceAudio.src='';activeVoiceAudio=null}}catch(e){}\n  try{if('speechSynthesis' in window)window.speechSynthesis.cancel()}catch(e){}\n}\nasync function speak(textValue){\n  if(!voiceReplyOn||!textValue)return;\n  stopVoicePlayback();\n  const spoken=compactVoiceForSpeech(textValue);\n  const rate=Math.max(.8,Math.min(1.3,Number(voicePreferences.rate)||1.08));\n  if(status?.voice?.configured){\n    try{\n      const res=await fetch('/api/speak',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:spoken,voiceId:voicePreferences.voiceId||undefined,compact:voicePreferences.compact!==false})});\n      if(res.ok){\n        const blob=await res.blob();\n        const audio=new Audio(URL.createObjectURL(blob));\n        activeVoiceAudio=audio;audio.playbackRate=rate;audio.onended=()=>{if(activeVoiceAudio===audio)activeVoiceAudio=null};\n        await audio.play();return;\n      }\n    }catch(e){}\n  }\n  if(!('speechSynthesis' in window))return;\n  try{\n    window.speechSynthesis.cancel();\n    const u=new SpeechSynthesisUtterance(spoken.slice(0,600));\n    u.rate=rate;u.pitch=Math.max(.6,Math.min(1.2,Number(voicePreferences.pitch)||.86));\n    const voices=window.speechSynthesis.getVoices();\n    if(voicePreferences.browserVoice){const chosen=voices.find(v=>v.name===voicePreferences.browserVoice);if(chosen)u.voice=chosen}\n    window.speechSynthesis.speak(u);\n  }catch(e){}\n}\nasync function openVoiceSettings(){\n  let dlg=document.getElementById('arvis-voice-settings');\n  if(!dlg){dlg=document.createElement('dialog');dlg.id='arvis-voice-settings';dlg.style.cssText='border:0;border-radius:14px;padding:0;max-width:520px;width:calc(100% - 32px);box-shadow:0 24px 80px rgba(0,0,0,.35)';document.body.appendChild(dlg)}\n  let cloudVoices=[];try{const r=await fetch('/api/voice/voices');if(r.ok)cloudVoices=(await r.json()).voices||[]}catch(e){}\n  const browserVoices=('speechSynthesis'in window)?window.speechSynthesis.getVoices():[];\n  const cloudOptions=['<option value="">Default A.R.V.I.S. voice</option>',...cloudVoices.map(v=>\`<option value="\${esc(v.id)}" \${voicePreferences.voiceId===v.id?'selected':''}>\${esc(v.name)}</option>\`)].join('');\n  const browserOptions=['<option value="">Automatic Mac voice</option>',...browserVoices.map(v=>\`<option value="\${esc(v.name)}" \${voicePreferences.browserVoice===v.name?'selected':''}>\${esc(v.name)} — \${esc(v.lang)}</option>\`)].join('');\n  dlg.innerHTML=\`<div style="padding:18px"><div class="row" style="justify-content:space-between"><div><h2>A.R.V.I.S. Voice</h2><div class="small">Detailed answers stay on screen. Spoken answers stay short.</div></div><button class="btn ghost" onclick="document.getElementById('arvis-voice-settings').close()">Close</button></div><label>ElevenLabs voice</label><select id="arvisVoiceCloud">\${cloudOptions}</select><label>Mac fallback voice</label><select id="arvisVoiceBrowser">\${browserOptions}</select><label>Speaking speed <span id="arvisRateLabel">\${Number(voicePreferences.rate||1.08).toFixed(2)}x</span></label><input id="arvisVoiceRate" type="range" min="0.80" max="1.30" step="0.02" value="\${Number(voicePreferences.rate||1.08)}" oninput="document.getElementById('arvisRateLabel').textContent=Number(this.value).toFixed(2)+'x'"><label>Fallback pitch <span id="arvisPitchLabel">\${Number(voicePreferences.pitch||.86).toFixed(2)}</span></label><input id="arvisVoicePitch" type="range" min="0.60" max="1.20" step="0.02" value="\${Number(voicePreferences.pitch||.86)}" oninput="document.getElementById('arvisPitchLabel').textContent=Number(this.value).toFixed(2)"><label style="display:flex;gap:8px;align-items:center;text-transform:none"><input id="arvisVoiceCompact" type="checkbox" style="width:auto" \${voicePreferences.compact!==false?'checked':''}> Keep spoken answers short</label><div class="row" style="margin-top:16px"><button class="btn" onclick="saveVoiceSettings()">Save</button><button class="btn ghost" onclick="previewVoiceSettings()">Preview</button><button class="btn red" onclick="stopVoicePlayback()">Stop speaking</button></div></div>\`;\n  dlg.showModal();\n}\nfunction captureVoiceSettings(){return {voiceId:document.getElementById('arvisVoiceCloud')?.value||'',browserVoice:document.getElementById('arvisVoiceBrowser')?.value||'',rate:Number(document.getElementById('arvisVoiceRate')?.value||1.08),pitch:Number(document.getElementById('arvisVoicePitch')?.value||.86),compact:Boolean(document.getElementById('arvisVoiceCompact')?.checked)}}\nfunction saveVoiceSettings(){voicePreferences=captureVoiceSettings();localStorage.setItem('arvis.voice.preferences',JSON.stringify(voicePreferences));document.getElementById('arvis-voice-settings')?.close();toast('A.R.V.I.S. voice updated')}\nasync function previewVoiceSettings(){voicePreferences=captureVoiceSettings();await speak('Systems ready. I will keep spoken updates short and get straight to the point.')}\n`;
  ui = ui.slice(0, start) + voiceUi + ui.slice(end);
}

// Barge-in: starting the mic immediately interrupts speech.
const oldMic = `async function toggleMic(){\n  if(recognizing){stopMic();return}`;
const newMic = `async function toggleMic(){\n  if(recognizing){stopMic();return}\n  stopVoicePlayback();`;
ui = replaceExact(ui, oldMic, newMic, 'barge-in');

writeFileSync(serverPath, server);
writeFileSync(uiPath, ui);
console.log('[voice] A.R.V.I.S. voice ready: selectable voice, faster/calm defaults, compact speech, stop + barge-in.');
