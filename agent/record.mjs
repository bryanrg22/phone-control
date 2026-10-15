// record.mjs — the full record of one run, enough to replay or judge it without re-running it.
//
// <dir>/
//   manifest.json        the run: task, model, versions, settings, device, timing, outcome, totals
//   trace.jsonl          one line per record, in order: a span for every model call (chat)
//                        and tool call (execute_tool), an event for every screen the model
//                        was shown (observation), and last the span for the run (invoke_agent)
//   blobs/sha256/<hex>.<ext>   every image, request and response body, stored once by content hash
//   transcript.md        the same, for a person to read
//
// Field names follow the OpenTelemetry GenAI semantic conventions
// (github.com/open-telemetry/semantic-conventions-genai; status: development):
// gen_ai.operation.name, gen_ai.provider.name, gen_ai.request.model,
// gen_ai.response.model, gen_ai.usage.input_tokens (cached part INCLUDED),
// gen_ai.usage.cache_read.input_tokens, gen_ai.tool.call.arguments, … Our own
// fields (step, cost, raw exchange, failure layer) live under `eval`, apart.
//
// The raw exchange is the exact JSON posted and received, with one change:
// each base64 image is replaced by {"$blob": "blobs/sha256/<hex>.<ext>"},
// the file holding those exact bytes. Request headers are never recorded (they
// carry the API key), and key-shaped strings are scrubbed from everything.
//
// Recording never breaks a run: every write is guarded.

import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const KEY_PATTERNS = [/sk-ant-[A-Za-z0-9_-]{16,}/g, /sk-(proj-)?[A-Za-z0-9_-]{20,}/g, /AIza[0-9A-Za-z_-]{30,}/g, /iac_[A-Za-z0-9_-]{16,}/g];
export const scrub = (text) => KEY_PATTERNS.reduce((t, re) => t.replace(re, '[redacted]'), text);
const hex = (n) => randomBytes(n).toString('hex');
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/json': 'json', 'text/plain': 'txt' };

/**
 * @param {object} o
 * @param {string|null} o.dir    null records nothing (every method is a no-op)
 * @param {object} o.manifest    what is known at the start (task, model, settings…)
 */
