# Security

## What you are trusting

Installing this gives a server the ability to operate your phone as you would: open any app, read anything on screen, type, and tap. Understand the following before you use it.

- **There are no guard rails on the agent.** It does what the task says, using a model's judgement. It is not prevented from sending messages, making purchases or changing settings if a task leads there. Use it on your own phone and phrase tasks accordingly.
- **Screenshots of your phone go to the model provider** whose key you configured, for as long as a task runs.
- **Whoever controls the server controls the phone.** That includes anyone with root on the server, and anyone holding the pairing record (`/root/.pymobiledevice3/remote_<UDID>.plist`). Keep the server yours alone.
- **While a task is running, the runner on the phone accepts unauthenticated requests on port 22087 from any network the phone is on**, including the Wi-Fi it is connected to. This is how the upstream runner works. It is listening only while the "Automation Running" banner is showing. Avoid running tasks on networks you do not trust.
- **The server's public endpoint** is protected by OAuth: an assistant gets a token only after someone enters a single-use connect code created on the server. Tokens are stored hashed and can be revoked with `phonectl revoke`.

## Handling secrets

- Model API keys live in `/etc/phone-control/keys.env` (mode 600), never in the unit file, the repository or a command line.
- The pairing record is a credential. Back it up encrypted; do not commit or paste it.
- `deploy/example.env` and `deploy/example.keys.env` are templates. `.gitignore` excludes every other `.env` file.

## Reporting a problem

Please report security problems privately to the maintainers rather than in a public issue: use GitHub's "Report a vulnerability" on this repository if it is enabled, or contact a maintainer directly. Include what you did, what happened and what you expected.
