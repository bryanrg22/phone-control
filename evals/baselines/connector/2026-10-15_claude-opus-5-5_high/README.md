# Baseline: Claude Opus 5.5 (effort high), 2026-10-15

The first full connector-eval run: 14 cases × 3 trials, judged by gpt-6-luna.

- pass@1 100% (95% interval 92–100%), pass^3 100%, 0 test errors, 0 for review.
- Cost: about 560k input and 15k output tokens for the assistant (≈ $2.55 at list price, no prompt caching), plus about 76k judge tokens.
- At 100% this set cannot tell a better model or tool description from a worse one. It is a **regression** set: a drop below 100% on it means something broke. Harder cases are needed to measure capability.
- One finding: after a start fails because the phone is locked, `get_phone_status` reported the phone as ready, so the assistant tried again once (state-locked, all trials). Cause: the clean-up suspend after every task overwrote the failure record. Fixed the same day; re-run with the fix, the assistant stopped after one attempt in 3 of 3 trials, and the case now fails on a retry.
