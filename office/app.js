// Trading Office control page.
// Two views of the same live data: the 3D office, and plain cards. Each
// robot's owner can press Start, Pause, Done for today and Close everything;
// the robot confirms each press. Add ?demo to the address to preview with
// sample robots, no Supabase needed.

const DEMO = new URLSearchParams(location.search).has('demo');
const OFFLINE_AFTER_MS = 75_000;
const VIEW_KEY = 'trading-office-view';

const BUTTONS = [
  { type: 'start', label: 'Start', hint: 'May take new trades', icon: '▶' },
  { type: 'pause', label: 'Pause', hint: 'Open trades finish, no new ones', icon: '❚❚' },
  { type: 'done_today', label: 'Done for today', hint: 'Back at 00:00 Prague', icon: '■' },
  { type: 'close_all', label: 'Close everything', hint: 'Close now, then pause', icon: '✕' },
];
const LABEL = Object.fromEntries(BUTTONS.map((b) => [b.type, b.label]));
const CURRENT = { start: 'active', pause: 'paused', done_today: 'done_today' };

const store = {
  me: null,
  members: new Map(),     // user id -> display name
  robots: new Map(),      // robot id -> row
  lastCommand: new Map(), // robot id -> newest command
  events: new Map(),      // robot id -> newest events first
};
let sb = null;
let view = 'cards';
let selectedId = null;
let office = null;        // the 3D scene, loaded on first use
let officeLoading = null;

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------

async function main() {
  document.addEventListener('click', onClick);

  if (DEMO) {
    loadDemo();
    $('who').textContent = 'Demo mode · sample robots';
    return startWorkspace();
  }

  const cfg = window.OFFICE_CONFIG;
  if (!cfg?.url || !cfg?.anonKey || cfg.url.includes('YOUR-PROJECT')) {
    return showMessage(`<h1>Almost there</h1>
      <p>Copy <code>office/config.example.js</code> to <code>office/config.js</code> and fill in your
      Supabase project URL and publishable key.</p>
      <p>Want a look first? Open <a href="?demo">the demo</a>.</p>`);
  }

  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  sb = createClient(cfg.url, cfg.anonKey);
  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') location.reload();
  });

  const { data: { session } } = await sb.auth.getSession();
  if (!session) return showLogin();
  store.me = session.user;

  try {
    await loadAll();
  } catch (error) {
    return showMessage(`<h1>Could not load the office</h1><p>${esc(error.message)}</p>`);
  }
  if (!store.members.has(store.me.id)) {
    return showMessage(`<h1>Not in the office yet</h1>
      <p>Signed in as ${esc(store.me.email)}, but this login isn't an office member yet.</p>
      <p><button class="link" data-signout>Sign out</button></p>`);
  }

  $('who').innerHTML = `${esc(store.members.get(store.me.id))} · <button class="link" data-signout>Sign out</button>`;
  subscribe();
  startWorkspace();
}

function startWorkspace() {
  $('workspace').hidden = false;
  $('views').hidden = false;
  let saved = null;
  try { saved = localStorage.getItem(VIEW_KEY); } catch { /* private window */ }
  setView(saved || (window.innerWidth >= 760 ? 'office' : 'cards'));
  setInterval(render, 5000); // keeps "last seen", offline badges and clocks current
}

function showLogin() {
  $('login').hidden = false;
  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const { error } = await sb.auth.signInWithPassword({ email: form.get('email'), password: form.get('password') });
    if (error) return toast(error.message);
    location.reload();
  });
}

