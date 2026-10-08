// Furniture and lighting for the office. Decoration never changes robot state.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .82, ...extra });

export function furnishOffice(scene) {
  const wood = mat('#996A46');
  const dark = mat('#202A2D');
  const fabric = mat('#52615D');
  const cream = mat('#E1D2B6');
  const brass = mat('#CCA465', { metalness: .65, roughness: .35 });
  const glow = new THREE.MeshBasicMaterial({ color: '#FFD99A' });
  const lights = [];
  const pools = [];

  function block(w, h, d, material, x, y, z, radius = 0) {
    const geometry = radius ? new RoundedBoxGeometry(w, h, d, 2, radius) : new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  }
  function cylinder(rt, rb, h, material, x, y, z) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 20), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  }
  function rug(w, d, x, z, color) {
    block(w, .025, d, mat(color), x, .025, z, .012);
    // A woven edge rather than a heavy border.
    for (const edge of [-1, 1]) block(w - .18, .008, .05, cream, x, .043, z + edge * (d / 2 - .15));
  }
  function cup(x, y, z) {
    cylinder(.095, .08, .17, cream, x, y + .085, z);
    cylinder(.08, .08, .009, mat('#482C1D'), x, y + .175, z);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(.065, .018, 6, 12), cream);
    handle.position.set(x + .1, y + .09, z);
    scene.add(handle);
  }
  function lamp(x, z) {
    cylinder(.27, .3, .07, dark, x, .04, z);
    cylinder(.025, .025, 2.4, brass, x, 1.22, z);
    cylinder(.28, .43, .55, cream, x, 2.43, z);
    cylinder(.29, .29, .015, glow, x, 2.15, z);
    const light = new THREE.PointLight('#FFD39B', 9, 6, 2);
    light.position.set(x, 2.12, z);
    scene.add(light);
    lights.push(light);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(1.6, 40), new THREE.MeshBasicMaterial({ color: '#E7B572', transparent: true, opacity: .065, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(x, .055, z);
    scene.add(pool);
    pools.push(pool);
  }
  function sign(text, subtext, w, h, x, y, z) {
    const canvas = document.createElement('canvas');
    canvas.width = 768; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1B2628'; ctx.fillRect(0, 0, 768, 256);
    ctx.textAlign = 'center'; ctx.fillStyle = '#E5BF7E';
    ctx.font = '600 62px "Segoe UI", sans-serif'; ctx.fillText(text, 384, 112);
    ctx.fillStyle = '#B0BAB1'; ctx.font = '30px "Segoe UI", sans-serif'; ctx.fillText(subtext, 384, 183);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    block(w + .1, h + .1, .07, wood, x, y, z - .035);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture }));
    mesh.position.set(x, y, z + .008); scene.add(mesh);
    return texture;
  }

  // Café: slatted timber, stone top, espresso machine and a lit menu.
  rug(7.5, 6.4, -8.1, -4.4, '#303936');
  block(5.7, 1.02, .95, dark, -8.1, .51, -5.7, .06);
  for (let x = -10.8; x < -5.4; x += .19) block(.10, .83, .035, wood, x, .48, -5.2);
  block(5.9, .12, 1.13, cream, -8.1, 1.07, -5.7, .045);
  block(5.7, .04, .06, glow, -8.1, .10, -5.19);
  block(1.18, .65, .65, mat('#65716F', { metalness: .7, roughness: .3 }), -6.2, 1.47, -5.7, .06);
  block(.97, .32, .04, dark, -6.2, 1.48, -5.35);
  block(1.2, .06, .79, dark, -6.2, 1.16, -5.63);
  for (const x of [-6.48, -6.0]) {
    cylinder(.09, .09, .06, brass, x, 1.38, -5.29);
    cup(x, 1.19, -5.28);
  }
  block(.18, .04, .02, glow, -6.2, 1.71, -5.36);
  const barLight = new THREE.PointLight('#FFD39B', 7, 6, 2);
  barLight.position.set(-8.1, 2.1, -5.3);
  scene.add(barLight);
  lights.push(barLight);
  // Cups, a tray, and glass jars on the bar.
  block(1.05, .035, .45, wood, -9.9, 1.15, -5.5, .015);
  cup(-10.1, 1.17, -5.5); cup(-9.7, 1.17, -5.5);
  for (const x of [-8.8, -8.35]) {
    cylinder(.13, .13, .31, mat('#B0C9C0', { transparent: true, opacity: .7 }), x, 1.28, -5.9);
    cylinder(.14, .14, .035, wood, x, 1.45, -5.9);
  }
  block(5.5, .85, .45, dark, -8.1, .425, -8.43, .03);
  block(5.7, .08, .57, wood, -8.1, .89, -8.43);
  for (let x = -10.6; x < -5.4; x += .36) block(.018, .55, .015, brass, x, .49, -8.19);
  sign('THE COFFEE BREAK', 'Espresso  /  Flat white  /  Take a breath', 4.0, 1.3, -8.1, 2.93, -8.84);
  for (const x of [-11.3, -4.7]) {
    cylinder(.30, .30, .12, fabric, x, .7, -5.5);
    cylinder(.035, .035, .61, brass, x, .36, -5.5);
    cylinder(.25, .25, .04, dark, x, .03, -5.5);
  }

  // Lounge: individual seat cushions, an oak table, books and floor lamps.
  rug(7.6, 6.5, -8.0, 5.0, '#353C39');
  block(6.9, .26, 1.35, wood, -8, .16, 3.0, .06);
  block(6.9, .91, .28, fabric, -8, .76, 2.43, .10);
  for (const x of [-10.4, -8.8, -7.2, -5.6]) {
    block(1.48, .27, 1.08, fabric, x, .40, 3.04, .10);
    block(1.40, .64, .22, fabric, x, .83, 2.64, .09);
    for (const z of [6.6, 7.75]) {
      block(.86, .22, .86, wood, x, .11, z, .05);
      block(.92, .26, .92, fabric, x, .34, z, .10);
    }
  }
  for (const x of [-11.5, -4.5]) block(.30, .65, 1.45, fabric, x, .54, 2.98, .1);
  const pillow = block(.52, .52, .18, mat('#BF9559'), -10.5, .78, 2.89, .08);
  pillow.rotation.z = .15;
  const pillow2 = block(.5, .5, .18, cream, -5.5, .77, 2.9, .08);
  pillow2.rotation.z = -.18;
  block(2.8, .13, 1.22, wood, -8, .54, 5.25, .07);
  for (const x of [-9.1, -6.9]) for (const z of [4.82, 5.68]) block(.06, .47, .06, brass, x, .24, z);
  block(.6, .04, .42, mat('#30565B'), -8.55, .63, 5.3);
  block(.5, .035, .37, cream, -8.50, .665, 5.26);
  cup(-7.55, .61, 5.3);
  cylinder(.18, .12, .30, mat('#B6C9BE'), -8, .78, 5.1);
  lamp(-11.35, 5.15); lamp(-4.55, 5.15);
  // A shallow display shelf beside the sofa.
  block(.46, 1.23, 1.4, wood, -11.75, .62, 2.9, .025);
  for (let i = 0; i < 5; i++) block(.26, .36 + i % 2 * .08, .11, mat(['#A88154', '#65847C', '#C5BBA9'][i % 3]), -11.75, 1.42, 2.44 + i * .20);

  // A window on the left wall, overlooking a quiet city silhouette.
  const windowCanvas = document.createElement('canvas'); windowCanvas.width = 640; windowCanvas.height = 480;
  const windowCtx = windowCanvas.getContext('2d');
  const windowTexture = new THREE.CanvasTexture(windowCanvas); windowTexture.colorSpace = THREE.SRGBColorSpace;
  block(.10, 2.3, 3.8, brass, -12.42, 2.8, 4.1);
  const windowMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.65, 2.15), new THREE.MeshBasicMaterial({ map: windowTexture }));
  windowMesh.rotation.y = Math.PI / 2; windowMesh.position.set(-12.35, 2.8, 4.1); scene.add(windowMesh);
  block(.06, 2.2, .045, dark, -12.30, 2.8, 4.1);
  block(.06, .045, 3.7, dark, -12.30, 2.8, 4.1);

  function lighting(mode) {
    const evening = mode === 'evening';
    const gradient = windowCtx.createLinearGradient(0, 0, 0, 480);
    gradient.addColorStop(0, evening ? '#263C5A' : '#9BBECC');
    gradient.addColorStop(1, evening ? '#BF9170' : '#DCE7D8');
    windowCtx.fillStyle = gradient; windowCtx.fillRect(0, 0, 640, 480);
    for (let i = 0; i < 11; i++) {
      const h = 65 + (i * 37) % 130;
      windowCtx.fillStyle = evening ? '#243140' : '#789397';
      windowCtx.fillRect(i * 64 - 5, 480 - h, 53, h);
      if (evening) {
        windowCtx.fillStyle = '#DEC293';
        for (let y = 490 - h; y < 470; y += 23) windowCtx.fillRect(i * 64 + 9, y, 6, 8);
      }
    }
    windowTexture.needsUpdate = true;
    lights.forEach(light => { light.intensity = evening ? 14 : 7; });
    pools.forEach(pool => { pool.material.opacity = evening ? .11 : .045; });
  }
  lighting('day');
  return { lighting };
}
