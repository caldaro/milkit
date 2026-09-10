'use strict';

/* ═══════════════════════════════════════════════════════════════════
   MIKIT MULTIMEDIA · FASE 1 "HOME"
   Salón Dodecagonal — 12 paredes planas
   ───────────────────────────────────────────────────────────────────
   Técnica:   Ray-Segment Intersection contra 12 segmentos del polígono.
              Más ligero que el cálculo cuadrático del círculo:
              12 operaciones de punto flotante vs. sqrt() continuo.
   Estética:  Dodecágono regular → esquinas nítidas, aspecto geométrico
              de alto diseño (no retro, no circular genérico).
   Render:    HTML5 Canvas 2D · Vanilla JS · Zero dependencias
   ───────────────────────────────────────────────────────────────────
   PIPELINE DE RENDER (por frame):
   1. renderCeilingFloor()   → gradientes + grid de perspectiva
   2. renderWalls()          → 1 rayo/columna → depthBuf[]
   3. renderAvatarBillboard() → sprite proyectado con oclusión
   4. renderHUD()            → crosshair · label · viñeta · brújula
═══════════════════════════════════════════════════════════════════ */


// ══════════════════════════════════════════════════════
// §1  CONFIGURACIÓN
// ══════════════════════════════════════════════════════
const CFG = Object.freeze({
  // Geometría
  SIDES:      12,             // Número de lados del polígono (dodecágono)
  ROOM_R:     520,            // Radio circunscrito del dodecágono (u. de mundo)
  PLAYER_R:   22,             // Radio de colisión del jugador

  // Movimiento
  MOVE_SPEED: 155,
  ROT_SPEED:  2.0,
  MOUSE_SENS: 0.0019,

  // Óptica
  FOV:        Math.PI / 2.5,  // Campo de visión ≈ 72°
  WALL_SCALE: 0.70,           // Multiplicador de altura de paredes

  // Niebla
  FOG_START:  0.30,
  FOG_END:    1.80,
});


// ══════════════════════════════════════════════════════
// §2  GEOMETRÍA DODECAGONAL
//
//     12 vértices equidistantes, 12 aristas.
//     Cada arista puede ser: PARED, PANTALLA o BORDE.
//     La pantalla principal de MarkOS ocupa la arista 0
//     (directamente frente al jugador al iniciar).
// ══════════════════════════════════════════════════════

/** Genera los vértices del dodecágono regular centrado en (0,0) */
function buildDodecagon(R, sides) {
  const verts = [];
  for (let i = 0; i < sides; i++) {
    // Rotamos −π/sides para que las aristas sean frontales (no los vértices)
    const a = (2 * Math.PI * i / sides) - Math.PI / sides;
    verts.push({ x: R * Math.cos(a), y: R * Math.sin(a) });
  }
  return verts;
}

const VERTS = buildDodecagon(CFG.ROOM_R, CFG.SIDES);

/**
 * Aristas del dodecágono.
 * type: 'screen' | 'wall'
 * screenId: referencia a SCREENS (si type === 'screen')
 */
const EDGES = (() => {
  const N = CFG.SIDES;
  const edges = [];
  for (let i = 0; i < N; i++) {
    const a = VERTS[i];
    const b = VERTS[(i + 1) % N];
    // Aristas con pantallas: 0 (Milkit Creativas), 3, 5, 8
    let type = 'wall', screenIdx = -1;
    if      (i === 0)  { type = 'screen'; screenIdx = 0; }  // Soluciones Creativas
    else if (i === 3)  { type = 'screen'; screenIdx = 1; }  // SEO / Emailing / ADS
    else if (i === 5)  { type = 'screen'; screenIdx = 2; }  // Diseño Multimedia
    else if (i === 8)  { type = 'screen'; screenIdx = 3; }  // Streaming / Apps / UX
    edges.push({ a, b, type, screenIdx, idx: i });
  }
  return edges;
})();

/** Ángulo central de cada arista (para la brújula) */
function edgeCenterAngle(edge) {
  const mx = (edge.a.x + edge.b.x) / 2;
  const my = (edge.a.y + edge.b.y) / 2;
  return Math.atan2(my, mx);
}


