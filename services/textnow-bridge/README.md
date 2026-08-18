# RTB TextNow Bridge

This service isolates the unmaintained `PyTextNow` dependency from the RTB OS frontend. RTB OS never receives the TextNow session cookies.

## Environment variables

Create a local `.env` or export these values in the runtime environment:

- `TEXTNOW_USERNAME`
- `TEXTNOW_CONNECT_SID`
- `TEXTNOW_CSRF`
- `RTB_TEXTNOW_BRIDGE_SECRET`

Never commit the real cookie values.

## Local setup

```bash
cd services/textnow-bridge
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

export TEXTNOW_USERNAME='your_username'
export TEXTNOW_CONNECT_SID='your_connect_sid'
export TEXTNOW_CSRF='your_csrf_cookie'
export RTB_TEXTNOW_BRIDGE_SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"

uvicorn app:app --host 127.0.0.1 --port 8795
```

Test locally without exposing credentials:

```bash
curl -H "X-RTB-Bridge-Secret: $RTB_TEXTNOW_BRIDGE_SECRET" http://127.0.0.1:8795/health
```

## Public connection

The Supabase Edge Function needs a HTTPS URL it can reach. If the bridge runs on the RTB Mac, expose only port `8795` through the existing secure tunnel and configure the Edge Function secrets:

- `TEXTNOW_BRIDGE_URL=https://your-private-bridge-host.example`
- `RTB_TEXTNOW_BRIDGE_SECRET=<same value used by the Python bridge>`

The browser/iPhone talks only to the authenticated Supabase `textnow-messages` function.

## TextNow capability scope

Current bridge endpoints:

- `GET /health`
- `GET /messages`
- `GET /messages/{number}`
- `POST /send-sms`

MMS can be added later after the basic session and SMS flow are verified against TextNow's current web API.

## Important library limitation

`PyTextNow` is no longer maintained. The current upstream implementation says `get_messages()` returns only the recent TextNow message window, not full account history. RTB OS therefore treats this as a live inbox adapter, not a permanent message archive.
