// Vice Point 3D — the HUD: wanted stars, money, health, the mission
// objective with its distance, speed, the toast line, the target arrow and
// a live top-down minimap. All DOM and 2D canvas, fed by the world state.
import { WORLD, ROAD_GAP, MINIMAP } from './config.js';
import { objectiveText, currentMission } from './missions.js';

export function createHud(world) {
  const el = (id) => document.getElementById(id);
  const stars = el('hud-stars');
  const wantedLabel = el('hud-wanted-label');
  const money = el('hud-money');
  const healthFill = el('hud-health-fill');
  const objective = el('hud-objective');
  const distance = el('hud-distance');
  const speed = el('hud-speed');
  const toast = el('hud-toast');
  const arrow = el('hud-arrow');
  const minimap = el('hud-minimap');
  const mctx = minimap.getContext('2d');
  const scale = MINIMAP / WORLD;

  function drawMinimap() {
    const ctx = mctx;
    ctx.clearRect(0, 0, MINIMAP, MINIMAP);
    ctx.fillStyle = '#2c4630';
    ctx.fillRect(0, 0, MINIMAP, MINIMAP);
    // Parks.
    ctx.fillStyle = '#3f7a2e';
    for (const park of world.city.parks) {
      ctx.fillRect(
        (park.x - park.w / 2) * scale, (park.y - park.d / 2) * scale,
        park.w * scale, park.d * scale,
      );
    }
    // Roads, derived from the grid constants instead of a hardcoded list:
    // one road every ROAD_GAP units from 0 to WORLD (0, 320, ..., 2560).
    ctx.fillStyle = '#5a5d63';
    const roads = [];
    for (let r = 0; r <= WORLD; r += ROAD_GAP) roads.push(r);
    for (const r of roads) {
      ctx.fillRect(0, r * scale - 2, MINIMAP, 4);
      ctx.fillRect(r * scale - 2, 0, 4, MINIMAP);
    }
    // Buildings.
    ctx.fillStyle = '#8a8f96';
    for (const b of world.city.buildings) {
      ctx.fillRect(
        (b.x - b.w / 2) * scale, (b.y - b.d / 2) * scale,
        Math.max(1, b.w * scale), Math.max(1, b.d * scale),
      );
    }
    // Cash drops.
    ctx.fillStyle = '#ffd23a';
    for (const p of world.pickups) {
      ctx.beginPath();
      ctx.arc(p.x * scale, p.y * scale, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // The mission target.
    const target = world.missions.target;
    if (target && world.missions.active) {
      ctx.save();
      ctx.translate(target.x * scale, target.y * scale);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#ffd23a';
      ctx.fillRect(-4, -4, 8, 8);
      ctx.restore();
    }
    // Police.
    for (const cop of world.police) {
      ctx.fillStyle = '#ff4040';
      ctx.beginPath();
      ctx.arc(cop.x * scale, cop.y * scale, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // The player, as a white arrow that turns with them.
    const player = world.player;
    ctx.save();
    ctx.translate(player.x * scale, player.y * scale);
    ctx.rotate(-player.angle);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(6, 0);
    ctx.lineTo(-4, -4);
    ctx.lineTo(-4, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function update(view) {
    const player = world.player;
    const wanted = world.wanted;
    stars.textContent = '★'.repeat(wanted) + '☆'.repeat(5 - wanted);
    stars.style.color = wanted > 0 ? '#ff5040' : '#ffd23a';
    wantedLabel.style.visibility = wanted > 0 ? 'visible' : 'hidden';
    money.textContent = `$${Math.floor(player.money)}`;
    healthFill.style.width = `${Math.max(0, player.health)}%`;
    healthFill.style.background = player.health > 50 ? '#37c24a' : player.health > 25 ? '#ffb02a' : '#ff4040';
    objective.textContent = objectiveText(world.missions);
    const target = world.missions.target;
    if (target && world.missions.active) {
      const dist = Math.hypot(target.x - player.x, target.y - player.y);
      distance.textContent = `${Math.round(dist / 4)} m — ${target.label}`;
      // Arrow at the screen edge pointing at the target, turned by the
      // camera so it always shows the way from where you are looking.
      const toTarget = Math.atan2(target.y - player.y, target.x - player.x);
      const screenAngle = toTarget - view.heading;
      arrow.style.display = 'block';
      arrow.style.transform = `translate(-50%, -50%) rotate(${-screenAngle}rad)`;
    } else {
      distance.textContent = '';
      arrow.style.display = 'none';
    }
    // World units per second to miles per hour: a car at the 560 max speed
    // reads about 78 mph, which feels right for a city chase.
    speed.textContent = player.inCar ? `${Math.round(Math.abs(player.inCar.speed) * 0.14)} mph` : '';
    toast.textContent = world.missions.toastTimer > 0 ? world.missions.toast : '';
    toast.style.opacity = world.missions.toastTimer > 0 ? '1' : '0';
    drawMinimap();
  }

  return { update };
}
