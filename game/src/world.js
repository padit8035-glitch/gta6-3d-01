// Vice Point 3D — the simulation. Pure logic: no DOM, no three.js, no
// canvas, so the Node play-test can run the exact same world the browser
// plays. The renderer only draws what this file computes. One fixed step
// (STEP) per call keeps the game deterministic for a given seed and input.
import {
  STEP, WORLD, ROAD_GAP, ROAD_HALF, PLAYER, CAR, TRAFFIC, PED, POLICE, WANTED,
} from './config.js';
import {
  createCity, nearestRoad, onHorizontalRoad, onVerticalRoad, collidesBuilding,
  roadPoint, isOnRoad,
} from './city.js';
import { makeCar, makePed, makePickup } from './entities.js';
import { mulberry32, range, intRange } from './rng.js';
import {
  createMissionState, startMission, tickMissions, finishMission, restartMission,
} from './missions.js';

/** Input action bits, set by the keyboard (or the play-test pilots). */
export const ACT = { PUNCH: 1, ENTER: 2 };

/** Shortest signed difference between two angles. */
export function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

/**
 * Slide a circle (x, y, r) by (dx, dy) against the buildings, one axis at
 * a time so it glides along walls instead of sticking to them. Nothing
 * leaves the city: the edge roads run along its border.
 */
function moveCircle(city, obj, dx, dy, r) {
  let hit = false;
  const nx = obj.x + dx;
  if (!collidesBuilding(city, nx, obj.y, r)) obj.x = nx;
  else hit = true;
  const ny = obj.y + dy;
  if (!collidesBuilding(city, obj.x, ny, r)) obj.y = ny;
  else hit = true;
  obj.x = clamp(obj.x, 16, WORLD - 16);
  obj.y = clamp(obj.y, 16, WORLD - 16);
  return hit;
}

function circleHitsCar(car, x, y, r) {
  const dx = x - car.x;
  const dy = y - car.y;
  const rr = r + CAR.length / 2;
  return dx * dx + dy * dy < rr * rr;
}

/** The nearest parked car to a point, or null. */
export function nearestParkedCar(world, x, y) {
  let best = null;
  let bestSq = Infinity;
  for (const car of world.cars) {
    if (car.kind !== 'parked') continue;
    const dx = car.x - x;
    const dy = car.y - y;
    const sq = dx * dx + dy * dy;
    if (sq < bestSq) {
      bestSq = sq;
      best = car;
    }
  }
  return best;
}

/**
 * Road-following steering for a car that wants to reach (tx, ty): head for
 * the nearest road when off one, then pick the intersection that shrinks the
 * distance to the target. Returns { steer, throttle, wantAngle, turning }.
 */
export function roadSteer(world, car, tx, ty) {
  const onH = onHorizontalRoad(car.x, car.y);
  const onV = onVerticalRoad(car.x, car.y);
  let wx;
  let wy;
  let turning = false;
  if (!onH && !onV) {
    // Off the road: steer straight (axis-aligned) to the nearest road
    // line. Cutting diagonally to the nearest road point wedges the car
    // on the corner of a building instead.
    const dxRoad = Math.abs(car.x - nearestRoad(car.x));
    const dyRoad = Math.abs(car.y - nearestRoad(car.y));
    if (dxRoad < dyRoad) {
      wx = nearestRoad(car.x);
      wy = car.y;
    } else {
      wx = car.x;
      wy = nearestRoad(car.y);
    }
    turning = true;
  } else {
    // The road the car is on decides its axis: a car on a vertical road
    // only travels north/south, even if its nose still points east after
    // a turn — otherwise the steering sends it sideways across a block
    // and wedges it on a building. Only at a crossing does the heading
    // choose the axis.
    let movingH = Math.abs(Math.cos(car.angle)) >= Math.abs(Math.sin(car.angle));
    if (onV && !onH) movingH = false;
    if (onH && !onV) movingH = true;
    const dirH = Math.sign(Math.cos(car.angle)) || 1;
    const dirV = Math.sign(Math.sin(car.angle)) || 1;
    let ix;
    let iy;
    if (movingH) {
      ix = nearestRoad(car.x + dirH * 160);
      iy = nearestRoad(car.y);
    } else {
      ix = nearestRoad(car.x);
      iy = nearestRoad(car.y + dirV * 160);
    }
    const distToCross = Math.hypot(ix - car.x, iy - car.y);
    // Turn at the crossing road when the target is more to the side than
    // ahead of the car — measured along the direction of travel, so a
    // target behind the car always turns it around instead of letting it
    // drive off the far edge of the city.
    let turnAtCross;
    if (movingH) {
      const forward = (tx - ix) * dirH;
      turnAtCross = Math.abs(ty - iy) > forward;
    } else {
      const forward = (ty - iy) * dirV;
      turnAtCross = Math.abs(tx - ix) > forward;
    }
    turning = distToCross < 240 && turnAtCross;
    if (distToCross < 120 && turnAtCross) {
      if (movingH) {
        wx = ix;
        // If the target sits on this same road, turn either way (north)
        // and route around the block — a zero turn direction would just
        // drive straight on, past the target. The waypoint sits just past
        // the crossing so the turn is tight, not a wide swing into the
        // buildings on the corner.
        wy = iy + (Math.sign(ty - iy) || 1) * 70;
      } else {
        wx = ix + (Math.sign(tx - ix) || 1) * 70;
        wy = iy;
      }
    } else {
      wx = ix;
      wy = iy;
    }
  }
  const wantAngle = Math.atan2(wy - car.y, wx - car.x);
  const diff = angDiff(wantAngle, car.angle);
  const steer = clamp(diff * 2.2, -1, 1);
  return { steer, throttle: 1, wantAngle, turning };
}/** Raise the wanted level and restart the heat clock (fresh crime). */
export function addWanted(world, n) {
  world.wanted = Math.min(WANTED.max, world.wanted + n);
  world.heatClock = 0;
}

