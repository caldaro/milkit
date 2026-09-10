/**
 * engine.js — Motor de Raycasting 2.5D
 * Mikit Multimedia · Engine Core
 *
 * Técnica: DDA (Digital Differential Analyzer) — el mismo algoritmo
 * que usa el DOOM original de id Software (1993), pero con corrección
 * de ojo de pez y gradiente de distancia para profundidad visual.
 *
 * Optimizaciones:
 * - Renderizado a 320x240 escaleado al tamaño del viewport (cero costo de GPU).
 * - Un solo rayo por columna de píxeles.
 * - Lookup tables de sin/cos pre-calculadas en init.
 * - requestAnimationFrame desacoplado del loop de lógica.
 */

// ── Setup del Canvas ─────────────────────────
const canvas  = document.getElementById('gameCanvas');
const ctx     = canvas.getContext('2d');
const minimap = document.getElementById('minimapCanvas');
const mmCtx   = minimap.getContext('2d');

const BASE_W = 320;   // Resolución virtual de renderizado
const BASE_H = 240;

canvas.width  = BASE_W;
canvas.height = BASE_H;

// ── Estado del Jugador ───────────────────────
const player = {
  x:    7 * CELL_SIZE + CELL_SIZE / 2,   // Centro del mapa (tile 7,7)
  y:    7 * CELL_SIZE + CELL_SIZE / 2,
  dir:  0,                                // Ángulo en radianes (0 = derecha)
  fov:  Math.PI / 2.8,                   // ~64°  — FOV clásico
  speed: 1.8,
  rotSpeed: 0.04,
};

// ── Lookup Tables ────────────────────────────
const HALF_H    = BASE_H / 2;
const NUM_RAYS  = BASE_W;
const MAX_DEPTH = 20;                     // Distancia máxima de visión (en tiles)

// Pre-calcular ángulos de rayo
const rayAngles = new Float32Array(NUM_RAYS);
for (let i = 0; i < NUM_RAYS; i++) {
  rayAngles[i] = (i / NUM_RAYS - 0.5) * player.fov;
}

// ── ImageData para dibujo directo (ultra-rápido) ─
const imageData = ctx.createImageData(BASE_W, BASE_H);
const pixels    = imageData.data;          // Uint8ClampedArray RGBA

let lastTime = 0;
let isRunning = false;

// ── Color de techo y suelo (gradiente estático) ─
const CEILING_COLOR = [8,  11, 15];
const FLOOR_COLOR   = [18, 26, 35];

