// models.mjs — which model drives the phone, per run or by default.
//
// The model that DRIVES THE PHONE is not the model the user chats with: the
// chat model only decides to call these tools. This list is what a run may ask
// for; each entry names the provider whose key the agent needs.
//
// "verified" = ran this agent against the real phone (screen reading + tool
// calls) on the date given. The rest exist on the provider's model list and are
// known to the project. Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.1, GPT-6.1 Sol,
// GPT-6 Astra and GPT-6 Luna completed an iOSWorld task on a simulator through
// this agent on 2026-10-15 (evals/phone-agent); a real phone is the next check.

export const MODELS = {
  // A bare family name ("Sonnet", "Sol") is an alias of the family's newest
  // member; older members stay reachable by version ("Sonnet 5", "Sol 6").
  'gpt-6-luna':             { provider: 'openai',    label: 'GPT-6 Luna',        aliases: ['luna', 'luna 6', 'gpt 6 luna'], verified: '2026-10-12' },
  'gpt-6.1-sol':            { provider: 'openai',    label: 'GPT-6.1 Sol',       aliases: ['sol', 'sol 6.1', 'gpt 6.1 sol'] },
  'gpt-6-astra':            { provider: 'openai',    label: 'GPT-6 Astra',       aliases: ['astra'] },
  'gpt-6-sol':              { provider: 'openai',    label: 'GPT-6 Sol',         aliases: ['sol 6', 'gpt 6 sol'] },
  'gpt-5.6-luna':           { provider: 'openai',    label: 'GPT-5.6 Luna',      aliases: ['luna 5.6'] },
  'gpt-5.6-terra':          { provider: 'openai',    label: 'GPT-5.6 Terra',     aliases: ['terra'] },
  'gpt-5.6-sol':            { provider: 'openai',    label: 'GPT-5.6 Sol',       aliases: ['sol 5.6'] },
  'claude-opus-5-5':        { provider: 'anthropic', label: 'Claude Opus 5.5',   aliases: ['opus', 'claude opus', 'opus 5.5'] },
  'claude-sonnet-5-5':      { provider: 'anthropic', label: 'Claude Sonnet 5.5', aliases: ['sonnet', 'claude sonnet', 'sonnet 5.5'] },
  'claude-haiku-5-5':       { provider: 'anthropic', label: 'Claude Haiku 5.5',  aliases: ['haiku', 'claude haiku'] },
  'claude-fable-5-1':       { provider: 'anthropic', label: 'Claude Fable 5.1',  aliases: ['fable', 'claude fable', 'fable 5.1'] },
  'claude-sonnet-5':        { provider: 'anthropic', label: 'Claude Sonnet 5',   aliases: ['sonnet 5'], verified: '2026-10-12' },
  'claude-opus-5':          { provider: 'anthropic', label: 'Claude Opus 5',     aliases: ['opus 5'] },
  'claude-fable-5':         { provider: 'anthropic', label: 'Claude Fable 5',    aliases: ['fable 5'] },
  'gemini-3.6-flash':       { provider: 'gemini',    label: 'Gemini 3.6 Flash',  aliases: ['gemini', 'flash', 'gemini flash'] },
  'gemini-3.1-pro-preview': { provider: 'gemini',    label: 'Gemini 3.1 Pro',    aliases: ['gemini pro'] },
  // Hybrids (agent/decision/escalate.mjs): a decision model chooses each step,
  // and GPT-6 Luna, with the screenshot and the full tools, takes over when the
  // choice is a conclusion, typing, unsure or stuck, keeping control until it
  // hands back (--escalation-mode sticky). "Jev" and "Decisions" mean these, not
  // the decision models alone, none of whose iOSWorld passes held up when checked
  // by hand. Simulator only so far, three trials of the 27 single-app tasks, every
  // run checked by hand: Decisions 67%, Jev 58%, against 74% for Luna alone (Decisions
  // vs Luna not significant), 10-17% cheaper and a fifth faster; both paid a $50
  // transfer at least twice without asking (docs/results.md,
  // evals/baselines/phone-agent/2026-10-17_7625741_luna-and-sticky-hybrids_trials-2-3_single-app).
  // agentModel is what the agent is given as --model; keys, every provider
  // whose key the run needs.
  'hybrid-decisions':       { provider: 'hybrid', label: 'Decisions hybrid', aliases: ['decisions', 'decision', 'decisions hybrid', 'decisions api', 'openai decisions'],
                              agentModel: 'openai-decisions:gpt-6-luna+openai:gpt-6-luna', agentArgs: ['--escalation-mode', 'sticky'], keys: ['openai'] },
  'hybrid-jev':             { provider: 'hybrid', label: 'Jev hybrid',       aliases: ['jev', 'jev hybrid', 'typesafe', 'typesafe jev'],
                              agentModel: 'typesafe:jev-latest+openai:gpt-6-luna', agentArgs: ['--escalation-mode', 'sticky'], keys: ['openai', 'typesafe'] },
};

export const FALLBACK_DEFAULT_MODEL = 'gpt-6-luna';

export const PROVIDER_KEY_ENV = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', gemini: 'GEMINI_API_KEY', typesafe: 'TYPESAFE_API_KEY' };

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim();

/**
 * Accepts an exact id ("gpt-6-luna") or how a person says it ("Luna", "GPT 6
 * Luna", "sonnet"). Returns { id, provider, label, agentModel, agentArgs, keys }
 * or null: agentModel is the agent's --model (the id, except for a hybrid),
 * agentArgs any further agent flags, keys every provider whose key it needs.
 * A bare family name resolves to its newest member, which is what someone
 * saying "Luna" means.
 */
export function resolveModel(input) {
  const want = norm(input);
  if (!want) return null;
  for (const [id, m] of Object.entries(MODELS)) {
    if (norm(id) === want || norm(m.label) === want || m.aliases.some((a) => norm(a) === want)) {
      return { id, provider: m.provider, label: m.label, agentModel: m.agentModel || id, agentArgs: m.agentArgs || [], keys: m.keys || [m.provider] };
    }
  }
  return null;
}

export const modelChoices = () => Object.entries(MODELS).map(([id, m]) => `${m.label} (${id})`).join(', ');

/** The first provider a resolved model needs whose key is not set, or null. */
export function missingProviderKey(model, hasKey) {
  return (model.keys || [model.provider]).find((p) => !hasKey(p)) || null;
}

/** Is the key for this provider present? Decided before anything touches the phone. */
export function providerKeyPresent(provider, env = process.env) {
  const name = PROVIDER_KEY_ENV[provider];
  return !!name && String(env[name] || '').trim().length > 0;
}
