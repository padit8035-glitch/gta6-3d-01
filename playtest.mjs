// Headless play-test for Vice Point 3D: run the real world rules in Node
// (no browser, no canvas) with a silent audio stub, drive the scenes the
// way a player would, and report what happened. Run with `node playtest.mjs`.
// Exit code 0 means every check passed; anything else is a bug to fix.
import { CAR, STEP } from './game/src/config.js';
import { createWorld, stepWorld, roadSteer, nearestParkedCar, ACT, angDiff } from './game/src/world.js';
import { stageShot } from './game/src/shots.js';
import { startMission } from './game/src/missions.js';
import { nearestRoad, onHorizontalRoad, onVerticalRoad, collidesBuilding } from './game/src/city.js';
import { makeCar } from './game/src/entities.js';

const failures = [];
const notes = [];

function check(name, ok, detail) {
  if (ok) notes.push(`PASS ${name} — ${detail}`);
  else failures.push(`FAIL ${name} — ${detail}`);
}

const silentAudio = new Proxy({}, { get: () => () => {} });

function noInput() {
  return { move: { x: 0, y: 0 }, actions: 0, shooting: false, aim: null };
}

/** Drive a car along the roads toward a point, braking before sharp turns. */
function drivePilot(world, tx, ty) {
  const car = world.player.inCar;
  if (!car) return walkPilot(world, tx, ty);
  const drive = roadSteer(world, car, tx, ty);
  const dist = Math.hypot(tx - car.x, ty - car.y);
  const err = Math.abs(angDiff(drive.wantAngle, car.angle));
  let targetSpeed = 380; // cruise: fast enough to feel quick, slow enough to brake for a turn
  if (dist < 300) targetSpeed = 160;
  if (err > 0.5) targetSpeed = Math.min(targetSpeed, 100);
  else if (drive.turning) targetSpeed = Math.min(targetSpeed, 120);
  let throttle = 0;
  if (car.speed < targetSpeed - 10) throttle = 1;
  else if (car.speed > targetSpeed + 30) throttle = -1;
  return { move: { x: drive.steer, y: throttle }, actions: 0, shooting: false, aim: null };
}

/** True when the straight line between two points clears every building. */
function clearPath(world, x1, y1, x2, y2) {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.ceil(dist / 20);
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    if (collidesBuilding(world.city, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, 14)) return false;
  }
  return true;
}

/** Walk along the roads toward a point: cross at intersections, never cut through blocks. */
function walkPilot(world, tx, ty) {
  const p = world.player;
  // A clear straight line (into a parking lot, across a plaza) beats the roads.
  if (clearPath(world, p.x, p.y, tx, ty)) {
    const dx = tx - p.x;
    const dy = ty - p.y;
    const dist = Math.hypot(dx, dy) || 1;
    return { move: { x: dx / dist, y: dy / dist }, actions: 0, shooting: false, aim: null, run: world.wanted > 0 };
  }
  const onH = onHorizontalRoad(p.x, p.y);
  const onV = onVerticalRoad(p.x, p.y);
  let wx;
  let wy;
  if (onH && !onV) {
    wx = p.x + Math.sign(tx - p.x) * 160;
    wy = nearestRoad(p.y);
  } else if (onV && !onH) {
    wx = nearestRoad(p.x);
    wy = p.y + Math.sign(ty - p.y) * 160;
  } else if (onH && onV) {
    if (Math.abs(tx - p.x) > Math.abs(ty - p.y)) {
      wx = p.x + Math.sign(tx - p.x) * 160;
      wy = nearestRoad(p.y);
    } else {
      wx = nearestRoad(p.x);
      wy = p.y + Math.sign(ty - p.y) * 160;
    }
  } else {
    wx = nearestRoad(p.x);
    wy = nearestRoad(p.y);
  }
  const dx = wx - p.x;
  const dy = wy - p.y;
  const dist = Math.hypot(dx, dy) || 1;
  return { move: { x: dx / dist, y: dy / dist }, actions: 0, shooting: false, aim: null, run: world.wanted > 0 };
}

