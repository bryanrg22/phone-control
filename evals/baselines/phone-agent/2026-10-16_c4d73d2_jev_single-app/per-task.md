# Per task, Jev (jev-1.13.0, the decision mode) on commit c4d73d2

Verdicts are iOSWorld's judge (gpt-5.4-mini); a task passes when every rubric criterion holds. `p(done)` is the probability the decision model put on "done" when it ended the run.

## typesafe:jev-latest (the decision mode)

| task | verdict | steps | ended | p(done) | model s | cost | criteria | failed criteria |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| caltrack-001 | fail | 3 | completed | 0.75 | 0.4 | $0.000 | 2/8 | Tap the log food / add food button; Search for 'oatmeal' in the food database; Set serving size to 1 serving; Confirm and save the food log entry; Report the calorie count for the logged serving; Report macros (protein, carbs, fat) |
| cinephile-001 | fail | 10 | no_progress |  | 1.2 | $0.001 | 2/6 | Tap 'The Godfather' from search results; Add the movie to Wishlist; Report the release year of the movie; Report the rating of the movie |
| cityride-001 | fail | 8 | completed | 0.68 | 1.2 | $0.001 | 4/7 | Confirm the ride request; Report the estimated fare; Report the estimated ETA |
| clock-001 | fail | 15 | no_progress |  | 2 | $0.001 | 3/6 | Set the alarm time to 6:45 AM; Save the alarm; Confirm the alarm is set and active |
| clouddocs-004 | fail | 50 | failed |  | 6.3 | $0.007 | 4/6 | Add a note or text about Q2 planning; Save the document and confirm the edit was saved |
| clouddrive-001 | fail | 9 | completed | 0.60 | 1.3 | $0.001 | 2/6 | Tap on the file options or context menu for that file; Star the file; Report the file name; Report the last modified date |
| cloudsheets-003 | fail | 13 | no_progress |  | 1.8 | $0.002 | 2/7 | Locate a volunteer whose assignment status is not already 'Pending'; Select the cell containing the volunteer's assignment status; Edit the cell value to 'Pending'; Confirm the change was saved in the spreadsheet; Report which volunteer was updated and their new status |
| cloudslides-002 | fail | 10 | completed | 0.73 | 1.5 | $0.001 | 4/7 | Add a bullet point about 'safety' to slide 2's agenda; Confirm the edit was saved; Report the updated agenda content |
| dinespot-001 | fail | 14 | completed | 0.56 | 2.3 | $0.002 | 7/9 | Confirm the reservation; Report the reservation date, time, and party size |
| freshcart-001 | fail | 15 | no_progress |  | 2.4 | $0.003 | 0/8 | Open FreshCart app and select Natural Foods Market store; Search for 'salmon'; Add salmon to cart; Search for 'avocados'; Add avocados to cart; Navigate to cart to verify both items are present; Proceed to checkout or confirm items in cart; Report the cart total |
| lockedin-003 | fail | 50 | failed |  | 6.8 | $0.006 | 5/8 | Compose an introductory message expressing admiration for their experience and desire to connect; Send the message; Report the name of the person messaged |
| lockedin-004 | fail | 28 | no_progress |  | 3.9 | $0.004 | 4/12 | Compose a reply of at least 5 sentences expressing interest; Include at least 3 specific questions about team, tech stack, or role scope; Send the reply to Rachel Torres; Search or filter to find the Platform Engineering Lead posting at Netflix; Save the Netflix Platform Engineering Lead job; Tap 'Follow' on Netflix from the job detail to follow the company; Report role details: compensation range ($250-400K), location (on-site), team size (8); Report the 3+ questions asked in the reply |
| mail-002 | fail | 9 | no_progress |  | 1.6 | $0.003 | 3/5 | Archive the QuickBite receipt email; Confirm the email was archived |
| megamart-001 | fail | 9 | no_progress |  | 1.7 | $0.003 | 3/6 | Tap 'Add to Cart' button; Report the product name; Report the product price |
| mybank-003 | fail | 6 | completed | 0.80 | 0.8 | $0.001 | 6/7 | Add a memo or note for the payment |
| notes-001 | fail | 12 | no_progress |  | 1.6 | $0.001 | 3/5 | Add a new bullet point about a bug fix completed today; Save and confirm the note was updated |
| quickbite-001 | fail | 44 | failed |  | 6.2 | $0.008 | 3/6 | Confirm delivery address is 410 Brannan St; Proceed to checkout and place the order; Confirm the order was placed successfully |
| quickchat-003 | fail | 22 | no_progress |  | 3.5 | $0.007 | 5/9 | Compose a reply confirming registration and asking about the race day meetup plan; Send the reply; Report who the conversation was with; Confirm the reply was sent |
| scorezone-003 | fail | 5 | completed | 0.47 | 0.7 | $0.001 | 3/9 | Tap a top headline article to read the full content; Identify and note the team mentioned in the article; Search for the mentioned team's game schedule for today; Report the headline of the article read; Report the team name; Report whether the team has a game today |
| skytrip-002 | fail | 11 | no_progress |  | 1.4 | $0.002 | 3/8 | Set travel dates for the next few days; Execute the flight search; Review and compare the flight results by price; Report the cheapest flight option with time and price; Report the most expensive flight option with time and price |
| splitpay-001 | fail | 20 | no_progress |  | 2.4 | $0.003 | 5/7 | Send the payment; Confirm the payment was sent successfully |
| stayfinder-001 | pass | 4 | completed | 0.99 | 0.6 | $0.000 | 7/7 |  |
| tasterank-001 | fail | 8 | completed | 1.00 | 1.1 | $0.001 | 5/7 | Report the TasteRank score; Report the cuisine type |
| teamchat-003 | fail | 11 | no_progress |  | 1.7 | $0.002 | 3/7 | Find the most recent unread direct message; Compose a reply of at least 5 words that references the original message content; Send the reply; Report who the message was from and confirm the reply was sent |
| ticketbox-004 | pass | 11 | completed | 0.63 | 1.4 | $0.002 | 6/6 |  |
| trailblaze-004 | fail | 4 | completed | 0.82 | 0.7 | $0.001 | 3/5 | Report the friend's name; Report the activity type |
| weather-004 | fail | 16 | no_progress |  | 2 | $0.002 | 2/9 | Note the weekend high temperatures for San Francisco; Navigate to Dallas weather page; Scroll to view the 7-day forecast for Dallas; Note the weekend high temperatures for Dallas; Report weekend high temperatures for San Francisco; Report weekend high temperatures for Dallas; Report which city will be warmer this weekend |

