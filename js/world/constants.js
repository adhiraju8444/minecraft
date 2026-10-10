export const CHUNK = 16;
export const HEIGHT = 128;
export const SECTIONS = HEIGHT / 16;
export const SEA_LEVEL = 62;
export const CHUNK_VOLUME = CHUNK * CHUNK * HEIGHT;

export const TICKS_PER_SECOND = 20;
export const TICK_MS = 1000 / TICKS_PER_SECOND;
export const DAY_LENGTH = 24000;

// Local cell index inside a chunk column. y-major so a horizontal layer is contiguous.
export function cellIndex(x, y, z) {
  return x | (z << 4) | (y << 8);
}

export function chunkKey(cx, cz) {
  return (cx + 32768) * 65536 + (cz + 32768);
}

// Horizontal facing, same order the rest of the game uses for meta values:
// 0 = south (+z), 1 = west (-x), 2 = north (-z), 3 = east (+x)
export const FACING_DX = [0, -1, 0, 1];
export const FACING_DZ = [1, 0, -1, 0];
export const FACING_NAMES = ['south', 'west', 'north', 'east'];

// Cube faces: 0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z
export const FACE_DIRS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export const DIFFICULTY = ['Peaceful', 'Easy', 'Normal', 'Hard'];

// Map a horizontal facing index to the cube face pointing that way.
export function facingToFace(f) {
  return [4, 1, 5, 0][f & 3];
}

// Map a horizontal cube face to facing index (or -1 for top/bottom).
export function faceToFacing(face) {
  return [3, 1, -1, -1, 0, 2][face];
}
