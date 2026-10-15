// ─── sqlite-locate.mjs · find an installed app's SQLite stores on a simulator ────────────
// Shared by agent.mjs (--assert-sql) and scenario-gen.mjs (--bundle schema introspection) so the
// store-discovery rules live in ONE place. iOS persistence stacks name their store differently:
//   Core Data  → <Name>.sqlite
//   SwiftData  → default.store           (NO .sqlite extension — it IS SQLite by magic bytes)
//   generic    → <name>.db
// A single app commonly has SEVERAL stores in one container/group (e.g. an empty Data-local.sqlite
// next to the real Data-<UUID>.sqlite), so callers query ALL of them. We exclude OS-managed caches
// (URLSession/WebKit) and the -wal/-shm/-journal sidecars (the main file is queried WAL-aware), then
// magic-byte verify each candidate is really SQLite via `file` (a *.store/*.db could be anything).
// (Round-5 field report: the old *.sqlite-only glob missed SwiftData's default.store entirely.)
import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';

function sh(cmd, timeout = 10000) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout, maxBuffer: 16 * 1024 * 1024 }, (e, out) => (e ? reject(new Error(String(e.message).slice(0, 200))) : resolve(out)));
  });
}
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;   // POSIX single-quote escaping

// All SQLite stores under `root` (recursively), magic-byte verified. Returns absolute paths.
export async function findAllSqliteIn(root) {
  if (!root || !existsSync(root)) return [];
  try {
    const o = (await sh(
      `find ${shq(root)} \\( -name '*.sqlite' -o -name '*.store' -o -name '*.db' \\) ` +
      `-not -path '*/Caches/*' -not -path '*/HTTPStorages/*' -not -path '*/WebKit/*' ` +
      `-not -name '*-wal' -not -name '*-shm' -not -name '*-journal' 2>/dev/null`)).trim();
    const paths = o ? o.split('\n').map((s) => s.trim()).filter((p) => p && existsSync(p)) : [];
    const verified = [];
    for (const p of paths) {
      try { if (/SQLite/i.test((await sh(`file -b ${shq(p)}`, 5000)).trim())) verified.push(p); } catch { /* unreadable → skip */ }
    }
    return verified;
  } catch { return []; }
}

// Every SQLite store belonging to `bundleId` on simulator `udid`: its OWN data container + its OWN
// App-Group container(s). Groups come from `get_app_container … groups` so we only ever look inside
// THIS app's groups (never another app's DB sitting in Containers/Shared/AppGroup). De-duplicated.
export async function locateAppStores({ udid = 'booted', bundleId } = {}) {
  if (!bundleId) return [];
  let container = '';
  try { container = (await sh(`xcrun simctl get_app_container ${udid} ${bundleId} data`, 15000)).trim(); } catch { return []; }
  const stores = container && existsSync(container) ? await findAllSqliteIn(container) : [];
  let groupsRaw = '';
  try { groupsRaw = await sh(`xcrun simctl get_app_container ${udid} ${bundleId} groups 2>/dev/null`, 10000); } catch { /* no groups */ }
  const groupDirs = groupsRaw.split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => { const m = l.match(/(\/.*)$/); return m ? m[1].trim() : ''; }).filter(Boolean);
  for (const g of groupDirs) stores.push(...await findAllSqliteIn(g));
  return [...new Set(stores)].filter((p) => existsSync(p));
}

