// Vice Point 3D — tuning constants for the whole game. One place for every
// number a designer would want to change: world size, speeds, wanted rules,
// mission money. The simulation runs on a flat (x, y) plane, y pointing
// north; the 3D renderer maps (x, y) to (x, 0, -y) in three.js space.
export const STEP = 1 / 60;
export const WORLD = 2560;
export const ROAD_GAP = 320;
export const ROAD_HALF = 34;
export const BLOCK = ROAD_GAP - ROAD_HALF * 2;

export const PLAYER = {
  radius: 12,
  walkSpeed: 210,
  runSpeed: 310,
  health: 100,
  punchRange: 48,
  punchDamage: 26,
  punchCooldown: 0.42,
  shotCooldown: 0.3,
  bulletDamage: 34,
  startMoney: 250,
};

export const CAR = {
  length: 58,
  width: 28,
  accel: 430,
  brake: 640,
  reverseAccel: 270,
  maxSpeed: 560,
  maxReverse: 190,
  steer: 7.0, // tight enough that a 90-degree turn (radius 20) fits the road
  grip: 0.94,
  health: 150,
  ramDamage: 26,
};

export const TRAFFIC = {
  count: 16,
  speedMin: 80,
  speedMax: 120,
  spawnMargin: 700,
  despawnMargin: 1100,
};

export const PED = {
  count: 26,
  speedMin: 34,
  speedMax: 62,
  fleeSpeed: 135,
};

export const POLICE = {
  maxCars: 5,
  speed: 480,
  ramDamage: 2, // a ram mostly slows the car; the wreck comes from crashes
  ramCooldown: 1.5,
  bustDistance: 48,
  bustSeconds: 1.6,
  shootRange: 430,
  shootCooldown: 1.4,
  shootDamage: 6,
  shootMinWanted: 3,
};

export const WANTED = {
  max: 5,
  decaySeconds: 22,
  stealCar: 1,
  hitPed: 1,
  shoot: 1,
  killCop: 2,
};

export const MISSIONS = [
  { id: 'wheels', name: 'Wheels', reward: 300 },
  { id: 'courier', name: 'Courier Run', reward: 500 },
  { id: 'heat', name: 'Heat', reward: 700 },
  { id: 'payday', name: 'Payday', reward: 900 },
  { id: 'score', name: 'The Big Score', reward: 2000 },
];

export const SAVE_KEY = 'vicepoint3d.save.v1';
export const BEST_KEY = 'vicepoint3d.best.v1';
export const VIEW_W = 1280;
export const VIEW_H = 720;
export const MINIMAP = 168;
