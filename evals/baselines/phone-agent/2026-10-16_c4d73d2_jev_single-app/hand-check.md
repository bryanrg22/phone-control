# Hand check: Jev alone's judged passes

Checked 2026-10-17, with the bar in [`../2026-10-17_7625741_luna-and-sticky-hybrids_trials-2-3_single-app/README.md`](../2026-10-17_7625741_luna-and-sticky-hybrids_trials-2-3_single-app/README.md#how-each-pass-was-checked).

| task | judge | check | evidence |
| --- | --- | --- | --- |
| stayfinder-001 | pass | **false pass** | The answer is "The decision model judged the task complete on the current screen." The task asks for the listing's name, price per night, beds and baths; none was given, and the judge read them off the final screen. |
| ticketbox-004 | pass | **false pass** | The same answer, with no date, venue or price range. The event page's four section tiles ($116–$168) are not the price range either: Event Info shows 28 listings from $101, and the seeded listings run to $333 with fees. |

Judged passes 2; passes that hold up **0**. A decision model alone writes no answer, so a task that asks a question cannot hold up.
