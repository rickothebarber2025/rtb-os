#!/usr/bin/env python3
"""Owner-only A.R.V.I.S. control bridge.

Binds to localhost only. Tailscale Serve may provide private HTTPS ingress.
No arbitrary shell execution is exposed.
"""
from __future__ import annotations

import hmac
import json
import os
import re
import subprocess
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from operations_copilot import build_owner_brief, route_operations_prompt
from staff_reconciliation import failla_known_resolution, normalize_staff

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
    "system_status",
    "ada_sync_run",
    "ada_sync_restart",
    "messages_archive_check",
    "tailscale_status",
    "neural_workbench_status",
    "neural_workbench_start",
    "run_diagnostics",
    "staff_audit",
    "owner_brief",
    "payroll_safety",
]


def run(cmd, timeout=20):
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
    return {
        "ok": proc.returncode == 0,
        "code": proc.returncode,
        "stdout": proc.stdout[-4000:],
        "stderr": proc.stderr[-4000:],
    }


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
        request = urllib.request.Request(
            ADA_ARCHIVE_SYNC_URL,
            data=b"{}",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.loads(response.read(4096) or b"{}")
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
    result = run(["/bin/launchctl", "print", f"gui/{os.getuid()}/{SYNC_LABEL}"], timeout=10)
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
            used_bytes = max(total_bytes - free_pages * page_size, 0)
            memory_percent = round((used_bytes / total_bytes) * 100, 1) if total_bytes else None
        except Exception:
            memory_percent = None

    return {
        "ok": bool(disk["ok"] and mem_total["ok"] and vm["ok"]),
        "disk_used_percent": disk_percent,
        "disk_free_kb": disk_free_kb,
        "memory_used_percent": memory_percent,
    }


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
        return {"ok": False, "error": f"Neural Workbench package.json not found at {package_json}"}
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
        return {"ok": False, "error": str(exc)}


def diagnostics():
    system = system_status()
    archive = archive_check()
    sync = launchd_status()
    tailscale = tailscale_status()
    workbench = workbench_status()
    return {
        "ok": bool(system.get("ok") and sync.get("ok") and tailscale.get("online") and workbench.get("running")),
        "system": system,
        "ada_archive": archive,
        "ada_sync": sync,
        "tailscale": tailscale,
        "neural_workbench": workbench,
    }


def staff_audit(staff):
    canonical = normalize_staff(staff)
    if canonical.casefold() == "failla mika":
        return {"ok": True, "reconciliation": failla_known_resolution()}
    return {"ok": False, "error": f"No verified reconciliation is available for {canonical or 'that staff member'}."}


def command(name, payload=None):
    payload = payload or {}
    if name == "system_status":
        return system_status()
    if name == "ada_sync_run":
        return archive_sync()
    if name == "ada_sync_restart":
        return run(["/bin/launchctl", "kickstart", "-k", f"gui/{os.getuid()}/{SYNC_LABEL}"], timeout=20)
    if name == "messages_archive_check":
        return archive_check()
    if name == "tailscale_status":
        return tailscale_status()
    if name == "neural_workbench_status":
        return workbench_status()
    if name == "neural_workbench_start":
        return start_workbench()
    if name == "run_diagnostics":
        return diagnostics()
    if name == "staff_audit":
        return staff_audit(str(payload.get("staff", "")))
    if name in {"owner_brief", "payroll_safety"}:
        brief = build_owner_brief(payload.get("snapshot") or {})
        return {"ok": True, "brief": brief, "safe": brief["safe_to_run_payroll"]}
    return {"ok": False, "error": "Unsupported command"}


def jarvis_prompt(text, snapshot=None):
    prompt = " ".join(str(text or "").strip().split())
    ops = route_operations_prompt(prompt, snapshot or {})
    if ops.get("handled"):
        return ops
    lowered = prompt.casefold()
    if "failla" in lowered and any(word in lowered for word in ("audit", "pay", "payroll", "owe", "owed", "outstanding", "reconcile", "check")):
        return {"handled": True, "intent": "staff_audit", **staff_audit("Failla Mika")}
    match = re.search(r"(?:audit|check|reconcile)\s+([a-z][a-z .'-]+)$", prompt, re.I)
    if match:
        result = staff_audit(match.group(1))
        return {"handled": result.get("ok", False), "intent": "staff_audit", **result}
    return {"handled": False}


class Handler(BaseHTTPRequestHandler):
    server_version = "ArvisControl/1.3"

    def _json(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", "*"))
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        if code != 204:
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
            return self._json(200, {"ok": True, "service": "arvis-control", "version": "1.3", "port": PORT})
        if self.path == "/api/control/capabilities":
            return self._json(200, {"capabilities": CAPABILITIES})
        if self.path == "/api/control/status":
            return self._json(200, {
                "system": system_status(),
                "ada_archive": archive_check(),
                "ada_sync": launchd_status(),
                "tailscale": tailscale_status(),
                "neural_workbench": workbench_status(),
            })
        if self.path == "/api/staff/failla/audit":
            return self._json(200, staff_audit("Failla Mika"))
        return self._json(404, {"error": "Not found"})

    def do_POST(self):
        if not self._authorized():
            return self._json(401, {"error": "Unauthorized"})
        try:
            length = min(int(self.headers.get("Content-Length", "0")), 65536)
            payload = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            return self._json(400, {"error": "Invalid JSON"})

        if self.path == "/api/jarvis/query":
            return self._json(200, jarvis_prompt(payload.get("message") or payload.get("prompt") or "", payload.get("snapshot")))
        if self.path != "/api/control/commands":
            return self._json(404, {"error": "Not found"})

        name = str(payload.get("command", ""))
        if name not in CAPABILITIES:
            return self._json(400, {"error": "Unsupported command"})
        result = command(name, payload)
        return self._json(200 if result.get("ok") else 500, {"command": name, **result})

    def log_message(self, fmt, *args):
        print(f"[arvis-control] {self.address_string()} {fmt % args}")


if __name__ == "__main__":
    if not TOKEN:
        raise SystemExit("ADA_CONTROL_TOKEN is required")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