// ══════════════════════════════════════════════════════
// §3  PANTALLAS — PORTAFOLIO
// ══════════════════════════════════════════════════════
const SCREENS = [
  {
    id:      'milkit-creativas',
    label:   'Milkit · Soluciones Creativas',
    sub:     'Estrategia · Branding · Contenido · Campaña 360°',
    rgb:     [58, 181, 247],   // --accent cyan
    primary: true,
    tagline: 'Tu marca no necesita más likes. Necesita resultados.',
    cta:     'Ver Portafolio',
  },
  {
    id:      'milkit-seo',
    label:   'SEO · Emailing · ADS',
    sub:     'Google Ads · Meta · Email Flows · Posicionamiento Orgánico',
    rgb:     [250, 97, 162],   // --hot rosa
    primary: false,
  },
  {
    id:      'milkit-multimedia',
    label:   'Diseño Multimedia',
    sub:     'Motion · Animación · Video · Identidad Visual',
    rgb:     [144, 89, 200],   // --purple
    primary: false,
  },
  {
    id:      'milkit-digital',
    label:   'Streaming · Apps · UX/UI',
    sub:     'Front-End · React · Live Streaming · Experiencias Digitales',
    rgb:     [242, 201, 76],   // --yellow
    primary: false,
  },
];


// ══════════════════════════════════════════════════════
// §4  CANVAS & DIMENSIONES
// ══════════════════════════════════════════════════════
const canvas = document.getElementById('world');
const ctx    = canvas.getContext('2d', { alpha: false });

let W = 0, H = 0;
let _ceilGrad = null, _floorGrad = null;   // Cache de gradientes

function onResize() {
  W = canvas.width  = window.innerWidth;
  H = canvas.height = window.innerHeight;
  _ceilGrad = _floorGrad = null;           // Invalidar al redimensionar
}
window.addEventListener('resize', onResize);
onResize();


// ══════════════════════════════════════════════════════
// §5  ESTADO DEL JUGADOR
// ══════════════════════════════════════════════════════
const player = {
  x:   -280,  // Desplazado hacia atrás en el eje X
  y:   -40,   // Ligero offset para no tapar la pantalla central
  dir: 0.12,  // Ángulo sutil apuntando hacia el centro
};


// ══════════════════════════════════════════════════════
// §6  INPUT
// ══════════════════════════════════════════════════════
const keys = { w: false, a: false, s: false, d: false };
let mouseDeltaX       = 0;
let isPointerLocked   = false;
let hoveredScreen     = null;
let isProductViewOpen = false;

const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || window.matchMedia('(pointer: coarse)').matches;
if (isTouchDevice) {
  document.body.classList.add('is-touch');
  const hint = document.getElementById('lock-hint');
  if (hint) hint.style.display = 'none';
}

document.addEventListener('keydown', e => {
  if (e.code === 'Escape') {
    if (isProductViewOpen) {
      closeProductEnvironment();
      return;
    }
    document.exitPointerLock();
    return;
  }
  if (isProductViewOpen) return;

  switch (e.code) {
    case 'KeyW': case 'ArrowUp':    keys.w = true;  break;
    case 'KeyS': case 'ArrowDown':  keys.s = true;  break;
    case 'KeyA': case 'ArrowLeft':  keys.a = true;  break;
    case 'KeyD': case 'ArrowRight': keys.d = true;  break;
  }
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
});
document.addEventListener('keyup', e => {
  if (isProductViewOpen) return;
  switch (e.code) {
    case 'KeyW': case 'ArrowUp':    keys.w = false; break;
    case 'KeyS': case 'ArrowDown':  keys.s = false; break;
    case 'KeyA': case 'ArrowLeft':  keys.a = false; break;
    case 'KeyD': case 'ArrowRight': keys.d = false; break;
  }
});

document.addEventListener('mousemove', e => {
  if (isPointerLocked && !isProductViewOpen) mouseDeltaX += e.movementX;
});

// Touch Swipe para rotar en celular
let touchStartX = null;
let touchStartY = null;

window.addEventListener('touchstart', e => {
  if (isProductViewOpen) return;
  if (e.target.closest('#mobile-controls') || e.target.closest('#markos-modal')) return;
  if (e.touches.length > 0) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }
}, { passive: true });

window.addEventListener('touchmove', e => {
  if (isProductViewOpen || touchStartX === null) return;
  if (e.target.closest('#mobile-controls') || e.target.closest('#markos-modal')) return;
  if (e.touches.length > 0) {
    const curX = e.touches[0].clientX;
    const curY = e.touches[0].clientY;
    const dx = curX - touchStartX;

    player.dir += dx * 0.005;

    touchStartX = curX;
    touchStartY = curY;
  }
}, { passive: true });

window.addEventListener('touchend', () => {
  touchStartX = null;
  touchStartY = null;
});

document.addEventListener('pointerlockchange', () => {
  isPointerLocked = document.pointerLockElement === canvas;
  const hint = document.getElementById('lock-hint');
  if (hint && !isTouchDevice) hint.style.opacity = (isPointerLocked || isProductViewOpen) ? '0' : '1';
});