export function createWorld(seed, audio) {
  const city = createCity(seed);
  const rand = mulberry32(seed * 7919 + 13);
  const world = {
    seed,
    city,
    rand,
    time: 0,
    clock: 0.08, // morning: low golden sun
    player: {
      x: city.start.x,
      y: city.start.y,
      angle: 0,
      health: PLAYER.health,
      money: PLAYER.startMoney,
      inCar: null,
      punchTimer: 0,
      shotTimer: 0,
      bustTimer: 0,
      walkPhase: 0,
    },
    cars: [],
    peds: [],
    police: [],
    pickups: [],
    tracers: [],
    missions: createMissionState(),
    wanted: 0,
    heatClock: 0, // seconds since the last crime: reinforcements only come fresh
    coldTimer: 0,
    over: null,
    audio: audio || null,
    stats: { shots: 0, hits: 0, carsStolen: 0, pedsDown: 0, copsDown: 0 },
  };

  // Parked cars: some in parking lots, the rest along road sides.
  const lots = city.parkingLots;
  let parked = 0;
  for (const lot of lots) {
    for (const spot of lot.spots) {
      if (parked >= 12) break;
      if (rand() < 0.45) continue;
      world.cars.push(makeCar('parked', spot.x, spot.y, spot.angle, rand));
      parked += 1;
    }
  }
  while (parked < 12) {
    const p = roadPoint(rand);
    const onH = onHorizontalRoad(p.x, p.y);
    const px = onH ? p.x : p.x + (rand() < 0.5 ? -1 : 1) * (ROAD_HALF - 12);
    const py = onH ? p.y + (rand() < 0.5 ? -1 : 1) * (ROAD_HALF - 12) : p.y;
    if (collidesBuilding(city, px, py, 30)) continue;
    world.cars.push(makeCar('parked', px, py, onH ? 0 : Math.PI / 2, rand));
    parked += 1;
  }
  // One parked car right by the player's start, so the first job is quick.
  world.cars.push(makeCar('parked', city.start.x + 90, city.start.y + 20, 0, rand));

  // Traffic already rolling on the roads.
  for (let i = 0; i < TRAFFIC.count; i += 1) {
    const car = spawnTrafficCar(world);
    if (car) world.cars.push(car);
  }

  // Pedestrians on the sidewalks.
  for (let i = 0; i < PED.count; i += 1) {
    const p = roadPoint(rand);
    world.peds.push(makePed(p.x, p.y, rand));
  }

  return world;
}

