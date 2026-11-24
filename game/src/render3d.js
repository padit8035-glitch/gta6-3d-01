// Vice Point 3D — the renderer. Three.js draws what world.js computes:
// the city (one painted ground texture, instanced buildings, trees and
// lamps), the cars, the pedestrians, the player, the mission beacon and the
// bullet tracers, plus a third-person camera and a day-night cycle.
// No game logic lives here; every number comes from the world state.
import * as THREE from 'three';
import { WORLD, ROAD_GAP, ROAD_HALF, CAR } from './config.js';
import { collidesBuilding } from './city.js';

function paintGround(city) {
  const S = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  const px = (v) => (v / WORLD) * S;
  const py = (v) => S - (v / WORLD) * S; // canvas row 0 is the north edge
  // Grass base.
  ctx.fillStyle = '#69a24e';
  ctx.fillRect(0, 0, S, S);
  // Parks.
  for (const park of city.parks) {
    ctx.fillStyle = '#4c8438';
    ctx.fillRect(px(park.x - park.w / 2), py(park.y + park.d / 2), px(park.w), px(park.d));
  }
  // Parking lots with marked spots.
  for (const lot of city.parkingLots) {
    ctx.fillStyle = '#5a5c60';
    ctx.fillRect(px(lot.x - lot.w / 2), py(lot.y + lot.d / 2), px(lot.w), px(lot.d));
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    for (const spot of lot.spots) {
      ctx.strokeRect(px(spot.x) - 9, py(spot.y) - 9, 18, 18);
    }
  }
  // Sidewalks: a pale band around every road.
  ctx.fillStyle = '#a8a49a';
  for (let i = 0; i <= WORLD / ROAD_GAP; i += 1) {
    const r = i * ROAD_GAP;
    ctx.fillRect(0, py(r + ROAD_HALF + 8), S, px((ROAD_HALF + 8) * 2));
    ctx.fillRect(px(r - ROAD_HALF - 8), 0, px((ROAD_HALF + 8) * 2), S);
  }
  // Roads: dark asphalt with a dashed yellow centre line.
  ctx.fillStyle = '#33363c';
  for (let i = 0; i <= WORLD / ROAD_GAP; i += 1) {
    const r = i * ROAD_GAP;
    ctx.fillRect(0, py(r + ROAD_HALF), S, px(ROAD_HALF * 2));
    ctx.fillRect(px(r - ROAD_HALF), 0, px(ROAD_HALF * 2), S);
  }
  ctx.fillStyle = '#d8b93a';
  for (let i = 0; i <= WORLD / ROAD_GAP; i += 1) {
    const r = i * ROAD_GAP;
    for (let d = 0; d < WORLD; d += 64) {
      ctx.fillRect(px(d), py(r + 2), px(28), 4);
      ctx.fillRect(px(r - 2), py(d + 28), 4, px(28));
    }
  }
  // Crosswalks at every intersection.
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  for (let i = 0; i <= WORLD / ROAD_GAP; i += 1) {
    for (let j = 0; j <= WORLD / ROAD_GAP; j += 1) {
      const cx = i * ROAD_GAP;
      const cy = j * ROAD_GAP;
      for (let s = -3; s <= 3; s += 1) {
        ctx.fillRect(px(cx + s * 9 - 3), py(cy + ROAD_HALF + 2), 6, px(ROAD_HALF - 2));
        ctx.fillRect(px(cx + s * 9 - 3), py(cy - 2), 6, px(ROAD_HALF - 2));
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function paintWindows() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#d8d2c4';
  ctx.fillRect(0, 0, 128, 128);
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const lit = Math.random() < 0.25;
      ctx.fillStyle = lit ? '#ffd98a' : '#2c3844';
      ctx.fillRect(10 + col * 30, 8 + row * 15, 18, 10);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function box(w, h, d, color, opts) {
  const mat = new THREE.MeshLambertMaterial({ color, ...(opts || {}) });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  return mesh;
}

function makeCarMesh(car) {
  const group = new THREE.Group();
  const bodyColor = car.kind === 'police' ? 0x20242a : car.color;
  const body = box(CAR.length, 9, CAR.width, bodyColor);
  body.position.y = 6;
  group.add(body);
  const cabin = box(28, 8, 22, car.kind === 'police' ? 0xe8e8e8 : 0x222831);
  cabin.position.set(-3, 14, 0);
  group.add(cabin);
  const wheelGeo = new THREE.BoxGeometry(9, 9, 5);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x141414 });
  for (const [wx, wz] of [[19, 13], [19, -13], [-19, 13], [-19, -13]]) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.position.set(wx, 4.5, wz);
    group.add(wheel);
  }
  let lightR = null;
  let lightB = null;
  if (car.kind === 'police') {
    const barGeo = new THREE.BoxGeometry(8, 3, 7);
    lightR = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    lightR.position.set(-3, 19.5, 6);
    lightB = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({ color: 0x2040ff }));
    lightB.position.set(-3, 19.5, -6);
    group.add(lightR);
    group.add(lightB);
  }
  group.userData = { lightR, lightB };
  return group;
}

