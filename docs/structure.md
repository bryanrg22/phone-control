# Why the repository is laid out this way

The layout was chosen by reading how four established projects with a similar shape arrange theirs, and keeping what they agree on.

| Project | Why it is comparable |
| --- | --- |
| [github/github-mcp-server](https://github.com/github/github-mcp-server) | A production MCP server |
| [immich-app/immich](https://github.com/immich-app/immich) | Self-hosted: a server you deploy plus a mobile component |
| [openai/codex](https://github.com/openai/codex) | An agent that acts on a machine, with a CLI and patched third-party code |
| [mobile-dev-inc/Maestro](https://github.com/mobile-dev-inc/Maestro) | Mobile UI automation, and the origin of the on-phone runner |

## What they do, and what this repository does

| Concern | github-mcp-server | immich | codex | Maestro | Here |
| --- | --- | --- | --- | --- | --- |
| One top-level directory per deployable part | `cmd/`, `pkg/`, `internal/` | `server/`, `web/`, `mobile/`, `machine-learning/` | `codex-rs/`, `codex-cli/`, `sdk/` | `maestro-cli/`, `maestro-ios-xctest-runner/`, … | `server/`, `device/`, `agent/`, `runner/` |
| Tests next to the code they test | yes (`*_test.go`) | yes, per part | yes, per crate | yes, per module | `server/test/`, `device/test/`, `agent/test/` |
| A separate top-level directory for whole-system tests | `e2e/` | `e2e/` | — | `e2e/` | `e2e/` |
| Deployment files in their own directory | `Dockerfile` at the root | `docker/` with `example.env`; `deployment/` | — | — | `deploy/` with `example.env` |
| Helper scripts | `script/` | `misc/` | `scripts/` | `scripts/` | `scripts/` |
| User and operator documentation | `docs/` by topic | `docs/` | `docs/` | external site | `docs/` by task |
| Patches to third-party code kept as patch files | — | — | `patches/` | — | `device/patches/` |
| Third-party code attributed | `third-party/`, licence files | — | `NOTICE`, `third_party/` | — | `runner/LICENSE`, `runner/README.md` |
| Root files | README, LICENSE, CONTRIBUTING, SECURITY | README, LICENSE, CONTRIBUTING | README, LICENSE, NOTICE, SECURITY, CHANGELOG | README, LICENSE, CONTRIBUTING, CHANGELOG | README, LICENSE, CONTRIBUTING, SECURITY, CHANGELOG |
| Editor and lint settings at the root | `.golangci.yml` | `.editorconfig`, `.prettierrc` | `.prettierrc.toml`, `.codespellrc` | `.editorconfig`, `detekt.yml` | `.editorconfig`, `eslint.config.js` |
| CI in `.github/workflows/` | yes | yes | yes | yes | yes |

## Choices specific to this repository

- **`device/` is separate from `server/`.** The server decides *whether* to touch a phone; `device/` is *how*. The boundary is a command line (`device/supervisor.mjs --status …`), so either side can be tested, run by hand, or replaced without the other.
- **`agent/` is flat.** It is a set of small modules imported by one program, with no sub-areas to separate yet.
- **`runner/` keeps Maestro's own layout** so that it can be compared with, and updated from, upstream.
- **One `package.json`.** The parts share one language and three dependencies; a workspace per part would add machinery without separating anything.
- **Docs are named for what the reader is trying to do** (`install-server`, `connect-claude`, `operations`), plus one explanation (`architecture`) and one for contributors (`development`).

## What was left out on purpose

Compared with those projects there is no container image, no release automation, no issue templates and no code of conduct. They are worth adding when the project has users other than its authors; adding them earlier would be decoration.
