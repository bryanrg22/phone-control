# Runner

The app that runs on the iPhone. It is an XCUITest bundle whose single test starts an HTTP server on port 22087 and then serves requests until the test session ends: tap at a point, type text, swipe, press a button, return a screenshot or the screen's element tree.

It does nothing on its own. The server starts it by starting an XCTest session (see [docs/architecture.md](../docs/architecture.md)), and it stops when that session ends. While it runs, iOS shows the "Automation Running" banner.

## Origin and licence

This directory is a modified copy of the iOS XCTest runner from [Maestro](https://github.com/mobile-dev-inc/Maestro) (`maestro-ios-xctest-runner/`), by mobile.dev, used under the Apache License 2.0. The licence is in [LICENSE](LICENSE). It applies to this directory; the rest of the repository is MIT.

Changes from upstream:

- **Added `/drag`** (`Routes/Handlers/DragRouteHandler.swift`): a press-move-release gesture along a path, for drag and drop and for drawing.
- **Added `/hostInfo`** (`Routes/Handlers/HostInfoHandler.swift`): returns the launch environment the session was started with, so a caller can tell which host started it and when.
- **Signing is set at build time.** The team is empty in the project and the bundle identifiers are built from a `BUNDLE_ID_PREFIX` build setting, so nothing here is tied to one developer account.
- **Removed** upstream's build scripts, which assume the Maestro repository around them. `build.sh` replaces them.

This copy was taken from an older upstream revision, and which one was not recorded. It therefore also differs from today's upstream in ways that are upstream's own history rather than changes made here: it still has files upstream has since removed, and lacks things upstream has added (for example the appearance handlers and the `MaestroDriverLib` package).

The runner listens on every network interface of the phone and does not authenticate requests. See [SECURITY.md](../SECURITY.md).

## Building

```bash
DEVELOPMENT_TEAM=ABCDE12345 BUNDLE_ID_PREFIX=com.example.you ./build.sh
./build.sh --simulator      # compile check only
```

[docs/install-phone.md](../docs/install-phone.md) covers installing it.
