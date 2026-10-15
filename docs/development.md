# Development

```bash
npm ci
npm run lint
npm test                 # seconds
npm run test:lifecycle   # ~4 minutes
npm run test:e2e         # ~1 minute
```

Node 22 or newer. No phone, model key or network is needed for any of these.

## The three kinds of test

| Command | What runs for real | What is faked |
| --- | --- | --- |
| `npm test` | One module at a time: sign-in, tools, HTTP surface, task lifecycle, phone-state wording, `phonectl`, and the agent's pure parts | Everything around the module, by injection |
| `npm run test:lifecycle` | `device/supervisor.mjs`, run as separate commands exactly as the server runs it | The phone, and the three programs the supervisor shells out to |
| `npm run test:e2e` | `server/src/server.mjs` started as a process, signing in over HTTP, calling tools over MCP, the supervisor underneath | The phone, and the agent (a stand-in that talks to the runner but calls no model) |

Each test file is a plain script: `node server/test/tools.test.mjs` runs one and prints every assertion.

## The simulated phone

`device/test/sim/phone.mjs` is a model of an iPhone as the server experiences it: which ports answer, when, and what happens to a tunnel or a session when the phone changes state. Every behaviour in it was first measured on a real phone; the file's header lists each one and what it was measured from. It covers:

- Wi-Fi and cellular (the tunnel port accepts or refuses), and a phone that does not answer at all
- VPN drops shorter and longer than the tunnel's patience
- lock and unlock, restart, power-off
- the developer disk image and the passcode prompt after a restart
- the runner's HTTP API as far as the server uses it, including a screen that reports being locked

It does **not** model latency or packet loss, Tailscale itself, the pairing handshake's cryptography, or a wrong passcode.

The supervisor's external programs are replaced through the seams it already has (`GO_IOS`, `TUNNEL_PY`, `TUNNEL_PYTHON`, and a fake `ip` and `tailscale` first on `PATH`). Simulated phones have UDIDs starting with `SIM`, and the supervisor's process patterns include the UDID, so running the suite on a machine that is also serving a real phone cannot touch the real session.

**Linux gives full coverage.** Two phones need two loopback addresses, and an unreachable phone needs connections that time out; macOS offers neither on loopback. On macOS those scenarios are reported as skipped, not passed.

### Checking that a test can fail

A scenario that cannot fail proves nothing. `SIM_DEVICE_DIR` points the lifecycle suite at another copy of `device/`, so you can break a behaviour on purpose in a copy and confirm the scenario guarding it goes red:

```bash
cp -R device /tmp/device-broken        # then edit /tmp/device-broken/supervisor.mjs
SIM_DEVICE_DIR=/tmp/device-broken npm run test:lifecycle
```

## A real phone

`e2e/live-check.mjs` is the same list of situations for a real phone, with a person doing the physical part. Run it on the server. `--yes` runs it unattended, which is only meaningful against the simulator.

## Conventions

- **No work at import time.** Every module can be imported by a test without starting anything. Programs check `process.argv[1]` before running `main()`.
- **Dependencies are passed in.** `createTaskRunner({ store, devices, supervisor, startAgent, … })` and its siblings take what they need as arguments, which is what lets the task lifecycle be tested without a phone.
- **The server has no npm dependencies.** `server/` and `device/` use only Node's standard library. `agent/` needs `sharp` and `dotenv`.
- **stdout is data.** The supervisor prints exactly one JSON value, or one `RUNNER_URL=` line, on stdout. Everything for people goes to stderr.
- **Messages for the person are written where the cause is known.** `server/src/preflight.mjs` and `server/src/task-runner.mjs` produce the sentences Claude relays; a new failure mode gets its own sentence rather than a generic one.

## Adding a model

Add a line to `MODELS` in `server/src/models.mjs` with its provider. Mark it `verified` only after it has driven a real phone through a task. The provider's API key goes in `keys.env`.

## Building the runner and go-ios

```bash
runner/build.sh --simulator      # compile check, no signing
scripts/build-go-ios.sh          # needs Go
```

See [install-phone.md](install-phone.md) and [install-server.md](install-server.md).

## Layout

See [structure.md](structure.md) for why the repository is laid out the way it is.
