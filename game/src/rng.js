// A tiny seeded random generator (mulberry32), so the same seed always
// builds the same city. The game uses one seeded stream for the city and
// one for traffic, so a play-test can replay the exact same world.
// The 0x6d2b79f5 increment and the xor-shifts below are the standard
// mulberry32 recipe — cheap, good enough for placement, and identical on
// every platform, which is what determinism needs.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(rand, list) {
  return list[Math.floor(rand() * list.length)];
}

export function range(rand, min, max) {
  return min + rand() * (max - min);
}

export function intRange(rand, min, max) {
  return min + Math.floor(rand() * (max - min + 1));
}
