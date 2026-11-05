export const FLOOR_FINISHES = [
  { id: 'oak-natural', name: '自然橡木', color: '#e9d1a9', kind: 'wood' },
  { id: 'walnut', name: '深色胡桃木', color: '#826044', kind: 'wood' },
  { id: 'oak-pale', name: '浅色木地板', color: '#eee7d7', kind: 'wood' },
  { id: 'tile-warm', name: '暖灰大砖 · 600 mm', color: '#d2cbc0', kind: 'tile' },
  { id: 'marble-white', name: '浅白石材', color: '#ece9e2', kind: 'marble' },
  { id: 'terrazzo', name: '细骨料水磨石', color: '#d8d2c5', kind: 'terrazzo' },
  { id: 'concrete', name: '清水微水泥', color: '#b9b8ac', kind: 'concrete' },
  { id: 'outdoor-stone', name: '庭院石板', color: '#a49e8e', kind: 'paving' },
  { id: 'grass', name: '庭院草坪', color: '#798b51', kind: 'grass' },
] as const;
export function isOutdoor(type: string) {
  return ['courtyard', 'terrace'].includes(type);
}
export function isInteriorArea(type: string) {
  return !isOutdoor(type) && type !== 'stairwell';
}
export function floorFinish(materialId?: string, roomType?: string) {
  return (
    FLOOR_FINISHES.find((m) => m.id === materialId) ||
    FLOOR_FINISHES.find(
      (m) =>
        m.id ===
        (isOutdoor(roomType || '')
          ? 'outdoor-stone'
          : ['bathroom', 'kitchen'].includes(roomType || '')
            ? 'tile-warm'
            : 'oak-natural'),
    )!
  );
}
