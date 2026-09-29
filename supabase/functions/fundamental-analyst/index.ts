// Scheduled, read-only XAUUSD news watcher. The caller must present the
// Analyst token; it is checked against robot_secrets before any feeds are read.
const SOURCES = [
  { name: 'Investing.com', url: 'https://www.investing.com/rss/news_95.rss', host: 'investing.com' },
  { name: 'Investing.com', url: 'https://www.investing.com/rss/news_11.rss', host: 'investing.com' },
  { name: 'Bloomberg', url: 'https://feeds.bloomberg.com/economics/news.rss', host: 'bloomberg.com' },
  { name: 'WSJ', url: 'https://feeds.content.dowjones.io/public/rss/socialeconomyfeed', host: 'wsj.com' },
  { name: 'Forex Factory', url: 'https://nfs.faireconomy.media/ff_calendar_thisweek.json', host: 'forexfactory.com' },
];
const STRONG = /\b(gold|xau|fed|fomc|powell|inflation|cpi|pce|nonfarm|payrolls?|treasur(?:y|ies)|bond yields?|interest rates?|rate cuts?|central banks?|us dollar|dollar index|usd|tariffs?|geopolitic\w*|war|middle east)\b/i;
const MEDIUM = /\b(united states|u\.s\.|china|gdp|jobs?|employment|unemployment|recession|consumer confidence|oil|commodit\w*)\b/i;
const nowIso = () => new Date().toISOString();
const relevance = (text: string) => STRONG.test(text) ? 2 : MEDIUM.test(text) ? 1 : 0;
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
async function sha256(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((x) => x.toString(16).padStart(2, '0')).join('');
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
  return String(text || '').replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_: string, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#([0-9]+);/g, (_: string, n: string) => String.fromCodePoint(parseInt(n, 10)))
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
    headers: { 'User-Agent': 'TradingOfficeFundamentalAnalyst/1.0', Accept: 'application/rss+xml, application/json, application/xml, text/xml' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!feed.ok) throw new Error(`HTTP ${feed.status}`);
  const body = await feed.text();
  if (body.length > 2_000_000) throw new Error('Feed too large');
  return body;
}
async function rssItems(xml: string, source: typeof SOURCES[number]) {
  if (!/<rss\b/i.test(xml)) throw new Error('Not an RSS feed');
  const out = [];
  for (const [, raw] of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const title = field(raw, 'title').slice(0, 240);
    const url = field(raw, 'link');
    const dateText = field(raw, 'pubDate');
    // Investing.com omits an explicit zone. Its feed clock is treated as UTC.
    const date = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(dateText)
      ? new Date(`${dateText.replace(' ', 'T')}Z`) : new Date(dateText);
    if (!title || !allowedLink(url, source.host) || !Number.isFinite(date.getTime())) continue;
    if (date.getTime() < Date.now() - 48 * 3_600_000 || date.getTime() > Date.now() + 3_600_000) continue;
    out.push({
      item_key: await sha256(`${source.name}|${url}`), source: source.name, kind: 'headline',
      title, url, event_at: date.toISOString(), relevance: relevance(title),
    });
  }
  return out;
}
async function calendarItems(body: string) {
  const rows = JSON.parse(body);
  if (!Array.isArray(rows)) throw new Error('Calendar is not an array');
  const out = [];
  for (const row of rows) {
    const when = new Date(row.date);
    if (!Number.isFinite(when.getTime()) || !row.title) continue;
    if (when.getTime() < Date.now() - 60 * 60_000 || when.getTime() > Date.now() + 7 * 86_400_000) continue;
    if (row.country !== 'USD' || !['High', 'Medium'].includes(row.impact)) continue;
    out.push({
      item_key: await sha256(`Forex Factory|${row.country}|${row.title}|${row.date}`),
      source: 'Forex Factory', kind: 'calendar', title: String(row.title).slice(0, 240),
      url: 'https://www.forexfactory.com/calendar', event_at: when.toISOString(),
      importance: row.impact, currency: row.country, relevance: row.impact === 'High' ? 2 : 1,
    });
  }
  return out;
}
async function scan(url: string, publicKey: string, token: string) {
  const feeds = await Promise.all(SOURCES.map(async (source) => {
    try {
      const body = await getText(source.url);
      const items = source.name === 'Forex Factory' ? await calendarItems(body) : await rssItems(body, source);
      return { source, items, ok: true, error: '' };
    } catch (error) {
      return { source, items: [], ok: false, error: String(error instanceof Error ? error.message : error).slice(0, 120) };
    }
  }));
  const health = feeds.map(({ source, items, ok, error }) => ({
    source: source.name, feed: source.url.split('/').at(-1), ok, count: items.length,
    ...(error ? { error } : {}),
  }));
  const all = [...new Map(feeds.flatMap((feed) => feed.items).map((item) => [item.item_key, item])).values()];
  const upcoming = all.filter((item) => item.kind === 'calendar' && Date.parse(item.event_at) >= Date.now())
    .sort((a, b) => Date.parse(a.event_at) - Date.parse(b.event_at)).slice(0, 8);
  const headlines = all.filter((item) => item.kind === 'headline' && item.relevance > 0)
    .sort((a, b) => Date.parse(b.event_at) - Date.parse(a.event_at)).slice(0, 8);
  const status = {
    version: '1.1-server', focus: 'XAUUSD', checked_at: nowIso(), feeds: health,
    healthy_feeds: feeds.filter((feed) => feed.ok).length, total_feeds: SOURCES.length,
    upcoming, headlines,
    summary: `${upcoming.length} upcoming USD events · ${headlines.length} relevant headlines`,
    limitation: 'Headline and calendar watch only. No trade direction or orders.',
  };
  const report = await fetch(`${url}/rest/v1/rpc/analyst_sync`, {
    method: 'POST',
    headers: { apikey: publicKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_token: token, p_status: status, p_items: all.slice(0, 80) }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!report.ok) throw new Error(`Office report HTTP ${report.status}: ${(await report.text()).slice(0, 180)}`);
  return { checked_at: status.checked_at, healthy_feeds: status.healthy_feeds,
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
