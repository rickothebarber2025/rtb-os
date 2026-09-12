#!/usr/bin/env python3
"""Owner-only Ada/Jarvis control bridge for Tailscale Serve."""
from __future__ import annotations
import hmac, json, os, re, subprocess, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from staff_reconciliation import failla_known_resolution, normalize_staff
from operations_copilot import route_operations_prompt, build_owner_brief

HOST = "127.0.0.1"
PORT = int(os.environ.get("ADA_CONTROL_PORT", "8791"))
TOKEN = os.environ.get("ADA_CONTROL_TOKEN", "").strip()
ADA_ARCHIVE_URL = os.environ.get("ADA_ARCHIVE_URL", "http://127.0.0.1:8790/api/messages/archive?sort=priority")
ADA_ARCHIVE_SYNC_URL = os.environ.get("ADA_ARCHIVE_SYNC_URL", "http://127.0.0.1:8790/api/messages/archive/sync")
SYNC_LABEL = "com.rtb.ada-sync"

CAPABILITIES = [
    "system_status",
    "ada_sync_run",
    "ada_sync_restart",
    "messages_archive_check",
    "tailscale_status",
    "run_diagnostics",
]


def run(cmd, timeout=20):
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
    return {"ok": proc.returncode == 0, "code": proc.returncode, "stdout": proc.stdout[-4000:], "stderr": proc.stderr[-4000:]}


def archive_check():
    try:
        with urllib.request.urlopen(ADA_ARCHIVE_URL, timeout=5) as response:
            body = response.read(4096)
            return {"ok": 200 <= response.status < 300, "status": response.status, "bytes_sampled": len(body)}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def archive_sync():
    try:
        request = urllib.request.Request(ADA_ARCHIVE_SYNC_URL, data=b"{}", headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(request, timeout=60) as response:
            body = response.read(4096)
            payload = json.loads(body or b"{}")
            return {"ok": 200 <= response.status < 300, "status": response.status, "result": payload}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def tailscale_status():
    result = run(["/usr/bin/env", "tailscale", "status", "--json"], timeout=10)
    online = False
    if result["ok"]:
        try:
            payload = json.loads(result["stdout"])
            online = bool(payload.get("BackendState") == "Running" or payload.get("Self", {}).get("Online"))
        except Exception:
            pass
    serve = run(["/usr/bin/env", "tailscale", "serve", "status", "--json"], timeout=10)
    return {"ok": bool(result["ok"] and online), "online": online, "status": result, "serve": serve}


def launchd_status():
    uid = os.getuid()
    result = run(["/bin/launchctl", "print", f"gui/{uid}/{SYNC_LABEL}"], timeout=10)
    return {"ok": result["ok"], "loaded": result["ok"], "detail": result}


def system_status():
    disk = run(["/bin/df", "-Pk", "/"], timeout=10)
    disk_percent = None
    disk_free_kb = None
    if disk["ok"]:
        lines = [line for line in disk["stdout"].splitlines() if line.strip()]
        if len(lines) >= 2:
            parts = lines[-1].split()
            if len(parts) >= 5:
                try:
                    disk_free_kb = int(parts[3])
                except ValueError:
                    pass
                try:
                    disk_percent = float(parts[4].rstrip("%"))
                except ValueError:
                    pass

    mem_total = run(["/usr/sbin/sysctl", "-n", "hw.memsize"], timeout=10)
    vm = run(["/usr/bin/vm_stat"], timeout=10)
    memory_percent = None
    if mem_total["ok"] and vm["ok"]:
        try:
            total_bytes = int(mem_total["stdout"].strip())
            page_size = 4096
            first_line = vm["stdout"].splitlines()[0] if vm["stdout"].splitlines() else ""
            if "page size of" in first_line:
                page_size = int(first_line.split("page size of", 1)[1].split("bytes", 1)[0].strip())
            values = {}
            for line in vm["stdout"].splitlines()[1:]:
                if ":" not in line:
                    continue
                key, raw = line.split(":", 1)
                try:
                    values[key.strip()] = int(raw.strip().rstrip("."))
                except ValueError:
                    continue
            free_pages = values.get("Pages free", 0) + values.get("Pages speculative", 0)
            available_bytes = free_pages * page_size
            used_bytes = max(total_bytes - available_bytes, 0)
            memory_percent = round((used_bytes / total_bytes) * 100, 1) if total_bytes else None
        except Exception:
            memory_percent = None

    return {
        "ok": bool(disk["ok"] and mem_total["ok"] and vm["ok"]),
        "disk_used_percent": disk_percent,
        "disk_free_kb": disk_free_kb,
        "memory_used_percent": memory_percent,
    }


def diagnostics():
    system = system_status()
    archive = archive_check()
    sync = launchd_status()
    tailscale = tailscale_status()
    return {
        "ok": bool(system.get("ok") and archive.get("ok") and sync.get("ok") and tailscale.get("online")),
        "system": system,
        "ada_archive": archive,
        "ada_sync": sync,
        "tailscale": tailscale,
    }


def command(name):
    if name == "system_status":
        return system_status()
    if name == "ada_sync_run":
        return archive_sync()
    if name == "ada_sync_restart":
        uid = os.getuid()
        return run(["/bin/launchctl", "kickstart", "-k", f"gui/{uid}/{SYNC_LABEL}"], timeout=20)
    if name == "messages_archive_check":
        return archive_check()
    if name == "tailscale_status":
        return tailscale_status()
    if name == "run_diagnostics":
        return diagnostics()
    return {"ok": False, "error": "Unsupported command"}


class Handler(BaseHTTPRequestHandler):
    server_version = "AdaControl/1.1"

    def _json(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", "*"))
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self):
        if not TOKEN:
            return False
        supplied = self.headers.get("Authorization", "")
        if supplied.startswith("Bearer "):
            supplied = supplied[7:]
        return hmac.compare_digest(supplied, TOKEN)

    def do_OPTIONS(self):
        self._json(204, {})

    def do_GET(self):
        if not self._authorized():
            return self._json(401, {"error": "Unauthorized"})
        if self.path == "/api/health":
            return self._json(200, {"ok": True, "service": "ada-control", "port": PORT})
        if self.path == "/api/control/capabilities":
            return self._json(200, {"capabilities": CAPABILITIES})
        if self.path == "/api/control/status":
            return self._json(200, {
                "system": system_status(),
                "ada_archive": archive_check(),
                "ada_sync": launchd_status(),
                "tailscale": tailscale_status(),
            })
        return self._json(404, {"error": "Not found"})

    def do_POST(self):
        if not self._authorized():
            return self._json(401, {"error": "Unauthorized"})
        if self.path != "/api/control/commands":
            return self._json(404, {"error": "Not found"})
        try:
            length = min(int(self.headers.get("Content-Length", "0")), 4096)
            payload = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            return self._json(400, {"error": "Invalid JSON"})
        name = str(payload.get("command", ""))
        if name not in CAPABILITIES:
            return self._json(400, {"error": "Unsupported command"})
        result = command(name)
        return self._json(200 if result.get("ok") else 500, {"command": name, **result})

    def log_message(self, fmt, *args):
        print(f"[ada-control] {self.address_string()} {fmt % args}")


if __name__ == "__main__":
    if not TOKEN:
        raise SystemExit("ADA_CONTROL_TOKEN is required")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
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
