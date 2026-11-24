// Vice Point 3D — keyboard and mouse. Tracks what is held, what was just
// pressed, and the camera orbit drag; the browser entry turns that into the
// simulation's input each frame.
export function createInput(canvas) {
  const keys = new Set();
  const pressed = new Set();
  let orbitDX = 0;
  let orbitDY = 0;
  let zoomDelta = 0;
  let mouseX = window.innerWidth / 2;
  let mouseY = window.innerHeight / 2;
  let mouseDown = false;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)) {
      event.preventDefault();
    }
    if (!keys.has(key)) pressed.add(key);
    keys.add(key);
  });
  window.addEventListener('keyup', (event) => {
    keys.delete(event.key.toLowerCase());
  });
  window.addEventListener('blur', () => {
    keys.clear();
    mouseDown = false;
    dragging = false;
  });

  canvas.addEventListener('mousedown', (event) => {
    mouseDown = true;
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
  });
  window.addEventListener('mouseup', () => {
    mouseDown = false;
    dragging = false;
  });
  window.addEventListener('mousemove', (event) => {
    mouseX = event.clientX;
    mouseY = event.clientY;
    if (dragging) {
      orbitDX += event.clientX - lastX;
      orbitDY += event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
    }
  });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    zoomDelta += event.deltaY;
  }, { passive: false });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  return {
    keys,
    get mouseX() { return mouseX; },
    get mouseY() { return mouseY; },
    get mouseDown() { return mouseDown; },
    wasPressed(key) {
      return pressed.has(key);
    },
    takeOrbit() {
      const out = { dx: orbitDX, dy: orbitDY, zoom: zoomDelta };
      orbitDX = 0;
      orbitDY = 0;
      zoomDelta = 0;
      return out;
    },
    endFrame() {
      pressed.clear();
    },
  };
}