canvas.addEventListener('click', () => {
  if (isProductViewOpen) return;
  if (isTouchDevice) {
    if (hoveredScreen) onScreenSelect(hoveredScreen);
    return;
  }
  if (!isPointerLocked) { canvas.requestPointerLock(); return; }
  if (hoveredScreen) onScreenSelect(hoveredScreen);
});


// ══════════════════════════════════════════════════════
// §7  MATEMÁTICAS
// ══════════════════════════════════════════════════════

const lerp  = (a, b, t) => a + (b - a) * t;
const clamp = (x, lo, hi) => x < lo ? lo : x > hi ? hi : x;

function normalizeAngle(a) {
  while (a >  Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function fogFactor(d) {
  return clamp(
    (d - CFG.ROOM_R * CFG.FOG_START) / (CFG.ROOM_R * (CFG.FOG_END - CFG.FOG_START)),
    0, 1
  );
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.arcTo(x+w, y, x+w, y+r, r);
  c.lineTo(x+w, y+h-r); c.arcTo(x+w, y+h, x+w-r, y+h, r);
  c.lineTo(x+r, y+h);   c.arcTo(x, y+h, x, y+h-r, r);
  c.lineTo(x, y+r);     c.arcTo(x, y, x+r, y, r);
  c.closePath();
}


// ══════════════════════════════════════════════════════
// §8  RAYCASTING — INTERSECCIÓN RAY ↔ SEGMENTO
//
//     Por cada columna se evalúan los 12 segmentos del dodecágono.
//     Algoritmo: Möller-Trumbore 2D (paramétrico).
//
//     Rayo:     P + t·D  (t ≥ 0)
//     Segmento: A + s·(B−A)  (0 ≤ s ≤ 1)
//
//     Se resuelve: P + t·D = A + s·(B−A)
//     En forma matricial: [D | A−B] · [t, s]ᵀ = A − P
//
//     La columna U de la textura = s ∈ [0..1].
//     Tomar el segmento con menor t positivo.
// ══════════════════════════════════════════════════════

function castRay(angle) {
  const rdx = Math.cos(angle);
  const rdy = Math.sin(angle);

  let minT      = Infinity;
  let hitEdge   = null;
  let hitU      = 0;      // Coordenada U en el segmento [0..1]

  for (const edge of EDGES) {
    const ax = edge.a.x - player.x;
    const ay = edge.a.y - player.y;
    const bx = edge.b.x - edge.a.x;   // dirección del segmento
    const by = edge.b.y - edge.a.y;

    // Determinante: cross(D, B−A)
    const det = rdx * by - rdy * bx;
    if (Math.abs(det) < 1e-10) continue;   // Paralelo → saltar

    const invDet = 1 / det;
    const t = (ax * by - ay * bx) * invDet;   // Distancia por el rayo
    const s = (ax * rdy - ay * rdx) * invDet; // Posición en el segmento

    if (t > 0.001 && s >= 0 && s <= 1 && t < minT) {
      minT    = t;
      hitEdge = edge;
      hitU    = s;
    }
  }

  if (!hitEdge) return null;

  // Corrección fisheye
  const perpDist = minT * Math.cos(angle - player.dir);

  const screen = hitEdge.type === 'screen'
    ? SCREENS[hitEdge.screenIdx]
    : null;

  return {
    perpDist,
    rawDist: minT,
    edge:    hitEdge,
    screen,
    u:       hitU,
  };
}


// ══════════════════════════════════════════════════════
// §9  TEXTURAS DE PANTALLAS (offscreen canvas 256×256)
// ══════════════════════════════════════════════════════
const TEX_W = 256, TEX_H = 256;
const screenTexCache = new Map();

function buildScreenTexture(scr) {
  const oc  = document.createElement('canvas');
  oc.width  = TEX_W; oc.height = TEX_H;
  const c   = oc.getContext('2d');
  const [r, g, b] = scr.rgb;
  const col  = `rgb(${r},${g},${b})`;
  const colA = (a) => `rgba(${r},${g},${b},${a})`;

  // Fondo blanco con tarjeta luminosa
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, TEX_W, TEX_H);

  // Gradiente radial sutil de acento de marca
  const gw = c.createRadialGradient(TEX_W/2, TEX_H*0.44, 0, TEX_W/2, TEX_H*0.44, TEX_W*0.6);
  gw.addColorStop(0,   colA(scr.primary ? 0.14 : 0.08));
  gw.addColorStop(0.7, colA(0.02));
  gw.addColorStop(1,   'transparent');
  c.fillStyle = gw;
  c.fillRect(0, 0, TEX_W, TEX_H);

  // ── Pantalla principal: Milkit Creativas especial ────
  if (scr.primary && scr.tagline) {
    // Header
    c.fillStyle = colA(0.12);
    c.fillRect(0, 0, TEX_W, 54);

    c.fillStyle = col;
    c.textAlign = 'center';
    c.font      = `800 15px 'Poppins', sans-serif`;
    c.fillText('Milkit', TEX_W/2, 24);

    c.fillStyle = '#718096';
    c.font      = `600 9px 'Poppins', sans-serif`;
    c.fillText('Soluciones Creativas', TEX_W/2, 40);

    // Separador
    c.fillStyle = colA(0.3);
    c.fillRect(18, 52, TEX_W-36, 1.5);

    // Servicios
    const engines = ['⚙ Branding & Estrategia', '◉ SEO · Emailing · ADS', '◎ Diseño & Motion', '◈ Streaming · Apps · UX'];
    c.font = `600 9px 'Poppins', sans-serif`;
    engines.forEach((e, i) => {
      c.fillStyle = i === 0 ? col : '#4a5568';
      c.fillText(e, TEX_W/2, 74 + i * 18);
    });

    // Tagline
    c.fillStyle = '#2D2D2D';
    c.font      = `600 9.5px 'Poppins', sans-serif`;
    c.fillText(scr.tagline, TEX_W/2, 156);

    // CTA badge
    c.fillStyle = col;
    roundRect(c, 40, 168, TEX_W-80, 24, 6);
    c.fill();
    c.fillStyle = '#ffffff';
    c.font      = `700 9px 'Poppins', sans-serif`;
    c.fillText(scr.cta, TEX_W/2, 184);

    // Métricas simuladas
    c.fillStyle = '#718096';
    c.font      = `600 8px 'Poppins', sans-serif`;
    c.fillText('PROYECTOS ACTIVOS: 14 ▲', TEX_W/2, 212);
    c.fillText('ENTREGA EXPRESS: 48H ●', TEX_W/2, 224);

  } else {
    // ── Pantallas secundarias: layout estándar ────────
    c.strokeStyle = colA(0.9);
    c.lineWidth   = 2.5;
    c.strokeRect(6, 6, TEX_W-12, TEX_H-12);

    c.fillStyle = colA(0.2);
    c.fillRect(20, 36, TEX_W-40, 1.5);

    // Label
    c.fillStyle    = '#2D2D2D';
    c.textAlign    = 'center';
    c.textBaseline = 'middle';
    c.font         = `700 13px 'Poppins', sans-serif`;
    const words    = scr.label.split(' ');
    const lines    = [];
    let line       = '';
    for (const w of words) {
      const test = line ? line+' '+w : w;
      if (c.measureText(test).width > TEX_W-44) { lines.push(line); line = w; }
      else line = test;
    }
    lines.push(line);
    const lh  = 18;
    const sy0 = TEX_H*0.44 - ((lines.length-1)*lh)/2;
    lines.forEach((l, i) => c.fillText(l, TEX_W/2, sy0+i*lh));

    c.fillStyle = '#718096';
    c.font      = `500 9.5px 'Poppins', sans-serif`;
    scr.sub.split(' · ').slice(0, 3).forEach((s, i) => c.fillText(s, TEX_W/2, TEX_H*0.62+i*16));

    c.fillStyle = col;
    c.font      = `700 9px 'Poppins', sans-serif`;
    c.fillText('○ EXPLORAR →', TEX_W/2, TEX_H*0.86);
  }

  // Marco borde
  c.strokeStyle = colA(0.85);
  c.lineWidth   = 2;
  c.strokeRect(6, 6, TEX_W-12, TEX_H-12);

  screenTexCache.set(scr.id, oc);
  return oc;
}

function initTextures() {
  SCREENS.forEach(s => buildScreenTexture(s));
}


// ══════════════════════════════════════════════════════
// §10 RENDER — TECHO Y SUELO
// ══════════════════════════════════════════════════════
function renderCeilingFloor() {
  const W2 = W / 2, H2 = H / 2;
  
  // Techo gris muy sutil
  ctx.fillStyle = '#FAFAFA';
  ctx.fillRect(0, 0, W, H2);
  
  // Piso con gradiente hacia el horizonte
  const floorGrad = ctx.createLinearGradient(0, H2, 0, H);
  floorGrad.addColorStop(0, '#E0E5EC'); // Horizonte más oscuro
  floorGrad.addColorStop(1, '#F4F6F8'); // Base clara
  ctx.fillStyle = floorGrad;
  ctx.fillRect(0, H2, W, H2);

  // Líneas de perspectiva en el piso (Cyan Milkit muy sutil)
  ctx.save();
  ctx.strokeStyle = 'rgba(58, 181, 247, 0.15)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 24; i++) {
    ctx.beginPath();
    ctx.moveTo(W2, H2);
    ctx.lineTo((i / 24) * W, H);
    ctx.stroke();
  }
  for (let d = 1; d <= 8; d++) {
    const t = (d / 8) ** 2;
    const y = H2 + t * H2;
    ctx.beginPath(); 
    ctx.moveTo(0, y); 
    ctx.lineTo(W, y); 
    ctx.stroke();
  }
  ctx.restore();
}


