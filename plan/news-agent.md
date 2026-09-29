# Fundamental Analyst · news watcher

## Running now

The **Fundamental Analyst** is a separate read-only program on David's PC. Every five minutes it reads the public Forex Factory weekly calendar export and RSS feeds from Investing.com, Bloomberg and the Wall Street Journal's Dow Jones feed. It records source, headline or USD event title, link and feed time in Supabase. It shows the next USD high/medium-impact events and recent gold-relevant headlines in the shared office. Source health is visible so a broken feed does not look like a quiet market.

The matching is deterministic: headlines with words such as gold, XAU, Fed, CPI, PCE, payrolls and yields appear first. A match is **not** a forecast of price direction, a complete reading of the article, or a trade signal. No paywalled article body is fetched. Open the linked publication for context. Investing.com RSS omits an explicit time zone; the watcher interprets those feed times as UTC.

Supabase stores the items under `news_items` and deduplicates them. At most one short Telegram alert is issued per 30 minutes, for a newly seen highly relevant headline from the last hour or an upcoming high-impact USD event within 90 minutes. The existing Telegram bot sends it to its configured private chat and group. Full source lists are in the office card; messages are informational.

This Analyst has a separate token and a separate `analyst_sync` reporting function. It cannot call the Trader's reporting door, cannot press office trade controls, and never has access to MetaTrader, broker credentials or orders. The Trader EA still uses its own MT5 calendar news guard and its own strategy and FTMO protections. The Analyst currently **does not block or approve trades**.

## Run on a PC

1. Create a **Fundamental Analyst** office slot, or use the one already created for David. Its token is shown once when created.
2. Copy `news/config.example.json` to `news/config.json`. Fill in the Supabase URL, publishable key, and this Analyst's token. Keep `news/config.json` private; it is ignored by Git.
3. On Windows, double-click `Start Fundamental Analyst.cmd`. On a Mac with Node.js installed, run `node news/analyst.mjs` from the repository directory. Keep the process running. It does not require MetaTrader or a trading account.
4. Open the office card. **Scanning news** means it has reported within 12 minutes. A feed failure is listed beside that source. **Offline** means the watcher stopped reporting; the configured Telegram bot also announces it.

David's first scan was connected to the existing office on 29 September 2026. The watcher runs on his current Windows PC. If the PC sleeps, shuts down or loses internet, scans stop. The Vercel office website and Supabase database alone do not run the watcher.

## Later

Before letting news affect execution, define a narrow rule such as an additional time-limited entry pause for specific USD events. The Trader EA must continue enforcing its own calendar, FTMO and strategy guards. An outside analyst may only add a restriction, never remove one or send a trade order. A separate AI summarizer would require a provider, costs, source permissions and a review of error handling; it is not part of this version.
