// mcp.mjs — MCP JSON-RPC framing over streamable HTTP, hand-rolled and pure.
//
// Why not the official SDK: this server has no dependencies at all, on purpose
// (nothing to install on the host, nothing to audit). A STATELESS streamable-HTTP
// MCP server is small enough to be exactly right: every request is a
// self-contained JSON-RPC POST answered with a JSON body — no sessions, no SSE
// stream to keep alive, nothing to resume after a restart.
//
// Statelessness is not just convenience here: the run state that DOES need to
// outlive a request lives in src/runs.mjs behind a run_id the model
// carries, so the transport genuinely has nothing to remember.
//
// Deliberately NOT implemented, with reasons:
//   • SSE / server→client requests — the clients we target do not support
//     server-initiated elicitation anyway (anthropics/claude-ai-mcp#153), and
//     questions for the user go through the model by design.
//   • JSON-RPC batching — removed from the protocol in 2025-06-18.
//   • resources / prompts — we advertise only `tools`, so a conformant client
//     never asks.

/** Newest first. We echo the client's version when we know it, which is what
 *  keeps an older client working against a newer server.
 *
 *  2026-07-28 is deliberately NOT listed: that revision replaces the
 *  initialize handshake with a mandatory `server/discover` call, which this
 *  server does not implement. Claude tries `server/discover` first, gets
 *  "method not found", and falls back to `initialize` (seen in the server log),
 *  so claiming the newer revision would only promise behaviour we lack. */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];

export const JSONRPC_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
};

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message, data) => ({
  jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) },
});

/**
 * @param {object} deps
 * @param {object} deps.api        createToolApi(...) result
 * @param {object} [deps.serverInfo]
 */
export function createMcpHandler({ api, serverInfo = { name: 'phone-control', title: 'Phone Control', version: '1.0.0' } }) {
  /**
   * @param {object} msg     a parsed JSON-RPC message
   * @param {{uid: string, email?: string}} caller
   * @returns {Promise<object|null>} response, or null for a notification
   */
  async function handleOne(msg, caller) {
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return rpcError(msg?.id ?? null, JSONRPC_ERRORS.invalidRequest, 'not a JSON-RPC 2.0 request');
    }
    const isNotification = msg.id === undefined || msg.id === null;
    const { method, params = {} } = msg;

    switch (method) {
      case 'initialize': {
        const asked = params.protocolVersion;
        const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(asked)
          ? asked
          : SUPPORTED_PROTOCOL_VERSIONS[0];
        return rpcResult(msg.id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo,
          instructions: api.instructions,
        });
      }

      // Notifications carry no id and MUST NOT be answered.
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return null;

      case 'ping':
        return isNotification ? null : rpcResult(msg.id, {});

      case 'tools/list':
        return rpcResult(msg.id, {
          tools: api.definitions.map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: t.annotations,
          })),
        });

      case 'tools/call': {
        const name = params?.name;
        if (typeof name !== 'string' || !api.has(name)) {
          return rpcError(msg.id, JSONRPC_ERRORS.invalidParams, `unknown tool: ${name}`);
        }
        let result;
        try {
          result = await api.call(name, params.arguments || {}, caller);
        } catch (e) {
          // A tool that throws is a TOOL error, not a protocol error: the model
          // should see it and adapt, not have the connection reported broken.
          return rpcResult(msg.id, {
            content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'tool_failed', message: String(e?.message || e).slice(0, 300) }) }],
            isError: true,
          });
        }
        // Text-only on purpose: `structuredContent` is only safe to send
        // alongside a declared outputSchema, and every client handles a JSON
        // string in a text block.
        return rpcResult(msg.id, {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          isError: result?.ok === false,
        });
      }

      default:
        return isNotification ? null : rpcError(msg.id, JSONRPC_ERRORS.methodNotFound, `unknown method: ${method}`);
    }
  }

  return {
    handleOne,
    /**
     * Entry point for a POST body (already parsed). Accepts a single message;
     * an array is handled element-wise for tolerance, though batching is no
     * longer part of the protocol.
     */
    async handle(payload, caller) {
      if (Array.isArray(payload)) {
        const out = [];
        for (const m of payload) {
          const r = await handleOne(m, caller);
          if (r) out.push(r);
        }
        return out.length ? out : null;
      }
      return handleOne(payload, caller);
    },
  };
}
