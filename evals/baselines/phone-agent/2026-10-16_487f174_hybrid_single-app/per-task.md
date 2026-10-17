# Four agents on the 27 single-app tasks, per task

Verdicts are iOSWorld's judge (gpt-5.4-mini); a task passes when every rubric criterion holds. Decisions API and GPT-6 Luna ran on 4888b67, Jev on c4d73d2, the hybrid on 487f174 (= c4d73d2 plus the hybrid mode); the decision harness is the same in all three commits.

| task | Decisions | Jev | Luna LLM | Hybrid | hybrid: LLM calls of all calls |
| --- | --- | --- | --- | --- | --- |
| caltrack-001 | fail 4/8 | fail 2/8 | fail 5/8 | fail 7/8 | 12 of 32 |
| cinephile-001 | fail 3/6 | fail 2/6 | **pass** 6/6 | fail 2/6 | 8 of 20 |
| cityride-001 | fail 2/7 | fail 4/7 | **pass** 7/7 | **pass** 7/7 | 3 of 9 |
| clock-001 | fail 5/6 | fail 3/6 | **pass** 6/6 | **pass** 6/6 | 8 of 21 |
| clouddocs-004 | fail 4/6 | fail 4/6 | **pass** 6/6 | **pass** 6/6 | 10 of 24 |
| clouddrive-001 | fail 4/6 | fail 2/6 | **pass** 6/6 | **pass** 6/6 | 2 of 7 |
| cloudsheets-003 | fail 2/7 | fail 2/7 | fail 5/7 | **pass** 7/7 | 12 of 29 |
| cloudslides-002 | fail 4/7 | fail 4/7 | **pass** 7/7 | **pass** 7/7 | 14 of 30 |
| dinespot-001 | fail 7/9 | fail 7/9 | **pass** 9/9 | **pass** 9/9 | 8 of 23 |
| freshcart-001 | fail 6/8 | fail 0/8 | fail 1/8 | **pass** 8/8 | 20 of 47 |
| lockedin-003 | fail 5/8 | fail 5/8 | **pass** 8/8 | **pass** 8/8 | 2 of 11 |
| lockedin-004 | fail 3/12 | fail 4/12 | **pass** 12/12 | fail 11/12 | 12 of 32 |
| mail-002 | fail 3/5 | fail 3/5 | **pass** 5/5 | fail 4/5 | 4 of 12 |
| megamart-001 | fail 4/6 | fail 3/6 | **pass** 6/6 | **pass** 6/6 | 3 of 8 |
| mybank-003 | fail 6/7 | fail 6/7 | fail 4/7 | fail 6/7 | 6 of 22 |
| notes-001 | fail 3/5 | fail 3/5 | **pass** 5/5 | **pass** 5/5 | 5 of 13 |
| quickbite-001 | fail 3/6 | fail 3/6 | fail 4/6 | **pass** 6/6 | 10 of 38 |
| quickchat-003 | fail 5/9 | fail 5/9 | **pass** 9/9 | **pass** 9/9 | 7 of 17 |
| scorezone-003 | fail 3/9 | fail 3/9 | **pass** 9/9 | **pass** 9/9 | 3 of 9 |
| skytrip-002 | fail 3/8 | fail 3/8 | **pass** 8/8 | **pass** 8/8 | 10 of 27 |
| splitpay-001 | fail 4/7 | fail 5/7 | **pass** 7/7 | **pass** 7/7 | 27 of 64 |
| stayfinder-001 | **pass** 7/7 | **pass** 7/7 | **pass** 7/7 | **pass** 7/7 | 2 of 7 |
| tasterank-001 | fail 5/7 | fail 5/7 | **pass** 7/7 | **pass** 7/7 | 4 of 17 |
| teamchat-003 | fail 4/7 | fail 3/7 | **pass** 7/7 | **pass** 7/7 | 3 of 10 |
| ticketbox-004 | **pass** 6/6 | **pass** 6/6 | **pass** 6/6 | **pass** 6/6 | 8 of 29 |
| trailblaze-004 | **pass** 5/5 | fail 3/5 | **pass** 5/5 | **pass** 5/5 | 2 of 6 |
| weather-004 | fail 3/9 | fail 2/9 | fail 3/9 | fail 6/9 | 28 of 77 |

On the 27 tasks the hybrid finished:
| agent | passed | model time / task | cost / task | steps / task |
| --- | --- | --- | --- | --- |
| Decisions | 3 of 27 | 17.7 s | $0.0049 | 15.4 |
| Jev | 2 of 27 | 2.2 s | $0.0025 | 15.4 |
| Luna LLM | 21 of 27 | 41.9 s | $0.0081 | 14.1 |
| Hybrid | 21 of 27 | 31.1 s | $0.0099 | 15.1 |

