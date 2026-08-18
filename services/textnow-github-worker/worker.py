import hashlib
import os
import sys
from datetime import datetime, timezone
from typing import Any

import pytextnow
import requests

TEXTNOW_USERNAME = os.environ.get("TEXTNOW_USERNAME", "").strip()
TEXTNOW_CONNECT_SID = os.environ.get("TEXTNOW_CONNECT_SID", "").strip()
TEXTNOW_CSRF = os.environ.get("TEXTNOW_CSRF", "").strip()
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()


def required(name: str, value: str) -> None:
    if not value:
        raise RuntimeError(f"Missing required secret: {name}")


for _name, _value in (
    ("TEXTNOW_USERNAME", TEXTNOW_USERNAME),
    ("TEXTNOW_CONNECT_SID", TEXTNOW_CONNECT_SID),
    ("TEXTNOW_CSRF", TEXTNOW_CSRF),
    ("SUPABASE_URL", SUPABASE_URL),
    ("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY),
):
    required(_name, _value)

HEADERS = {
    "apikey": SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    "Content-Type": "application/json",
}


def sb(method: str, path: str, *, params=None, json=None, prefer: str | None = None):
    headers = dict(HEADERS)
    if prefer:
        headers["Prefer"] = prefer
    response = requests.request(
        method,
        f"{SUPABASE_URL}/rest/v1/{path}",
        headers=headers,
        params=params,
        json=json,
        timeout=30,
    )
    if not response.ok:
        raise RuntimeError(f"Supabase {method} {path} failed: {response.status_code} {response.text[:500]}")
    if not response.content:
        return None
    return response.json()


def iso_date(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def normalize_message(message: Any) -> dict[str, Any]:
    raw_direction = getattr(message, "direction", "")
    if raw_direction == getattr(pytextnow, "SENT_MESSAGE_TYPE", 2):
        direction = "outgoing"
    elif raw_direction == getattr(pytextnow, "RECEIVED_MESSAGE_TYPE", 1):
        direction = "incoming"
    else:
        direction = str(raw_direction)

    message_id = str(getattr(message, "id", "") or "").strip()
    number = str(getattr(message, "number", "") or "").strip()
    content = str(getattr(message, "content", "") or "")
    date = iso_date(getattr(message, "date", None))
    fingerprint = "|".join([message_id, number, content, date or "", direction])
    source_key = message_id or hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()

    return {
        "source_key": source_key,
        "message_id": message_id or None,
        "number": number,
        "content": content,
        "message_date": date,
        "is_read": bool(getattr(message, "read", False)),
        "direction": direction,
        "first_contact": bool(getattr(message, "first_contact", False)),
        "message_type": str(getattr(message, "type", "") or ""),
        "content_type": getattr(message, "content_type", None),
        "synced_at": datetime.now(timezone.utc).isoformat(),
    }


def sync_messages(client: pytextnow.Client) -> int:
    source = client.get_messages()
    rows = [normalize_message(item) for item in list(source)]
    if rows:
        sb(
            "POST",
            "textnow_messages",
            params={"on_conflict": "source_key"},
            json=rows,
            prefer="resolution=merge-duplicates,return=minimal",
        )
    return len(rows)


def process_outbox(client: pytextnow.Client) -> tuple[int, int]:
    queued = sb(
        "GET",
        "textnow_outbox",
        params={
            "select": "id,number,message,attempts",
            "status": "eq.queued",
            "order": "created_at.asc",
            "limit": "20",
        },
    ) or []

    sent = 0
    failed = 0
    for item in queued:
        item_id = item["id"]
        attempts = int(item.get("attempts") or 0) + 1
        try:
            sb(
                "PATCH",
                "textnow_outbox",
                params={"id": f"eq.{item_id}", "status": "eq.queued"},
                json={"status": "sending", "attempts": attempts, "last_error": None},
                prefer="return=representation",
            )
            client.send_sms(str(item["number"]), str(item["message"]))
            sb(
                "PATCH",
                "textnow_outbox",
                params={"id": f"eq.{item_id}"},
                json={
                    "status": "sent",
                    "sent_at": datetime.now(timezone.utc).isoformat(),
                    "last_error": None,
                },
                prefer="return=minimal",
            )
            sent += 1
        except Exception as exc:
            next_status = "failed" if attempts >= 3 else "queued"
            try:
                sb(
                    "PATCH",
                    "textnow_outbox",
                    params={"id": f"eq.{item_id}"},
                    json={"status": next_status, "attempts": attempts, "last_error": str(exc)[:1000]},
                    prefer="return=minimal",
                )
            finally:
                failed += 1
    return sent, failed


def record_sync(message_count: int, sent_count: int, failed_count: int, error: str | None = None) -> None:
    payload = {
        "id": "textnow",
        "last_run_at": datetime.now(timezone.utc).isoformat(),
        "last_success_at": None if error else datetime.now(timezone.utc).isoformat(),
        "last_error": error,
        "messages_seen": message_count,
        "outbox_sent": sent_count,
        "outbox_failed": failed_count,
    }
    sb(
        "POST",
        "textnow_sync_state",
        params={"on_conflict": "id"},
        json=payload,
        prefer="resolution=merge-duplicates,return=minimal",
    )


def main() -> int:
    client = pytextnow.Client(
        TEXTNOW_USERNAME,
        sid_cookie=TEXTNOW_CONNECT_SID,
        csrf_cookie=TEXTNOW_CSRF,
    )
    message_count = sent_count = failed_count = 0
    try:
        message_count = sync_messages(client)
        sent_count, failed_count = process_outbox(client)
        record_sync(message_count, sent_count, failed_count)
        print(f"TextNow sync complete: messages={message_count} sent={sent_count} failed={failed_count}")
        return 0
    except Exception as exc:
        try:
            record_sync(message_count, sent_count, failed_count, str(exc)[:1000])
        except Exception:
            pass
        print(f"TextNow worker failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
