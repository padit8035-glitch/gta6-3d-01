[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/padit8035-glitch/gta6-3d-01/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/padit8035-glitch/gta6-3d-01/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

# Vice Point 3D — an open-world crime game

[Play the bounty on make.fun](https://make.fun/bounty/gta6-01)

Vice Point 3D is a sun-soaked open-world crime game in three dimensions that
runs offline in a desktop browser from static files. Walk the streets or
steal a car and drive it, lose the police, and finish five jobs for Rico,
the fixer who runs the city from his garage.

## How to play

Open `game/index.html` with any static server. Keyboard and mouse, no install, no network.

- **WASD / Arrows** — walk and drive (W accelerates, S brakes and reverses)
- **E** — steal a car / get out
- **F** — punch
- **Mouse** — aim and hold to shoot the pistol
- **Drag mouse** — look around, **wheel** — zoom the camera
- **P / Esc** — pause (progress saves)
- **M** — mute

## What's in the city

- A full 3D road grid with towers, parks, parking lots and street lamps
- Traffic that follows the roads and pedestrians who stroll — and flee
- A wanted system: steal cars, hit pedestrians or shoot, and the Vice Point
  police chase you; lose them and the heat cools off
- Five story missions: Wheels, Courier Run, Heat, Payday and The Big Score
- Combat on foot (punch and pistol), car chases, crashes and explosions
- A third-person camera, HUD with wanted stars, money, health, mission
  objective and a live minimap
- Save and continue, a day-and-night cycle, synthesized engine, siren and
  effects sound (WebAudio, no audio files)

## Build

`main.ts` (Node 22, standard library only) copies `game/` and `screenshots/`
to `/output` and writes `/output/dossier.json` with the vendored make.fun
library:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Screenshots are real renders of the game, taken with headless Chromium
(see `browser-test.mjs` in the work directory).

Three.js (r180) is vendored under `game/vendor/` so the game plays with no
network request.

## License

MIT — see [LICENSE](LICENSE).