// ── Función principal: dibujar columna por rayo ─
function castAndDraw() {
  // 1. Fondo: techo y suelo
  for (let y = 0; y < BASE_H; y++) {
    const t = y < HALF_H ? 0 : 1; // 0=techo, 1=suelo
    const blend = y < HALF_H
      ? (HALF_H - y) / HALF_H
      : (y - HALF_H) / HALF_H;
    const r = t === 0 ? lerp(CEILING_COLOR[0], 0, blend)  : lerp(FLOOR_COLOR[0], 0, blend);
    const g = t === 0 ? lerp(CEILING_COLOR[1], 0, blend)  : lerp(FLOOR_COLOR[1], 0, blend);
    const b = t === 0 ? lerp(CEILING_COLOR[2], 0, blend)  : lerp(FLOOR_COLOR[2], 0, blend);
    for (let x = 0; x < BASE_W; x++) {
      const idx = (y * BASE_W + x) * 4;
      pixels[idx]   = r;
      pixels[idx+1] = g;
      pixels[idx+2] = b;
      pixels[idx+3] = 255;
    }
  }

  // 2. DDA Raycasting — 1 rayo por columna
  for (let col = 0; col < NUM_RAYS; col++) {
    const angle = player.dir + rayAngles[col];
    const cosA  = Math.cos(angle);
    const sinA  = Math.sin(angle);

    // DDA setup
    const rayDirX = cosA;
    const rayDirY = sinA;

    let mapX = Math.floor(player.x / CELL_SIZE);
    let mapY = Math.floor(player.y / CELL_SIZE);

    const deltaDistX = Math.abs(1 / rayDirX) || 1e30;
    const deltaDistY = Math.abs(1 / rayDirY) || 1e30;

    let stepX, stepY, sideDistX, sideDistY;

    if (rayDirX < 0) {
      stepX     = -1;
      sideDistX = (player.x / CELL_SIZE - mapX) * deltaDistX;
    } else {
      stepX     = 1;
      sideDistX = (mapX + 1.0 - player.x / CELL_SIZE) * deltaDistX;
    }
    if (rayDirY < 0) {
      stepY     = -1;
      sideDistY = (player.y / CELL_SIZE - mapY) * deltaDistY;
    } else {
      stepY     = 1;
      sideDistY = (mapY + 1.0 - player.y / CELL_SIZE) * deltaDistY;
    }

    let hit = 0, side = 0, cellType = 0;
    let perpWallDist = 0;

    // Avanzar el rayo hasta que golpee una pared (DDA loop)
    let step = 0;
    while (hit === 0 && step < MAX_DEPTH * 20) {
      if (sideDistX < sideDistY) {
        sideDistX += deltaDistX;
        mapX += stepX;
        side = 0;
      } else {
        sideDistY += deltaDistY;
        mapY += stepY;
        side = 1;
      }
      cellType = getCell(mapX, mapY);
      if (cellType > 0) hit = 1;
      step++;
    }

    // Distancia corregida (evita efecto ojo de pez)
    if (side === 0) {
      perpWallDist = (mapX - player.x / CELL_SIZE + (1 - stepX) / 2) / rayDirX;
    } else {
      perpWallDist = (mapY - player.y / CELL_SIZE + (1 - stepY) / 2) / rayDirY;
    }

    // Altura de la franja de pared en pantalla
    const wallHeight = Math.min(BASE_H, Math.floor(BASE_H / (perpWallDist + 0.001)));
    const drawStart  = Math.max(0, HALF_H - wallHeight / 2) | 0;
    const drawEnd    = Math.min(BASE_H - 1, HALF_H + wallHeight / 2) | 0;

    // Color base del tipo de bloque
    const palette = WALL_COLORS[cellType] || WALL_COLORS[1];
    const shade   = Math.max(0, 1 - perpWallDist / MAX_DEPTH);
    const dim     = side === 1 ? 0.6 : 1.0; // Paredes laterales más oscuras

    const rBase = hexToRGB(palette.near);
    const rFar  = hexToRGB(palette.far);

    const wr = lerp(rFar[0], rBase[0], shade) * dim | 0;
    const wg = lerp(rFar[1], rBase[1], shade) * dim | 0;
    const wb = lerp(rFar[2], rBase[2], shade) * dim | 0;

    // Dibujar columna directamente en imageData
    for (let y = drawStart; y <= drawEnd; y++) {
      const idx = (y * BASE_W + col) * 4;
      pixels[idx]   = wr;
      pixels[idx+1] = wg;
      pixels[idx+2] = wb;
      pixels[idx+3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

// ── Lógica de movimiento ─────────────────────
function updatePlayer(dt) {
  const ms = player.speed * dt * 60;    // Normalizado a 60fps
  const rs = player.rotSpeed * dt * 60;

  // Rotación (teclado + mouse)
  player.dir += consumeMouseDelta();
  if (Keys.left)  player.dir -= rs;
  if (Keys.right) player.dir += rs;

  // Movimiento con detección de colisión (radio de 16px)
  const RADIUS = 16;
  let newX = player.x;
  let newY = player.y;

  if (Keys.up) {
    newX += Math.cos(player.dir) * ms;
    newY += Math.sin(player.dir) * ms;
  }
  if (Keys.down) {
    newX -= Math.cos(player.dir) * ms;
    newY -= Math.sin(player.dir) * ms;
  }

  // Colisión X
  if (getCellWorld(newX + RADIUS * Math.sign(newX - player.x + 0.001), player.y) === 0) {
    player.x = newX;
  }
  // Colisión Y
  if (getCellWorld(player.x, newY + RADIUS * Math.sign(newY - player.y + 0.001)) === 0) {
    player.y = newY;
  }

  // Detección de portal (interacción E)
  const frontX = player.x + Math.cos(player.dir) * CELL_SIZE * 0.8;
  const frontY = player.y + Math.sin(player.dir) * CELL_SIZE * 0.8;
  const frontCell = getCellWorld(frontX, frontY);

  const hint = document.getElementById('action-hint');
  if (frontCell === 2 || frontCell === 3) {
    hint.classList.remove('hidden');
    if (Keys.action) {
      Keys.action = false;
      if (frontCell === 2) openAgentPanel();
      if (frontCell === 3) openGalleryPanel();
    }
  } else {
    hint.classList.add('hidden');
  }
}

// ── Minimapa ─────────────────────────────────
function drawMinimap() {
  const scale = minimap.width / (MAP_WIDTH * CELL_SIZE);
  mmCtx.fillStyle = 'rgba(0,0,0,0.9)';
  mmCtx.fillRect(0, 0, minimap.width, minimap.height);

  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      const cell = MAP_DATA[y][x];
      if (cell === 0) continue;
      mmCtx.fillStyle = cell === 2 ? '#ff0055' : cell === 3 ? '#00eeff' : '#4a6070';
      mmCtx.fillRect(
        x * CELL_SIZE * scale, y * CELL_SIZE * scale,
        CELL_SIZE * scale - 1, CELL_SIZE * scale - 1
      );
    }
  }

  // Jugador
  const px = player.x * scale;
  const py = player.y * scale;
  mmCtx.fillStyle = '#ffffff';
  mmCtx.beginPath();
  mmCtx.arc(px, py, 2, 0, Math.PI * 2);
  mmCtx.fill();

  // Dirección del jugador
  mmCtx.strokeStyle = '#00eeff';
  mmCtx.lineWidth = 1;
  mmCtx.beginPath();
  mmCtx.moveTo(px, py);
  mmCtx.lineTo(px + Math.cos(player.dir) * 8, py + Math.sin(player.dir) * 8);
  mmCtx.stroke();
}

// ── Game Loop Principal ───────────────────────
function gameLoop(timestamp) {
  if (!isRunning) return;
  const dt = Math.min((timestamp - lastTime) / 1000, 0.05); // Cap a 50ms
  lastTime = timestamp;

  updatePlayer(dt);
  castAndDraw();
  drawMinimap();

  requestAnimationFrame(gameLoop);
}

// ── Arranque ─────────────────────────────────
function startEngine() {
  document.getElementById('splash').classList.add('hidden');
  isRunning = true;
  lastTime = performance.now();
  requestAnimationFrame(gameLoop);
  // Solicitar pointer lock para look con mouse
  canvas.requestPointerLock();
  // Intentar reproducir ambient
  document.getElementById('ambient-audio')?.play().catch(() => {});
}

// ── Helpers ───────────────────────────────────
function lerp(a, b, t) { return a + (b - a) * t; }

const _colorCache = {};
function hexToRGB(hex) {
  if (_colorCache[hex]) return _colorCache[hex];
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  _colorCache[hex] = [r, g, b];
  return _colorCache[hex];
}
