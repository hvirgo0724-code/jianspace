import { describe, it, expect } from 'vitest';
import type clipping from 'polygon-clipping';
import homes from '../../../../../packages/scene/navigation.examples.json';
import type { Scene, Vec2 } from '../../types';
import { EXTERIOR_STYLES, exteriorStyle } from '../../exteriorStyles';
import { inside } from './sceneMath';
import {
  structuralSlab,
  wallHeightRanges,
  connectedWallSolids,
  interstoreyInfill,
  SLAB_DEPTH,
} from './buildingEnvelope';
import { buildRoof } from './roofGeometry';
import { buildMultiWorld, canStandMulti } from './multiWalk';
const home = (id: keyof typeof homes) => structuredClone(homes[id]) as unknown as Scene;
const covers = (polys: clipping.MultiPolygon, p: Vec2) =>
  polys.some(
    (rings) => inside(p, rings[0] as Vec2[]) && !rings.slice(1).some((r) => inside(p, r as Vec2[])),
  );
function polygonArea(polys: clipping.MultiPolygon) {
  const area = (ring: number[][]) =>
    Math.abs(
      ring.reduce(
        (n, p, i) =>
          n + p[0] * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * p[1],
        0,
      ),
    ) / 2;
  return polys.reduce(
    (n, rings) => n + area(rings[0]) - rings.slice(1).reduce((a, r) => a + area(r), 0),
    0,
  );
}
describe('connected multi-storey building envelope', () => {
  it('includes the wall body and corners in slabs while retaining the actual stair opening', () => {
    const s = home('villa'),
      floor = s.floors[1],
      slab = structuralSlab(s, floor),
      snapshot = JSON.stringify(s);
    for (const p of [
      [0, 2],
      [7.5, 0],
      [14, 6],
      [0, 0],
      [12.6, 12.2],
    ] as Vec2[])
      expect(covers(slab, p), p.join(',')).toBe(true);
    expect(covers(slab, [12.6, 8])).toBe(false);
    expect(covers(slab, [13.6, 8])).toBe(false);
    expect(covers(slab, [1, -2])).toBe(false);
    expect(s.floors[1].elevationMm / 1000 - SLAB_DEPTH).toBeCloseTo(
      s.floors[0].rooms.find((r) => r.type === 'living')!.heightMm / 1000,
    );
    expect(JSON.stringify(s)).toBe(snapshot);
  });
  it('fills genuine vertical gaps below the next slab instead of bridging open courtyard space', () => {
    const s = home('villa'),
      floor = s.floors[0];
    expect(interstoreyInfill(s, floor)).toHaveLength(0);
    const wall = floor.walls.find(
      (w) => w.startMm[0] === 0 && w.endMm[0] === 0 && w.startMm[1] >= 0,
    )!;
    wall.heightMm = 3000;
    const infill = interstoreyInfill(s, floor);
    expect(infill).toHaveLength(1);
    expect(infill[0].bottom).toBe(3);
    expect(infill[0].top).toBeCloseTo(3.2);
    expect(infill[0].polygons.length).toBeGreaterThan(0);
    expect(covers(infill[0].polygons, [1, -2])).toBe(false);
  });
  it('splits an overlapping Loft wall and preserves its uncovered double-height part', () => {
    const s = home('loft'),
      floor = s.floors[0],
      before = JSON.stringify(s);
    const wall = floor.walls.find(
      (w) => w.startMm[0] === 7200 && w.endMm[0] === 7200 && w.startMm[1] === 4200,
    )!;
    const ranges = wallHeightRanges(s, floor, wall);
    expect(ranges.some((r) => r.height === 5.4)).toBe(true);
    expect(ranges.some((r) => Math.abs(r.height - 2.6) < 0.0001)).toBe(true);
    const solids = connectedWallSolids(
      s,
      floor,
      wall,
      floor.openings.filter((o) => o.wallId === wall.id),
    );
    expect(
      solids.filter((v) => v.x + v.width / 2 > 3.8).every((v) => v.bottom + v.height <= 2.60001),
    ).toBe(true);
    expect(JSON.stringify(s)).toBe(before);
  });
  it('does not leave a hidden downstairs wall across an upstairs Loft doorway', () => {
    const s = home('loft'),
      upper = s.floors[1];
    s.layout.furniture = [];
    const door = upper.openings.find((o) => o.kind === 'door' && o.connects.every(Boolean))!;
    expect(door).toBeDefined();
    door.model = 'archway';
    const wall = upper.walls.find((w) => w.id === door.wallId)!,
      length = Math.hypot(wall.endMm[0] - wall.startMm[0], wall.endMm[1] - wall.startMm[1]),
      offset = door.offsetMm + door.widthMm / 2;
    const point: Vec2 = [
      (wall.startMm[0] + ((wall.endMm[0] - wall.startMm[0]) / length) * offset) / 1000,
      (wall.startMm[1] + ((wall.endMm[1] - wall.startMm[1]) / length) * offset) / 1000,
    ];
    expect(
      canStandMulti(buildMultiWorld(s), {
        point,
        floorId: upper.id,
        elevation: upper.elevationMm / 1000,
      }),
    ).toBe(true);
  });
  it.each(EXTERIOR_STYLES)(
    'closes and triangulates the $id roof over the real silhouette',
    (preset) => {
      const s = home('villa'),
        before = JSON.stringify(s),
        roof = buildRoof(s, preset)!;
      expect(roof.positions.length).toBeGreaterThan(0);
      expect(roof.positions.every(Number.isFinite)).toBe(true);
      expect(roof.attic.every(Number.isFinite)).toBe(true);
      let area = 0;
      for (let i = 0; i < roof.positions.length; i += 9) {
        const p = roof.positions;
        area +=
          Math.abs(
            (p[i + 3] - p[i]) * (p[i + 8] - p[i + 2]) - (p[i + 6] - p[i]) * (p[i + 5] - p[i + 2]),
          ) / 2;
      }
      expect(area).toBeCloseTo(polygonArea(roof.outline), 5);
      const heights = roof.positions.filter((_, i) => i % 3 === 1);
      expect(Math.min(...heights)).toBeGreaterThanOrEqual(roof.base);
      expect(Math.max(...heights)).toBeCloseTo(roof.eave + preset.rise);
      expect(roof.attic.length).toBeGreaterThan(0);
      expect(JSON.stringify(s)).toBe(before);
    },
  );
  it('keeps the roof notch and produces different silhouettes rather than recolouring one mesh', () => {
    const s = home('villa'),
      flat = buildRoof(s, exteriorStyle('modern'))!,
      gable = buildRoof(s, exteriorStyle('nordic'))!,
      hip = buildRoof(s, exteriorStyle('mediterranean'))!;
    expect(covers(flat.outline, [4, 12.8])).toBe(false);
    expect(flat.parapet.length).toBeGreaterThan(0);
    expect(gable.parapet).toHaveLength(0);
    expect(gable.positions).not.toEqual(hip.positions);
    expect(gable.attic.some((v, i) => i % 3 === 1 && v > gable.eave + 1)).toBe(true);
  });
  it('covers the Loft double-height living room beyond the upper-floor footprint', () => {
    const roof = buildRoof(home('loft'), exteriorStyle('nordic'))!;
    expect(roof.base).toBeCloseTo(5.4);
    expect(covers(roof.outline, [3, 2])).toBe(true);
    expect(roof.positions.every(Number.isFinite)).toBe(true);
    expect(roof.lowerCaps).toHaveLength(0);
  });
  it('closes the exposed lower-storey setback without roofing the courtyard or upper slab', () => {
    const roof = buildRoof(home('villa'), exteriorStyle('chinese'))!;
    expect(roof.lowerCaps).toHaveLength(1);
    const cap = roof.lowerCaps[0];
    expect(cap.bottom).toBeCloseTo(3.2);
    expect(cap.top).toBeCloseTo(3.4);
    expect(covers(cap.polygons, [9.1, 12.5])).toBe(true);
    expect(covers(cap.polygons, [1, -2])).toBe(false);
    expect(covers(cap.polygons, [3, 3])).toBe(false);
  });
});
