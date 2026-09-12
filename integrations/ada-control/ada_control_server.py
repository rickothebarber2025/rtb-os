#!/usr/bin/env python3
"""Owner-only Ada/Jarvis control bridge for Tailscale Serve."""
from __future__ import annotations
import hmac, json, os, re, subprocess, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from staff_reconciliation import failla_known_resolution, normalize_staff
from operations_copilot import route_operations_prompt, build_owner_brief

HOST="127.0.0.1"; PORT=int(os.environ.get("ADA_CONTROL_PORT","8791")); TOKEN=os.environ.get("ADA_CONTROL_TOKEN","").strip()
ADA_ARCHIVE_URL=os.environ.get("ADA_ARCHIVE_URL","http://127.0.0.1:8790/api/messages/archive?sort=priority")
ADA_ARCHIVE_SYNC_URL=os.environ.get("ADA_ARCHIVE_SYNC_URL","http://127.0.0.1:8790/api/messages/archive/sync"); SYNC_LABEL="com.rtb.ada-sync"
CAPABILITIES=["ada_sync_run","ada_sync_restart","messages_archive_check","tailscale_status","staff_audit","owner_brief","payroll_safety"]

def run(cmd,timeout=20):
 p=subprocess.run(cmd,capture_output=True,text=True,timeout=timeout,check=False); return {"ok":p.returncode==0,"code":p.returncode,"stdout":p.stdout[-4000:],"stderr":p.stderr[-4000:]}
def archive_check():
 try:
  with urllib.request.urlopen(ADA_ARCHIVE_URL,timeout=5) as r: body=r.read(4096); return {"ok":200<=r.status<300,"status":r.status,"bytes_sampled":len(body)}
 except Exception as e:return {"ok":False,"error":str(e)}
def archive_sync():
 try:
  q=urllib.request.Request(ADA_ARCHIVE_SYNC_URL,data=b"{}",headers={"Content-Type":"application/json"},method="POST")
  with urllib.request.urlopen(q,timeout=60) as r:return {"ok":200<=r.status<300,"status":r.status,"result":json.loads(r.read(4096) or b"{}")}
 except Exception as e:return {"ok":False,"error":str(e)}
def tailscale_status():
 result=run(["/usr/bin/env","tailscale","status","--json"],10); online=False
 if result["ok"]:
  try:
   p=json.loads(result["stdout"]); online=bool(p.get("BackendState")=="Running" or p.get("Self",{}).get("Online"))
  except Exception:pass
 return {"ok":result["ok"],"online":online,"status":result,"serve":run(["/usr/bin/env","tailscale","serve","status","--json"],10)}
def launchd_status():
 r=run(["/bin/launchctl","print",f"gui/{os.getuid()}/{SYNC_LABEL}"],10); return {"loaded":r["ok"],"detail":r}
def staff_audit(staff):
 canonical=normalize_staff(staff)
 if canonical.casefold()=="failla mika":
  a=failla_known_resolution(); return {"ok":True,"audit":a,"summary":f"Failla is reconciled. Expected ${a['expected_pay']:.2f}, paid ${a['paid_total']:.2f}, outstanding $0.00."}
 return {"ok":False,"error":f"No persisted reconciliation is available yet for {canonical}."}
def command(name,payload=None):
 payload=payload or {}
 if name=="ada_sync_run":return archive_sync()
 if name=="ada_sync_restart":return run(["/bin/launchctl","kickstart","-k",f"gui/{os.getuid()}/{SYNC_LABEL}"],20)
 if name=="messages_archive_check":return archive_check()
 if name=="tailscale_status":return tailscale_status()
 if name=="staff_audit":return staff_audit(str(payload.get("staff","")))
 if name in {"owner_brief","payroll_safety"}:
  brief=build_owner_brief(payload.get("snapshot") or {}); return {"ok":True,"brief":brief,"safe":brief["safe_to_run_payroll"]}
 return {"ok":False,"error":"Unsupported command"}
def jarvis_prompt(text,snapshot=None):
 prompt=" ".join(str(text or "").strip().split()); lowered=prompt.casefold()
 ops=route_operations_prompt(prompt,snapshot or {})
 if ops.get("handled"):return ops
 if "failla" in lowered and any(w in lowered for w in ("audit","pay","payroll","owe","owed","outstanding","reconcile","check")):
  return {"handled":True,"intent":"staff_audit",**staff_audit("Failla Mika")}
 m=re.search(r"(?:audit|check|reconcile)\s+([a-z][a-z .'-]+)$",prompt,re.I)
 if m:
  r=staff_audit(m.group(1)); return {"handled":r.get("ok",False),"intent":"staff_audit",**r}
 return {"handled":False}
class Handler(BaseHTTPRequestHandler):
 server_version="AdaControl/1.2"
 def _json(self,code,payload):
  body=json.dumps(payload).encode(); self.send_response(code); self.send_header("Content-Type","application/json"); self.send_header("Content-Length",str(len(body))); self.send_header("Access-Control-Allow-Origin",self.headers.get("Origin","*")); self.send_header("Access-Control-Allow-Headers","Authorization, Content-Type"); self.send_header("Access-Control-Allow-Methods","GET, POST, OPTIONS"); self.end_headers(); self.wfile.write(body)
 def _authorized(self):
  if not TOKEN:return False
  s=self.headers.get("Authorization",""); s=s[7:] if s.startswith("Bearer ") else s; return hmac.compare_digest(s,TOKEN)
 def do_OPTIONS(self):self._json(204,{})
 def do_GET(self):
  if not self._authorized():return self._json(401,{"error":"Unauthorized"})
  if self.path=="/api/health":return self._json(200,{"ok":True,"service":"ada-control","port":PORT,"version":"1.2"})
  if self.path=="/api/control/capabilities":return self._json(200,{"capabilities":CAPABILITIES})
  if self.path=="/api/control/status":return self._json(200,{"ada_archive":archive_check(),"ada_sync":launchd_status(),"tailscale":tailscale_status()})
  if self.path=="/api/staff/failla/audit":return self._json(200,staff_audit("Failla Mika"))
  return self._json(404,{"error":"Not found"})
 def do_POST(self):
  if not self._authorized():return self._json(401,{"error":"Unauthorized"})
  try:
   length=min(int(self.headers.get("Content-Length","0")),65536); payload=json.loads(self.rfile.read(length) or b"{}")
  except Exception:return self._json(400,{"error":"Invalid JSON"})
  if self.path=="/api/jarvis/query":return self._json(200,jarvis_prompt(payload.get("message") or payload.get("prompt") or "",payload.get("snapshot")))
  if self.path!="/api/control/commands":return self._json(404,{"error":"Not found"})
  name=str(payload.get("command",""))
  if name not in CAPABILITIES:return self._json(400,{"error":"Unsupported command"})
  r=command(name,payload); return self._json(200 if r.get("ok") else 500,{"command":name,**r})
 def log_message(self,fmt,*args):print(f"[ada-control] {self.address_string()} {fmt % args}")
if __name__=="__main__":
 if not TOKEN:raise SystemExit("ADA_CONTROL_TOKEN is required")
 ThreadingHTTPServer((HOST,PORT),Handler).serve_forever()