// ══════════════════════════════════════════════════════
// §11 RENDER — PAREDES
// ══════════════════════════════════════════════════════

// Pre-calcular normales de aristas para iluminación direccional
const EDGE_NORMALS = EDGES.map(e => {
  const dx = e.b.x - e.a.x;
  const dy = e.b.y - e.a.y;
  const len = Math.hypot(dx, dy);
  // Normal inward (apuntando hacia el interior del polígono)
  return { nx: dy/len, ny: -dx/len };
});

// Dirección de luz fija (desde arriba-derecha del espacio)
const LIGHT = { x: 0.6, y: -0.8 };

function renderWalls() {
  const depthBuf = new Float32Array(W);
  const halfFov  = CFG.FOV / 2;

  for (let col = 0; col < W; col++) {
    const rayAngle = player.dir - halfFov + (col / W) * CFG.FOV;
    const hit      = castRay(rayAngle);
    if (!hit) continue;

    depthBuf[col] = hit.perpDist;

    const wallH   = Math.min(H * 5, (CFG.WALL_SCALE * H * CFG.ROOM_R) / hit.perpDist);
    const wallTop = ((H - wallH) / 2) | 0;

    const fog    = fogFactor(hit.perpDist);
    const bright = 1 - fog * 0.72;

    // ── Iluminación direccional por normal de arista ──
    const norm    = EDGE_NORMALS[hit.edge.idx];
    // dot(normal_inward, -light_dir) para determinar cuánta luz recibe la cara
    const diffuse = clamp(-(norm.nx * LIGHT.x + norm.ny * LIGHT.y), 0.35, 1.0);

    if (hit.screen) {
      // ══════════════════════
      // PANTALLA DIGITAL
      // ══════════════════════
      const tex  = screenTexCache.get(hit.screen.id);
      const texX = (hit.u * TEX_W) | 0;

      ctx.drawImage(tex, texX, 0, 1, TEX_H, col, wallTop, 1, wallH);

      if (fog > 0.04) {
        ctx.fillStyle = `rgba(244,246,248,${fog * 0.5})`;
        ctx.fillRect(col, wallTop, 1, wallH);
      }

      // Edge glow
      const edgeF = 1 - clamp(Math.min(hit.u, 1-hit.u) / 0.068, 0, 1);
      if (edgeF > 0.01) {
        const [r,g,b] = hit.screen.rgb;
        ctx.fillStyle = `rgba(${r},${g},${b},${edgeF * 0.45 * bright})`;
        ctx.fillRect(col, wallTop, 1, wallH);
      }

    } else {
      // ══════════════════════
      // PARED DODECAGONAL (Contraste dinámico + Zócalos)
      // ══════════════════════
      const edgeTone = (hit.edge.idx % 2 === 0) ? 1.0 : 0.85; // Mayor contraste
      const lf = diffuse * edgeTone;
      const base = Math.round(240 * lf); // Tono gris claro dinámico

      ctx.fillStyle = `rgb(${base},${base},${base})`;
      ctx.fillRect(col, wallTop, 1, wallH);

      // Cornisa (arriba) y Zócalo (abajo) para marcar el quiebre de geometría
      ctx.fillStyle = 'rgba(45, 45, 45, 0.4)'; // Gris oscuro de la marca
      ctx.fillRect(col, wallTop, 1, 3);
      ctx.fillRect(col, wallTop + wallH - 3, 1, 3);

      if (fog > 0.01) {
        ctx.fillStyle = `rgba(244,246,248,${fog})`; // Niebla gris muy claro, no blanco puro
        ctx.fillRect(col, wallTop, 1, wallH);
      }
    }
  }

  return depthBuf;
}


