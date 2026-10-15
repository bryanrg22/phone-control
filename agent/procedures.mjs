/**
 * Procedural Memory for agent.mjs (Mac mode)
 * Mirrors ProcedureMemory.swift — same JSONL format, same logic.
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import crypto from 'crypto';

import { STATE_DIR } from './state-dir.mjs';

const PROCEDURES_DIR = join(STATE_DIR, 'procedures');
const PROCEDURES_FILE = join(PROCEDURES_DIR, 'procedures.jsonl');

// ─── Data loading / saving ───

function loadProcedures() {
  if (!existsSync(PROCEDURES_FILE)) return [];
  const text = readFileSync(PROCEDURES_FILE, 'utf-8').trim();
  if (!text) return [];
  return text.split('\n').map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function saveProcedures(procedures) {
  mkdirSync(PROCEDURES_DIR, { recursive: true });
  const content = procedures.map(p => JSON.stringify(p)).join('\n') + (procedures.length ? '\n' : '');
  // Atomic write: a SIGKILL/OOM mid-write would otherwise leave a truncated JSONL file
  // that breaks the next loadProcedures parse. Write to temp then rename (atomic on POSIX).
  const tmp = PROCEDURES_FILE + '.tmp';
  writeFileSync(tmp, content);
  renameSync(tmp, PROCEDURES_FILE);
}

// ─── Trust scoring ───

function reliability(proc) {
  const total = proc.successCount + proc.failCount;
  return total > 0 ? proc.successCount / total : 0;
}

function trustTier(proc) {
  const total = proc.successCount + proc.failCount;
  if (total < 2) return 'hint';
  if (total >= 5 && reliability(proc) < 0.5) return 'prune';
  if (reliability(proc) >= 0.8 && proc.successCount >= 3) return 'trusted';
  return 'hint';
}

// ─── Public API ───

export function getCount() {
  return loadProcedures().length;
}

/**
 * Build a prompt asking the LLM which procedure matches a new task.
 * Returns null if no procedures stored.
 */
export function buildMatchingPrompt(task) {
  let procedures = loadProcedures();
  // Auto-prune unreliable
  const before = procedures.length;
  procedures = procedures.filter(p => trustTier(p) !== 'prune');
  if (procedures.length < before) saveProcedures(procedures);

  if (procedures.length === 0) return null;

  const entries = procedures.map((p, i) => {
    const rel = Math.round(reliability(p) * 100);
    const total = p.successCount + p.failCount;
    return `${i + 1}. [id: ${p.id.slice(0, 8)}] Scenario: "${p.scenario}" | Pattern: "${p.pattern}" | Reliability: ${rel}% (${p.successCount}/${total})`;
  }).join('\n');

  return `Here are procedures I've learned from past successful tasks:\n${entries}\n\nNew task: "${task}"\n\nDoes any procedure match this task? If yes, return ONLY the id (first 8 characters). If no match, return ONLY "none".`;
}

/**
 * Parse the LLM's match response and return the matched procedure (or null).
 */
export function parseMatch(response) {
  const procedures = loadProcedures();
  const cleaned = response.trim().toLowerCase();
  // A match requires the response to actually contain a stored procedure's 8-char id
  // prefix. Any other text — including verbose "no match" phrasings that omit the literal
  // word "none" — falls through to null. (Pre-fix only an exact/substring "none" counted
  // as no-match, so a chatty refusal could slip into the id scan and mis-match.)
  for (const proc of procedures) {
    const prefix = proc.id.slice(0, 8).toLowerCase();
    if (cleaned.includes(prefix)) return proc;
  }
  return null;
}

/**
 * Build the prompt injection text for a matched procedure.
 */
export function promptInjection(procedure) {
  const tier = trustTier(procedure);
  const tierLabel = tier === 'trusted' ? 'high' : 'developing';
  const total = procedure.successCount + procedure.failCount;

  const stepsText = procedure.steps.map((step, i) => {
    let line = `${i + 1}. ${step.tool}`;
    if (step.args && Object.keys(step.args).length > 0) {
      const argStr = Object.entries(step.args).map(([k, v]) => `${k}: "${v}"`).join(', ');
      line += `(${argStr})`;
    }
    if (step.target) line += ` — target: "${step.target}"`;
    return line;
  }).join('\n');

  return `<LEARNED_PROCEDURE confidence="${tierLabel}" uses="${procedure.successCount}/${total} successful">
You've completed this type of task before. These steps worked:
${stepsText}

Follow this plan. Adapt if the screen looks different than expected.
If the UI looks different than expected, fall back to normal exploration.
${tier === 'trusted' ? 'This procedure is trusted — you can move quickly without extra verification between steps.' : 'Verify each step with the auto-captured screenshot before proceeding.'}
</LEARNED_PROCEDURE>`;
}