function spawnTrafficCar(world) {
  const p = roadPoint(world.rand);
  const onH = onHorizontalRoad(p.x, p.y);
  const car = makeCar('traffic', p.x, p.y, onH ? 0 : Math.PI / 2, world.rand);
  car.route = onH ? 0 : 1;
  car.dir = world.rand() < 0.5 ? 1 : -1;
  car.angle = car.route === 0 ? (car.dir > 0 ? 0 : Math.PI) : car.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  car.cruise = range(world.rand, TRAFFIC.speedMin, TRAFFIC.speedMax);
  car.speed = car.cruise;
  return car;
}

function spawnPed(world) {
  const p = roadPoint(world.rand);
  return makePed(p.x, p.y, world.rand);
}

function spawnPoliceCar(world) {
  // Appear on a road 300–500 units from the player, never on top of them.
  for (let tries = 0; tries < 8; tries += 1) {
    const angle = world.rand() * Math.PI * 2;
    const dist = range(world.rand, 300, 520);
    const x = clamp(world.player.x + Math.cos(angle) * dist, 60, WORLD - 60);
    const y = clamp(world.player.y + Math.sin(angle) * dist, 60, WORLD - 60);
    if (!isOnRoad(x, y)) continue;
    const car = makeCar('police', nearestRoad(x), nearestRoad(y), 0, world.rand);
    car.speed = POLICE.speed * 0.8;
    return car;
  }
  return null;
}

function callAudio(world, name, ...args) {
  const fn = world.audio && world.audio[name];
  if (typeof fn === 'function') fn(...args);
}

/** One fixed simulation step. Input: { move: {x, y}, actions, shooting, aim }. */
export function stepWorld(world, input, dt) {
  const events = { missionDone: 0, missionFailed: false };
  if (world.over) return events;
  world.time += dt;
  world.clock = (world.clock + dt / 240) % 1;
  world.heatClock += dt;
  const player = world.player;
  const city = world.city;

  if (player.punchTimer > 0) player.punchTimer -= dt;
  if (player.shotTimer > 0) player.shotTimer -= dt;

  // --- Player actions -------------------------------------------------
  if (input.actions & ACT.ENTER) {
    if (player.inCar) exitCar(world);
    else enterCar(world);
  }
  if ((input.actions & ACT.PUNCH) && player.punchTimer <= 0 && !player.inCar) {
    player.punchTimer = PLAYER.punchCooldown;
    punch(world);
  }
  if (input.shooting && input.aim && player.shotTimer <= 0 && !player.inCar) {
    player.shotTimer = PLAYER.shotCooldown;
    shoot(world, input.aim);
  }

  // --- Player movement ------------------------------------------------
  if (player.inCar) {
    drivePlayerCar(world, input, dt);
    // The player rides with the car: every distance check (missions,
    // pickups, police, minimap) reads the player's position. The car may
    // have been wrecked mid-step, which already put the player on foot.
    if (player.inCar) {
      player.x = player.inCar.x;
      player.y = player.inCar.y;
      player.angle = player.inCar.angle;
    }
  } else {
    const mx = input.move.x || 0;
    const my = input.move.y || 0;
    const len = Math.hypot(mx, my);
    const running = input.run === true;
    if (len > 0.01) {
      const speed = running ? PLAYER.runSpeed : PLAYER.walkSpeed;
      const nx = (mx / len) * speed * dt;
      const ny = (my / len) * speed * dt;
      player.angle = Math.atan2(my, mx);
      moveCircle(city, player, nx, ny, PLAYER.radius);
      player.walkPhase += dt * speed * 0.06;
      // Do not walk through parked cars: push out of them.
      for (const car of world.cars) {
        if (circleHitsCar(car, player.x, player.y, PLAYER.radius)) {
          const dx = player.x - car.x;
          const dy = player.y - car.y;
          const d = Math.hypot(dx, dy) || 1;
          const push = CAR.length / 2 + PLAYER.radius - d;
          player.x += (dx / d) * push;
          player.y += (dy / d) * push;
        }
      }
    }
  }

  updateTraffic(world, dt);
  updatePeds(world, dt);
  updatePolice(world, dt);
  updateWanted(world, dt);

  // --- Pickups --------------------------------------------------------
  for (let i = world.pickups.length - 1; i >= 0; i -= 1) {
    const pickup = world.pickups[i];
    pickup.bob += dt;
    const dx = player.x - pickup.x;
    const dy = player.y - pickup.y;
    if (dx * dx + dy * dy < 42 * 42) {
      world.pickups.splice(i, 1);
      player.money += pickup.value;
      if (pickup.mission) world.missions.dropsLeft -= 1;
      callAudio(world, 'pickup');
    }
  }

  // --- Missions -------------------------------------------------------
  if (world.missions.chainTimer > 0) {
    world.missions.chainTimer -= dt;
    if (world.missions.chainTimer <= 0 && !world.missions.active && !world.missions.done) {
      startMission(world.missions, world);
    }
  }
  const result = tickMissions(world.missions, world, dt);
  if (result === 'done') {
    const reward = finishMission(world.missions, world);
    world.missions.toast = `Mission complete! +$${reward}`;
    world.missions.toastTimer = 5;
    events.missionDone = reward;
    // The next job from Rico opens by itself a moment later.
    if (!world.missions.done) world.missions.chainTimer = 1.5;
    callAudio(world, 'mission');
  } else if (result === 'failed') {
    world.missions.toast = 'Too slow — Rico wants it done again.';
    world.missions.toastTimer = 5;
    events.missionFailed = true;
    restartMission(world.missions, world);
  }

  // --- Tracers fade ---------------------------------------------------
  for (let i = world.tracers.length - 1; i >= 0; i -= 1) {
    world.tracers[i].life -= dt;
    if (world.tracers[i].life <= 0) world.tracers.splice(i, 1);
  }

  // Nothing leaves the city: rams and shoves can push a car past the edge
  // roads, and the road network ends there.
  const keepInside = (obj) => {
    obj.x = clamp(obj.x, 16, WORLD - 16);
    obj.y = clamp(obj.y, 16, WORLD - 16);
  };
  keepInside(player);
  for (const car of world.cars) keepInside(car);
  for (const cop of world.police) keepInside(cop);
  for (const ped of world.peds) keepInside(ped);

  if (player.health <= 0) {
    world.over = 'wasted';
    callAudio(world, 'wasted');
  }
  return events;
}