// ══════════════════════════════════════════════════════
// §12 RENDER — AVATAR BILLBOARD (Vaquita Milkit)
// ══════════════════════════════════════════════════════
const avatarSprite = new Image();
avatarSprite.src   = 'vaquita.png';

function renderAvatarBillboard(depthBuf) {
  const toX  = -player.x;
  const toY  = -player.y;
  const cosD = Math.cos(player.dir);
  const sinD = Math.sin(player.dir);
  const camZ =  toX * cosD + toY * sinD;
  const camX =  toY * cosD - toX * sinD;

  if (camZ < 40) return;

  const projF   = (W / 2) / Math.tan(CFG.FOV / 2);
  const screenX = (W / 2) + (camX / camZ) * projF;
  const sprH    = (CFG.WALL_SCALE * H * CFG.ROOM_R * 0.90) / camZ;
  const sprW    = sprH * 0.65;
  const sprTop  = (H - sprH) / 2;

  const col0 = Math.max(0,     Math.round(screenX - sprW/2));
  const col1 = Math.min(W - 1, Math.round(screenX + sprW/2));
  if (col1 < col0 || sprH < 20) return;

  let visible = false;
  for (let c = col0; c <= col1; c++) {
    if (!depthBuf[c] || camZ < depthBuf[c]) { visible = true; break; }
  }
  if (!visible) return;

  const fog   = fogFactor(camZ);
  const alpha = (1 - fog * 0.6) * 0.92;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Aura Milkit: rosa → cyan
  const aura = ctx.createRadialGradient(screenX, H/2, 0, screenX, H/2, sprH * 0.58);
  aura.addColorStop(0,   'rgba(250,97,162,0.22)');   // --hot rosa
  aura.addColorStop(0.5, 'rgba(58,181,247,0.12)');   // --accent cyan
  aura.addColorStop(1,   'transparent');
  ctx.fillStyle = aura;
  ctx.fillRect(col0 - 24, sprTop - 24, sprW + 48, sprH + 48);

  // Sprite o fallback
  if (avatarSprite.complete && avatarSprite.naturalWidth > 0) {
    ctx.drawImage(avatarSprite,
      screenX - sprW / 2, sprTop,
      sprW, sprH
    );
  } else {
    // Fallback: rectángulo rosa con texto
    ctx.fillStyle   = 'rgba(250,97,162,0.85)';
    ctx.shadowColor = '#FA61A2';
    ctx.shadowBlur  = 22;
    ctx.fillRect(screenX - sprW / 2, sprTop, sprW, sprH);
    ctx.shadowBlur  = 0;
    ctx.fillStyle   = '#fff';
    ctx.font        = `${Math.round(sprH * 0.12)}px monospace`;
    ctx.textAlign   = 'center';
    ctx.fillText('Vaquita', screenX, sprTop + sprH * 0.55);
  }

  ctx.restore();
}


