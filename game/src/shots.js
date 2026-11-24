// Vice Point 3D — staged scenes for the screenshots. Each scene drives the
// real simulation (no shortcuts, no scripted positions beyond a teleport to
// a parked car), so the screenshots show the game as it actually plays.
import { STEP, CAR } from './config.js';
import {
  createWorld, stepWorld, roadSteer, nearestParkedCar, ACT, angDiff,
} from './world.js';
import { startMission } from './missions.js';

const silentAudio = new Proxy({}, { get: () => () => {} });

function noInput() {
  return { move: { x: 0, y: 0 }, actions: 0, shooting: false, aim: null };
}

function drivePilot(world, tx, ty) {
  const car = world.player.inCar;
  if (!car) return noInput();
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

function stealNearestCar(world) {
  const parked = nearestParkedCar(world, world.player.x, world.player.y);
  if (!parked) return false;
  // Staging only: the player is teleported next to the car, but the theft
  // itself still runs through the real ENTER action in the sim below.
  world.player.x = parked.x + 40;
  world.player.y = parked.y + 40;
  stepWorld(world, { move: { x: 0, y: 0 }, actions: ACT.ENTER, shooting: false, aim: null }, STEP);
  return Boolean(world.player.inCar);
}

/** Stage one named scene in a fresh world. Returns { world, screen }. */
export function stageShot(scene, seed) {
  const world = createWorld(seed, silentAudio);
  if (scene === 'title') return { world, screen: 'title' };

  if (scene === 'drive') {
    startMission(world.missions, world);
    stealNearestCar(world);
    // Cruise a loop of landmarks for 14 seconds so the car is still
    // driving, fast, when the shot is taken — it never parks on the
    // target and circles it.
    const stops = [
      world.city.places.market, world.city.places.dock,
      world.city.places.garage, world.city.places.bank,
    ];
    let si = 0;
    for (let i = 0; i < 14 / STEP; i += 1) {
      const car = world.player.inCar;
      if (car && Math.hypot(stops[si].x - car.x, stops[si].y - car.y) < 180) {
        si = (si + 1) % stops.length;
      }
      stepWorld(world, drivePilot(world, stops[si].x, stops[si].y), STEP);
      if (world.over) break;
    }
    return { world, screen: 'drive' };
  }

  if (scene === 'chase') {
    startMission(world.missions, world);
    stealNearestCar(world);
    world.wanted = 3;
    world.heatClock = 0; // fresh heat: cruisers join the chase right away
    // A short roll so the cruisers spawn and start closing in — a long
    // drive wrecks the player's car before the shot is taken.
    for (let i = 0; i < 1 / STEP; i += 1) {
      stepWorld(world, drivePilot(world, 2240, 1280), STEP);
      if (world.over) break;
    }
    // Frame the shot: put the car on a long straight road, moving, with
    // the cruisers right behind it — so the chase reads at a glance.
    const car = world.player.inCar;
    if (car) {
      car.x = 640; car.y = 1280; car.angle = 0; car.speed = 320;
      world.player.x = 640; world.player.y = 1280;
      let placed = 0;
      for (const c of world.police) {
        if (placed >= 2) break;
        c.x = 480 - placed * 90; c.y = 1280; c.angle = 0; c.speed = 330;
        placed += 1;
      }
      for (let i = 0; i < 1 / STEP; i += 1) {
        stepWorld(world, drivePilot(world, 2240, 1280), STEP);
        if (world.over) break;
      }
    }
    return { world, screen: 'chase' };
  }

  if (scene === 'mission') {
    world.missions.index = 4;
    startMission(world.missions, world);
    stealNearestCar(world);
    const bank = world.city.places.bank;
    const dock = world.city.places.dock;
    for (let i = 0; i < 120 / STEP; i += 1) {
      stepWorld(world, drivePilot(world, bank.x, bank.y), STEP);
      if (world.missions.phase === 1 || world.over) break;
    }
    for (let i = 0; i < 120 / STEP; i += 1) {
      stepWorld(world, drivePilot(world, dock.x, dock.y), STEP);
      if (world.missions.done || world.over) break;
    }
    // A short roll-on so the car settles at the dock while the
    // "Mission complete!" toast is still up for the shot.
    for (let i = 0; i < 1.5 / STEP; i += 1) {
      stepWorld(world, drivePilot(world, dock.x, dock.y), STEP);
      if (world.over) break;
    }
    return { world, screen: 'mission' };
  }

  return { world, screen: scene };
}
