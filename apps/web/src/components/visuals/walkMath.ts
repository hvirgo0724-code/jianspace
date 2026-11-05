import type { Scene, Room, Vec2 } from '../../types';
import { bounds } from '../../scene';
import { inside, roomCamera, doorPose } from './sceneMath';
import { wallHeightRanges } from './buildingEnvelope';

export const WALK_RADIUS = 0.18;
export const WALK_HEIGHT = 1.72;
export const WALK_SPEED = 1.25;
type Barrier = {
  polygon: Vec2[];
  kind: 'wall' | 'door' | 'furniture' | 'obstacle';
  bottom?: number;
  top?: number;
};
export type WalkWorld = {
  rooms: { id: string; name: string; polygon: Vec2[]; height: number }[];
  passages: Vec2[][];
  barriers: Barrier[];
};

export function rectangle(center: Vec2, width: number, depth: number, angle = 0): Vec2[] {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  return (
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as Vec2[]
  ).map(([x, y]) => [
    center[0] + (c * x * width) / 2 - (s * y * depth) / 2,
    center[1] + (s * x * width) / 2 + (c * y * depth) / 2,
  ]);
}
function distanceToSegment(p: Vec2, a: Vec2, b: Vec2) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
  );
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
export function touchesPolygon(p: Vec2, polygon: Vec2[], radius: number) {
  return (
    inside(p, polygon) ||
    polygon.some(
      (a, i) => distanceToSegment(p, a, polygon[(i + 1) % polygon.length]) < radius - 1e-6,
    )
  );
}

/** Compile the measured scene once. Navigation uses scene X/Y metres, not Three.js X/Z. */
export function buildWalkWorld(
  scene: Scene,
  doorStates: Record<string, boolean> = {},
  fullScene: Scene = scene,
): WalkWorld {
  const floor = scene.floors[0];
  const world: WalkWorld = {
    rooms: floor.rooms
      .filter((r) => r.type !== 'stairwell')
      .map((r) => ({
        id: r.id,
        name: r.name,
        polygon: r.boundaryMm.map(([x, y]) => [x / 1000, y / 1000]),
        height: r.heightMm / 1000,
      })),
    passages: [],
    barriers: [],
  };
  for (const wall of floor.walls) {
    const start: Vec2 = [wall.startMm[0] / 1000, wall.startMm[1] / 1000];
    const dx = (wall.endMm[0] - wall.startMm[0]) / 1000,
      dy = (wall.endMm[1] - wall.startMm[1]) / 1000;
    const length = Math.hypot(dx, dy),
      angle = Math.atan2(dy, dx),
      thickness = wall.thicknessMm / 1000;
    if (length < 1e-6) continue;
    // Local x runs along the wall; local z is the Three.js wall depth axis.
    const local = (x: number, z: number): Vec2 => [
      start[0] + (dx / length) * x + (dy / length) * z,
      start[1] + (dy / length) * x - (dx / length) * z,
    ];
    const doors = floor.openings.filter(
      (o) =>
        o.wallId === wall.id &&
        o.kind === 'door' &&
        o.bottomMm <= 25 &&
        (o.heightMm + o.bottomMm - Math.min(45, o.widthMm * 0.09, o.heightMm * 0.08)) / 1000 >=
          WALK_HEIGHT,
    );
    const cuts = doors
      .map((o) => {
        const trim = Math.min(0.045, (o.widthMm / 1000) * 0.09, (o.heightMm / 1000) * 0.08);
        const a = Math.max(0, o.offsetMm / 1000 + trim),
          b = Math.min(length, (o.offsetMm + o.widthMm) / 1000 - trim);
        if (
          new Set(
            o.connects.filter(
              (id) =>
                id && floor.rooms.some((r) => r.id === id && r.heightMm / 1000 >= WALK_HEIGHT),
            ),
          ).size >= 2
        ) {
          world.passages.push(
            rectangle(local((a + b) / 2, 0), Math.max(0, b - a), thickness + 0.08, angle),
          );
        }
        return { a, b };
      })
      .filter((c) => c.b > c.a)
      .sort((a, b) => a.a - b.a);
    let cursor = 0;
    const addWall = (a: number, b: number) => {
      for (const range of wallHeightRanges(fullScene, floor, wall)) {
        const start = Math.max(a, range.a),
          end = Math.min(b, range.b);
        if (end - start <= 1e-6 || range.height <= 0.1) continue;
        world.barriers.push({
          kind: 'wall',
          bottom: 0,
          top: range.height,
          polygon: rectangle(local((start + end) / 2, 0), end - start, thickness, angle),
        });
      }
    };
    for (const cut of cuts) {
      addWall(cursor, cut.a);
      cursor = Math.max(cursor, cut.b);
    }
    addWall(cursor, length);
    for (const door of floor.openings.filter(
      (o) => o.wallId === wall.id && o.kind === 'door' && o.model !== 'archway',
    )) {
      const pose = doorPose(door, wall, floor.rooms, true, doorStates[door.id]);
      const c = Math.cos(pose.angle),
        s = Math.sin(pose.angle);
      const polygon = rectangle([pose.centerX, 0], pose.width, 0.035).map(([x, z]) =>
        local(pose.hingeX + c * x + s * z, pose.hingeZ - s * x + c * z),
      );
      world.barriers.push({
        kind: 'door',
        polygon,
        bottom: door.bottomMm / 1000,
        top: (door.bottomMm + door.heightMm) / 1000,
      });
    }
  }
  for (const f of scene.layout.furniture.filter(
    (f) =>
      f.floorId === floor.id &&
      f.positionMm[2] < WALK_HEIGHT * 1000 &&
      f.positionMm[2] + f.sizeMm[2] > 100,
  )) {
    world.barriers.push({
      kind: 'furniture',
      bottom: f.positionMm[2] / 1000,
      top: (f.positionMm[2] + f.sizeMm[2]) / 1000,
      polygon: rectangle(
        [f.positionMm[0] / 1000, f.positionMm[1] / 1000],
        f.sizeMm[0] / 1000,
        f.sizeMm[1] / 1000,
        (f.rotationDeg * Math.PI) / 180,
      ),
    });
  }
  for (const o of floor.obstacles.filter(
    (o) => o.baseZMm < WALK_HEIGHT * 1000 && o.baseZMm + o.heightMm > 100,
  )) {
    world.barriers.push({
      kind: 'obstacle',
      bottom: o.baseZMm / 1000,
      top: (o.baseZMm + o.heightMm) / 1000,
      polygon: o.polygonMm.map(([x, y]) => [x / 1000, y / 1000]),
    });
  }
  for (const stair of floor.stairs || []) {
    const dx = stair.endMm[0] - stair.startMm[0],
      dy = stair.endMm[1] - stair.startMm[1];
    world.barriers.push({
      kind: 'obstacle',
      polygon: rectangle(
        [(stair.startMm[0] + stair.endMm[0]) / 2000, (stair.startMm[1] + stair.endMm[1]) / 2000],
        Math.hypot(dx, dy) / 1000,
        stair.widthMm / 1000,
        Math.atan2(dy, dx),
      ),
    });
  }
  return world;
}

