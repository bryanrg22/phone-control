# Per task: the writer-only hybrid at 75c3f2c, both choosers

Verdicts are iOSWorld's judge (gpt-5.4-mini). A task passes when every rubric criterion holds. One trial each. The Decisions cell ran in two parts (part 2 = the last 9 tasks, after the machine shut down during task 19); everything else is the same commit, binary and simulator.

"Check" is my reading of each judged pass in `agent.log`, the screens, and the saved state where the app keeps one in Documents (CalTrack, MyBank, TeamChat). A pass the check does not hold up is not counted in the README.

| task | Jev + Luna writer | check | Decisions + Luna writer | check |
| --- | --- | --- | --- | --- |
| caltrack-001 | **pass** 8/8, completed at 3 | **false pass**: no entry logged (saved state holds only the seeded meal_entry_001); the answer said "Logged 1 serving" | **pass** 8/8, completed at 9 | **not counted**: two oatmeal entries logged (meal_entry_175 and 176: Add Food tapped twice); the answer said one serving |
| cinephile-001 | fail 2/6, no_progress at 11 |  | fail 2/6, no_progress at 35 |  |
| cityride-001 | fail 6/7, completed at 7 |  | fail 4/7, completed at 3 |  |
| clock-001 | fail 3/6, no_progress at 14 |  | fail 5/6, no_progress at 39 |  |
| clouddocs-004 | fail 5/6, no_progress at 14 |  | fail 4/6, no_progress at 17 |  |
| clouddrive-001 | **pass** 6/6, completed at 7 | **false pass**: the star tap changed nothing (screens before and after identical; Q3 Planning Brief was already starred); the answer said "I starred" | **pass** 6/6, completed at 6 | holds: Add star chosen from All Hands Storyline's menu |
| cloudsheets-003 | fail 2/7, no_progress at 16 |  | fail 6/7, completed at 12 |  |
| cloudslides-002 | fail 4/7, completed at 13 |  | **pass** 7/7, completed at 9 | **false pass**: "Research gaps" was replaced by "safety" (an item lost, not a bullet added) |
| dinespot-001 | fail 5/9, no_progress at 15 |  | fail 6/9, completed at 7 |  |
| freshcart-001 | fail 0/8, no_progress at 17 |  | fail 0/8, no_progress at 14 |  |
| lockedin-003 | **pass** 8/8, completed at 9 | holds: the message is on screen | **pass** 8/8, completed at 8 | holds: the message is on screen, sent |
| lockedin-004 | fail 5/12, no_progress at 11 |  | fail 11/12, no_progress at 23 |  |
| mail-002 | fail 3/5, no_progress at 9 |  | fail 3/5, completed at 8 |  |
| megamart-001 | fail 3/6, no_progress at 9 |  | **pass** 6/6, completed at 9 | holds: Add to cart, the price on screen |
| mybank-003 | fail 6/7, completed at 6 |  | fail 6/7, completed at 5 |  |
| notes-001 | fail 3/5, completed at 30 |  | fail 3/5, no_progress at 49 |  |
| quickbite-001 | fail 3/6, no_progress at 35 |  | fail 3/6, step_budget at 50 |  |
| quickchat-003 | **pass** 9/9, completed at 8 | holds: the reply is on screen, sent | **pass** 9/9, completed at 10 | holds: the reply is on screen, sent |
| scorezone-003 | **pass** 9/9, completed at 7 | holds: the answer matches the screens | fail 4/9, no_progress at 10 (part 2) |  |
| skytrip-002 | fail 4/8, no_progress at 12 |  | fail 3/8, no_progress at 32 (part 2) |  |
| splitpay-001 | fail 4/7, no_progress at 39 |  | fail 3/7, step_budget at 50 (part 2) |  |
| stayfinder-001 | **pass** 7/7, completed at 4 | holds: the answer matches the screen | **pass** 7/7, completed at 4 (part 2) | holds: the answer matches the screen |
| tasterank-001 | **pass** 7/7, completed at 8 | holds on the screens (Save to list, Want to Try, Done); TasteRank keeps no saved state the harness reads | **pass** 7/7, completed at 8 (part 2) | holds on the screens (as above) |
| teamchat-003 | fail 6/7, completed at 7 |  | **pass** 7/7, completed at 8 (part 2) | holds: the reply is in TeamChat's saved state |
| ticketbox-004 | fail 0/6, failed at 50 |  | fail 0/6, no_progress at 8 (part 2) |  |
| trailblaze-004 | **pass** 5/5, completed at 4 | **not counted**: Ava Torres's run is liked in the seed (31, orange); the tap after the scroll changed nothing | **pass** 5/5, completed at 5 (part 2) | **false pass**: the second Like tap removed the seeded like (31 to 30) |
| weather-004 | fail 1/9, no_progress at 8 |  | fail 3/9, no_progress at 24 (part 2) |  |

Judged passes: Jev + writer 8, Decisions + writer 10. Passes that hold up: 5 and 7.

## Failed criteria

