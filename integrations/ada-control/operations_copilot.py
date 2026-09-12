#!/usr/bin/env python3
"""Jarvis operations copilot core for RTB Lounge + RTB Beauty Lounge.

Pure decision layer: callers feed trusted RTB OS/Square/payroll/scheduling data.
Jarvis converts it into owner-facing priorities without inventing missing data.
"""
from __future__ import annotations
from dataclasses import dataclass, asdict
from typing import Any, Iterable, Mapping

@dataclass
class Action:
    severity: str
    area: str
    title: str
    detail: str
    staff: str | None = None
    requires_owner: bool = True

    def json(self): return asdict(self)

SEVERITY_ORDER = {"red": 0, "yellow": 1, "green": 2}

def _num(v):
    try: return float(v or 0)
    except (TypeError, ValueError): return 0.0

def build_owner_brief(snapshot: Mapping[str, Any]) -> dict[str, Any]:
    actions: list[Action] = []
    staff = list(snapshot.get("staff") or [])
    payroll = list(snapshot.get("payroll") or [])
    coverage = list(snapshot.get("coverage") or [])
    appointments = list(snapshot.get("appointments") or [])

    for row in payroll:
        outstanding = _num(row.get("outstanding"))
        status = str(row.get("status") or "").lower()
        name = str(row.get("staff") or row.get("name") or "Staff")
        if abs(outstanding) >= .01 or status in {"underpaid", "overpaid", "mismatch"}:
            direction = "owed" if outstanding > 0 else "overpaid"
            actions.append(Action("red", "payroll", f"Payroll discrepancy · {name}", f"{direction}: ${abs(outstanding):.2f}", name))

    for row in coverage:
        if row.get("covered") is False or row.get("gap"):
            unit = row.get("business") or row.get("unit") or "RTB"
            window = row.get("window") or row.get("gap") or "coverage gap"
            actions.append(Action("yellow", "coverage", f"{unit} coverage gap", str(window)))

    for member in staff:
        name = str(member.get("name") or member.get("full_name") or "Staff")
        if member.get("late_open") or member.get("late"):
            actions.append(Action("yellow", "attendance", f"Attendance · {name}", "Late attendance/opening detected.", name))
        if member.get("no_show"):
            actions.append(Action("red", "attendance", f"No-show · {name}", "Scheduled staff member did not attend.", name))

    unmatched = [a for a in appointments if a.get("completed") and a.get("payment_found") is False]
    if unmatched:
        actions.append(Action("red", "payments", "Completed services missing payment", f"{len(unmatched)} completed appointment(s) have no matched payment."))

    actions.sort(key=lambda a: SEVERITY_ORDER.get(a.severity, 9))
    red = sum(a.severity == "red" for a in actions)
    yellow = sum(a.severity == "yellow" for a in actions)
    overall = "red" if red else "yellow" if yellow else "green"
    return {
        "status": overall,
        "needs_attention": [a.json() for a in actions],
        "counts": {"red": red, "yellow": yellow, "appointments_checked": len(appointments), "staff_checked": len(staff), "payroll_checked": len(payroll)},
        "safe_to_run_payroll": not any(a.area == "payroll" and a.severity == "red" for a in actions),
        "message": "No exceptions require attention." if not actions else f"{len(actions)} item(s) need attention.",
    }

def route_operations_prompt(prompt: str, snapshot: Mapping[str, Any] | None = None) -> dict[str, Any]:
    text = " ".join(str(prompt or "").lower().split())
    snapshot = snapshot or {}
    if any(p in text for p in ("what needs my attention", "how are the shops", "how is the shop", "daily brief", "owner brief", "operations today")):
        return {"handled": True, "intent": "owner_brief", "brief": build_owner_brief(snapshot)}
    if any(p in text for p in ("payroll safe", "safe to send payroll", "can i send payroll", "payroll ready")):
        brief = build_owner_brief(snapshot)
        return {"handled": True, "intent": "payroll_safety", "safe": brief["safe_to_run_payroll"], "brief": brief}
    return {"handled": False}
