// events.mjs — a trial's raw evidence (events.jsonl), read the same whether it
// sits in a fresh run folder or, compressed, in a test record.
//
// events.jsonl holds every model call with its exact request and response, so
// it is most of a run's size (26 of 36 MB for seven models, 2026-10-16) and
// compresses about 22×. Test records are committed to git, so they keep it as
// events.jsonl.gz; nothing is dropped. (Inspect AI stores its logs compressed
// for the same reason.)

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

/** The events of one trial folder, from events.jsonl or events.jsonl.gz. */
export function readEvents(trialDir) {
  const plain = join(trialDir, 'events.jsonl');
  const gz = `${plain}.gz`;
  let text;
  if (existsSync(plain)) text = readFileSync(plain, 'utf8');
  else if (existsSync(gz)) text = gunzipSync(readFileSync(gz)).toString('utf8');
  else throw new Error(`no events.jsonl or events.jsonl.gz in ${trialDir}`);
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/**
 * Replace every events.jsonl under dir with events.jsonl.gz, checking each
 * round trip before the original is removed.
 * @returns {{ files: number, before: number, after: number }} bytes
 */
export function compressEvents(dir) {
  const out = { files: 0, before: 0, after: 0 };
  (function walk(d) {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (name !== 'events.jsonl') continue;
      const raw = readFileSync(p);
      const packed = gzipSync(raw, { level: 9 });
      if (!gunzipSync(packed).equals(raw)) throw new Error(`compression did not round-trip: ${p}`);
      writeFileSync(`${p}.gz`, packed);
      rmSync(p);
      out.files += 1; out.before += raw.length; out.after += packed.length;
    }
  })(dir);
  return out;
}