export function createRecorder({ dir, manifest = {} }) {
  if (!dir) return nullRecorder();
  const traceId = hex(16);
  const rootSpan = hex(8);
  const started = new Date();
  const lines = [];      // transcript.md
  const totals = { model_calls: 0, tool_calls: 0, tool_errors: 0, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_write_input_tokens: 0, reasoning_output_tokens: 0, images: 0 };
  let ok = true;
  const guard = (fn) => { if (!ok) return null; try { return fn(); } catch (e) { ok = false; process.stderr.write(`[record] stopped recording: ${e.message}\n`); return null; } };

  guard(() => mkdirSync(join(dir, 'blobs', 'sha256'), { recursive: true }));

  /** Store bytes once; return the path relative to dir. */
  function blob(data, mime) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(scrub(typeof data === 'string' ? data : JSON.stringify(data, null, 1)));
    const sha = createHash('sha256').update(buf).digest('hex');
    const rel = join('blobs', 'sha256', `${sha}.${EXT[mime] || 'bin'}`);
    const abs = join(dir, rel);
    if (!existsSync(abs)) writeFileSync(abs, buf);
    return rel;
  }

  /** Replace every base64 image inside a JSON value by a reference to its blob. */
  function liftImages(value) {
    if (typeof value === 'string') {
      const m = value.match(/^data:(image\/[a-z]+);base64,(.+)$/s);
      if (m) { totals.images += 1; return { $blob: blob(Buffer.from(m[2], 'base64'), m[1]) }; }
      return value;
    }
    if (Array.isArray(value)) return value.map(liftImages);
    if (value && typeof value === 'object') {
      // Anthropic: { type:'image', source:{ type:'base64', media_type, data } }
      if (value.type === 'base64' && typeof value.data === 'string' && value.media_type) {
        totals.images += 1;
        return { ...value, data: { $blob: blob(Buffer.from(value.data, 'base64'), value.media_type) } };
      }
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, liftImages(v)]));
    }
    return value;
  }

  /** The loop's messages → OTel GenAI input messages ({ role, parts }). */
  function otelMessages(messages) {
    return messages.filter((m) => m.role !== 'system').map((m) => {
      if (m.role === 'tool') return { role: 'tool', parts: [{ type: 'tool_call_response', id: m.tool_call_id, response: String(m.content) }] };
      if (m.role === 'assistant') {
        return { role: 'assistant', parts: [
          ...(m.content ? [{ type: 'text', content: m.content }] : []),
          ...(m.tool_calls || []).map((tc) => ({ type: 'tool_call', id: tc.id, name: tc.function.name, arguments: safeJSON(tc.function.arguments) })),
        ] };
      }
      const parts = typeof m.content === 'string' ? [{ type: 'text', content: m.content }] : m.content.map((p) => {
        const d = p.type === 'image_url' && p.image_url.url.match(/^data:(image\/[a-z]+);base64,(.+)$/s);
        return d ? { type: 'uri', modality: 'image', mime_type: d[1], uri: blob(Buffer.from(d[2], 'base64'), d[1]) } : { type: 'text', content: p.text ?? '' };
      });
      return { role: 'user', parts };
    });
  }

  function span(rec) { appendFileSync(join(dir, 'trace.jsonl'), `${scrub(JSON.stringify({ record: 'span', trace_id: traceId, ...rec }))}\n`); }

  return {
    traceId,

    /** One model request, successful or not. */
    modelCall({ step, start, end, provider, requestModel, messages, tools, result = null, error = null, costUsd = null }) {
      guard(() => {
        totals.model_calls += 1;
        const u = result?.usage || {};
        for (const k of ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_write_input_tokens', 'reasoning_output_tokens']) totals[k] += u[k] || 0;
        const system = messages.find((m) => m.role === 'system')?.content;
        const out = result?.message;
        span({
          span_id: hex(8), parent_span_id: rootSpan, name: `chat ${requestModel}`, kind: 'CLIENT',
          start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString(), status: error ? 'ERROR' : 'OK',
          attributes: {
            'gen_ai.operation.name': 'chat', 'gen_ai.provider.name': provider, 'gen_ai.agent.name': 'phone-agent',
            'gen_ai.request.model': requestModel, 'gen_ai.response.model': result?.responseModel ?? null,
            'gen_ai.response.id': result?.responseId ?? null, 'gen_ai.response.finish_reasons': result?.finishReasons ?? [],
            'gen_ai.usage.input_tokens': u.input_tokens ?? null, 'gen_ai.usage.output_tokens': u.output_tokens ?? null,
            'gen_ai.usage.cache_read.input_tokens': u.cache_read_input_tokens ?? null, 'gen_ai.usage.cache_write.input_tokens': u.cache_write_input_tokens ?? null,
            'gen_ai.usage.reasoning.output_tokens': u.reasoning_output_tokens ?? null,
            'gen_ai.system_instructions': system ? { $blob: blob(system, 'text/plain') } : null,
            'gen_ai.tool.definitions': { $blob: blob(tools, 'application/json') },
            'gen_ai.input.messages': { $blob: blob(otelMessages(messages), 'application/json') },
            'gen_ai.output.messages': out ? otelMessages([out]) : [],
            'error.type': error ? (error.status ? `http_${error.status}` : 'request_failed') : null,
          },
          eval: {
            step, latency_ms: end - start, cost_usd: costUsd,
            raw: {
              url: result?.raw?.url ?? null, http_status: result?.raw?.status ?? error?.status ?? null,
              attempts: result?.raw?.attempts ?? error?.attempts ?? [],
              request: result?.raw?.request ? { $blob: blob(liftImages(result.raw.request), 'application/json') } : null,
              response: result?.raw?.response ? { $blob: blob(result.raw.response, 'application/json') } : (error?.responseBody ? { $blob: blob(String(error.responseBody), 'text/plain') } : null),
              headers_logged: false,
            },
            error: error ? String(error.message).slice(0, 500) : null,
          },
        });
        lines.push(`### Step ${step} — model (${((end - start) / 1000).toFixed(1)} s, ${u.input_tokens ?? '?'} in / ${u.output_tokens ?? '?'} out${u.cache_read_input_tokens ? `, ${u.cache_read_input_tokens} cached` : ''})`);
        if (error) lines.push(`**Error:** ${scrub(String(error.message))}`);
        if (out?.content) lines.push(`> ${scrub(out.content).replace(/\n/g, '\n> ')}`);
        for (const tc of out?.tool_calls || []) lines.push(`- calls \`${tc.function.name}(${scrub(tc.function.arguments)})\``);
        lines.push('');
      });
    },

    /** One tool call, as executed (or skipped). */
    toolCall({ step, id, name, args, start, end, result, error = null, skipped = false, layer = null }) {
      guard(() => {
        totals.tool_calls += 1;
        if (error) totals.tool_errors += 1;
        span({
          span_id: hex(8), parent_span_id: rootSpan, name: `execute_tool ${name}`, kind: 'INTERNAL',
          start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString(), status: error ? 'ERROR' : 'OK',
          attributes: {
            'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': name, 'gen_ai.tool.type': 'function',
            'gen_ai.tool.call.id': id, 'gen_ai.tool.call.arguments': args, 'gen_ai.tool.call.result': result,
            'error.type': error ? 'tool_error' : null,
          },
          eval: { step, latency_ms: end - start, skipped, failure_layer: layer, error: error ? String(error).slice(0, 500) : null },
        });
        lines.push(`- \`${name}\` → ${skipped ? '(not run) ' : ''}${scrub(String(result ?? error ?? '')).slice(0, 400).replace(/\n/g, ' ')}`);
      });
    },

    /** The screen the model is shown next: step 0 is before the first request. */
    observation({ step, image, elements }) {
      return guard(() => {
        const ref = blob(image, image[0] === 0xFF ? 'image/jpeg' : 'image/png');
        totals.images += 1;
        appendFileSync(join(dir, 'trace.jsonl'), `${scrub(JSON.stringify({ record: 'event', trace_id: traceId, name: 'observation', time: new Date().toISOString(), eval: { step, image: ref, elements } }))}\n`);
        lines.push(`#### Screen after step ${step}`, `![step ${step}](${ref})`, '', '<details><summary>element list</summary>', '', '```', ...elements, '```', '</details>', '');
        return ref;
      });
    },

    note(text) { guard(() => lines.push(`*${scrub(text)}*`, '')); },

    /** Write the manifest and the transcript; called once, at the end. */
    finish(outcome) {
      guard(() => {
        const ended = new Date();
        const doc = { ...manifest, trace_id: traceId, started: started.toISOString(), ended: ended.toISOString(), duration_s: (ended - started) / 1000, outcome, totals };
        span({
          span_id: rootSpan, parent_span_id: null, name: 'invoke_agent phone-agent', kind: 'INTERNAL',
          start_time: started.toISOString(), end_time: ended.toISOString(), status: outcome.status === 'errored' ? 'ERROR' : 'OK',
          attributes: { 'gen_ai.operation.name': 'invoke_agent', 'gen_ai.agent.name': 'phone-agent', 'gen_ai.provider.name': manifest.provider, 'gen_ai.request.model': manifest.model },
          eval: { outcome, totals },
        });
        writeFileSync(join(dir, 'manifest.json'), `${scrub(JSON.stringify(doc, null, 2))}\n`);
        writeFileSync(join(dir, 'transcript.md'), scrub([
          `# ${manifest.task}`, '',
          `${manifest.provider} · ${manifest.model} · ${outcome.status}${outcome.summary ? ` — ${outcome.summary}` : ''}`, '',
          `${totals.model_calls} model calls · ${totals.tool_calls} tool calls (${totals.tool_errors} failed) · ${totals.input_tokens} input tokens (${totals.cache_read_input_tokens} cached) · ${totals.output_tokens} output · ${doc.duration_s.toFixed(1)} s`, '',
          ...lines,
        ].join('\n')));
      });
    },
  };
}

function safeJSON(s) { try { return JSON.parse(s); } catch { return s; } }

function nullRecorder() {
  const noop = () => null;
  return { traceId: null, modelCall: noop, toolCall: noop, observation: noop, note: noop, finish: noop };
}
