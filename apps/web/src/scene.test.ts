import { describe, it, expect } from 'vitest';
import fixture from '../../../packages/scene/scene.example.json';
import { resizedRoom, clone, addFurniture } from './scene';
import type { Scene } from './types';
describe('measured scene commands', () => {
  it('resizes adjacent spaces and retains wall faces with integer coordinates', () => {
    const s = clone(fixture) as unknown as Scene;
    const r = s.floors[0].rooms[0];
    const next = resizedRoom(s, r, 4500, 5200, 2900);
    expect(next.floors[0].rooms[0].computedAreaMm2).toBe(4500 * 5200);
    expect(next.confirmation.status).toBe('draft');
    expect(next.floors[0].rooms[1].boundaryMm[0][0]).toBe(
      s.floors[0].rooms[1].boundaryMm[0][0] + 500,
    );
    expect(s.floors[0].rooms[0].computedAreaMm2).toBe(20e6);
    expect(next.measurements.length).toBe(s.measurements.length + 3);
  });
  it('creates a private furniture snapshot with unknown price', () => {
    const s = clone(fixture) as unknown as Scene;
    const f = addFurniture(
      s,
      {
        id: 'desk',
        name: '书桌',
        category: 'desk',
        sizeMm: [1200, 600, 750],
        priceMinor: null,
        color: '#aaa',
      },
      s.floors[0].rooms[0].id,
    );
    const c = s.layout.catalogSnapshot.find((c) => c.skuId === f.skuId)!;
    expect(c.sourceType).toBe('user_input');
    expect(c.priceMinor).toBeNull();
    expect(f.positionMm.every(Number.isInteger)).toBe(true);
  });
});
