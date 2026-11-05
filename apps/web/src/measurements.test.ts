import { describe, it, expect } from 'vitest';
import fixture from '../../../packages/scene/scene.example.json';
import type { Scene } from './types';
import { parseCSV, importMeasurements, applyMeasurements } from './measurements';
describe('measurement CSV', () => {
  it('retains quoted commas and rejects an unfinished quote', () => {
    expect(parseCSV('a,b\n"room, west",4')).toEqual([
      ['a', 'b'],
      ['room, west', '4'],
    ]);
    expect(() => parseCSV('"bad')).toThrow();
  });
  it('normalizes original units and applies a mapped room dimension', () => {
    const s = structuredClone(fixture) as unknown as Scene;
    const rows = importMeasurements(
      'floor_id,room_id,target_type,target_label,measurement_type,value,unit,method,measured_at,notes\nfloor-1,room-living,room,客厅,width,4.5,m,laser,2026-10-22T10:00:00+08:00,净尺寸',
      s,
    );
    expect(rows[0].targetId).toBe('room-living');
    const result = applyMeasurements(s, rows);
    expect(result.records[0].normalizedMm).toBe(4500);
    expect(result.records[0].rawUnit).toBe('m');
    expect(result.scene.floors[0].rooms[0].computedAreaMm2).toBe(22.5e6);
    expect(result.scene.confirmation.status).toBe('draft');
  });
  it('blocks unassociated wall records and negative dimensions', () => {
    const s = structuredClone(fixture) as unknown as Scene;
    expect(() =>
      importMeasurements('target_type,measurement_type,value,unit\nroom,width,-4,m', s),
    ).toThrow();
    const rows = importMeasurements(
      'target_type,target_label,measurement_type,value,unit\nwall,共用墙,height,2800,mm',
      s,
    );
    expect(() => applyMeasurements(s, rows)).toThrow();
  });
});
