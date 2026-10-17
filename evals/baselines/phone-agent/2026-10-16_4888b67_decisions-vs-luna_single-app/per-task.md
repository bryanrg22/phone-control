# Per task, both agents on commit 4888b67

Verdicts are iOSWorld's judge (gpt-5.4-mini); a task passes when every rubric criterion holds. `p(done)` is the probability the decision model put on "done" when it ended the run.

## openai-decisions:gpt-6-luna (the decision mode)

| task | verdict | steps | ended | p(done) | model s | cost | criteria | failed criteria |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| caltrack-001 | fail | 6 | completed | 0.37 | 3.1 | $0.001 | 4/8 | Search for 'oatmeal' in the food database; Set serving size to 1 serving; Report the calorie count for the logged serving; Report macros (protein, carbs, fat) |
| cinephile-001 | fail | 15 | completed | 0.48 | 41 | $0.004 | 3/6 | Add the movie to Wishlist; Report the release year of the movie; Report the rating of the movie |
| cityride-001 | fail | 3 | completed | 0.15 | 0.7 | $0.001 | 2/7 | Set pickup location to Home (410 Brannan St); Set destination to Oracle Park; Confirm the ride request; Report the estimated fare; Report the estimated ETA |
| clock-001 | fail | 10 | completed | 0.51 | 20.1 | $0.002 | 5/6 | Set the alarm time to 6:45 AM |
| clouddocs-004 | fail | 20 | no_progress |  | 12.3 | $0.004 | 4/6 | Add a note or text about Q2 planning; Save the document and confirm the edit was saved |
| clouddrive-001 | fail | 5 | completed | 0.28 | 0.9 | $0.001 | 4/6 | Report the file name; Report the last modified date |
| cloudsheets-003 | fail | 15 | no_progress |  | 15.4 | $0.003 | 2/7 | Locate a volunteer whose assignment status is not already 'Pending'; Select the cell containing the volunteer's assignment status; Edit the cell value to 'Pending'; Confirm the change was saved in the spreadsheet; Report which volunteer was updated and their new status |
| cloudslides-002 | fail | 44 | no_progress |  | 34.2 | $0.012 | 4/7 | Add a bullet point about 'safety' to slide 2's agenda; Confirm the edit was saved; Report the updated agenda content |
| dinespot-001 | fail | 6 | completed | 0.99 | 3.6 | $0.002 | 7/9 | Apply the 'Outdoor Seating' tag or filter; Report the reservation date, time, and party size |
| freshcart-001 | fail | 8 | completed | 0.34 | 25.2 | $0.002 | 6/8 | Proceed to checkout or confirm items in cart; Report the cart total |
| lockedin-003 | fail | 13 | no_progress |  | 15.7 | $0.003 | 5/8 | Compose an introductory message expressing admiration for their experience and desire to connect; Send the message; Report the name of the person messaged |
| lockedin-004 | fail | 18 | no_progress |  | 15.4 | $0.005 | 3/12 | Compose a reply of at least 5 sentences expressing interest; Include at least 3 specific questions about team, tech stack, or role scope; Send the reply to Rachel Torres; Navigate to the Jobs tab in LockedIn; Search or filter to find the Platform Engineering Lead posting at Netflix; Save the Netflix Platform Engineering Lead job; Tap 'Follow' on Netflix from the job detail to follow the company; Report role details: compensation range ($250-400K), location (on-site), team size (8); Report the 3+ questions asked in the reply |
| mail-002 | fail | 10 | completed | 0.51 | 4.2 | $0.005 | 3/5 | Archive the QuickBite receipt email; Confirm the email was archived |
| megamart-001 | fail | 10 | completed | 0.46 | 6 | $0.006 | 4/6 | Report the product name; Report the product price |
| mybank-003 | fail | 6 | completed | 0.97 | 8.5 | $0.001 | 6/7 | Add a memo or note for the payment |
| notes-001 | fail | 11 | no_progress |  | 6.7 | $0.002 | 3/5 | Add a new bullet point about a bug fix completed today; Save and confirm the note was updated |
| quickbite-001 | fail | 50 | failed |  | 49.3 | $0.013 | 3/6 | Confirm delivery address is 410 Brannan St; Proceed to checkout and place the order; Confirm the order was placed successfully |
| quickchat-003 | fail | 50 | completed | 0.78 | 44.8 | $0.030 | 5/9 | Compose a reply confirming registration and asking about the race day meetup plan; Send the reply; Report who the conversation was with; Confirm the reply was sent |
| scorezone-003 | fail | 10 | no_progress |  | 8 | $0.004 | 3/9 | Tap a top headline article to read the full content; Identify and note the team mentioned in the article; Search for the mentioned team's game schedule for today; Report the headline of the article read; Report the team name; Report whether the team has a game today |
| skytrip-002 | fail | 23 | no_progress |  | 64.3 | $0.007 | 3/8 | Set travel dates for the next few days; Execute the flight search; Review and compare the flight results by price; Report the cheapest flight option with time and price; Report the most expensive flight option with time and price |
| splitpay-001 | fail | 12 | completed | 0.71 | 14.4 | $0.002 | 4/7 | Enter $32.50 as the amount; Send the payment; Confirm the payment was sent successfully |
| stayfinder-001 | pass | 4 | completed | 0.95 | 1 | $0.001 | 7/7 |  |
| tasterank-001 | fail | 8 | completed | 0.96 | 1.9 | $0.002 | 5/7 | Report the TasteRank score; Report the cuisine type |
| teamchat-003 | fail | 16 | no_progress |  | 24.5 | $0.005 | 4/7 | Compose a reply of at least 5 words that references the original message content; Send the reply; Report who the message was from and confirm the reply was sent |
| ticketbox-004 | pass | 16 | completed | 0.87 | 23.3 | $0.005 | 6/6 |  |
| trailblaze-004 | pass | 6 | completed | 0.13 | 1.5 | $0.002 | 5/5 |  |
| weather-004 | fail | 22 | no_progress |  | 31.8 | $0.007 | 3/9 | Navigate to Dallas weather page; Scroll to view the 7-day forecast for Dallas; Note the weekend high temperatures for Dallas; Report weekend high temperatures for San Francisco; Report weekend high temperatures for Dallas; Report which city will be warmer this weekend |