function enterCar(world) {
  const player = world.player;
  const car = nearestParkedCar(world, player.x, player.y);
  let target = car;
  let bestSq = car ? (car.x - player.x) ** 2 + (car.y - player.y) ** 2 : Infinity;
  // A slow traffic car next to the player can be stolen too.
  for (const c of world.cars) {
    if (c.kind !== 'traffic' || Math.abs(c.speed) > 60) continue;
    const sq = (c.x - player.x) ** 2 + (c.y - player.y) ** 2;
    if (sq < bestSq) {
      bestSq = sq;
      target = c;
    }
  }
  if (target && bestSq < 75 * 75) {
    player.inCar = target;
    target.kind = 'player';
    target.speed = 0;
    addWanted(world, WANTED.stealCar);
    world.stats.carsStolen += 1;
    callAudio(world, 'steal');
  }
}

function exitCar(world) {
  const player = world.player;
  const car = player.inCar;
  if (!car) return;
  const side = car.angle + Math.PI / 2;
  player.x = car.x + Math.cos(side) * 34;
  player.y = car.y + Math.sin(side) * 34;
  player.angle = car.angle;
  player.inCar = null;
  car.speed = 0;
}

/** Arcade driving for the player's car. move.x = steer, move.y = throttle. */
function drivePlayerCar(world, input, dt) {
  const car = world.player.inCar;
  const steer = clamp(input.move.x || 0, -1, 1);
  const throttle = clamp(input.move.y || 0, -1, 1);
  if (throttle > 0) car.speed += CAR.accel * throttle * dt;
  else if (throttle < 0) {
    if (car.speed > 20) car.speed -= CAR.brake * dt;
    else car.speed += CAR.reverseAccel * throttle * dt;
  } else {
    car.speed -= car.speed * 0.9 * dt;
  }
  car.speed = clamp(car.speed, -CAR.maxReverse, CAR.maxSpeed);
  // Arcade turning: sharp at city speed, lazy at full speed, so a 90-degree
  // turn fits inside an intersection instead of sliding into a building.
  const turn = steer * CAR.steer * clamp(Math.abs(car.speed) / 140, 0.15, 1);
  car.angle += turn * dt * Math.sign(car.speed || 1);
  const vx = Math.cos(car.angle) * car.speed;
  const vy = Math.sin(car.angle) * car.speed;
  car.crashTimer -= dt;
  const hit = moveCircle(world.city, car, vx * dt, vy * dt, CAR.length / 2 - 4);
  if (hit && Math.abs(car.speed) > 120 && car.crashTimer <= 0) {
    car.crashTimer = 0.5;
    car.speed *= 0.45;
    car.health -= 6;
    callAudio(world, 'crash');
  }
  if (hit) car.speed *= 0.92;
  // Ram traffic and police: shove them aside and dent both cars.
  for (const other of world.cars) {
    if (other === car || other.gone) continue;
    const dx = other.x - car.x;
    const dy = other.y - car.y;
    const d = Math.hypot(dx, dy);
    const min = CAR.length - 6;
    if (d < min && d > 0.01) {
      const push = (min - d) / 2;
      const nx = dx / d;
      const ny = dy / d;
      other.x += nx * push;
      other.y += ny * push;
      car.x -= nx * push * 0.4;
      car.y -= ny * push * 0.4;
      if (Math.abs(car.speed) > 150) {
        other.health -= 12;
        car.health -= 4;
        callAudio(world, 'crash');
      }
    }
  }
  // Running over a pedestrian is a crime, and it hurts.
  for (const ped of world.peds) {
    if (ped.state === 'down') continue;
    const dx = ped.x - car.x;
    const dy = ped.y - car.y;
    if (dx * dx + dy * dy < 30 * 30 && Math.abs(car.speed) > 60) {
      ped.state = 'down';
      ped.health = 0;
      addWanted(world, WANTED.hitPed);
      world.stats.pedsDown += 1;
      car.speed *= 0.8;
      callAudio(world, 'thud');
    }
  }
  if (car.health <= 0) {
    car.gone = true;
    world.cars = world.cars.filter((c) => c !== car);
    world.player.inCar = null;
    world.player.health -= 10;
    world.player.x = car.x;
    world.player.y = car.y;
    addWanted(world, 1);
    // The cruisers hesitate a moment after the wreck — a chance to run.
    for (const cop of world.police) cop.shootTimer = Math.max(cop.shootTimer, 2.5);
    callAudio(world, 'explosion');
  }
  callAudio(world, 'engine', Math.abs(car.speed) / CAR.maxSpeed);
}

