// Unit tests for claude-messages.mjs — locks the HIGH audit-re-review fix:
// in noToolsMode the Anthropic request must contain ZERO tool_use/tool_result blocks
// (the API 400s on tool blocks when `tools` is absent — the regression that silently
// burned --no-tools Claude runs to max-steps as fake TASK FAILs). Can't be live-tested
// right now (no anthropic credits), so this unit test is the verification of record.
import { convertMessagesForClaude } from '../claude-messages.mjs';

let pass = 0, fail = 0;
const ck = (n, c, d = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d ? ' — ' + d : ''))); };

// Count tool_use/tool_result blocks anywhere in a converted message list.
function toolBlockCount(msgs) {
  let n = 0;
  for (const m of msgs) if (Array.isArray(m.content)) for (const b of m.content) if (b && (b.type === 'tool_use' || b.type === 'tool_result')) n++;
  return n;
}

const history = [
  { role: 'system', content: 'SYS' },
  { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } }, { type: 'text', text: 'screen 1' }] },
  { role: 'assistant', content: '{"tool":"tap","args":{"x":50,"y":50}}', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'tap', arguments: '{"x":50,"y":50}' } }] },
  { role: 'tool', tool_call_id: 'c1', content: 'Tapped (50,50)' },
  { role: 'assistant', content: '{"tool":"taskComplete","args":{"summary":"done"}}', tool_calls: [{ id: 'c2', type: 'function', function: { name: 'taskComplete', arguments: '{"summary":"done"}' } }] },
];

console.log('normal mode (tools present) — tool blocks SHOULD appear:');
const normal = convertMessagesForClaude(history, { noToolsMode: false });
ck('system extracted', normal.system === 'SYS');
ck('tool_use + tool_result blocks present', toolBlockCount(normal.messages) >= 2, `count=${toolBlockCount(normal.messages)}`);
ck('image converted to an anthropic image block', normal.messages.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'image')));

console.log('noToolsMode — request MUST be free of tool blocks (the #15 regression fix):');
const nt = convertMessagesForClaude(history, { noToolsMode: true });
ck('system extracted', nt.system === 'SYS');
ck('ZERO tool_use/tool_result blocks (else Anthropic 400s without a tools param)', toolBlockCount(nt.messages) === 0, `count=${toolBlockCount(nt.messages)}`);
ck('assistant action text preserved as a text block', nt.messages.some(m => m.role === 'assistant' && Array.isArray(m.content) && m.content.some(b => b.type === 'text' && b.text.includes('"tool":"tap"'))));
ck('tool result flattened to a plain user text turn', nt.messages.some(m => m.role === 'user' && typeof m.content === 'string' && m.content.includes('Tool result: Tapped')));
ck('image still converted (images need no tools param)', nt.messages.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'image')));
ck('default (no opts) behaves as tools-on', toolBlockCount(convertMessagesForClaude(history).messages) >= 2);

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