function makePedMesh(ped, isPlayer) {
  const group = new THREE.Group();
  const torso = box(11, 15, 7, isPlayer ? 0xe86a2a : ped.shirt);
  torso.position.y = 15;
  group.add(torso);
  const head = box(8, 8, 8, isPlayer ? 0xe8b98a : ped.skin);
  head.position.y = 26;
  group.add(head);
  const legMat = new THREE.MeshLambertMaterial({ color: isPlayer ? 0x2a3440 : 0x3a3f46 });
  const legGeo = new THREE.BoxGeometry(4.5, 12, 4.5);
  const legL = new THREE.Mesh(legGeo, legMat);
  legL.position.set(0, 6, 2.8);
  const legR = new THREE.Mesh(legGeo, legMat);
  legR.position.set(0, 6, -2.8);
  group.add(legL);
  group.add(legR);
  group.userData = { legL, legR, phase: Math.random() * 6 };
  return group;
}

export function createRenderer(canvas, world) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x7ec0ee);
  scene.fog = new THREE.Fog(0x7ec0ee, 500, 1600);

  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x5d7a4a, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d0, 1.6);
  sun.position.set(600, 900, 300);
  scene.add(sun);

  // Ground: one painted plane for the whole city.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD, WORLD),
    new THREE.MeshLambertMaterial({ map: paintGround(world.city) }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(WORLD / 2, 0, -WORLD / 2);
  scene.add(ground);

  // Buildings: one instanced box, tinted per building.
  const city = world.city;
  const buildingMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({ map: paintWindows() }),
    Math.max(1, city.buildings.length),
  );
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const color = new THREE.Color();
  city.buildings.forEach((b, i) => {
    pos.set(b.x, b.h / 2, -b.y);
    scl.set(b.w, b.h, b.d);
    matrix.compose(pos, quat, scl);
    buildingMesh.setMatrixAt(i, matrix);
    buildingMesh.setColorAt(i, color.setHex(b.color));
  });
  buildingMesh.instanceMatrix.needsUpdate = true;
  if (buildingMesh.instanceColor) buildingMesh.instanceColor.needsUpdate = true;
  scene.add(buildingMesh);

  // Trees: instanced trunks and cones.
  const trunkMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(1.1, 1.7, 9, 6),
    new THREE.MeshLambertMaterial({ color: 0x6a4a2a }),
    Math.max(1, city.trees.length),
  );
  const leafMesh = new THREE.InstancedMesh(
    new THREE.ConeGeometry(7.5, 17, 7),
    new THREE.MeshLambertMaterial({ color: 0x3f7a2e }),
    Math.max(1, city.trees.length),
  );
  city.trees.forEach((t, i) => {
    pos.set(t.x, 4.5 * t.s, -t.y);
    scl.set(t.s, t.s, t.s);
    matrix.compose(pos, quat, scl);
    trunkMesh.setMatrixAt(i, matrix);
    pos.set(t.x, (9 + 8) * t.s, -t.y);
    matrix.compose(pos, quat, scl);
    leafMesh.setMatrixAt(i, matrix);
    leafMesh.setColorAt(i, color.setHex([0x3f7a2e, 0x4c8a35, 0x2e6b28][i % 3]));
  });
  trunkMesh.instanceMatrix.needsUpdate = true;
  leafMesh.instanceMatrix.needsUpdate = true;
  if (leafMesh.instanceColor) leafMesh.instanceColor.needsUpdate = true;
  scene.add(trunkMesh);
  scene.add(leafMesh);

  // Street lamps: instanced poles and glowing bulbs.
  const poleMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.5, 0.7, 26, 5),
    new THREE.MeshLambertMaterial({ color: 0x3a3f46 }),
    Math.max(1, city.lamps.length),
  );
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
  const bulbMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1.8, 8, 6),
    bulbMat,
    Math.max(1, city.lamps.length),
  );
  city.lamps.forEach((lamp, i) => {
    pos.set(lamp.x, 13, -lamp.y);
    scl.set(1, 1, 1);
    matrix.compose(pos, quat, scl);
    poleMesh.setMatrixAt(i, matrix);
    pos.set(lamp.x, 26, -lamp.y);
    matrix.compose(pos, quat, scl);
    bulbMesh.setMatrixAt(i, matrix);
  });
  poleMesh.instanceMatrix.needsUpdate = true;
  bulbMesh.instanceMatrix.needsUpdate = true;
  scene.add(poleMesh);
  scene.add(bulbMesh);

  // Mission beacon: a glowing pillar and a ring on the ground.
  const beaconMat = new THREE.MeshBasicMaterial({
    color: 0xffd23a, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false,
  });
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 130, 12, 1, true), beaconMat);
  const beaconRing = new THREE.Mesh(
    new THREE.RingGeometry(10, 15, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
  );
  beaconRing.rotation.x = -Math.PI / 2;
  scene.add(beacon);
  scene.add(beaconRing);

  // Bullet tracers: one line segment set, rebuilt every frame.
  const tracerGeo = new THREE.BufferGeometry();
  const tracerPos = new Float32Array(64 * 2 * 3);
  tracerGeo.setAttribute('position', new THREE.BufferAttribute(tracerPos, 3));
  const tracers = new THREE.LineSegments(
    tracerGeo,
    new THREE.LineBasicMaterial({ color: 0xffe14a, transparent: true, opacity: 0.9 }),
  );
  tracers.frustumCulled = false;
  scene.add(tracers);

  const carMeshes = new Map();
  const pedMeshes = new Map();
  const pickupMeshes = new Map();
  const playerMesh = makePedMesh(null, true);
  scene.add(playerMesh);

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 1, 4000);
  const cam = { yaw: 0, pitch: 0.42, dist: 55, height: 30, pos: new THREE.Vector3(1280, 1280, 0) };
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  function syncMesh(map, list, factory) {
    const seen = new Set();
    for (const obj of list) {
      seen.add(obj);
      if (!map.has(obj)) {
        const mesh = factory(obj);
        map.set(obj, mesh);
        scene.add(mesh);
      }
    }
    for (const [obj, mesh] of map) {
      if (!seen.has(obj)) {
        scene.remove(mesh);
        map.delete(obj);
      }
    }
  }

  const skyDay = new THREE.Color(0x7ec0ee);
  const skyDusk = new THREE.Color(0xe8a56a);
  const skyNight = new THREE.Color(0x0e1626);
  const sky = new THREE.Color();

  function render(dt, time) {
    const player = world.player;
    const focus = player.inCar || player;

    // Cars.
    syncMesh(carMeshes, [...world.cars, ...world.police], (car) => makeCarMesh(car));
    for (const [car, mesh] of carMeshes) {
      mesh.position.set(car.x, 0, -car.y);
      mesh.rotation.y = car.angle;
      if (car.kind === 'police') {
        const on = Math.sin(car.flash * 9) > 0;
        mesh.userData.lightR.material.color.setHex(on ? 0xff2020 : 0x550000);
        mesh.userData.lightB.material.color.setHex(on ? 0x2020aa : 0x2040ff);
      }
    }
    // Pedestrians.
    syncMesh(pedMeshes, world.peds, (ped) => makePedMesh(ped, false));
    for (const [ped, mesh] of pedMeshes) {
      mesh.position.set(ped.x, 0, -ped.y);
      if (ped.state === 'down') {
        mesh.rotation.set(0, ped.angle, Math.PI / 2);
      } else {
        mesh.rotation.set(0, ped.angle, 0);
        const swing = Math.sin(time * 9 + mesh.userData.phase) * 0.45;
        mesh.userData.legL.rotation.x = swing;
        mesh.userData.legR.rotation.x = -swing;
      }
    }
    // Cash drops.
    syncMesh(pickupMeshes, world.pickups, () => {
      const m = box(13, 13, 13, 0xffd23a, { emissive: 0x8a6d00 });
      return m;
    });
    for (const [pickup, mesh] of pickupMeshes) {
      mesh.position.set(pickup.x, 9 + Math.sin(pickup.bob * 3) * 2.5, -pickup.y);
      mesh.rotation.y = time * 2;
    }
    // The player on foot (hidden while driving).
    playerMesh.visible = !player.inCar;
    playerMesh.position.set(player.x, 0, -player.y);
    playerMesh.rotation.y = player.angle;
    const walkSwing = Math.sin(player.walkPhase * 2) * 0.5;
    playerMesh.userData.legL.rotation.x = walkSwing;
    playerMesh.userData.legR.rotation.x = -walkSwing;

    // Mission beacon.
    const target = world.missions.target;
    const showBeacon = Boolean(target) && world.missions.active;
    beacon.visible = showBeacon;
    beaconRing.visible = showBeacon;
    if (showBeacon) {
      beacon.position.set(target.x, 65, -target.y);
      beaconRing.position.set(target.x, 0.6, -target.y);
      const pulse = 1 + Math.sin(time * 3) * 0.12;
      beacon.scale.set(pulse, 1, pulse);
      beaconMat.opacity = 0.24 + Math.sin(time * 3) * 0.08;
    }

    // Bullet tracers.
    let t = 0;
    for (const tr of world.tracers) {
      if (t >= 64) break;
      tracerPos[t * 6] = tr.x1;
      tracerPos[t * 6 + 1] = 12;
      tracerPos[t * 6 + 2] = -tr.y1;
      tracerPos[t * 6 + 3] = tr.x2;
      tracerPos[t * 6 + 4] = 12;
      tracerPos[t * 6 + 5] = -tr.y2;
      t += 1;
    }
    tracerGeo.setDrawRange(0, t * 2);
    tracerGeo.attributes.position.needsUpdate = true;

    // Day and night: the sun circles, the sky and the lamps follow it.
    const daylight = Math.max(0, Math.sin(Math.PI * 2 * world.clock));
    const sunAngle = Math.PI * 2 * world.clock;
    sun.position.set(
      focus.x + Math.cos(sunAngle) * 900,
      200 + Math.max(0, Math.sin(sunAngle)) * 900,
      -focus.y + Math.sin(sunAngle) * 500,
    );
    sun.intensity = 0.25 + daylight * 1.35;
    sun.color.setHex(daylight > 0.45 ? 0xfff2d0 : 0xff9a50);
    hemi.intensity = 0.3 + daylight * 0.65;
    if (daylight > 0.55) sky.copy(skyDay);
    else if (daylight > 0.15) sky.copy(skyDusk).lerp(skyDay, (daylight - 0.15) / 0.4);
    else sky.copy(skyNight).lerp(skyDusk, daylight / 0.15);
    scene.background.copy(sky);
    scene.fog.color.copy(sky);
    bulbMat.color.setHex(daylight < 0.35 ? 0xfff2b0 : 0x8a8258);

    // Third-person camera: behind the focus, eased, with the mouse orbit.
    const heading = focus.angle + cam.yaw;
    const dist = player.inCar ? cam.dist + 10 : cam.dist;
    const baseHeight = dist * Math.tan(cam.pitch) + 6;
    const wantX = focus.x - Math.cos(heading) * dist;
    const wantY = focus.y - Math.sin(heading) * dist;
    const ease = 1 - Math.exp(-dt * 5);
    cam.pos.x += (wantX - cam.pos.x) * ease;
    cam.pos.y += (wantY - cam.pos.y) * ease;
    // Keep the sight-line out of the buildings: if a block stands between
    // the camera and the car, lift the camera until the line clears its
    // roof, instead of letting a wall fill the whole screen. Sampled along
    // the segment; a block right next to the car is skipped (no height
    // clears it) and the cap keeps the camera from launching into orbit.
    let needHeight = baseHeight;
    const samples = 6;
    for (let s = 0; s <= samples; s += 1) {
      const t = s / samples; // 0 = camera, 1 = focus
      const sx = cam.pos.x + (focus.x - cam.pos.x) * t;
      const sy = cam.pos.y + (focus.y - cam.pos.y) * t;
      const b = collidesBuilding(world.city, sx, sy, 0);
      if (!b) continue;
      const denom = 1 - t;
      if (denom < 0.08) continue;
      const h = (b.h + 6 - 10 * t) / denom;
      if (h > needHeight) needHeight = Math.min(h, 170);
    }
    cam.height += (needHeight - cam.height) * ease;
    camera.position.set(cam.pos.x, cam.height, -cam.pos.y);
    camera.lookAt(focus.x, 10, -focus.y);

    renderer.render(scene, camera);
  }

  function screenToGround(clientX, clientY) {
    const ndc = new THREE.Vector2(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    const hit = new THREE.Vector3();
    raycaster.ray.intersectPlane(groundPlane, hit);
    if (!hit) return null;
    return { x: hit.x, y: -hit.z };
  }

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', resize);

  return { render, screenToGround, camera, cam };
}