## openai:gpt-6-luna (the LLM mode)

| task | verdict | steps | ended | p(done) | model s | cost | criteria | failed criteria |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| caltrack-001 | fail | 24 | no_progress |  | 57.4 | $0.013 | 5/8 | Confirm and save the food log entry; Report the calorie count for the logged serving; Report macros (protein, carbs, fat) |
| cinephile-001 | pass | 10 | completed |  | 25.2 | $0.005 | 6/6 |  |
| cityride-001 | pass | 7 | completed |  | 19.7 | $0.003 | 7/7 |  |
| clock-001 | pass | 17 | completed |  | 52.6 | $0.010 | 6/6 |  |
| clouddocs-004 | pass | 14 | completed |  | 39.3 | $0.006 | 6/6 |  |
| clouddrive-001 | pass | 12 | completed |  | 32.2 | $0.005 | 6/6 |  |
| cloudsheets-003 | fail | 24 | completed |  | 62.3 | $0.013 | 5/7 | Locate a volunteer whose assignment status is not already 'Pending'; Report which volunteer was updated and their new status |
| cloudslides-002 | pass | 25 | completed |  | 89.9 | $0.018 | 7/7 |  |
| dinespot-001 | pass | 22 | completed |  | 66 | $0.013 | 9/9 |  |
| freshcart-001 | fail | 19 | no_progress |  | 70.5 | $0.012 | 1/8 | Open FreshCart app and select Natural Foods Market store; Add salmon to cart; Search for 'avocados'; Add avocados to cart; Navigate to cart to verify both items are present; Proceed to checkout or confirm items in cart; Report the cart total |
| lockedin-003 | pass | 10 | completed |  | 23 | $0.004 | 8/8 |  |
| lockedin-004 | pass | 23 | completed |  | 74.9 | $0.015 | 12/12 |  |
| mail-002 | pass | 8 | completed |  | 31.9 | $0.006 | 5/5 |  |
| megamart-001 | pass | 7 | completed |  | 23.7 | $0.005 | 6/6 |  |
| mybank-003 | fail | 6 | failed |  | 14.5 | $0.002 | 4/7 | Add a memo or note for the payment; Send the payment; Confirm the payment was sent successfully |
| notes-001 | pass | 8 | completed |  | 22.8 | $0.003 | 5/5 |  |
| quickbite-001 | fail | 14 | failed |  | 39.3 | $0.008 | 4/6 | Proceed to checkout and place the order; Confirm the order was placed successfully |
| quickchat-003 | pass | 11 | completed |  | 28.6 | $0.007 | 9/9 |  |
| scorezone-003 | pass | 12 | completed |  | 40.5 | $0.006 | 9/9 |  |
| skytrip-002 | pass | 37 | completed |  | 134.1 | $0.030 | 8/8 |  |
| splitpay-001 | pass | 24 | completed |  | 73.2 | $0.014 | 7/7 |  |
| stayfinder-001 | pass | 4 | completed |  | 7.5 | $0.001 | 7/7 |  |
| tasterank-001 | pass | 11 | completed |  | 23.8 | $0.005 | 7/7 |  |
| teamchat-003 | pass | 7 | completed |  | 17.6 | $0.003 | 7/7 |  |
| ticketbox-004 | pass | 10 | completed |  | 26.4 | $0.004 | 6/6 |  |
| trailblaze-004 | pass | 6 | completed |  | 16.4 | $0.003 | 5/5 |  |
| weather-004 | fail | 9 | no_progress |  | 18 | $0.004 | 3/9 | Navigate to Dallas weather page; Scroll to view the 7-day forecast for Dallas; Note the weekend high temperatures for Dallas; Report weekend high temperatures for San Francisco; Report weekend high temperatures for Dallas; Report which city will be warmer this weekend |
