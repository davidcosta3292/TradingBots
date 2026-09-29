// Trading Office control page.
// Two views of the same live data: the 3D office, and plain cards. Each
// robot's owner can press Start, Pause, Done for today and Close everything;
// the robot confirms each press. Add ?demo to the address to preview with
// sample robots, no Supabase needed.
import { MOODS, moodOf, readBlocks, resumeNote } from './moods.js?v=9';
import { COLORS, EYES, GEAR, lookOf } from './looks.js?v=8';
import { ASSIGNMENTS, assignmentOf, isTrader } from './assignments.js?v=8';
import { play, setSound, soundOn } from './sounds.js?v=5';

const DEMO = new URLSearchParams(location.search).has('demo');
const VIEW_KEY = 'trading-office-view';
const HISTORY_DAYS = 7;

const BUTTONS = [
  { type: 'start', label: 'Start', hint: 'May take new trades', icon: '▶' },
  { type: 'pause', label: 'Pause', hint: 'Open trades finish, no new ones', icon: '❚❚' },
  { type: 'done_today', label: 'Done for today', hint: 'Back at 00:00 Prague', icon: '■' },
  { type: 'close_all', label: 'Close everything', hint: 'Close now, then pause', icon: '✕' },
];
const LABEL = Object.fromEntries(BUTTONS.map((b) => [b.type, b.label]));
const CURRENT = { start: 'active', pause: 'paused', done_today: 'done_today' };
const EXIT_REASON = {
  'stop loss': 'stop loss', 'take profit': 'take profit', robot: 'closed by the robot',
  manual: 'closed by hand', 'stop out': 'stop out',
};
// What each place in the office means, for the legend.
const LEGEND = [
  ['planned', 'In the lounge', 'an assignment has been named, but no software runs it yet'],
  ['active', 'At its desk', 'working, looking for a setup'],
  ['trade', 'Typing at its desk', 'in a trade'],
  ['standby', 'At the coffee bar', 'on, but its own rules say "not now": outside its hours, market closed, or news. It carries on by itself.'],
  ['blocked', 'Scratching its head', 'blocked by something that needs you, like Algo Trading switched off'],
  ['paused', 'On the sofa', 'paused by its owner'],
  ['done', 'On the sofa, grey lamp', 'done for today, back at 00:00 Prague'],
  ['offline', 'Asleep and grey', 'offline: MetaTrader isn\'t reporting'],
];

const store = {
  me: null,
  members: new Map(),     // user id -> display name
  robots: new Map(),      // robot id -> row
  lastCommand: new Map(), // robot id -> newest command
  events: new Map(),      // robot id -> newest events first
  deals: new Map(),       // robot id -> deals, oldest first
};
let sb = null;
let view = 'cards';
let selectedId = null;
let office = null;        // the 3D scene, loaded on first use
let officeLoading = null;
let newRobotToken = null;  // shown only in this browser until the page closes
let setupOpen = false;
const htmlCache = new WeakMap();
const openLooks = new Set(); // robots whose look picker is open

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------