// Introspect the live Core Data / SwiftData schema across an app's stores → a compact map the LLM can
// use to write EXACT table/column names (vs blind Z-prefix guesses). Returns { tables: {T: [cols]}, stores }.
export async function dumpAppSchema({ udid = 'booted', bundleId, maxTables = 40 } = {}) {
  const stores = await locateAppStores({ udid, bundleId });
  const tables = {};
  const samples = {};   // T → "ZNAME='Salmon', ZCALORIES='208'" — one real row so the LLM sees which column holds the name + value shapes
  for (const db of stores) {
    let names = '';
    try {
      // User entities only. Use GLOB (where `_` is LITERAL) — NOT LIKE, whose `_` is a single-char
      // WILDCARD that would make 'Z_*' match every Z-table (ZFOODENTRY, ZREMCDREMINDER, …) and exclude
      // exactly the entities we want. GLOB 'Z_*' matches only the literal Core Data bookkeeping tables
      // (Z_PRIMARYKEY / Z_METADATA / Z_MODELCACHE). Also drop sqlite_* internals.
      names = (await sh(`sqlite3 -cmd ".timeout 3000" ${shq(db)} "SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB 'Z_*' ORDER BY name;"`, 8000)).trim();
    } catch { continue; }
    for (const t of names.split('\n').map((s) => s.trim()).filter(Boolean)) {
      const safeT = t.replace(/[^A-Za-z0-9_]/g, '');
      const isNew = !tables[t];
      if (isNew && Object.keys(tables).length >= maxTables) continue;
      // Cols only on first sight (schema is identical across an app's stores). The SAMPLE, though, must
      // keep trying EVERY store — the same table is empty in one store (e.g. Reminders' Data-local) and
      // populated in another (Data-<uuid>); skipping it after the empty one left the sample blank.
      if (isNew) {
        try {
          const cols = (await sh(`sqlite3 -cmd ".timeout 3000" ${shq(db)} "PRAGMA table_info(${safeT});"`, 8000)).trim();
          // PRAGMA rows: cid|name|type|notnull|dflt|pk  → keep the name (col 2)
          tables[t] = cols.split('\n').map((r) => (r.split('|')[1] || '').trim()).filter(Boolean);
        } catch { tables[t] = []; }
      }
      if (samples[t]) continue;   // already have a sample from a populated store
      // A sample row (round-6): seeing real values tells the LLM which column holds the item NAME and
      // what to LIKE-match, so a "delete Salmon" assertion becomes WHERE ZNAME LIKE '%Salmon%' instead of
      // a guessed numeric column. Scan a few rows and pick the MOST INFORMATIVE one — the first row is
      // often title-less sync/metadata (Reminders' first ZREMCDREMINDER row has a null ZTITLE), so
      // LIMIT 1 surfaced nothing. -json gives clean col→value; keep short, non-null, non-blob pairs.
      // Keep non-null, non-bookkeeping (Z_*), short, non-blob fields — both text and numeric (a numeric
      // value like ZCALORIES=208 still tells the LLM that column's role). Text fields are preferred via
      // the score below (they're the name-like columns we most want the LLM to LIKE-match).
      const usefulPairs = (row) => Object.entries(row)
        .filter(([k, v]) => v != null && v !== '' && !/^Z_/.test(k) && String(v).length <= 40 && !/^(bplist|�)/.test(String(v)));
      try {
        const j = (await sh(`sqlite3 -json -cmd ".timeout 3000" ${shq(db)} "SELECT * FROM ${safeT} LIMIT 8;"`, 8000)).trim();
        const rows = j ? JSON.parse(j) : [];
        // Prefer the row carrying the most non-numeric (text/name-like) fields, then the most fields.
        let best = null, bestScore = -1;
        for (const r of rows) {
          const p = usefulPairs(r);
          const textCount = p.filter(([, v]) => !/^-?\d+(\.\d+)?$/.test(String(v))).length;
          const score = textCount * 10 + p.length;
          if (score > bestScore) { bestScore = score; best = p; }
        }
        // Show TEXT (name-like) fields first — the numeric flags (ZALLDAY=0 …) come first in column
        // order and would otherwise crowd out the one field that matters: the human-readable ZNAME/ZTITLE.
        if (best && best.length) {
          const isNum = (v) => /^-?\d+(\.\d+)?$/.test(String(v));
          best.sort((a, b) => (isNum(a[1]) ? 1 : 0) - (isNum(b[1]) ? 1 : 0));
          samples[t] = best.slice(0, 6).map(([k, v]) => `${k}=${JSON.stringify(String(v)).slice(0, 32)}`).join(', ');
        }
      } catch { /* empty table or unreadable → no sample */ }
    }
  }
  return { tables, samples, stores };
}