/** A point on a road near (cx, cy): a road line inside the margin, then a
 * spot along it. Clamping each coordinate of a road point separately can
 * land a car inside a block, so the line itself is picked near the player.
 */
function roadPointNear(rand, cx, cy, margin) {
  const horizontal = rand() < 0.5;
  if (horizontal) {
    const lo = Math.max(0, Math.ceil((cy - margin) / ROAD_GAP));
    const hi = Math.min(WORLD / ROAD_GAP, Math.floor((cy + margin) / ROAD_GAP));
    const road = intRange(rand, lo, hi) * ROAD_GAP;
    const x = clamp(range(rand, cx - margin, cx + margin), 60, WORLD - 60);
    return { x, y: road };
  }
  const lo = Math.max(0, Math.ceil((cx - margin) / ROAD_GAP));
  const hi = Math.min(WORLD / ROAD_GAP, Math.floor((cx + margin) / ROAD_GAP));
  const road = intRange(rand, lo, hi) * ROAD_GAP;
  const y = clamp(range(rand, cy - margin, cy + margin), 60, WORLD - 60);
  return { x: road, y };
}

function updateTraffic(world, dt) {
  const player = world.player;
  for (let i = world.cars.length - 1; i >= 0; i -= 1) {
    const car = world.cars[i];
    if (car.kind !== 'traffic') continue;
    // A car ahead on the same road, going the same way: ease off instead
    // of rear-ending it. Oncoming cars do not block — stopping for them
    // deadlocks the road head-on and traps the player in the jam.
    let blocked = false;
    for (const other of world.cars) {
      if (other === car || other.gone) continue;
      const dx = other.x - car.x;
      const dy = other.y - car.y;
      const ahead = dx * Math.cos(car.angle) + dy * Math.sin(car.angle);
      const side = Math.abs(-dx * Math.sin(car.angle) + dy * Math.cos(car.angle));
      const sameWay = Math.cos(car.angle) * Math.cos(other.angle)
        + Math.sin(car.angle) * Math.sin(other.angle) > 0.3;
      if (ahead > 0 && ahead < 95 && side < 30 && sameWay) {
        blocked = true;
        break;
      }
    }
    // Each car drives to a random road point, then picks a new one. The
    // road steering keeps it on the road centrelines — a fixed compass
    // heading overshoots every turn and ends up inside the buildings.
    if (car.targetX === undefined
      || Math.hypot(car.targetX - car.x, car.targetY - car.y) < 90) {
      const p = roadPoint(world.rand);
      car.targetX = p.x;
      car.targetY = p.y;
    }
    const drive = roadSteer(world, car, car.targetX, car.targetY);
    const err = Math.abs(angDiff(drive.wantAngle, car.angle));
    const targetSpeed = blocked ? 0 : (err > 0.5 ? 80 : drive.turning ? 100 : car.cruise);
    car.speed += clamp(targetSpeed - car.speed, -260 * dt, 180 * dt);
    car.angle += clamp(angDiff(drive.wantAngle, car.angle), -6.0 * dt, 6.0 * dt);
    // A car that has sat still for seconds is jammed: move it on so the
    // road never gridlocks around the player.
    if (Math.abs(car.speed) < 5) {
      car.jamTimer = (car.jamTimer || 0) + dt;
      if (car.jamTimer > 4) {
        car.jamTimer = 0;
        const p = roadPointNear(world.rand, player.x, player.y, TRAFFIC.spawnMargin);
        car.x = p.x;
        car.y = p.y;
        car.speed = car.cruise;
        const q = roadPoint(world.rand);
        car.targetX = q.x;
        car.targetY = q.y;
      }
    } else {
      car.jamTimer = 0;
    }
    const hit = moveCircle(
      world.city, car,
      Math.cos(car.angle) * car.speed * dt,
      Math.sin(car.angle) * car.speed * dt,
      CAR.length / 2 - 4,
    );
    if (hit) {
      car.stuck += dt;
      if (car.stuck > 1.2) {
        car.stuck = 0;
        const p = roadPoint(world.rand);
        car.targetX = p.x;
        car.targetY = p.y;
      }
    } else {
      car.stuck = 0;
    }
    // Too far from the player: reappear on a road nearby.
    const dx = car.x - player.x;
    const dy = car.y - player.y;
    if (dx * dx + dy * dy > TRAFFIC.despawnMargin * TRAFFIC.despawnMargin) {
      const p = roadPointNear(world.rand, player.x, player.y, TRAFFIC.spawnMargin);
      car.x = p.x;
      car.y = p.y;
      car.speed = car.cruise;
      const q = roadPoint(world.rand);
      car.targetX = q.x;
      car.targetY = q.y;
    }
  }
}