function stepN(world, seconds, inputFn) {
  for (let i = 0; i < seconds / STEP; i += 1) {
    stepWorld(world, inputFn ? inputFn(i) : noInput(), STEP);
    if (world.over) break;
  }
}

// T1 — the drive scene: after staging, the player must be in a moving car.
{
  const { world } = stageShot('drive', 7);
  const car = world.player.inCar;
  check(
    'T1 drive scene',
    Boolean(car) && Math.abs(car.speed) > 100 && !world.over,
    car
      ? `inCar=yes speed=${Math.round(Math.abs(car.speed))} (${Math.round(Math.abs(car.speed) * 0.14)} mph) health=${Math.round(car.health)} wanted=${world.wanted} over=${world.over}`
      : `inCar=no player=(${Math.round(world.player.x)},${Math.round(world.player.y)}) over=${world.over}`,
  );
}

// T2 — the chase scene: after staging, the player must not be busted.
{
  const { world } = stageShot('chase', 7);
  check(
    'T2 chase scene',
    world.over !== 'busted' && world.over !== 'wasted',
    `over=${world.over} wanted=${world.wanted} cops=${world.police.length} inCar=${Boolean(world.player.inCar)} carHealth=${world.player.inCar ? Math.round(world.player.inCar.health) : 'n/a'}`,
  );
}

// T3 — mission 1, played like a player: walk to a parked car, steal it,
// drive to Rico's Garage, and the mission must complete with the reward paid.
{
  const world = createWorld(7, silentAudio);
  startMission(world.missions, world);
  const startMoney = world.player.money;
  let entered = false;
  let done = false;
  for (let step = 0; step < 120 * 60 && !done && !world.over; step += 1) {
    const target = nearestParkedCar(world, world.player.x, world.player.y);
    if (!world.player.inCar && target) {
      const dx = target.x - world.player.x;
      const dy = target.y - world.player.y;
      if (Math.hypot(dx, dy) < 70) {
        stepWorld(world, { move: { x: 0, y: 0 }, actions: ACT.ENTER, shooting: false, aim: null }, STEP);
        entered = world.player.inCar !== null;
      } else {
        stepWorld(world, walkPilot(world, target.x, target.y), STEP);
      }
    } else if (world.player.inCar) {
      const garage = world.city.places.garage;
      stepWorld(world, drivePilot(world, garage.x, garage.y), STEP);
      if (world.missions.index > 0) done = true;
    } else {
      stepWorld(world, noInput(), STEP);
    }
  }
  check(
    'T3 mission 1 completes',
    done && world.player.money > startMoney,
    `entered=${entered} index=${world.missions.index} money=$${world.player.money} (was $${startMoney}) over=${world.over}`,
  );
}

// T4 — wanted decays when no cop is anywhere near the player. The trail
// is cold (no fresh crime for a long time), so no reinforcements arrive.
// heatClock = 100 means the last crime was 100 s ago, past the 10 s window
// in which new cruisers join; 50 s of quiet covers two 22 s decay ticks.
{
  const world = createWorld(7, silentAudio);
  world.player.x = 1280;
  world.player.y = 1280;
  world.wanted = 2;
  world.heatClock = 100;
  world.police.length = 0;
  for (let i = 0; i < 50 / STEP; i += 1) {
    stepWorld(world, noInput(), STEP);
  }
  check('T4 wanted decays', world.wanted === 0, `wanted=${world.wanted} after 50 s with no cops near`);
}

// T5 — combat: shooting at a cop damages it and raises the wanted level.
{
  const world = createWorld(7, silentAudio);
  const cop = makeCar('police', world.player.x, world.player.y + 194, 0, world.rand);
  cop.speed = 0;
  world.police.push(cop);
  const before = world.wanted;
  for (let i = 0; i < 3; i += 1) {
    stepWorld(world, { move: { x: 0, y: 0 }, actions: 0, shooting: true, aim: { x: cop.x, y: cop.y } }, STEP);
    for (let j = 0; j < 20; j += 1) stepWorld(world, noInput(), STEP);
  }
  check(
    'T5 shooting a cop',
    cop.health < 100 && world.wanted > before,
    `cop health=${Math.round(cop.health)} wanted=${before} -> ${world.wanted}`,
  );
}

