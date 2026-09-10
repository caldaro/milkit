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

  // Renderizado Vectorial DOM CSS 3D (pantallas hiper-nítidas sin aliasing)
  USE_CSS3D_SCREENS: true,
});


// ══════════════════════════════════════════════════════
// §1b PALETAS ARQUITECTÓNICAS (Colores de marca Milkit)
// ══════════════════════════════════════════════════════
const WALL_PALETTES = {
  // Tema 1 (Por defecto): Noche Cian & Obsidiana (Tecnología, contraste OLED, cero gris)
  cyan_obsidian: {
    name:         'Azul Cian & Obsidiana',
    wallBase:     [10, 24, 46],               // Sombra profunda azul medianoche
    wallGlow:     [24, 62, 114],              // Iluminación cian zafiro difusa
    jointColor:   'rgba(58, 181, 247, 0.95)', // Juntas técnicas con neón Milkit Cyan
    ledColor:     '#3AB5F7',                  // LED wash en el rodapié
    corniceColor: 'rgba(58, 181, 247, 0.45)', // Cornisa superior cian
    fogRgb:       [6, 12, 24],                // Niebla espacial oscura
    ceil:         ['#0e1e38', '#091324', '#050914', '#020409'],
    floor:        ['#060c18', '#081020', '#0b162c', '#050812'],
    specular:     'rgba(58, 181, 247, 0.28)',
    gridColor:    'rgba(58, 181, 247, 0.18)',
  },
  // Tema 2: Estudio Morado Eléctrico
  electric_purple: {
    name:         'Morado Eléctrico Milkit',
    wallBase:     [24, 14, 46],
    wallGlow:     [58, 30, 108],
    jointColor:   'rgba(144, 89, 200, 0.90)',
    ledColor:     '#FA61A2',
    corniceColor: 'rgba(250, 97, 162, 0.45)',
    fogRgb:       [10, 6, 20],
    ceil:         ['#241242', '#150a28', '#0a0514', '#04020a'],
    floor:        ['#0c0618', '#120a24', '#1a0e34', '#06030c'],
    specular:     'rgba(144, 89, 200, 0.28)',
    gridColor:    'rgba(250, 97, 162, 0.18)',
  },
  // Tema 3: Neón Magenta Creativo
  hot_pink: {
    name:         'Rosa / Magenta Neón',
    wallBase:     [36, 12, 28],
    wallGlow:     [92, 24, 68],
    jointColor:   'rgba(250, 97, 162, 0.90)',
    ledColor:     '#3AB5F7',
    corniceColor: 'rgba(58, 181, 247, 0.45)',
    fogRgb:       [18, 6, 14],
    ceil:         ['#300d24', '#1e0717', '#0f030b', '#050104'],
    floor:        ['#12040d', '#1a0713', '#250a1c', '#080206'],
    specular:     'rgba(250, 97, 162, 0.28)',
    gridColor:    'rgba(58, 181, 247, 0.18)',
  }
};

let currentWallTheme = 'cyan_obsidian';

