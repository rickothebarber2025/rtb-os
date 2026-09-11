#!/usr/bin/env python3
"""Owner-only A.R.V.I.S./Ada control bridge for Tailscale Serve.

Binds to localhost only. Tailscale Serve provides the private HTTPS ingress.
No arbitrary shell execution is exposed.
"""
from __future__ import annotations
import hmac
import json
import os
import subprocess
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"
PORT = int(os.environ.get("ADA_CONTROL_PORT", "8791"))
TOKEN = os.environ.get("ADA_CONTROL_TOKEN", "").strip()
ADA_ARCHIVE_URL = os.environ.get("ADA_ARCHIVE_URL", "http://127.0.0.1:8790/api/messages/archive?sort=priority")
ADA_ARCHIVE_SYNC_URL = os.environ.get("ADA_ARCHIVE_SYNC_URL", "http://127.0.0.1:8790/api/messages/archive/sync")
SYNC_LABEL = "com.rtb.ada-sync"
WORKBENCH_DIR = os.path.expanduser(os.environ.get("NEURAL_WORKBENCH_DIR", "~/Downloads/neural-workbench"))
WORKBENCH_HEALTH_URL = os.environ.get("NEURAL_WORKBENCH_HEALTH_URL", "http://127.0.0.1:3000/api/health")
WORKBENCH_LOG = os.path.expanduser(os.environ.get("NEURAL_WORKBENCH_LOG", "~/.local/state/rtb/neural-workbench.log"))
WORKBENCH_PID_FILE = os.path.expanduser(os.environ.get("NEURAL_WORKBENCH_PID_FILE", "~/.local/state/rtb/neural-workbench.pid"))

CAPABILITIES = [
    "ada_sync_run",
    "ada_sync_restart",
    "messages_archive_check",
    "tailscale_status",
    "neural_workbench_status",
    "neural_workbench_start",
]

def run(cmd, timeout=20):
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
    return {"ok": proc.returncode == 0, "code": proc.returncode, "stdout": proc.stdout[-4000:], "stderr": proc.stderr[-4000:]}

def json_health(url, timeout=4):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            body = response.read(16384)
            payload = json.loads(body or b"{}")
            return {"ok": 200 <= response.status < 300, "status": response.status, "payload": payload}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}

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
    return {"online": online, "status": result, "serve": serve}

def launchd_status():
    uid = os.getuid()
    result = run(["/bin/launchctl", "print", f"gui/{uid}/{SYNC_LABEL}"], timeout=10)
    return {"loaded": result["ok"], "detail": result}

def workbench_status():
    health = json_health(WORKBENCH_HEALTH_URL)
    pid = None
    try:
        if os.path.exists(WORKBENCH_PID_FILE):
            with open(WORKBENCH_PID_FILE, "r", encoding="utf-8") as handle:
                pid = int(handle.read().strip())
    except Exception:
        pid = None
    return {
        "ok": bool(health.get("ok")),
        "running": bool(health.get("ok")),
        "health": health,
        "directory": WORKBENCH_DIR,
        "directory_exists": os.path.isdir(WORKBENCH_DIR),
        "pid": pid,
        "url": "http://127.0.0.1:3000",
    }

def start_workbench():
    current = workbench_status()
    if current.get("running"):
        return {"ok": True, "already_running": True, **current}
    package_json = os.path.join(WORKBENCH_DIR, "package.json")
    if not os.path.isfile(package_json):
        return {"ok": False, "error": f"Neural Workbench package.json not found at {package_json}", "directory": WORKBENCH_DIR}
    try:
        os.makedirs(os.path.dirname(WORKBENCH_LOG), exist_ok=True)
        with open(WORKBENCH_LOG, "ab", buffering=0) as log_handle:
            proc = subprocess.Popen(
                ["/usr/bin/env", "npm", "run", "dev"],
                cwd=WORKBENCH_DIR,
                stdin=subprocess.DEVNULL,
                stdout=log_handle,
                stderr=subprocess.STDOUT,
                start_new_session=True,
                env=os.environ.copy(),
            )
        with open(WORKBENCH_PID_FILE, "w", encoding="utf-8") as handle:
            handle.write(str(proc.pid))
        for _ in range(20):
            time.sleep(0.5)
            status = workbench_status()
            if status.get("running"):
                return {"ok": True, "started": True, "pid": proc.pid, "log": WORKBENCH_LOG, **status}
            if proc.poll() is not None:
                break
        return {"ok": False, "error": "Neural Workbench did not become healthy after startup.", "pid": proc.pid, "log": WORKBENCH_LOG}
    except Exception as exc:
        return {"ok": False, "error": str(exc), "directory": WORKBENCH_DIR}

def command(name):
    if name == "ada_sync_run":
        return archive_sync()
    if name == "ada_sync_restart":
        uid = os.getuid()
        return run(["/bin/launchctl", "kickstart", "-k", f"gui/{uid}/{SYNC_LABEL}"], timeout=20)
    if name == "messages_archive_check":
        return archive_check()
    if name == "tailscale_status":
        return tailscale_status()
    if name == "neural_workbench_status":
        return workbench_status()
    if name == "neural_workbench_start":
        return start_workbench()
    return {"ok": False, "error": "Unsupported command"}

class Handler(BaseHTTPRequestHandler):
    server_version = "ArvisControl/1.1"

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
            return self._json(200, {"ok": True, "service": "arvis-control", "port": PORT})
        if self.path == "/api/control/capabilities":
            return self._json(200, {"capabilities": CAPABILITIES})
        if self.path == "/api/control/status":
            return self._json(200, {
                "ada_archive": archive_check(),
                "ada_sync": launchd_status(),
                "tailscale": tailscale_status(),
                "neural_workbench": workbench_status(),
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
        print(f"[arvis-control] {self.address_string()} {fmt % args}")

if __name__ == "__main__":
    if not TOKEN:
        raise SystemExit("ADA_CONTROL_TOKEN is required")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