// T6 — traffic keeps flowing: after 60 s of play, no traffic car is stuck on
// a building and the count near the player stays full.
{
  const world = createWorld(7, silentAudio);
  stepN(world, 60, () => ({ move: { x: 1, y: 0 }, actions: 0, shooting: false, aim: null }));
  let onBuilding = 0;
  let traffic = 0;
  for (const car of world.cars) {
    if (car.kind !== 'traffic') continue;
    traffic += 1;
    for (const b of world.city.buildings) {
      if (car.x > b.x - b.w / 2 - 20 && car.x < b.x + b.w / 2 + 20
        && car.y > b.y - b.d / 2 - 20 && car.y < b.y + b.d / 2 + 20) {
        onBuilding += 1;
        break;
      }
    }
  }
  check('T6 traffic flows', traffic >= 14 && onBuilding === 0, `traffic=${traffic} cars on buildings=${onBuilding}`);
}

// T7 — determinism: the same seed and the same inputs give the same world.
{
  const a = createWorld(7, silentAudio);
  const b = createWorld(7, silentAudio);
  const input = () => ({ move: { x: 0.5, y: -1 }, actions: 0, shooting: false, aim: null });
  stepN(a, 10, input);
  stepN(b, 10, input);
  const same = Math.abs(a.player.x - b.player.x) < 0.001
    && Math.abs(a.player.y - b.player.y) < 0.001
    && a.cars.length === b.cars.length;
  check('T7 deterministic', same, `player a=(${a.player.x.toFixed(1)},${a.player.y.toFixed(1)}) b=(${b.player.x.toFixed(1)},${b.player.y.toFixed(1)}) cars=${a.cars.length}/${b.cars.length}`);
}

// T8 — the whole story, played by the pilots: mission 1 (steal a car,
// garage), 2 (courier to the market), 3 (heat: lose the cops at the
// Hideout), 4 (payday: six cash drops), 5 (the Big Score: bank, then dock).
// The 900 s cap is a safety net only — the story takes about 98 s.
{
  const world = createWorld(7, silentAudio);
  let steps = 0;
  let bustedOrWasted = false;
  while (!world.missions.done && steps < 900 * 60 && !world.over) {
    steps += 1;
    if (!world.missions.active && !world.missions.done) startMission(world.missions, world);
    const target = world.missions.target;
    if (!world.player.inCar) {
      const parked = nearestParkedCar(world, world.player.x, world.player.y);
      if (parked) {
        const dx = parked.x - world.player.x;
        const dy = parked.y - world.player.y;
        if (Math.hypot(dx, dy) < 70) {
          stepWorld(world, { move: { x: 0, y: 0 }, actions: ACT.ENTER, shooting: false, aim: null }, STEP);
          continue;
        }
        stepWorld(world, walkPilot(world, parked.x, parked.y), STEP);
        continue;
      }
      stepWorld(world, noInput(), STEP);
      continue;
    }
    if (target) {
      stepWorld(world, drivePilot(world, target.x, target.y), STEP);
    } else {
      let best = null;
      let bestSq = Infinity;
      for (const pickup of world.pickups) {
        if (pickup.kind !== 'cash' || !pickup.mission) continue;
        const dx = pickup.x - world.player.x;
        const dy = pickup.y - world.player.y;
        const sq = dx * dx + dy * dy;
        if (sq < bestSq) {
          bestSq = sq;
          best = pickup;
        }
      }
      if (best) stepWorld(world, drivePilot(world, best.x, best.y), STEP);
      else stepWorld(world, noInput(), STEP);
    }
    if (world.over) bustedOrWasted = true;
  }
  check(
    'T8 full story completes',
    world.missions.done && !bustedOrWasted,
    `done=${world.missions.done} index=${world.missions.index} money=$${world.player.money} time=${Math.round(steps / 60)}s over=${world.over}`,
  );
}

for (const note of notes) console.log(note);
for (const failure of failures) console.log(failure);
console.log(failures.length === 0 ? 'ALL PLAY-TESTS PASSED' : `${failures.length} PLAY-TEST(S) FAILED`);
process.exit(failures.length === 0 ? 0 : 1);
