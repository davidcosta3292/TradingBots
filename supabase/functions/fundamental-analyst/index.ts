// Scheduled, read-only XAUUSD news watcher. The caller must present the
// Analyst token; it is checked against robot_secrets before any feeds are read.
import { VERSION, sha256, parseSourceTime, headlineFreshness, relevanceOf, canonicalUrl, storyKey, buildReport } from './evidence.ts';
import type { Source, Item, FeedHealth } from './evidence.ts';
const SOURCES = [
  { id: 'investing-commodities', name: 'Investing.com', kind: 'headline', url: 'https://www.investing.com/rss/news_95.rss', host: 'investing.com' },
  { id: 'investing-economy', name: 'Investing.com', kind: 'headline', url: 'https://www.investing.com/rss/news_11.rss', host: 'investing.com' },
  { id: 'bloomberg-economics', name: 'Bloomberg', kind: 'headline', url: 'https://feeds.bloomberg.com/economics/news.rss', host: 'bloomberg.com' },
  { id: 'wsj-economy', name: 'WSJ', kind: 'headline', url: 'https://feeds.content.dowjones.io/public/rss/socialeconomyfeed', host: 'wsj.com' },
  { id: 'forexfactory-week', name: 'Forex Factory', kind: 'calendar', url: 'https://nfs.faireconomy.media/ff_calendar_thisweek.json', host: 'forexfactory.com' },
] satisfies Source[];
const nowIso = () => new Date().toISOString();
const response = (data: unknown, status = 200) => Response.json(data, { status });

