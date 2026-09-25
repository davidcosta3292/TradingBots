// The Trading Office in 3D.
// One desk per robot. A robot sits at its desk while it works or holds a trade,
// and walks to the lounge when it is paused or done for the day. An offline
// robot dozes at its desk with a red lamp. Every screen shows only what the
// robots themselves report.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const OFFLINE_AFTER_MS = 75_000;
const ROOM = { w: 16, d: 12, h: 4.2 };
const CORRIDOR_X = -1.5;
const WALK_SPEED = 2.6;
const GOLD = '#E3A82B';
const GREEN = '#3DDC84';
const RED = '#F06A5F';
const ROBOT_COLORS = ['#E3A82B', '#3FB6C8', '#E0679B', '#7BD389', '#8A6CF0', '#F08A4B'];
const MOODS = {
  trade: { label: 'In a trade', lamp: GREEN },
  active: { label: 'Working', lamp: '#83A6F4' },
  paused: { label: 'Paused', lamp: GOLD },
  done: { label: 'Done for today', lamp: '#9097A3' },
  offline: { label: 'Offline', lamp: RED },
};
// Filled in order: back row first, then the front row, then a third column.
const DESK_SLOTS = [
  { x: 1.1, z: -3.3 }, { x: 4.0, z: -3.3 },
  { x: 1.1, z: 1.0 }, { x: 4.0, z: 1.0 },
  { x: 6.8, z: -3.3 }, { x: 6.8, z: 1.0 },
];
// One sofa seat per robot, so nobody shuffles over when another sits down.
const LOUNGE_SEATS = [-6.6, -5.35, -4.1, -2.85].map((x) => ({ x, z: 1.75 }));

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function money(value, currency = 'USD', signed = false) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const text = new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Math.abs(n));
  if (!signed) return (n < 0 ? '−' : '') + text;
  return (n > 0 ? '+' : n < 0 ? '−' : '') + text;
}

function moodOf(robot, now) {
  const online = robot.last_report_at && now - Date.parse(robot.last_report_at) < OFFLINE_AFTER_MS;
  if (!online) return 'offline';
  const inTrade = (robot.status?.positions || []).length > 0;
  if (robot.state === 'active') return inTrade ? 'trade' : 'active';
  return robot.state === 'done_today' ? 'done' : 'paused';
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
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture }));
  return mesh;
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

