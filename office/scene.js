// The Trading Office in 3D.
// One desk per robot. A robot works at its desk, waits at the coffee bar when
// its own rules say "not now" (outside its hours, market closed, news), sits
// on the lounge sofa when we pause it, and dozes grey at its desk when
// a running program stops reporting. Every screen shows only what the robots report.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { MOODS, moodOf } from './moods.js?v=11';
import { lookOf } from './looks.js?v=8';
import { assignmentOf } from './assignments.js?v=12';

const ROOM = { w: 25, d: 18, h: 4.6 };
const CORRIDOR_X = -2.8;
const WALK_SPEED = 2.6;
const GOLD = '#E3A82B';
const GREEN = '#3DDC84';
const RED = '#F06A5F';
const INK = '#EDEBE6';
const MUTED = '#8F96A2';
const OFFLINE_BODY = new THREE.Color('#5A5F68');
// Three generous rows of four, with a clear aisle to the lounge and coffee.
const DESK_SLOTS = [-5.8, -0.8, 4.2].flatMap((z) => [0, 3.3, 6.6, 9.9].map((x) => ({ x, z })));
// One sofa seat per robot, so nobody shuffles over when another sits down.
const LOUNGE_SEATS = [3.25, 6.6, 7.75].flatMap((z) => [-10.4, -8.8, -7.2, -5.6].map((x) => ({ x, z })));
// Standing room at the coffee bar, for robots waiting for their trading hours.
const COFFEE_SPOTS = [-10.2, -8.9, -7.6, -6.3].map((x) => ({ x, z: -3.1 }));
// The starting view, which "Overview" flies back to.
const HOME = { target: new THREE.Vector3(0, 0.8, 0), offset: new THREE.Vector3(30, 26, 30), zoom: 1 };
const TOUR_STOP_MS = 7000;
const BUBBLE_MS = 6000;

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function money(value, currency = 'USD', signed = false) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const text = new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Math.abs(n));
  if (!signed) return (n < 0 ? '−' : '') + text;
  return (n > 0 ? '+' : n < 0 ? '−' : '') + text;
}

const toneColor = (n) => (n > 0 ? GREEN : n < 0 ? RED : INK);

function pragueClock(date = new Date()) {
  return date.toLocaleTimeString('en-GB', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function material(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.05, flatShading: true, ...extra });
}

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function canvasTexture(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { canvas, ctx: canvas.getContext('2d'), texture };
}

function screenPlane(width, height, texture) {
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture }));
}

function font(size, weight = 600) {
  return `${weight} ${size}px Bahnschrift, "Segoe UI", system-ui, sans-serif`;
}

function fitText(ctx, text, maxWidth) {
  let out = String(text ?? '');
  if (ctx.measureText(out).width <= maxWidth) return out;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

// Draws [text, colour, font] pieces one after another on a line, and returns
// where the line ends.
function runs(ctx, x, y, pieces) {
  ctx.textAlign = 'left';
  for (const [text, color, style] of pieces) {
    ctx.fillStyle = color;
    ctx.font = style;
    ctx.fillText(text, x, y);
    x += ctx.measureText(text).width;
  }
  return x;
}

function bar(ctx, x, y, w, h, pct) {
  const value = Math.max(0, Math.min(100, Number(pct) || 0));
  ctx.fillStyle = '#1C2129';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = value >= 80 ? RED : value >= 50 ? GOLD : GREEN;
  ctx.fillRect(x, y, Math.max(3, (w * value) / 100), h);
}

function disposeTree(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.dispose();
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
  });
}

// ---------------------------------------------------------------------------
// The room
// ---------------------------------------------------------------------------

