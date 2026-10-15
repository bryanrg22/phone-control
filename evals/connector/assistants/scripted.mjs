// scripted.mjs — assistants that follow a fixed plan instead of a model.
//
// They exist to test the harness itself, for free and on every change:
//   oracle  does each case the right way (the case's "oracle" plan). Every
//           case must PASS with it, or the case or a check is broken.
//   null    never touches a tool and claims success. Every case must FAIL
//           with it, or the checks are too lenient to mean anything.
//
// Oracle plan, one list of actions per user turn:
//   { "call": "tool", "args": { … } }            "$run_id" is the latest run id
//   { "poll": ["completed", "failed", …] }       get_run_status until one of these
//   { "say": "text with {summary} {question} {message} {status} {options}" }

const FIELDS = ['summary', 'question', 'message', 'status', 'options', 'error', 'default_model', 'state'];

export function createScriptedAssistant({ kind, plan = [] }) {
  let runId = null;
  let last = {};
  let turnIndex = 0;

  const fill = (s) => String(s).replace(/\{(\w+)\}/g, (m, k) => {
    if (!FIELDS.includes(k)) return m;
    const v = last[k];
    return Array.isArray(v) ? v.join(' or ') : (v ?? '');
  });
  const resolveArgs = (args = {}) => JSON.parse(JSON.stringify(args).replaceAll('"$run_id"', JSON.stringify(runId)));

  return {
    kind,
    model: kind,
    describe: () => ({ kind }),
    async runTurn({ tools, callTool, emit }) {
      const actions = kind === 'null' ? [{ say: 'Done! I took care of that on your phone.' }] : (plan[turnIndex] || []);
      turnIndex += 1;
      const names = new Set(tools.map((t) => t.name));
      let text = '';
      const call = async (name, args) => {
        if (!names.has(name)) throw new Error(`oracle plan calls unknown tool ${name}`);
        const result = await callTool(name, args);
        emit({ type: 'tool_call', name, args, ms: 0, result: { text: result.text, isError: result.isError, json: result.json } });
        if (result.json) { last = result.json; if (result.json.run_id) runId = result.json.run_id; }
        return result;
      };
      for (const a of actions) {
        if (a.call) await call(a.call, resolveArgs(a.args));
        if (a.poll) {
          for (let i = 0; i < 120; i++) {
            const r = await call('get_run_status', runId ? { run_id: runId } : {});
            if (a.poll.includes(r.json?.status)) break;
          }
        }
        if (a.say) { const t = fill(a.say); text += (text ? '\n' : '') + t; emit({ type: 'assistant_text', text: t }); }
      }
      return { text, status: 'ok' };
    },
  };
}
