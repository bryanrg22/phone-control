// sql-assert.mjs — the --assert-sql post-run verification engine for agent.mjs.
//
// Extracted from agent.mjs (D2 refactor, 2026-07-17). Makes a verdict trustworthy
// without a human DB check: after the agent claims "done", run a query against the
// app's Core Data / SQLite store and require the result to match --assert-expect.
//
// NO top-level side effects, NO module-global state — everything is passed in via
// the ctx object ({ assertSql, assertApp, assertDb, assertExpect, simUdid, runShell }).
// Only repo-local imports (sqlite-locate.mjs) + node builtins.

import { existsSync } from 'fs';
import { join } from 'path';
import { locateAppStores } from './sqlite-locate.mjs';

export function compareExpect(n, expect) {
  const m = String(expect).trim().match(/^(>=|<=|==|!=|>|<)?\s*(-?\d+)$/);
  if (!m) return n > 0;
  const op = m[1] || '>', v = parseInt(m[2], 10);
  switch (op) { case '>=': return n >= v; case '<=': return n <= v; case '==': return n === v; case '!=': return n !== v; case '<': return n < v; default: return n > v; }
}

export const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;   // POSIX single-quote escaping

export async function runAssertSql({ assertSql, assertApp, assertDb, assertExpect, simUdid, runShell }) {
  if (!assertApp) return { passed: false, detail: '--assert-sql needs --assert-app <bundleId> to locate the DB' };

  // Collect candidate DB(s). With --assert-db, use exactly that one (absolute, or relative to the
  // data container). Otherwise auto-discover ALL of the app's data-container + App-Group SQLite
  // stores via sqlite-locate.mjs (Core Data .sqlite, SwiftData default.store, generic .db — magic-
  // byte verified). An app commonly spreads data across SEVERAL stores (e.g. an empty Data-local
  // next to the real Data-<UUID>, or SwiftData's default.store), so we query EACH and SUM — a row in ANY of the app's stores counts.
  let candidates = [];
  const where = assertDb ? '--assert-db' : 'data + App Group';
  if (assertDb) {
    let container = '';
    try { container = (await runShell(`xcrun simctl get_app_container ${simUdid} ${assertApp} data`, 15000)).trim(); }
    catch (e) { return { passed: false, detail: `couldn't resolve ${assertApp}'s container: ${e.message.slice(0, 80)}` }; }
    if (!container || !existsSync(container)) return { passed: false, detail: `app container not found for ${assertApp} (installed + launched at least once?)` };
    candidates = [assertDb.startsWith('/') ? assertDb : join(container, assertDb)];
  } else {
    candidates = await locateAppStores({ udid: simUdid, bundleId: assertApp });
  }
  candidates = [...new Set(candidates)].filter(p => existsSync(p));
  if (!candidates.length) return { passed: false, detail: `no SQLite store found for ${assertApp} (installed + launched at least once?) — or pass --assert-db <path> (relative to the data container, or absolute)` };

  // Run the assertion against each store. A store where the query ERRORS (no such table/column) is
  // skipped — it simply doesn't hold this app entity. SUM the numeric results across the stores that
  // COULD run it. If NONE could (table/column absent everywhere), the query is inapplicable to the
  // whole app → INCONCLUSIVE (a guessed-wrong schema), which best-effort mode treats as fall-back-able.
  let sum = 0, ranCount = 0, lastErr = '';
  const matchedIn = [];
  for (const db of candidates) {
    let out;
    // WAL-aware read: a NORMAL (non-immutable) open so the query sees rows still sitting in the -wal —
    // a just-completed write often hasn't been checkpointed yet (Round-5: a real delete was pending in
    // the -wal). `.timeout` tolerates a transient write-lock from the live app. (immutable=1 would be
    // faster but bypasses the WAL and would MISS the very write we're verifying — confirmed empirically.)
    try { out = (await runShell(`sqlite3 -cmd ".timeout 3000" ${shq(db)} ${shq(assertSql)}`, 15000)).trim(); }
    catch (e) { lastErr = e.message.slice(0, 100); continue; }
    const n = parseInt((out.split('\n')[0] || '').trim(), 10);
    if (Number.isNaN(n)) continue;   // non-numeric row → unusable for a numeric assertion; skip
    sum += n; ranCount++; if (n !== 0) matchedIn.push(db.split('/').pop());
  }
  if (ranCount === 0) {
    return { passed: false, inconclusive: true, detail: `query could not execute on any of ${candidates.length} ${assertApp} store(s) (schema mismatch?): ${lastErr}` };
  }
  console.log(`  📂 assert DB (${where}): ${candidates.length} store(s), ${ranCount} ran${matchedIn.length ? ` · matched in ${[...new Set(matchedIn)].join(', ')}` : ''}`);
  return { passed: compareExpect(sum, assertExpect), detail: `${assertSql} → ${sum} (summed across ${ranCount} store${ranCount > 1 ? 's' : ''}), expected ${assertExpect}` };
}
