// execute.mjs — one step's tool calls, as an LLM returned them, run in order.
//
// Extracted from loop.mjs (unchanged in behaviour) so the hybrid mode
// (decision/loop.mjs with an LLM to escalate to) runs an LLM step exactly as
// the LLM loop does: the calls stop at the first that fails, at taskComplete
// and at taskFailed; the rest are answered "not run" (every call gets a result,
// as the providers require), so the model never acts on a screen it has not seen.

/**
 * @param {object} o
 * @param {object[]} o.calls       the assistant message's tool_calls
 * @param {number} o.step
 * @param {Function} o.runTool     tools.mjs createToolRunner()
 * @param {object} o.context       context.mjs (tool results go into the conversation)
 * @param {object} o.recorder      record.mjs
 * @param {object} [o.stuck]       stuck.mjs createStuckDetector(), when the loop keeps one
 * @param {object} o.protocol      protocol.mjs
 * @returns {Promise<{ done: Array<{ name: string, args: object }>, concluded: object|null, changes: boolean, settle: boolean, deviceFailed: boolean, handBack: boolean }>}
 */
export async function executeToolCalls({ calls, step, runTool, context, recorder, stuck = null, protocol }) {
  const { emit, log } = protocol;
  let stopRest = null;
  let concluded = null;
  let changes = false;
  let settle = false;
  let deviceFailed = false;
  let handBack = false;
  const done = [];
  for (const tc of calls) {
    const name = tc.function.name;
    let args;
    try { args = JSON.parse(tc.function.arguments || '{}'); } catch { args = null; }
    const tStart = Date.now();
    if (stopRest) {
      const text = `Not run: ${stopRest}.`;
      context.toolResult({ id: tc.id, name, text, isError: true });
      recorder.toolCall({ step, id: tc.id, name, args, start: tStart, end: tStart, result: text, skipped: true });
      continue;
    }
    if (args === null) {
      const text = 'ERROR: your tool arguments were not valid JSON. Re-issue the call with valid JSON arguments.';
      context.toolResult({ id: tc.id, name, text, isError: true });
      recorder.toolCall({ step, id: tc.id, name, args: tc.function.arguments, start: tStart, end: Date.now(), result: text, error: 'invalid arguments', layer: 'model' });
      stopRest = 'an earlier call in this step had invalid arguments';
      continue;
    }
    emit('action', { tool: name, args });
    log(`[tool] ${name}(${JSON.stringify(args)})`);
    if (stuck) stuck.record(name, args);
    let r;
    let thrown = null;
    try { r = await runTool(name, args); } catch (e) {
      thrown = e;
      deviceFailed = true;
      r = { error: true, text: `Error: ${e.message}` };
    }
    log(`[tool] → ${String(r.text).split('\n')[0].slice(0, 200)}`);
    context.toolResult({ id: tc.id, name, text: r.text, isError: !!r.error });
    recorder.toolCall({ step, id: tc.id, name, args, start: tStart, end: Date.now(), result: r.text, error: r.error ? (thrown ? thrown.message : r.text) : null, layer: thrown ? 'device' : (r.error ? 'model' : null) });
    done.push({ name, args });
    changes = changes || !!r.changesScreen;
    settle = settle || !!r.settle;
    handBack = handBack || !!r.handBack;
    if (r.done || r.failed) { concluded = r; stopRest = 'the task was already concluded in this step'; }
    else if (r.error) stopRest = 'an earlier action in this step failed, so the screen may not be what you expected';
  }
  return { done, concluded, changes, settle, deviceFailed, handBack };
}
