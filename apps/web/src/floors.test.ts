import { describe, it, expect } from 'vitest';
import fixture from '../../../packages/scene/scene.example.json';
import catalog from '../../../packages/catalog/items.json';
import type { Scene, Item } from './types';
import { clone, resizedRoom, addFurniture, addRoom, floorScene } from './scene';
import { useScene } from './store';
import { applyMeasurements, importMeasurements } from './measurements';

function twoFloors() {
  const s = clone(fixture) as unknown as Scene,
    top = clone(s.floors[0]);
  top.id = 'upper';
  top.name = '二层';
  top.elevationMm = 3000;
  top.rooms.forEach((r) => {
    r.id = 'upper-' + r.id;
    r.wallRefs.forEach((ref) => (ref.wallId = 'upper-' + ref.wallId));
  });
  top.walls.forEach((w) => (w.id = 'upper-' + w.id));
  top.openings.forEach((o) => {
    o.id = 'upper-' + o.id;
    o.wallId = 'upper-' + o.wallId;
    o.connects = o.connects.map((id) => (id ? 'upper-' + id : null));
    if (o.swing) o.swing.roomId = 'upper-' + o.swing.roomId;
  });
  s.floors.push(top);
  return s;
}
describe('floor isolation', () => {
  it('resizes only the room floor and records its actual floor ID', () => {
    const s = twoFloors();
    s.floors[1].walls[0].heightMm = 1050;
    const next = resizedRoom(s, s.floors[1].rooms[0], 4500, 5200, 2700);
    expect(next.floors[0]).toEqual(s.floors[0]);
    expect(next.layout.furniture).toEqual(s.layout.furniture);
    expect(next.floors[1].walls[0].heightMm).toBe(1050);
    expect(next.measurements.slice(-3).every((m) => m.floorId === 'upper')).toBe(true);
  });
  it('adds objects and new rooms to the selected floor', () => {
    const s = twoFloors(),
      before = clone(s.floors[0]);
    const f = addFurniture(
      s,
      catalog.find((i) => i.id === 'desk') as Item,
      s.floors[1].rooms[0].id,
    );
    expect(f.floorId).toBe('upper');
    addRoom(
      s,
      [
        [10000, 0],
        [12000, 0],
        [12000, 2000],
        [10000, 2000],
      ],
      '新房间',
      'upper',
    );
    expect(s.floors[0]).toEqual(before);
    expect(s.floors[1].rooms.at(-1)?.name).toBe('新房间');
    const projected = floorScene(s, 'upper');
    expect(projected.layout.furniture.map((o) => o.id)).toEqual([f.id]);
  });
  it('switches floor without changing the scene or undo history', () => {
    const s = twoFloors();
    useScene.getState().load('test', { scene: s, revision: 0, baseDesignId: null, updatedAt: '' });
    useScene.getState().selectFloor('upper');
    expect(useScene.getState().roomId).toBe(s.floors[1].rooms[0].id);
    expect(useScene.getState().dirty).toBe(false);
    expect(useScene.getState().past).toHaveLength(0);
    expect(useScene.getState().scene).toBe(s);
  });
  it('applies upper-floor measurements without changing ground-floor coordinates', () => {
    const s = twoFloors(),
      rid = s.floors[1].rooms[0].id;
    const result = applyMeasurements(s, [
      {
        label: '上层',
        targetType: 'room',
        targetId: rid,
        value: 4.5,
        unit: 'm',
        type: 'width',
        method: 'tape',
        at: '2026-10-23T00:00:00Z',
        notes: '',
      },
    ]);
    expect(result.scene.floors[0]).toEqual(s.floors[0]);
    expect(result.records[0].floorId).toBe('upper');
  });
  it('does not silently resolve duplicated room names to a different floor', () => {
    const s = twoFloors();
    const csv = 'target_type,target_label,measurement_type,value,unit\nroom,客厅,width,4,m';
    expect(importMeasurements(csv, s)[0].targetId).toBe('');
  });
});