function buildRoom(scene) {
  const { w, d, h } = ROOM;
  const gold = new THREE.MeshBasicMaterial({ color: GOLD });

  // Floor with a faint tile grid.
  const floorTex = canvasTexture(1024, 768);
  floorTex.ctx.fillStyle = '#23272E';
  floorTex.ctx.fillRect(0, 0, 1024, 768);
  floorTex.ctx.strokeStyle = 'rgba(255,255,255,0.045)';
  floorTex.ctx.lineWidth = 2;
  for (let x = 0; x <= 1024; x += 64) { floorTex.ctx.beginPath(); floorTex.ctx.moveTo(x, 0); floorTex.ctx.lineTo(x, 768); floorTex.ctx.stroke(); }
  for (let y = 0; y <= 768; y += 64) { floorTex.ctx.beginPath(); floorTex.ctx.moveTo(0, y); floorTex.ctx.lineTo(1024, y); floorTex.ctx.stroke(); }
  const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), [
    material('#1A1D23'), material('#1A1D23'),
    new THREE.MeshStandardMaterial({ map: floorTex.texture, roughness: 0.9 }),
    material('#1A1D23'), material('#16191E'), material('#16191E'),
  ]);
  floor.position.y = -0.15;
  floor.receiveShadow = true;
  scene.add(floor);

  // Two back walls, as in an isometric diorama.
  const wallMat = material('#1C1F26');
  scene.add(box(0.3, h, d, wallMat, -w / 2 - 0.15, h / 2, 0));
  scene.add(box(w + 0.3, h, 0.3, wallMat, 0, h / 2, -d / 2 - 0.15));
  // Gold trim along the floor and the tops of the walls.
  const trims = [
    [w, 0.06, 0.03, 0, 0.12, -d / 2 + 0.015], [0.03, 0.06, d, -w / 2 + 0.015, 0.12, 0],
    [w + 0.3, 0.06, 0.32, 0, h + 0.03, -d / 2 - 0.15], [0.32, 0.06, d, -w / 2 - 0.15, h + 0.03, 0],
    [w, 0.04, 0.04, 0, 0.005, d / 2], [0.04, 0.04, d, w / 2, 0.005, 0],
  ];
  for (const [bw, bh, bd, x, y, z] of trims) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), gold);
    m.position.set(x, y, z);
    scene.add(m);
  }

  // Big wall screen on the back wall.
  const wall = canvasTexture(1400, 440);
  scene.add(box(8.2, 2.5, 0.12, material('#0A0C0F'), 5.1, 2.55, -d / 2 + 0.06));
  const wallScreen = screenPlane(8.0, 2.3, wall.texture);
  wallScreen.position.set(5.1, 2.55, -d / 2 + 0.125);
  scene.add(wallScreen);

  // Logo on the left wall.
  const logo = canvasTexture(512, 512);
  drawLogo(logo.ctx);
  logo.texture.needsUpdate = true;
  const logoPlane = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.3), new THREE.MeshBasicMaterial({ map: logo.texture, transparent: true }));
  logoPlane.position.set(-w / 2 + 0.02, 2.6, -5.4);
  logoPlane.rotation.y = Math.PI / 2;
  scene.add(logoPlane);

  // World clocks on the left wall: FTMO's day runs on Prague time.
  const cities = [['PRAGUE', 'Europe/Prague'], ['LONDON', 'Europe/London'], ['NEW YORK', 'America/New_York']];
  const clocks = cities.map(([name, zone], i) => {
    const tex = canvasTexture(320, 200);
    scene.add(box(0.06, 0.78, 1.18, material('#0A0C0F'), -w / 2 + 0.03, 2.75, -3.1 + i * 1.45));
    const plane = screenPlane(1.1, 0.7, tex.texture);
    plane.position.set(-w / 2 + 0.07, 2.75, -3.1 + i * 1.45);
    plane.rotation.y = Math.PI / 2;
    scene.add(plane);
    return { name, zone, tex };
  });

  // Server rack with blinking lights in the back corner.
  const rackX = -w / 2 + 0.75;
  const rackZ = -d / 2 + 0.6;
  scene.add(box(1.1, 2.6, 0.9, material('#15181D'), rackX, 1.3, rackZ));
  const leds = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 3; col++) {
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.02), new THREE.MeshBasicMaterial({ color: '#2C3A33' }));
      led.position.set(rackX - 0.3 + col * 0.3, 0.55 + row * 0.26, rackZ + 0.46);
      scene.add(led);
      leds.push(led);
    }
  }

  // Water cooler and plants.
  scene.add(box(0.7, 1.2, 0.7, material('#D5DAE2'), w / 2 - 0.6, 0.6, -d / 2 + 0.6));
  scene.add(box(0.5, 0.55, 0.5, material('#7CC7E6', { transparent: true, opacity: 0.85 }), w / 2 - 0.6, 1.48, -d / 2 + 0.6));
  addPlant(scene, -w / 2 + 0.6, d / 2 - 0.7);
  addPlant(scene, w / 2 - 0.6, d / 2 - 0.7);
  addPlant(scene, -3.8, -d / 2 + 0.6);

  // Lounge: rug, sofa, coffee table, and the word on the floor.
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(7.0, 6.0), new THREE.MeshStandardMaterial({ color: '#2B2A24', roughness: 1 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(-8.0, 0.01, 4.5);
  rug.receiveShadow = true;
  scene.add(rug);
  scene.add(floorWord('L O U N G E', -8.0, 7.0));
  const sofa = material('#3B4150');
  scene.add(box(6.6, 0.45, 1.0, sofa, -8.0, 0.225, 3.0));
  scene.add(box(6.6, 0.95, 0.3, material('#353B48'), -8.0, 0.62, 2.4));
  scene.add(box(0.3, 0.7, 1.3, sofa, -11.45, 0.35, 2.85));
  scene.add(box(0.3, 0.7, 1.3, sofa, -4.55, 0.35, 2.85));
  scene.add(box(2.6, 0.36, 1.0, material('#2F343E'), -8.0, 0.18, 5.3));
  for (const x of [-10.4, -8.8, -7.2, -5.6]) {
    scene.add(box(0.82, 0.25, 0.82, material('#444653'), x, 0.125, 6.6));
    scene.add(box(0.82, 0.25, 0.82, material('#444653'), x, 0.125, 7.75));
  }
  // Low bookshelves and warm side lamps give the lounge its own visual zone.
  for (const x of [-11.1, -4.9]) {
    scene.add(box(0.65, 1.45, 0.68, material('#30343E'), x, 0.725, 5.2));
    scene.add(box(0.35, 0.1, 0.35, material('#E3A82B', { emissive: '#8B5A12' }), x, 1.52, 5.2));
  }

  // Coffee bar in the front corner, where robots wait for their trading hours.
  scene.add(box(5.4, 0.98, 0.7, material('#343A44'), -8.2, 0.49, -2.1));
  scene.add(box(5.55, 0.06, 0.84, material('#4B5260'), -8.2, 1.01, -2.1));
  const signTex = canvasTexture(512, 96);
  signTex.ctx.font = font(58, 700);
  signTex.ctx.fillStyle = GOLD;
  signTex.ctx.textAlign = 'center';
  signTex.ctx.fillText('C O F F E E', 256, 70);
  signTex.texture.needsUpdate = true;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.36), new THREE.MeshBasicMaterial({ map: signTex.texture, transparent: true }));
  sign.position.set(-8.2, 0.56, -1.73);
  scene.add(sign);
  scene.add(box(0.5, 0.62, 0.42, material('#1E2228'), -6.3, 1.35, -2.1));
  scene.add(box(0.3, 0.12, 0.12, material('#5B6272'), -6.3, 1.2, -1.84));
  const machineLed = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.02), new THREE.MeshBasicMaterial({ color: GREEN }));
  machineLed.position.set(-6.15, 1.54, -1.84);
  scene.add(machineLed);
  for (const [x, z] of [[-10.0, -2.1], [-9.65, -1.95]]) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.13, 14), material('#EDEAE3'));
    cup.position.set(x, 1.105, z);
    cup.castShadow = true;
    scene.add(cup);
  }
  // Menu board and stools make it read as a coffee bar, even at overview zoom.
  scene.add(box(2.4, 1.1, 0.08, material('#15191D'), -8.3, 2.5, -2.7));
  for (const x of [-9.8, -8.2, -6.6]) {
    scene.add(box(0.12, 0.52, 0.12, material('#252B33'), x, 0.26, -4.45));
    scene.add(box(0.65, 0.12, 0.65, material('#A16B3E'), x, 0.56, -4.45));
  }

  function drawClocks() {
    for (const { name, zone, tex } of clocks) {
      const { ctx } = tex;
      ctx.fillStyle = '#0A0C0F';
      ctx.fillRect(0, 0, 320, 200);
      ctx.fillStyle = MUTED;
      ctx.font = font(34);
      ctx.textAlign = 'center';
      ctx.fillText(name, 160, 62);
      ctx.fillStyle = GOLD;
      ctx.font = font(84, 700);
      ctx.fillText(new Date().toLocaleTimeString('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit' }), 160, 160);
      tex.texture.needsUpdate = true;
    }
  }

  let nextBlink = 0;
  function blink(t) {
    if (t < nextBlink) return;
    nextBlink = t + 0.25;
    for (const led of leds) {
      if (Math.random() < 0.18) {
        const r = Math.random();
        led.material.color.set(r < 0.5 ? GREEN : r < 0.62 ? GOLD : '#2C3A33');
      }
    }
  }

  return { wall, drawClocks, blink };
}

function floorWord(text, x, z) {
  const tex = canvasTexture(512, 128);
  tex.ctx.font = font(78, 700);
  tex.ctx.fillStyle = 'rgba(227,168,43,0.8)';
  tex.ctx.textAlign = 'center';
  tex.ctx.fillText(text, 256, 92);
  tex.texture.needsUpdate = true;
  const label = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), new THREE.MeshBasicMaterial({ map: tex.texture, transparent: true }));
  label.rotation.x = -Math.PI / 2;
  label.position.set(x, 0.02, z);
  return label;
}

