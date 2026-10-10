// Deterministic evidence contract. Fetch success is separate from data age.
export const VERSION = '1.2-server';
export const REPORT_TTL_MS = 12 * 60_000;
export const TOPICS = [
  { name: 'Gold', pattern: /\b(gold|xau)\b/i, reason: 'The headline explicitly mentions gold.', strong: true },
  { name: 'Fed / rates', pattern: /\b(fed|fomc|powell|interest rates?|rate cuts?|central banks?)\b/i, reason: 'Monetary policy can affect gold through yields and the dollar.', strong: true },
  { name: 'Inflation / jobs', pattern: /\b(inflation|cpi|pce|nonfarm|payrolls?)\b/i, reason: 'Inflation and employment releases can change rate expectations.', strong: true },
  { name: 'Dollar / yields', pattern: /\b(treasur(?:y|ies)|bond yields?|us dollar|dollar index|usd)\b/i, reason: 'Dollar and yield changes can affect USD-denominated gold.', strong: true },
  { name: 'Geopolitics / trade', pattern: /\b(tariffs?|geopolitic\w*|war|middle east)\b/i, reason: 'Geopolitical and trade news can affect uncertainty and demand.', strong: true },
  { name: 'Broader economy', pattern: /\b(united states|u\.s\.|china|gdp|jobs?|employment|unemployment|recession|consumer confidence|oil|commodit\w*)\b/i, reason: 'Broader economic context; a connection to gold needs further verification.', strong: false },
];

export type Source = { id: string; name: string; url: string; host: string; kind: 'headline' | 'calendar' };
export type Item = {
  item_key: string; source: string; feed_id: string; kind: 'headline' | 'calendar';
  title: string; url: string; event_at: string | null; published_at: string | null;
  observed_at: null; fetched_at: string; timestamp_raw: string; timestamp_quality: string;
  freshness: string; relevance: number; topics: string[]; relevance_reason: string;
  story_key: string; importance?: string; currency?: string;
};
export type FeedHealth = {
  source: string; feed_id: string; feed: string; url: string; kind: string; ok: boolean;
  fetched_at: string | null; attempted_at: string; response_at: string | null;
  count: number; parsed_count: number; excluded_count: number;
  fresh_count: number; unknown_time_count: number; newest_published_at: string | null;
  coverage_start: string | null; coverage_end: string | null; freshness: string; error?: string;
};