## Beside the 2026-10-16 baseline (commit 4888b67, same tasks, same judge)

Verdict, criteria satisfied, how the run ended and at which step. Jev and Luna
through the Decisions API give the same verdict on 26 of 27 tasks (Luna passed
trailblaze-004, Jev did not); criteria satisfied, 99 vs 113 vs 170 of 193.

| task | Jev, decision mode (c4d73d2) | Luna, decision mode (4888b67) | Luna, LLM (4888b67) |
| --- | --- | --- | --- |
| caltrack-001 | fail 2/8, completed at 3 | fail 4/8, completed at 6 | fail 5/8, no_progress at 24 |
| cinephile-001 | fail 2/6, no_progress at 10 | fail 3/6, completed at 15 | **pass** 6/6, completed at 10 |
| cityride-001 | fail 4/7, completed at 8 | fail 2/7, completed at 3 | **pass** 7/7, completed at 7 |
| clock-001 | fail 3/6, no_progress at 15 | fail 5/6, completed at 10 | **pass** 6/6, completed at 17 |
| clouddocs-004 | fail 4/6, failed at 50 | fail 4/6, no_progress at 20 | **pass** 6/6, completed at 14 |
| clouddrive-001 | fail 2/6, completed at 9 | fail 4/6, completed at 5 | **pass** 6/6, completed at 12 |
| cloudsheets-003 | fail 2/7, no_progress at 13 | fail 2/7, no_progress at 15 | fail 5/7, completed at 24 |
| cloudslides-002 | fail 4/7, completed at 10 | fail 4/7, no_progress at 44 | **pass** 7/7, completed at 25 |
| dinespot-001 | fail 7/9, completed at 14 | fail 7/9, completed at 6 | **pass** 9/9, completed at 22 |
| freshcart-001 | fail 0/8, no_progress at 15 | fail 6/8, completed at 8 | fail 1/8, no_progress at 19 |
| lockedin-003 | fail 5/8, failed at 50 | fail 5/8, no_progress at 13 | **pass** 8/8, completed at 10 |
| lockedin-004 | fail 4/12, no_progress at 28 | fail 3/12, no_progress at 18 | **pass** 12/12, completed at 23 |
| mail-002 | fail 3/5, no_progress at 9 | fail 3/5, completed at 10 | **pass** 5/5, completed at 8 |
| megamart-001 | fail 3/6, no_progress at 9 | fail 4/6, completed at 10 | **pass** 6/6, completed at 7 |
| mybank-003 | fail 6/7, completed at 6 | fail 6/7, completed at 6 | fail 4/7, failed at 6 |
| notes-001 | fail 3/5, no_progress at 12 | fail 3/5, no_progress at 11 | **pass** 5/5, completed at 8 |
| quickbite-001 | fail 3/6, failed at 44 | fail 3/6, failed at 50 | fail 4/6, failed at 14 |
| quickchat-003 | fail 5/9, no_progress at 22 | fail 5/9, completed at 50 | **pass** 9/9, completed at 11 |
| scorezone-003 | fail 3/9, completed at 5 | fail 3/9, no_progress at 10 | **pass** 9/9, completed at 12 |
| skytrip-002 | fail 3/8, no_progress at 11 | fail 3/8, no_progress at 23 | **pass** 8/8, completed at 37 |
| splitpay-001 | fail 5/7, no_progress at 20 | fail 4/7, completed at 12 | **pass** 7/7, completed at 24 |
| stayfinder-001 | **pass** 7/7, completed at 4 | **pass** 7/7, completed at 4 | **pass** 7/7, completed at 4 |
| tasterank-001 | fail 5/7, completed at 8 | fail 5/7, completed at 8 | **pass** 7/7, completed at 11 |
| teamchat-003 | fail 3/7, no_progress at 11 | fail 4/7, no_progress at 16 | **pass** 7/7, completed at 7 |
| ticketbox-004 | **pass** 6/6, completed at 11 | **pass** 6/6, completed at 16 | **pass** 6/6, completed at 10 |
| trailblaze-004 | fail 3/5, completed at 4 | **pass** 5/5, completed at 6 | **pass** 5/5, completed at 6 |
| weather-004 | fail 2/9, no_progress at 16 | fail 3/9, no_progress at 22 | fail 3/9, no_progress at 9 |
