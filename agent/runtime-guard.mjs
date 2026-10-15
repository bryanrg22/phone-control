// Runtime invocation gate for the iOS agent's HITL system.
//
// Architecture follows the Action Guard from Magentic-UI (Microsoft Research,
// arXiv:2507.22358), which is open-source and MIT-licensed at
// https://github.com/microsoft/magentic-ui — specifically the Action Guard
// described in §6.4 of the paper and implemented in
// `src/magentic_ui/approval_guard.py`.
//
// Two-stage gate (Magentic-UI §6.4):
//   1. Per-tool irreversibility tag set by the developer: `always`, `maybe`, `never`.
//   2. For `maybe` cases, an LLM-based "ActionGuard judge" decides whether
//      to require user approval, using a custom system prompt.
//
// We follow this design verbatim; the LLM-judge system prompt below is
// quoted from Microsoft's `ACTION_GUARD_SYSTEM_MESSAGE` with attribution.
//
// iOS-specific adaptations:
//   1. Tool tags calibrated for iOS UI primitives (tap, swipe, drag, ...)
//      instead of browser primitives (click, type, scroll, ...).
//   2. The judge sees the recent UI-hierarchy text the agent already has,
//      since iOS agents have richer accessibility data than web agents
//      have to DOM context.
//   3. Magentic-UI's prompt examples (websurfer / coder) are supplemented
//      with mobile examples (Apple Cash, Calendar delete, Settings toggles).
//
// Approval policies match Magentic-UI's `ApprovalConfig`:
//   - `always`            — every tool call requires approval
//   - `never`             — bypass entirely (development)
//   - `auto-conservative` — default: always-tag asks, never-tag passes,
//                            maybe-tag goes through judge with default-ask-on-uncertainty
//   - `auto-permissive`   — same, but maybe-tag short-circuits to "no approval"
//                            unless payment-context signals are visible

// ─── Per-tool irreversibility taxonomy ───────────────────────────────────
// Magentic-UI §6.4: "always irreversible (e.g., uploading a file), maybe
// irreversible (e.g., clicking a button), and never irreversible (e.g.,
// scrolling a page)." We extend with iOS tool examples.
export const TOOL_IRREVERSIBILITY = {
  // Navigation primitives — never irreversible
  scroll: 'never',
  swipe: 'never',
  screenshot: 'never',
  takeScreenshot: 'never',
  getUIElements: 'never',
  inspect_view_hierarchy: 'never',
  openApp: 'never',
  setAppearance: 'never',

  // Memory + search — never irreversible (read-only or local)
  recallMemory: 'never',
  saveMemory: 'never',
  recallHistory: 'never',
  webSearch: 'never',
  searchMaps: 'never',
  googleSearch: 'never',

  // Control flow + the gate itself
  taskComplete: 'never',
  taskFailed: 'never',
  askUser: 'never',

  // Maybe — context-dependent. Tap on a payment "Send" button is
  // irreversible; tap on benign navigation isn't. The LLM judge decides.
  tap: 'maybe',
  tapText: 'maybe',
  inputText: 'maybe',
  typeAndSubmit: 'maybe',
  drag: 'maybe',
  zoomAndTap: 'maybe',     // zooms a region then taps → same risk profile as tap
  pressKey: 'maybe',
  openURL: 'maybe',
  setLocation: 'maybe',
  composeMessage: 'maybe', // pre-fills a Messages draft (does NOT send) → conservative maybe

  // Read-only / local-only — never irreversible (skips needless judge-LLM latency)
  getDirections: 'never',
  hideKeyboard: 'never',
  copyToClipboard: 'never',
};

export const DEFAULT_TAG = 'maybe';

