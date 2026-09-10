/**
 * input.js — Controlador de Entrada (Teclado + Touch)
 * Mikit Multimedia · Engine Layer 2
 *
 * Gestiona teclado (WASD / flechas) y touchscreen (D-Pad virtual)
 * sin ninguna dependencia externa.
 */

const Keys = {
  up:    false,
  down:  false,
  left:  false,
  right: false,
  action: false,  // Tecla E
};

// ── Teclado ──────────────────────────────────
window.addEventListener('keydown', (e) => {
  switch (e.code) {
    case 'ArrowUp':    case 'KeyW': Keys.up    = true; break;
    case 'ArrowDown':  case 'KeyS': Keys.down  = true; break;
    case 'ArrowLeft':  case 'KeyA': Keys.left  = true; break;
    case 'ArrowRight': case 'KeyD': Keys.right = true; break;
    case 'KeyE': Keys.action = true; break;
  }
  e.preventDefault(); // Evitar scroll con flechas
});

window.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'ArrowUp':    case 'KeyW': Keys.up    = false; break;
    case 'ArrowDown':  case 'KeyS': Keys.down  = false; break;
    case 'ArrowLeft':  case 'KeyA': Keys.left  = false; break;
    case 'ArrowRight': case 'KeyD': Keys.right = false; break;
    case 'KeyE': Keys.action = false; break;
  }
});

// ── Mouse Look (captura de puntero) ──────────
let mouseDeltaX = 0;
let pointerLocked = false;

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === document.getElementById('gameCanvas');
});

document.getElementById('gameCanvas')?.addEventListener('click', () => {
  if (!document.getElementById('splash').classList.contains('hidden') === false) return;
  document.getElementById('gameCanvas').requestPointerLock();
});

window.addEventListener('mousemove', (e) => {
  if (pointerLocked) {
    mouseDeltaX += e.movementX * 0.003;
  }
});

function consumeMouseDelta() {
  const d = mouseDeltaX;
  mouseDeltaX = 0;
  return d;
}

// ── Touch / D-Pad Virtual (mobile) ───────────
let touchStartX = 0;
let touchStartY = 0;

window.addEventListener('touchstart', (e) => {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, { passive: true });

window.addEventListener('touchmove', (e) => {
  const dx = e.touches[0].clientX - touchStartX;
  const dy = e.touches[0].clientY - touchStartY;
  const threshold = 10;

  Keys.up    = dy < -threshold;
  Keys.down  = dy >  threshold;
  Keys.left  = dx < -threshold;
  Keys.right = dx >  threshold;
}, { passive: true });

window.addEventListener('touchend', () => {
  Keys.up = Keys.down = Keys.left = Keys.right = false;
});