function cyclePalette() {
  const keys = Object.keys(WALL_PALETTES);
  const curIdx = keys.indexOf(currentWallTheme);
  const nextIdx = (curIdx + 1) % keys.length;
  currentWallTheme = keys[nextIdx];
  const p = WALL_PALETTES[currentWallTheme];
  showToast(`Paleta: ${p.name}`);
}
window.cyclePalette = cyclePalette;


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
    id:       'markos',
    label:    'MarkOS · Growth OS',
    sub:      'Omni-Channel · Search Dominance · CRM · Data Core',
    rgb:      [58, 181, 247],   // --accent cyan
    primary:  true,
    flagship: true,
    badge:    '★ PRODUCTO ESTRELLA',
    tagline:  'No contrates una agencia. Instala una infraestructura.',
    cta:      'Desplegar MarkOS',
  },
  {
    id:       'milkit-creativas',
    label:    'Milkit · Creativas & Branding',
    sub:      'Estrategia de Marca · Identidad Visual · Campañas 360°',
    rgb:      [250, 97, 162],   // --hot rosa
    primary:  false,
    flagship: false,
    badge:    'ESTUDIO CREATIVO',
  },
  {
    id:       'milkit-seo',
    label:    'SEO · Emailing · ADS',
    sub:      'Google Ads · Meta · Email Flows · Embudos Directos',
    rgb:      [144, 89, 200],   // --purple
    primary:  false,
    flagship: false,
    badge:    'GROWTH & MEDIA',
  },
  {
    id:       'milkit-multimedia',
    label:    'Diseño & Motion Audiovisual',
    sub:      '3D Motion · Animación · Video · Live Streaming',
    rgb:      [242, 201, 76],   // --yellow
    primary:  false,
    flagship: false,
    badge:    'PRODUCCIÓN & 3D',
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
    case 'KeyP':                    cyclePalette(); break;
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

  // Fondo blanco minimalista
  c.fillStyle = '#FFFFFF';
  c.fillRect(0, 0, TEX_W, TEX_H);

  // Tarjeta contenedora con esquinas redondeadas
  c.save();
  roundRect(c, 8, 8, TEX_W - 16, TEX_H - 16, 12);
  c.clip();

  // Fondo de la tarjeta con sutil resplandor de marca
  const bgGrad = c.createRadialGradient(TEX_W / 2, TEX_H * 0.35, 10, TEX_W / 2, TEX_H * 0.35, TEX_W * 0.7);
  bgGrad.addColorStop(0,   colA(scr.primary ? 0.14 : 0.08));
  bgGrad.addColorStop(0.7, colA(0.02));
  bgGrad.addColorStop(1,   '#FFFFFF');
  c.fillStyle = bgGrad;
  c.fillRect(0, 0, TEX_W, TEX_H);

  // ── Pantalla ESTRELLA: MarkOS (Monolito Obsidian) ────
  if (scr.flagship) {
    // Fondo de cristal obsidian de alta tecnología
    c.fillStyle = '#080C16';
    c.fillRect(0, 0, TEX_W, TEX_H);

    // Glow de ciber-infraestructura (Cyan + Magenta)
    const halo = c.createRadialGradient(TEX_W / 2, 45, 10, TEX_W / 2, 80, TEX_W * 0.75);
    halo.addColorStop(0,   'rgba(58, 181, 247, 0.35)');
    halo.addColorStop(0.5, 'rgba(250, 97, 162, 0.12)');
    halo.addColorStop(1,   'transparent');
    c.fillStyle = halo;
    c.fillRect(0, 0, TEX_W, TEX_H);

    // Badge Dorado / Cyan Superior
    c.fillStyle = 'rgba(242, 201, 76, 0.18)';
    roundRect(c, TEX_W / 2 - 62, 12, 124, 18, 9);
    c.fill();
    c.strokeStyle = '#F2C94C';
    c.lineWidth   = 1;
    roundRect(c, TEX_W / 2 - 62, 12, 124, 18, 9);
    c.stroke();

    c.fillStyle    = '#F2C94C';
    c.textAlign    = 'center';
    c.textBaseline = 'middle';
    c.font         = `700 7.5px 'Poppins', sans-serif`;
    c.fillText('★ PRODUCTO ESTRELLA', TEX_W / 2, 21);

    // Título Central: MarkOS
    c.fillStyle = '#FFFFFF';
    c.font      = `900 21px 'Poppins', sans-serif`;
    c.fillText('MarkOS', TEX_W / 2, 46);

    // Subtítulo con acento Cyan
    c.fillStyle = '#38BDF8';
    c.font      = `700 8.5px 'Poppins', sans-serif`;
    c.fillText('B2B GROWTH OS · INFRAESTRUCTURA', TEX_W / 2, 63);

    // 4 Motores Core en micro-tarjetas oscuras
    const engines = [
      '⚙ Omni-Channel Content Engine',
      '◉ Search Dominance & ADS',
      '◎ CRM & Lead Orchestration',
      '◈ Data & Telemetry Core'
    ];
    c.font = `600 7.5px 'Poppins', sans-serif`;
    engines.forEach((eng, i) => {
      const ey = 86 + i * 18;
      c.fillStyle = 'rgba(255, 255, 255, 0.06)';
      roundRect(c, 18, ey - 7, TEX_W - 36, 16, 8);
      c.fill();
      c.strokeStyle = 'rgba(58, 181, 247, 0.35)';
      c.lineWidth   = 0.8;
      roundRect(c, 18, ey - 7, TEX_W - 36, 16, 8);
      c.stroke();

      c.fillStyle = '#3AB5F7';
      c.beginPath();
      c.arc(28, ey + 1, 2, 0, Math.PI * 2);
      c.fill();

      c.fillStyle = '#E2E8F0';
      c.textAlign = 'left';
      c.fillText(eng, 36, ey + 1.5);
    });

    // Botón CTA de Alto Impacto (Degradé Cyan → Magenta)
    c.textAlign = 'center';
    const btnGrad = c.createLinearGradient(28, 168, TEX_W - 28, 168);
    btnGrad.addColorStop(0, '#3AB5F7');
    btnGrad.addColorStop(1, '#FA61A2');
    c.fillStyle = btnGrad;
    roundRect(c, 26, 168, TEX_W - 52, 26, 13);
    c.fill();

    c.fillStyle = '#FFFFFF';
    c.font      = `800 9px 'Poppins', sans-serif`;
    c.fillText('⚡ DESPLEGAR MARKOS →', TEX_W / 2, 181);

    // Telemetría inferior
    c.fillStyle = '#94A3B8';
    c.font      = `600 7px 'Poppins', sans-serif`;
    c.fillText('PIPELINES: 14 ▲ · CAC: -42% ▼ · UPTIME: 99.9%', TEX_W / 2, 210);

    c.fillStyle = '#38BDF8';
    c.font      = `700 7.5px 'Poppins', sans-serif`;
    c.fillText('● INFRAESTRUCTURA B2B EN VIVO', TEX_W / 2, 224);

  } else if (scr.primary && scr.tagline) {
    // Pill badge superior
    c.fillStyle = colA(0.14);
    roundRect(c, TEX_W / 2 - 54, 15, 108, 20, 10);
    c.fill();
    c.fillStyle = col;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `700 8.5px 'Poppins', sans-serif`;
    c.fillText('MILKIT · SHOWROOM', TEX_W / 2, 25);

    // Título Principal
    c.fillStyle = '#0F172A';
    c.font      = `800 16px 'Poppins', sans-serif`;
    c.fillText('Soluciones', TEX_W / 2, 50);
    c.fillStyle = col;
    c.font      = `800 16px 'Poppins', sans-serif`;
    c.fillText('Creativas', TEX_W / 2, 69);

    // Servicios en cápsulas / chips modernos
    const services = [
      'Estrategia & Branding 360°',
      'SEO · Emailing · Google ADS',
      'Diseño & Animación Motion',
      'Streaming · Apps · UX/UI'
    ];
    c.font = `600 8px 'Poppins', sans-serif`;
    services.forEach((s, i) => {
      const sy = 94 + i * 17;
      c.fillStyle = 'rgba(241, 245, 249, 0.95)';
      roundRect(c, 22, sy - 7, TEX_W - 44, 15, 7.5);
      c.fill();

      // Dot indicador
      c.fillStyle = col;
      c.beginPath();
      c.arc(32, sy, 2.5, 0, Math.PI * 2);
      c.fill();

      c.fillStyle = '#334155';
      c.textAlign = 'left';
      c.fillText(s, 42, sy + 0.5);
    });

    // Botón CTA moderno tipo píldora
    c.textAlign = 'center';
    c.fillStyle = col;
    roundRect(c, 34, 172, TEX_W - 68, 26, 13);
    c.fill();
    c.fillStyle = '#FFFFFF';
    c.font      = `700 9.5px 'Poppins', sans-serif`;
    c.fillText('EXPLORAR ESTUDIO →', TEX_W / 2, 185);

    // Tagline inferior
    c.fillStyle = '#64748B';
    c.font      = `500 8px 'Poppins', sans-serif`;
    c.fillText('Soluciones Digitales de Alto Rendimiento', TEX_W / 2, 214);
    c.fillStyle = colA(0.85);
    c.font      = `700 7.5px 'Poppins', sans-serif`;
    c.fillText('● DISPONIBILIDAD INMEDIATA', TEX_W / 2, 228);

  } else {
    // ── Pantallas secundarias ─────────────────────────
    // Pill tag de categoría
    c.fillStyle = colA(0.14);
    roundRect(c, TEX_W / 2 - 46, 20, 92, 20, 10);
    c.fill();
    c.fillStyle = col;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `700 8.5px 'Poppins', sans-serif`;
    c.fillText('CAPACIDADES', TEX_W / 2, 30);

    // Label / Título
    c.fillStyle = '#0F172A';
    c.font      = `800 13.5px 'Poppins', sans-serif`;
    const words = scr.label.split(' ');
    const lines = [];
    let line    = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (c.measureText(test).width > TEX_W - 44) { lines.push(line); line = w; }
      else line = test;
    }
    lines.push(line);
    const lh  = 17;
    const sy0 = 66 - ((lines.length - 1) * lh) / 2;
    lines.forEach((l, i) => c.fillText(l, TEX_W / 2, sy0 + i * lh));

    // Puntos clave de servicio
    const subs = scr.sub.split(' · ');
    subs.slice(0, 4).forEach((s, i) => {
      const sy = 108 + i * 20;
      c.fillStyle = 'rgba(241, 245, 249, 0.9)';
      roundRect(c, 22, sy - 8, TEX_W - 44, 16, 8);
      c.fill();

      c.fillStyle = col;
      c.beginPath();
      c.arc(33, sy, 2.5, 0, Math.PI * 2);
      c.fill();

      c.fillStyle = '#475569';
      c.textAlign = 'left';
      c.font = `600 8.5px 'Poppins', sans-serif`;
      c.fillText(s, 42, sy + 0.5);
    });

    // Botón CTA inferior
    c.textAlign = 'center';
    c.fillStyle = col;
    roundRect(c, 38, TEX_H - 44, TEX_W - 76, 24, 12);
    c.fill();
    c.fillStyle = '#FFFFFF';
    c.font      = `700 9px 'Poppins', sans-serif`;
    c.fillText('DESCUBRIR MÁS →', TEX_W / 2, TEX_H - 32);
  }

  c.restore();

  // Borde exterior sutil de la tarjeta
  c.strokeStyle = colA(0.4);
  c.lineWidth   = 1.5;
  roundRect(c, 8, 8, TEX_W - 16, TEX_H - 16, 12);
  c.stroke();

  screenTexCache.set(scr.id, oc);
  return oc;
}