function drawLogo(ctx) {
  ctx.clearRect(0, 0, 512, 512);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 16;
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 180) * (60 * k - 90);
    const x = 256 + 150 * Math.cos(a);
    const y = 210 + 150 * Math.sin(a);
    if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = GOLD;
  ctx.fillRect(186, 170, 140, 100);
  ctx.fillStyle = '#0E1014';
  ctx.fillRect(214, 200, 24, 28);
  ctx.fillRect(274, 200, 24, 28);
  ctx.fillStyle = GOLD;
  ctx.font = font(52, 700);
  ctx.textAlign = 'center';
  ctx.fillText('TRADING OFFICE', 256, 452);
}

function addPlant(scene, x, z) {
  scene.add(box(0.55, 0.5, 0.55, material('#5A4A3C'), x, 0.25, z));
  const leaves = [
    [0.42, '#2E9E66', 0, 0.95, 0],
    [0.32, '#34AE70', 0.2, 1.25, 0.1],
    [0.3, '#2A9160', -0.18, 1.2, -0.08],
    [0.24, '#3CC17E', 0.02, 1.5, 0],
  ];
  for (const [radius, color, dx, y, dz] of leaves) {
    const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 0), material(color));
    bush.position.set(x + dx, y, z + dz);
    bush.castShadow = true;
    scene.add(bush);
  }
}

// ---------------------------------------------------------------------------
// Desks, each with two monitors that show the robot's own numbers
// ---------------------------------------------------------------------------

