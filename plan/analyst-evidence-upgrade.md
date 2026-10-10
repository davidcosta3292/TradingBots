# Fundamental Analyst evidence upgrade · 9 October 2026

Implemented the first news-research slice from `research/03-repository-patterns.md` using the reviewed evidence practices. The deployed Analyst reports `1.2-server`.

## What changed

- Five feed URLs across four providers are identified individually. A successful response is separate from publication freshness and calendar coverage.
- Publication, scheduled release, fetch and report generation times are separate. A separate provider observation time is unknown for these feeds. Raw dates without a time zone remain unconverted and cannot trigger urgent headline alerts.
- Every report contains cited observations, source/data limitations, reassessment conditions and a 12-minute expiry. Gold direction remains **unknown** because titles and scheduled events do not establish economic outcomes or market reactions.
- Frozen snapshots are saved in `analyst_reports`, readable by office members. **Report history** fetches the latest 12 on demand and includes the evidence displayed at each scan. Report retries are idempotent by robot/report ID.
- The daily retention job applies only to new evidence snapshots older than 30 days. Existing `news_items` history stays in place.
- Telegram selects at most two observations from the current scan, uses verified publication times or upcoming scheduled releases, and labels times NY. Its existing 30-minute cooldown and title-group suppression limit repeat alerts. Queueing is distinct from confirmed delivery; a durable delivery outbox remains future work.
- The Analyst card works in both Office and Cards views, with compact disclosures and phone layout. Converted timestamps are explicitly New York time. Open disclosures are preserved during redraws.

## Deployment evidence

The Edge Function deployed as version 2 and completed real five-minute scans with `1.2-server`. Read-only verification found saved snapshots, all five feeds responding, source-specific unknown publication times, and the weekly calendar's end-of-coverage warning. The report correctly classified this as partial evidence. RLS grants members SELECT on report history; the save RPC still requires an Analyst token and assignment.

The migration connector returned expired request-state errors for the combined update. Schema and ingestion were applied in smaller migrations. A narrower retention update, scoped only to the new report table, succeeded. The local migration filenames match the returned remote versions:

1. `20261010013753_analyst_evidence_schema.sql`
2. `20261010013807_analyst_evidence_sync.sql`
3. `20261010022728_analyst_snapshot_retention.sql`

JavaScript/TypeScript syntax checks completed. The office preview was inspected at desktop and 390px phone width. Security advisors retained their existing token-RPC/owner-access advisories; the new table introduced no security warning. Its recent-report index initially appeared unused, as expected before member history reads.

## Scope

This is deterministic calendar and RSS-title research. It does not fetch full articles, use an LLM, assert trade probability, approve orders or change the Trader strategy, risk or MT5 calendar guard. The next improvements can address actual Telegram delivery tracking and Trader decision correlation separately.
