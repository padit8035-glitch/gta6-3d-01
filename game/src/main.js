// Vice Point 3D — the browser entry. Wires the simulation, the renderer,
// the HUD, the input and the sound together: a fixed-step game loop, a
// start menu with an orbiting camera, pause, save and continue, and the
// busted/wasted respawn. URL parameters: ?scene=title|drive|chase|mission
// stages a screenshot scene, ?seed=N picks the city (default 7).
import { STEP, SAVE_KEY } from './config.js';
import { createWorld, stepWorld, ACT } from './world.js';
import { createRenderer } from './render3d.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { startMission, currentMission } from './missions.js';
import { stageShot } from './shots.js';

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') || 7) || 7;
const sceneParam = params.get('scene');

const canvas = document.getElementById('game-canvas');
const audio = createAudio();
const input = createInput(canvas);
let world = createWorld(seed, audio);
let state = 'menu'; // 'menu' | 'playing' | 'paused' | 'over'
let saveTimer = 0;

if (sceneParam && sceneParam !== 'title') {
  const staged = stageShot(sceneParam, seed);
  world = staged.world;
  world.audio = audio;
}
const renderer = createRenderer(canvas, world);
const hud = createHud(world);

const menuEl = document.getElementById('menu');
const pauseEl = document.getElementById('pause-menu');
const overEl = document.getElementById('over-screen');
const overTitle = document.getElementById('over-title');
const overText = document.getElementById('over-text');
const crosshair = document.getElementById('crosshair');
const btnStart = document.getElementById('btn-start');
const btnContinue = document.getElementById('btn-continue');
const btnResume = document.getElementById('btn-resume');
const btnRespawn = document.getElementById('btn-respawn');

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      money: Math.floor(world.player.money),
      missionIndex: world.missions.index,
      x: Math.round(world.player.x),
      y: Math.round(world.player.y),
      health: Math.round(world.player.health),
      clock: world.clock,
    }));
  } catch {
    // A browser that refuses storage still plays fine.
  }
}

function applySave(save) {
  world.player.money = save.money;
  world.player.health = save.health;
  world.player.x = save.x;
  world.player.y = save.y;
  world.missions.index = save.missionIndex;
  world.clock = save.clock || 0.08;
}

function startGame(useSave) {
  audio.unlock();
  if (useSave) {
    const save = loadSave();
    if (save) applySave(save);
  }
  menuEl.style.display = 'none';
  pauseEl.style.display = 'none';
  overEl.style.display = 'none';
  state = 'playing';
  if (!world.missions.active && !world.missions.done) startMission(world.missions, world);
  saveGame();
}

function togglePause() {
  if (state === 'playing') {
    state = 'paused';
    pauseEl.style.display = 'flex';
  } else if (state === 'paused') {
    state = 'playing';
    pauseEl.style.display = 'none';
  }
}

function respawn() {
  const fine = world.over === 'busted' ? 200 : 300;
  const player = world.player;
  player.x = world.city.start.x;
  player.y = world.city.start.y;
  player.angle = 0;
  player.health = 100;
  player.inCar = null;
  player.bustTimer = 0;
  player.money = Math.max(0, player.money - fine);
  world.wanted = 0;
  world.police.length = 0;
  world.over = null;
  world.missions.active = false;
  world.missions.target = null;
  world.missions.chainTimer = 0;
  overEl.style.display = 'none';
  state = 'playing';
  startMission(world.missions, world);
  saveGame();
}

btnStart.addEventListener('click', () => startGame(false));
btnContinue.addEventListener('click', () => startGame(true));
btnResume.addEventListener('click', togglePause);
btnRespawn.addEventListener('click', respawn);

const saved = loadSave();
btnContinue.style.display = saved ? 'inline-block' : 'none';

if (sceneParam && sceneParam !== 'title') {
  menuEl.style.display = 'none';
  state = 'playing';
  if (!world.missions.active && !world.missions.done && currentMission(world.missions)) {
    // The staged scene already started its mission; nothing more to do.
  }
}