function updatePeds(world, dt) {
  const player = world.player;
  const car = player.inCar;
  for (const ped of world.peds) {
    if (ped.state === 'down') continue;
    ped.stateTimer -= dt;
    // Danger nearby: a speeding car or a gunshot makes them run.
    const dangerX = car ? car.x : player.x;
    const dangerY = car ? car.y : player.y;
    const dx = ped.x - dangerX;
    const dy = ped.y - dangerY;
    const d = Math.hypot(dx, dy);
    const carDanger = car && Math.abs(car.speed) > 120 && d < 170;
    if (carDanger && ped.state !== 'flee') {
      ped.state = 'flee';
      ped.stateTimer = 2.2;
      ped.fleeX = dx / (d || 1);
      ped.fleeY = dy / (d || 1);
    }
    if (ped.state === 'flee') {
      ped.speed = PED.fleeSpeed;
      moveCircle(world.city, ped, ped.fleeX * ped.speed * dt, ped.fleeY * ped.speed * dt, 10);
      ped.angle = Math.atan2(ped.fleeY, ped.fleeX);
      if (ped.stateTimer <= 0) ped.state = 'walk';
      continue;
    }
    // A stroll along the sidewalk: keep to a road, turn at intersections.
    ped.speed = range(world.rand, PED.speedMin, PED.speedMax) * 0.6 + 20;
    if (onHorizontalRoad(ped.x, ped.y) && onVerticalRoad(ped.x, ped.y) && world.rand() < dt * 0.3) {
      ped.angle = Math.floor(world.rand() * 4) * (Math.PI / 2);
    }
    const step = ped.speed * dt;
    const nx = ped.x + Math.cos(ped.angle) * step;
    const ny = ped.y + Math.sin(ped.angle) * step;
    if (isOnRoad(nx, ny) && !collidesBuilding(world.city, nx, ny, 10)) {
      ped.x = nx;
      ped.y = ny;
    } else {
      ped.angle += Math.PI / 2;
    }
    ped.x = clamp(ped.x, 40, WORLD - 40);
    ped.y = clamp(ped.y, 40, WORLD - 40);
  }
  // Keep the streets full near the player.
  let near = 0;
  for (const ped of world.peds) {
    const dx = ped.x - player.x;
    const dy = ped.y - player.y;
    if (dx * dx + dy * dy < 900 * 900) near += 1;
  }
  if (near < 14) {
    const fresh = spawnPed(world);
    const angle = world.rand() * Math.PI * 2;
    fresh.x = clamp(player.x + Math.cos(angle) * 500, 60, WORLD - 60);
    fresh.y = clamp(player.y + Math.sin(angle) * 500, 60, WORLD - 60);
    world.peds.push(fresh);
  }
}

