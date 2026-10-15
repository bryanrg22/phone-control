// prefs.mjs — per-user settings the connector remembers between chats.
// Today that is one thing: the user's default phone-driving model, so "from now
// on use Sol" outlives the conversation it was said in.
//
// Same storage philosophy as the rest of the repo: one small JSON file, atomic
// rename, mode 0600, no dependencies.

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { resolveModel, FALLBACK_DEFAULT_MODEL } from './models.mjs';

export function createPrefs({ path, defaultModel = FALLBACK_DEFAULT_MODEL } = {}) {
  const base = resolveModel(defaultModel)?.id || FALLBACK_DEFAULT_MODEL;
  const load = () => {
    if (!path || !existsSync(path)) return {};
    try { const j = JSON.parse(readFileSync(path, 'utf8')); return j && typeof j === 'object' ? j : {}; } catch { return {}; }
  };
  const save = (db) => {
    if (!path) return;
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
    renameSync(tmp, path);
  };
  return {
    serverDefault: base,
    /** The user's default, falling back to the server's if theirs is gone from the list. */
    modelFor(uid) {
      const mine = load()[uid]?.model;
      return resolveModel(mine)?.id || base;
    },
    setModel(uid, id) {
      const m = resolveModel(id);
      if (!m) throw new Error(`unknown model: ${id}`);
      const db = load();
      db[uid] = { ...(db[uid] || {}), model: m.id };
      save(db);
      return m;
    },
  };
}
