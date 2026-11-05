import { describe, it, expect } from 'vitest';
import fixture from '../../../../../packages/scene/scene.example.json';
import type { Scene } from '../../types';
import {
  buildWalkWorld,
  canStand,
  moveBody,
  findWalkSpawn,
  roomAt,
  walkDelta,
  rectangle,
  type WalkWorld,
} from './walkMath';
import { doorPose } from './sceneMath';
const scene = () => structuredClone(fixture) as unknown as Scene;

describe('measured first-person navigation', () => {
  it('walks through the internal doorway and the 200 mm wall gap into the next room', () => {
    const world = buildWalkWorld(scene());
    expect(canStand(world, [4.1, 1.45])).toBe(true);
    const moved = moveBody(world, [3.65, 1.45], [1, 0]);
    expect(moved.blocked).toBe(false);
    expect(roomAt(world, moved.position)?.id).toBe('room-bedroom');
  });
  it('stops at a partition even for a large movement that would jump over it', () => {
    const world = buildWalkWorld(scene());
    const moved = moveBody(world, [3.65, 2.8], [2, 0]);
    expect(moved.blocked).toBe(true);
    expect(moved.position[0]).toBeLessThan(3.83);
  });
  it('slides along a wall and keeps the body inside exterior boundaries', () => {
    const world = buildWalkWorld(scene());
    const moved = moveBody(world, [0.25, 1.8], [-0.7, 0.7]);
    expect(moved.blocked).toBe(true);
    expect(moved.position[0]).toBeGreaterThanOrEqual(0.18);
    expect(moved.position[1]).toBeCloseTo(2.5);
  });
  it('does not allow walking out of the house through an entry door or a window', () => {
    const world = buildWalkWorld(scene());
    expect(moveBody(world, [1.4, 0.5], [0, -2]).position[1]).toBeGreaterThanOrEqual(0.18);
    expect(moveBody(world, [2, 4.5], [0, 2]).position[1]).toBeLessThanOrEqual(4.82);
  });
  it('requires a door tall and wide enough for the body', () => {
    for (const tweak of ['height', 'width'] as const) {
      const s = scene(),
        door = s.floors[0].openings.find((o) => o.id === 'door-bedroom')!;
      if (tweak === 'height') door.heightMm = 1500;
      else door.widthMm = 300;
      const world = buildWalkWorld(s);
      const moved = moveBody(world, [3.6, (door.offsetMm + door.widthMm / 2 - 100) / 1000], [1, 0]);
      expect(moved.blocked).toBe(true);
      expect(moved.position[0]).toBeLessThan(4);
    }
  });
  it('blocks the actual rotated furniture footprint without using its larger axis-aligned box', () => {
    const s = scene();
    s.layout.furniture = [
      {
        ...s.layout.furniture[0],
        positionMm: [2000, 2500, 0],
        sizeMm: [2000, 400, 900],
        rotationDeg: 45,
      },
    ];
    const world = buildWalkWorld(s);
    expect(canStand(world, [2, 2.5])).toBe(false);
    expect(canStand(world, [1.35, 3.15])).toBe(true);
  });
  it('blocks columns but permits walking below a high overhead beam', () => {
    const s = scene();
    s.layout.furniture = [];
    s.floors[0].obstacles = [
      {
        id: 'column',
        kind: 'column',
        polygonMm: [
          [1800, 1800],
          [2200, 1800],
          [2200, 2200],
          [1800, 2200],
        ],
        baseZMm: 0,
        heightMm: 2800,
        locked: true,
      },
    ];
    expect(canStand(buildWalkWorld(s), [2, 2])).toBe(false);
    s.floors[0].obstacles[0].baseZMm = 2300;
    expect(canStand(buildWalkWorld(s), [2, 2])).toBe(true);
  });
  it('selects a free indoor spawn and reports no spawn for a completely occupied room', () => {
    const s = scene(),
      room = s.floors[0].rooms[0];
    const world = buildWalkWorld(s),
      spawn = findWalkSpawn(s, world, room);
    expect(spawn).not.toBeNull();
    expect(canStand(world, spawn!)).toBe(true);
    s.layout.furniture = [
      { ...s.layout.furniture[0], positionMm: [2000, 2500, 0], sizeMm: [4000, 5000, 2500] },
    ];
    expect(findWalkSpawn(s, buildWalkWorld(s), room)).toBeNull();
  });
  it('keeps concave floor boundaries walkable only where there is supporting floor', () => {
    const world: WalkWorld = {
      rooms: [
        {
          id: 'L',
          name: 'L',
          height: 2.8,
          polygon: [
            [0, 0],
            [5, 0],
            [5, 1.5],
            [1.5, 1.5],
            [1.5, 5],
            [0, 5],
          ],
        },
      ],
      passages: [],
      barriers: [],
    };
    expect(canStand(world, [1, 4])).toBe(true);
    expect(canStand(world, [3, 3])).toBe(false);
    const moved = moveBody(world, [1, 3], [2, 0]);
    expect(moved.position[0]).toBeLessThanOrEqual(1.32);
  });
  it('normalises diagonal movement and maps camera yaw to scene directions', () => {
    expect(Math.hypot(...walkDelta(0, 1, 1, 1))).toBeCloseTo(1);
    expect(walkDelta(0, 1, 0, 1)).toEqual([0, 1]);
    const left = walkDelta(Math.PI / 2, 1, 0, 1);
    expect(left[0]).toBeCloseTo(-1);
    expect(left[1]).toBeCloseTo(0);
  });
  it('uses the same open door transform for collisions and rendering, including the leaf', () => {
    const s = scene(),
      floor = s.floors[0],
      door = floor.openings.find((o) => o.id === 'door-bedroom')!,
      wall = floor.walls.find((w) => w.id === door.wallId)!;
    const pose = doorPose(door, wall, floor.rooms, true);
    expect(pose.angle).toBeCloseTo(Math.PI / 2);
    expect(pose.width).toBeCloseTo(0.81);
    const world = buildWalkWorld(s);
    expect(canStand(world, [3.65, 1.045])).toBe(false);
    expect(canStand(world, [3.65, 1.45])).toBe(true);
  });
  it('keeps body clearance from furniture corners', () => {
    const world: WalkWorld = {
      rooms: [{ id: 'room', name: '房间', height: 2.8, polygon: rectangle([0, 0], 10, 10) }],
      passages: [],
      barriers: [{ kind: 'furniture', polygon: rectangle([0, 0], 1, 1) }],
    };
    expect(canStand(world, [0.6, 0.6])).toBe(false);
    expect(canStand(world, [0.7, 0.7])).toBe(true);
  });
});