// ══════════════════════════════════════════════════════
// §13 RENDER — HUD
// ══════════════════════════════════════════════════════
function renderHUD() {
  const W2 = W/2, H2 = H/2;

  // Detectar pantalla al centro
  const centerHit = castRay(player.dir);
  hoveredScreen   = centerHit?.screen ?? null;
  const onScreen  = !!hoveredScreen;

  // ── 1. Crosshair ─────────────────────────────────
  const cs = onScreen ? 11 : 7;
  ctx.strokeStyle = onScreen ? '#FA61A2' : 'rgba(45, 45, 45, 0.45)';
  ctx.lineWidth   = onScreen ? 2 : 1.2;
  ctx.beginPath();
  ctx.moveTo(W2-cs, H2); ctx.lineTo(W2+cs, H2);
  ctx.moveTo(W2, H2-cs); ctx.lineTo(W2, H2+cs);
  ctx.stroke();

  // ── 2. Label de pantalla en hover (Tarjeta luminosa) ──
  if (onScreen) {
    const scr = hoveredScreen;
    const [r, g, b] = scr.rgb;

    const lW  = clamp(Math.round(scr.label.length * 10 + 60), 290, Math.round(W*0.54));
    const lH  = scr.primary ? 96 : 78;
    const lX  = W2 - lW/2, lY = H2 + 28;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
    roundRect(ctx, lX, lY, lW, lH, 8);
    ctx.fill();

    ctx.strokeStyle = `rgba(${r},${g},${b},0.85)`;
    ctx.lineWidth   = 2;
    ctx.stroke();

    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(lX+6, lY, lW-12, 3);

    ctx.fillStyle   = '#2D2D2D';
    ctx.font        = `700 13px 'Poppins', sans-serif`;
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(scr.label, W2, lY + 24);

    ctx.fillStyle = '#718096';
    ctx.font      = `500 10px 'Poppins', sans-serif`;
    ctx.fillText(scr.sub, W2, lY + 42);

    // Extra info para pantalla principal
    if (scr.primary && scr.tagline) {
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.font      = `600 9.5px 'Poppins', sans-serif`;
      ctx.fillText(`"${scr.tagline}"`, W2, lY + 60);
    }

    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.font      = `700 10px 'Poppins', sans-serif`;
    ctx.fillText('[ CLICK ]  explorar este espacio', W2, lY + (scr.primary ? 82 : 63));
  }

  // ── 3. Horizonte luminoso ──────────────────────────
  const hg = ctx.createLinearGradient(W2-260, H2, W2+260, H2);
  hg.addColorStop(0,    'transparent');
  hg.addColorStop(0.38, 'rgba(58,181,247,0.15)');
  hg.addColorStop(0.62, 'rgba(58,181,247,0.15)');
  hg.addColorStop(1,    'transparent');
  ctx.fillStyle = hg;
  ctx.fillRect(0, H2, W, 1);

  // ── 4. Viñeta luminosa suave ──────────────────────
  const vig = ctx.createRadialGradient(W2, H2, H*0.3, W2, H2, H*0.85);
  vig.addColorStop(0,  'transparent');
  vig.addColorStop(1,  'rgba(255,255,255,0.25)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // ── 5. Brújula ────────────────────────────────────
  renderCompass();
}

function renderCompass() {
  const cx = W-58, cy = 58, r = 28;
  ctx.save();
  ctx.globalAlpha = 0.85;

  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath(); ctx.arc(cx, cy, r+7, 0, Math.PI*2); ctx.fill();

  // Contorno dodecagonal del minimapa (estético)
  ctx.strokeStyle = 'rgba(58,181,247,0.4)';
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (2*Math.PI*i/12) - Math.PI/12;
    const mx = cx + r*Math.cos(a), my = cy + r*Math.sin(a);
    i === 0 ? ctx.moveTo(mx, my) : ctx.lineTo(mx, my);
  }
  ctx.closePath(); ctx.stroke();

  // Flecha del jugador
  ctx.strokeStyle = '#FA61A2'; ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(player.dir)*r*0.7, cy + Math.sin(player.dir)*r*0.7);
  ctx.stroke();

  // Puntos de pantallas en el dodecágono
  EDGES.forEach((e, i) => {
    if (e.type !== 'screen') return;
    const scr = SCREENS[e.screenIdx];
    const [sr, sg, sb] = scr.rgb;
    const angle = edgeCenterAngle(e);
    const scale = r * 0.92;
    const dx = cx + Math.cos(angle)*scale;
    const dy = cy + Math.sin(angle)*scale;

    const diffA = Math.abs(normalizeAngle(player.dir - angle));
    const inFov = diffA < CFG.FOV/2;

    ctx.fillStyle = inFov ? `rgb(${sr},${sg},${sb})` : `rgba(${sr},${sg},${sb},0.45)`;
    ctx.beginPath();
    ctx.arc(dx, dy, inFov ? 4 : 2.5, 0, Math.PI*2);
    ctx.fill();
  });

  ctx.restore();
}


