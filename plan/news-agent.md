# News watch now; separate news agent later

## What runs now

OfficeRobot 1.1 checks MetaTrader 5's economic calendar for the chart symbol's currencies once a minute. It reports the next high-impact event up to one hour ahead, blocks new entries from 15 minutes before until 15 minutes after, and announces the warning, pause and clearing through the existing office event channel and Telegram. If the calendar request fails, it blocks new entries and reports the error. Existing positions retain their broker-side stop and target and can still exit.

This is a fixed rule inside each Trader EA. There is no separate AI news robot running today. The **Risk manager**, **Coordinator** and **Analyst** office assignments remain planned labels.

## Separate service when we need one

1. Run a news watcher outside MetaTrader on the owner's PC or a supported server. Ingest structured calendar events with event ID, currency, importance, scheduled time, source and last checked time.
2. Publish observations to a dedicated Supabase table with an expiry time. A planned agent can summarize the events to Telegram and explain which Traders they affect.
3. Add an explicit, time-limited **external news block** to the Trader EA. The EA will still enforce its own market-hours, FTMO and local calendar guards; an external service can only add a restriction, never remove one.
4. Show the source, expiry and reason in the office. Alert if either calendar feed becomes stale. Deduplicate repeated news messages.
5. Keep strategy signals and order placement inside the Trader EA. A language model may explain news, but it cannot send arbitrary trade commands or turn off a guard.

Before building this, confirm the chosen event source and how the two owners want Telegram routed (shared group or separate chats). The current single configured chat receives the Trader EA's news events.
