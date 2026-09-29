// Fundamental Analyst: public calendar and RSS metadata only. It never talks
// to MetaTrader, places orders, or presses another robot's controls.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse((await readFile(resolve(here, 'config.json'), 'utf8')).replace(/^\uFEFF/, ''));
if (!/^https:\/\/[^/]+\.supabase\.co$/.test(config.url || '') ||
    !config.anonKey || !/^[0-9a-f]{48}$/.test(config.token || '')) {
  throw new Error('Fill in news/config.json with the Supabase URL, publishable key, and Analyst token.');
}
const interval = Math.max(3, Math.min(30, Number(config.intervalMinutes) || 5));
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
const key = (value) => createHash('sha256').update(value).digest('hex');
const relevance = (text) => STRONG.test(text) ? 2 : MEDIUM.test(text) ? 1 : 0;

function decodeXml(text) {
  return String(text || '').replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#([0-9]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, n) =>
      ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[n.toLowerCase()]);
}
function field(xml, tag) {
  return decodeXml(xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] || '')
    .replace(/<[^>]+>/g, '').trim();
}
function allowedLink(url, host) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === host || u.hostname.endsWith(`.${host}`));
  } catch { return false; }
}
async function getText(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'TradingOfficeFundamentalAnalyst/1.0', Accept: 'application/rss+xml, application/json, application/xml, text/xml' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.text();
  if (body.length > 2_000_000) throw new Error('Feed too large');
  return body;
}
function rssItems(xml, source) {
  if (!/<rss\b/i.test(xml)) throw new Error('Not an RSS feed');
  const out = [];
  for (const [, raw] of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const title = field(raw, 'title').slice(0, 240);
    const url = field(raw, 'link');
    const dateText = field(raw, 'pubDate');
    // Investing.com omits a timezone in pubDate. Its feed clock is treated as
    // UTC; the office calls these "feed times", not authoritative release times.
    const date = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(dateText)
      ? new Date(`${dateText.replace(' ', 'T')}Z`) : new Date(dateText);
    if (!title || !allowedLink(url, source.host) || !Number.isFinite(date.getTime())) continue;
    if (date.getTime() < Date.now() - 48 * 3_600_000 || date.getTime() > Date.now() + 3_600_000) continue;
    out.push({
      item_key: key(`${source.name}|${url}`), source: source.name, kind: 'headline',
      title, url, event_at: date.toISOString(), relevance: relevance(title),
    });
  }
  return out;
}
function calendarItems(body) {
  const rows = JSON.parse(body);
  if (!Array.isArray(rows)) throw new Error('Calendar is not an array');
  const out = [];
  for (const row of rows) {
    const when = new Date(row.date);
    if (!Number.isFinite(when.getTime()) || !row.title) continue;
    if (when.getTime() < Date.now() - 60 * 60_000 || when.getTime() > Date.now() + 7 * 86_400_000) continue;
    if (row.country !== 'USD' || !['High', 'Medium'].includes(row.impact)) continue;
    out.push({
      item_key: key(`Forex Factory|${row.country}|${row.title}|${row.date}`),
      source: 'Forex Factory', kind: 'calendar', title: String(row.title).slice(0, 240),
      url: 'https://www.forexfactory.com/calendar', event_at: when.toISOString(),
      importance: row.impact, currency: row.country, relevance: row.impact === 'High' ? 2 : 1,
    });
  }
  return out;
}
function newest(items) {
  return items.sort((a, b) => Date.parse(b.event_at) - Date.parse(a.event_at));
}
async function runOnce() {
  const results = await Promise.all(SOURCES.map(async (source) => {
    try {
      const body = await getText(source.url);
      const items = source.name === 'Forex Factory' ? calendarItems(body) : rssItems(body, source);
      return { source, items, ok: true };
    } catch (error) {
      return { source, items: [], ok: false, error: String(error.message).slice(0, 120) };
    }
  }));
  const feeds = results.map(({ source, items, ok, error }) => ({
    source: source.name, feed: source.url.split('/').at(-1), ok, count: items.length,
    ...(error ? { error } : {}),
  }));
  const all = [...new Map(results.flatMap((r) => r.items).map((item) => [item.item_key, item])).values()];
  const upcoming = all.filter((x) => x.kind === 'calendar' && Date.parse(x.event_at) >= Date.now())
    .sort((a, b) => Date.parse(a.event_at) - Date.parse(b.event_at)).slice(0, 8);
  const headlines = newest(all.filter((x) => x.kind === 'headline' && x.relevance > 0)).slice(0, 8);
  const status = {
    version: '1.0', focus: 'XAUUSD', checked_at: nowIso(), feeds,
    healthy_feeds: results.filter((r) => r.ok).length, total_feeds: SOURCES.length,
    upcoming, headlines,
    summary: `${upcoming.length} upcoming USD events · ${headlines.length} relevant headlines`,
    limitation: 'Headline and calendar watch only. No trade direction or orders.',
  };
  const response = await fetch(`${config.url}/rest/v1/rpc/analyst_sync`, {
    method: 'POST',
    headers: { apikey: config.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_token: config.token, p_status: status, p_items: all.slice(0, 80) }),
    signal: AbortSignal.timeout(20_000),
  });
  const result = await response.text();
  if (!response.ok) throw new Error(`Office report HTTP ${response.status}: ${result.slice(0, 240)}`);
  console.log(`${nowIso()} reported: ${feeds.filter((f) => f.ok).length}/${SOURCES.length} feeds, ${headlines.length} headlines, ${upcoming.length} upcoming; ${result}`);
}

if (process.argv.includes('--once')) {
  await runOnce();
} else {
  console.log(`Fundamental Analyst started. Checking ${SOURCES.length} feeds every ${interval} minutes.`);
  for (;;) {
    try { await runOnce(); }
    catch (error) { console.error(`${nowIso()} ${error.message}`); }
    await new Promise((resolve) => setTimeout(resolve, interval * 60_000));
  }
}
