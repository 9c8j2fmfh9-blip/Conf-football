# CONF Football data

The default `/api/conf` feed uses [Open Matchday](https://github.com/oladeeayo/open-matchday), a public 2026/27 compilation covering 75 competitions. Its original publishers include FixtureDownload, ESPN, OpenLigaDB and Football-Data.co.uk. Attribution and [upstream usage conditions](https://github.com/oladeeayo/open-matchday/blob/master/DISCLAIMER.md) apply. This personal dashboard does not sell data.

A bundled snapshot makes the calendar and calculations available immediately, including when a metered provider has exhausted its quota. The server checks the upstream build at most every six hours and updates in the background. If an update fails, it retains that competition's previous data and timestamp. Data older than 72 hours cannot qualify a selection. This is a periodically updated archive, not a live-score service; source schedules and coverage can be incomplete.

The source's `builder.py` encodes its fixture clock as UTC plus one hour, with the date remaining UTC. `datasetKickoff` decodes that convention before the browser displays Europe/Rome time. Unknown kickoff times are excluded from the future-only list.

Team histories use current-season results from strictly earlier dates. Club spelling aliases are explicit; international fixtures join domestic histories only when the canonical club name resolves to one country. No fuzzy matching is used. Missing xG and corner splits remain unavailable. Model outputs are experimental estimates, not validated winning probabilities or a measure of betting value.

`CONF_PROVIDER=openfoot` retains the previous provider integration for an explicitly configured legacy deployment. It is not used by the default feed.

Run `npm test` for date-window, UCL coverage, historical cutoff, small-sample, stale-data, update-failure, search and rendering checks.