function initTextures() {
  SCREENS.forEach(s => buildScreenTexture(s));
}


// ══════════════════════════════════════════════════════
// §10 RENDER — TECHO Y SUELO (Galería Arquitectónica)
// ══════════════════════════════════════════════════════
function renderCeilingFloor() {
  const W2 = W / 2, H2 = H / 2;
  const theme = WALL_PALETTES[currentWallTheme] || WALL_PALETTES.cyan_obsidian;

  // ── 1. Techo Galería: Cúpula Nocturna con Óculo Neón Milkit ──
  const ceilGrad = ctx.createRadialGradient(W2, H2 * 0.35, 10, W2, H2 * 0.35, Math.max(W2, H2 * 1.3));
  ceilGrad.addColorStop(0,    theme.ceil[0]);
  ceilGrad.addColorStop(0.30, theme.ceil[1]);
  ceilGrad.addColorStop(0.70, theme.ceil[2]);
  ceilGrad.addColorStop(1,    theme.ceil[3]);
  ctx.fillStyle = ceilGrad;
  ctx.fillRect(0, 0, W, H2);

  // Anillo arquitectónico empotrado del óculo en el techo (Neón de Marca)
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(W2, H2 * 0.42, W * 0.42, H2 * 0.26, 0, 0, Math.PI * 2);
  ctx.strokeStyle = theme.ledColor;
  ctx.lineWidth   = 2.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(W2, H2 * 0.42, W * 0.42, H2 * 0.26, 0, 0, Math.PI * 2);
  ctx.strokeStyle = theme.jointColor;
  ctx.lineWidth   = 6;
  ctx.stroke();
  ctx.restore();

  // ── 2. Piso: Resina Obsidiana Pulida Tipo Espejo ────────────
  const floorGrad = ctx.createLinearGradient(0, H2, 0, H);
  floorGrad.addColorStop(0,    theme.floor[0]);
  floorGrad.addColorStop(0.12, theme.floor[1]);
  floorGrad.addColorStop(0.50, theme.floor[2]);
  floorGrad.addColorStop(1,    theme.floor[3]);
  ctx.fillStyle = floorGrad;
  ctx.fillRect(0, H2, W, H2);

  // Reflejo difuso especular del óculo sobre el suelo pulido
  const floorSpec = ctx.createRadialGradient(W2, H2 + (H - H2) * 0.55, 15, W2, H2 + (H - H2) * 0.55, W * 0.65);
  floorSpec.addColorStop(0,    theme.specular);
  floorSpec.addColorStop(0.40, 'rgba(250, 97, 162, 0.08)');
  floorSpec.addColorStop(1,    'transparent');
  ctx.fillStyle = floorSpec;
  ctx.fillRect(0, H2, W, H2);

  // Juntas luminosas de perspectiva sobre el piso obsidiana
  ctx.save();
  const slabLevels = [0.25, 0.48, 0.72, 0.94];
  slabLevels.forEach(p => {
    const y = H2 + (p ** 2.1) * H2;
    ctx.strokeStyle = theme.gridColor;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  });

  const colOffsets = [-0.62, -0.22, 0.22, 0.62];
  colOffsets.forEach(off => {
    ctx.strokeStyle = theme.gridColor;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(W2 + off * W * 0.15, H2);
    ctx.lineTo(W2 + off * W * 0.85, H);
    ctx.stroke();
  });

  // Oclusión ambiental horizontal en el zócalo de fondo
  const aoGrad = ctx.createLinearGradient(0, H2, 0, H2 + 24);
  aoGrad.addColorStop(0, 'rgba(0, 0, 0, 0.45)');
  aoGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = aoGrad;
  ctx.fillRect(0, H2, W, 24);
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
    const diffuse = clamp(-(norm.nx * LIGHT.x + norm.ny * LIGHT.y), 0.40, 1.0);

    if (hit.screen) {
      // ══════════════════════════════════════════════
      // PANTALLA DIGITAL (Showroom Kiosk Ultra-Slim)
      // ══════════════════════════════════════════════
      if (CFG.USE_CSS3D_SCREENS) {
        // En modo CSS 3D, el Canvas 2D dibuja el chasis arquitectónico minimalista
        // y el bisel de titanio sobre el que reposa la pantalla vectorial DOM interactiva.
        const isBezel = (hit.u < 0.022 || hit.u > 0.978);
        if (isBezel) {
          if (hit.screen.flagship) {
            ctx.fillStyle = (hit.u < 0.010 || hit.u > 0.990) ? '#F2C94C' : '#0B1120';
          } else {
            ctx.fillStyle = '#0F172A';
          }
        } else {
          ctx.fillStyle = hit.screen.flagship ? '#080C16' : '#0F172A';
        }
        ctx.fillRect(col, wallTop, 1, wallH);

        // Niebla suave atmosférica
        if (fog > 0.04) {
          const theme = WALL_PALETTES[currentWallTheme] || WALL_PALETTES.cyan_obsidian;
          const [fr, fg, fb] = theme.fogRgb;
          ctx.fillStyle = `rgba(${fr}, ${fg}, ${fb}, ${fog * 0.45})`;
          ctx.fillRect(col, wallTop, 1, wallH);
        }

        // Halo perimetral sutil
        if (hit.screen.flagship) {
          const pulse = 0.7 + 0.3 * Math.sin(performance.now() * 0.005);
          const edgeF = 1 - clamp(Math.min(hit.u, 1 - hit.u) / 0.10, 0, 1);
          if (edgeF > 0.01) {
            ctx.fillStyle = `rgba(58, 181, 247, ${edgeF * 0.35 * pulse * bright})`;
            ctx.fillRect(col, wallTop, 1, wallH);
          }
        }
      } else {
        // Modo Canvas 2D original (fallback)
        const isBezel = (hit.u < 0.025 || hit.u > 0.975);
        
        if (isBezel) {
          // Marco de titanio oscuro; el producto estrella lleva bisel con filo dorado
          if (hit.screen.flagship) {
            ctx.fillStyle = (hit.u < 0.012 || hit.u > 0.988) ? '#F2C94C' : '#0B1120';
          } else {
            ctx.fillStyle = '#0F172A';
          }
          ctx.fillRect(col, wallTop, 1, wallH);
        } else {
          // Pantalla interior con mapeo u
          const innerU = (hit.u - 0.025) / (0.975 - 0.025);
          const tex    = screenTexCache.get(hit.screen.id);
          const texX   = clamp((innerU * TEX_W) | 0, 0, TEX_W - 1);

          ctx.drawImage(tex, texX, 0, 1, TEX_H, col, wallTop, 1, wallH);

          // Brillo satinado de cristal museo antirreflejo
          const glassShine = Math.sin(innerU * Math.PI) * (hit.screen.flagship ? 0.09 : 0.06);
          if (glassShine > 0.01) {
            ctx.fillStyle = `rgba(255, 255, 255, ${glassShine})`;
            ctx.fillRect(col, wallTop, 1, wallH);
          }
        }

        // Niebla de profundidad
        if (fog > 0.04) {
          const theme = WALL_PALETTES[currentWallTheme] || WALL_PALETTES.cyan_obsidian;
          const [fr, fg, fb] = theme.fogRgb;
          ctx.fillStyle = `rgba(${fr}, ${fg}, ${fb}, ${fog * 0.55})`;
          ctx.fillRect(col, wallTop, 1, wallH);
        }

        // Halo de iluminación de la pantalla (MarkOS tiene aura eléctrica reactiva)
        if (hit.screen.flagship) {
          const pulse = 0.7 + 0.3 * Math.sin(performance.now() * 0.005);
          const edgeF = 1 - clamp(Math.min(hit.u, 1 - hit.u) / 0.12, 0, 1);
          if (edgeF > 0.01) {
            ctx.fillStyle = `rgba(58, 181, 247, ${edgeF * 0.75 * pulse * bright})`;
            ctx.fillRect(col, wallTop, 1, wallH);
          }
        } else {
          const edgeF = 1 - clamp(Math.min(hit.u, 1 - hit.u) / 0.07, 0, 1);
          if (edgeF > 0.01) {
            const [r, g, b] = hit.screen.rgb;
            ctx.fillStyle = `rgba(${r},${g},${b},${edgeF * 0.35 * bright})`;
            ctx.fillRect(col, wallTop, 1, wallH);
          }
        }
      }

    } else {
      // ══════════════════════════════════════════════
      // PARED ARQUITECTÓNICA (Panel modular con color de la paleta Milkit)
      // ══════════════════════════════════════════════
      const theme    = WALL_PALETTES[currentWallTheme] || WALL_PALETTES.cyan_obsidian;
      const edgeTone = (hit.edge.idx % 2 === 0) ? 1.0 : 0.88;
      const lf       = diffuse * edgeTone;

      const rVal = Math.round(theme.wallBase[0] + (theme.wallGlow[0] - theme.wallBase[0]) * lf);
      const gVal = Math.round(theme.wallBase[1] + (theme.wallGlow[1] - theme.wallBase[1]) * lf);
      const bVal = Math.round(theme.wallBase[2] + (theme.wallGlow[2] - theme.wallBase[2]) * lf);

      // Junta de dilatación vertical (Línea técnica de neón arquitectónica entre paneles)
      const isJoint = (hit.u < 0.016 || hit.u > 0.984);
      if (isJoint) {
        ctx.fillStyle = theme.jointColor;
        ctx.fillRect(col, wallTop, 1, wallH);
      } else {
        ctx.fillStyle = `rgb(${rVal},${gVal},${bVal})`;
        ctx.fillRect(col, wallTop, 1, wallH);
      }

      // Cornisa superior (remate minimalista con luz de acento)
      const cHeight = Math.max(2, Math.round(wallH * 0.022));
      ctx.fillStyle = theme.corniceColor;
      ctx.fillRect(col, wallTop, 1, cHeight);

      // Zócalo empotrado moderno con luz indirecta LED Milkit
      const bHeight = Math.max(3, Math.round(wallH * 0.045));
      ctx.fillStyle = '#050A14';
      ctx.fillRect(col, wallTop + wallH - bHeight, 1, bHeight);
      ctx.fillStyle = theme.ledColor;
      ctx.fillRect(col, wallTop + wallH - bHeight, 1, 2);

      // Niebla hacia el fondo
      if (fog > 0.01) {
        const [fr, fg, fb] = theme.fogRgb;
        ctx.fillStyle = `rgba(${fr}, ${fg}, ${fb}, ${fog * 0.85})`;
        ctx.fillRect(col, wallTop, 1, wallH);
      }
    }
  }

  return depthBuf;
}


