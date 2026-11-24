// Vice Point 3D — the city. A deterministic grid: roads every ROAD_GAP units,
// blocks between them holding buildings, parks or parking lots, and the five
// mission places on road intersections so a car can always reach them.
// Pure data, no DOM and no three.js, so the Node play-test can build it too.
import { WORLD, ROAD_GAP, ROAD_HALF } from './config.js';
import { mulberry32, pick, range, intRange } from './rng.js';

const BUILDING_COLORS = [
  0xc9a06a, 0xb0703f, 0x8a93a6, 0xd9c9a3, 0x7d8aa0,
  0xa8563e, 0x9c8f7a, 0x6f7f8c, 0xc4b49a, 0x8c6f5a,
];

export function nearestRoad(v) {
  return Math.round(v / ROAD_GAP) * ROAD_GAP;
}

export function onHorizontalRoad(x, y) {
  return Math.abs(y - nearestRoad(y)) <= ROAD_HALF;
}

export function onVerticalRoad(x, y) {
  return Math.abs(x - nearestRoad(x)) <= ROAD_HALF;
}

export function isOnRoad(x, y) {
  return onHorizontalRoad(x, y) || onVerticalRoad(x, y);
}

/** Circle (x, y, r) against every building box. Returns the building or null. */
export function collidesBuilding(city, x, y, r) {
  for (const b of city.buildings) {
    if (
      x + r > b.x - b.w / 2 && x - r < b.x + b.w / 2 &&
      y + r > b.y - b.d / 2 && y - r < b.y + b.d / 2
    ) {
      return b;
    }
  }
  return null;
}

/** A random point on a road, for traffic and pedestrian spawns. */
export function roadPoint(rand) {
  const horizontal = rand() < 0.5;
  const road = intRange(rand, 0, WORLD / ROAD_GAP) * ROAD_GAP;
  const along = range(rand, 60, WORLD - 60);
  return horizontal ? { x: along, y: road } : { x: road, y: along };
}

export function createCity(seed) {
  const rand = mulberry32(seed);
  const city = {
    seed,
    buildings: [],
    parks: [],
    trees: [],
    lamps: [],
    parkingLots: [],
    places: {
      garage: { x: 1280, y: 2240, label: "Rico's Garage" },
      market: { x: 640, y: 1280, label: 'Palm Market' },
      hideout: { x: 1920, y: 640, label: 'Hideout' },
      bank: { x: 1280, y: 1600, label: 'Vice Point Bank' },
      dock: { x: 1280, y: 320, label: 'South Dock' },
    },
    start: { x: 1280, y: 1280 },
  };

  const blocks = WORLD / ROAD_GAP - 1; // 7 blocks each way
  for (let bx = 0; bx < blocks; bx += 1) {
    for (let by = 0; by < blocks; by += 1) {
      const x0 = bx * ROAD_GAP + ROAD_HALF;
      const y0 = by * ROAD_GAP + ROAD_HALF;
      const w = ROAD_GAP - ROAD_HALF * 2;
      const d = ROAD_GAP - ROAD_HALF * 2;
      const roll = rand();
      if (roll < 0.2) {
        // A park: grass, trees, a bench or two in spirit.
        city.parks.push({ x: x0 + w / 2, y: y0 + d / 2, w, d });
        const count = intRange(rand, 5, 9);
        for (let i = 0; i < count; i += 1) {
          city.trees.push({
            x: x0 + range(rand, 24, w - 24),
            y: y0 + range(rand, 24, d - 24),
            s: range(rand, 0.8, 1.4),
          });
        }
      } else if (roll < 0.33) {
        // A parking lot: flat asphalt with marked car spots.
        const lot = { x: x0 + w / 2, y: y0 + d / 2, w, d, spots: [] };
        const cols = 4;
        const rows = 2;
        for (let c = 0; c < cols; c += 1) {
          for (let r = 0; r < rows; r += 1) {
            lot.spots.push({
              x: x0 + 40 + c * 58,
              y: y0 + 70 + r * 110,
              angle: Math.PI / 2,
            });
          }
        }
        city.parkingLots.push(lot);
      } else {
        // Buildings: up to four lots per block, each with its own height.
        const lots = [
          { x: x0 + w * 0.25, y: y0 + d * 0.25 },
          { x: x0 + w * 0.75, y: y0 + d * 0.25 },
          { x: x0 + w * 0.25, y: y0 + d * 0.75 },
          { x: x0 + w * 0.75, y: y0 + d * 0.75 },
        ];
        for (const lot of lots) {
          if (rand() < 0.18) continue; // an empty yard keeps the block airy
          const bw = range(rand, 62, 96);
          const bd = range(rand, 62, 96);
          // Taller towers toward the centre: centre is 0 at the far corner
          // and 1 at the middle of the map (block 6, 6).
          const centre = (bx + by) / 12;
          const h = Math.round(range(rand, 20, 46) + (1 - centre) * range(rand, 0, 55));
          city.buildings.push({
            x: lot.x,
            y: lot.y,
            w: bw,
            d: bd,
            h,
            color: pick(rand, BUILDING_COLORS),
          });
        }
      }
    }
  }

  // Street lamps at every other intersection, two corners each — one
  // diagonal pair per crossing, so no crossing gets all four corners lit.
  for (let i = 0; i <= WORLD / ROAD_GAP; i += 1) {
    for (let j = 0; j <= WORLD / ROAD_GAP; j += 1) {
      if ((i + j) % 2 !== 0) continue;
      const cx = i * ROAD_GAP;
      const cy = j * ROAD_GAP;
      city.lamps.push({ x: cx + ROAD_HALF + 8, y: cy + ROAD_HALF + 8 });
      city.lamps.push({ x: cx - ROAD_HALF - 8, y: cy - ROAD_HALF - 8 });
    }
  }

  // A few sidewalk trees along the central avenues.
  for (let i = 0; i < 24; i += 1) {
    const road = pick(rand, [640, 960, 1280, 1600, 1920]);
    city.trees.push({
      x: road + ROAD_HALF + 14,
      y: range(rand, 120, WORLD - 120),
      s: range(rand, 0.7, 1.1),
    });
  }

  return city;
}
