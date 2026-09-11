# RTB Wyze Venue Feed

A.R.V.I.S. Control now has an owner-only **Live venue feed** panel. The panel accepts a private HTTP/HLS/WebRTC camera URL and stores only that local stream URL in the browser.

Wyze Web View can be used manually in a browser, but for a persistent RTB OS live panel the preferred architecture is a private local Wyze bridge on the shop/Mac network. The bridge must not be exposed to the public internet.

## Private bridge setup

1. Install Docker Desktop on the Mac that will host A.R.V.I.S.
2. Copy `.env.example` to `.env` in this folder.
3. Add the Wyze account values and Wyze API ID/key locally. Do not commit `.env`.
4. Set a strong `WB_PASSWORD` for the local bridge UI.
5. Start the bridge:

```bash
cd ~/Documents/rtb-os/integrations/arvis/wyze
docker compose up -d
```

The compose file binds the bridge ports to `127.0.0.1` only:

- `http://127.0.0.1:5050` — local Wyze Bridge web UI
- `127.0.0.1:8554` — local RTSP endpoint
- `127.0.0.1:8888` — local browser-compatible stream services

Use a browser-compatible HLS/WebRTC/HTTP URL from the bridge in **RTB OS → A.R.V.I.S. Control → Live venue feed**. A raw `rtsp://` URL will not play directly in the browser panel.

If remote owner access is needed, expose only the required browser-compatible feed through the existing private Tailscale network. Do not use public port forwarding, DMZ, or Tailscale Funnel for camera feeds.

## Credentials

The RTB OS page never needs the Wyze account password or API secrets. Those stay on the local Mac in `integrations/arvis/wyze/.env`, which is covered by the repository's `.gitignore` rule for `.env` files.
