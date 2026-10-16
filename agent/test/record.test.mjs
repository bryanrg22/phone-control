#!/usr/bin/env node
// record.test.mjs — what the run record must never contain.

import { scrub } from '../record.mjs';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); fail++; }
}

// Shaped like real keys; none of these is one.
const ANTHROPIC = `sk-ant-api03-${'A1b2'.repeat(20)}`;
const OPENAI = `sk-proj-${'x9Y8'.repeat(12)}`;
const GEMINI = `AIza${'Q'.repeat(35)}`;

console.log('scrub:');
check('an Anthropic-shaped key is redacted wherever it appears', !scrub(`Authorization: ${ANTHROPIC}`).includes(ANTHROPIC.slice(0, 20)));
check('an OpenAI-shaped key is redacted', !scrub(`{"headers":{"Authorization":"Bearer ${OPENAI}"}}`).includes(OPENAI.slice(0, 16)));
check('a Gemini-shaped key is redacted', !scrub(`?key=${GEMINI}`).includes(GEMINI.slice(0, 12)));
check('what replaces it says so', scrub(ANTHROPIC) === '[redacted]');
check('ordinary text is untouched, including short "sk-" words', scrub('ask-me sk-8 skates sk-ant') === 'ask-me sk-8 skates sk-ant');
check('a key inside JSON stays valid JSON after scrubbing', (() => { try { return JSON.parse(scrub(JSON.stringify({ k: ANTHROPIC }))).k === '[redacted]'; } catch { return false; } })());

console.log(fail ? `\n❌ ${fail} FAILED, ${pass} passed` : `\n✅ ALL PASS: ${pass} passed, 0 failed`);
if (fail) process.exit(1);
