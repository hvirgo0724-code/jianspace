import { describe, it, expect } from 'vitest';
import fixture from '../../../packages/scene/scene.example.json';
import type { Scene } from './types';
import { clone } from './scene';
import {
  duplicateSelected,
  moveSelected,
  alignSelected,
  corners,
  syncRoomBoundaries,
} from './editorCommands';
import { bounds } from './scene';
describe('editor transactions', () => {
  it('does not place copies inside fixed obstacles', () => {
    const s = clone(fixture) as unknown as Scene,
      source = s.layout.furniture[0];
    source.locked = false;
    const floor = s.floors.find((f) => f.id === source.floorId)!,
      room = floor.rooms.find((r) => r.id === source.roomId)!;
    floor.obstacles = [
      {
        id: 'fixed-test',
        kind: 'other',
        polygonMm: clone(room.boundaryMm),
        baseZMm: 0,
        heightMm: 2800,
        locked: true,
      },
    ];
    const count = s.layout.furniture.length;
    expect(() => duplicateSelected(s, [source.id])).toThrow('未找到');
    expect(s.layout.furniture).toHaveLength(count);
  });
  it('duplicates furniture with an independent quote snapshot and keeps the original', () => {
    const s = clone(fixture) as unknown as Scene,
      source = s.layout.furniture[0];
    source.locked = false;
    const quote = s.layout.catalogSnapshot.find((c) => c.skuId === source.skuId)!;
    quote.priceMinor = 12345;
    const copied = duplicateSelected(s, [source.id]),
      next = s.layout.furniture.find((f) => f.id === copied[0])!;
    expect(next.skuId).not.toBe(source.skuId);
    expect(next.floorId).toBe(source.floorId);
    const newQuote = s.layout.catalogSnapshot.find((c) => c.skuId === next.skuId)!;
    expect(newQuote.priceMinor).toBe(12345);
    newQuote.priceMinor = 999;
    expect(quote.priceMinor).toBe(12345);
  });
  it('moves a group while preserving relative offsets and respecting locks', () => {
    const s = clone(fixture) as unknown as Scene,
      [a, b] = s.layout.furniture;
    a.locked = false;
    b.locked = true;
    const before = clone(s.layout.furniture);
    moveSelected(s, [a.id, b.id], 150, -50);
    expect(a.positionMm[0] - before[0].positionMm[0]).toBe(150);
    expect(b).toEqual(before[1]);
  });
  it('aligns the bounds of rotated objects', () => {
    const s = clone(fixture) as unknown as Scene,
      [a, b] = s.layout.furniture;
    a.locked = false;
    b.locked = false;
    b.rotationDeg = 90;
    alignSelected(s, [a.id, b.id], 'left');
    expect(bounds(corners(a)).minX).toBeCloseTo(bounds(corners(b)).minX);
  });
  it('rebuilds room corners after a shared wall thickness change', () => {
    const s = clone(fixture) as unknown as Scene,
      before = clone(s.floors[0]),
      f = s.floors[0];
    const shared = f.walls.find(
      (w) => f.rooms.filter((r) => r.wallRefs.some((ref) => ref.wallId === w.id)).length === 2,
    )!;
    shared.thicknessMm += 100;
    syncRoomBoundaries(before, f);
    expect(f.rooms[0].computedAreaMm2).toBeLessThan(before.rooms[0].computedAreaMm2);
    expect(f.rooms[1].computedAreaMm2).toBeLessThan(before.rooms[1].computedAreaMm2);
  });
});