function buildDesk(scene, slot) {
  const group = new THREE.Group();
  group.position.set(slot.x, 0, slot.z);
  const top = material('#4B5260');
  const body = material('#343A44');
  group.add(box(2.5, 0.85, 1.1, body, 0, 0.425, 0));
  group.add(box(2.56, 0.06, 1.16, top, 0, 0.88, 0));
  const accentMat = new THREE.MeshBasicMaterial({ color: '#3A404B' });
  const accent = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.07, 0.02), accentMat);
  accent.position.set(0, 0.16, 0.56);
  group.add(accent);
  group.add(box(0.95, 0.03, 0.3, material('#5B6272'), 0, 0.925, 0.22));

  const screens = [-0.62, 0.62].map((x) => {
    group.add(box(0.12, 0.3, 0.08, body, x, 1.05, -0.3));
    group.add(box(1.12, 0.68, 0.07, material('#15181D'), x, 1.52, -0.32));
    const tex = canvasTexture(560, 340);
    const plane = screenPlane(1.02, 0.6, tex.texture);
    plane.position.set(x, 1.52, -0.28);
    group.add(plane);
    return tex;
  });

  // Chair, with its back toward the room.
  const chair = material('#2E343D');
  group.add(box(0.12, 0.45, 0.12, material('#1E2228'), 0, 0.225, 1.05));
  group.add(box(0.75, 0.1, 0.72, chair, 0, 0.5, 1.05));
  group.add(box(0.75, 0.62, 0.1, chair, 0, 0.86, 1.42));

  const freeEl = document.createElement('div');
  freeEl.className = 'tag free';
  freeEl.textContent = 'Free desk';
  const freeTag = new CSS2DObject(freeEl);
  freeTag.position.set(0, 2.3, 0);
  group.add(freeTag);

  scene.add(group);

  function drawOff(tex) {
    const { ctx, canvas } = tex;
    ctx.fillStyle = '#0B0E12';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    tex.texture.needsUpdate = true;
  }

  function drawMain(tex, robot, mood, color) {
    const { ctx, canvas } = tex;
    const W = canvas.width;
    const H = canvas.height;
    const s = robot.status || {};
    const currency = s.currency || 'USD';
    const positions = s.positions || [];
    const tint = MOODS[mood.key].color;
    const day = Number(s.day_pnl ?? 0);
    ctx.fillStyle = '#0A0E13';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#141A22';
    ctx.fillRect(0, 0, W, 64);
    ctx.textAlign = 'left';
    ctx.fillStyle = color;
    ctx.font = font(34, 700);
    ctx.fillText(fitText(ctx, robot.name, W * 0.5), 22, 44);
    ctx.textAlign = 'right';
    ctx.fillStyle = tint;
    ctx.font = font(26);
    ctx.fillText(MOODS[mood.key].label.toUpperCase(), W - 22, 42);
    ctx.textAlign = 'center';

    if (mood.key === 'planned') {
      ctx.fillStyle = MOODS.planned.color;
      ctx.font = font(52, 700);
      ctx.fillText(robot.assignment === 'analyst' ? 'AWAITING SETUP' : 'ROLE PLANNED', W / 2, 175);
      ctx.fillStyle = MUTED;
      ctx.font = font(25, 400);
      ctx.fillText(fitText(ctx, robot.assignment === 'analyst'
        ? 'Server schedule needed' : assignmentOf(robot).label + ' · no runtime yet', W - 42), W / 2, 240);
    } else if (mood.key === 'offline') {
      ctx.fillStyle = RED;
      ctx.font = font(64, 700);
      ctx.fillText('OFFLINE', W / 2, 190);
      ctx.fillStyle = MUTED;
      ctx.font = font(26, 400);
      ctx.fillText(robot.assignment === 'analyst' ? 'No report from the news watcher' : 'No report from MetaTrader', W / 2, 250);
    } else if (robot.assignment === 'analyst') {
      ctx.fillStyle = MOODS.analyst.color;
      ctx.font = font(47, 700);
      ctx.fillText('NEWS WATCH', W / 2, 138);
      ctx.fillStyle = INK;
      ctx.font = font(27);
      ctx.fillText(`${s.healthy_feeds ?? 0}/${s.total_feeds ?? 5} sources online`, W / 2, 196);
      ctx.fillStyle = MUTED;
      ctx.font = font(22, 400);
      ctx.fillText(fitText(ctx, s.headlines?.[0]?.title || 'Waiting for headlines', W - 42), W / 2, 260);
    } else if (positions.length) {
      const p = positions[0];
      const pnl = Number(p.profit);
      ctx.fillStyle = p.side === 'buy' ? GREEN : RED;
      ctx.font = font(34, 700);
      ctx.fillText(`${String(p.side).toUpperCase()} ${p.volume} ${robot.symbol || ''}`, W / 2, 120);
      ctx.fillStyle = toneColor(pnl);
      ctx.font = font(84, 700);
      ctx.fillText(money(pnl, currency, true), W / 2, 215);
      ctx.fillStyle = MUTED;
      ctx.font = font(24, 400);
      ctx.fillText(`open ${p.open} · stop ${p.sl} · target ${p.tp}`, W / 2, 280);
    } else if (mood.key === 'standby' || mood.key === 'blocked') {
      ctx.fillStyle = tint;
      ctx.font = font(54, 700);
      ctx.fillText(fitText(ctx, mood.label.toUpperCase(), W - 40), W / 2, 150);
      ctx.fillStyle = INK;
      ctx.font = font(28, 400);
      const line = mood.key === 'blocked' ? 'Needs you: see its card' : mood.block?.back || 'Carries on by itself';
      ctx.fillText(fitText(ctx, line, W - 40), W / 2, 210);
      ctx.fillStyle = MUTED;
      ctx.font = font(26, 400);
      ctx.fillText(`Today ${money(day, currency, true)}`, W / 2, 272);
    } else {
      ctx.fillStyle = MUTED;
      ctx.font = font(26);
      ctx.fillText('TODAY', W / 2, 122);
      ctx.fillStyle = toneColor(day);
      ctx.font = font(84, 700);
      ctx.fillText(money(day, currency, true), W / 2, 210);
      ctx.fillStyle = MUTED;
      ctx.font = font(26, 400);
      const line = mood.key === 'active' ? 'Looking for a setup' : mood.key === 'done' ? 'Done for today' : 'Paused';
      ctx.fillText(line, W / 2, 272);
    }
    tex.texture.needsUpdate = true;
  }

  function drawLimits(tex, robot, mood) {
    const { ctx, canvas } = tex;
    const W = canvas.width;
    const H = canvas.height;
    const s = robot.status || {};
    const currency = s.currency || 'USD';
    ctx.fillStyle = '#0A0E13';
    ctx.fillRect(0, 0, W, H);
    if (mood.key === 'planned') {
      ctx.textAlign = 'center';
      ctx.fillStyle = MOODS.planned.color;
      ctx.font = font(32, 700);
      ctx.fillText(assignmentOf(robot).label.toUpperCase(), W / 2, 130);
      ctx.fillStyle = MUTED;
      ctx.font = font(23, 400);
      ctx.fillText('No account or agent connected', W / 2, 205);
      tex.texture.needsUpdate = true;
      return;
    }
    if (robot.assignment === 'analyst') {
      ctx.textAlign = 'left';
      ctx.fillStyle = MOODS.analyst.color;
      ctx.font = font(27, 700);
      ctx.fillText('USD CALENDAR', 24, 44);
      const upcoming = Array.isArray(s.upcoming) ? s.upcoming : [];
      if (!upcoming.length) {
        ctx.fillStyle = MUTED;
        ctx.font = font(23, 400);
        ctx.fillText('No upcoming USD events in the feed', 24, 125);
      }
      upcoming.slice(0, 4).forEach((item, i) => {
        const at = new Date(item.event_at);
        const time = Number.isFinite(at.getTime()) ? at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
        ctx.fillStyle = item.importance === 'High' ? GOLD : INK;
        ctx.font = font(22, 600);
        ctx.fillText(fitText(ctx, `${time}  ${item.title}`, W - 48), 24, 102 + i * 50);
      });
      ctx.fillStyle = MUTED;
      ctx.font = font(20, 400);
      ctx.fillText('Read-only · Trader uses its own MT5 news guard', 24, 305);
      tex.texture.needsUpdate = true;
      return;
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = GOLD;
    ctx.font = font(26, 700);
    ctx.fillText('FTMO LIMITS', 24, 44);
    ctx.fillStyle = INK;
    ctx.font = font(24, 400);
    ctx.fillText(`Daily loss used ${Math.round(Number(s.daily_used_pct) || 0)}%`, 24, 94);
    bar(ctx, 24, 106, W - 48, 16, s.daily_used_pct);
    ctx.fillText(`Max loss used ${Math.round(Number(s.max_used_pct) || 0)}%`, 24, 160);
    bar(ctx, 24, 172, W - 48, 16, s.max_used_pct);
    ctx.fillStyle = MUTED;
    ctx.fillText(`Equity ${money(s.equity, currency)} · trades today ${s.trades_today ?? 0}`, 24, 230);
    const note = mood.key === 'offline' ? 'Waiting for MetaTrader'
      : (s.blocks || [])[0] ? `Holding back: ${(s.blocks || [])[0]}`
        : s.last_action || 'Ready';
    ctx.fillStyle = '#6F7682';
    ctx.font = font(22, 400);
    ctx.fillText(fitText(ctx, note, W - 48), 24, 290);
    tex.texture.needsUpdate = true;
  }

  // The robot's closed trades of the last 7 days, as a running total.
  function drawHistory(tex, robot, history) {
    const { ctx, canvas } = tex;
    const W = canvas.width;
    const H = canvas.height;
    const currency = robot.status?.currency || 'USD';
    const trades = history.trades;
    ctx.fillStyle = '#0A0E13';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'left';
    ctx.fillStyle = GOLD;
    ctx.font = font(26, 700);
    ctx.fillText('LAST 7 DAYS', 24, 44);
    ctx.textAlign = 'right';
    ctx.fillStyle = trades.length ? toneColor(history.total) : MUTED;
    ctx.font = font(34, 700);
    ctx.fillText(trades.length ? money(history.total, currency, true) : '—', W - 24, 46);
    if (!trades.length) {
      ctx.textAlign = 'center';
      ctx.fillStyle = MUTED;
      ctx.font = font(26, 400);
      ctx.fillText('No closed trades yet', W / 2, 196);
      tex.texture.needsUpdate = true;
      return;
    }
    const points = [0];
    for (const trade of trades) points.push(points[points.length - 1] + trade.net);
    const [x0, x1, y0, y1] = [28, W - 28, 84, 250];
    const low = Math.min(0, ...points);
    const high = Math.max(0, ...points);
    const span = high - low || 1;
    const X = (i) => x0 + (i * (x1 - x0)) / Math.max(1, points.length - 1);
    const Y = (v) => y0 + ((high - v) * (y1 - y0)) / span;
    ctx.strokeStyle = '#2A2F38';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(x0, Y(0));
    ctx.lineTo(x1, Y(0));
    ctx.stroke();
    ctx.setLineDash([]);
    const color = points[points.length - 1] >= 0 ? GREEN : RED;
    ctx.beginPath();
    points.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.lineTo(X(points.length - 1), Y(0));
    ctx.lineTo(X(0), Y(0));
    ctx.closePath();
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
    trades.forEach((trade, i) => {
      ctx.fillStyle = trade.net >= 0 ? GREEN : RED;
      ctx.beginPath();
      ctx.arc(X(i + 1), Y(points[i + 1]), 6, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.textAlign = 'left';
    ctx.fillStyle = MUTED;
    ctx.font = font(24, 400);
    ctx.fillText(`${trades.length} trade${trades.length === 1 ? '' : 's'} · ${history.wins} won · ${trades.length - history.wins} lost`, 24, 300);
    tex.texture.needsUpdate = true;
  }

  screens.forEach(drawOff);

  return {
    slot,
    setVisible(on) {
      group.visible = on;
    },
    assign(robot, color, mood, history) {
      freeTag.visible = !robot;
      if (!robot) {
        accentMat.color.set('#3A404B');
        screens.forEach(drawOff);
        return;
      }
      accentMat.color.set(color);
      drawMain(screens[0], robot, mood, color);
      // The right-hand monitor takes turns: FTMO limits, then the last 7 days.
      if (robot.assignment !== 'analyst' && history && Math.floor(Date.now() / 10_000) % 2 === 1) drawHistory(screens[1], robot, history);
      else drawLimits(screens[1], robot, mood);
    },
  };
}

// ---------------------------------------------------------------------------
// Robots: boxes and joints, animated by hand
// ---------------------------------------------------------------------------

function buildRobot(color, gear, eyes) {
  const bodyMat = material(color);
  const darkMat = material('#14171C');
  const eyeMat = new THREE.MeshBasicMaterial({ color: eyes });
  const lampMat = new THREE.MeshBasicMaterial({ color: GOLD });

  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = 0.55;
  root.add(hips);

  const leg = (x) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0, 0);
    pivot.add(box(0.22, 0.55, 0.24, darkMat, 0, -0.275, 0));
    hips.add(pivot);
    return pivot;
  };
  const legL = leg(-0.18);
  const legR = leg(0.18);

  hips.add(box(0.82, 0.72, 0.56, bodyMat, 0, 0.36, 0));
  hips.add(box(0.46, 0.26, 0.02, darkMat, 0, 0.44, 0.29));

  const arm = (x) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.64, 0);
    pivot.add(box(0.17, 0.56, 0.19, bodyMat, 0, -0.26, 0));
    hips.add(pivot);
    return pivot;
  };
  const armL = arm(-0.51);
  const armR = arm(0.51);

  const head = new THREE.Group();
  head.position.y = 0.74;
  hips.add(head);
  head.add(box(0.74, 0.58, 0.6, bodyMat, 0, 0.29, 0));
  head.add(box(0.58, 0.22, 0.02, darkMat, 0, 0.31, 0.31));
  for (const x of [-0.14, 0.14]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.02), eyeMat);
    eye.position.set(x, 0.31, 0.325);
    head.add(eye);
  }
  head.add(box(0.1, 0.2, 0.2, bodyMat, -0.42, 0.3, 0));
  head.add(box(0.1, 0.2, 0.2, bodyMat, 0.42, 0.3, 0));
  head.add(box(0.04, 0.24, 0.04, darkMat, 0, 0.7, 0));
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.08, 14, 10), lampMat);
  lamp.position.y = 0.85;
  head.add(lamp);

  // A coffee cup in the right hand, only at the coffee bar.
  const cup = new THREE.Group();
  cup.add(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.062, 0.15, 14), material('#EDEAE3')));
  const coffee = new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.066, 0.01, 14), new THREE.MeshBasicMaterial({ color: '#4A2F1E' }));
  coffee.position.y = 0.072;
  cup.add(coffee);
  cup.position.set(0, -0.56, 0.08);
  cup.visible = false;
  armR.add(cup);

  addGear(gear, color, head, hips);

  return { root, hips, legL, legR, armL, armR, head, lamp, cup, bodyMat, eyeMat,
    baseColor: new THREE.Color(color), seed: Math.random() * 10 };
}

