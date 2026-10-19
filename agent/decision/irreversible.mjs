// irreversible.mjs — which on-screen controls commit something that cannot be taken back.
//
// The LLM mode's prompt has it ask the user before "purchases or payments" and
// "deleting data" (prompt.mjs, askUser rules), and OpenAI's Operator, the
// established reference, confirms before "finalizing actions that affect the
// state of the world (e.g. before submitting a purchase or sending an email)",
// in every financial transaction of its eval set (o3 CUA system card, 2025).
// A decision model has no way to ask: on iOSWorld mybank-003 the sticky hybrid
// tapped "Send now" at p 0.87 and paid $50 that GPT-6 Luna alone asked about
// first (2026-10-16). So the harness recognises these controls itself.
//
// Two classes, by what the product does about them:
//   confirm   money moves or data is deleted: pay, send money, place an order,
//             buy, request or book with a price on the button, delete. The user
//             is asked first (the LLM in hybrid mode; the harness in
//             decision-only mode, decision/loop.mjs).
//   verify    something is sent or committed that the user's own command
//             authorises (the LLM's rule: "The user's command IS the
//             confirmation"): send a message or email, post, submit, book or
//             reserve with no price shown. In hybrid mode the LLM checks the
//             recipient and the text before it goes; nobody is asked.
//
// Precise, not broad: a label must BE a commit phrase, not contain a commit
// word. "Send | Zelle®", "Pay/Request", "Pay bills", "Book a Flight", "Order
// history", "Reply" and "Transfer" (a tab in SplitPay and TicketBox) open a screen; "Send now", "Pay", "Place Order" and
// "Confirm & Place Order" commit. Every element on 5,736 saved iOSWorld screens
// is checked against this in agent/test/irreversible.test.mjs. Removing an item
// (a cart line, a food entry) and archiving are left out: both are undone by
// adding it back. Pure: no I/O.

const PRICE = /[$€£]\s?\d[\d,]*(?:\.\d{1,2})?(?:\s*\/\s*[a-z]+)?/i;
// A price at the end, with the separator before it: "Request CityRideX · $12.80", "Pay $32.50", "Place order ($20.70)".
const TRAILING_PRICE = new RegExp(`\\s*(?:[·•|:,–—-]\\s*)?\\(?${PRICE.source}\\)?\\s*$`, 'i');

const DELETE = /^(?:permanently\s+)?(?:delete|erase)\b(?!d)|^empty\s+trash$/;
const PAY = /^(?:pay|pay now|send money|send payment|transfer now|transfer money|confirm (?:payment|transfer|purchase)|confirm (?:&|and) pay|authori[sz]e payment|tip|donate|donate now|subscribe|subscribe now)$/;
const ORDER = /^(?:place (?:your |my )?order|order now|confirm (?:your )?order|confirm (?:&|and) (?:place )?order|submit order|complete (?:purchase|order|checkout)|buy|buy now|purchase|purchase now|checkout and pay)$/;
// With a price on the button, a commit verb moves money whatever follows it.
const PRICED_VERB = /^(?:pay|send|request|book|order|place|confirm|buy|purchase|reserve|rent|subscribe|tip|donate|complete|checkout|check out)\b/;
const MESSAGE = /^(?:send|send message|send email|send reply|send now|reply all|post|post reply|post comment|publish|share post|tweet|submit|submit review|submit comment)$/;
const BOOKING = /^(?:book|book now|confirm booking|complete booking|reserve|reserve now|reserve table|confirm reservation|request ride|confirm ride)$/;
// "Send now" moves money only when the task does: MyBank's Zelle button, an email client's scheduled send.
const MONEY_TASK = /[$€£]\s?\d|\b(?:pay|paid|payment|zelle|venmo|transfer|money|wire|tip)\b/i;

/** "Request CityRideX · $12.80" → { head: "request cityridex", priced: true } */
export function normaliseLabel(label) {
  let s = String(label ?? '').replace(/[\u00a0\u202f\s]+/g, ' ').trim().replace(/^["“]|["”]$/g, '');
  const priced = TRAILING_PRICE.test(s);
  if (priced) s = s.replace(TRAILING_PRICE, '');
  s = s.replace(/[.!…]+$/, '').trim().toLowerCase();
  return { head: s, priced };
}

