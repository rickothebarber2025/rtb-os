#!/usr/bin/env python3
"""Owner-only Ada/Jarvis control bridge for Tailscale Serve."""
from __future__ import annotations
import hmac
import json
import os
import re
import subprocess
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from staff_reconciliation import failla_known_resolution, normalize_staff

HOST = "127.0.0.1"
PORT = int(os.environ.get("ADA_CONTROL_PORT", "8791"))
TOKEN = os.environ.get("ADA_CONTROL_TOKEN", "").strip()
ADA_ARCHIVE_URL = os.environ.get("ADA_ARCHIVE_URL", "http://127.0.0.1:8790/api/messages/archive?sort=priority")
ADA_ARCHIVE_SYNC_URL = os.environ.get("ADA_ARCHIVE_SYNC_URL", "http://127.0.0.1:8790/api/messages/archive/sync")
SYNC_LABEL = "com.rtb.ada-sync"

CAPABILITIES = ["ada_sync_run", "ada_sync_restart", "messages_archive_check", "tailscale_status", "staff_audit"]

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
    return {"ok": result["ok"], "online": online, "status": result, "serve": serve}

def launchd_status():
    uid = os.getuid()
    result = run(["/bin/launchctl", "print", f"gui/{uid}/{SYNC_LABEL}"], timeout=10)
    return {"loaded": result["ok"], "detail": result}

def staff_audit(staff):
    canonical = normalize_staff(staff)
    if canonical.casefold() == "failla mika":
        audit = failla_known_resolution()
        return {"ok": True, "audit": audit, "summary": f"Failla is reconciled. Expected ${audit['expected_pay']:.2f}, paid ${audit['paid_total']:.2f}, outstanding $0.00."}
    return {"ok": False, "error": f"No persisted reconciliation is available yet for {canonical}."}

def command(name, payload=None):
    payload = payload or {}
    if name == "ada_sync_run": return archive_sync()
    if name == "ada_sync_restart":
        uid = os.getuid(); return run(["/bin/launchctl", "kickstart", "-k", f"gui/{uid}/{SYNC_LABEL}"], timeout=20)
    if name == "messages_archive_check": return archive_check()
    if name == "tailscale_status": return tailscale_status()
    if name == "staff_audit": return staff_audit(str(payload.get("staff", "")))
    return {"ok": False, "error": "Unsupported command"}

def jarvis_prompt(text):
    """Handle deterministic RTB questions before falling through to the LLM."""
    prompt = " ".join(str(text or "").strip().split())
    lowered = prompt.casefold()
    if "failla" in lowered and any(word in lowered for word in ("audit", "pay", "payroll", "owe", "owed", "outstanding", "reconcile", "check")):
        result = staff_audit("Failla Mika")
        return {"handled": True, "intent": "staff_audit", **result}
    match = re.search(r"(?:audit|check|reconcile)\s+([a-z][a-z .'-]+)$", prompt, re.I)
    if match:
        result = staff_audit(match.group(1))
        return {"handled": result.get("ok", False), "intent": "staff_audit", **result}
    return {"handled": False}

class Handler(BaseHTTPRequestHandler):
    server_version = "AdaControl/1.1"
    def _json(self, code, payload):
        body = json.dumps(payload).encode(); self.send_response(code)
        self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", "*")); self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS"); self.end_headers(); self.wfile.write(body)
    def _authorized(self):
        if not TOKEN: return False
        supplied = self.headers.get("Authorization", ""); supplied = supplied[7:] if supplied.startswith("Bearer ") else supplied
        return hmac.compare_digest(supplied, TOKEN)
    def do_OPTIONS(self): self._json(204, {})
    def do_GET(self):
        if not self._authorized(): return self._json(401, {"error": "Unauthorized"})
        if self.path == "/api/health": return self._json(200, {"ok": True, "service": "ada-control", "port": PORT})
        if self.path == "/api/control/capabilities": return self._json(200, {"capabilities": CAPABILITIES})
        if self.path == "/api/control/status": return self._json(200, {"ada_archive": archive_check(), "ada_sync": launchd_status(), "tailscale": tailscale_status()})
        if self.path == "/api/staff/failla/audit": return self._json(200, staff_audit("Failla Mika"))
        return self._json(404, {"error": "Not found"})
    def do_POST(self):
        if not self._authorized(): return self._json(401, {"error": "Unauthorized"})
        try:
            length = min(int(self.headers.get("Content-Length", "0")), 16384)
            payload = json.loads(self.rfile.read(length) or b"{}")
        except Exception: return self._json(400, {"error": "Invalid JSON"})
        if self.path == "/api/jarvis/query":
            result = jarvis_prompt(payload.get("message") or payload.get("prompt") or "")
            return self._json(200, result)
        if self.path != "/api/control/commands": return self._json(404, {"error": "Not found"})
        name = str(payload.get("command", ""))
        if name not in CAPABILITIES: return self._json(400, {"error": "Unsupported command"})
        result = command(name, payload)
        return self._json(200 if result.get("ok") else 500, {"command": name, **result})
    def log_message(self, fmt, *args): print(f"[ada-control] {self.address_string()} {fmt % args}")

if __name__ == "__main__":
    if not TOKEN: raise SystemExit("ADA_CONTROL_TOKEN is required")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
