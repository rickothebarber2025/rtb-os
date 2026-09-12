#!/usr/bin/env python3
"""Sync actionable Ada local archive items into RTB OS Supabase.

Privacy defaults:
- Reads only the owner-authorized localhost archive.
- Syncs only records explicitly marked actionable or linked to a task.
- Stores the concise local summary as message_text by default, not the full message.
- Never sends replies or creates external actions.
- Never embeds credentials in source code.

Required environment:
  SUPABASE_URL=https://qbeficojfoqgzjxrzxyg.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=...

Optional environment:
  ADA_ARCHIVE_URL=http://127.0.0.1:8790/api/messages/archive?sort=priority
  ADA_SYNC_FULL_TEXT=0
  ADA_SYNC_ALLOW_INFERRED=0
  ADA_SYNC_TIMEOUT_SECONDS=8
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Iterable, List, Optional

DEFAULT_ARCHIVE_URL = "http://127.0.0.1:8790/api/messages/archive?sort=priority"
DEFAULT_SUPABASE_URL = "https://qbeficojfoqgzjxrzxyg.supabase.co"
SOURCE = "ada-local"
UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def nested(obj: Dict[str, Any], *paths: str) -> Any:
    for path in paths:
        cur: Any = obj
        ok = True
        for part in path.split("."):
            if not isinstance(cur, dict) or part not in cur:
                ok = False
                break
            cur = cur[part]
        if ok and cur not in (None, ""):
            return cur
    return None


def as_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        v = value.strip()
        return v or None
    if isinstance(value, (int, float, bool)):
        return str(value)
    return None


def valid_uuid(value: Any) -> Optional[str]:
    text = as_text(value)
    return text if text and UUID_RE.match(text) else None


def normalize_priority(value: Any) -> str:
    raw = (as_text(value) or "low").lower()
    aliases = {
        "critical": "critical",
        "urgent": "critical",
        "p0": "critical",
        "high": "high",
        "p1": "high",
        "medium": "medium",
        "normal": "medium",
        "p2": "medium",
        "low": "low",
        "p3": "low",
    }
    return aliases.get(raw, "low")


def normalize_status(value: Any) -> str:
    raw = (as_text(value) or "open").lower().replace(" ", "_")
    aliases = {
        "new": "new",
        "open": "open",
        "pending": "pending",
        "action_required": "open",
        "needs_action": "open",
        "in_progress": "in_progress",
        "resolved": "resolved",
        "complete": "resolved",
        "completed": "resolved",
        "done": "resolved",
        "closed": "resolved",
        "dismissed": "dismissed",
    }
    return aliases.get(raw, raw[:48] or "open")


def extract_items(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("items", "messages", "archive", "data", "results"):
        value = payload.get(key)
        if isinstance(value, list):
            return [x for x in value if isinstance(x, dict)]
        if isinstance(value, dict):
            for nested_key in ("items", "messages", "archive", "results"):
                inner = value.get(nested_key)
                if isinstance(inner, list):
                    return [x for x in inner if isinstance(x, dict)]
    return []


def explicit_actionable(item: Dict[str, Any], allow_inferred: bool) -> bool:
    flags = [
        nested(item, "actionable", "is_actionable", "action_required", "needs_action"),
        nested(item, "classification.actionable", "classification.action_required"),
        nested(item, "local_inference.actionable", "local_inference.action_required"),
    ]
    for flag in flags:
        if isinstance(flag, bool) and flag:
            return True
        if isinstance(flag, str) and flag.strip().lower() in {"true", "yes", "1", "actionable", "required"}:
            return True

    task_signal = nested(
        item,
        "created_task_id",
        "task_id",
        "linked_task_id",
        "task.id",
        "task.task_id",
        "linked_task.id",
        "linked_task.task_id",
        "task_due_date",
        "task.due_date",
        "linked_task.due_date",
    )
    if task_signal not in (None, ""):
        return True

    if allow_inferred:
        priority = nested(item, "priority", "classification.priority", "local_inference.priority")
        topic = nested(item, "topic", "category", "classification.topic", "local_inference.topic")
        status = normalize_status(nested(item, "resolution_status", "status", "task.status"))
        return priority not in (None, "") and topic not in (None, "") and status not in {"resolved", "dismissed"}

    return False


def to_iso(value: Any) -> str:
    text = as_text(value)
    if not text:
        return dt.datetime.now(dt.timezone.utc).isoformat()
    if text.endswith("Z"):
        return text
    try:
        parsed = dt.datetime.fromisoformat(text)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        return parsed.isoformat()
    except ValueError:
        return dt.datetime.now(dt.timezone.utc).isoformat()


def stable_source_key(item: Dict[str, Any], sender: str, message_at: str, summary: str) -> str:
    existing = as_text(nested(item, "source_key", "id", "message_id", "archive_id", "local_id"))
    if existing:
        return existing[:240]
    digest = hashlib.sha256(f"{sender}|{message_at}|{summary}".encode("utf-8")).hexdigest()
    return digest


def normalize_item(item: Dict[str, Any], full_text: bool) -> Dict[str, Any]:
    sender = as_text(nested(item, "participant_name", "sender_name", "participant.name", "sender.name", "contact.name")) or "Unknown"
    sender_handle = as_text(nested(item, "sender_handle", "participant_handle", "participant.handle", "sender.handle", "contact.handle"))
    topic = as_text(nested(item, "topic", "category", "classification.topic", "local_inference.topic")) or "general"
    priority = normalize_priority(nested(item, "priority", "classification.priority", "local_inference.priority"))
    status = normalize_status(nested(item, "resolution_status", "status", "task.status", "linked_task.status"))
    message_at = to_iso(nested(item, "original_message_date", "message_at", "message_date", "date", "timestamp", "created_at"))

    raw_message = as_text(nested(item, "message_text", "message", "text", "content", "body"))
    summary = as_text(nested(item, "summary", "content_summary", "classification.summary", "local_inference.summary"))
    if not summary:
        summary = raw_message or "Actionable Ada message"
        if len(summary) > 500:
            summary = summary[:497] + "..."

    task_id = valid_uuid(nested(item, "created_task_id", "task_id", "linked_task_id", "task.id", "linked_task.id"))
    task_due_date = as_text(nested(item, "task_due_date", "due_date", "task.due_date", "linked_task.due_date"))
    business_unit_id = valid_uuid(nested(item, "business_unit_id", "business_id"))
    staff_id = valid_uuid(nested(item, "staff_id"))

    source_key = stable_source_key(item, sender, message_at, summary)
    message_text = raw_message if full_text and raw_message else summary

    metadata = {
        "topic_locally_inferred": topic,
        "priority_locally_inferred": priority,
        "resolution_status": status,
        "task_due_date": task_due_date,
        "local_archive": True,
        "privacy_mode": "full_text" if full_text else "summary_only",
        "synced_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }

    return {
        "business_unit_id": business_unit_id,
        "staff_id": staff_id,
        "sender_name": sender,
        "sender_handle": sender_handle,
        "message_text": message_text,
        "message_at": message_at,
        "category": topic,
        "priority": priority,
        "status": status,
        "summary": summary,
        "suggested_reply": None,
        "source": SOURCE,
        "source_key": source_key,
        "created_task_id": task_id,
        "metadata": metadata,
    }


class SupabaseRest:
    def __init__(self, url: str, key: str, timeout: float):
        self.base = url.rstrip("/") + "/rest/v1/ada_inbox_items"
        self.key = key
        self.timeout = timeout

    def _request(self, method: str, url: str, body: Optional[Dict[str, Any]] = None, prefer: Optional[str] = None) -> Any:
        headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if prefer:
            headers["Prefer"] = prefer
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else None

    def find_existing_id(self, source_key: str) -> Optional[str]:
        q = urllib.parse.urlencode({"select": "id", "source": f"eq.{SOURCE}", "source_key": f"eq.{source_key}", "limit": "1"})
        rows = self._request("GET", f"{self.base}?{q}") or []
        if isinstance(rows, list) and rows:
            return as_text(rows[0].get("id"))
        return None

    def save(self, record: Dict[str, Any]) -> str:
        existing_id = self.find_existing_id(record["source_key"])
        if existing_id:
            q = urllib.parse.urlencode({"id": f"eq.{existing_id}"})
            self._request("PATCH", f"{self.base}?{q}", record, prefer="return=minimal")
            return "updated"
        self._request("POST", self.base, record, prefer="return=minimal")
        return "inserted"


def fetch_local_archive(url: str, timeout: float) -> Any:
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "RTB-Ada-Sync/1.0"}, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    archive_url = os.getenv("ADA_ARCHIVE_URL", DEFAULT_ARCHIVE_URL)
    supabase_url = os.getenv("SUPABASE_URL", DEFAULT_SUPABASE_URL)
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    timeout = float(os.getenv("ADA_SYNC_TIMEOUT_SECONDS", "8"))
    full_text = env_bool("ADA_SYNC_FULL_TEXT", False)
    allow_inferred = env_bool("ADA_SYNC_ALLOW_INFERRED", False)

    if not key:
        print("ADA_SYNC_ERROR missing SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 2

    try:
        payload = fetch_local_archive(archive_url, timeout)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
        print(f"ADA_SYNC_LOCAL_UNAVAILABLE {exc}", file=sys.stderr)
        return 3

    items = extract_items(payload)
    actionable = [item for item in items if explicit_actionable(item, allow_inferred)]
    client = SupabaseRest(supabase_url, key, timeout)

    inserted = 0
    updated = 0
    failed = 0
    for item in actionable:
        try:
            result = client.save(normalize_item(item, full_text))
            if result == "inserted":
                inserted += 1
            else:
                updated += 1
        except Exception as exc:  # keep one bad item from blocking all others
            failed += 1
            print(f"ADA_SYNC_ITEM_ERROR {type(exc).__name__}: {exc}", file=sys.stderr)

    print(json.dumps({
        "archive_items": len(items),
        "actionable_items": len(actionable),
        "inserted": inserted,
        "updated": updated,
        "failed": failed,
        "privacy_mode": "full_text" if full_text else "summary_only",
    }))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