function addGear(gear, color, head, hips) {
  const dark = material('#262B33');
  if (gear === 'headset') {
    head.add(box(0.86, 0.07, 0.12, dark, 0, 0.64, 0));
    for (const side of [-1, 1]) {
      head.add(box(0.07, 0.3, 0.12, dark, side * 0.45, 0.5, 0));
      head.add(box(0.13, 0.28, 0.28, dark, side * 0.47, 0.3, 0));
    }
    head.add(box(0.04, 0.04, 0.3, dark, -0.47, 0.17, 0.2));
    const mic = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: GREEN }));
    mic.position.set(-0.44, 0.17, 0.36);
    head.add(mic);
  } else if (gear === 'cap') {
    const cap = material('#2B3445');
    head.add(box(0.8, 0.14, 0.66, cap, 0, 0.65, 0));
    head.add(box(0.62, 0.04, 0.32, cap, 0, 0.6, 0.46));
  } else if (gear === 'tie') {
    const tie = material('#C8453C');
    hips.add(box(0.12, 0.08, 0.04, tie, 0, 0.66, 0.3));
    hips.add(box(0.14, 0.36, 0.03, tie, 0, 0.42, 0.31));
  } else if (gear === 'visor') {
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.17, 0.05),
      new THREE.MeshBasicMaterial({ color: '#5CF2FF', transparent: true, opacity: 0.85 }));
    visor.position.set(0, 0.31, 0.33);
    head.add(visor);
  } else if (gear === 'antennas') {
    for (const side of [-1, 1]) {
      const stalk = box(0.035, 0.3, 0.035, dark, side * 0.24, 0.72, 0);
      stalk.rotation.z = -side * 0.35;
      head.add(stalk);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), material(color));
      ball.position.set(side * 0.3, 0.87, 0);
      head.add(ball);
    }
  } else if (gear === 'glasses') {
    for (const x of [-0.14, 0.14]) head.add(box(0.22, 0.17, 0.05, dark, x, 0.31, 0.36));
    head.add(box(0.12, 0.04, 0.06, dark, 0, 0.32, 0.37));
  } else if (gear === 'crown') {
    const crown = material('#E3A82B');
    head.add(box(0.62, 0.12, 0.5, crown, 0, 0.65, 0));
    for (const x of [-0.22, 0, 0.22]) head.add(box(0.1, 0.21, 0.1, crown, x, 0.81, 0));
  } else if (gear === 'badge') {
    hips.add(box(0.25, 0.18, 0.05, material('#E3A82B'), 0.28, 0.48, 0.33));
  }
}

