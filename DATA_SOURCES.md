# CONF Football data

The default `/api/conf` feed uses [Open Matchday](https://github.com/oladeeayo/open-matchday), a public 2026/27 compilation covering 75 competitions. Its original publishers include FixtureDownload, ESPN, OpenLigaDB and Football-Data.co.uk. Attribution and [upstream usage conditions](https://github.com/oladeeayo/open-matchday/blob/master/DISCLAIMER.md) apply. This personal dashboard does not sell data.

A bundled snapshot makes the calendar and calculations available immediately, including when a metered provider has exhausted its quota. The server checks the upstream build at most every six hours and updates in the background. If an update fails, it retains that competition's previous data and timestamp. Data older than 72 hours cannot qualify a selection. This is a periodically updated archive, not a live-score service; source schedules and coverage can be incomplete.

The source's `builder.py` encodes its fixture clock as UTC plus one hour, with the date remaining UTC. `datasetKickoff` decodes that convention before the browser displays Europe/Rome time. Unknown kickoff times are excluded from the future-only list.

Team histories use current-season results from strictly earlier dates. Club spelling aliases are explicit; international fixtures join domestic histories only when the canonical club name resolves to one country. No fuzzy matching is used. Missing xG and corner splits remain unavailable. Model outputs are experimental estimates, not validated winning probabilities or a measure of betting value.

`CONF_PROVIDER=openfoot` retains the previous provider integration for an explicitly configured legacy deployment. It is not used by the default feed.

Run `npm test` for date-window, UCL coverage, historical cutoff, small-sample, stale-data, update-failure, search and rendering checks.

## Proposal prices

Sisal prices come from its [official football odds sheet](https://www.sisal.it/scommesse-matchpoint/foglio-quote). The PDF is refreshed once for all proposals, cached for ten minutes and matched by explicit club aliases, Italian date and kickoff time. Column positions are derived from the printed headings. Only 1X2, Over 2.5 and GG prices that match the exact proposed market are displayed. Ambiguous matches, youth mismatches, missing columns and sheets older than six hours produce no price. The displayed timestamp is the sheet's publication time, not a claim of live availability.

The separate odds request does not block the calendar. Bet365 currently has no reliable server-side source in this deployment and is explicitly marked unavailable. Browser-observed example prices are not reused as an automated feed. No wager is submitted by the application.
