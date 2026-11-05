import { describe, it, expect } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import source from '../../../packages/catalog/items.json';
import fixture from '../../../packages/scene/scene.example.json';
import { filterCatalog, MODEL_KINDS, CATALOG_GROUPS } from './catalog';
import { addFurniture, clone } from './scene';
import { furnitureKind } from './components/visuals/sceneMath';
import { localModelBounds } from './components/visuals/geometryBounds';
import type { Item, Scene } from './types';
const items = source as Item[];
describe('expanded furniture and appliance catalog', () => {
  it('has unique entries and an explicit render model for every category', () => {
    expect(items.length).toBe(48);
    expect(new Set(items.map((i) => i.id)).size).toBe(48);
    for (const item of items) {
      expect(MODEL_KINDS).toContain(item.modelKind);
      expect(CATALOG_GROUPS.map((g) => g[0])).toContain(item.group);
      expect(furnitureKind(item.name, 'builtin-' + item.modelKind)).toBe(item.modelKind);
      expect(item.sizeMm.every((v) => Number.isInteger(v) && v > 0)).toBe(true);
      expect(item.priceMinor).toBeNull();
    }
  });
  it('combines category and Chinese / English search without hiding the rest of the catalog', () => {
    expect(filterCatalog(items, 'appliances', 'FRIDGE').map((i) => i.id)).toContain('fridge');
    expect(filterCatalog(items, 'appliances', '冰箱')).toHaveLength(2);
    expect(filterCatalog(items, 'living', '冰箱')).toHaveLength(0);
    expect(filterCatalog(items, 'all', '  壁挂   空调  ').map((i) => i.id)).toEqual(['wall-ac']);
    expect(filterCatalog(items, 'all', '')).toHaveLength(48);
  });
  it('places a wall appliance at its default elevation with its back near an inner wall', () => {
    const s = clone(fixture) as unknown as Scene,
      ac = items.find((i) => i.id === 'wall-ac')!;
    const f = addFurniture(s, ac, s.floors[0].rooms[0].id),
      snapshot = s.layout.catalogSnapshot.find((c) => c.skuId === f.skuId)!;
    expect(f.positionMm[2]).toBe(1950);
    expect(f.positionMm[1]).toBe(4855);
    expect(f.rotationDeg).toBe(0);
    expect(snapshot.modelAssetId).toBe('builtin-wall-ac');
    expect(snapshot.priceMinor).toBeNull();
    expect(f.positionMm[2] + f.sizeMm[2]).toBeLessThan(s.floors[0].rooms[0].heightMm);
  });
  it('sets surface heights while keeping separate immutable size snapshots', () => {
    const s = clone(fixture) as unknown as Scene,
      item = items.find((i) => i.id === 'microwave')!;
    const first = addFurniture(s, item, s.floors[0].rooms[0].id),
      second = addFurniture(s, item, s.floors[0].rooms[0].id);
    expect(first.positionMm[2]).toBe(850);
    expect(first.skuId).not.toBe(second.skuId);
    first.sizeMm[0] = 700;
    expect(item.sizeMm[0]).toBe(520);
    expect(second.sizeMm[0]).toBe(520);
  });
  it('measures a procedural model independently of rotated and scaled parents', () => {
    const parent = new Group(),
      model = new Group(),
      geo = new BoxGeometry(2, 3, 1),
      mat = new MeshBasicMaterial();
    const mesh = new Mesh(geo, mat);
    mesh.position.set(4, 1.5, 0);
    model.add(mesh);
    parent.add(model);
    parent.position.set(8, 3, -12);
    parent.rotation.set(0.2, 0.7, 0.1);
    parent.scale.set(3, 2, 0.5);
    const box = localModelBounds(model);
    expect(box.min.x).toBeCloseTo(3);
    expect(box.max.x).toBeCloseTo(5);
    expect(box.min.y).toBeCloseTo(0);
    expect(box.max.y).toBeCloseTo(3);
    expect(box.max.z).toBeCloseTo(0.5);
    geo.dispose();
    mat.dispose();
  });
});