function applyPose(model, pose, t) {
  const { legL, legR, armL, armR, head, hips, cup } = model;
  head.rotation.set(0, 0, 0);
  armL.rotation.set(0, 0, 0);
  armR.rotation.set(0, 0, 0);
  hips.position.y = 0.55;
  cup.visible = pose === 'sip';
  if (pose === 'walk') {
    const s = Math.sin(t * 9);
    legL.rotation.x = s * 0.6;
    legR.rotation.x = -s * 0.6;
    armL.rotation.x = -s * 0.5;
    armR.rotation.x = s * 0.5;
    hips.position.y = 0.55 + Math.abs(Math.cos(t * 9)) * 0.05;
    return;
  }
  if (pose === 'sip') {
    // Standing at the coffee bar, with a sip every few seconds.
    legL.rotation.x = 0;
    legR.rotation.x = 0;
    const phase = (t + model.seed) % 7;
    const lift = phase < 1.6 ? Math.sin((phase / 1.6) * Math.PI) : 0;
    armL.rotation.x = -0.12;
    armR.rotation.x = -1.15 - 1.2 * lift;
    cup.rotation.x = -armR.rotation.x;
    head.rotation.x = -0.2 * lift;
    head.rotation.y = (1 - lift) * Math.sin(t * 0.45 + model.seed) * 0.4;
    hips.position.y = 0.55 + Math.sin(t * 1.1 + model.seed) * 0.01;
    return;
  }
  // Every other pose is seated: legs forward.
  legL.rotation.x = -Math.PI / 2;
  legR.rotation.x = -Math.PI / 2;
  if (pose === 'type') {
    armL.rotation.x = -1.25 + Math.sin(t * 18) * 0.12;
    armR.rotation.x = -1.25 + Math.sin(t * 18 + 1.7) * 0.12;
    head.rotation.x = 0.12;
  } else if (pose === 'watch') {
    armL.rotation.x = -1.05;
    armR.rotation.x = -1.05;
    head.rotation.y = Math.sin(t * 0.7) * 0.25;
  } else if (pose === 'puzzled') {
    // Scratching its head: something outside the robot stops it trading.
    armL.rotation.x = -1.05;
    armR.rotation.x = -2.5 + Math.sin(t * 6) * 0.08;
    head.rotation.z = Math.sin(t * 1.8) * 0.18;
  } else if (pose === 'rest') {
    armL.rotation.x = -0.1;
    armR.rotation.x = -0.1;
    head.rotation.z = Math.sin(t * 0.9) * 0.06;
    hips.position.y = 0.55 + Math.sin(t * 1.4) * 0.015;
  } else if (pose === 'sleep') {
    armL.rotation.x = -0.9;
    armR.rotation.x = -0.9;
    head.rotation.x = 0.55;
  }
}

function lerpAngle(a, b, k) {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * k;
}

// Where a robot sits or stands, and the point in the aisle it walks in from.
function deskSpot(slot) {
  return { x: slot.x, z: slot.z + 1.05, facing: Math.PI, y: 0, approach: { x: slot.x, z: slot.z + 2.0 } };
}

function loungeSpot(seat) {
  return { x: seat.x, z: seat.z, facing: 0, y: -0.1, approach: { x: seat.x, z: seat.z + 0.87 } };
}

function coffeeSpot(spot) {
  return { x: spot.x, z: spot.z, facing: 0, y: 0, approach: { x: spot.x, z: 3.0 } };
}

function placeFor(mood, i) {
  const desk = deskSpot(DESK_SLOTS[i]);
  switch (mood.key) {
    case 'offline': return { spot: desk, pose: 'sleep' };
    case 'trade': return { spot: desk, pose: 'type' };
    case 'active': return { spot: desk, pose: 'watch' };
    case 'analyst': return { spot: desk, pose: 'type' };
    case 'blocked': return { spot: desk, pose: 'puzzled' };
    case 'standby': return { spot: coffeeSpot(COFFEE_SPOTS[i % COFFEE_SPOTS.length]), pose: 'sip' };
    case 'planned': return { spot: loungeSpot(LOUNGE_SEATS[i % LOUNGE_SEATS.length]), pose: 'rest' };
    default: // paused or done for today: a trade still open keeps it at its desk
      return mood.inTrade ? { spot: desk, pose: 'watch' }
        : { spot: loungeSpot(LOUNGE_SEATS[i % LOUNGE_SEATS.length]), pose: 'rest' };
  }
}

// ---------------------------------------------------------------------------
// The office
// ---------------------------------------------------------------------------