function updatePolice(world, dt) {
  const player = world.player;
  // Reinforcements arrive while the heat is fresh; once the trail has gone
  // cold for a while, no new cruiser joins the chase.
  const wantedCars = Math.min(world.wanted, POLICE.maxCars);
  if (world.police.length < wantedCars && world.wanted > 0 && world.heatClock < 10) {
    const car = spawnPoliceCar(world);
    if (car) world.police.push(car);
  }
  if (world.wanted === 0) {
    // The heat is off: cruisers drift away and leave.
    for (let i = world.police.length - 1; i >= 0; i -= 1) {
      const cop = world.police[i];
      cop.angle += dt * 0.4;
      moveCircle(
        world.city, cop,
        Math.cos(cop.angle) * POLICE.speed * 0.5 * dt,
        Math.sin(cop.angle) * POLICE.speed * 0.5 * dt,
        CAR.length / 2 - 4,
      );
      const dx = cop.x - player.x;
      const dy = cop.y - player.y;
      if (dx * dx + dy * dy > 900 * 900) world.police.splice(i, 1);
    }
    return;
  }
  for (let i = world.police.length - 1; i >= 0; i -= 1) {
    const cop = world.police[i];
    cop.flash += dt;
    cop.shootTimer -= dt;
    cop.ramCooldown -= dt;
    const dx = player.x - cop.x;
    const dy = player.y - cop.y;
    const dist = Math.hypot(dx, dy) || 1;
    // A cruiser that has not seen the player up close for 25 seconds loses
    // the trail and gives up the chase.
    if (dist < 200) cop.lastSeen = 0;
    else cop.lastSeen += dt;
    if (cop.lastSeen > 25) {
      world.police.splice(i, 1);
      continue;
    }
    const drive = roadSteer(world, cop, player.x, player.y);
    const err = Math.abs(angDiff(drive.wantAngle, cop.angle));
    let targetSpeed = dist < 90 ? POLICE.speed * 0.55 : POLICE.speed;
    if (err > 0.5) targetSpeed = Math.min(targetSpeed, 150);
    else if (drive.turning) targetSpeed = Math.min(targetSpeed, POLICE.speed * 0.65);
    cop.speed += clamp(targetSpeed - cop.speed, -500 * dt, 320 * dt);
    cop.angle += drive.steer * CAR.steer * clamp(Math.abs(cop.speed) / 140, 0.15, 1) * dt;
    const hit = moveCircle(
      world.city, cop,
      Math.cos(cop.angle) * cop.speed * dt,
      Math.sin(cop.angle) * cop.speed * dt,
      CAR.length / 2 - 4,
    );
    if (hit) cop.speed *= 0.7;
    // Ram a fleeing car to slow it down. A parked car is not rammed —
    // the cruisers pull up and wait, which is what lets a player hide.
    if (player.inCar && player.inCar.speed > 40 && dist < CAR.length && cop.ramCooldown <= 0) {
      cop.ramCooldown = POLICE.ramCooldown;
      player.inCar.health -= POLICE.ramDamage;
      player.inCar.speed *= 0.75;
      callAudio(world, 'crash');
    }
    // On foot and close, with the cruiser pulled up beside the player:
    // the bust timer runs. A cruiser driving past at speed does not bust you.
    if (!player.inCar && dist < POLICE.bustDistance && Math.abs(cop.speed) < 120) {
      player.bustTimer += dt;
      if (player.bustTimer >= POLICE.bustSeconds) {
        world.over = 'busted';
        callAudio(world, 'busted');
        return;
      }
    } else {
      player.bustTimer = Math.max(0, player.bustTimer - dt * 2);
    }
    // At three stars and up, cops shoot at a player on foot.
    if (world.wanted >= POLICE.shootMinWanted && !player.inCar && dist < POLICE.shootRange && cop.shootTimer <= 0) {
      cop.shootTimer = POLICE.shootCooldown;
      player.health -= POLICE.shootDamage;
      world.tracers.push({ x1: cop.x, y1: cop.y, x2: player.x, y2: player.y, life: 0.12 });
      callAudio(world, 'shot');
    }
    if (cop.health <= 0) {
      world.police.splice(i, 1);
      world.stats.copsDown += 1;
      addWanted(world, WANTED.killCop);
      callAudio(world, 'explosion');
    }
  }
  if (world.police.length > 0) callAudio(world, 'siren', true);
  else callAudio(world, 'siren', false);
}