export async function sha256(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
export function parseSourceTime(value: unknown, now: number) {
  const raw = typeof value === 'string' ? value.trim().slice(0, 100) : '';
  if (!raw) return { at: null, raw, quality: 'missing' };
  // Never guess a time zone from a provider's name or the server's clock.
  if (!/(?:Z|[+-]\d{2}:?\d{2}|GMT|UTC)\s*$/i.test(raw))
    return { at: null, raw, quality: 'timezone_unknown' };
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return { at: null, raw, quality: 'invalid' };
  if (ms > now + 5 * 60_000) return { at: new Date(ms).toISOString(), raw, quality: 'future' };
  return { at: new Date(ms).toISOString(), raw, quality: 'explicit_timezone' };
}
export function headlineFreshness(at: string | null, quality: string, now: number) {
  if (!at || quality !== 'explicit_timezone') return 'unknown';
  const age = now - Date.parse(at);
  return age <= 6 * 3_600_000 ? 'fresh' : age <= 24 * 3_600_000 ? 'aging' : 'stale';
}
export function relevanceOf(title: string) {
  const hits = TOPICS.filter((topic) => topic.pattern.test(title));
  return { relevance: hits.some((hit) => hit.strong) ? 2 : hits.length ? 1 : 0,
    topics: hits.map((hit) => hit.name),
    relevance_reason: hits.length ? hits.slice(0, 2).map((hit) => hit.reason).join(' ') : 'No configured gold-related topic in this title.' };
}
export function canonicalUrl(value: string) {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|mod$)/i.test(key)) url.searchParams.delete(key);
  }
  url.hash = '';
  return url.href;
}
export async function storyKey(title: string) {
  // Exact normalized title grouping only; do not claim independent corroboration.
  return await sha256(title.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim());
}
export function buildReport(items: Item[], feeds: FeedHealth[], analyzedAt: string) {
  const now = Date.parse(analyzedAt);
  const upcoming = items.filter((item) => item.kind === 'calendar' && item.event_at && Date.parse(item.event_at) >= now)
    .sort((a, b) => Date.parse(a.event_at!) - Date.parse(b.event_at!)).slice(0, 8);
  const relevant = items.filter((item) => item.kind === 'headline' && item.relevance > 0);
  const rank = (item: Item) => ({ fresh: 0, aging: 1, unknown: 2, stale: 3 }[item.freshness] ?? 4);
  const headlines = relevant.sort((a, b) => rank(a) - rank(b)
    || Date.parse(b.published_at || '1970-01-01') - Date.parse(a.published_at || '1970-01-01')).slice(0, 8);
  const fresh = relevant.filter((item) => item.freshness === 'fresh');
  const unknown = relevant.filter((item) => item.freshness === 'unknown');
  const failed = feeds.filter((feed) => !feed.ok);
  const calendar = feeds.find((feed) => feed.kind === 'calendar');
  const warnings: string[] = [];
  if (failed.length) warnings.push(`${failed.length} feed(s) failed; their coverage is missing from this scan.`);
  if (unknown.length) warnings.push(`${unknown.length} relevant headline(s) have an unverified publication time and cannot trigger urgent headline alerts.`);
  if (!fresh.length) warnings.push('No relevant headline with a verified publication time in the last six hours.');
  if (calendar?.ok && !upcoming.length) warnings.push('No upcoming USD release in the current weekly calendar feed. This does not prove there are no future releases.');
  if (calendar?.freshness === 'stale') warnings.push('The calendar feed ends before today; its future coverage needs updating.');
  const quality = feeds.every((feed) => !feed.ok) ? 'unavailable'
    : failed.length || unknown.length || calendar?.freshness === 'stale' ? 'partial'
    : fresh.length || upcoming.length ? 'usable' : 'limited';
  const next = upcoming[0];
  const observations = [];
  if (next) observations.push({
    claim: `Next listed USD release: ${next.title} (${next.importance} impact).`,
    basis: 'A scheduled calendar event; its outcome and market reaction are not known.', evidence_keys: [next.item_key],
  });
  if (headlines.length) observations.push({
    claim: `${relevant.length} title(s) match configured gold-related topics; ${fresh.length} have verified publication times within six hours.`,
    basis: 'Keyword matches in RSS titles. Full articles, actual release values and price reactions are not checked.',
    evidence_keys: headlines.slice(0, 3).map((item) => item.item_key),
  });
  const report = {
    schema_version: 1, report_id: crypto.randomUUID(), generated_at: analyzedAt,
    expires_at: new Date(now + REPORT_TTL_MS).toISOString(), direction: 'unknown',
    title: next ? 'Watch the next USD release' : fresh.length ? 'Review the current gold-related headlines' : 'Fresh evidence is limited',
    summary: `${upcoming.length} upcoming USD events · ${fresh.length} fresh relevant headlines · ${unknown.length} unverified times`,
    interpretation: 'These sources identify topics and scheduled event risk. They do not establish a bullish or bearish gold trade.',
    evidence_quality: quality, observations, warnings,
    reassess_when: [
      'The next five-minute scan adds a relevant headline, revises a scheduled event or changes source availability.',
      ...(next ? [`The release scheduled for ${next.event_at} occurs; check the actual result and price reaction separately.`] : []),
      'A headline passes the six-hour freshness threshold, or this report reaches its 12-minute expiry.',
      'Verified article details, economic results or price evidence contradict the headline-only reading.',
    ],
    counts: { unique_items: items.length, fresh_headlines: fresh.length, unknown_times: unknown.length,
      relevant_headlines: relevant.length, upcoming_events: upcoming.length,
      title_groups: new Set(relevant.map((item) => item.story_key)).size },
    method: 'Deterministic calendar and title rules; no LLM, full-article analysis or trade authorization.',
    freshness_policy: { headline_fresh_hours: 6, headline_aging_hours: 24, headline_retention_hours: 48, report_ttl_minutes: 12 },
  };
  return { report, upcoming, headlines };
}
