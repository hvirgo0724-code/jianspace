import { describe, expect, it } from 'vitest';
import fixture from '../../../packages/scene/scene.example.json';
import type { Asset, Design, Project, Scene } from './types';
import { projectReadiness, selectProjects } from './projectWorkflow';

const scene = () => structuredClone(fixture) as unknown as Scene;
const project = (id: string, values: Partial<Project> = {}) =>
  ({
    id,
    name: id,
    description: '',
    archived: false,
    updatedAt: '2026-10-24T00:00:00Z',
    ...values,
  }) as Project;
const design = (s: Scene) =>
  ({ id: 'version', geometryVersionId: s.geometryVersionId, scene: structuredClone(s) }) as Design;
describe('project workflow data', () => {
  it('combines archive, source status and trimmed name/description search without changing server order', () => {
    const rows = [
      project('a', { description: 'Loft loft', geometryStatus: 'confirmed' }),
      project('b', { archived: true, description: 'loft' }),
      project('c'),
    ];
    const before = structuredClone(rows);
    expect(selectProjects(rows, ' LOFT ', false, 'confirmed', 'updated').map((p) => p.id)).toEqual([
      'a',
    ]);
    expect(selectProjects(rows, '', true, 'all', 'updated').map((p) => p.id)).toEqual(['b']);
    expect(rows).toEqual(before);
  });
  it('sorts actual areas before unknown areas and resolves equal timestamps deterministically', () => {
    const rows = [project('c'), project('b', { areaM2: 60 }), project('a', { areaM2: 120 })];
    expect(selectProjects(rows, '', false, 'all', 'area').map((p) => p.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(selectProjects(rows, '', false, 'all', 'updated').map((p) => p.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
  it('does not treat a recorded confirmation as a successful current validation', () => {
    const source = scene();
    source.confirmation.status = 'confirmed';
    const summary = projectReadiness(source, [], []);
    expect(summary.errors).toEqual([]);
    expect(summary.validationState).toBe('unavailable');
    expect(summary.currentDesigns).toEqual([]);
    expect(summary.confirmed).toBe(true);
  });
  it('keeps saved versions historical after editing geometry even before its ID changes', () => {
    const s = scene();
    s.confirmation.status = 'confirmed';
    const saved = design(s);
    expect(projectReadiness(s, [saved], []).currentDesigns).toHaveLength(1);
    s.floors[0].walls[0].heightMm += 100;
    expect(projectReadiness(s, [saved], []).currentDesigns).toHaveLength(0);
  });
  it('counts only uploaded photos, not generated images or floorplans', () => {
    const assets = [{ kind: 'photo' }, { kind: 'generated' }, { kind: 'floorplan' }] as Asset[];
    expect(projectReadiness(scene(), [], assets).photos).toHaveLength(1);
  });
  it('counts missing quotes for placed furniture and preserves an explicitly entered zero', () => {
    const s = scene();
    s.layout.catalogSnapshot[0].priceMinor = 0;
    s.layout.furniture.push({ ...s.layout.furniture[0], id: 'missing', skuId: 'unquoted' });
    s.layout.renovation = {
      rooms: [
        { roomId: s.floors[0].rooms[0].id, enabled: true, floorMaterialMinor: 0 },
        { roomId: s.floors[0].rooms[1].id, enabled: false, floorMaterialMinor: 100 },
      ],
    };
    const result = projectReadiness(s, [], []);
    expect(result.unknownPrices).toBe(1);
    expect(result.roomsWithQuotes).toBe(1);
  });
});