| task | Jev + Luna writer | Decisions + Luna writer |
| --- | --- | --- |
| caltrack-001 |  |  |
| cinephile-001 | Tap 'The Godfather' from search results; Add the movie to Wishlist; Report the release year of the movie; Report the rating of the movie | Tap 'The Godfather' from search results; Add the movie to Wishlist; Report the release year of the movie; Report the rating of the movie |
| cityride-001 | Confirm the ride request | Set pickup location to Home (410 Brannan St); Set destination to Oracle Park; Confirm the ride request |
| clock-001 | Set the alarm time to 6:45 AM; Save the alarm; Confirm the alarm is set and active | Set the alarm time to 6:45 AM |
| clouddocs-004 | Save the document and confirm the edit was saved | Add a note or text about Q2 planning; Save the document and confirm the edit was saved |
| clouddrive-001 |  |  |
| cloudsheets-003 | Locate a volunteer whose assignment status is not already 'Pending'; Select the cell containing the volunteer's assignment status; Edit the cell value to 'Pending'; Confirm the change was saved in the spreadsheet; Report which volunteer was updated and their new status | Confirm the change was saved in the spreadsheet |
| cloudslides-002 | Add a bullet point about 'safety' to slide 2's agenda; Confirm the edit was saved; Report the updated agenda content |  |
| dinespot-001 | Select a date for the reservation; Set the party size; Confirm the reservation; Report the reservation date, time, and party size | Apply the 'Outdoor Seating' tag or filter; Set the party size; Report the reservation date, time, and party size |
| freshcart-001 | Open FreshCart app and select Natural Foods Market store; Search for 'salmon'; Add salmon to cart; Search for 'avocados'; Add avocados to cart; Navigate to cart to verify both items are present; Proceed to checkout or confirm items in cart; Report the cart total | Open FreshCart app and select Natural Foods Market store; Search for 'salmon'; Add salmon to cart; Search for 'avocados'; Add avocados to cart; Navigate to cart to verify both items are present; Proceed to checkout or confirm items in cart; Report the cart total |
| lockedin-003 |  |  |
| lockedin-004 | Send the reply to Rachel Torres; Navigate to the Jobs tab in LockedIn; Search or filter to find the Platform Engineering Lead posting at Netflix; Save the Netflix Platform Engineering Lead job; Tap 'Follow' on Netflix from the job detail to follow the company; Report role details: compensation range ($250-400K), location (on-site), team size (8); Report the 3+ questions asked in the reply | Tap 'Follow' on Netflix from the job detail to follow the company |
| mail-002 | Archive the QuickBite receipt email; Confirm the email was archived | Archive the QuickBite receipt email; Confirm the email was archived |
| megamart-001 | Tap 'Add to Cart' button; Report the product name; Report the product price |  |
| mybank-003 | Add a memo or note for the payment | Add a memo or note for the payment |
| notes-001 | Add a new bullet point about a bug fix completed today; Save and confirm the note was updated | Add a new bullet point about a bug fix completed today; Save and confirm the note was updated |
| quickbite-001 | Confirm delivery address is 410 Brannan St; Proceed to checkout and place the order; Confirm the order was placed successfully | Confirm delivery address is 410 Brannan St; Proceed to checkout and place the order; Confirm the order was placed successfully |
| quickchat-003 |  |  |
| scorezone-003 |  | Tap a top headline article to read the full content; Identify and note the team mentioned in the article; Search for the mentioned team's game schedule for today; Report the headline of the article read; Report the team name |
| skytrip-002 | Execute the flight search; Review and compare the flight results by price; Report the cheapest flight option with time and price; Report the most expensive flight option with time and price | Set travel dates for the next few days; Execute the flight search; Review and compare the flight results by price; Report the cheapest flight option with time and price; Report the most expensive flight option with time and price |
| splitpay-001 | Select SplitPay balance as the payment source; Send the payment; Confirm the payment was sent successfully | Enter $32.50 as the amount; Select SplitPay balance as the payment source; Send the payment; Confirm the payment was sent successfully |
| stayfinder-001 |  |  |
| tasterank-001 |  |  |
| teamchat-003 | Report who the message was from and confirm the reply was sent |  |
| ticketbox-004 | Open TicketBox app and search for 'Ali Wong'; Tap on the Ali Wong comedy show from results; View ticket prices and venue details; Report the show date; Report the venue name; Report the price range | Open TicketBox app and search for 'Ali Wong'; Tap on the Ali Wong comedy show from results; View ticket prices and venue details; Report the show date; Report the venue name; Report the price range |
| trailblaze-004 |  |  |
| weather-004 | Scroll to view the 7-day forecast for San Francisco; Note the weekend high temperatures for San Francisco; Navigate to Dallas weather page; Scroll to view the 7-day forecast for Dallas; Note the weekend high temperatures for Dallas; Report weekend high temperatures for San Francisco; Report weekend high temperatures for Dallas; Report which city will be warmer this weekend | Navigate to Dallas weather page; Scroll to view the 7-day forecast for Dallas; Note the weekend high temperatures for Dallas; Report weekend high temperatures for San Francisco; Report weekend high temperatures for Dallas; Report which city will be warmer this weekend |