function composeInput() {
  const player = world.player;
  const focus = player.inCar || player;
  const heading = focus.angle + renderer.cam.yaw;
  const forward = { x: Math.cos(heading), y: Math.sin(heading) };
  const right = { x: Math.cos(heading - Math.PI / 2), y: Math.sin(heading - Math.PI / 2) };
  const keys = input.keys;
  let move = { x: 0, y: 0 };
  if (player.inCar) {
    const throttle = (keys.has('w') || keys.has('arrowup') ? 1 : 0)
      - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
    const steer = (keys.has('a') || keys.has('arrowleft') ? 1 : 0)
      - (keys.has('d') || keys.has('arrowright') ? 1 : 0);
    move = { x: steer, y: throttle };
  } else {
    const f = (keys.has('w') || keys.has('arrowup') ? 1 : 0)
      - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
    const r = (keys.has('d') || keys.has('arrowright') ? 1 : 0)
      - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
    move = { x: forward.x * f + right.x * r, y: forward.y * f + right.y * r };
  }
  let actions = 0;
  if (input.wasPressed('f')) actions |= ACT.PUNCH;
  if (input.wasPressed('e')) actions |= ACT.ENTER;
  const shooting = !player.inCar && input.mouseDown;
  const aim = shooting
    ? renderer.screenToGround(window.innerWidth / 2, window.innerHeight / 2)
    : null;
  return {
    move,
    actions,
    shooting,
    aim,
    run: keys.has('shift'),
  };
}

let last = performance.now();
let acc = 0;
let time = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dtReal = Math.min(0.1, (now - last) / 1000);
  last = now;
  time += dtReal;

  if (input.wasPressed('p') || input.wasPressed('escape')) togglePause();
  if (input.wasPressed('m')) audio.setMuted(!audio.muted);
  if (state === 'menu' && input.wasPressed('enter')) startGame(false);

  // Camera orbit: drag to look around, wheel to zoom.
  const orbit = input.takeOrbit();
  renderer.cam.yaw -= orbit.dx * 0.005;
  renderer.cam.pitch = Math.max(0.15, Math.min(1.0, renderer.cam.pitch + orbit.dy * 0.003));
  renderer.cam.dist = Math.max(18, Math.min(70, renderer.cam.dist + orbit.zoom * 0.02));

  if (state === 'menu') {
    // The city stays alive behind the title screen, and the camera slowly
    // orbits it so the title shows the world moving, not a still image.
    // The sim is capped at 4 fixed steps per frame: at low frame rates
    // the game slows down instead of spiralling into a catch-up backlog.
    renderer.cam.yaw += dtReal * 0.05;
    acc += dtReal;
    let steps = 0;
    while (acc >= STEP && steps < 4) {
      stepWorld(world, { move: { x: 0, y: 0 }, actions: 0, shooting: false, aim: null }, STEP);
      acc -= STEP;
      steps += 1;
    }
  } else if (state === 'playing') {
    acc += dtReal;
    let steps = 0;
    while (acc >= STEP && steps < 4 && !world.over) {
      const simInput = composeInput();
      const events = stepWorld(world, simInput, STEP);
      // Edge-triggered keys (E to enter, F to punch) must fire once per
      // frame, not once per simulation step — otherwise one E press
      // enters the car and immediately exits it again in the same frame.
      input.endFrame();
      if (events.missionDone > 0) saveGame();
      acc -= STEP;
      steps += 1;
    }
    if (world.over) {
      state = 'over';
      overTitle.textContent = world.over === 'busted' ? 'BUSTED' : 'WASTED';
      overText.textContent = world.over === 'busted'
        ? 'Rico bailed you out. It cost you $200.'
        : 'You woke up at the clinic. It cost you $300.';
      overEl.style.display = 'flex';
      saveGame();
    }
    saveTimer += dtReal;
    if (saveTimer > 10) {
      saveTimer = 0;
      saveGame();
    }
  }

  crosshair.style.display = state === 'playing' && !world.player.inCar ? 'block' : 'none';
  renderer.render(dtReal, time);
  hud.update({ heading: (world.player.inCar || world.player).angle + renderer.cam.yaw });
  input.endFrame();
}
requestAnimationFrame(frame);

// Hooks for the play-test and the screenshot scripts (not part of play).
window.__vp3 = {
  world,
  getState: () => state,
  start: () => startGame(false),
  respawn,
  teleport(x, y) {
    world.player.x = x;
    world.player.y = y;
    if (world.player.inCar) {
      world.player.inCar.x = x;
      world.player.inCar.y = y;
    }
  },
  setWanted(n) { world.wanted = n; },
  skipToMission(i) {
    world.missions.index = i;
    world.missions.active = false;
    world.missions.target = null;
    startMission(world.missions, world);
  },
  camInfo() {
    const p = renderer.camera.position;
    const focus = world.player.inCar || world.player;
    return {
      camPos: [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)],
      yaw: +renderer.cam.yaw.toFixed(2),
      pitch: +renderer.cam.pitch.toFixed(2),
      dist: renderer.cam.dist,
      focusAt: [Math.round(focus.x), Math.round(focus.y)],
      focusAngle: +focus.angle.toFixed(2),
    };
  },
};
