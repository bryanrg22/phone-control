#!/usr/bin/env python3
"""
tunnel.py — build a CoreDevice TCP tunnel to a phone at an EXPLICIT address.

`pymobiledevice3 remote start-tunnel` finds the phone by mDNS and has no
--address flag, so it cannot reach a phone that is only reachable over a VPN (or
on any network that blocks mDNS). This helper calls the pymobiledevice3 Python
API with the address given, skipping discovery entirely.

It prints exactly one machine-readable line on stdout:

    RSD <ipv6> <port>

then HOLDS the process alive to keep the tunnel interface up. Kill the process
to tear the tunnel down. Everything else it prints is diagnostic, on stderr.

Run as the user that owns the pairing records (the tunnel configures a kernel
interface, so in practice root). Needs Python 3.13+ (TLS-PSK).

Usage:  tunnel.py <udid> <phone_address> [rsd_port]
  <phone_address>  the phone's reachable IP — its Tailscale address
  [rsd_port]       RemoteXPC port, default 49152
"""
import asyncio
import subprocess
import sys

RSD_PORT_DEFAULT = 49152
# How long to wait for the utun to become routable (client …::2 present on some
# interface) AFTER the RSD endpoint prints. The 08-01 "can't assign requested
# address" race was launching before this; the supervisor ALSO re-checks with
# tunnelUp(), so this is a belt-and-suspenders wait, not the only guard.
ROUTABLE_WAIT_S = 20

from pymobiledevice3.remote.tunnel_service import (
    create_core_device_tunnel_service_using_remotepairing,
)


def _utun_routable(rsd_addr: str) -> bool:
    """Our client addr is the RSD server addr with ::1 → ::2. Present on a utun?"""
    if not rsd_addr or not rsd_addr.endswith("::1"):
        return False
    client = rsd_addr[:-3] + "::2"
    try:
        out = subprocess.run(["ifconfig"], capture_output=True, text=True, timeout=5).stdout
        return client in out
    except Exception:
        return False


def _log(msg: str) -> None:
    # Diagnostics to stderr so stdout carries ONLY the script-mode RSD line.
    print(f"[tunnel] {msg}", file=sys.stderr, flush=True)


async def _run(udid: str, address: str, rsd_port: int) -> int:
    _log(f"RSD handshake to {address}:{rsd_port} …")
    try:
        svc = await create_core_device_tunnel_service_using_remotepairing(udid, address, rsd_port)
    except Exception as e:
        _log(f"FAIL handshake: {type(e).__name__}: {e}")
        return 1
    _log("handshake completed")

    try:
        async with svc.start_tcp_tunnel() as tunnel:
            rsd_addr, rsd_port_out = tunnel.address, tunnel.port
            # The single machine-readable line the supervisor parses. This is the
            # SAME bare "<ipv6> <port>" shape that start-tunnel --script-mode emits
            # (labelled with RSD so parseTunnelScriptMode's labelled branch matches).
            print(f"RSD {rsd_addr} {rsd_port_out}", flush=True)
            _log(f"tunnel endpoint: RSD {rsd_addr} {rsd_port_out} (iface {tunnel.interface})")

            # Wait until the utun is actually routable before declaring readiness.
            routable = False
            for _ in range(ROUTABLE_WAIT_S):
                if _utun_routable(rsd_addr):
                    routable = True
                    break
                await asyncio.sleep(1)
            if not routable:
                _log("utun never became routable (client …::2 absent) — tunnel likely unusable")
                return 2
            _log("utun routable — holding tunnel open")

            # Hold the process (and thus the utun) alive until killed. start_tcp_tunnel
            # tears the interface down when this context exits / the process dies.
            while True:
                await asyncio.sleep(3600)
    except Exception as e:
        _log(f"FAIL tunnel: {type(e).__name__}: {e}")
        return 1
    finally:
        try:
            await svc.close()
        except Exception:
            pass


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__, file=sys.stderr)
        return 2
    udid = sys.argv[1]
    address = sys.argv[2]
    rsd_port = int(sys.argv[3]) if len(sys.argv) > 3 else RSD_PORT_DEFAULT
    try:
        return asyncio.run(_run(udid, address, rsd_port))
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    sys.exit(main())
