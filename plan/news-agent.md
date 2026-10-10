# Fundamental Analyst · news watcher

## Running now

The **Fundamental Analyst** is a read-only Supabase Edge Function. A database cron job calls it every five minutes, even when David's PC is off. It reads the public Forex Factory weekly calendar export and RSS feeds from Investing.com, Bloomberg and the Wall Street Journal's Dow Jones feed. It records source, headline or USD event title, link and feed time in Supabase. It shows the next USD high/medium-impact events and recent gold-relevant headlines in the shared office. Source health is visible so a broken feed does not look like a quiet market.

The matching is deterministic: headlines with words such as gold, XAU, Fed, CPI, PCE, payrolls and yields appear first. A match is **not** a forecast of price direction, a complete reading of the article, or a trade signal. No paywalled article body is fetched. Open the linked publication for context. Investing.com RSS omits an explicit time zone; the watcher interprets those feed times as UTC.

Supabase stores the items under `news_items` and deduplicates them. At most one short Telegram alert is issued per 30 minutes, for a newly seen highly relevant headline from the last hour or an upcoming high-impact USD event within 90 minutes. The existing Telegram bot sends it to its configured private chat and group. Full source lists are in the office card; messages are informational.

This Analyst has a separate token and a separate `analyst_sync` reporting function. It cannot call the Trader's reporting door, cannot press office trade controls, and never has access to MetaTrader, broker credentials or orders. The Trader EA still uses its own MT5 calendar news guard and its own strategy and FTMO protections. The Analyst currently **does not block or approve trades**.

## Server setup

1. The existing **Fundamental Analyst** office slot has a separate token. It is stored in Supabase Vault as `trading_analyst_token`; only a token hash is in `robot_secrets`.
2. The Edge Function source is `supabase/functions/fundamental-analyst/index.ts`. It has custom token authentication before it fetches feeds, then reports through `analyst_sync`. It does not have a MetaTrader connection or trading permissions.
3. Migration `0011_schedule_fundamental_analyst.sql` installs the five-minute `office-fundamental-analyst` cron job. It calls the function through `pg_net`, reading the token from Vault. The URL and publishable key in that migration belong to the TradingBots project and must be changed for another project.
4. In the office card, **Scanning news** means the job has reported within 12 minutes. A feed failure is listed beside that source. **Offline** means reports stopped; the configured Telegram bot also announces it. Cron run details and `net._http_response` show scheduling and HTTP failures.

The local PC watcher was retired after the server version reported successfully on 29 September 2026. Vercel still only hosts the office page. Supabase now runs the Analyst. The Trader EA still depends on its owner's MetaTrader PC until moved to a VPS or supported server.

## Evidence reports · version 1.2-server

Each five-minute scan freezes the report and its displayed headlines, calendar events and source health in `analyst_reports`. Office members can read the latest 12 through **Report history**. Snapshots cannot be edited through the member API. Retries carrying the same report ID return without replacing the snapshot or creating another alert. The latest report remains in `robots.status`; history is loaded only when requested.

`news_items` keeps publication, scheduled-event, provider-observation and fetch timestamps separately. These feeds do not provide a separate observation timestamp, so it remains null. The HTTP response date is transport metadata only. Dates with no explicit time zone are preserved as publisher text with `timezone_unknown`, without inventing a UTC publication time. Historical rows from version 1.1 remain `legacy_unverified`; their former `event_at` values are not retroactively certified.

Headline age labels use verified publication time: **fresh** within six hours, **aging** from six to 24 hours, **stale** from 24 to 48 hours. Older verified headlines are excluded. An undated headline may stay in a current feed, but remains **unknown** and is ineligible for urgent headline alerts. Successful HTTP fetches and fresh evidence are separate. Calendar coverage uses the scheduled dates, including a warning when the weekly feed has ended; no future events in that feed does not prove there are none.

Reports include cited observations, quality warnings, an explicit **unknown gold direction**, and conditions for reassessment. They expire after 12 minutes without a new scan. Publication/event/fetch times are displayed in New York time; raw publisher dates without a zone are unconverted. Exact normalized titles are grouped; neither different URLs nor different feeds are assumed to corroborate a story independently.

The method uses deterministic topic rules, not an LLM. A title about rates identifies a topic to review; it does not establish the economic outcome or price reaction. The Analyst still has no trade authorization. No change to the EA's strategy, risk or calendar guard is required to use these reports.

### Storage and notifications

- `analyst_reports`: immutable per-report snapshots, member-read RLS, owner robot deletion cascades to history.
- `news_items`: current deduplicated news with provenance and timing; the previous news archive is retained.
- `analyst_sync`: authenticated Analyst-token ingestion; invalid reports are rejected and repeated report IDs are ignored.
- `analyst-evidence-retention`: daily purge of new evidence snapshots recorded more than 30 days ago.
- Telegram: at most two cited observations per alert, 30-minute cooldown. Verified headline publication within one hour or a high-impact USD event within 90 minutes is required; alert selection uses only items from the current scan. Exact title groups already alerted are suppressed. Times are labeled NY. An alert is **queued**, not certified delivered; a durable delivery outbox remains future work.

## Later

Before letting news affect execution, define a narrow rule such as an additional time-limited entry pause for specific USD events. The Trader EA must continue enforcing its own calendar, FTMO and strategy guards. An outside analyst may only add a restriction, never remove one or send a trade order. A separate AI summarizer would require a provider, costs, source permissions and a review of error handling; it is not part of this version.
