// Vice Point 3D — the moving things: cars, pedestrians and police cruisers.
// Plain data factories; the simulation in world.js moves them, the renderer
// in render3d.js draws them. No DOM and no three.js here.
import { CAR } from './config.js';
import { pick } from './rng.js';

const PAINT = [
  0xd84a3a, 0x3a7bd8, 0xe8c33a, 0x3fbf6f, 0xe8e4da,
  0x8a5fbf, 0xd8733a, 0x4ab8c9, 0x9aa0a8, 0xc23a6e,
];

export function makeCar(kind, x, y, angle, rand) {
  return {
    kind, // 'parked' | 'traffic' | 'police' | 'player'
    x,
    y,
    angle,
    speed: 0,
    color: kind === 'police' ? 0x1a1d22 : pick(rand, PAINT),
    health: kind === 'police' ? 100 : CAR.health,
    cruise: 0, // traffic cruising speed
    route: 0, // traffic heading axis: 0 = east-west, 1 = north-south
    dir: 1,
    stuck: 0,
    flash: 0, // police light-bar phase (seconds); the renderer blinks on it
    shootTimer: 0,
    ramCooldown: 0,
    crashTimer: 0, // seconds until the next building-hit dent
    lastSeen: 0, // seconds since this cruiser was close to the player; the
    // chase gives up after 25 s without a sighting (see world.js)
    gone: false, // true once the car is wrecked and removed from the world
  };
}

export function makePed(x, y, rand) {
  return {
    x,
    y,
    angle: rand() * Math.PI * 2,
    speed: 0,
    state: 'walk', // 'walk' | 'flee' | 'down'
    stateTimer: 0,
    health: 40,
    shirt: pick(rand, [0xd84a3a, 0x3a7bd8, 0xe8c33a, 0x3fbf6f, 0xe8e4da, 0x8a5fbf]),
    skin: pick(rand, [0xe8b98a, 0xc98d5f, 0x8a5f3c, 0xf0c8a0]),
    fleeX: 0,
    fleeY: 0,
  };
}

export function makePickup(x, y, kind, value) {
  return { x, y, kind, value, mission: false, bob: 0 };
}
