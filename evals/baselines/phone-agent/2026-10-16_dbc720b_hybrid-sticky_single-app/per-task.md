# Six agents on the 27 single-app tasks, per task

Verdicts are iOSWorld's judge (gpt-5.4-mini); a task passes when every rubric criterion holds. One trial each. Decisions API and Luna on 4888b67, Jev on c4d73d2, the step hybrid on 487f174, both sticky hybrids on dbc720b; the decision harness is the same in all.

| task | Decisions | Jev | Luna | Hyb step | Hyb sticky | Hyb sticky Jev |
| --- | --- | --- | --- | --- | --- | --- |
| caltrack-001 | fail 4/8 | fail 2/8 | fail 5/8 | fail 7/8 | **pass** 8/8 | fail 7/8 |
| cinephile-001 | fail 3/6 | fail 2/6 | **pass** 6/6 | fail 2/6 | **pass** 6/6 | **pass** 6/6 |
| cityride-001 | fail 2/7 | fail 4/7 | **pass** 7/7 | **pass** 7/7 | **pass** 7/7 | **pass** 7/7 |
| clock-001 | fail 5/6 | fail 3/6 | **pass** 6/6 | **pass** 6/6 | **pass** 6/6 | **pass** 6/6 |
| clouddocs-004 | fail 4/6 | fail 4/6 | **pass** 6/6 | **pass** 6/6 | **pass** 6/6 | **pass** 6/6 |
| clouddrive-001 | fail 4/6 | fail 2/6 | **pass** 6/6 | **pass** 6/6 | **pass** 6/6 | **pass** 6/6 |
| cloudsheets-003 | fail 2/7 | fail 2/7 | fail 5/7 | **pass** 7/7 | **pass** 7/7 | **pass** 7/7 |
| cloudslides-002 | fail 4/7 | fail 4/7 | **pass** 7/7 | **pass** 7/7 | **pass** 7/7 | **pass** 7/7 |
| dinespot-001 | fail 7/9 | fail 7/9 | **pass** 9/9 | **pass** 9/9 | **pass** 9/9 | **pass** 9/9 |
| freshcart-001 | fail 6/8 | fail 0/8 | fail 1/8 | **pass** 8/8 | **pass** 8/8 | **pass** 8/8 |
| lockedin-003 | fail 5/8 | fail 5/8 | **pass** 8/8 | **pass** 8/8 | **pass** 8/8 | **pass** 8/8 |
| lockedin-004 | fail 3/12 | fail 4/12 | **pass** 12/12 | fail 11/12 | **pass** 12/12 | fail 9/12 |
| mail-002 | fail 3/5 | fail 3/5 | **pass** 5/5 | fail 4/5 | **pass** 5/5 | **pass** 5/5 |
| megamart-001 | fail 4/6 | fail 3/6 | **pass** 6/6 | **pass** 6/6 | **pass** 6/6 | **pass** 6/6 |
| mybank-003 | fail 6/7 | fail 6/7 | fail 4/7 | fail 6/7 | fail 6/7 | fail 6/7 |
| notes-001 | fail 3/5 | fail 3/5 | **pass** 5/5 | **pass** 5/5 | **pass** 5/5 | **pass** 5/5 |
| quickbite-001 | fail 3/6 | fail 3/6 | fail 4/6 | **pass** 6/6 | fail 2/6 | fail 4/6 |
| quickchat-003 | fail 5/9 | fail 5/9 | **pass** 9/9 | **pass** 9/9 | **pass** 9/9 | **pass** 9/9 |
| scorezone-003 | fail 3/9 | fail 3/9 | **pass** 9/9 | **pass** 9/9 | **pass** 9/9 | **pass** 9/9 |
| skytrip-002 | fail 3/8 | fail 3/8 | **pass** 8/8 | **pass** 8/8 | **pass** 8/8 | fail 4/8 |
| splitpay-001 | fail 4/7 | fail 5/7 | **pass** 7/7 | **pass** 7/7 | **pass** 7/7 | **pass** 7/7 |
| stayfinder-001 | **pass** 7/7 | **pass** 7/7 | **pass** 7/7 | **pass** 7/7 | **pass** 7/7 | **pass** 7/7 |
| tasterank-001 | fail 5/7 | fail 5/7 | **pass** 7/7 | **pass** 7/7 | **pass** 7/7 | **pass** 7/7 |
| teamchat-003 | fail 4/7 | fail 3/7 | **pass** 7/7 | **pass** 7/7 | **pass** 7/7 | **pass** 7/7 |
| ticketbox-004 | **pass** 6/6 | **pass** 6/6 | **pass** 6/6 | **pass** 6/6 | **pass** 6/6 | **pass** 6/6 |
| trailblaze-004 | **pass** 5/5 | fail 3/5 | **pass** 5/5 | **pass** 5/5 | **pass** 5/5 | **pass** 5/5 |
| weather-004 | fail 3/9 | fail 2/9 | fail 3/9 | fail 6/9 | **pass** 9/9 | fail 1/9 |

| agent | tasks | passed | model time / task | wall time / task | cost / task | LLM share of model calls |
| --- | --- | --- | --- | --- | --- | --- |
| Decisions | 27 | 3 | 17.7 s | 45 s | $0.0049 | 0% |
| Jev | 27 | 2 | 2.2 s | 25 s | $0.0025 | 0% |
| Luna | 27 | 21 | 41.9 s | 67 s | $0.0081 | 100% |
| Hyb step | 27 | 21 | 31.1 s | 54 s | $0.0099 | 36% |
| Hyb sticky | 27 | 25 | 35.7 s | 58 s | $0.0081 | 63% |
| Hyb sticky Jev | 27 | 21 | 36.1 s | 59 s | $0.0081 (recomputed: the run carried the Jev price bug fixed in fdc54d7) | 65% |