function bar(ctx, x, y, w, h, pct) {
  const value = Math.max(0, Math.min(100, Number(pct) || 0));
  ctx.fillStyle = '#1C2129';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = value >= 80 ? RED : value >= 50 ? GOLD : GREEN;
  ctx.fillRect(x, y, Math.max(3, (w * value) / 100), h);
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
  scene.add(box(7.4, 2.5, 0.12, material('#0A0C0F'), 3.2, 2.55, -d / 2 + 0.06));
  const wallScreen = screenPlane(7.2, 2.3, wall.texture);
  wallScreen.position.set(3.2, 2.55, -d / 2 + 0.125);
  scene.add(wallScreen);

  // Logo on the left wall.
  const logo = canvasTexture(512, 512);
  drawLogo(logo.ctx);
  logo.texture.needsUpdate = true;
  const logoPlane = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.3), new THREE.MeshBasicMaterial({ map: logo.texture, transparent: true }));
  logoPlane.position.set(-w / 2 + 0.02, 2.6, -3.2);
  logoPlane.rotation.y = Math.PI / 2;
  scene.add(logoPlane);

  // World clocks on the left wall: FTMO's day runs on Prague time.
  const cities = [['PRAGUE', 'Europe/Prague'], ['LONDON', 'Europe/London'], ['NEW YORK', 'America/New_York']];
  const clocks = cities.map(([name, zone], i) => {
    const tex = canvasTexture(320, 200);
    scene.add(box(0.06, 0.78, 1.18, material('#0A0C0F'), -w / 2 + 0.03, 2.75, 0.1 + i * 1.45));
    const plane = screenPlane(1.1, 0.7, tex.texture);
    plane.position.set(-w / 2 + 0.07, 2.75, 0.1 + i * 1.45);
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
  addPlant(scene, -2.2, -d / 2 + 0.6);

  // Lounge: rug, sofa, coffee table, and the word on the floor.
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 4.4), new THREE.MeshStandardMaterial({ color: '#2B2A24', roughness: 1 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(-4.8, 0.01, 3.0);
  rug.receiveShadow = true;
  scene.add(rug);
  const loungeText = canvasTexture(512, 128);
  loungeText.ctx.font = font(78, 700);
  loungeText.ctx.fillStyle = 'rgba(227,168,43,0.8)';
  loungeText.ctx.textAlign = 'center';
  loungeText.ctx.fillText('L O U N G E', 256, 92);
  loungeText.texture.needsUpdate = true;
  const loungeLabel = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), new THREE.MeshBasicMaterial({ map: loungeText.texture, transparent: true }));
  loungeLabel.rotation.x = -Math.PI / 2;
  loungeLabel.position.set(-4.8, 0.02, 4.75);
  scene.add(loungeLabel);
  const sofa = material('#3B4150');
  scene.add(box(5.2, 0.45, 1.0, sofa, -4.75, 0.225, 1.6));
  scene.add(box(5.2, 0.95, 0.3, material('#353B48'), -4.75, 0.62, 1.0));
  scene.add(box(0.3, 0.7, 1.3, sofa, -7.5, 0.35, 1.45));
  scene.add(box(0.3, 0.7, 1.3, sofa, -2.0, 0.35, 1.45));
  scene.add(box(2.0, 0.36, 0.9, material('#2F343E'), -4.8, 0.18, 3.35));

  function drawClocks() {
    for (const { name, zone, tex } of clocks) {
      const { ctx } = tex;
      ctx.fillStyle = '#0A0C0F';
      ctx.fillRect(0, 0, 320, 200);
      ctx.fillStyle = '#8F96A2';
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
    ctx.fillStyle = '#0A0E13';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#141A22';
    ctx.fillRect(0, 0, W, 64);
    ctx.textAlign = 'left';
    ctx.fillStyle = color;
    ctx.font = font(34, 700);
    ctx.fillText(fitText(ctx, robot.name, W * 0.55), 22, 44);
    ctx.textAlign = 'right';
    ctx.fillStyle = MOODS[mood].lamp;
    ctx.font = font(26);
    ctx.fillText(MOODS[mood].label.toUpperCase(), W - 22, 42);
    ctx.textAlign = 'center';

    if (mood === 'offline') {
      ctx.fillStyle = RED;
      ctx.font = font(64, 700);
      ctx.fillText('OFFLINE', W / 2, 190);
      ctx.fillStyle = '#8F96A2';
      ctx.font = font(26, 400);
      ctx.fillText('No report from MetaTrader', W / 2, 250);
    } else if (positions.length) {
      const p = positions[0];
      const pnl = Number(p.profit);
      ctx.fillStyle = p.side === 'buy' ? GREEN : RED;
      ctx.font = font(34, 700);
      ctx.fillText(`${String(p.side).toUpperCase()} ${p.volume} ${robot.symbol || ''}`, W / 2, 120);
      ctx.fillStyle = pnl > 0 ? GREEN : pnl < 0 ? RED : '#EDEBE6';
      ctx.font = font(84, 700);
      ctx.fillText(money(pnl, currency, true), W / 2, 215);
      ctx.fillStyle = '#8F96A2';
      ctx.font = font(24, 400);
      ctx.fillText(`open ${p.open} · stop ${p.sl} · target ${p.tp}`, W / 2, 280);
    } else {
      const day = Number(s.day_pnl ?? 0);
      ctx.fillStyle = '#8F96A2';
      ctx.font = font(26);
      ctx.fillText('TODAY', W / 2, 122);
      ctx.fillStyle = day > 0 ? GREEN : day < 0 ? RED : '#EDEBE6';
      ctx.font = font(84, 700);
      ctx.fillText(money(day, currency, true), W / 2, 210);
      ctx.fillStyle = '#8F96A2';
      ctx.font = font(26, 400);
      const line = mood === 'active' ? 'Waiting for a setup' : mood === 'done' ? 'Done for today' : 'Paused';
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
    ctx.textAlign = 'left';
    ctx.fillStyle = GOLD;
    ctx.font = font(26, 700);
    ctx.fillText('FTMO LIMITS', 24, 44);
    ctx.fillStyle = '#EDEBE6';
    ctx.font = font(24, 400);
    ctx.fillText(`Daily loss used ${Math.round(Number(s.daily_used_pct) || 0)}%`, 24, 94);
    bar(ctx, 24, 106, W - 48, 16, s.daily_used_pct);
    ctx.fillText(`Max loss used ${Math.round(Number(s.max_used_pct) || 0)}%`, 24, 160);
    bar(ctx, 24, 172, W - 48, 16, s.max_used_pct);
    ctx.fillStyle = '#8F96A2';
    ctx.fillText(`Equity ${money(s.equity, currency)} · trades today ${s.trades_today ?? 0}`, 24, 230);
    const note = mood === 'offline' ? 'Waiting for MetaTrader'
      : (s.blocks || [])[0] ? `Holding back: ${(s.blocks || [])[0]}`
        : s.last_action || 'Ready';
    ctx.fillStyle = '#6F7682';
    ctx.font = font(22, 400);
    ctx.fillText(fitText(ctx, note, W - 48), 24, 290);
    tex.texture.needsUpdate = true;
  }

  screens.forEach(drawOff);

  return {
    slot,
    setVisible(on) {
      group.visible = on;
      freeEl.style.display = on ? '' : 'none';
    },
    assign(robot, color, mood) {
      if (!robot) {
        accentMat.color.set('#3A404B');
        screens.forEach(drawOff);
        freeEl.style.display = group.visible ? '' : 'none';
        return;
      }
      accentMat.color.set(color);
      freeEl.style.display = 'none';
      drawMain(screens[0], robot, mood, color);
      drawLimits(screens[1], robot, mood);
    },
  };
}

// ---------------------------------------------------------------------------
// Robots: boxes and joints, animated by hand
// ---------------------------------------------------------------------------

function buildRobot(color) {
  const bodyMat = material(color);
  const darkMat = material('#14171C');
  const eyeMat = new THREE.MeshBasicMaterial({ color: '#9FE8FF' });
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

  return { root, hips, legL, legR, armL, armR, head, lamp, bodyMat, eyeMat, baseColor: new THREE.Color(color) };
}

function applyPose(model, pose, t) {
  const { legL, legR, armL, armR, head, hips } = model;
  head.rotation.set(0, 0, 0);
  hips.position.y = 0.55;
  if (pose === 'walk') {
    const s = Math.sin(t * 9);
    legL.rotation.x = s * 0.6;
    legR.rotation.x = -s * 0.6;
    armL.rotation.x = -s * 0.5;
    armR.rotation.x = s * 0.5;
    hips.position.y = 0.55 + Math.abs(Math.cos(t * 9)) * 0.05;
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

function deskSpot(slot) {
  return { x: slot.x, z: slot.z + 1.05, facing: Math.PI, y: 0, approach: { x: slot.x, z: slot.z + 2.0 } };
}

function loungeSpot(seat) {
  return { x: seat.x, z: seat.z, facing: 0, y: -0.1, approach: { x: seat.x, z: seat.z + 0.95 } };
}

// ---------------------------------------------------------------------------
// The office
// ---------------------------------------------------------------------------

export function createOfficeScene(container, { onSelect }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'scene-labels';
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0B0D11');

  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 200);
  camera.position.set(20, 18.5, 20);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0.2, 0.8, 0.2);
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
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 60 });
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
  let selectedId = null;

  function createActor(robot, color, index) {
    const model = buildRobot(color);
    model.root.traverse((o) => { o.userData.robotId = robot.id; });
    scene.add(model.root);

    const tagEl = document.createElement('div');
    tagEl.className = 'tag';
    tagEl.addEventListener('click', (e) => { e.stopPropagation(); onSelect(robot.id); });
    const tag = new CSS2DObject(tagEl);
    tag.position.set(0, 2.05 + (index % 2) * 0.5, 0); // alternate heights so neighbours' tags don't overlap
    model.hips.add(tag);

    let pos = null;
    let spot = null;
    let path = [];
    let pose = 'watch';
    let mood = 'paused';

    return {
      color,
      get position() { return pos; },
      setTarget(next, nextPose) {
        pose = nextPose;
        if (!pos) {
          pos = new THREE.Vector3(next.x, 0, next.z);
          model.root.rotation.y = next.facing;
          spot = next;
          return;
        }
        if (spot && Math.abs(spot.x - next.x) < 0.01 && Math.abs(spot.z - next.z) < 0.01) {
          spot = next;
          return;
        }
        const start = path.length || !spot ? { x: pos.x, z: pos.z } : spot.approach;
        path = [
          ...(path.length || !spot ? [] : [spot.approach]),
          { x: CORRIDOR_X, z: start.z },
          { x: CORRIDOR_X, z: next.approach.z },
          next.approach,
          { x: next.x, z: next.z },
        ];
        spot = next;
      },
      setMood(nextMood, robot, isSelected) {
        mood = nextMood;
        const m = MOODS[mood];
        model.lamp.material.color.set(m.lamp);
        model.bodyMat.color.copy(mood === 'offline' ? new THREE.Color('#5A5F68') : model.baseColor);
        model.eyeMat.color.set(mood === 'offline' ? '#3A404B' : '#9FE8FF');
        const s = robot.status || {};
        const inTrade = (s.positions || []).length > 0;
        const label = mood === 'paused' && inTrade ? 'Paused · trade open' : m.label;
        const pnl = Number(s.day_pnl);
        const pnlHtml = Number.isFinite(pnl)
          ? `<span class="pnl ${pnl > 0 ? 'up' : pnl < 0 ? 'down' : ''}">${money(pnl, s.currency || 'USD', true)}</span>` : '';
        tagEl.innerHTML = `<span class="dot" style="background:${m.lamp}"></span><b>${esc(robot.name)}</b><span class="st">${label}</span>${pnlHtml}`;
        tagEl.classList.toggle('selected', isSelected);
      },
      step(dt, t) {
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
        if (mood === 'offline') model.lamp.visible = Math.sin(t * 5) > -0.2;
        else model.lamp.visible = true;
      },
      dispose() {
        scene.remove(model.root);
        tagEl.remove();
      },
    };
  }

  function update({ robots, selected }) {
    const now = Date.now();
    selectedId = selected ?? null;
    const sorted = [...robots].sort((a, b) => a.name.localeCompare(b.name)).slice(0, DESK_SLOTS.length);

    for (const [id, actor] of actors) {
      if (!sorted.some((r) => r.id === id)) {
        actor.dispose();
        actors.delete(id);
      }
    }

    const deskCount = Math.min(DESK_SLOTS.length, Math.max(4, sorted.length));
    desks.forEach((desk, i) => desk.setVisible(i < deskCount));

    sorted.forEach((robot, i) => {
      let actor = actors.get(robot.id);
      if (!actor) {
        actor = createActor(robot, ROBOT_COLORS[i % ROBOT_COLORS.length], i);
        actors.set(robot.id, actor);
      }
      const mood = moodOf(robot, now);
      const inTrade = (robot.status?.positions || []).length > 0;
      const inLounge = (mood === 'paused' || mood === 'done') && !inTrade;
      const target = inLounge ? loungeSpot(LOUNGE_SEATS[i % LOUNGE_SEATS.length]) : deskSpot(DESK_SLOTS[i]);
      const pose = inLounge ? 'rest' : mood === 'offline' ? 'sleep' : inTrade ? 'type' : 'watch';
      actor.setTarget(target, pose);
      actor.setMood(mood, robot, robot.id === selectedId);
      desks[i].assign(robot, actor.color, mood);
    });
    for (let i = sorted.length; i < desks.length; i++) desks[i].assign(null);

    drawWall(room.wall, sorted, now);
  }

  function drawWall(tex, robots, now) {
    const { ctx, canvas } = tex;
    const W = canvas.width;
    const H = canvas.height;
    ctx.fillStyle = '#080A0D';
    ctx.fillRect(0, 0, W, H);
    const currency = robots.find((r) => r.status?.currency)?.status.currency || 'USD';
    const total = robots.reduce((sum, r) => sum + (Number(r.status?.day_pnl) || 0), 0);
    const moods = robots.map((r) => moodOf(r, now));
    ctx.textAlign = 'left';
    ctx.fillStyle = GOLD;
    ctx.font = font(34, 700);
    ctx.fillText('TRADING OFFICE · TODAY', 40, 66);
    ctx.fillStyle = total > 0 ? GREEN : total < 0 ? RED : '#EDEBE6';
    ctx.font = font(132, 700);
    ctx.fillText(money(total, currency, true), 40, 220);
    ctx.fillStyle = '#8F96A2';
    ctx.font = font(30, 400);
    const online = moods.filter((m) => m !== 'offline').length;
    const trading = moods.filter((m) => m === 'trade').length;
    ctx.fillText(`${robots.length} robots · ${online} online · ${trading} in a trade`, 40, 280);
    ctx.textAlign = 'right';
    ctx.fillText(`Prague ${new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit' })}`, W - 40, 66);

    // One row per robot on the right.
    ctx.textAlign = 'left';
    robots.slice(0, 5).forEach((r, i) => {
      const y = 130 + i * 58;
      const m = MOODS[moods[i]];
      ctx.fillStyle = m.lamp;
      ctx.beginPath();
      ctx.arc(770, y - 10, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#EDEBE6';
      ctx.font = font(32, 700);
      ctx.fillText(fitText(ctx, r.name, 220), 792, y);
      ctx.fillStyle = '#8F96A2';
      ctx.font = font(26, 400);
      ctx.fillText(m.label, 1020, y);
      const pnl = Number(r.status?.day_pnl) || 0;
      ctx.textAlign = 'right';
      ctx.fillStyle = pnl > 0 ? GREEN : pnl < 0 ? RED : '#EDEBE6';
      ctx.font = font(30, 700);
      ctx.fillText(money(pnl, r.status?.currency || currency, true), W - 40, y);
      ctx.textAlign = 'left';
    });
    tex.texture.needsUpdate = true;
  }

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
    const half = w < 700 ? 11.5 : 7.8;
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
    const selected = selectedId && actors.get(selectedId);
    ring.visible = !!(selected && selected.position);
    if (ring.visible) {
      ring.position.set(selected.position.x, 0.03, selected.position.z);
      ring.rotation.z = t * 0.8;
    }
    room.blink(t);
    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }

  return {
    update,
    setActive(on) {
      if (on === running) return;
      running = on;
      labelRenderer.domElement.style.display = on ? '' : 'none';
      if (on) {
        resize();
        clock.getDelta();
      }
      renderer.setAnimationLoop(on ? tick : null);
    },
    dispose() {
      renderer.setAnimationLoop(null);
      clearInterval(clockTimer);
      observer.disconnect();
      renderer.dispose();
    },
  };
}
