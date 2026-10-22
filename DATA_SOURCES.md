# CONF Football data

## Complete daily calendar

The default app now uses the public Italian daily calendar served to [Diretta.it](https://www.diretta.it/), including lower divisions, youth and women's competitions. The public website's project configuration and feed fetcher specify the project 400 feed and public `x-fsign` value. This is an undocumented website feed, not a contractual API; changes or upstream outages can affect coverage. Each source day is cached for five minutes and seeded by `diretta-calendar-snapshot.json`, with its actual retrieval timestamp. Adjacent feeds are joined to retain rescheduled slots, then deduplicated by source event ID and filtered by the actual Europe/Rome date, kickoff and not-started status. Live, completed, postponed and cancelled events are excluded from upcoming predictions. Old cached events cannot remain upcoming after their kickoff.

The full calendar is independent of the statistical dataset's league coverage and card limits. All upcoming matches remain visible and searchable; insufficient history cannot silently remove one. Existing analyses are attached only for an exact kickoff, canonical pair of clubs and country match. Club aliases are explicit, including verified Italian display names; ambiguous matches receive no analysis. Youth and women's suffixes are preserved. Missing model scores and odds are left unavailable and cannot qualify a multiple. During a feed outage the response explicitly labels a limited calendar fallback instead of claiming parity. The app refreshes on reopening and every ten minutes while visible. The public feed supports dates close to today, not unlimited historical or future schedules.

Statistical analysis uses [Open Matchday](https://github.com/oladeeayo/open-matchday), a public 2026/27 compilation covering 75 competitions. Its original publishers include FixtureDownload, ESPN, OpenLigaDB and Football-Data.co.uk. Attribution and [upstream usage conditions](https://github.com/oladeeayo/open-matchday/blob/master/DISCLAIMER.md) apply. This personal dashboard does not sell data.

A bundled snapshot makes the calendar and calculations available immediately, including when a metered provider has exhausted its quota. The server checks the upstream build at most every six hours and updates in the background. If an update fails, it retains that competition's previous data and timestamp. Data older than 72 hours cannot qualify a selection. This is a periodically updated archive, not a live-score service; source schedules and coverage can be incomplete.

The source's `builder.py` encodes its fixture clock as UTC plus one hour, with the date remaining UTC. `datasetKickoff` decodes that convention before the browser displays Europe/Rome time. Unknown kickoff times are excluded from the future-only list.

Team histories use current-season results from strictly earlier dates. Club spelling aliases are explicit; international fixtures join domestic histories only when the canonical club name resolves to one country. No fuzzy matching is used. Missing xG and corner splits remain unavailable. Model outputs are experimental estimates, not validated winning probabilities or a measure of betting value.

`CONF_PROVIDER=openfoot` retains the previous provider integration for an explicitly configured legacy deployment. It is not used by the default feed.

Run `npm test` for date-window, UCL coverage, historical cutoff, small-sample, stale-data, update-failure, search and rendering checks.

## Proposal prices

Sisal prices come from its [official football odds sheets](https://www.sisal.it/scommesse-matchpoint/foglio-quote). The base PDF supplies 1X2, Over 2.5, Over 3.5 and GG. The separate combined PDF supplies GG + Over 2.5 directly from its G/NG + U/O2,5 / G / O column; its price is never reconstructed by multiplying single-market prices. Both sheets refresh together, with independent failure fallback and publication timestamps, and are cached for ten minutes. Matching uses explicit club aliases, Italian date and kickoff time. Columns are derived from printed headings and rotated PDF coordinates are normalized. Ambiguous matches, youth mismatches, missing columns and sheets older than six hours produce no price. The displayed timestamp is the sheet's publication time, not a claim of live availability.

The separate odds request does not block the calendar. Bet365 currently has no reliable server-side source in this deployment and is explicitly marked unavailable. Browser-observed example prices are not reused as an automated feed. No wager is submitted by the application.

A bundled, genuinely parsed `sisal-odds-snapshot.json` bootstraps both sheets after deployment. Each keeps its original publication and retrieval timestamp; the same six-hour validity check applies to bootstrap data, with no freshness reset. Runtime sheets supersede the bootstrap individually only when published later. A valid cached sheet is returned immediately while network refresh runs in the background. PDF downloads have a 30-second deadline instead of eight seconds, failed updates retain the prior sheet and can retry after 30 seconds. Refresh starts on server startup and every ten minutes while the server is running. Clients retry transient missing-price responses up to three times and discard retries for an older search. Both odds endpoints include per-sheet refresh status so a download failure is distinguishable from insufficient qualifying matches.

## Daily multiples

`/api/daily-multiples` considers all qualified upcoming proposals in the next 24 hours (or the requested Italian date), independently of text search and the card display limit. It searches for two combinations within ±10% of decimal odds 10 and 100, processing the highest experimental score tiers first. Within the first feasible confidence tier it first minimizes the burden of prices below 1.60, then ranks combinations by the product of their individual model scores, used only as a heuristic and never displayed as a joint win probability. The bounded subset search retains four alternatives per logarithmic odds bin; it is not an exhaustive optimizer.

Only current, exactly matched Sisal prices may enter a multiple. There is one primary market per fixture and no repeated club in the same ticket. The total is the product of the displayed prices. If there are insufficient verified proposals, quota 10 remains unavailable. For quota 100, the app also considers every independently qualified priced market and returns the highest total it finds at or below 100, labelled as an alternative when below the target range; it never adds unqualified events. This fallback uses a branch-and-bound search capped at 200,000 nodes and exposes whether the search completed. It requires at least two legs and preserves one market per fixture and no repeated club. Totals are indicative and may change at the bookmaker. The app refreshes when reopened and every ten minutes while visible; each request excludes events that have already started. Quotes are not guaranteed to be accepted as a combined ticket.

When the top statistical proposal has a price below 1.60, the card and daily tickets prefer another independently qualified market with a verified price of at least 1.60. Both new markets use the same 60% model/history threshold and six-result minimum per team. If no adequate alternative exists, the original proposal remains available with a below-1.60 note; 1.60 is a soft preference, not a hard exclusion. The asynchronous price response replaces the label, individual estimate and price together. The two new markets also remain inspectable in each card's analysis when they are not qualified. GG + Over 2.5 history counts both conditions in the same match; the model sums their joint score outcomes (equivalently GG minus 1–1), rather than multiplying marginal probabilities. A higher price alone is not evidence of positive expected value.

## Additional history for uncovered fixtures

Upcoming events without a complete analysis also request Diretta's public `df_hh` form feed using the calendar event ID. Only the two overall recent-form sections are used; home/away tabs and head-to-head rows are not pooled. Each section must match the exact canonical calendar club, preserving youth and women suffixes. Only completed matches with unannotated, internally consistent full-time scores are accepted. Current-event IDs, duplicates, other clubs, same-day/future results and results before the current conservative period are excluded. The period starts on July 1 for July–December and January 1 for January–June: it deliberately uses a recent subset instead of assuming a provider season ID which this feed does not supply. The actual period is exposed in each enriched card's source and `historyPeriod`.

The latest ten accepted games per team enter the existing market and experimental-goal calculations. The unchanged qualification rule still requires six games for **each** team and both statistical thresholds; empty or smaller histories cannot produce a qualified proposal. This feed adds goal results, not observed xG or corner statistics. Existing complete Open Matchday analyses remain unchanged.

Requests share one queue (three simultaneous downloads), a 12-second timeout, a six-hour cache and a one-minute failure cooldown. Requests wait at most 18 seconds for missing histories; remaining queued downloads continue in the background. New requests use the completed cache. A bundled verified snapshot seeds today's histories, and a runtime cache is written atomically when possible. Records older than 72 hours cannot be used. Feed failures retain the visible event without invented statistics. This is an undocumented website feed and coverage may vary.


## Default-provider retrospective audit

`/api/conf-validation` and `node scripts/validate-coverage.js` replay the default
Open Matchday provider, rather than substituting EFL-only inputs. The replay shares
its canonical team identities, cross-competition histories, last-ten sample lookup,
seven-market goal calculation and goal-primary screening rule with the app. Only
strictly earlier dates enter a forecast; unknown same-day ordering is excluded.
The shared calculation preserves the production rounding and Poisson score grid.

A smoothed historical-rate benchmark is updated after each entire date. It uses
at least 30 earlier eligible observations, preferring that competition's history
when available and otherwise falling back to the pooled earlier eligible sample.
It is a diagnostic comparator, not bookmaker pricing. Development and later-period
summaries, probability bands and per-competition metrics expose calibration and
screening performance separately. No parameters are selected using the later period.
The split is by 70% of unique observation dates, not 70% of match counts.

The bundled 20 October snapshot contains 7,887 unique completed fixtures; 4,058
have six earlier results for both teams and 4,024 can also be compared with the
prior-only benchmark, across 64 competitions. The later period begins 22 August
and contains 2,574 fixtures. Primary GG screening yields 375 selections, mean
forecast 62.77%, observed 61.87%; Over 2.5 yields 143, mean forecast 63.79%,
observed 58.74%. These are retrospective descriptive results, not evidence of
profitability or guarantees for the next selections.

This period overlaps outcomes already examined during development and is not an
independent untouched holdout. Historical source availability and freshness cannot
be reconstructed, so the replay evaluates model statistics, not live operational
coverage. No archived pre-match odds or corner validation are included. Betting
validation and automatic multiples remain suspended. The expandable verification
panel exposes the updated report without changing the match-card layout.


## Chronological calibration candidates

`node scripts/calibrate-goals.js` and `/api/conf-calibration` compare two methods
without changing production estimates. All eligible default-provider observations
are partitioned by unique dates: first 50% for fitting, next 20% for model choice,
remaining dates for final comparison. In the bundled snapshot these are 935,
506 and 2,617 fixtures; tuning starts 4 July and the final period starts 18 August.
This differs from the benchmark audit's split because no 30-observation benchmark
warm-up is needed here. None of the final outcomes enter fitting or model choice.

Binary logistic recalibration tries four penalties and explicitly permits keeping
the original model. The tuning period selects that unchanged option for both GG
and Over 2.5. A second candidate fits home/away goal-rate factors on training goals,
then tunes their strength on mean GG/Over 2.5 Brier loss. The chosen strength is
0.5, using fitted factors 1.142882 (home) and 0.903698 (away). It adjusts a joint
Poisson score distribution, although this diagnostic currently evaluates only the
two goal markets, using the production model's rounded goal-rate output and
rounding candidate percentages to whole points like the app.

On 2,617 later fixtures GG Brier changes from 0.244330 to 0.244140 and Over 2.5
from 0.245776 to 0.245174. Paired date-block bootstrap (2,000 deterministic
resamples over 63 dates) gives 95% intervals for Brier improvement of
[-0.000033, 0.000435] for GG and [0.000194, 0.001086] for Over 2.5.
These are small retrospective changes; repeated clubs across dates and other
remaining dependencies limit the interval interpretation. The GG interval includes
zero. Previously inspected data cannot become a new independent prospective test.
The candidate is not deployed, and no profitability or betting-validation claim is
made. The app exposes these comparisons inside an expandable verification panel.