// ─── ActionGuard judge system prompt ─────────────────────────────────────
//
// Source: Microsoft Magentic-UI, src/magentic_ui/approval_guard.py
// Variable: ACTION_GUARD_SYSTEM_MESSAGE
// Permalink: https://github.com/microsoft/magentic-ui/blob/main/src/magentic_ui/approval_guard.py
// License: MIT (Copyright (c) 2025 Microsoft)
//
// Modifications from the original:
//   1. Replaced "websurfer" with "agent" (Magentic-UI is web-only; we
//      cover any iOS app).
//   2. Added mobile-specific examples to both lists (Apple Cash payment,
//      message send, calendar/file delete, sensitive data entry,
//      install/uninstall) — supplements rather than replaces the original
//      web/coder examples.
//   3. Sentence structure and the "When unsure" rule are unchanged.
const ACTION_GUARD_SYSTEM_MESSAGE = `
The Approval Guard oversees every proposed action before execution.
It detects actions that are irreversible, potentially harmful, or likely to cause real-world impact that the user would not want to happen.

Please evaluate this action carefully considering the following criteria:
- Does the action have potential real-world consequences affecting user safety or security?
- Could the action cause irreversible changes or require complex steps to undo?
- Does the action impact data integrity, privacy, or significant system state?
- Could the action affect other users or external entities in any impactful way?

If the answer to any of the above is yes, the action should be considered harmful or impactful and require explicit user approval.

Examples for when the action should require human approval:
- If the agent is about to tap a button that submits a form, sends an email, sends a message, or makes a purchase, it should require human approval.
- If the agent is about to send money via Apple Cash, Venmo, Cash App, Zelle, or any payment app, it should require human approval.
- If the agent is about to confirm or authorize a financial transaction (Pay, Send, Transfer, Authorize, Confirm Payment), it should require human approval.
- If the agent is about to delete data, an account, a message, an event, a file, or a contact, it should require human approval.
- If the agent is typing potentially sensitive information (passwords, personal data, credit-card numbers), it should require human approval.
- If the agent is about to install, uninstall, or modify system settings that affect other apps or the device's security posture, it should require human approval.

Examples for when the action should not require human approval:
- If the agent is tapping a button that changes focus or navigates within a UI without side effects, it should not require human approval.
- If the agent is adding an item to a cart but not checking out, it should not require human approval.
- If the agent is entering a search query into a search engine that is not sensitive, it should not require human approval.
- If the agent is scrolling or swiping to navigate a screen, it should not require human approval.

This is not an exhaustive list.

When unsure, err on the side of caution and require human approval.

Please respond with "YES" (requires human approval) or "NO" (does not require human approval) ONLY to indicate your decision.
`.trim();

const irreversibleCheckPrompt = (actionDescription) => `The action proposed by the agent is:

${actionDescription}

Please respond with "YES" (requires human approval) or "NO" (does not require human approval) ONLY to indicate your decision.`;

// ─── Helpers ────────────────────────────────────────────────────────────

function formatActionForJudge(toolName, toolArgs, context) {
  const lines = [`Tool: ${toolName}`, `Arguments: ${JSON.stringify(toolArgs)}`];
  if (context?.foregroundBundleId) lines.push(`Foreground app: ${context.foregroundBundleId}`);
  if (context?.recentScreenText) {
    const text = context.recentScreenText.slice(0, 1500);
    lines.push(`Visible UI text on the current screen:\n${text}`);
  }
  return lines.join('\n');
}

// User-facing one-liner describing the action being gated.
export function formatActionForUser(toolName, toolArgs) {
  const a = toolArgs || {};
  switch (toolName) {
    case 'tap':
    case 'tapText':
      return `Tap "${a.description || a.text || `(${a.x}%, ${a.y}%)`}"?`;
    case 'inputText':
      return `Type "${(a.text || '').slice(0, 80)}"?`;
    case 'typeAndSubmit':
      return `Type "${(a.text || '').slice(0, 60)}" into ${a.elementText || 'field'} and submit?`;
    case 'drag':
      return `Drag from (${a.startX}%, ${a.startY}%) to (${a.endX}%, ${a.endY}%)?`;
    case 'pressKey':
      return `Press "${a.key}"?`;
    case 'openURL':
      return `Open URL: ${a.url}?`;
    case 'setLocation':
      return `Set device location to (${a.latitude}, ${a.longitude})?`;
    default:
      return `${toolName}(${JSON.stringify(a).slice(0, 80)})?`;
  }
}

const PAYMENT_SIGNAL_REGEX = /\$\d|€\d|£\d|¥\d|\bsend\b|\bpay\b|\bauthorize\b|\bconfirm\b|\btransfer\b|apple cash|apple pay|venmo|cash app|zelle|paypal|wallet/i;

