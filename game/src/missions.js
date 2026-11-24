// Vice Point 3D — the story: five jobs from Rico, the fixer who runs
// Vice Point from his garage on the north side. Each job is a small state
// machine: start it, chase its marker, finish it for cash, and the next one
// opens. A timed job that runs out simply restarts; the story never
// dead-ends. Pure logic, no DOM, no three.js.
import { MISSIONS } from './config.js';
import { nearestRoad } from './city.js';
import { makePickup } from './entities.js';

const PAYDAY_DROPS = 6;
const COURIER_SECONDS = 100;

export function createMissionState() {
  return {
    index: 0,
    active: false,
    phase: 0,
    timer: 0,
    dropsLeft: 0,
    target: null,
    done: false,
    toast: '',
    toastTimer: 0,
    chainTimer: 0, // seconds until the next job auto-starts after one ends
  };
}

export function currentMission(state) {
  return state.index < MISSIONS.length ? MISSIONS[state.index] : null;
}

export function objectiveText(state) {
  if (state.done) return 'Story complete — Vice Point is yours.';
  const mission = currentMission(state);
  if (!mission) return '';
  if (!state.active) return `Talk to Rico — ${mission.name} is waiting.`;
  if (mission.id === 'wheels') return 'Steal a car and bring it to Rico’s Garage.';
  if (mission.id === 'courier') {
    return `Deliver the package to Palm Market — ${Math.ceil(state.timer)}s left.`;
  }
  if (mission.id === 'heat') return 'Lose the heat — get to the Hideout.';
  if (mission.id === 'payday') {
    // dropsLeft counts DOWN from 6, so the HUD shows collected as total
    // minus remaining — "3/6" after three drops, not "3 left".
    return `Collect the cash drops — ${PAYDAY_DROPS - state.dropsLeft}/${PAYDAY_DROPS}.`;
  }
  if (mission.id === 'score') {
    return state.phase === 0
      ? 'Get to Vice Point Bank.'
      : 'Grab the bag and reach the South Dock — the cops are coming.';
  }
  return mission.name;
}

export function missionTarget(state) {
  return state.target;
}

function setTarget(state, place) {
  state.target = { x: place.x, y: place.y, label: place.label };
}

function playerNear(world, target, radius) {
  if (!target) return false;
  const dx = world.player.x - target.x;
  const dy = world.player.y - target.y;
  return dx * dx + dy * dy < radius * radius;
}

/** Begin the current job: place its marker, its drops and its heat. */
export function startMission(state, world) {
  const mission = currentMission(state);
  if (!mission) return;
  state.active = true;
  state.phase = 0;
  state.timer = 0;
  state.dropsLeft = 0;
  const places = world.city.places;
  if (mission.id === 'wheels') {
    setTarget(state, places.garage);
    state.toast = 'Rico: I need wheels. Any car. Bring it to my garage.';
  } else if (mission.id === 'courier') {
    setTarget(state, places.market);
    state.timer = COURIER_SECONDS;
    state.toast = 'Rico: Package for Palm Market. Fast. 100 seconds.';
  } else if (mission.id === 'heat') {
    setTarget(state, places.hideout);
    world.wanted = 3;
    world.heatClock = 0; // fresh heat: cruisers join the chase right away
    state.toast = 'Rico: Three stars on you. Lose them at the Hideout.';
  } else if (mission.id === 'payday') {
    state.dropsLeft = PAYDAY_DROPS;
    for (let i = 0; i < PAYDAY_DROPS; i += 1) {
      const angle = (i / PAYDAY_DROPS) * Math.PI * 2 + 0.4;
      const radius = 420 + (i % 3) * 260;
      let x = places.market.x + Math.cos(angle) * radius;
      let y = places.market.y + Math.sin(angle) * radius;
      // Clamp each drop inside the city, then nudge it onto the nearest
      // road so it is never inside a building or unreachable on foot.
      x = Math.max(80, Math.min(2480, x));
      y = Math.max(80, Math.min(2480, y));
      // Nudge each drop onto the nearest road so it is never inside a building.
      if (Math.abs(x - nearestRoad(x)) < Math.abs(y - nearestRoad(y))) x = nearestRoad(x);
      else y = nearestRoad(y);
      const drop = makePickup(x, y, 'cash', 150);
      drop.mission = true;
      world.pickups.push(drop);
    }
    state.toast = 'Rico: Six drops stashed around town. Collect them all.';
  } else if (mission.id === 'score') {
    setTarget(state, places.bank);
    state.toast = 'Rico: The Big Score. The bank. Then the dock. No mistakes.';
  }
  state.toastTimer = 5;
}

/**
 * Advance the active job one step. Returns 'done' when it completes,
 * 'failed' when a timed job runs out (it restarts), or '' otherwise.
 */
export function tickMissions(state, world, dt) {
  if (state.toastTimer > 0) state.toastTimer -= dt;
  const mission = currentMission(state);
  if (!mission || !state.active) return '';
  if (mission.id === 'wheels') {
    if (world.player.inCar && playerNear(world, state.target, 110)) return 'done';
  } else if (mission.id === 'courier') {
    state.timer -= dt;
    if (playerNear(world, state.target, 100)) return 'done';
    if (state.timer <= 0) return 'failed';
  } else if (mission.id === 'heat') {
    if (playerNear(world, state.target, 110)) {
      world.wanted = 0;
      return 'done';
    }
  } else if (mission.id === 'payday') {
    if (state.dropsLeft <= 0) return 'done';
  } else if (mission.id === 'score') {
    if (state.phase === 0) {
      if (playerNear(world, state.target, 100)) {
        state.phase = 1;
        world.wanted = 3;
        world.heatClock = 0; // fresh heat: cruisers join the chase right away
        setTarget(state, world.city.places.dock);
        state.toast = 'Bag grabbed! Three stars! Get to the South Dock!';
        state.toastTimer = 5;
      }
    } else if (playerNear(world, state.target, 110)) {
      world.wanted = 0;
      return 'done';
    }
  }
  return '';
}

/** Pay the reward, close the job and open the next one. */
export function finishMission(state, world) {
  const mission = currentMission(state);
  if (!mission) return 0;
  world.player.money += mission.reward;
  state.index += 1;
  state.active = false;
  state.target = null;
  if (state.index >= MISSIONS.length) state.done = true;
  return mission.reward;
}

/** Restart the current job after a failure (timer ran out). */
export function restartMission(state, world) {
  state.active = false;
  state.target = null;
  world.pickups = world.pickups.filter((p) => !(p.kind === 'cash' && p.mission));
  startMission(state, world);
}