export function roomAt(world: WalkWorld, point: Vec2) {
  return world.rooms.find((r) => inside(point, r.polygon));
}
export function canStand(world: WalkWorld, point: Vec2, radius = WALK_RADIUS) {
  const supported = (p: Vec2) =>
    world.rooms.some((r) => r.height >= WALK_HEIGHT && inside(p, r.polygon)) ||
    world.passages.some((poly) => inside(p, poly));
  if (!supported(point)) return false;
  // Support the whole body footprint at exterior / concave floor edges, even without walls.
  for (let i = 0; i < 16; i++) {
    const angle = (i * Math.PI) / 8;
    if (!supported([point[0] + Math.cos(angle) * radius, point[1] + Math.sin(angle) * radius]))
      return false;
  }
  return !world.barriers.some((b) => touchesPolygon(point, b.polygon, radius));
}

export function moveBody(
  world: WalkWorld,
  start: Vec2,
  delta: Vec2,
): { position: Vec2; blocked: boolean } {
  let position: Vec2 = [...start];
  // Small swept substeps prevent tunnelling across thin walls on slow frames.
  const count = Math.max(1, Math.ceil(Math.hypot(...delta) / 0.045));
  const dx = delta[0] / count,
    dy = delta[1] / count;
  let blocked = false;
  for (let i = 0; i < count; i++) {
    const next: Vec2 = [position[0] + dx, position[1] + dy];
    if (canStand(world, next)) {
      position = next;
      continue;
    }
    blocked = true;
    // Slide along the available axis instead of sticking to a wall.
    if (canStand(world, [position[0] + dx, position[1]]))
      position = [position[0] + dx, position[1]];
    if (canStand(world, [position[0], position[1] + dy]))
      position = [position[0], position[1] + dy];
  }
  return { position, blocked };
}

export function findWalkSpawn(scene: Scene, world: WalkWorld, room: Room): Vec2 | null {
  const camera = roomCamera(scene, room),
    preferred: Vec2 = [camera.position[0], -camera.position[2]];
  const within = (p: Vec2) =>
    inside([p[0] * 1000, p[1] * 1000], room.boundaryMm) && canStand(world, p, WALK_RADIUS + 0.025);
  if (within(preferred)) return preferred;
  const b = bounds(room.boundaryMm),
    nx = Math.min(40, Math.max(2, Math.ceil((b.maxX - b.minX) / 220))),
    ny = Math.min(40, Math.max(2, Math.ceil((b.maxY - b.minY) / 220)));
  let best: Vec2 | null = null,
    distance = Infinity;
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++) {
      const p: Vec2 = [
        (b.minX + ((x + 0.5) / nx) * (b.maxX - b.minX)) / 1000,
        (b.minY + ((y + 0.5) / ny) * (b.maxY - b.minY)) / 1000,
      ];
      const d = Math.hypot(p[0] - preferred[0], p[1] - preferred[1]);
      if (d < distance && within(p)) {
        best = p;
        distance = d;
      }
    }
  return best;
}

/** A normalised camera-relative walk direction; diagonals do not increase speed. */
export function walkDelta(yaw: number, forward: number, strafe: number, distance: number): Vec2 {
  const magnitude = Math.max(1, Math.hypot(forward, strafe));
  return [
    ((Math.cos(yaw) * strafe - Math.sin(yaw) * forward) / magnitude) * distance,
    ((Math.sin(yaw) * strafe + Math.cos(yaw) * forward) / magnitude) * distance,
  ];
}
