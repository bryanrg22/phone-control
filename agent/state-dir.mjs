// state-dir.mjs — the one directory the agent writes to.
//
//   logs/        one JSON line per finished task (tasks.jsonl), screenshots
//   memories/    facts about you the agent was asked to remember
//   procedures/  step sequences that worked before
//
// $PHONE_CONTROL_STATE_DIR in a deployment (see deploy/example.env); ./var in
// a checkout, which .gitignore covers.

import { fileURLToPath } from 'url';

export const STATE_DIR = process.env.PHONE_CONTROL_STATE_DIR || fileURLToPath(new URL('../var', import.meta.url));
