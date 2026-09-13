# A.R.V.I.S. Operational Control Bridge

This is the owner-controlled Mac command plane for A.R.V.I.S./Ada and the RTB Neural Workbench.

## What it can do

- Run the Ada actionable-message sync immediately.
- Restart the Ada sync launch agent.
- Verify the local Messages/Ada archive is reachable.
- Check Tailscale and Tailscale Serve status.
- Check whether the Neural Workbench is healthy on `127.0.0.1:3000`.
- Start the approved local Neural Workbench project when it is offline.
- Report all live capabilities to **RTB OS → A.R.V.I.S. Control**.

It intentionally does **not** expose a generic shell.

## Neural Workbench location

By default the control bridge looks for:

```text
~/Downloads/neural-workbench
```

That matches the Google AI Studio export currently being tested. If the project is moved later, set `NEURAL_WORKBENCH_DIR` inside:

```text
~/.config/rtb/ada-control.env
```

Example:

```bash
NEURAL_WORKBENCH_DIR="$HOME/Documents/RTB Database/neural-workbench"
```

The Workbench health check defaults to:

```text
http://127.0.0.1:3000/api/health
```

## Install or update on the Mac

After pulling changes, rerun the installer so the protected runtime copy is updated:

```bash
cd ~/Documents/rtb-os
git pull
/bin/zsh integrations/ada-control/install.sh
```

The installer creates a random bearer token in `~/.config/rtb/ada-control.env`, copies the service into `~/.local/lib/rtb/ada-control`, and starts a localhost-only launch agent. The runtime copy avoids macOS background-process restrictions on the protected Documents folder.

The service starts once at login. It does not use an unconditional restart loop. Workbench start is an explicit owner action from A.R.V.I.S. Control.

Then expose localhost port 8791 privately to the tailnet:

```bash
tailscale serve --bg 8791
```

Tailscale Serve gives the Mac a private HTTPS URL on the tailnet. Paste that URL and the generated control token into **RTB OS → A.R.V.I.S. Control**.

Do not use Tailscale Funnel. This control plane should remain tailnet-only.

## Security

- Backend binds only to `127.0.0.1`.
- Tailscale Serve handles private HTTPS ingress.
- Every request requires the locally generated bearer token.
- Commands are a fixed allowlist.
- Neural Workbench startup uses only the configured project directory and fixed `npm run dev` command.
- No arbitrary command or shell parameter is accepted.

## Disable and revoke

```bash
/bin/zsh integrations/ada-control/uninstall.sh
```

This unloads the service and removes its private runtime, configuration, and bearer token. It does not alter Tailscale settings; remove any separate Tailscale Serve mapping explicitly if one was configured.