// ══════════════════════════════════════════════════════
// §14 UPDATE — FÍSICA
// ══════════════════════════════════════════════════════

/**
 * Colisión contra el dodecágono: proyectar posición fuera
 * de cada segmento usando distancia punto-segmento.
 */
function resolveCollision(nx, ny) {
  const R = CFG.PLAYER_R;
  let px = nx, py = ny;

  for (const edge of EDGES) {
    const ax = edge.a.x, ay = edge.a.y;
    const bx = edge.b.x, by = edge.b.y;
    const ex = bx - ax, ey = by - ay;
    const len2 = ex*ex + ey*ey;
    const t  = clamp(((px-ax)*ex + (py-ay)*ey) / len2, 0, 1);
    const cx = ax + t*ex - px;
    const cy = ay + t*ey - py;
    const dist = Math.hypot(cx, cy);

    if (dist < R) {
      // Empujar hacia el interior
      const pushLen = R - dist;
      const nx2 = cx/dist, ny2 = cy/dist;
      px -= nx2 * pushLen;
      py -= ny2 * pushLen;
    }
  }
  return { x: px, y: py };
}

function update(dt) {
  if (isProductViewOpen) return;
  if (isPointerLocked) { player.dir += mouseDeltaX * CFG.MOUSE_SENS; mouseDeltaX = 0; }
  if (keys.a) player.dir -= CFG.ROT_SPEED * dt;
  if (keys.d) player.dir += CFG.ROT_SPEED * dt;

  let mx = 0, my = 0;
  if (keys.w) { mx += Math.cos(player.dir); my += Math.sin(player.dir); }
  if (keys.s) { mx -= Math.cos(player.dir); my -= Math.sin(player.dir); }

  if (mx !== 0 || my !== 0) {
    const speed = Math.hypot(mx, my);
    const dx = (mx/speed)*CFG.MOVE_SPEED*dt;
    const dy = (my/speed)*CFG.MOVE_SPEED*dt;
    const resolved = resolveCollision(player.x + dx, player.y + dy);
    player.x = resolved.x;
    player.y = resolved.y;
  }
}


