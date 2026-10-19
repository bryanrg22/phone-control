# Hand check: every judged fail of the three trials

The [pass check](hand-check.md) could only lower a score: it read every run the judge passed, and none it failed. This file closes that gap. **All 52 runs the judge failed** (Luna 18, Decisions hybrid 14, Jev hybrid 20, over all three trials) were read the same way (the actions and element lists in `agent-trace/transcript.md`, the screenshots of the decisive screens, the saved app state, iOSWorld's seed) and held to [the same bar](README.md#how-each-pass-was-checked). Checked 2026-10-18; verdicts in `checks/fails-<agent>-t<trial>.json`.

A judged fail counts as a real pass if it would have been ruled **holds** had the judge passed it. Two things follow from using the same bar:

- **The goal decides, not the rubric.** The judge's rubric sometimes asks for more than the goal does: mybank-003's rubric wants a memo, while the goal is "Send $50 via Zelle to Maya Patel in MyBank and confirm the payment was sent". A criterion that is not in the goal, or is only procedure ("select the store"), decides nothing.
- **Asking first is not doing.** A run that stopped to ask the user before paying, ordering or booking, and so did not do it, is a fail, however sensible the question.

Each run was read once against a written brief; every run ruled "holds" (the ones that change a score) was then checked again against the screens and the seed, and the "not counted" and "fail" verdicts were checked for consistency with the rulings used on passes.

## Result

| agent | judged fails | holds (judge under-credited) | not counted | fail |
| --- | :---: | :---: | :---: | :---: |
| GPT-6 Luna alone | 18 | **4** | 1 | 13 |
| Sticky hybrid, Decisions + Luna | 14 | **1** | 4 | 9 |
| Sticky hybrid, Jev + Luna | 20 | **3** | 3 | 14 |
| all | 52 | **8** (15%) | 8 | 36 |

**The judge also under-credits**, less often than it over-credits (8 of 52 judged fails hold up, against 38 of 191 judged passes that do not), and the under-credits are not spread evenly either: Luna gains 4, the Jev hybrid 3, the Decisions hybrid 1. The eight:

| run | what the judge got wrong |
| --- | --- |
| cloudsheets-003: Luna t1, Luna t3, Jev t3 | Ava's Status (D2) went from Confirmed to Pending, and the answer names Ava. The sheet scrolls sideways, so the screens after the edit show the Lead and Status columns without the names; the judge took "Ops" (Ava's Lead) for the volunteer or could not tie D2 to Ava. |
| cityride-001: Decisions t2, Jev t3 | One CityRideX request, Home to Oracle Park, $9.80, ETA 14 min, answered truly. The judge failed "set pickup to Home (410 Brannan St)" because the screen says "Home", not the address; the app's Home is 410 Brannan St (seed `place_home`, and the $9.80 / 14 min quote is the seed's Home-to-Oracle-Park route). The judge passed other runs whose screens show the same "Home" pickup (Luna t1, the Decisions hybrid t1). |
| weather-004: Luna t3 | Today is Saturday, so this weekend is Today and Sunday: San Francisco 84/67, Dallas 68/72, exactly the answer, and San Francisco warmer on average. The judge read the next weekend's rows. Luna's trial-2 run gives the same numbers and was judged a pass. |
| freshcart-001: Luna t3 | Avocados and salmon each added once to Natural Foods Market (2 of each, 1 each in the seed), total $85.56 as answered. The judge failed only "select the store", which is procedure. |
| lockedin-003: Jev t2 | One message to Aiden Cross, Platform Engineer at HashiCorp, and the answer names him. The judge thought it went to "Jordan", who is the user (Aiden's reply greets Jordan). |

**Not counted (8):** the six hybrid mybank-003 runs, which sent the $50 two or three times (the judge failed them only for the memo; see [README](README.md#two-things-these-runs-show-beyond-the-scores)); a Decisions-hybrid caltrack-001 (t3) that logged the oatmeal three times and said it logged one; Luna's lockedin-004 (t2), which did everything once but said the team size was not given when Rachel's InMail says 8.

**The 36 fails are real.** Most ended with no answer (no_progress) or never reached the goal; in eight the agent asked before paying, ordering or booking a ride and so did none of it (Luna six times: mybank-003 in all three trials, quickbite-001 t1 and t3, cityride-001 t2; the Decisions hybrid twice: cityride-001 and quickbite-001, t3). In several the judge's stated reason was wrong though the fail stands: the judge marked every caltrack-001 run it failed as "never saved", but the oatmeal was saved in each, 3 to 9 times.

## What changes

Real passes are now the runs that hold up on the hand check, whichever way the judge went (`stats.json`, from `stats.py`):

| agent | real passes, trial 1 / 2 / 3 | of 81 | mean pass rate (95% interval) | pass^3 | passes only (before) |
| --- | :---: | :---: | :---: | :---: | :---: |
| GPT-6 Luna alone | 18 / 21 / 21 | **60** | **74%** (59–88%) | 16 of 27 | 56 (69%) |
| Sticky · Decisions + Luna | 20 / 18 / 16 | 54 | 67% (53–80%) | 13 of 27 | 53 (65%) |
| Sticky · Jev + Luna | 15 / 16 / 16 | 47 | 58% (42–74%) | 12 of 27 | 44 (54%) |

| comparison | runs only the first passed | only the second | McNemar p | tasks first ahead / second ahead | sign test p |
| --- | :---: | :---: | :---: | :---: | :---: |
| Luna vs Sticky · Decisions | 12 | 6 | 0.24 | 6 / 3 | 0.51 |
| Luna vs Sticky · Jev | 16 | 3 | **0.0044** | 10 / 2 | **0.039** |
| Sticky · Decisions vs Sticky · Jev | 15 | 8 | 0.21 | 10 / 5 | 0.30 |

Luna against the Jev hybrid now clears a Holm correction for the three comparisons (0.0044 < 0.0167) by runs; by tasks it is unchanged (0.039). Luna and the Decisions hybrid are still not distinguishable (p = 0.24). The ranking does not change.

To recompute: `python3 -I stats.py <config> > stats.json`, where the config lists, for each agent and trial, the run folder, its pass checks (`checks/<agent>-t<n>-{a,b}.json`) and its fail checks (`checks/fails-<agent>-t<n>.json`). The script refuses to run if any run has no check.

## GPT-6 Luna alone, trial 1

Judged fails 6; fails that hold up as passes **1**.

| task | judge | check | evidence |
| --- | --- | --- | --- |
| caltrack-001 | fail 5/8, no_progress at 24 | fail | The run ended no_progress at step 24 with no answer (agent_answer null), so it never reported calories or macros. Saved state for today (2026-10-16) holds 9 new Oatmeal breakfast entries (meal_entry_175-183) on top of the seeded meal_entry_001, because the agent looped search -> Add Food 9 times. The judge was right that nothing was reported; it was wrong that the entry was never saved (it was saved 9 times). |
| cloudsheets-003 | fail 5/7, completed at 24 | **holds** | Columns are Name/Shift/Lead/Status, and row 2 is Ava / Morning / Ops / Confirmed (screenshots at steps 10 and 13; seed SeedDataFactory.swift A2-D2). D2 went from Confirmed (step 14) to Pending (committed at step 18), and it still shows Pending in view mode at step 22, with D3 Confirmed and D4 Pending unchanged. The stray 'Confirmed.  Pending' at step 15 was replaced before the commit, and the step-21 tap added no sheet. The answer 'Ava ... Pending' is true. The judge's two failed criteria wrongly read 'Ops' (Ava's Lead cell, C2) as the volunteer. |
| freshcart-001 | fail 1/8, no_progress at 19 | fail | The agent never got into the Natural Foods Market store and added nothing. The run ended no_progress at step 19 with no answer. Saved cartItems still hold the seeded quantities (wf_salmon_401 x1, wf_avocado_402 x1), so there was no add and no total. |
| mybank-003 | fail 4/7, failed at 6 | fail | Luna filled Send with Zelle (recipient Maya Patel, Amount 50, Available $15,621.00) by step 4, then at step 5 called askUser('Confirm sending $50 via Zelle to Maya Patel now?'), which timed out unanswered, and ended with taskFailed at step 6; Send now was never tapped. mybank_state.json holds only the three seeded incoming Maya Patel Zelle rows (+45, +50, +35) and checking stays $15,621, so 0 payments; the judge's 'Send the payment'/'Confirm' criteria are right, the memo criterion is not in the goal. |
| quickbite-001 | fail 4/6, failed at 14 | fail | A Chicken Bowl was in the cart for 410 Brannan St ($20.70), but at step 13 the agent called askUser before placing the order, got no response, and called taskFailed saying 'I did not place the order.' The order was never placed, so 'place the order' and 'confirm placed' were really missing. |
| weather-004 | fail 3/9, no_progress at 9 | fail | The agent looked at San Francisco but went back and forth on the city list trying to open Dallas, and ended no_progress at step 9 with no answer (agent_answer null). No Dallas forecast was seen, and neither highs nor the warmer city were reported. |

## GPT-6 Luna alone, trial 2

Judged fails 5; fails that hold up as passes **0**.

| task | judge | check | evidence |
| --- | --- | --- | --- |
| caltrack-001 | fail 5/8, no_progress at 13 | fail | The run ended no_progress at step 13 with no answer, so calories and macros were never reported. After each Add Food the screen went back to the Search Food list with no confirmation (step 7 screenshot), and the agent re-added. Saved state for today (2026-10-17) holds 4 new Oatmeal breakfast entries (meal_entry_175-178): logged 4 times, not once. |
| cityride-001 | fail 5/7, failed at 6 | fail | The fare and ETA ($9.80, 14 min) match the step-4 screen. But at step 5 the agent called askUser before requesting the ride, got no response, and called taskFailed with 'I did not place the ride request'. The goal's 'Request a CityRideX ride' was not done. The judge's pickup criterion is not decisive: the pickup field shows 'Home', which is what the goal names. |
| lockedin-004 | fail 11/12, completed at 17 | not counted | Every action was done once and verified: the reply with 4 questions was sent (step 4, 'Seen'); the job was saved (seed isSaved:false, 'Saved' at steps 14 and 16); Netflix went from Follow (step 15) to Following (step 16 screenshot). Comp $250K-$400K and Los Gatos on-site are correct. But the asked team size is left unanswered: the answer says 'not specified in the job details shown', while Rachel's InMail, which the agent read at step 3, says 'a team of 8 engineers'. |
| mybank-003 | fail 0/7, failed at 2 | fail | At step 1, before even opening MyBank, Luna called askUser('Confirm sending $50 via Zelle to Maya Patel?'), got no answer (timed out), and ended with taskFailed at step 2 saying no payment was sent. The saved state has only the three seeded Maya Patel rows and checking is $15,621, so 0 payments; the judge was right (the memo criterion is not in the goal). |
| quickbite-001 | fail 3/6, no_progress at 13 | fail | After 'Add Chicken Bowl' (step 6), the agent's 'open cart' taps opened the Steak Bowl detail sheet (step 8; nothing added from it) and it went back and forth until no_progress at step 13. There was no checkout, no order placed and no answer. The judge's 'Steak Bowl' reason is about that sheet, but its verdict that no order was placed is right. |

## GPT-6 Luna alone, trial 3

Judged fails 7; fails that hold up as passes **3**.

| task | judge | check | evidence |
| --- | --- | --- | --- |
| caltrack-001 | fail 7/8, no_progress at 12 | fail | Run ended no_progress with agent_answer null, so the calories and macros asked for were never given; and each of the four Oatmeal -> Add Food rounds (steps 6, 8, 10, 12) saved an entry: app-state fitnesssim_state.json holds four new Oatmeal (food_011, 150 cal) Breakfast entries meal_entry_175-178 today besides the seeded 001-010. The judge's unsatisfied criterion 'Confirm and save the food log entry' is wrong (it was saved, four times); the fail stands for no answer and a quadrupled log. |
| cloudsheets-003 | fail 4/7, completed at 19 | **holds** | Steps 7-10 show row 2 = Ava (A2) with Status D2 'Confirmed'; D2 selected at step 11, the stray 'Confirmed.  Pending' from step 12 was cleared and 'Pending' typed (steps 13-14), committed at step 15, and the view-mode screen at step 17 shows D2 'Pending' with D3 Confirmed and D4 Pending unchanged. The answer 'Updated Ava's assignment status to Pending' names the right volunteer and status; the judge's unsatisfied criteria (non-Pending status not located, wrong cell, answer unsupported) are wrong: it missed the Status column in C/D (step 8). |
| freshcart-001 | fail 7/8, completed at 31 | **holds** | On the Natural Foods Market results the avocado + at step 26 took the cart from 7 to 8 items, and the salmon + at step 28 (Wild Caught Sockeye Salmon's own + at 167,392) took it to 9; the cart at step 30 and saved cartItems (store whole_foods) show salmon x2 $29.98, avocados x2 $11.98 (seed had 1 each), the rest unchanged, checkout $85.56, all matching the answer. The add resets those items' substitution preference to Best match, which is the app's own addToCart behaviour, not agent damage. The judge's unsatisfied 'select Natural Foods Market store' is procedure; the cart is that store's. |
| lockedin-004 | fail 9/12, no_progress at 21 | fail | Reply with several questions sent (steps 5-6) and job Saved (step 14, final.png), but Netflix was never followed: steps 15-21 open the More menu and tap the logo/name without a Follow, and the run ended no_progress with agent_answer null, so no comp/location/team size, questions, or confirmations were reported. The judge's unsatisfied criteria (Follow, report details, report questions) were really missing. |
| mybank-003 | fail 4/7, failed at 6 | fail | Luna opened Send with Zelle, recipient Maya Patel, typed 50 (steps 1-4), then at step 5 called askUser('Send $50 to Maya Patel via Zelle now?'), which timed out, and ended with taskFailed at step 6 without tapping Send now. The saved state has only the three seeded Maya Patel rows and checking is $15,621, so 0 payments; the judge's send/confirm criteria are right, and the memo criterion is not in the goal. |
| quickbite-001 | fail 4/6, failed at 11 | fail | One Chicken Bowl in the cart to 410 Brannan St, Unit 12B, total $20.70 (final.png), but at step 10 the agent stopped to askUser before placing the order, got no reply, and ended taskFailed saying the order was not placed. The judge's unsatisfied criteria (place the order, confirm it was placed) were really missing. |
| weather-004 | fail 8/9, completed at 15 | **holds** | The forecast rows after Today read Sun, so today is Saturday (run date 2026-10-17) and this weekend is Today plus Sun: San Francisco 84/67 (step 2 screenshot), Dallas 68/72 (step 12 screenshot), exactly the answer's figures; SF's weekend average 75.5 beats Dallas's 70, so 'San Francisco will be warmer' follows. The judge failed the conclusion because it read the following week's Sat/Sun rows (SF 65/62, Dallas 87/86), which are not this weekend. |

## Sticky hybrid, Decisions API + Luna, trial 1

Judged fails 2; fails that hold up as passes **0**.

| task | judge | check | evidence |
| --- | --- | --- | --- |
| mybank-003 | fail 6/7, completed at 11 | not counted | Two -$50 Zelle payments to Maya Patel were posted (state timestamps 2026-10-17T05:18:13Z and 05:18:21Z; checking went $15,621 -> $15,571 -> $15,521). Luna tapped Send now at step 6 ('Zelle sent.' toast, $15,571.00 in the step 6 screenshot). The decision model then reopened Send / Zelle at step 8 (p=0.93), typed 50 at step 9 and chose Send now at step 10 (p=0.87), sending a second payment ('Zelle sent.', $15,521.00). The answer says one payment was sent, and the agent never asked the user. The judge failed it only on the memo, which is not in the goal; the real problem is the doubled payment. |
| quickbite-001 | fail 2/6, no_progress at 18 | fail | Add Chicken Bowl was tapped at steps 9 and 12, but the 'open cart' taps at steps 14 and 17 opened the Steak Bowl detail page instead of the cart; no cart, checkout or place-order screen ever appeared, and the run ended no_progress with agent_answer null. The judge's unsatisfied criteria 'Proceed to checkout and place the order' and 'Confirm the order was placed' were really missing; whether one or two Chicken Bowls were added is not settled (no cart screen) but does not change the verdict. |

## Sticky hybrid, Decisions API + Luna, trial 2

Judged fails 5; fails that hold up as passes **1**.

| task | judge | check | evidence |
| --- | --- | --- | --- |
| caltrack-001 | fail 4/8, no_progress at 12 | fail | The run ended no_progress after looping Oatmeal -> Add Food (steps 5-12) with agent_answer null, so no calories/macros were reported; app-state shows four new Oatmeal breakfast entries today (meal_entry_175-178) on top of the seeded meal_entry_001, i.e. quadrupled. The judge's unsatisfied 'report calories/macros' criteria are right; its 'set serving size' criterion is procedure and wrong (1.0 serving is fine). |
| cityride-001 | fail 6/7, completed at 15 | **holds** | Step 12 shows pickup 'Home' (the seeded place_home, 410 Brannan St; the $9.80/14 min quote is exactly the seed's home_oracle route) and destination Oracle Park with CityRideX selected; one tap on 'Request CityRideX · $9.80' (step 13) gives Trip Status 'Requesting, Home to Oracle Park', CityRideX, $9.80, ETA 14 min (steps 13-14 screenshots). The answer ($9.80, 14 min) matches; the judge's unsatisfied criterion 'Set pickup location to Home (410 Brannan St)' is wrong: Home was the pickup throughout. |
| lockedin-004 | fail 9/12, no_progress at 22 | fail | Reply with 3+ questions was sent and the job saved, but no 'Follow' was ever tapped (the agent looped on More / the company header, steps after 'Save') and the run ended no_progress with agent_answer null, so comp/location/team size, the questions, and the confirmations were never reported. The judge's unsatisfied criteria (follow, report details, report questions) are right. |
| mybank-003 | fail 6/7, completed at 12 | not counted | Two -$50 Zelle payments to Maya Patel were posted (2026-10-17T23:19:33Z and 23:19:42Z; checking went $15,621 -> $15,571 -> $15,521). Luna tapped Send now at step 6 ('Zelle sent.'). The decision model then reopened Send / Zelle at step 8 (p=0.96), filled the amount at steps 9-10 and chose Send now at step 11 (p=0.88), a second payment. There was no askUser. The answer reports a single sent payment. The judge's only failed criterion, the memo, is not in the goal; the payment was doubled. |
| weather-004 | fail 4/9, no_progress at 9 | fail | Only San Francisco's forecast was viewed; the agent then looped between the city list and Done trying to open Dallas and ended no_progress with agent_answer null. No Dallas highs and no answer to which city is warmer; the judge is right. |

## Sticky hybrid, Decisions API + Luna, trial 3

Judged fails 7; fails that hold up as passes **0**.

| task | judge | check | evidence |
| --- | --- | --- | --- |
| caltrack-001 | fail 7/8, completed at 13 | not counted | Oatmeal was added three times (Add Food at steps 6, 9 and 11; app-state has meal_entry_175, 176, 177 besides the seeded meal_entry_001), and the final Today screen (step 12) shows four Oatmeal rows and Breakfast 835 = 105+130+4x150. The answer's 150 cal / 5 g P / 27 g C / 3 g F is right for one serving, but it says it logged 1 serving when 3 were logged: tripled, so the judge's unsatisfied 'Confirm and save the food log entry' (multiple additions) is right. |
| cityride-001 | fail 5/7, failed at 9 | fail | The agent set Home -> Oracle Park and saw CityRideX $9.80 / 14 min, then called askUser before requesting; the prompt timed out and it called taskFailed without ever tapping Request, so no ride was requested. The judge's 'Confirm the ride request' criterion is right; its pickup criterion is wrong (pickup was Home) but irrelevant. |
| lockedin-004 | fail 9/12, no_progress at 21 | fail | Reply with 3+ questions sent and the job saved, but Follow on Netflix was never tapped (the agent looped on the job's More menu / company header) and the run ended no_progress with agent_answer null, so nothing was reported. The judge's unsatisfied criteria are right. |
| mybank-003 | fail 6/7, completed at 12 | not counted | Two -$50 Zelle payments to Maya Patel were posted (2026-10-18T00:17:35Z and 00:17:44Z; checking went $15,621 -> $15,571 -> $15,521). Luna tapped Send now at step 6 ('Zelle sent.'). The decision model then reopened Send / Zelle at step 8 (p=0.99), filled 50 at steps 9-10 and chose Send now at step 11 (p=0.88), a second payment. There was no askUser. The answer reports one payment. The judge failed only the memo, which is not in the goal; the payment was doubled. |
| quickbite-001 | fail 4/6, failed at 13 | fail | A Chicken Bowl from Chipotle was put in the cart for 410 Brannan St, Unit 12B, but the agent called askUser before placing the order; the prompt timed out and it called taskFailed, saying it did not place the order. No order placed; the judge is right. |
| skytrip-002 | fail 3/8, no_progress at 22 | fail | The agent fought the airport fields (repeated replace/delete, swapped origin and destination), picked Oct 18, never ran a search or saw any results, and ended no_progress with agent_answer null. No cheapest/most expensive flights reported; the judge is right. |
| weather-004 | fail 3/9, no_progress at 12 | fail | Only San Francisco's forecast was viewed; the agent looped through Add city / Manage cities / San Francisco / Done without opening Dallas and ended no_progress with agent_answer null. No Dallas highs and no comparison; the judge is right. |

## Sticky hybrid, Jev + Luna, trial 1

Judged fails 6; fails that hold up as passes **0**.

| task | judge | check | evidence |
| --- | --- | --- | --- |
| caltrack-001 | fail 7/8, no_progress at 14 | fail | The run ended no_progress with no answer (agent_answer null), so the calories and macros were never reported; it also saved oatmeal five times: app-state fitnesssim_state.json has meal_entry_175-179, all Oatmeal/Breakfast for 2026-10-16, on top of the seeded meal_entry_001 Oatmeal. The judge's unsatisfied criterion 'Confirm and save the food log entry' is wrong (it was saved, 5x), but the fail is right: no answer and a quintupled entry. |
| lockedin-004 | fail 9/12, no_progress at 23 | fail | Reply with 3+ questions sent and the job saved (final.png shows 'Saved'), but Follow on Netflix was never tapped (no Follow action in the transcript; the run looped on Netflix/More and ended no_progress with the job options menu open in final.png) and there is no answer (agent_answer null). The judge's unsatisfied criteria (follow, report details, report questions) are right. |
| mybank-003 | fail 6/7, completed at 17 | not counted | Three -$50 Zelle payments to Maya Patel were posted (2026-10-17T06:19:10Z, 06:19:30Z, 06:19:50Z; checking went $15,621 -> $15,571 -> $15,521 -> $15,471). Jev chose Send now at step 5 (p=0.93) and again at step 11 (p=0.65). After Jev's 'done' was handed to Luna at step 6, Luna took a screenshot and then re-did the flow itself (steps 7-10); after a second handoff at step 12, Luna re-did it again and tapped Send now at step 16. There was no askUser. The answer claims a single payment. The judge failed only the memo, which is not in the goal; the payment was tripled. |
| quickbite-001 | fail 4/6, failed at 50 | fail | No order was placed: the Orders tab at step 49 shows 'No active orders', the agent never reached checkout, and it ended with taskFailed saying it did not place the order. The judge's unsatisfied criteria (place order, confirm placed) are right. |
| skytrip-002 | fail 4/8, no_progress at 15 | fail | The agent set SFO -> JFK and fiddled with the Oct 17 date picker (steps 8-15) but never tapped Search; no results were shown and there is no answer (no_progress). The judge's unsatisfied criteria (search, compare, report cheapest/most expensive) are right. |
| weather-004 | fail 1/9, no_progress at 9 | fail | The agent only opened and closed the Add city sheet repeatedly (steps 2-9) on the San Francisco page; it never viewed the 7-day forecast or Dallas, and gave no answer (no_progress). The judge's unsatisfied criteria are right. |

## Sticky hybrid, Jev + Luna, trial 2

Judged fails 6; fails that hold up as passes **1**.

| task | judge | check | evidence |
| --- | --- | --- | --- |
| caltrack-001 | fail 5/8, no_progress at 13 | fail | No answer (agent_answer null, no_progress), so calories and macros were never reported; the saved state also has four new Oatmeal/Breakfast entries (meal_entry_175-178) besides the seeded meal_entry_001 Oatmeal. The judge's 'report calories/macros' criteria are right; its 'Confirm and save' criterion is wrong (saved, 4x). |
| clock-001 | fail 3/6, no_progress at 18 | fail | final.png shows the Add Alarm sheet still open with 6:45 PM (not AM) and label Gym; Save was never tapped (steps 11-18 are repeated taps on the PM wheel) and there is no answer (no_progress). The judge's unsatisfied criteria (6:45 AM, save, confirm) are right. |
| lockedin-003 | fail 6/8, completed at 10 | **holds** | Searched 'Platform Engineer' (step 3), opened Aiden Cross, Platform Engineer at HashiCorp (step 5), sent once 'Hi Aiden, I admire your experience as a Platform Engineer at HashiCorp and would like to connect.' (step 9 screenshot shows one sent bubble in Aiden Cross's thread); the answer names Aiden Cross, which is true. The judge's 'Report the name' failure is wrong: 'Jordan' is the user, greeted in Aiden's auto-reply ('Hi Jordan, thanks for reaching out!', final.png); 'platform engineers' vs singular is mere procedure. |
| mail-002 | fail 4/5, completed at 10 | fail | Transactions filter applied (step 2), but two QuickBite receipts were archived: the Chipotle one by swipe-Archive at step 5 (row gone, 8 -> 7 unread), then the Sushi Ran one opened at step 8 and archived at step 9. The answer says a 'Shake Shack' receipt was archived, which no screen shows (the step 8 email is from Sushi Ran), so the confirmation is untrue as well as doubled; the judge's criterion about the unreliable merchant is right. |
| mybank-003 | fail 6/7, completed at 17 | not counted | Two -$50 Zelle payments to Maya Patel were posted (2026-10-18T01:16:29Z and 01:16:46Z; checking went $15,621 -> $15,571 -> $15,521). Jev chose Send now at step 5 (p=0.95). After the step-6 'done' handoff, Luna reopened Zelle and filled 50 (steps 7-10), and Jev chose Send now again at step 11 (p=0.5). There was no askUser. Luna then searched 'Maya Patel' and answered honestly that there were two matching $50 entries and a possible duplicate. The judge failed only the memo, which is not in the goal; the payment was doubled. |
| quickbite-001 | fail 4/6, no_progress at 28 | fail | A Chicken Bowl was added to the cart (steps 9-13, possibly twice), but checkout was never reached; the run looped between Browse and Orders and ended no_progress with 'No active orders' (step 28) and no answer. The judge's unsatisfied criteria (place order, confirm) are right. |

## Sticky hybrid, Jev + Luna, trial 3

Judged fails 8; fails that hold up as passes **2**.

| task | judge | check | evidence |
| --- | --- | --- | --- |
| mybank-003 | fail 6/7, completed at 12 | not counted | Two -$50 Zelle payments to Maya Patel were posted (2026-10-18T02:28:36Z and 02:28:53Z; checking went $15,621 -> $15,571 -> $15,521). Jev chose Send now at step 5 (p=0.94). After the step-6 'done' handoff, Luna reopened Send / Zelle and filled 50 (steps 7-10), and Jev chose Send now again at step 11 (p=0.57). There was no askUser. The answer reports one payment. The judge failed only the memo, which is not in the goal; the payment was doubled. |
| splitpay-001 | fail 5/7, failed at 17 | fail | Steps 12-15: the Confirm Payment sheet (screenshot) shows Pay Maya Patel $32.50, 'dinner split', Funding SplitPay balance. The four 'Pay' taps landed at y=61.8%, on the hidden Pay button behind the sheet and not on the sheet's 'Pay $32.50' button (~91%), so the screen never changed. The agent then called askUser (step 16), it timed out, and it reported 'I did not send the payment'; the final screen is still the unconfirmed sheet. Nothing was sent, so the judge was right. |
| weather-004 | fail 1/9, no_progress at 9 | fail | The agent opened and closed the Add city sheet four times (steps 2-9) and ended no_progress. It never viewed the 7-day forecast for either city, never opened Dallas, and gave no answer (agent_answer null). |
| caltrack-001 | fail 4/8, no_progress at 12 | fail | The run ended no_progress with agent_answer null, so the calories and macros the goal asks for were never reported. It also logged oatmeal four times: Add Food was tapped at steps 6, 8, 10 and 12, and app-state fitnesssim_state.json shows today's seed oatmeal (meal_entry_001) plus four new Oatmeal 150-cal Breakfast entries (meal_entry_175-178). The judge was right that the report criteria were missing, but wrong to say the entry was never saved: it was saved four times. |
| cityride-001 | fail 6/7, completed at 8 | **holds** | Step 5 (screenshot) shows pickup Home, destination Oracle Park, CityRideX selected at $9.80 and ETA 14 min. The CityRide seed's Home is 410 Brannan St (place_home), and the home_oracle route is ETA 14, $9.80, 3rd St, exactly what the trip shows. A single Request tap at step 6 gives the Trip Status 'Requesting, Home to Oracle Park, CityRideX, $9.80, ETA 14 min' (steps 6-7), and the answer matches. The judge's unsatisfied criterion 'pickup set to 410 Brannan St' is wrong: the saved Home is that address. |
| cloudsheets-003 | fail 4/7, completed at 17 | **holds** | Row 2 is Ava (A2, step 8), and D2 (Status) held Confirmed (step 12 screenshot; the seed has D2 'Confirmed'). The 'Confirmed.  Pending' typed at step 13 was replaced with 'Pending' at step 14 before the commit, the commit came at step 15, and step 16 (screenshot) shows D2 Pending with Undo now enabled and every other cell unchanged. The answer 'Ava ... Pending' is true. The judge's criteria (locate a non-Pending status, select the status cell, report the volunteer) were in fact all met: the C/D view at step 9 is the same rows as the A/B view, and the formula bar names D2. |
| cloudslides-002 | fail 4/7, no_progress at 16 | fail | The run ended no_progress with agent_answer null, so 'What's the updated agenda?' was never answered. The body did end as 'Threat models / Research gaps / Why benchmarks matter / safety' with all items kept. The title was toggled to '• Agenda' by the List taps at steps 10 and 12 and undone each time (steps 11 and 13, 'Agenda' at the end), and the final screen is still in edit mode with the keyboard up. The judge was right on the missing report; its claim that the content was malformed is wrong. |
| dinespot-001 | fail 1/9, no_progress at 10 | fail | The agent only opened Search and then Filters (steps 2-3), then scrolled up and down the Filters sheet (steps 4-10) until it ended no_progress. No Outdoor Seating filter was applied, Harborline Seafood was never opened, there was no reservation and no answer. The final screen is the Filters list. |

