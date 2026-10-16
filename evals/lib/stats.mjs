// stats.mjs — the numbers an eval report needs, and nothing fancier.
//
// pass@1 is the share of trials that passed. pass^k (τ-bench) is the share of
// cases where EVERY one of the k trials passed: what a person relying on the
// assistant every day actually experiences. With few cases the interval is
// wide; it is printed so a difference smaller than the noise is not mistaken
// for a real one.

/** Wilson score interval for a proportion, 95% by default. */
export function wilson(successes, n, z = 1.96) {
  if (n === 0) return { low: 0, high: 0 };
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

/**
 * @param {Record<string, string[]>} verdictsByCase  case id → list of trial verdicts
 */
export function summarize(verdictsByCase) {
  const cases = Object.entries(verdictsByCase);
  let trials = 0; let passes = 0; let errors = 0; let reviews = 0; let allPassed = 0; let gradedCases = 0;
  const perCase = {};
  for (const [id, verdicts] of cases) {
    const graded = verdicts.filter((v) => v !== 'TEST_ERROR');
    const p = graded.filter((v) => v === 'PASS').length;
    trials += graded.length; passes += p;
    errors += verdicts.length - graded.length;
    reviews += graded.filter((v) => v === 'REVIEW').length;
    if (graded.length) { gradedCases += 1; if (p === graded.length) allPassed += 1; }
    perCase[id] = { trials: graded.length, passes: p, errors: verdicts.length - graded.length, verdicts };
  }
  const ci = wilson(passes, trials);
  return {
    cases: cases.length,
    trials,
    test_errors: errors,
    reviews,
    pass_at_1: trials ? passes / trials : null,
    pass_at_1_ci95: ci,
    pass_hat_k: gradedCases ? allPassed / gradedCases : null,
    per_case: perCase,
  };
}

/**
 * Cohen's kappa: agreement between two raters over the same items, corrected
 * for the agreement chance alone would give. pairs: [[raterA, raterB], ...].
 * 1 is perfect, 0 is chance; Landis & Koch call 0.61-0.80 substantial and
 * 0.81-1 almost perfect. null when there are no items.
 */
export function kappa(pairs) {
  const n = pairs.length;
  if (!n) return null;
  const cats = [...new Set(pairs.flat())];
  const po = pairs.filter(([a, b]) => a === b).length / n;
  const pe = cats.reduce((s, c) => s + (pairs.filter(([a]) => a === c).length / n) * (pairs.filter(([, b]) => b === c).length / n), 0);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}