// ══════════════════════════════════════════════════════
// §15 GAME LOOP
// ══════════════════════════════════════════════════════
let lastTs = 0;

function render() {
  if (W === 0 || H === 0) return;
  renderCeilingFloor();
  const depthBuf = renderWalls();
  renderAvatarBillboard(depthBuf);
  renderHUD();
}

function loop(ts) {
  const dt = Math.min((ts - lastTs) / 1000, 0.05);
  lastTs   = ts;
  update(dt);
  render();
  requestAnimationFrame(loop);
}


// ══════════════════════════════════════════════════════
// §16 INTERACCIÓN — SELECCIÓN DE PANTALLA & FASE 2
// ══════════════════════════════════════════════════════
function onScreenSelect(screen) {
  const overlay   = document.getElementById('transition-overlay');
  const [r, g, b] = screen.rgb;

  console.log(`[Mikit] Navigate → ${screen.id}`);

  overlay.style.background = `radial-gradient(ellipse at center, rgba(${r},${g},${b},0.45) 0%, rgba(1,4,12,0.95) 75%)`;
  overlay.style.transition = 'opacity 0.38s ease';
  overlay.style.opacity    = '1';

  setTimeout(() => {
    overlay.style.opacity = '0';
    if (screen.id === 'milkit-creativas') {
      openProductEnvironment('milkit-creativas');
    } else {
      showToast(`Próximamente · ${screen.label}`);
    }
  }, 400);
}

function openProductEnvironment(productId) {
  if (productId === 'milkit-creativas') {
    isProductViewOpen = true;
    if (document.pointerLockElement) document.exitPointerLock();
    
    const modal = document.getElementById('markos-modal');
    if (modal) {
      modal.classList.add('active');
      modal.scrollTop = 0;
      animateTelemetry();
    }
  }
}

function closeProductEnvironment() {
  const modal = document.getElementById('markos-modal');
  if (modal) {
    modal.classList.remove('active');
  }
  isProductViewOpen = false;
  setTimeout(() => {
    canvas.requestPointerLock();
  }, 120);
}

function animateTelemetry() {
  const statPipelines = document.getElementById('stat-pipelines');
  if (!statPipelines) return;
  let count = 0;
  const timer = setInterval(() => {
    count += 2;
    if (count <= 14) {
      statPipelines.textContent = count;
    } else {
      clearInterval(timer);
    }
  }, 40);
}

function showToast(msg) {
  const el = document.getElementById('notification');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3400);
}


// ══════════════════════════════════════════════════════
// §17 INIT & LISTENERS
// ══════════════════════════════════════════════════════
function init() {
  initTextures();
  player.x   = -280; // Desplazado hacia atrás en el eje X
  player.y   = -40;  // Ligero offset para no tapar la pantalla central
  player.dir = 0.12; // Ángulo sutil apuntando hacia el centro
  lastTs     = performance.now();
  requestAnimationFrame(loop);

  // Hook product modal buttons
  document.getElementById('close-modal-btn')?.addEventListener('click', closeProductEnvironment);
  document.getElementById('back-to-room-btn')?.addEventListener('click', closeProductEnvironment);
  document.getElementById('cta-demo-btn')?.addEventListener('click', () => {
    showToast('✓ Solicitud de Auditoría registrada. Abriendo canal con Adam...');
  });

  // Hook virtual D-Pad buttons for mobile
  function bindTouch(id, keyProp) {
    const el = document.getElementById(id);
    if (!el) return;
    const onStart = (e) => { e.preventDefault(); keys[keyProp] = true; };
    const onEnd   = (e) => { e.preventDefault(); keys[keyProp] = false; };
    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: false });
    el.addEventListener('mousedown', onStart);
    el.addEventListener('mouseup', onEnd);
    el.addEventListener('mouseleave', onEnd);
  }

  bindTouch('touch-fwd', 'w');
  bindTouch('touch-back', 's');
  bindTouch('touch-left', 'a');
  bindTouch('touch-right', 'd');

  document.getElementById('touch-interact')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (hoveredScreen) {
      onScreenSelect(hoveredScreen);
    } else {
      openProductEnvironment('milkit-creativas');
    }
  });
}

document.getElementById('enter-btn').addEventListener('click', () => {
  const splash = document.getElementById('splash');
  splash.style.opacity       = '0';
  splash.style.pointerEvents = 'none';
  setTimeout(() => {
    splash.style.display = 'none';
    if (!isTouchDevice) {
      canvas.requestPointerLock();
    }
  }, 620);
  init();
});
