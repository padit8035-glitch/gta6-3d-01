// Play the real 3D game in headless Chromium with real keyboard and mouse
// input, then take the four screenshots (title, drive, chase, mission).
// Run with `node browser-test.mjs`. Exit 0 means every check passed.
// Needs playwright-core in /tmp/pw/node_modules and Chromium under
// ~/.cache/ms-playwright (as used by the 2D entry).
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(join(here, '..', 'pw', 'package.json'));
const { chromium } = require('playwright-core');

const PORT = 8903; // not serve.ts's default 8080, so this test never
// clashes with a game left running in another terminal (or the 2D entry).
const failures = [];
const notes = [];

function check(name, ok, detail) {
  if (ok) notes.push(`PASS ${name} — ${detail}`);
  else failures.push(`FAIL ${name} — ${detail}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until the chase camera has eased into place behind the car — or
 * 12 s pass. The camera eases toward a moving target, so the gap never
 * quite reaches zero while the car is driving; under 150 world units is
 * close enough for a settled frame. A fixed sleep is not enough: under
 * headless software rendering the page runs near 3 FPS, and on a loaded
 * machine far fewer frames run before the shot, which used to produce
 * blank sky frames (the camera still far from the car, everything fogged
 * out) or a high unsettled view with the car hidden behind a building.
 */
async function waitCameraSettled(shotPage) {
  const started = Date.now();
  while (Date.now() - started < 12000) {
    const gap = await shotPage.evaluate(() => {
      const vp = window.__vp3;
      if (!vp) return null;
      const w = vp.world;
      const c = vp.camInfo();
      const focus = w.player.inCar || w.player;
      const heading = focus.angle + c.yaw;
      const dist = w.player.inCar ? c.dist + 10 : c.dist;
      const ex = focus.x - Math.cos(heading) * dist;
      const ey = focus.y - Math.sin(heading) * dist;
      return Math.hypot(c.camPos[0] - ex, -c.camPos[2] - ey);
    });
    if (gap !== null && gap < 150) return;
    await sleep(400);
  }
}

async function main() {
  const server = spawn('node', [join(here, 'serve.ts'), '--port', String(PORT)], { stdio: 'pipe' });
  let serverUp = false;
  server.stdout.on('data', () => { serverUp = true; });
  for (let i = 0; i < 50 && !serverUp; i += 1) await sleep(100);
  const home = process.env.HOME ?? '';
  const candidates = [
    join(home, '.cache/ms-playwright/chromium-1148/chrome-linux/chrome'),
    join(home, '.cache/ms-playwright/chromium_headless_shell-1148/chrome-linux/headless_shell'),
  ];
  const executablePath = candidates.find((p) => existsSync(p));
  if (!executablePath) throw new Error('no Chromium found under ~/.cache/ms-playwright');
  const browser = await chromium.launch({ executablePath, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(`http://localhost:${PORT}/?seed=7`, { waitUntil: 'load' });
    await sleep(1200);

    const state = () => page.evaluate(() => {
      const vp = window.__vp3;
      if (!vp) return null;
      const w = vp.world;
      return {
        screen: vp.getState(),
        x: Math.round(w.player.x),
        y: Math.round(w.player.y),
        money: w.player.money,
        health: Math.round(w.player.health),
        inCar: Boolean(w.player.inCar),
        speed: w.player.inCar ? Math.round(Math.abs(w.player.inCar.speed)) : 0,
        wanted: w.wanted,
        mission: w.missions.index,
        missionActive: w.missions.active,
        over: w.over,
      };
    });

    // B1 — the title screen, then Start begins play.
    let s = await state();
    check('B1 title screen', s && s.screen === 'menu', `screen=${s && s.screen}`);
    await page.click('#btn-start');
    await sleep(600);
    s = await state();
    check('B1 Start begins play', s && s.screen === 'playing', `screen=${s && s.screen}`);

    // B2 — walking with W moves the player north. Headless software
    // rendering runs near 3 FPS and the sim is capped at 4 steps/frame,
    // so the game advances slower than real time: hold the key and
    // accept a smaller move.
    const y0 = s.y;
    await page.keyboard.down('KeyW');
    await sleep(4000);
    await page.keyboard.up('KeyW');
    s = await state();
    check('B2 walk north with W', s && s.y > y0 + 30, `y ${y0} -> ${s && s.y}`);

    // B3 — teleport next to a parked car, hold E to get in. The key is
    // held 900 ms so the press is seen across several frames of the sim
    // loop (a tap shorter than one frame can be missed entirely).
    await page.evaluate(() => {
      const vp = window.__vp3;
      const w = vp.world;
      let best = null; let bestD = Infinity;
      for (const c of w.cars) {
        if (c.kind !== 'parked') continue;
        const d = Math.hypot(c.x - w.player.x, c.y - w.player.y);
        if (d < bestD && d > 60) { bestD = d; best = c; }
      }
      if (best) vp.teleport(best.x + 12, best.y + 12);
    });
    await sleep(300);
    await page.keyboard.down('KeyE');
    await sleep(900);
    await page.keyboard.up('KeyE');
    await sleep(400);
    s = await state();
    check('B3 E enters a car', s && s.inCar, `inCar=${s && s.inCar}`);

    // B4 — driving with W builds speed.
    await page.keyboard.down('KeyW');
    await sleep(5000);
    await page.keyboard.up('KeyW');
    s = await state();
    check('B4 drive builds speed', s && s.speed > 40, `speed=${s && s.speed}`);

    // B5 — P pauses, P resumes.
    await page.keyboard.down('KeyP');
    await sleep(600);
    await page.keyboard.up('KeyP');
    await sleep(400);
    s = await state();
    check('B5 P pauses', s && s.screen === 'paused', `screen=${s && s.screen}`);
    await page.keyboard.down('KeyP');
    await sleep(600);
    await page.keyboard.up('KeyP');
    await sleep(400);
    s = await state();
    check('B5 P resumes', s && s.screen === 'playing', `screen=${s && s.screen}`);

    // B6 — F punches (on foot only, so exit the car first), no errors.
    await page.keyboard.down('KeyE');
    await sleep(900);
    await page.keyboard.up('KeyE');
    await sleep(400);
    s = await state();
    check('B6 E exits the car', s && !s.inCar, `inCar=${s && s.inCar}`);
    await page.keyboard.down('KeyF');
    await sleep(600);
    await page.keyboard.up('KeyF');
    await sleep(300);
    s = await state();
    check('B6 F punches without error', Boolean(s), `screen=${s && s.screen}`);

    // B7 — mouse click shoots (pistol) without error.
    await page.mouse.click(640, 360);
    await sleep(300);
    s = await state();
    check('B7 click shoots without error', Boolean(s), `screen=${s && s.screen}`);

    // B8 — no console errors or page errors through all of that.
    check('B8 no console/page errors', errors.length === 0, errors.length === 0 ? 'clean' : errors.slice(0, 3).join(' | '));

    // Screenshots: one page per scene, staged by the game itself.
    // The first (B-test) page keeps animating its own game, which starves
    // the shot pages of the software renderer under headless Chromium —
    // close it first, or the shots come out blank.
    await page.close();
    const shots = [
      { scene: 'title', file: '1-start.jpg' },
      { scene: 'drive', file: '2-drive.jpg' },
      { scene: 'chase', file: '3-chase.jpg' },
      { scene: 'mission', file: '4-mission.jpg' },
    ];
    for (const shot of shots) {
      const shotPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      shotPage.on('console', (message) => {
        if (message.type() === 'error') errors.push(`[${shot.scene}] ${message.text()}`);
      });
      shotPage.on('pageerror', (error) => errors.push(`[${shot.scene}] ${String(error)}`));
      await shotPage.goto(`http://localhost:${PORT}/?scene=${shot.scene}&seed=7`, { waitUntil: 'load' });
      await sleep(1500);
      if (shot.scene !== 'title') {
        // Hide the menu so the shot shows the game, not the title overlay.
        await shotPage.evaluate(() => window.__vp3.start());
        // Let the camera ease into place behind the car before the shot.
        await waitCameraSettled(shotPage);
      }
      // Take up to 3 shots and keep the most detailed one: a blank frame
      // (all sky, e.g. before the first present) compresses far smaller
      // than a real view of the city, so the biggest file is the real one.
      // Takes go to /tmp so a failed run never leaves junk in screenshots/.
      const finalOut = join(here, 'screenshots', shot.file);
      const tmpOut = join('/tmp', `vp3-shot-${shot.scene}.jpg`);
      let bestBytes = 0;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await shotPage.screenshot({ path: tmpOut, type: 'jpeg', quality: 80 });
        const bytes = statSync(tmpOut).size;
        if (bytes > bestBytes) {
          bestBytes = bytes;
          copyFileSync(tmpOut, finalOut);
          if (bytes >= 40000) break;
        }
        await sleep(1500);
      }
      unlinkSync(tmpOut);
      check(`Shot ${shot.scene}`, bestBytes > 10000 && bestBytes <= 256 * 1024, `${shot.file} ${Math.round(bestBytes / 1024)} KiB`);
      await shotPage.close();
    }
    check('B8b no errors in screenshot pages', errors.length === 0, errors.length === 0 ? 'clean' : errors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    server.kill();
  }
  for (const n of notes) console.log(n);
  for (const f of failures) console.log(f);
  if (failures.length > 0) {
    console.log(`${failures.length} BROWSER TEST(S) FAILED`);
    process.exit(1);
  }
  console.log('ALL BROWSER TESTS PASSED');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