// ══════════════════════════════════════════════════════
// §12 RENDER — AVATAR BILLBOARD (Vaquita Milkit + Peana Escultórica)
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
  const baseY   = sprTop + sprH;

  const col0 = Math.max(0,     Math.round(screenX - sprW));
  const col1 = Math.min(W - 1, Math.round(screenX + sprW));
  if (col1 < col0 || sprH < 20) return;

  let visible = false;
  for (let c = col0; c <= col1; c++) {
    if (!depthBuf[c] || camZ < depthBuf[c]) { visible = true; break; }
  }
  if (!visible) return;

  const fog   = fogFactor(camZ);
  const alpha = (1 - fog * 0.6) * 0.96;

  ctx.save();
  ctx.globalAlpha = alpha;

  // ── 1. Sombra de contacto en el suelo (Ambient Occlusion) ──
  const pedW     = sprW * 0.95;
  const pedRy    = pedW * 0.28;
  const pedStepH = Math.max(6, sprH * 0.08);

  const floorAo = ctx.createRadialGradient(screenX, baseY + pedStepH * 0.5, 5, screenX, baseY + pedStepH * 0.5, pedW * 1.45);
  floorAo.addColorStop(0,   'rgba(15, 23, 42, 0.40)');
  floorAo.addColorStop(0.5, 'rgba(15, 23, 42, 0.15)');
  floorAo.addColorStop(1,   'transparent');
  ctx.fillStyle = floorAo;
  ctx.beginPath();
  ctx.ellipse(screenX, baseY + pedStepH * 0.6, pedW * 1.4, pedRy * 1.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── 2. Peana Escultórica Cilíndrica (Plinth contemporáneo) ──
  // Lateral cilíndrico del pedestal
  const pedSideGrad = ctx.createLinearGradient(screenX - pedW, baseY, screenX + pedW, baseY);
  pedSideGrad.addColorStop(0,   '#cbd5e1');
  pedSideGrad.addColorStop(0.3, '#f1f5f9');
  pedSideGrad.addColorStop(0.7, '#e2e8f0');
  pedSideGrad.addColorStop(1,   '#94a3b8');

  ctx.fillStyle = pedSideGrad;
  ctx.beginPath();
  ctx.ellipse(screenX, baseY + pedStepH, pedW, pedRy, 0, 0, Math.PI);
  ctx.lineTo(screenX - pedW, baseY);
  ctx.ellipse(screenX, baseY, pedW, pedRy, 0, Math.PI, 0, true);
  ctx.closePath();
  ctx.fill();

  // Base bisel inferior con anillo LED Milkit Cyan
  ctx.strokeStyle = 'rgba(58, 181, 247, 0.4)';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.ellipse(screenX, baseY + pedStepH, pedW, pedRy, 0, 0, Math.PI);
  ctx.stroke();

  // Cara superior del pedestal (elipse satinada)
  const pedTopGrad = ctx.createRadialGradient(screenX - pedW * 0.2, baseY - pedRy * 0.2, 5, screenX, baseY, pedW);
  pedTopGrad.addColorStop(0,   '#ffffff');
  pedTopGrad.addColorStop(0.7, '#f1f5f9');
  pedTopGrad.addColorStop(1,   '#e2e8f0');
  ctx.fillStyle = pedTopGrad;
  ctx.beginPath();
  ctx.ellipse(screenX, baseY, pedW, pedRy, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  // Sombra de contacto de la Vaquita sobre la superficie del pedestal
  ctx.fillStyle = 'rgba(15, 23, 42, 0.35)';
  ctx.beginPath();
  ctx.ellipse(screenX, baseY - 2, sprW * 0.38, pedRy * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── 3. Aura Milkit etérea y suave ──────────────────────────
  const aura = ctx.createRadialGradient(screenX, baseY - sprH * 0.5, 0, screenX, baseY - sprH * 0.5, sprH * 0.65);
  aura.addColorStop(0,   'rgba(250,97,162,0.18)');   // --hot rosa
  aura.addColorStop(0.4, 'rgba(58,181,247,0.08)');   // --accent cyan
  aura.addColorStop(1,   'transparent');
  ctx.fillStyle = aura;
  ctx.fillRect(screenX - sprW, sprTop - 20, sprW * 2, sprH + 40);

  // ── 4. Respiración / Suspensión sutil del Sprite ───────────
  const breath = Math.sin(performance.now() * 0.0025) * (sprH * 0.015);
  const drawY  = sprTop - 4 + breath;

  if (!CFG.USE_CSS3D_SCREENS) {
    if (avatarSprite.complete && avatarSprite.naturalWidth > 0) {
      ctx.drawImage(avatarSprite,
        screenX - sprW / 2, drawY,
        sprW, sprH
      );
    } else {
      // Fallback: avatar estilizado
      ctx.fillStyle   = 'rgba(250,97,162,0.9)';
      ctx.shadowColor = '#FA61A2';
      ctx.shadowBlur  = 16;
      ctx.fillRect(screenX - sprW / 2, drawY, sprW, sprH);
      ctx.shadowBlur  = 0;
      ctx.fillStyle   = '#fff';
      ctx.font        = `700 ${Math.round(sprH * 0.12)}px 'Poppins', sans-serif`;
      ctx.textAlign   = 'center';
      ctx.fillText('Milkit', screenX, drawY + sprH * 0.55);
    }
  }

  ctx.restore();
}


// ══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════
// §13 RENDER — HUD
// ══════════════════════════════════════════════════════

/**
 * Detecta qué pantalla está en el centro de la mira,
 * verificando si la Vaquita (avatar billboard) ocluye la visión.
 */
function getCenterAimScreen() {
  const centerHit = castRay(player.dir);
  if (!centerHit || !centerHit.screen) return null;

  // Proyección de la Vaquita (ubicada en 0,0 del salón)
  const toX  = -player.x;
  const toY  = -player.y;
  const cosD = Math.cos(player.dir);
  const sinD = Math.sin(player.dir);
  const camZ =  toX * cosD + toY * sinD;
  const camX =  toY * cosD - toX * sinD;

  // Si la Vaquita está en el campo visual frontal y más cerca que la pared
  if (camZ > 40 && camZ < centerHit.perpDist) {
    const projF   = (W / 2) / Math.tan(CFG.FOV / 2);
    const screenX = (W / 2) + (camX / camZ) * projF;
    const sprH    = (CFG.WALL_SCALE * H * CFG.ROOM_R * 0.90) / camZ;
    const sprW    = sprH * 0.65;
    const sprTop  = (H - sprH) / 2;
    const sprBot  = sprTop + sprH;

    const W2 = W / 2, H2 = H / 2;
    // Si la mira central cae dentro de la silueta de la Vaquita o su pedestal
    if (Math.abs(screenX - W2) <= sprW * 0.58 && H2 >= sprTop - 10 && H2 <= sprBot + sprH * 0.15) {
      // La mira está sobre la Vaquita; la pared detrás queda ocluida
      return null;
    }
  }

  return centerHit.screen;
}

function renderHUD() {
  const W2 = W/2, H2 = H/2;

  // Detectar pantalla al centro (respetando oclusión por la Vaquita)
  hoveredScreen   = getCenterAimScreen();
  const onScreen  = !!hoveredScreen;

  // ── 1. Crosshair ─────────────────────────────────
  const cs = onScreen ? 11 : 7;
  ctx.strokeStyle = onScreen ? '#FA61A2' : 'rgba(45, 45, 45, 0.45)';
  ctx.lineWidth   = onScreen ? 2 : 1.2;
  ctx.beginPath();
  ctx.moveTo(W2-cs, H2); ctx.lineTo(W2+cs, H2);
  ctx.moveTo(W2, H2-cs); ctx.lineTo(W2, H2+cs);
  ctx.stroke();

  // ── 2. Label de pantalla en hover ──────────────────
  // En modo CSS 3D, la pantalla interactiva ya muestra su tarjeta 4K y botón directamente en 3D.
  // Solo dibujamos la tarjeta 2D flotante en modo Canvas clásico (fallback).
  if (onScreen && !CFG.USE_CSS3D_SCREENS) {
    const scr = hoveredScreen;
    const [r, g, b] = scr.rgb;
    const isFlag = !!scr.flagship;

    const lW  = clamp(Math.round(scr.label.length * 9.5 + 70), 300, Math.min(540, Math.round(W * 0.88)));
    const lH  = isFlag ? 92 : 76;
    const lX  = W2 - lW / 2;
    const lY  = isTouchDevice ? Math.max(H2 + 40, H - lH - 95) : (H - lH - 26);

    ctx.fillStyle = isFlag ? 'rgba(8, 12, 22, 0.96)' : 'rgba(255, 255, 255, 0.96)';
    roundRect(ctx, lX, lY, lW, lH, 10);
    ctx.fill();

    ctx.strokeStyle = isFlag ? '#3AB5F7' : `rgba(${r},${g},${b},0.85)`;
    ctx.lineWidth   = isFlag ? 2 : 1.5;
    ctx.stroke();

    // Barra superior
    ctx.fillStyle = isFlag ? '#F2C94C' : `rgb(${r},${g},${b})`;
    ctx.fillRect(lX + 8, lY, lW - 16, 2.5);

    let curY = lY + 18;
    if (isFlag) {
      ctx.fillStyle    = '#F2C94C';
      ctx.font         = `700 8px 'Poppins', sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('★ PRODUCTO ESTRELLA · INFRAESTRUCTURA B2B', W2, curY);
      curY += 16;
    }

    ctx.fillStyle    = isFlag ? '#FFFFFF' : '#2D2D2D';
    ctx.font         = `800 13px 'Poppins', sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(scr.label, W2, curY);
    curY += 15;

    ctx.fillStyle = isFlag ? '#94A3B8' : '#718096';
    ctx.font      = `500 9px 'Poppins', sans-serif`;
    ctx.fillText(scr.sub, W2, curY);
    curY += 16;

    if (isFlag) {
      ctx.fillStyle = '#38BDF8';
      ctx.font      = `800 9.5px 'Poppins', sans-serif`;
      ctx.fillText('⚡ [ CLICK ]  DESPLEGAR INFRAESTRUCTURA MARKOS', W2, curY);
    } else {
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.font      = `700 9.5px 'Poppins', sans-serif`;
      ctx.fillText('[ CLICK ]  explorar este espacio', W2, curY);
    }
  }

  // ── 3. Horizonte luminoso ──────────────────────────
  const hg = ctx.createLinearGradient(W2-260, H2, W2+260, H2);
  hg.addColorStop(0,    'transparent');
  hg.addColorStop(0.38, 'rgba(58,181,247,0.20)');
  hg.addColorStop(0.62, 'rgba(58,181,247,0.20)');
  hg.addColorStop(1,    'transparent');
  ctx.fillStyle = hg;
  ctx.fillRect(0, H2, W, 1);

  // ── 4. Viñeta cinematográfica oscura ───────────────
  const vig = ctx.createRadialGradient(W2, H2, H*0.35, W2, H2, H*0.90);
  vig.addColorStop(0,  'transparent');
  vig.addColorStop(1,  'rgba(3, 6, 14, 0.48)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // ── 5. Brújula ────────────────────────────────────
  renderCompass();
}

function renderCompass() {
  const cx = W-58, cy = 58, r = 28;
  ctx.save();
  ctx.globalAlpha = 0.90;

  ctx.fillStyle = 'rgba(8, 14, 28, 0.88)';
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

    if (scr.flagship) {
      // Beacon especial para MarkOS (Producto Estrella)
      const pulse = 3 + 2 * Math.sin(performance.now() * 0.006);
      ctx.fillStyle = 'rgba(58, 181, 247, 0.45)';
      ctx.beginPath();
      ctx.arc(dx, dy, pulse + 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = inFov ? '#F2C94C' : 'rgba(242, 201, 76, 0.85)';
      ctx.beginPath();
      ctx.arc(dx, dy, inFov ? 5.5 : 4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = inFov ? `rgb(${sr},${sg},${sb})` : `rgba(${sr},${sg},${sb},0.45)`;
      ctx.beginPath();
      ctx.arc(dx, dy, inFov ? 4 : 2.5, 0, Math.PI*2);
      ctx.fill();
    }
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
// §14b RENDER — PROYECCIÓN VECTORIAL CSS 3D
//      (Pantallas DOM de Ultra Alta Definición 4K)
// ══════════════════════════════════════════════════════

const CSS3D_SCREENS = [
  { edgeIdx: 0, domId: 'css3d-screen-markos',     screenId: 'markos' },
  { edgeIdx: 3, domId: 'css3d-screen-creativas',  screenId: 'milkit-creativas' },
  { edgeIdx: 5, domId: 'css3d-screen-seo',        screenId: 'milkit-seo' },
  { edgeIdx: 8, domId: 'css3d-screen-multimedia', screenId: 'milkit-multimedia' },
];

let css3dViewportEl = null;
let css3dElements   = null;
let css3dVaquitaEl  = null;

function initCSS3DElements() {
  css3dViewportEl = document.getElementById('css3d-viewport');
  css3dVaquitaEl  = document.getElementById('css3d-vaquita');
  if (!css3dViewportEl) return;
  css3dElements = CSS3D_SCREENS.map(item => ({
    ...item,
    el:   document.getElementById(item.domId),
    edge: EDGES[item.edgeIdx],
  }));
}

function updateCSS3DScreens() {
  if (!css3dViewportEl) initCSS3DElements();
  if (!css3dViewportEl) return;

  if (!CFG.USE_CSS3D_SCREENS) {
    if (css3dViewportEl.style.display !== 'none') css3dViewportEl.style.display = 'none';
    return;
  }
  if (css3dViewportEl.style.display === 'none') css3dViewportEl.style.display = 'block';

  const projF = (W / 2) / Math.tan(CFG.FOV / 2);
  css3dViewportEl.style.perspective = `${projF.toFixed(1)}px`;

  const worldH  = (CFG.WALL_SCALE * H * CFG.ROOM_R) / projF;
  const edgeLen = 2 * CFG.ROOM_R * Math.sin(Math.PI / CFG.SIDES);
  const scaleX  = edgeLen / 480;
  const scaleY  = worldH / 520;

  const cosD = Math.cos(player.dir);
  const sinD = Math.sin(player.dir);

  // 1. Proyección de las 4 pantallas interactivas
  if (css3dElements) {
    for (const scr of css3dElements) {
      const el = scr.el;
      if (!el) continue;

      const edge = scr.edge;
      const mx = (edge.a.x + edge.b.x) / 2;
      const my = (edge.a.y + edge.b.y) / 2;

      const toX = mx - player.x;
      const toY = my - player.y;

      const camZ = toX * cosD + toY * sinD;
      const camX = toY * cosD - toX * sinD;

      // Culling frontal / clipping
      if (camZ < 50) {
        el.style.display = 'none';
        continue;
      }

      // Culling angular (fuera de FOV)
      const angleToScreen = Math.atan2(toY, toX);
      const diffAngle = Math.abs(normalizeAngle(angleToScreen - player.dir));
      if (diffAngle > (CFG.FOV / 2 + 0.38)) {
        el.style.display = 'none';
        continue;
      }

      // Orientación angular de la pared
      const dx = edge.b.x - edge.a.x;
      const dy = edge.b.y - edge.a.y;
      const edgeAngle = Math.atan2(dy, dx);
      const relRot = -normalizeAngle((edgeAngle - Math.PI / 2) - player.dir);

      // Backface culling
      if (Math.abs(relRot) > Math.PI / 2 + 0.15) {
        el.style.display = 'none';
        continue;
      }

      // Estado activo / hover
      if (hoveredScreen && hoveredScreen.id === scr.screenId) {
        el.classList.add('is-hovered');
      } else {
        el.classList.remove('is-hovered');
      }

      el.style.display   = 'flex';
      el.style.transform = `translate3d(${camX.toFixed(2)}px, 0px, ${(projF - camZ).toFixed(2)}px) rotateY(${relRot.toFixed(4)}rad) scale(${scaleX.toFixed(4)}, ${scaleY.toFixed(4)})`;
      el.style.zIndex    = Math.round(10000 - camZ);
    }
  }

  // 2. Proyección de Vaquita 3D Billboard en el layer DOM
  if (css3dVaquitaEl) {
    const toX  = -player.x;
    const toY  = -player.y;
    const camZ =  toX * cosD + toY * sinD;
    const camX =  toY * cosD - toX * sinD;

    if (camZ < 40) {
      css3dVaquitaEl.style.display = 'none';
    } else {
      const angleToVaq = Math.atan2(toY, toX);
      const diffAngle  = Math.abs(normalizeAngle(angleToVaq - player.dir));
      if (diffAngle > (CFG.FOV / 2 + 0.45)) {
        css3dVaquitaEl.style.display = 'none';
      } else {
        const vaqWorldH = worldH * 0.90;
        const vaqWorldW = vaqWorldH * 0.65;
        const vaqScaleX = vaqWorldW / 320;
        const vaqScaleY = vaqWorldH / 490;
        const breath    = Math.sin(performance.now() * 0.0025) * 4;

        css3dVaquitaEl.style.display   = 'block';
        css3dVaquitaEl.style.transform = `translate3d(${camX.toFixed(2)}px, ${breath.toFixed(1)}px, ${(projF - camZ).toFixed(2)}px) scale(${vaqScaleX.toFixed(4)}, ${vaqScaleY.toFixed(4)})`;
        css3dVaquitaEl.style.zIndex    = Math.round(10000 - camZ);
      }
    }
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
  updateCSS3DScreens();
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
    if (screen.id === 'markos' || screen.id === 'milkit-creativas') {
      openProductEnvironment(screen.id);
    } else {
      showToast(`Próximamente · ${screen.label}`);
    }
  }, 400);
}

function openProductEnvironment(productId) {
  if (productId === 'markos' || productId === 'milkit-creativas') {
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
      openProductEnvironment('markos');
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