function showMessage(html) {
  $('message').innerHTML = html;
  $('message').hidden = false;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function setView(next) {
  view = next === 'office' ? 'office' : 'cards';
  document.body.dataset.view = view;
  try { localStorage.setItem(VIEW_KEY, view); } catch { /* private window */ }
  document.querySelectorAll('#views button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  if (view === 'office') {
    loadOffice().then((scene) => {
      if (!scene) return;
      scene.setActive(view === 'office');
      render();
    });
  } else {
    office?.setActive(false);
  }
  render();
}

function loadOffice() {
  officeLoading ??= import('./scene.js?v=4')
    .then(({ createOfficeScene }) => {
      office = createOfficeScene($('scene'), {
        onSelect: (id) => {
          selectedId = id;
          render();
        },
      });
      return office;
    })
    .catch((error) => {
      $('scene').innerHTML = `<p class="scene-error">The 3D office could not load (${esc(error.message)}). The Cards view still works.</p>`;
      return null;
    });
  return officeLoading;
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

async function loadAll() {
  const [members, robots, commands, events] = await Promise.all([
    sb.from('office_members').select('user_id, display_name'),
    sb.from('robots').select('*'),
    sb.from('commands').select('*').order('id', { ascending: false }).limit(100),
    sb.from('robot_events').select('*').order('id', { ascending: false }).limit(200),
  ]);
  for (const result of [members, robots, commands, events]) {
    if (result.error) throw result.error;
  }
  members.data.forEach((m) => store.members.set(m.user_id, m.display_name));
  robots.data.forEach((r) => store.robots.set(r.id, r));
  commands.data.forEach((c) => {
    if (!store.lastCommand.has(c.robot_id)) store.lastCommand.set(c.robot_id, c);
  });
  events.data.forEach((e) => {
    const list = store.events.get(e.robot_id) || [];
    if (list.length < 8) list.push(e);
    store.events.set(e.robot_id, list);
  });
}

function subscribe() {
  sb.channel('office')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'robots' }, ({ new: row }) => {
      if (row?.id) store.robots.set(row.id, row);
      render();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'commands' }, ({ new: row }) => {
      if (!row?.id) return;
      const current = store.lastCommand.get(row.robot_id);
      if (!current || row.id >= current.id) store.lastCommand.set(row.robot_id, row);
      render();
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'robot_events' }, ({ new: row }) => {
      const list = store.events.get(row.robot_id) || [];
      store.events.set(row.robot_id, [row, ...list].slice(0, 8));
      render();
    })
    .subscribe();
}

// ---------------------------------------------------------------------------
// Clicks: view switch, panel, sign out, and the four buttons
// ---------------------------------------------------------------------------

