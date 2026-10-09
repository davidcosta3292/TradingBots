// What each robot is doing right now, in words and colours shared by the
// cards and the 3D office. A robot reports its reasons for not trading as
// plain sentences (status.blocks). This turns them into short labels, and
// tells the reasons that clear by themselves from the ones that need us.

export const OFFLINE_AFTER_MS = 75_000;

export const MOODS = {
  planned: { label: 'Role planned', color: '#C89AFF' },
  analyst: { label: 'Scanning news', color: '#65CFD2' },
  trade: { label: 'In a trade', color: '#3DDC84' },
  active: { label: 'Working', color: '#83A6F4' },
  standby: { label: 'Standing by', color: '#A58BF2' },
  blocked: { label: 'Blocked', color: '#F08A4B' },
  paused: { label: 'Paused', color: '#E3A82B' },
  done: { label: 'Done for today', color: '#9097A3' },
  offline: { label: 'Offline', color: '#F06A5F' },
};

// In priority order: the first rule that matches one of the reasons names the mood.
const RULES = [
  { match: /^Algo Trading is switched off/i, label: 'Algo Trading off', needsYou: true,
    next: 'Switch on Algo Trading in the MetaTrader toolbar.' },
  { match: /^not a demo account/i, label: 'Not a demo account', needsYou: true,
    next: 'This robot only trades demo accounts.' },
  { match: /^max-loss stop/i, label: 'Max-loss stop', needsYou: true,
    next: 'It stays paused until we look at what happened.' },
  { match: /^order budget used/i, label: 'Order budget used', needsYou: true,
    next: 'It sent too many orders today. Check the Experts tab in MetaTrader.' },
  { match: /^news calendar unavailable/i, label: 'News feed unavailable', needsYou: true,
    next: 'Check the MetaTrader calendar and connection. The robot retries each minute and blocks new entries meanwhile.' },
  { match: /^market hours unavailable/i, label: 'Market schedule unavailable', needsYou: true,
    next: 'Check the MetaTrader symbol and connection. New entries wait for a market schedule.' },
  { match: /^daily loss stop/i, label: 'Daily stop hit', back: 'Back at 00:00 Prague',
    next: 'It looks for trades again by itself at 00:00 Prague.' },
  { match: /^market closed/i, label: 'Market closed', back: 'Back when the market reopens' },
  { match: /^market closes for (\d+)h/i, label: (m) => (Number(m[1]) >= 24 ? 'Weekend close' : 'Market closing'),
    back: 'Back after the market reopens' },
  { match: /^outside trading hours \((\d\d:\d\d)/i, label: 'Off hours', back: (m) => `Back at ${m[1]} Prague`,
    next: (m) => `It looks for trades again by itself at ${m[1]} Prague${yourTime(m[1])}.` },
  { match: /^news:/i, label: 'News pause', back: 'Back after the news',
    next: 'It looks for trades again by itself once the news has passed.' },
  { match: /^already \d+ trades today/i, label: 'Enough for today', back: 'Back tomorrow',
    next: 'It made all its trades for today, and looks for more by itself tomorrow.' },
];

const pick = (value, m) => (typeof value === 'function' ? value(m) : value);

// The main reason a robot isn't opening trades, or null when nothing stops it.
export function readBlocks(blocks) {
  const list = Array.isArray(blocks) ? blocks.map(String) : [];
  for (const rule of RULES) {
    for (const text of list) {
      const m = text.match(rule.match);
      if (m) {
        return { label: pick(rule.label, m), needsYou: !!rule.needsYou, text,
          back: pick(rule.back, m) || '', next: pick(rule.next, m) || '' };
      }
    }
  }
  return list.length ? { label: 'Standing by', needsYou: false, text: list[0], back: '', next: '' } : null;
}

// One sentence for the card: what to do, or when it carries on by itself.
export function resumeNote(blocks) {
  const info = readBlocks(blocks);
  if (!info) return '';
  if (info.needsYou) return info.next;
  const list = (Array.isArray(blocks) ? blocks : []).map(String);
  const hours = list.map((b) => b.match(/^outside trading hours \((\d\d:\d\d)/i)).find(Boolean);
  if (list.some((b) => /^market clos/i.test(b))) {
    return `Nothing to do: it looks for trades again by itself once the market reopens${
      hours ? `, from ${hours[1]} Prague${yourTime(hours[1])}` : ''}.`;
  }
  return info.next ? `Nothing to do: ${info.next.charAt(0).toLowerCase()}${info.next.slice(1)}` : '';
}

export function isOnline(robot, now = Date.now()) {
  const threshold = robot.assignment === 'analyst' ? 12 * 60_000 : OFFLINE_AFTER_MS;
  return !!robot.last_report_at && now - Date.parse(robot.last_report_at) < threshold;
}

// { key, label, block, inTrade }: key is one of MOODS.
export function moodOf(robot, now = Date.now()) {
  if (robot.assignment === 'analyst') {
    if (!robot.last_report_at) return { key: 'planned', label: 'Awaiting setup', block: null, inTrade: false };
    if (!isOnline(robot, now)) return { key: 'offline', label: 'Offline', block: null, inTrade: false };
    if (!Number(robot.status?.healthy_feeds)) return { key: 'blocked', label: 'News sources unavailable', block: null, inTrade: false };
    return { key: 'analyst', label: 'Scanning news', block: null, inTrade: false };
  }
  if (robot.assignment && robot.assignment !== 'trader')
    return { key: 'planned', label: 'Role planned', block: null, inTrade: false };
  const s = robot.status || {};
  const inTrade = Array.isArray(s.positions) && s.positions.length > 0;
  const withTrade = (label) => (inTrade ? `${label} · trade open` : label);
  if (!isOnline(robot, now)) return { key: 'offline', label: 'Offline', block: null, inTrade };
  if (robot.state === 'done_today') return { key: 'done', label: withTrade('Done for today'), block: null, inTrade };
  if (robot.state !== 'active') return { key: 'paused', label: withTrade('Paused'), block: null, inTrade };
  if (inTrade) return { key: 'trade', label: 'In a trade', block: null, inTrade };
  const block = s.can_trade === false ? readBlocks(s.blocks) : null;
  if (block) return { key: block.needsYou ? 'blocked' : 'standby', label: block.label, block, inTrade };
  if (s.strategy_check?.strategy?.data_ready === false)
    return {key:'blocked',label:'Waiting for candle data',block:null,inTrade};
  if (s.signal_ready === false) return {key:'active',label:'Looking for a setup',block:null,inTrade};
  if (s.strategy_check?.sizing?.available && s.strategy_check.sizing.feasible === false)
    return {key:'active',label:'Size not feasible',block:null,inTrade};
  return { key: 'active', label: s.signal_ready === true ? 'Checking entry' : 'Working', block: null, inTrade };
}

// " (03:00 your time)" for a Prague clock time, or "" when it's the same here.
export function yourTime(hhmm) {
  const local = localClock(nextPragueTime(hhmm));
  return local === hhmm ? '' : ` (${local} your time)`;
}

// The next moment the Prague clock shows hh:mm.
export function nextPragueTime(hhmm, now = new Date()) {
  const [h, m] = hhmm.split(':').map(Number);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  let minutes = h * 60 + m - (Number(parts.hour) * 60 + Number(parts.minute));
  if (minutes <= 0) minutes += 24 * 60;
  const at = new Date(now.getTime() + minutes * 60_000);
  at.setSeconds(0, 0);
  return at;
}

export function localClock(date) {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