/**
 * @param {string|null} label   the control's label (an element's name), never a text field's contents
 * @param {{ task?: string }} [o]
 * @returns {{ policy: 'confirm'|'verify', what: string }|null}  what: words for the user ("send money")
 */
export function commitOfLabel(label, { task = '' } = {}) {
  const { head, priced } = normaliseLabel(label);
  if (!head || head.length > 40) return null;
  if (DELETE.test(head)) return { policy: 'confirm', what: 'delete data' };
  if (PAY.test(head)) return { policy: 'confirm', what: 'send money' };
  if (ORDER.test(head)) return { policy: 'confirm', what: 'place an order' };
  if (priced && PRICED_VERB.test(head)) return { policy: 'confirm', what: 'spend money' };
  if (head === 'send now' && MONEY_TASK.test(task)) return { policy: 'confirm', what: 'send money' };
  if (MESSAGE.test(head)) return { policy: 'verify', what: 'send or post something' };
  if (BOOKING.test(head)) return { policy: 'verify', what: 'make a booking' };
  return null;
}

/** An element of listElements(): its label, unless it is a field (what a field holds is not a button's name). */
export function commitOfElement(e, o) {
  if (!e || e.editable || e.kind === 'key') return null;
  return commitOfLabel(e.name || e.text, o);
}

/**
 * The element a tap at (x, y) percent lands on: the smallest whose frame holds
 * the point (a button inside a row inside a sheet is the button).
 * @param {Array<{ x: number|null, y: number|null, w: number|null, h: number|null }>} elements
 * @param {{ widthPoints: number, heightPoints: number }} screen
 */
export function elementAt(elements, x, y, screen) {
  let best = null;
  for (const e of elements) {
    if (e.x === null || e.y === null || !e.w || !e.h) continue;
    const halfW = (e.w / 2 / screen.widthPoints) * 100;
    const halfH = (e.h / 2 / screen.heightPoints) * 100;
    if (Math.abs(x - e.x) > halfW + 0.2 || Math.abs(y - e.y) > halfH + 0.2) continue;
    if (!best || e.w * e.h < best.w * best.h) best = e;
  }
  return best;
}

/**
 * What a tool call would commit, judged from the screen the model last saw.
 * tapText names its target; tap is matched to the element under the point.
 * @returns {{ policy: 'confirm'|'verify', what: string, label: string }|null}
 */
export function commitOfCall(name, args, { elements = [], screen, task = '' }) {
  if (!args) return null;
  if (name === 'tapText') {
    // The keyboard's "delete" key is no deletion: a label found on screen only on keys or fields is not a control.
    const same = elements.filter((e) => (e.name || '').toLowerCase() === String(args.text).toLowerCase());
    if (same.length && same.every((e) => e.kind === 'key' || e.editable)) return null;
    const c = commitOfLabel(args.text, { task });
    return c && { ...c, label: String(args.text) };
  }
  if (name === 'tap' && screen && typeof args.x === 'number' && typeof args.y === 'number') {
    const e = elementAt(elements, args.x, args.y, screen);
    const c = commitOfElement(e, { task });
    return c && { ...c, label: e.name || e.text };
  }
  return null;
}

/**
 * Whether a user's answer agrees: it must say yes, or name the action ("Send
 * it"), and not refuse. Every confirmation GPT-6 Luna wrote on iOSWorld put
 * "Yes, …" first ("Yes, send $50", "Yes, place order", "Yes, request it"); an
 * answer to another question ("Maya Patel", to "Which Maya?") is no consent.
 */
export function isConsent(answer) {
  if (answer === null || answer === undefined) return false;
  const a = String(answer).trim();
  if (isRefusal(a)) return false;
  return /^(?:yes|yeah|yep|y|ok|okay|sure|confirm(?:ed)?|approve[d]?|go ahead|proceed|do it|please do|send|pay|place|buy|book|request|order|delete)\b/i.test(a);
}

/** "No, cancel", "Don't place it", "Cancel". */
export function isRefusal(answer) {
  return /^(?:no|nope|cancel|don'?t|do not|stop|never|not now|decline|deny|abort)\b/i.test(String(answer ?? '').trim());
}