/**
 * Record a successful use of a procedure.
 */
export function recordSuccess(id) {
  const procedures = loadProcedures();
  const proc = procedures.find(p => p.id === id);
  if (!proc) return;
  proc.successCount++;
  proc.lastUsed = new Date().toISOString();
  saveProcedures(procedures);
}

/**
 * Record a failed use of a procedure.
 */
export function recordFailure(id) {
  const procedures = loadProcedures();
  const idx = procedures.findIndex(p => p.id === id);
  if (idx === -1) return;
  procedures[idx].failCount++;
  procedures[idx].lastUsed = new Date().toISOString();
  if (trustTier(procedures[idx]) === 'prune') {
    procedures.splice(idx, 1);
  }
  saveProcedures(procedures);
}

/**
 * Build the extraction prompt to generalize a successful trace into a procedure.
 */
export function buildExtractionPrompt(task, trace) {
  const stepsText = trace.map(step => {
    const tools = step.tools.map(t => {
      let desc = t.tool;
      if (t.args && Object.keys(t.args).length > 0) {
        const argStr = Object.entries(t.args).map(([k, v]) => `${k}: "${v}"`).join(', ');
        desc += `(${argStr})`;
      }
      if (t.target) desc += ` [target: ${t.target}]`;
      return desc;
    }).join(', ');
    return `Step ${step.step}: ${tools}`;
  }).join('\n');

  return `I just completed this task successfully:
Task: "${task}"
Action sequence:
${stepsText}

Extract a reusable procedure. Return a JSON object with these fields:
- "scenario": When should this procedure be reused? (e.g., "User wants to send a text message to a specific contact")
- "pattern": The task pattern with variables in curly braces (e.g., "text {contact} {message}")
- "steps": Array of the essential tool calls, with specific values replaced by {variable} names where they should change per-use. Each step: {"tool": "...", "args": {"key": "{variable_or_literal}"}, "target": "...or null"}

Return ONLY valid JSON, no other text.`;
}

/**
 * Parse the extraction response and store the new procedure.
 * Returns true if stored, false if skipped (duplicate or parse failure).
 */
export function parseAndStore(extractionResponse, _fallbackTask) {
  let jsonStr = extractionResponse.trim();
  // Handle markdown code blocks
  if (jsonStr.includes('```json')) {
    jsonStr = jsonStr.split('```json')[1].split('```')[0].trim();
  } else if (jsonStr.includes('```')) {
    jsonStr = jsonStr.split('```')[1].split('```')[0].trim();
  }

  let json;
  try { json = JSON.parse(jsonStr); } catch { return false; }

  const { scenario, pattern, steps } = json;
  if (!scenario || !pattern || !Array.isArray(steps) || steps.length === 0) return false;

  // Normalize steps
  const normalizedSteps = steps.map(s => ({
    tool: s.tool || '',
    args: s.args || {},
    result: '',
    target: s.target || null,
    time: 0,
  }));

  // Duplicate check (60% word overlap)
  const procedures = loadProcedures();
  const newWords = new Set(scenario.toLowerCase().split(/\s+/));
  for (const existing of procedures) {
    const existWords = new Set(existing.scenario.toLowerCase().split(/\s+/));
    const overlap = [...newWords].filter(w => existWords.has(w)).length;
    const maxCount = Math.max(newWords.size, existWords.size);
    if (maxCount > 0 && overlap / maxCount > 0.6) return false;
  }

  const proc = {
    id: crypto.randomUUID(),
    scenario,
    pattern,
    steps: normalizedSteps,
    successCount: 1,
    failCount: 0,
    createdAt: new Date().toISOString(),
    lastUsed: new Date().toISOString(),
  };

  procedures.push(proc);
  saveProcedures(procedures);
  return true;
}