async function onClick(event) {
  const viewButton = event.target.closest('#views button[data-view]');
  if (viewButton) return setView(viewButton.dataset.view);

  if (event.target.closest('[data-signout]')) return sb?.auth.signOut();

  if (event.target.closest('[data-close-panel]')) {
    selectedId = null;
    return render();
  }

  const button = event.target.closest('button[data-cmd]');
  if (!button || button.disabled) return;
  const robot = store.robots.get(button.dataset.robot);
  const type = button.dataset.cmd;
  if (!robot) return;

  if (type === 'close_all') {
    if (!confirm(`Close everything on ${robot.name}?\n\nIts open trades close at market now, then it pauses.`)) return;
    if ((prompt('Type CLOSE to confirm') || '').trim().toUpperCase() !== 'CLOSE') return;
  }

  if (DEMO) return demoCommand(robot, type);

  const { data, error } = await sb.from('commands').insert({ robot_id: robot.id, type }).select().single();
  if (error) return toast(`Could not send ${LABEL[type]}: ${error.message}`);
  store.lastCommand.set(robot.id, data);
  render();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function sortedRobots() {
  return [...store.robots.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function render() {
  const robots = sortedRobots();
  $('summary').innerHTML = summary(robots);

  if (view === 'cards') {
    $('robots').innerHTML = robots.length
      ? robots.map(card).join('')
      : '<p class="empty">No robots yet. Create one with <code>create_robot()</code> in the Supabase SQL editor.</p>';
    return;
  }

  office?.update({ robots, selected: selectedId });
  const robot = selectedId && store.robots.get(selectedId);
  $('panel').hidden = !robot;
  if (robot) {
    $('panel').innerHTML = `<button class="panel-close" data-close-panel aria-label="Close">✕</button>${card(robot)}`;
  }
}

function summary(robots) {
  const online = robots.filter(isOnline);
  const trading = online.filter((r) => (r.status?.positions || []).length > 0);
  const prague = new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit' });
  return `<span><b>${robots.length}</b> robots</span>
    <span><b>${online.length}</b> online</span>
    <span><b>${trading.length}</b> in a trade</span>
    <span class="clock">Prague ${prague}</span>`;
}

function card(r) {
  const s = r.status || {};
  const currency = s.currency || 'USD';
  const online = isOnline(r);
  const mine = store.me && r.owner_id === store.me.id;
  const owner = store.members.get(r.owner_id) || 'Unknown';
  const positions = Array.isArray(s.positions) ? s.positions : [];
  const blocks = Array.isArray(s.blocks) ? s.blocks : [];
  const mood = moodOf(r, online, positions.length > 0);
  const command = store.lastCommand.get(r.id);
  const events = store.events.get(r.id) || [];

  return `<article class="robot ${mood.cls}">
    <header class="robot-head">
      <div>
        <h2>${esc(r.name)}</h2>
        <p class="sub">${esc(owner)}${mine ? ' · yours' : ' · view only'} · ${esc(r.symbol || '—')} ${esc(s.timeframe || '')}
          · account ${esc(r.account_login ?? '—')}</p>
      </div>
      <span class="pill ${mood.cls}">${mood.label}</span>
    </header>

    <p class="seen">${seenText(r, online)}</p>

    ${positions.length
      ? positions.map((p) => positionRow(p, r, currency)).join('')
      : `<p class="flat">${r.state === 'active' && online ? 'No open trade · waiting for a setup' : 'No open trade'}</p>`}

    <div class="numbers">
      <div><span>Equity</span><b>${money(s.equity, currency)}</b></div>
      <div><span>Today</span><b class="${tone(s.day_pnl)}">${signedMoney(s.day_pnl, currency)}</b></div>
      <div><span>Trades today</span><b>${s.trades_today ?? '—'}</b></div>
    </div>

    ${meter('FTMO daily loss used', s.daily_used_pct,
      `FTMO limit ${money(s.ftmo_daily_floor, currency)} · robot stops at ${money(s.robot_daily_stop, currency)}`)}
    ${meter('FTMO max loss used', s.max_used_pct,
      `FTMO limit ${money(s.ftmo_max_floor, currency)} · robot stops at ${money(s.robot_max_stop, currency)}`)}

    ${blocks.length ? `<div class="blocks">
      <span>${r.state === 'active' ? 'Not opening trades because' : 'Also holding it back'}</span>
      <ul>${blocks.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div>` : ''}
    ${s.link_error ? `<p class="warn">${esc(s.link_error)}</p>` : ''}

    ${mine ? buttons(r, online, command)
      : `<p class="viewonly">Only ${esc(owner)} can control this robot. FTMO allows nobody else to use their account.</p>`}
    ${command ? commandLine(command) : ''}

    ${events.length ? `<ol class="feed">${events.slice(0, 5).map((e) =>
      `<li><time>${clock(e.at)}</time>${esc(e.message)}</li>`).join('')}</ol>` : ''}
  </article>`;
}

function moodOf(r, online, inTrade) {
  if (!online) return { cls: 'offline', label: 'Offline' };
  if (r.state === 'active') return inTrade ? { cls: 'trade', label: 'In a trade' } : { cls: 'active', label: 'Working' };
  if (r.state === 'done_today') return { cls: 'done', label: 'Done for today' };
  return { cls: 'paused', label: 'Paused' };
}

function positionRow(p, r, currency) {
  return `<p class="position">
    <b class="side ${esc(p.side)}">${esc(String(p.side).toUpperCase())}</b>
    ${esc(p.volume)} ${esc(r.symbol)} @ ${esc(p.open)} · stop ${esc(p.sl)} · target ${esc(p.tp)}
    <span class="${tone(p.profit)}">${signedMoney(p.profit, currency)}</span></p>`;
}

function meter(label, pct, detail) {
  const value = Math.max(0, Math.min(100, Number(pct) || 0));
  const level = value >= 80 ? 'bad' : value >= 50 ? 'warn' : 'ok';
  return `<div class="meter">
    <div class="meter-top"><span>${label}</span><b>${value.toFixed(0)}%</b></div>
    <div class="track"><i class="${level}" style="width:${value}%"></i></div>
    <small>${esc(detail)}</small></div>`;
}

function buttons(r, online, command) {
  const waiting = command?.status === 'pending';
  const html = BUTTONS.map((b) => `
    <button class="btn ${b.type}${CURRENT[b.type] === r.state ? ' current' : ''}" data-robot="${r.id}" data-cmd="${b.type}"
      ${!online || waiting ? 'disabled' : ''}>
      <span class="ico">${b.icon}</span>
      <span><b>${b.label}</b><small>${b.hint}</small></span>
    </button>`).join('');
  const note = !online ? '<p class="hint">The buttons wake up when the robot is online.</p>'
    : waiting ? '<p class="hint">Waiting for the robot to confirm the last press…</p>' : '';
  return `<div class="buttons">${html}</div>${note}`;
}

function commandLine(c) {
  const who = store.members.get(c.created_by) || 'someone';
  const outcome = {
    pending: 'waiting for the robot…',
    done: `confirmed · ${c.result || 'done'}`,
    refused: `refused · ${c.result || ''}`,
    expired: 'not picked up in time. Was the robot offline?',
  }[c.status] || c.status;
  return `<p class="command ${esc(c.status)}"><b>${esc(LABEL[c.type] || c.type)}</b> by ${esc(who)}
    at ${clock(c.created_at)} · ${esc(outcome)}</p>`;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function isOnline(r) {
  return !!r.last_report_at && Date.now() - new Date(r.last_report_at).getTime() < OFFLINE_AFTER_MS;
}

function seenText(r, online) {
  if (!r.last_report_at) return 'Never connected yet. Start the robot in MetaTrader.';
  return online ? `Online · reported ${ago(r.last_report_at)}` : `Offline · last report ${ago(r.last_report_at)}`;
}

function money(value, currency) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value));
}

function signedMoney(value, currency) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  return (n > 0 ? '+' : n < 0 ? '−' : '') + money(Math.abs(n), currency);
}

function tone(value) {
  const n = Number(value);
  return n > 0 ? 'up' : n < 0 ? 'down' : '';
}

function ago(iso) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return new Date(iso).toLocaleString();
}

