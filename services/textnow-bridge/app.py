import os
import time
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
import pytextnow

app = FastAPI(title="RTB TextNow Bridge", version="0.1.0")

USERNAME = os.environ.get("TEXTNOW_USERNAME", "")
SID = os.environ.get("TEXTNOW_CONNECT_SID", "")
CSRF = os.environ.get("TEXTNOW_CSRF", "")
BRIDGE_SECRET = os.environ.get("RTB_TEXTNOW_BRIDGE_SECRET", "")

_client = None
_client_created_at = 0.0


def require_secret(value: str | None):
    if not BRIDGE_SECRET or value != BRIDGE_SECRET:
        raise HTTPException(status_code=401, detail="Invalid bridge secret")


def client():
    global _client, _client_created_at
    if not USERNAME or not SID or not CSRF:
        raise HTTPException(status_code=503, detail="TextNow credentials are not configured")
    if _client is None or time.time() - _client_created_at > 1800:
        _client = pytextnow.Client(USERNAME, sid_cookie=SID, csrf_cookie=CSRF)
        _client_created_at = time.time()
    return _client


def message_to_dict(message: Any):
    raw_direction = getattr(message, "direction", "")
    if raw_direction == getattr(pytextnow, "SENT_MESSAGE_TYPE", 2):
        direction = "outgoing"
    elif raw_direction == getattr(pytextnow, "RECEIVED_MESSAGE_TYPE", 1):
        direction = "incoming"
    else:
        direction = str(raw_direction)

    return {
        "id": str(getattr(message, "id", "")),
        "number": str(getattr(message, "number", "")),
        "content": str(getattr(message, "content", "")),
        "date": getattr(message, "date", None).isoformat() if getattr(message, "date", None) else None,
        "read": bool(getattr(message, "read", False)),
        "direction": direction,
        "first_contact": bool(getattr(message, "first_contact", False)),
        "type": str(getattr(message, "type", "")),
        "content_type": getattr(message, "content_type", None),
    }


class SendSmsBody(BaseModel):
    number: str
    message: str


@app.get("/health")
def health(x_rtb_bridge_secret: str | None = Header(default=None)):
    require_secret(x_rtb_bridge_secret)
    return {
        "ok": True,
        "configured": bool(USERNAME and SID and CSRF),
        "username": USERNAME if USERNAME else None,
    }


@app.get("/messages")
def messages(limit: int = 100, unread_only: bool = False, x_rtb_bridge_secret: str | None = Header(default=None)):
    require_secret(x_rtb_bridge_secret)
    limit = max(1, min(limit, 250))
    c = client()
    source = c.get_unread_messages() if unread_only else c.get_messages()
    rows = [message_to_dict(item) for item in list(source)[:limit]]
    return {"messages": rows}


@app.get("/messages/{number}")
def messages_for_number(number: str, limit: int = 100, x_rtb_bridge_secret: str | None = Header(default=None)):
    require_secret(x_rtb_bridge_secret)
    limit = max(1, min(limit, 250))
    rows = client().get_messages().get(number=number)
    return {"messages": [message_to_dict(item) for item in list(rows)[:limit]]}


@app.post("/send-sms")
def send_sms(body: SendSmsBody, x_rtb_bridge_secret: str | None = Header(default=None)):
    require_secret(x_rtb_bridge_secret)
    number = body.number.strip()
    message = body.message.strip()
    if not number or not message:
        raise HTTPException(status_code=400, detail="number and message are required")
    result = client().send_sms(number, message)
    return {"ok": True, "result": str(result) if result is not None else None}