function environmentKeys() {
  const url = Deno.env.get('SUPABASE_URL') || '';
  const publishable = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}');
  const secrets = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
  const publicKey = publishable.default || Object.values(publishable)[0] || Deno.env.get('SUPABASE_ANON_KEY');
  const adminKey = secrets.default || Object.values(secrets)[0] || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !publicKey || !adminKey) throw new Error('Supabase environment keys unavailable');
  return { url, publicKey: String(publicKey), adminKey: String(adminKey) };
}
function headersFor(key: string) {
  return {
    apikey: key,
    ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}),
  };
}
async function authorized(token: string, url: string, adminKey: string) {
  const hash = await sha256(token);
  const lookup = await fetch(`${url}/rest/v1/robot_secrets?select=robot_id&token_hash=eq.${hash}&limit=1`, {
    headers: headersFor(adminKey), signal: AbortSignal.timeout(10_000),
  });
  if (!lookup.ok) throw new Error(`Analyst authorization lookup HTTP ${lookup.status}`);
  const [secret] = await lookup.json();
  if (!secret?.robot_id) return false;
  const robot = await fetch(`${url}/rest/v1/robots?select=assignment&id=eq.${secret.robot_id}&limit=1`, {
    headers: headersFor(adminKey), signal: AbortSignal.timeout(10_000),
  });
  if (!robot.ok) throw new Error(`Analyst role lookup HTTP ${robot.status}`);
  return (await robot.json())[0]?.assignment === 'analyst';
}
function decodeXml(text: string) {
  const point = (n: number) => Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '\uFFFD';
  return String(text || '').replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_: string, n: string) => point(parseInt(n, 16)))
    .replace(/&#([0-9]+);/g, (_: string, n: string) => point(parseInt(n, 10)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_: string, n: string) =>
      ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[n.toLowerCase() as 'amp']);
}
function field(xml: string, tag: string) {
  return decodeXml(xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] || '')
    .replace(/<[^>]+>/g, '').trim();
}
function allowedLink(url: string, host: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && (parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
  } catch { return false; }
}
async function getText(url: string) {
  const feed = await fetch(url, {
    headers: { 'User-Agent': 'TradingOfficeFundamentalAnalyst/1.2', Accept: 'application/rss+xml, application/json, application/xml, text/xml' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!feed.ok) throw new Error(`HTTP ${feed.status}`);
  const body = await feed.text();
  if (body.length > 2_000_000) throw new Error('Feed too large');
  return { body, fetched_at: nowIso(), response_at: parseSourceTime(feed.headers.get('date'), Date.now()).at };
}
async function rssItems(xml: string, source: Source, fetchedAt: string) {
  if (!/<rss\b/i.test(xml)) throw new Error('Not an RSS feed');
  const out: Item[] = [];
  let parsed_count = 0;
  const now = Date.parse(fetchedAt);
  for (const [, raw] of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    parsed_count++;
    const title = field(raw, 'title').slice(0, 240);
    const url = field(raw, 'link');
    const time = parseSourceTime(field(raw, 'pubDate'), now);
    if (!title || !allowedLink(url, source.host)) continue;
    if (time.at && (Date.parse(time.at) < now - 48 * 3_600_000 || Date.parse(time.at) > now + 3_600_000)) continue;
    if (out.length >= 30) continue;
    const canonical = canonicalUrl(url);
    const published = time.quality === 'explicit_timezone' ? time.at : null;
    out.push({
      item_key: await sha256(`${source.name}|${canonical}`), source: source.name, feed_id: source.id, kind: 'headline',
      title, url: canonical, event_at: published, published_at: published, observed_at: null,
      fetched_at: fetchedAt, timestamp_raw: time.raw, timestamp_quality: time.quality,
      freshness: headlineFreshness(published, time.quality, now), ...relevanceOf(title), story_key: await storyKey(title),
    });
  }
  return { items: out, parsed_count, coverage_start: null, coverage_end: null };
}
async function calendarItems(body: string, source: Source, fetchedAt: string) {
  const rows = JSON.parse(body);
  if (!Array.isArray(rows)) throw new Error('Calendar is not an array');
  const out: Item[] = [];
  const coverage: string[] = [];
  const now = Date.parse(fetchedAt);
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const time = parseSourceTime(row.date, now);
    if (!time.at) continue;
    // Future timestamps are expected for scheduled releases, not publications.
    coverage.push(time.at);
    if (!row.title || Date.parse(time.at) < now - 60 * 60_000 || Date.parse(time.at) > now + 7 * 86_400_000) continue;
    if (row.country !== 'USD' || !['High', 'Medium'].includes(row.impact)) continue;
    if (out.length >= 40) continue;
    out.push({
      item_key: await sha256(`Forex Factory|${row.country}|${row.title}|${row.date}`),
      source: source.name, feed_id: source.id, kind: 'calendar', title: String(row.title).slice(0, 240),
      url: 'https://www.forexfactory.com/calendar', event_at: time.at, published_at: null, observed_at: null,
      fetched_at: fetchedAt, timestamp_raw: time.raw, timestamp_quality: 'explicit_timezone',
      freshness: Date.parse(time.at) >= now ? 'scheduled' : 'elapsed', topics: ['USD release'],
      relevance_reason: `${row.impact}-impact USD release listed by the calendar provider. Its result is not checked.`,
      story_key: await storyKey(`${row.country}|${row.title}|${time.at}`),
      importance: row.impact, currency: row.country, relevance: row.impact === 'High' ? 2 : 1,
    });
  }
  coverage.sort();
  return { items: out, parsed_count: rows.length, coverage_start: coverage[0] || null, coverage_end: coverage.at(-1) || null };
}
async function scan(url: string, publicKey: string, token: string) {
  const feeds = await Promise.all(SOURCES.map(async (source) => {
    const attempted_at = nowIso();
    try {
      const fetched = await getText(source.url);
      const parsed = source.kind === 'calendar' ? await calendarItems(fetched.body, source, fetched.fetched_at)
        : await rssItems(fetched.body, source, fetched.fetched_at);
      return { source, attempted_at, ...fetched, ...parsed, ok: true, error: '' };
    } catch (error) {
      return { source, attempted_at, fetched_at: null, response_at: null, items: [], parsed_count: 0,
        coverage_start: null, coverage_end: null, ok: false,
        error: String(error instanceof Error ? error.message : error).slice(0, 120) };
    }
  }));
  const health: FeedHealth[] = feeds.map(({ source, items, ok, error, attempted_at, fetched_at, response_at, parsed_count, coverage_start, coverage_end }) => {
    const fresh_count = items.filter((item) => item.freshness === 'fresh').length;
    const unknown_time_count = items.filter((item) => item.kind === 'headline' && !item.published_at).length;
    const newest = items.map((item) => item.published_at).filter((at): at is string => Boolean(at)).sort().at(-1) || null;
    const calendarStale = coverage_end && Date.parse(coverage_end) < Date.parse(attempted_at.slice(0, 10) + 'T00:00:00Z');
    const freshness = !ok ? 'unavailable' : source.kind === 'calendar' ? !coverage_end ? 'unknown' : calendarStale ? 'stale' : 'current_week'
      : fresh_count ? unknown_time_count ? 'partial' : 'fresh' : unknown_time_count ? 'unknown' : newest ? 'aging_or_stale' : 'empty';
    return { source: source.name, feed_id: source.id, feed: source.url.split('/').at(-1)!, url: source.url, kind: source.kind,
      ok, attempted_at, fetched_at, response_at, count: items.length, parsed_count, excluded_count: parsed_count - items.length,
      fresh_count, unknown_time_count, newest_published_at: newest, coverage_start, coverage_end, freshness,
      ...(error ? { error } : {}) };
  });
  const unique = [...new Map(feeds.flatMap((feed) => feed.items).map((item) => [item.item_key, item])).values()];
  // Calendar and directly relevant items precede unrelated headlines in the bounded report.
  const all = unique.sort((a, b) => Number(b.kind === 'calendar') - Number(a.kind === 'calendar') || b.relevance - a.relevance).slice(0, 80);
  const { report: evidence, upcoming, headlines } = buildReport(all, health, nowIso());
  const status = {
    version: VERSION, focus: 'XAUUSD', checked_at: evidence.generated_at, feeds: health, report: evidence,
    healthy_feeds: feeds.filter((feed) => feed.ok).length, total_feeds: SOURCES.length,
    provider_count: new Set(SOURCES.map((source) => source.name)).size, upcoming, headlines,
    summary: evidence.summary, limitation: evidence.method,
  };
  const report = await fetch(`${url}/rest/v1/rpc/analyst_sync`, {
    method: 'POST',
    headers: { apikey: publicKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_token: token, p_status: status, p_items: all.slice(0, 80) }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!report.ok) throw new Error(`Office report HTTP ${report.status}: ${(await report.text()).slice(0, 180)}`);
  return { checked_at: status.checked_at, report_id: evidence.report_id, evidence_quality: evidence.evidence_quality, healthy_feeds: status.healthy_feeds,
    total_feeds: SOURCES.length, upcoming: upcoming.length, headlines: headlines.length,
    saved: (await report.json()).items_received };
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return response({ error: 'POST required' }, 405);
  const token = req.headers.get('x-analyst-token') || '';
  if (!/^[0-9a-f]{48}$/.test(token)) return response({ error: 'Unauthorized' }, 401);
  try {
    const { url, publicKey, adminKey } = environmentKeys();
    if (!(await authorized(token, url, adminKey))) return response({ error: 'Unauthorized' }, 401);
    return response(await scan(url, publicKey, token));
  } catch (error) {
    console.error('Fundamental Analyst server scan failed:', error);
    return response({ error: 'News scan failed' }, 500);
  }
});
