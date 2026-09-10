/**
 * map.js — Definición de geometría del mundo 2.5D
 * Mikit Multimedia · Engine Layer 1
 *
 * Celda = 64x64 px virtuales
 * Tipo  : 0 = vacío, 1 = pared sólida, 2 = portal Agente Marketing, 3 = portal Galería
 */

const CELL_SIZE = 64;

const MAP_DATA = [
  // Sala principal de entrada
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,1,1,0,0,0,0,0,0,1,1,0,0,1],
  [1,0,0,1,0,0,0,0,0,0,0,0,1,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3],  // ← Portales en los extremos
  [2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,1,0,0,0,0,0,0,0,0,1,0,0,1],
  [1,0,0,1,1,0,0,0,0,0,0,1,1,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
];

const MAP_WIDTH  = MAP_DATA[0].length;
const MAP_HEIGHT = MAP_DATA.length;

/** Retorna el tipo de celda en coordenadas de tile */
function getCell(tileX, tileY) {
  if (tileX < 0 || tileX >= MAP_WIDTH || tileY < 0 || tileY >= MAP_HEIGHT) return 1;
  return MAP_DATA[tileY][tileX];
}

/** Retorna el tipo de celda en coordenadas de mundo (píxeles) */
function getCellWorld(worldX, worldY) {
  return getCell(Math.floor(worldX / CELL_SIZE), Math.floor(worldY / CELL_SIZE));
}

/** Paleta de colores por tipo de bloque */
const WALL_COLORS = {
  1: { near: '#6a7f8a', far: '#2a3540' },   // Pared estándar
  2: { near: '#ff0055', far: '#5c0020' },   // Portal Agente (rojo neón)
  3: { near: '#00eeff', far: '#004d5c' },   // Portal Galería (cyan neón)
};