function updateWanted(world, dt) {
  if (world.wanted <= 0) return;
  let near = false;
  for (const cop of world.police) {
    const dx = cop.x - world.player.x;
    const dy = cop.y - world.player.y;
    if (dx * dx + dy * dy < 700 * 700) {
      near = true;
      break;
    }
  }
  if (near) {
    world.coldTimer = 0;
  } else {
    world.coldTimer += dt;
    if (world.coldTimer >= WANTED.decaySeconds) {
      world.wanted -= 1;
      world.coldTimer = 0;
    }
  }
}

function punch(world) {
  const player = world.player;
  let best = null;
  let bestSq = PLAYER.punchRange * PLAYER.punchRange;
  const consider = (obj) => {
    const dx = obj.x - player.x;
    const dy = obj.y - player.y;
    const sq = dx * dx + dy * dy;
    if (sq < bestSq) {
      const facing = Math.abs(angDiff(Math.atan2(dy, dx), player.angle));
      if (facing < 1.3) {
        bestSq = sq;
        best = obj;
      }
    }
  };
  for (const ped of world.peds) if (ped.state !== 'down') consider(ped);
  for (const cop of world.police) consider(cop);
  if (!best) {
    callAudio(world, 'punch');
    return;
  }
  best.health -= PLAYER.punchDamage;
  const dx = best.x - player.x;
  const dy = best.y - player.y;
  const d = Math.hypot(dx, dy) || 1;
  best.x += (dx / d) * 26;
  best.y += (dy / d) * 26;
  callAudio(world, 'punch');
  if (best.health <= 0) {
    if (best.state !== undefined) {
      best.state = 'down';
      addWanted(world, WANTED.hitPed);
      world.stats.pedsDown += 1;
    }
  }
}

function shoot(world, aim) {
  const player = world.player;
  const dx = aim.x - player.x;
  const dy = aim.y - player.y;
  const len = Math.hypot(dx, dy) || 1;
  const dirX = dx / len;
  const dirY = dy / len;
  const rangeMax = 520;
  let hit = null;
  let hitDist = rangeMax;
  let endX = player.x + dirX * rangeMax;
  let endY = player.y + dirY * rangeMax;
  const test = (obj, radius) => {
    const ox = obj.x - player.x;
    const oy = obj.y - player.y;
    const along = ox * dirX + oy * dirY;
    if (along < 0 || along > hitDist) return;
    const perp = Math.abs(-ox * dirY + oy * dirX);
    if (perp < radius) {
      hit = obj;
      hitDist = along;
      endX = obj.x;
      endY = obj.y;
    }
  };
  for (const cop of world.police) test(cop, 30);
  for (const ped of world.peds) if (ped.state !== 'down') test(ped, 22);
  for (const car of world.cars) {
    if (car === player.inCar) continue;
    test(car, 30);
  }
  world.tracers.push({ x1: player.x, y1: player.y, x2: endX, y2: endY, life: 0.1 });
  world.stats.shots += 1;
  addWanted(world, WANTED.shoot);
  callAudio(world, 'shot');
  if (!hit) return;
  world.stats.hits += 1;
  hit.health -= PLAYER.bulletDamage;
  if (hit.health <= 0) {
    if (hit.state !== undefined) {
      hit.state = 'down';
      addWanted(world, WANTED.hitPed);
      world.stats.pedsDown += 1;
    }
    // A cop at zero health is taken off the street by updatePolice, which
    // adds the kill heat and counts it there — not here, to avoid counting twice.
  }
}
