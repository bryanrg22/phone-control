# Connect Claude

Claude reaches your server as a **custom connector**. You add it once, on claude.ai; after that it is available in the Claude app on your phone.

## 1. Create a connect code

On the server:

```bash
cd /opt/phone-control
node server/bin/phonectl.mjs link-code --email you@example.com
```

The code is single use and valid for ten minutes. It proves to your server that the assistant being connected is yours.

## 2. Add the connector

On [claude.ai](https://claude.ai), in a browser:

1. Settings → Connectors → **Add custom connector**.
2. Name: anything, for example "My iPhone".
3. URL: your server's address followed by `/mcp`, for example `https://your-server.your-tailnet.ts.net/mcp`.
4. Leave the OAuth client ID and secret empty. Claude registers itself.
5. Choose Connect. A page from your server opens and asks for the connect code. Enter it.

If Claude says it cannot reach the address, check that the address is HTTPS on port 443 (no `:port` in the URL) and that `curl https://<address>/healthz` answers from outside your network.

## 3. Use it

In the Claude app on the iPhone, start a new chat and make sure the connector is enabled for it.

- *"Is my phone connected?"* — reports the phone's state without touching it.
- *"Open Settings on my phone and tell me the iOS version."* — runs a task.

Claude asks permission the first time it uses each tool; "Always allow" avoids being asked on every step of a task.

While a task runs, the "Automation Running" banner is on the phone and the screen changes as the agent works. When it finishes, the Claude app comes back to the front with the answer.

### Choosing the model that drives the phone

The model that looks at the screen and taps is separate from the Claude model you are chatting with. The server has a default (`CONNECTOR_DEFAULT_MODEL`), and you can change it from the chat:

- *"Use Sonnet for this one."* — this task only.
- *"From now on use Luna on my phone."* — changes your default.

A model can be used only if its provider's API key is in `/etc/phone-control/keys.env`. The list is in `server/src/models.mjs`.

### Stopping

- Say *stop* in the chat.
- Or hold both volume buttons on the phone until the banner goes away.
- If the chat simply stops following the task (you close it, or press Stop in the app), the server ends the task after about a minute.

## The connector's icon

Claude does not take the connector's icon from your server. It asks Google's favicon service for the **last two parts of the server's address** and keeps what it gets at the moment the connector is added ([anthropics/claude-ai-mcp#838](https://github.com/anthropics/claude-ai-mcp/issues/838), [#882](https://github.com/anthropics/claude-ai-mcp/issues/882)). With a Tailscale Funnel address such as `your-server.your-tailnet.ts.net` that is `ts.net`, so the connector shows **Tailscale's logo**.

To show your own icon, serve the connector from a domain you own (for example `phone.example.com`, whose site has the favicon you want), then remove the connector in Claude and add it again. Declaring icons in the MCP `initialize` response does not help: Claude ignores them, and one report says they can stop the connector from connecting ([#474](https://github.com/anthropics/claude-ai-mcp/issues/474)).

## Disconnecting

```bash
node server/bin/phonectl.mjs revoke --email you@example.com          # every assistant you connected
node server/bin/phonectl.mjs device remove --email you@example.com   # the phone as well
```

## Other assistants

The server speaks standard MCP with OAuth, so any assistant that supports remote MCP servers should be able to connect. Only Claude has been tried. ChatGPT supports custom MCP connectors in developer mode on the web and desktop; at the time of writing OpenAI's documentation says they are not available in its mobile apps, which is where this is most useful.
