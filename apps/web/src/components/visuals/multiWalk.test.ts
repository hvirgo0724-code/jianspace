import { describe, it, expect } from 'vitest';
import fixture from '../../../../../packages/scene/scene.example.json';
import homes from '../../../../../packages/scene/navigation.examples.json';
import type { Scene } from '../../types';
import { buildMultiWorld, moveWalker, canStandMulti, type Walker } from './multiWalk';
import { subtractSlab, slabShapes } from './slabs';
function stairsScene() {
  const s = structuredClone(fixture) as unknown as Scene;
  s.layout.furniture = [];
  s.layout.catalogSnapshot = [];
  const room = {
    id: 'room-a',
    name: '测试楼梯厅',
    type: 'hall',
    boundaryMm: [
      [0, 0],
      [6000, 0],
      [6000, 8000],
      [0, 8000],
    ] as [number, number][],
    heightMm: 2800,
    computedAreaMm2: 48000000,
    wallRefs: [],
  };
  s.floors = [
    {
      id: 'low',
      name: '一层',
      elevationMm: 0,
      rooms: [room],
      walls: [],
      openings: [],
      obstacles: [],
      stairs: [
        {
          id: 'stair',
          startMm: [3000, 2000],
          endMm: [3000, 6000],
          widthMm: 1200,
          targetFloorId: 'high',
          stepCount: 18,
        },
      ],
    },
    {
      id: 'high',
      name: '二层',
      elevationMm: 3000,
      rooms: [{ ...room, id: 'room-b' }],
      walls: [],
      openings: [],
      obstacles: [],
    },
  ];
  return s;
}
describe('continuous stair and door navigation', () => {
  it('keeps an invalid stair target blocked until the geometry is corrected', () => {
    const scene = stairsScene();
    scene.floors[0].stairs![0].targetFloorId = 'missing';
    const world = buildMultiWorld(scene);
    const move = moveWalker(world, { point: [3, 1.5], floorId: 'low', elevation: 0 }, [0, 2]);
    expect(world.flights).toHaveLength(0);
    expect(move.blocked).toBe(true);
    expect(move.body.point[1]).toBeLessThan(2);
  });
  it.each(['loft', 'duplex', 'villa'] as const)(
    'walks up and back down the actual %s template',
    (key) => {
      const scene = structuredClone(homes[key]) as unknown as Scene;
      const floor = scene.floors[0],
        stair = floor.stairs![0],
        world = buildMultiWorld(scene);
      const run =
        Math.hypot(stair.endMm[0] - stair.startMm[0], stair.endMm[1] - stair.startMm[1]) / 1000;
      const ux = (stair.endMm[0] - stair.startMm[0]) / 1000 / run,
        uy = (stair.endMm[1] - stair.startMm[1]) / 1000 / run;
      const start: Walker = {
        point: [stair.startMm[0] / 1000 - ux * 0.23, stair.startMm[1] / 1000 - uy * 0.23],
        floorId: floor.id,
        elevation: floor.elevationMm / 1000,
      };
      expect(canStandMulti(world, start)).toBe(true);
      const top = moveWalker(world, start, [ux * (run + 0.65), uy * (run + 0.65)]);
      expect(top.blocked).toBe(false);
      expect(top.body.floorId).toBe(stair.targetFloorId);
      expect(top.body.elevation).toBeCloseTo(scene.floors[1].elevationMm / 1000);
      const down = moveWalker(world, top.body, [-ux * (run + 0.65), -uy * (run + 0.65)]);
      expect(down.blocked).toBe(false);
      expect(down.body.floorId).toBe(floor.id);
      expect(down.body.elevation).toBeCloseTo(0);
    },
  );
  it('ascends and descends a measured flight without changing the source scene', () => {
    const scene = stairsScene(),
      snapshot = JSON.stringify(scene),
      world = buildMultiWorld(scene);
    const start: Walker = { point: [3, 1.7], floorId: 'low', elevation: 0 };
    const top = moveWalker(world, start, [0, 4.9]);
    expect(top.blocked).toBe(false);
    expect(top.body.floorId).toBe('high');
    expect(top.body.elevation).toBeCloseTo(3);
    expect(top.body.stairId).toBeUndefined();
    const down = moveWalker(world, top.body, [0, -4.9]);
    expect(down.blocked).toBe(false);
    expect(down.body.floorId).toBe('low');
    expect(down.body.elevation).toBeCloseTo(0);
    expect(JSON.stringify(scene)).toBe(snapshot);
  });
  it('cannot walk off a staircase at mid-height or step onto its upper void', () => {
    const world = buildMultiWorld(stairsScene());
    const mid = moveWalker(world, { point: [3, 1.7], floorId: 'low', elevation: 0 }, [0, 2.3]).body;
    expect(mid.elevation).toBeCloseTo(1.5);
    const side = moveWalker(world, mid, [1.3, 0]);
    expect(side.blocked).toBe(true);
    expect(side.body.elevation).toBeGreaterThan(1.4);
    expect(side.body.point[0]).toBeLessThan(3.5);
    expect(canStandMulti(world, { point: [3, 4], floorId: 'high', elevation: 3 })).toBe(false);
  });
  it('keeps furniture collision on its own vertical level', () => {
    const s = stairsScene();
    s.layout.furniture = [
      {
        id: 'box',
        skuId: 'x',
        floorId: 'high',
        roomId: 'room-b',
        positionMm: [1500, 1500, 0],
        sizeMm: [800, 800, 900],
        rotationDeg: 0,
        locked: false,
      },
    ];
    const w = buildMultiWorld(s);
    expect(canStandMulti(w, { point: [1.5, 1.5], floorId: 'low', elevation: 0 })).toBe(true);
    expect(canStandMulti(w, { point: [1.5, 1.5], floorId: 'high', elevation: 3 })).toBe(false);
  });
  it('closed doors block the same doorway and reopen without resetting the visitor', () => {
    const s = structuredClone(fixture) as unknown as Scene;
    const start: Walker = { point: [3.65, 1.45], floorId: s.floors[0].id, elevation: 0 };
    expect(moveWalker(buildMultiWorld(s), start, [1, 0]).blocked).toBe(false);
    const closed = moveWalker(buildMultiWorld(s, { 'door-bedroom': false }), start, [1, 0]);
    expect(closed.blocked).toBe(true);
    expect(closed.body.point[0]).toBeLessThan(4.1);
    expect(moveWalker(buildMultiWorld(s), closed.body, [1, 0]).blocked).toBe(false);
  });
  it('an open arch has no invisible leaf barrier', () => {
    const s = structuredClone(fixture) as unknown as Scene;
    s.floors[0].openings.find((o) => o.id === 'door-bedroom')!.model = 'archway';
    expect(
      moveWalker(
        buildMultiWorld(s, { 'door-bedroom': false }),
        { point: [3.65, 1.45], floorId: s.floors[0].id, elevation: 0 },
        [1, 0],
      ).blocked,
    ).toBe(false);
  });
});
describe('stairwell slab boolean geometry', () => {
  const boundary: [number, number][] = [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ];
  const area = (polygons: ReturnType<typeof subtractSlab>) =>
    polygons.reduce(
      (sum, rings) =>
        sum +
        rings.reduce(
          (a, ring, i) =>
            a +
            (i === 0 ? 1 : -1) *
              Math.abs(
                ring.reduce(
                  (s, p, j) =>
                    s +
                    p[0] * ring[(j + 1) % ring.length][1] -
                    ring[(j + 1) % ring.length][0] * p[1],
                  0,
                ) / 2,
              ),
          0,
        ),
      0,
    );
  it('clips edge-crossing stair wells as notches', () => {
    const cut: [number, number][] = [
      [3, 1],
      [5, 1],
      [5, 3],
      [3, 3],
    ];
    expect(area(subtractSlab(boundary, [cut]))).toBeCloseTo(14);
    expect(slabShapes(boundary, [cut])[0].holes).toHaveLength(0);
  });
  it('ignores a hole outside the room and preserves a real interior hole', () => {
    expect(
      area(
        subtractSlab(boundary, [
          [
            [5, 5],
            [6, 5],
            [6, 6],
            [5, 6],
          ],
        ]),
      ),
    ).toBeCloseTo(16);
    expect(
      slabShapes(boundary, [
        [
          [1, 1],
          [2, 1],
          [2, 2],
          [1, 2],
        ],
      ])[0].holes,
    ).toHaveLength(1);
  });
});
