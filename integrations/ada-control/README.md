# Ada Operational Control Bridge

This turns Ada's existing Mac connection from report-only into a small, owner-controlled command plane.

## What it can do

- Run the Ada actionable-message sync immediately.
- Restart the Ada sync launch agent.
- Verify the local Messages/Ada archive is reachable.
- Check Tailscale and Tailscale Serve status.
- Report live capability availability to the RTB OS **Ada Control** page.

It intentionally does **not** expose a generic shell.

## Install on the Mac

```bash
cd ~/Documents/rtb-os
/bin/zsh integrations/ada-control/install.sh
```

The installer creates a random bearer token in `~/.config/rtb/ada-control.env`, copies the service into `~/.local/lib/rtb/ada-control`, and starts a localhost-only launch agent. The runtime copy avoids macOS background-process restrictions on the protected Documents folder.

The service starts once at login. It does not use an unconditional restart loop; use **Restart Ada sync** or rerun the installer after reviewing a failure.

Then expose localhost port 8791 privately to the tailnet:

```bash
tailscale serve --bg 8791
```

Tailscale Serve gives the Mac a private HTTPS URL on the tailnet. Paste that URL and the generated control token into **RTB OS → Ada Control**.

Do not use Tailscale Funnel. This control plane should remain tailnet-only.

## Security

- Backend binds only to `127.0.0.1`.
- Tailscale Serve handles private HTTPS ingress.
- Every request requires the locally generated bearer token.
- Commands are a fixed allowlist.
- No arbitrary command or shell parameter is accepted.

## Disable and revoke

```bash
/bin/zsh integrations/ada-control/uninstall.sh
```

This unloads the service and removes its private runtime, configuration, and bearer token. It does not alter Tailscale settings; remove any separate Tailscale Serve mapping explicitly if one was configured.