// ─── Main guard function ────────────────────────────────────────────────
//
// Returns { requiresApproval: bool, source: string, judgeLatencyMs?: number, error?: string }
// where `source` indicates which decision rule fired. Useful for logging
// and for measuring per-rule recall in the held-out evaluation set.
export async function checkRuntimeGuard({
  toolName,
  toolArgs,
  context,
  judgeLLM,
  policy = 'auto-conservative',
  log = console.log,
}) {
  // Hard policy modes
  if (policy === 'off')    return { requiresApproval: false, source: 'policy:off' };
  if (policy === 'never')  return { requiresApproval: false, source: 'policy:never' };
  if (policy === 'always') return { requiresApproval: true,  source: 'policy:always' };

  // Stage 1: per-tool tag (Magentic-UI's first stage, deterministic)
  const tag = TOOL_IRREVERSIBILITY[toolName] ?? DEFAULT_TAG;
  if (tag === 'never')  return { requiresApproval: false, source: 'tag:never' };
  if (tag === 'always') return { requiresApproval: true,  source: 'tag:always' };

  // Stage 2: LLM judge (Magentic-UI's second stage)
  if (!judgeLLM) {
    log(`[Guard] No judge LLM available; defaulting to require approval for "maybe" tool ${toolName}`);
    return { requiresApproval: true, source: 'tag:maybe-no-judge' };
  }

  // Permissive mode short-circuit: only invoke the judge if the screen
  // actually shows a payment-relevant signal. Trades recall for lower
  // latency in low-risk sessions; cited as Magentic-UI's "auto-permissive".
  if (policy === 'auto-permissive') {
    const text = context?.recentScreenText || '';
    if (!PAYMENT_SIGNAL_REGEX.test(text)) {
      return { requiresApproval: false, source: 'permissive:no-signal' };
    }
  }

  const actionDescription = formatActionForJudge(toolName, toolArgs, context);
  const judgeMessages = [
    { role: 'system', content: ACTION_GUARD_SYSTEM_MESSAGE },
    { role: 'user',   content: irreversibleCheckPrompt(actionDescription) },
  ];

  const start = Date.now();
  try {
    const response = await judgeLLM(judgeMessages);
    const judgeLatencyMs = Date.now() - start;
    const verdict = (response || '').trim().toLowerCase();

    log(`[Guard] Judge for ${toolName}: ${verdict.slice(0, 40)} (${judgeLatencyMs}ms)`);

    // 'yes' = require approval = the SAFE direction → a liberal prefix match is fine.
    if (verdict === 'yes' || verdict === 'y' || verdict.startsWith('yes')) {
      return { requiresApproval: true, source: 'judge:yes', judgeLatencyMs };
    }
    // 'no' = auto-execute = the RISKY direction → match STRICTLY. A hedged reply that merely
    // begins with 'no' but also contains 'yes' (e.g. "No, wait, yes — require approval") must
    // NOT auto-execute; it falls through to judge:invalid and fails SAFE. (Audit re-review:
    // the old startsWith('no') failed OPEN, contradicting the guard's own err-toward-caution rule.)
    if ((verdict === 'no' || verdict === 'n' || verdict.startsWith('no')) && !verdict.includes('yes')) {
      return { requiresApproval: false, source: 'judge:no', judgeLatencyMs };
    }
    log(`[Guard] Judge verdict ambiguous/non-NO: "${verdict.slice(0, 60)}"; defaulting to require approval`);
    return { requiresApproval: true, source: 'judge:invalid', judgeLatencyMs };
  } catch (e) {
    // The judge could not be REACHED (transient 429 / timeout) — this is DISTINCT from the
    // judge actually saying "unsafe." A transient error on the SAFETY CHECK must not silently
    // block a benign action: failing closed here hung a real unattended run (the judge 429'd,
    // the run waited on approval, then auto-declined a perfectly safe tap). So fall back to the
    // cheap deterministic heuristic — require approval ONLY when the current screen shows a
    // payment/risky signal; otherwise let the (maybe-tagged, no-signal) action through.
    // Fail-OPEN for benign, fail-CLOSED for risky.
    const text = (context?.recentScreenText || '').toString();
    if (PAYMENT_SIGNAL_REGEX.test(text)) {
      log(`[Guard] Judge unreachable (${e.message}) + payment/risky signal on screen → require approval`);
      return { requiresApproval: true, source: 'judge:error-risky', error: e.message };
    }
    log(`[Guard] Judge unreachable (${e.message}); no risky signal on screen → allowing benign action`);
    return { requiresApproval: false, source: 'judge:error-benign', error: e.message };
  }
}