function clock(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

let toastTimer;
function toast(text) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').hidden = true), 4000);
}

// ---------------------------------------------------------------------------
// Demo mode: sample robots so the page can be tried without Supabase
// ---------------------------------------------------------------------------

function loadDemo() {
  const now = Date.now();
  const iso = (msAgo) => new Date(now - msAgo).toISOString();
  store.me = { id: 'me' };
  store.members.set('me', 'David').set('friend', 'Friend');
  const base = {
    currency: 'USD', timeframe: 'M15', strategy: 'EMA 20/50 cross, ATR(14) stop', initial: 25000,
    ftmo_daily_floor: 23750, robot_daily_stop: 24000, ftmo_max_floor: 22500, robot_max_stop: 23000,
  };
  store.robots.set('r1', {
    id: 'r1', name: 'Robot 01', owner_id: 'me', state: 'active', symbol: 'XAUUSD', account_login: 1514746116,
    last_report_at: iso(4000),
    status: { ...base, equity: 25086.4, day_pnl: 61.2, trades_today: 1, daily_used_pct: 0, max_used_pct: 0,
      positions: [{ side: 'buy', volume: 0.05, open: 3751.2, sl: 3740.1, tp: 3773.4, profit: 25.2 }], blocks: [],
      last_action: '15:15 Opened BUY 0.05 lots XAUUSD' },
  });
  store.robots.set('r2', {
    id: 'r2', name: 'Robot 02', owner_id: 'friend', state: 'paused', symbol: 'XAUUSD', account_login: 1514746990,
    last_report_at: iso(9000),
    status: { ...base, equity: 24912.7, day_pnl: -87.3, trades_today: 2, daily_used_pct: 7, max_used_pct: 3.5,
      positions: [], blocks: ['news: USD Non-Farm Employment Change at 14:30 Prague'], last_action: '14:02 Pause: paused' },
  });
  store.lastCommand.set('r2', { id: 7, robot_id: 'r2', type: 'pause', created_by: 'friend', created_at: iso(600000), status: 'done', result: 'paused' });
  store.events.set('r1', [
    { at: iso(420000), message: 'Opened BUY 0.05 lots XAUUSD, stop 3740.10, target 3773.40' },
    { at: iso(3600000), message: 'Start: working' },
    { at: iso(3700000), message: 'Started 1.0.1 on XAUUSD M15, account 1514746116 (demo). Paused until you press Start.' },
  ]);
  store.events.set('r2', [
    { at: iso(600000), message: 'Pause: paused' },
    { at: iso(2400000), message: 'Closed by stop loss: -87.30' },
  ]);
  // Demo only: lets you (or a test) change the sample robots from the console.
  window.officeDemo = { store, render: () => render() };
}

function demoCommand(robot, type) {
  const command = { id: Date.now(), robot_id: robot.id, type, created_by: 'me', created_at: new Date().toISOString(), status: 'pending' };
  store.lastCommand.set(robot.id, command);
  render();
  setTimeout(() => {
    let result = { start: 'working', pause: 'paused', done_today: 'done for today, back at 00:00 Prague' }[type];
    if (type === 'close_all') {
      const n = robot.status.positions.length;
      robot.status.positions = [];
      result = `${n ? `closed ${n} position(s)` : 'nothing was open'}, paused`;
    }
    robot.state = { start: 'active', pause: 'paused', done_today: 'done_today', close_all: 'paused' }[type];
    robot.last_report_at = new Date().toISOString();
    command.status = 'done';
    command.result = result;
    store.events.set(robot.id, [{ at: new Date().toISOString(), message: `${LABEL[type]}: ${result}` }, ...(store.events.get(robot.id) || [])]);
    render();
  }, 1500);
}

main();