async function main() {
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  $('setup').addEventListener('submit', createMyRobot);
  $('legend').innerHTML = `<h3>Who is where</h3><ul>${LEGEND.map(([key, place, meaning]) =>
    `<li><i style="background:${MOODS[key].color}"></i><span><b>${place}</b> ${esc(meaning)}</span></li>`).join('')}</ul>`;

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
    await loadAllWithRetry();
    $('message').hidden = true;
  } catch (error) {
    if (isJwtClockError(error)) {
      return showMessage(`<h1>Supabase is still checking this sign-in</h1>
        <p>The data API returned “JWT issued at future” after several retries. This can happen when its token validator is behind the service that issued the token.</p>
        <p><button class="link" data-retry-load>Try again</button> · <button class="link" data-signout>Sign out</button></p>`);
    }
    return showMessage(`<h1>Could not load the office</h1><p>${esc(error.message)}</p>
      <p><button class="link" data-retry-load>Try again</button></p>`);
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
  setInterval(render, 15000); // keep clocks/offline badges current without rebuilding cards every few seconds
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

function isJwtClockError(error) {
  return /JWT issued at future/i.test(String(error?.message || ''));
}

async function loadAllWithRetry() {
  const delays = [1500, 3500, 7000, 12000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await loadAll();
    } catch (error) {
      if (!isJwtClockError(error) || attempt === delays.length) throw error;
      showMessage(`<h1>Connecting to the office</h1>
        <p>Supabase is checking the new sign-in. Retrying automatically (${attempt + 1}/${delays.length})…</p>`);
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
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
  officeLoading ??= import('./scene.js?v=9')
    .then(({ createOfficeScene }) => {
      office = createOfficeScene($('scene'), {
        onSelect: select,
        onTour: (on) => {
          const button = document.querySelector('[data-tour]');
          button.classList.toggle('on', on);
          button.setAttribute('aria-pressed', String(on));
          button.textContent = on ? 'Stop tour' : 'Tour';
        },
        getInsets: panelInsets,
      });
      return office;
    })
    .catch((error) => {
      $('scene').innerHTML = `<p class="scene-error">The 3D office could not load (${esc(error.message)}). The Cards view still works.</p>`;
      return null;
    });
  return officeLoading;
}

// Selecting a robot opens its card and brings the camera to it.
function select(id) {
  const was = selectedId;
  selectedId = id;
  if (id) office?.focus(id);
  else if (was) office?.home();
  render();
}

// How much of the office the open card covers, so the camera can keep the
// selected robot in view.
function panelInsets() {
  const panel = $('panel');
  if (panel.hidden) return { right: 0, bottom: 0 };
  const area = $('scene-view').getBoundingClientRect();
  const card = panel.getBoundingClientRect();
  return window.innerWidth <= 760
    ? { right: 0, bottom: Math.max(0, area.bottom - card.top) }
    : { right: Math.max(0, area.right - card.left), bottom: 0 };
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

async function loadAll() {
  const since = new Date(Date.now() - (HISTORY_DAYS + 1) * 86_400_000).toISOString();
  const [members, robots, commands, events, deals] = await Promise.all([
    sb.from('office_members').select('user_id, display_name'),
    sb.from('robots').select('*'),
    sb.from('commands').select('*').order('id', { ascending: false }).limit(100),
    sb.from('robot_events').select('*').order('id', { ascending: false }).limit(200),
    sb.from('deals').select('*').gte('deal_time', since).order('deal_time').limit(2000),
  ]);
  for (const result of [members, robots, commands, events, deals]) {
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
  deals.data.forEach(addDeal);
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
      announce(row);
      render();
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'deals' }, ({ new: row }) => {
      addDeal(row);
      render();
    })
    .subscribe();
}

function addDeal(deal) {
  const list = store.deals.get(deal.robot_id) || [];
  if (list.some((d) => String(d.ticket) === String(deal.ticket))) return;
  list.push(deal);
  list.sort((a, b) => Date.parse(a.deal_time) - Date.parse(b.deal_time));
  store.deals.set(deal.robot_id, list);
}

// A robot's trades closed in the last 7 days, oldest first, built from its
// deals: every deal of one position adds up to that trade's result.
function historyOf(robotId) {
  const since = Date.now() - HISTORY_DAYS * 86_400_000;
  const positions = new Map();
  for (const deal of store.deals.get(robotId) || []) {
    const key = String(deal.position_id ?? deal.ticket);
    const p = positions.get(key) || { entry: null, exit: null, net: 0 };
    p.net += (Number(deal.profit) || 0) + (Number(deal.commission) || 0) + (Number(deal.swap) || 0);
    if (deal.entry === 'in') p.entry = deal;
    else p.exit = deal;
    positions.set(key, p);
  }
  const trades = [];
  for (const [id, p] of positions) {
    if (!p.exit || Date.parse(p.exit.deal_time) < since) continue;
    trades.push({
      id,
      side: p.entry?.side || (p.exit.side === 'buy' ? 'sell' : 'buy'),
      volume: Number(p.entry?.volume ?? p.exit.volume),
      closeAt: p.exit.deal_time,
      reason: p.exit.reason,
      net: Math.round(p.net * 100) / 100,
    });
  }
  trades.sort((a, b) => Date.parse(a.closeAt) - Date.parse(b.closeAt));
  return {
    trades,
    total: trades.reduce((sum, t) => sum + t.net, 0),
    wins: trades.filter((t) => t.net > 0).length,
  };
}

function latestEvent() {
  let newest = null;
  for (const list of store.events.values()) {
    const e = list[0];
    if (e && (!newest || Date.parse(e.at) > Date.parse(newest.at))) newest = e;
  }
  if (!newest) return null;
  return { at: newest.at, name: store.robots.get(newest.robot_id)?.name || 'Robot', message: newest.message };
}

// A new robot event: a speech bubble in the office, and a sound if sound is on.
function announce(event) {
  const bubble = bubbleFor(event);
  office?.say(event.robot_id, bubble.text, bubble.tone);
  if (bubble.sound) play(bubble.sound);
}

function bubbleFor(event) {
  const message = String(event.message || '');
  const head = message.split(':')[0];
  if (event.kind === 'trade' && message.startsWith('Opened ')) {
    return { text: message.slice(7).split(',')[0], tone: 'good', sound: 'open' };
  }
  if (event.kind === 'trade' && message.startsWith('Closed by ')) {
    const [reason, amount = ''] = message.slice(10).split(': ');
    const loss = amount.startsWith('-');
    const text = reason === 'robot' ? `Closed ${amount}` : `${reason.charAt(0).toUpperCase()}${reason.slice(1)} ${amount}`;
    return { text, tone: loss ? 'bad' : 'good', sound: loss ? 'loss' : 'profit' };
  }
  if (event.kind === 'command') {
    const refused = head.endsWith(' refused');
    return { text: refused ? head : `${head} ✓`, tone: refused ? 'bad' : 'info', sound: refused ? 'alert' : 'confirm' };
  }
  if (event.kind === 'guard' || event.kind === 'error') return { text: head, tone: 'bad', sound: 'alert' };
  if (event.kind === 'started') return { text: 'Hello! Paused until Start', tone: 'info' };
  if (event.kind === 'stopped') return { text: 'Signing off', tone: 'info' };
  return { text: head.length > 44 ? `${head.slice(0, 43)}…` : head, tone: 'info' };
}

// ---------------------------------------------------------------------------
// Clicks: view switch, panel, office tools, looks, and the four buttons
// ---------------------------------------------------------------------------

async function onClick(event) {
  const target = event.target;
  if (target.closest('[data-add-robot]')) {
    setupOpen = !setupOpen;
    $('setup').dataset.mode = '';
    return render();
  }
  if (target.closest('[data-dismiss-token]')) {
    newRobotToken = null;
    setupOpen = false;
    $('setup').dataset.mode = '';
    return render();
  }
  if (target.closest('[data-copy-robot-token]')) {
    if (!newRobotToken) return;
    try {
      await navigator.clipboard.writeText(newRobotToken.token);
      return toast('Robot token copied. Paste it into your own MetaTrader robot settings.');
    } catch {
      return toast('Select the token and copy it manually.');
    }
  }
  const viewButton = target.closest('#views button[data-view]');
  if (viewButton) return setView(viewButton.dataset.view);

  if (target.closest('[data-signout]')) return sb?.auth.signOut();
  if (target.closest('[data-retry-load]')) return location.reload();
  if (target.closest('[data-close-panel]')) return select(null);

  if (target.closest('[data-sound]')) {
    setSound(!soundOn());
    return render();
  }
  const tourButton = target.closest('[data-tour]');
  if (tourButton) {
    const on = !tourButton.classList.contains('on');
    if (on) selectedId = null; // the tour shows every robot, so close the open card
    office?.tour(on);
    return render();
  }
  if (target.closest('[data-home]')) {
    selectedId = null;
    office?.tour(false);
    return render();
  }
  const legendButton = target.closest('[data-legend]');
  if (legendButton) {
    $('legend').hidden = !$('legend').hidden;
    legendButton.classList.toggle('on', !$('legend').hidden);
    return;
  }

  const lookToggle = target.closest('[data-look-toggle]');
  if (lookToggle) {
    const id = lookToggle.dataset.lookToggle;
    if (openLooks.has(id)) openLooks.delete(id);
    else openLooks.add(id);
    return render();
  }
  const lookButton = target.closest('button[data-look]');
  if (lookButton) return changeLook(lookButton.dataset.robot, lookButton.dataset.look, lookButton.dataset.value);

  const button = target.closest('button[data-cmd]');
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

async function onChange(event) {
  const select = event.target.closest('select[data-assignment]');
  if (!select) return;
  const robot = store.robots.get(select.dataset.assignment);
  if (!robot || robot.owner_id !== store.me?.id || robot.last_report_at) return;
  const next = select.value;
  if (DEMO) {
    robot.assignment = next;
    return render();
  }
  select.disabled = true;
  const { data, error } = await sb.rpc('set_robot_assignment', { p_robot: robot.id, p_assignment: next });
  if (error) {
    select.disabled = false;
    select.value = assignmentOf(robot).key;
    return toast(`Could not change assignment: ${error.message}`);
  }
  robot.assignment = next;
  if (data?.token) {
    newRobotToken = { id: robot.id, name: robot.name, assignment: next, token: data.token };
    setupOpen = true;
  }
  render();
}

async function createMyRobot(event) {
  event.preventDefault();
  if (DEMO || !sb || !store.me || newRobotToken) return;
  const form = event.target;
  const name = String(new FormData(form).get('name') || '').trim();
  const assignment = String(new FormData(form).get('assignment') || 'trader');
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  const { data, error } = await sb.rpc('create_my_robot', { p_name: name, p_assignment: assignment });
  if (error) {
    button.disabled = false;
    return toast(`Could not create your robot: ${error.message}`);
  }
  newRobotToken = data;
  setupOpen = true;
  const { data: robot } = await sb.from('robots').select('*').eq('id', data.id).single();
  if (robot) store.robots.set(robot.id, robot);
  render();
}

async function changeLook(robotId, field, value) {
  const robot = store.robots.get(robotId);
  if (!robot) return;
  const look = { ...lookOf(robot, sortedRobots().indexOf(robot)), [field]: value };
  if (!DEMO) {
    const { error } = await sb.rpc('set_robot_look', { p_robot: robotId, p_look: look });
    if (error) return toast(`Could not change the look: ${error.message}`);
  }
  robot.look = look;
  render();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function sortedRobots() {
  return [...store.robots.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function setHTML(element, html) {
  if (htmlCache.get(element) === html) return;
  element.innerHTML = html;
  htmlCache.set(element, html);
}

function render() {
  const robots = sortedRobots();
  renderSetup(robots);
  setHTML($('summary'), summary(robots));

  if (view === 'cards') {
    setHTML($('robots'), robots.length
      ? robots.map(card).join('')
      : '<p class="empty">No robots yet.</p>');
    return;
  }

  const robot = selectedId && store.robots.get(selectedId);
  $('panel').hidden = !robot;
  if (robot) {
    setHTML($('panel'), `<button class="panel-close" data-close-panel aria-label="Close">✕</button>${card(robot)}`);
  }
  office?.update({ robots, selected: selectedId, history: historyOf, latest: latestEvent() });
}

function renderSetup(robots) {
  const setup = $('setup');
  if (DEMO) return;
  if (newRobotToken) {
    if (setup.dataset.mode === `token:${newRobotToken.id}`) return;
    setup.dataset.mode = `token:${newRobotToken.id}`;
    setup.hidden = false;
    const trader = newRobotToken.assignment === 'trader';
    setup.innerHTML = `<h2>${esc(newRobotToken.name)} · ${esc(assignmentOf(newRobotToken).label)}</h2>
      ${trader ? `<p>This token is shown only now. Copy it into the <b>Robot token</b> input of OfficeRobot on your own MetaTrader 5 account.</p>
      <div class="token-line"><code>${esc(newRobotToken.token)}</code><button type="button" data-copy-robot-token>Copy token</button></div>`
      : '<p>This role is an office assignment only. Its risk, coordination, or analysis software has not been built yet. The MetaTrader trading EA must not be attached to it.</p>'}
      ${trader ? `
      <p><a href="downloads/OfficeRobot-source.zip" download>Download OfficeRobot source</a>. On Mac: in MetaTrader, open <b>File → Open Data Folder</b>, then copy the unzipped <code>OfficeRobot</code> folder into <code>MQL5/Experts</code>. Open <code>OfficeRobot.mq5</code> in MetaEditor and compile it with F7.</p>
      <p>Attach it to your own FTMO demo chart. Give each Trader EA a different magic number (101, 102, 103…), allow WebRequest to <code>https://tpmrowyqsayyypkxkvfz.supabase.co</code>, paste this token, and enable Algo Trading. It starts paused; press Start here after it reports in.</p>` : ''}
      <button type="button" data-dismiss-token>${trader ? 'I copied the token' : 'Done'}</button>`;
    return;
  }
  const mine = robots.filter((r) => r.owner_id === store.me?.id).length;
  if (mine >= 6) {
    setup.dataset.mode = 'full';
    setup.hidden = true;
    return;
  }
  if (setup.dataset.mode === (setupOpen ? 'open' : 'closed')) return;
  setup.dataset.mode = setupOpen ? 'open' : 'closed';
  setup.hidden = false;
  setup.innerHTML = `<button type="button" class="add-robot" data-add-robot aria-expanded="${setupOpen}">
    ${setupOpen ? '− Close' : '+ Add robot'} <small>${mine}/6 yours</small></button>
    ${setupOpen ? `<p>Choose the assignment first. Trader works with the MetaTrader EA. Other roles are planning slots until their runtime is built.</p>
      <form><label>Name <input name="name" maxlength="40" placeholder="e.g. Gold Trader" required></label>
      <label>Assignment <select name="assignment">${ASSIGNMENTS.map((a) => `<option value="${a.key}">${a.label} · ${a.detail}</option>`).join('')}</select></label>
      <button type="submit">Create robot</button></form>
      <p><a href="downloads/OfficeRobot-source.zip" download>Download the Trader EA source</a> for MetaTrader 5.</p>` : ''}`;
}

function summary(robots) {
  const moods = robots.map((r) => moodOf(r));
  const online = moods.filter((m) => m.key !== 'offline' && m.key !== 'planned').length;
  const trading = moods.filter((m) => m.key !== 'offline' && m.key !== 'planned' && m.inTrade).length;
  const prague = new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit' });
  const on = soundOn();
  return `<span><b>${robots.length}</b> robots</span>
    <span><b>${online}</b> online</span>
    <span><b>${trading}</b> in a trade</span>
    <span class="clock">Prague ${prague}</span>
    <button type="button" class="chip${on ? ' on' : ''}" data-sound aria-pressed="${on}" title="Sounds for trades and button presses">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/>${on
        ? '<path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
        : '<path d="M16.5 9.5l5 5m0-5l-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'}</svg>
      Sound ${on ? 'on' : 'off'}</button>`;
}

function card(r) {
  const s = r.status || {};
  const currency = s.currency || 'USD';
  const mood = moodOf(r);
  const online = mood.key !== 'offline';
  const mine = store.me && r.owner_id === store.me.id;
  const owner = store.members.get(r.owner_id) || 'Unknown';
  const assignment = assignmentOf(r);
  if (!isTrader(r)) return `<article class="robot planned">
    <header class="robot-head"><div><h2>${esc(r.name)}</h2>
      <p class="sub">${esc(owner)}${mine ? ' · yours' : ' · view only'} · ${esc(assignment.label)}</p></div>
      <span class="pill planned">Planned</span></header>
    <div class="assignment-note"><b>${esc(assignment.label)} is an assignment, not a running agent yet.</b>
      <p>No risk, coordination, or analysis program is connected. It does not watch accounts, send alerts, or place trades. Trader EAs enforce their own FTMO limits.</p></div>
    ${mine ? assignmentPicker(r) + lookPicker(r) : ''}
  </article>`;
  const positions = Array.isArray(s.positions) ? s.positions : [];
  const blocks = Array.isArray(s.blocks) ? s.blocks : [];
  const command = store.lastCommand.get(r.id);
  const events = store.events.get(r.id) || [];
  // Say what happens next when the robot is on, or when something needs us.
  const note = r.state === 'active' || readBlocks(blocks)?.needsYou ? resumeNote(blocks) : '';

  return `<article class="robot ${mood.key}">
    <header class="robot-head">
      <div>
        <h2>${esc(r.name)}</h2>
        <p class="sub">${esc(owner)}${mine ? ' · yours' : ' · view only'} · Trader · ${esc(r.symbol || '—')} ${esc(s.timeframe || '')}
          · account ${esc(r.account_login ?? '—')}</p>
      </div>
      <span class="pill ${mood.key}">${esc(mood.label)}</span>
    </header>

    <p class="seen">${seenText(r, online)}</p>
    ${s.exercise_mode ? `<p class="exercise-note"><b>Demo exercise</b> · EMA bias on closed M1 bars · timed exit after ${esc(s.exercise_hold_minutes ?? 3)} min or stop/target · ${esc(s.risk_pct ?? 0.05)}% risk per entry. This is an execution check, not a validated strategy.</p>` : ''}
    ${s.signal_check ? `<div class="plan-note"><b>XAUUSD plan draft · demo</b>
      <span>${esc(s.trends || 'Waiting for trend data')}</span>
      <span>${esc(s.signal_check)}</span>
      <small>Up to ${esc(s.risk_pct ?? 0.1)}% risk · ${esc(s.target_r ?? 3)}R target · ${esc(s.max_hold_hours ?? 6)}h maximum hold · ${esc(s.loss_streak ?? 0)} losses in a row</small>
    </div>` : ''}

    ${positions.length
      ? positions.map((p) => positionRow(p, r, currency)).join('')
      : `<p class="flat">${mood.key === 'active' ? 'No open trade · looking for a setup' : 'No open trade'}</p>`}

    <div class="numbers">
      <div><span>Equity</span><b>${money(s.equity, currency)}</b></div>
      <div><span>Today</span><b class="${tone(s.day_pnl)}">${signedMoney(s.day_pnl, currency)}</b></div>
      <div><span>Trades today</span><b>${s.trades_today ?? '—'}</b></div>
    </div>

    ${meter('FTMO daily loss used', s.daily_used_pct,
      `FTMO limit ${money(s.ftmo_daily_floor, currency)} · robot stops at ${money(s.robot_daily_stop, currency)}`)}
    ${meter('FTMO max loss used', s.max_used_pct,
      `FTMO limit ${money(s.ftmo_max_floor, currency)} · robot stops at ${money(s.robot_max_stop, currency)}`)}

    ${blocks.length ? `<div class="blocks${mood.key === 'blocked' ? ' needs-you' : ''}">
      <span>${r.state === 'active' ? 'Not opening trades because' : 'Also holding it back'}</span>
      <ul>${blocks.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
      ${note ? `<p class="resume">${esc(note)}</p>` : ''}</div>` : ''}
    ${online && s.upcoming_news ? `<p class="upcoming-news"><b>News watch · next hour</b> ${esc(s.upcoming_news)}</p>` : ''}
    ${s.link_error ? `<p class="warn">${esc(s.link_error)}</p>` : ''}

    ${mine ? buttons(r, online, command)
      : `<p class="viewonly">Only ${esc(owner)} can control this robot. FTMO allows nobody else to use their account.</p>`}
    ${command ? commandLine(command) : ''}

    ${tradeHistory(r, currency)}
    ${mine ? assignmentPicker(r) : ''}
    ${mine ? lookPicker(r) : ''}

    ${events.length ? `<ol class="feed">${events.slice(0, 5).map((e) =>
      `<li><time>${clock(e.at)}</time>${esc(e.message)}</li>`).join('')}</ol>` : ''}
  </article>`;
}

function assignmentPicker(r) {
  if (r.last_report_at) return '<p class="viewonly">Assignment is fixed after MetaTrader first connects.</p>';
  return `<label class="assignment-picker">Assignment
    <select data-assignment="${r.id}">${ASSIGNMENTS.map((a) => `<option value="${a.key}"${assignmentOf(r).key === a.key ? ' selected' : ''}>${a.label}</option>`).join('')}</select>
    <small>Changing to Trader creates a new one-time MT5 token. Other roles are planning slots.</small></label>`;
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

function tradeHistory(r, currency) {
  const h = historyOf(r.id);
  if (!h.trades.length) {
    return `<div class="history"><div class="history-top"><span>Last 7 days</span><span>No closed trades yet</span></div></div>`;
  }
  return `<div class="history">
    <div class="history-top">
      <span>Last 7 days · ${h.trades.length} trade${h.trades.length === 1 ? '' : 's'} · ${h.wins} won</span>
      <b class="${tone(h.total)}">${signedMoney(h.total, currency)}</b>
    </div>
    ${sparkline(h.trades)}
    <ol class="trades">${h.trades.slice(-4).reverse().map((t) => `<li>
      <time>${dayTime(t.closeAt)}</time>
      <span><b class="side ${esc(t.side)}">${esc(String(t.side).toUpperCase())}</b> ${esc(t.volume)} · ${esc(EXIT_REASON[t.reason] || t.reason || 'closed')}</span>
      <b class="${tone(t.net)}">${signedMoney(t.net, currency)}</b></li>`).join('')}</ol>
  </div>`;
}

// The running total of the closed trades, one step per trade.
function sparkline(trades) {
  const points = [0];
  for (const t of trades) points.push(points[points.length - 1] + t.net);
  const [W, H, pad] = [300, 54, 4];
  const low = Math.min(0, ...points);
  const high = Math.max(0, ...points);
  const span = high - low || 1;
  const x = (i) => (pad + (i * (W - pad * 2)) / Math.max(1, points.length - 1)).toFixed(1);
  const y = (v) => (pad + ((high - v) * (H - pad * 2)) / span).toFixed(1);
  const line = points.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('');
  const color = points[points.length - 1] >= 0 ? 'var(--green)' : 'var(--red)';
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" class="zero"/>
    <path d="${line}L${x(points.length - 1)},${y(0)}L${x(0)},${y(0)}Z" fill="${color}" opacity="0.14"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

function lookPicker(r) {
  const look = lookOf(r, sortedRobots().indexOf(r));
  const open = openLooks.has(r.id);
  const gearLabel = GEAR.find((g) => g.key === look.gear)?.label || '';
  return `<div class="look">
    <button type="button" class="look-toggle" data-look-toggle="${r.id}" aria-expanded="${open}">
      <i class="swatch-dot" style="background:${esc(look.color)}"></i>Look in the office · ${esc(gearLabel)}
      <span class="chev">${open ? '▴' : '▾'}</span></button>
    ${open ? `<div class="look-body">
      <small>Body colour</small>
      <div class="swatches">${COLORS.map((c) => `<button type="button" class="swatch${c.toLowerCase() === look.color.toLowerCase() ? ' on' : ''}"
        style="background:${c}" data-look="color" data-value="${c}" data-robot="${r.id}" aria-label="Colour ${c}"></button>`).join('')}</div>
      <small>Eye colour</small>
      <div class="swatches">${EYES.map((c) => `<button type="button" class="swatch${c.toLowerCase() === look.eyes.toLowerCase() ? ' on' : ''}"
        style="background:${c}" data-look="eyes" data-value="${c}" data-robot="${r.id}" aria-label="Eye colour ${c}"></button>`).join('')}</div>
      <small>Gear</small>
      <div class="gear">${GEAR.map((g) => `<button type="button" class="${g.key === look.gear ? 'on' : ''}"
        data-look="gear" data-value="${g.key}" data-robot="${r.id}">${g.label}</button>`).join('')}</div>
    </div>` : ''}
  </div>`;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

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

function dayTime(iso) {
  return new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
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
    currency: 'USD', timeframe: 'M15', strategy: 'XAUUSD plan draft v1: H4/D1/H1 trend, M15 BOS-pullback', initial: 25000,
    risk_pct: 0.1, target_r: 3, max_hold_hours: 6, loss_streak: 0,
    trends: 'D1 up / H4 up / H1 up / M15 up',
    signal_check: 'BUY: structure break, zone retest, reaction, confirmation',
    ftmo_daily_floor: 23750, robot_daily_stop: 24000, ftmo_max_floor: 22500, robot_max_stop: 23000,
  };
  store.robots.set('r1', {
    id: 'r1', name: 'Robot 01', owner_id: 'me', state: 'active', symbol: 'XAUUSD', account_login: 1514746116,
    last_report_at: iso(4000), look: {},
    status: { ...base, equity: 25086.4, day_pnl: 61.2, trades_today: 1, daily_used_pct: 0, max_used_pct: 0, can_trade: true,
      positions: [{ side: 'buy', volume: 0.05, open: 3751.2, sl: 3740.1, tp: 3773.4, profit: 25.2 }], blocks: [],
      last_action: '15:15 Opened BUY 0.05 lots XAUUSD' },
  });
  store.robots.set('r2', {
    id: 'r2', name: 'Robot 02', owner_id: 'friend', state: 'active', symbol: 'XAUUSD', account_login: 1514746990,
    last_report_at: iso(9000), look: {},
    status: { ...base, equity: 24912.7, day_pnl: -87.3, trades_today: 2, daily_used_pct: 7, max_used_pct: 3.5, can_trade: false,
      positions: [], blocks: ['news: USD Non-Farm Employment Change at 14:30 Prague'], last_action: '14:02 Closed by stop loss: -87.30' },
  });
  store.lastCommand.set('r2', { id: 7, robot_id: 'r2', type: 'start', created_by: 'friend', created_at: iso(3000000), status: 'done', result: 'working' });
  store.events.set('r1', [
    { id: 3, robot_id: 'r1', kind: 'trade', at: iso(420000), message: 'Opened BUY 0.05 lots XAUUSD, stop 3740.10, target 3773.40' },
    { id: 2, robot_id: 'r1', kind: 'command', at: iso(3600000), message: 'Start: working' },
    { id: 1, robot_id: 'r1', kind: 'started', at: iso(3700000), message: 'Started 1.0.1 on XAUUSD M15, account 1514746116 (demo). Paused until you press Start.' },
  ]);
  store.events.set('r2', [
    { id: 5, robot_id: 'r2', kind: 'trade', at: iso(600000), message: 'Closed by stop loss: -87.30' },
    { id: 4, robot_id: 'r2', kind: 'command', at: iso(3000000), message: 'Start: working' },
  ]);
  demoTrades('r1', [42.5, -31.2, 88, 12.4, -25.9, 120], now).forEach(addDeal);
  demoTrades('r2', [-40.1, 65.3, -87.3], now).forEach(addDeal);

  // The sample robots keep reporting, and the open trade's profit drifts.
  setInterval(() => {
    for (const robot of store.robots.values()) robot.last_report_at = new Date().toISOString();
    const r1 = store.robots.get('r1');
    const p = r1.status.positions[0];
    if (p) {
      const step = Math.round((Math.random() - 0.45) * 800) / 100;
      p.profit = Math.round((p.profit + step) * 100) / 100;
      r1.status.day_pnl = Math.round((r1.status.day_pnl + step) * 100) / 100;
      r1.status.equity = Math.round((r1.status.equity + step) * 100) / 100;
    }
  }, 5000);

  // Demo only: lets you (or a test) change the sample robots from the console.
  window.officeDemo = { store, render: () => render(), announce, event: demoEvent, get office() { return office; } };
}

// Closed trades as the robot reports them: an entry deal and an exit deal each.
function demoTrades(robotId, results, now) {
  return results.flatMap((net, i) => {
    const closeAt = now - (results.length - i) * 20 * 3_600_000;
    const side = i % 2 ? 'sell' : 'buy';
    const position = 9000 + i;
    return [
      { robot_id: robotId, ticket: position * 10, position_id: position, deal_time: new Date(closeAt - 90 * 60_000).toISOString(),
        side, entry: 'in', volume: 0.05, profit: 0, commission: -1.5, swap: 0, reason: 'robot' },
      { robot_id: robotId, ticket: position * 10 + 1, position_id: position, deal_time: new Date(closeAt).toISOString(),
        side: side === 'buy' ? 'sell' : 'buy', entry: 'out', volume: 0.05, profit: net + 3, commission: -1.5, swap: 0,
        reason: net >= 0 ? 'take profit' : 'stop loss' },
    ];
  });
}

function demoEvent(robotId, kind, message) {
  const event = { id: Date.now() + Math.random(), robot_id: robotId, at: new Date().toISOString(), kind, message };
  store.events.set(robotId, [event, ...(store.events.get(robotId) || [])].slice(0, 8));
  announce(event);
  render();
}

function demoCommand(robot, type) {
  const command = { id: Date.now(), robot_id: robot.id, type, created_by: 'me', created_at: new Date().toISOString(), status: 'pending' };
  store.lastCommand.set(robot.id, command);
  render();
  setTimeout(() => {
    let result = { start: 'working', pause: 'paused', done_today: 'done for today, back at 00:00 Prague' }[type];
    const closed = type === 'close_all' ? robot.status.positions.splice(0) : [];
    if (type === 'close_all') result = `${closed.length ? `closed ${closed.length} position(s)` : 'nothing was open'}, paused`;
    robot.state = { start: 'active', pause: 'paused', done_today: 'done_today', close_all: 'paused' }[type];
    robot.status.can_trade = robot.state === 'active' && !(robot.status.blocks || []).length;
    robot.last_report_at = new Date().toISOString();
    command.status = 'done';
    command.result = result;
    demoEvent(robot.id, 'command', `${LABEL[type]}: ${result}`);
    for (const p of closed) {
      const net = Math.round(Number(p.profit) * 100) / 100;
      const position = Date.now();
      addDeal({ robot_id: robot.id, ticket: position * 10, position_id: position, deal_time: new Date(Date.now() - 3_600_000).toISOString(),
        side: p.side, entry: 'in', volume: p.volume, profit: 0, commission: 0, swap: 0, reason: 'robot' });
      addDeal({ robot_id: robot.id, ticket: position * 10 + 1, position_id: position, deal_time: new Date().toISOString(),
        side: p.side === 'buy' ? 'sell' : 'buy', entry: 'out', volume: p.volume, profit: net, commission: 0, swap: 0, reason: 'robot' });
      setTimeout(() => demoEvent(robot.id, 'trade', `Closed by robot: ${net >= 0 ? '+' : ''}${net.toFixed(2)}`), 1200);
    }
  }, 1500);
}

main();