export function createOfficeScene(container, { onSelect, onTour, getInsets }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'scene-labels';
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0B0D11');

  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 200);
  camera.position.copy(HOME.target).add(HOME.offset);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(HOME.target);
  controls.enableDamping = true;
  controls.minZoom = 0.7;
  controls.maxZoom = 2.8;
  controls.minPolarAngle = 0.55;
  controls.maxPolarAngle = 1.2;
  controls.minAzimuthAngle = 0.2;
  controls.maxAzimuthAngle = 1.35;
  controls.update();

  scene.add(new THREE.HemisphereLight('#C9D3FF', '#1A1C20', 1.4));
  scene.add(new THREE.AmbientLight('#FFFFFF', 0.35));
  const sun = new THREE.DirectionalLight('#FFF1DD', 2.4);
  sun.position.set(9, 16, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 65 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);

  const room = buildRoom(scene);
  room.drawClocks();
  const clockTimer = setInterval(room.drawClocks, 20_000);
  const desks = DESK_SLOTS.map((slot) => buildDesk(scene, slot));

  const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.74, 40), new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.9 }));
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);

  const actors = new Map();
  let order = [];          // robot ids by name, for the tour
  let selectedId = null;   // the robot whose card is open
  let tourId = null;       // the robot the tour is showing
  let tourTimer = null;
  let cam = null;          // where the camera is gliding: { follow, zoom } or { target, offset, zoom }

  const spotlightId = () => selectedId ?? tourId;

  function createActor(id, index) {
    const tagEl = document.createElement('div');
    tagEl.className = 'tag';
    tagEl.addEventListener('click', (e) => { e.stopPropagation(); onSelect(id); });
    const tag = new CSS2DObject(tagEl);
    const tagY = 2.05 + (index % 2) * 0.5; // alternate heights so neighbours' tags don't overlap
    tag.position.set(0, tagY, 0);

    // What the robot just did, in a speech bubble above its name tag.
    const bubbleEl = document.createElement('div');
    bubbleEl.className = 'bubble';
    const bubble = new CSS2DObject(bubbleEl);
    bubble.center.set(0.5, 1);
    bubble.position.set(0, tagY + 0.28, 0);
    bubble.visible = false;
    let bubbleUntil = 0;

    let model = null;
    let look = null;
    let pos = null;
    let spot = null;
    let path = [];
    let pose = 'watch';
    let moodKey = 'paused';

    function paint() {
      model.lamp.material.color.set(MOODS[moodKey].color);
      model.bodyMat.color.copy(moodKey === 'offline' ? OFFLINE_BODY : model.baseColor);
      model.eyeMat.color.set(moodKey === 'offline' ? '#3A404B' : look?.eyes || '#9FE8FF');
    }

    return {
      get color() { return look?.color; },
      get position() { return pos; },
      setLook(next) {
        if (look && look.color === next.color && look.gear === next.gear && look.eyes === next.eyes) return;
        const old = model;
        model = buildRobot(next.color, next.gear, next.eyes);
        model.root.traverse((o) => { o.userData.robotId = id; });
        model.hips.add(tag, bubble);
        if (old) {
          model.root.position.copy(old.root.position);
          model.root.rotation.y = old.root.rotation.y;
          scene.remove(old.root);
          disposeTree(old.root);
        }
        scene.add(model.root);
        look = next;
        paint();
      },
      setTarget(next, nextPose) {
        pose = nextPose;
        if (!pos) {
          pos = new THREE.Vector3(next.x, 0, next.z);
          model.root.position.set(next.x, next.y, next.z);
          model.root.rotation.y = next.facing;
          spot = next;
          return;
        }
        if (spot && Math.abs(spot.x - next.x) < 0.01 && Math.abs(spot.z - next.z) < 0.01) {
          spot = next;
          return;
        }
        const walking = path.length > 0;
        const start = walking || !spot ? { x: pos.x, z: pos.z } : spot.approach;
        path = [
          ...(walking || !spot ? [] : [spot.approach]),
          // Changing aisles goes by the corridor between the lounge and the desks.
          ...(Math.abs(start.z - next.approach.z) > 0.6
            ? [{ x: CORRIDOR_X, z: start.z }, { x: CORRIDOR_X, z: next.approach.z }] : []),
          next.approach,
          { x: next.x, z: next.z },
        ];
        spot = next;
      },
      setMood(mood, robot, lit) {
        moodKey = mood.key;
        paint();
        const s = robot.status || {};
        const pnl = Number(s.day_pnl);
        const pnlHtml = Number.isFinite(pnl)
          ? `<span class="pnl ${pnl > 0 ? 'up' : pnl < 0 ? 'down' : ''}">${money(pnl, s.currency || 'USD', true)}</span>` : '';
        tagEl.innerHTML = `<span class="dot" style="background:${MOODS[moodKey].color}"></span><b>${esc(robot.name)}</b><span class="st">${esc(mood.label)}</span>${pnlHtml}`;
        tagEl.classList.toggle('selected', lit);
      },
      spotlight(lit) {
        tagEl.classList.toggle('selected', lit);
      },
      say(text, tone = 'info') {
        bubbleEl.innerHTML = `<span class="${esc(tone)}">${esc(text)}</span>`;
        bubble.visible = true;
        bubbleUntil = performance.now() + BUBBLE_MS;
      },
      step(dt, t) {
        if (bubble.visible && performance.now() > bubbleUntil) bubble.visible = false;
        if (!pos) return;
        let current = pose;
        let y = spot ? spot.y : 0;
        let facing = spot ? spot.facing : model.root.rotation.y;
        if (path.length) {
          const next = path[0];
          const dx = next.x - pos.x;
          const dz = next.z - pos.z;
          const dist = Math.hypot(dx, dz);
          const stride = WALK_SPEED * dt;
          if (dist <= stride) {
            pos.x = next.x;
            pos.z = next.z;
            path.shift();
          } else {
            pos.x += (dx / dist) * stride;
            pos.z += (dz / dist) * stride;
          }
          if (dist > 0.001) facing = Math.atan2(dx, dz);
          current = 'walk';
          y = 0;
        }
        model.root.position.set(pos.x, y, pos.z);
        model.root.rotation.y = lerpAngle(model.root.rotation.y, facing, Math.min(1, dt * 10));
        applyPose(model, current, t);
        const blinking = moodKey === 'offline' || moodKey === 'blocked';
        model.lamp.visible = !blinking || Math.sin(t * 5) > -0.2;
      },
      dispose() {
        scene.remove(model.root);
        disposeTree(model.root);
        tagEl.remove();
        bubbleEl.remove();
      },
    };
  }

  function update({ robots, selected, history, latest }) {
    const now = Date.now();
    selectedId = selected ?? null;
    const sorted = [...robots].sort((a, b) => a.name.localeCompare(b.name)).slice(0, DESK_SLOTS.length);
    order = sorted.map((r) => r.id);

    for (const [id, actor] of actors) {
      if (!order.includes(id)) {
        actor.dispose();
        actors.delete(id);
      }
    }

    const deskCount = Math.min(DESK_SLOTS.length, Math.max(4, sorted.length));
    desks.forEach((desk, i) => desk.setVisible(i < deskCount));

    const moods = sorted.map((robot) => moodOf(robot, now));
    sorted.forEach((robot, i) => {
      let actor = actors.get(robot.id);
      if (!actor) {
        actor = createActor(robot.id, i);
        actors.set(robot.id, actor);
      }
      const look = lookOf(robot, i);
      actor.setLook(look);
      const place = placeFor(moods[i], i);
      actor.setTarget(place.spot, place.pose);
      actor.setMood(moods[i], robot, robot.id === spotlightId());
      desks[i].assign(robot, look.color, moods[i], history?.(robot.id));
    });
    for (let i = sorted.length; i < desks.length; i++) desks[i].assign(null);

    drawWall(room.wall, sorted, moods, history, latest);
  }

  function drawWall(tex, robots, moods, history, latest) {
    const { ctx, canvas } = tex;
    const W = canvas.width;
    const H = canvas.height;
    ctx.fillStyle = '#080A0D';
    ctx.fillRect(0, 0, W, H);
    const currency = robots.find((r) => r.status?.currency)?.status.currency || 'USD';
    const total = robots.reduce((sum, r) => sum + (Number(r.status?.day_pnl) || 0), 0);
    ctx.textAlign = 'left';
    ctx.fillStyle = GOLD;
    ctx.font = font(34, 700);
    ctx.fillText('TRADING OFFICE · TODAY', 40, 62);
    ctx.fillStyle = toneColor(total);
    ctx.font = font(124, 700);
    ctx.fillText(money(total, currency, true), 40, 192);
    ctx.fillStyle = MUTED;
    ctx.font = font(30, 400);
    const online = moods.filter((m) => m.key !== 'offline' && m.key !== 'planned').length;
    const trading = moods.filter((m) => m.inTrade && m.key !== 'offline').length;
    ctx.fillText(`${robots.length} robot${robots.length === 1 ? '' : 's'} · ${online} online · ${trading} in a trade`, 40, 246);

    // The last 7 days, from the trades the robots reported.
    const weeks = robots.map((r) => history?.(r.id)).filter(Boolean);
    const weekTrades = weeks.reduce((sum, w) => sum + w.trades.length, 0);
    const weekTotal = weeks.reduce((sum, w) => sum + w.total, 0);
    const weekWins = weeks.reduce((sum, w) => sum + w.wins, 0);
    runs(ctx, 40, 304, weekTrades
      ? [['Last 7 days  ', MUTED, font(30, 400)], [money(weekTotal, currency, true), toneColor(weekTotal), font(30, 700)],
        [`  ·  ${weekTrades} trade${weekTrades === 1 ? '' : 's'} · ${weekWins} won`, MUTED, font(30, 400)]]
      : [['Last 7 days  ', MUTED, font(30, 400)], ['no closed trades yet', MUTED, font(30, 400)]]);

    ctx.textAlign = 'right';
    ctx.fillStyle = MUTED;
    ctx.font = font(30, 400);
    ctx.fillText(`Prague ${pragueClock()}`, W - 40, 62);

    // One row per robot on the right.
    robots.slice(0, 4).forEach((r, i) => {
      const y = 124 + i * 56;
      const mood = moods[i];
      ctx.fillStyle = MOODS[mood.key].color;
      ctx.beginPath();
      ctx.arc(770, y - 10, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.textAlign = 'left';
      ctx.fillStyle = INK;
      ctx.font = font(32, 700);
      ctx.fillText(fitText(ctx, r.name, 210), 792, y);
      ctx.fillStyle = MUTED;
      ctx.font = font(26, 400);
      ctx.fillText(fitText(ctx, mood.label, 190), 1012, y);
      const pnl = Number(r.status?.day_pnl) || 0;
      ctx.textAlign = 'right';
      ctx.fillStyle = toneColor(pnl);
      ctx.font = font(30, 700);
      ctx.fillText(money(pnl, r.status?.currency || currency, true), W - 40, y);
    });
    if (robots.length > 4) {
      ctx.textAlign = 'left';
      ctx.fillStyle = MUTED;
      ctx.font = font(24, 400);
      ctx.fillText(`+${robots.length - 4} more`, 792, 124 + 4 * 56);
    }

    // The latest thing any robot did, along the bottom.
    ctx.fillStyle = '#10141A';
    ctx.fillRect(0, 368, W, H - 368);
    if (latest) {
      const x = runs(ctx, 40, 418, [
        ['LATEST  ', GOLD, font(26, 700)],
        [`${pragueClock(new Date(latest.at))}  `, MUTED, font(28, 400)],
        [`${latest.name}  `, INK, font(28, 700)],
      ]);
      ctx.fillStyle = MUTED;
      ctx.font = font(28, 400);
      ctx.fillText(fitText(ctx, latest.message, W - 40 - x), x, 418);
    }
    tex.texture.needsUpdate = true;
  }

  // ---------------------------------------------------------------------------
  // Camera: follow a robot, the tour, and back to the whole office
  // ---------------------------------------------------------------------------

  const goal = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();

  // Keeps a followed robot in the part of the view the robot's card doesn't cover.
  function clearOfPanel(point) {
    const inset = getInsets?.() || {};
    const h = container.clientHeight;
    if (!h || (!inset.right && !inset.bottom)) return;
    const perPx = (camera.top - camera.bottom) / camera.zoom / h;
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    point.addScaledVector(right, ((inset.right || 0) / 2) * perPx).addScaledVector(up, -((inset.bottom || 0) / 2) * perPx);
  }

  function glide(dt) {
    if (!cam) return;
    if (cam.follow) {
      const actor = actors.get(cam.follow);
      if (!actor?.position) {
        cam = null;
        return;
      }
      goal.set(actor.position.x, 1.0, actor.position.z);
      clearOfPanel(goal);
    } else {
      goal.copy(cam.target);
    }
    const k = 1 - Math.exp(-dt * 3.2);
    const offset = camera.position.clone().sub(controls.target);
    if (cam.offset) offset.lerp(cam.offset, k);
    controls.target.lerp(goal, k);
    camera.position.copy(controls.target).add(offset);
    camera.zoom += (cam.zoom - camera.zoom) * k;
    camera.updateProjectionMatrix();
    if (!cam.follow && controls.target.distanceTo(goal) < 0.01 && Math.abs(camera.zoom - cam.zoom) < 0.003
      && (!cam.offset || offset.distanceTo(cam.offset) < 0.02)) cam = null;
  }

  function refreshSpotlight() {
    for (const [id, actor] of actors) actor.spotlight(id === spotlightId());
  }

  function focus(id) {
    endTour();
    cam = { follow: id, zoom: Math.max(camera.zoom, 1.6) };
  }

  function home() {
    cam = { target: HOME.target.clone(), offset: HOME.offset.clone(), zoom: HOME.zoom };
  }

  function startTour() {
    endTour();
    let stop = -1;
    const next = () => {
      stop = (stop + 1) % (order.length + 1);
      tourId = order[stop] ?? null; // the last stop is the whole office
      if (tourId) cam = { follow: tourId, zoom: 1.9 };
      else home();
      refreshSpotlight();
    };
    next();
    tourTimer = setInterval(next, TOUR_STOP_MS);
    onTour?.(true);
  }

  function endTour() {
    if (!tourTimer) return;
    clearInterval(tourTimer);
    tourTimer = null;
    tourId = null;
    refreshSpotlight();
    onTour?.(false);
  }

  // Dragging or zooming by hand takes the camera back.
  controls.addEventListener('start', () => {
    cam = null;
    endTour();
  });

  // Clicking a robot (not dragging the view) selects it.
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(scene.children, true).find((h) => h.object.userData.robotId);
    onSelect(hit ? hit.object.userData.robotId : null);
  });

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
    const half = w < 700 ? 16.5 : 11.1;
    const aspect = w / h;
    camera.left = -half * aspect;
    camera.right = half * aspect;
    camera.top = half;
    camera.bottom = -half;
    camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);

  const clock = new THREE.Clock();
  let running = false;
  function tick() {
    // Up to a quarter second per frame, so robots keep walking at the right
    // pace even when the browser throttles a background tab.
    const dt = Math.min(clock.getDelta(), 0.25);
    const t = clock.elapsedTime;
    for (const actor of actors.values()) actor.step(dt, t);
    glide(dt);
    const lit = spotlightId() && actors.get(spotlightId());
    ring.visible = !!(lit && lit.position);
    if (ring.visible) {
      ring.position.set(lit.position.x, 0.03, lit.position.z);
      ring.rotation.z = t * 0.8;
    }
    room.blink(t);
    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }

  return {
    update,
    say(id, text, tone) {
      actors.get(id)?.say(text, tone);
    },
    focus,
    home,
    tour(on) {
      if (on) {
        startTour();
      } else {
        endTour();
        home();
      }
    },
    setActive(on) {
      if (on === running) return;
      running = on;
      labelRenderer.domElement.style.display = on ? '' : 'none';
      if (on) {
        resize();
        clock.getDelta();
      } else {
        endTour();
      }
      renderer.setAnimationLoop(on ? tick : null);
    },
    dispose() {
      renderer.setAnimationLoop(null);
      endTour();
      clearInterval(clockTimer);
      observer.disconnect();
      renderer.dispose();
    },
  };
}
