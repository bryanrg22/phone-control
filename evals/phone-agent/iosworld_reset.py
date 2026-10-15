#!/usr/bin/env python3
"""Put the simulator in iOSWorld's start state, using iOSWorld's own code.

    python iosworld_reset.py --iosworld ~/iOSWorld --udid <simulator UDID>

Calls the same functions iOSWorld's runner calls before every task
(scripts/appium_agent.py), unchanged and not copied, so a task starts exactly
as it does in the benchmark: the status bar pinned, every app's data wiped and
reseeded from its built-in seed (Jordan Avery's data), the OpenAI key handed
to the apps that generate replies. Pressing Home happens afterwards, through
our runner (run.mjs), as iOSWorld does through Appium.

Prints one JSON line: {"ok": true, "apps": 26, "seconds": 41.2}.
"""
from __future__ import annotations

import argparse
import contextlib
import io
import json
import pathlib
import sys
import time


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--iosworld", required=True, help="iOSWorld checkout")
    p.add_argument("--udid", required=True, help="the simulator to reset")
    args = p.parse_args()

    root = pathlib.Path(args.iosworld).expanduser().resolve()
    sys.path.insert(0, str(root / "scripts"))
    import appium_agent as aa  # noqa: E402  (iOSWorld's runner; its imports are lazy)

    manifest = aa.load_app_manifest(str(root / "iphone" / "bootstrap" / ".app_manifest.json"))
    if not manifest:
        print(json.dumps({"ok": False, "error": "no app manifest: run iphone/bootstrap/bootstrap_ios_apps.sh first"}))
        return 1

    t0 = time.time()
    log = io.StringIO()
    try:
        with contextlib.redirect_stdout(log):
            aa.pin_simulator_state(args.udid)
            apps = list(manifest.keys())          # all apps, as iOSWorld does
            aa.reset_app_data(args.udid, apps, manifest)
            aa.reseed_apps(args.udid, apps, manifest)
    except Exception as exc:  # noqa: BLE001  (report, never half-reset silently)
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}", "log": log.getvalue()[-4000:]}))
        return 1
    print(json.dumps({"ok": True, "apps": len(manifest), "seconds": round(time.time() - t0, 1)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
