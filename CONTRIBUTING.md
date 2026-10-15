# Contributing

## Before you send a change

```bash
npm ci
npm run lint
npm test
npm run test:lifecycle     # if you touched device/
npm run test:e2e           # if you touched server/ or device/
```

All of these run without a phone. [docs/development.md](docs/development.md) explains what each covers.

## What makes a change easy to accept

- **A test that fails without it.** For behaviour of the phone-facing code, add a scenario to `device/test/lifecycle.test.mjs`; if the simulated phone cannot express the situation, extend `device/test/sim/phone.mjs`.
- **Simulated behaviour comes from measurement.** If you add a rule to the simulated phone, say in the file what you observed on a real phone and when. Do not model a guess.
- **Say what you verified and how.** "Ran on an iPhone 15 Pro, iOS 27, on cellular" is useful. If you could not test something on a real phone, say that.
- **Messages for the person are part of the change.** If a new failure can reach the chat, give it a sentence that says what happened and what to do.
- **Keep `server/` and `device/` free of npm dependencies.**

## Style

ESLint decides formatting questions (`npm run lint:fix`). Comments explain why, and record what was measured; they do not restate the code.

## Commits

One logical change per commit, with a message that says what changed and why in plain language.
