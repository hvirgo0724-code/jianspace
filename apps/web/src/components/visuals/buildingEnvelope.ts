import clipping from 'polygon-clipping';
import type { Floor, Opening, Scene, Vec2, Wall } from '../../types';
import { isOutdoor } from '../../surfaces';
import { wallSolids } from './sceneMath';

export const SLAB_DEPTH = 0.2;
const polygon = (points: Vec2[]): clipping.Polygon => [[...points, points[0]]];
export function wallFootprint(w: Wall, padding = 0): Vec2[] {
  const [x, y] = w.startMm.map((v) => v / 1000),
    dx = (w.endMm[0] - w.startMm[0]) / 1000,
    dy = (w.endMm[1] - w.startMm[1]) / 1000,
    length = Math.hypot(dx, dy),
    half = w.thicknessMm / 2000 + padding;
  if (length < 0.001) return [];
  const ux = dx / length,
    uy = dy / length;
  return [
    [-half, -half],
    [length + half, -half],
    [length + half, half],
    [-half, half],
  ].map(([a, b]) => [x + a * ux - b * uy, y + a * uy + b * ux] as Vec2);
}
export function buildingFootprint(floor: Floor, padding = 0): clipping.MultiPolygon {
  const rooms = floor.rooms.filter((r) => !isOutdoor(r.type));
  const walls = floor.walls.filter((w) =>
    rooms.some((r) => r.wallRefs.some((ref) => ref.wallId === w.id)),
  );
  const parts = [
    ...rooms.map((r) => polygon(r.boundaryMm.map(([x, y]) => [x / 1000, y / 1000]))),
    ...walls
      .map((w) => wallFootprint(w, padding))
      .filter((p) => p.length)
      .map(polygon),
  ];
  return parts.length ? clipping.union(parts[0], ...parts.slice(1)) : [];
}
export function stairCut(start: Vec2, end: Vec2, width: number): Vec2[] {
  const run = Math.hypot(end[0] - start[0], end[1] - start[1]);
  if (run < 0.001) return [];
  const ux = (end[0] - start[0]) / run,
    uy = (end[1] - start[1]) / run,
    half = width / 2;
  return [
    [0, -half],
    [run, -half],
    [run, half],
    [0, half],
  ].map(([a, b]) => [start[0] + ux * a - uy * b, start[1] + uy * a + ux * b] as Vec2);
}
export function structuralSlab(scene: Scene, floor: Floor): clipping.MultiPolygon {
  const body = buildingFootprint(floor);
  if (!body.length) return [];
  const cuts = floor.rooms
    .filter((r) => r.type === 'stairwell')
    .map((r) => polygon(r.boundaryMm.map(([x, y]) => [x / 1000, y / 1000])));
  for (const source of scene.floors)
    for (const stair of source.stairs || []) {
      if (stair.targetFloorId !== floor.id) continue;
      const p = stairCut(
        stair.startMm.map((v) => v / 1000) as Vec2,
        stair.endMm.map((v) => v / 1000) as Vec2,
        stair.widthMm / 1000 + 0.12,
      );
      if (p.length) cuts.push(polygon(p));
    }
  return cuts.length ? clipping.difference(body, ...cuts) : body;
}

/** Collinear upper walls replace the overlapping part of a double-height wall.
 * Split along the wall so the remaining double-height part is retained. */
export function wallHeightRanges(scene: Scene, floor: Floor, wall: Wall) {
  const dx = wall.endMm[0] - wall.startMm[0],
    dy = wall.endMm[1] - wall.startMm[1],
    length = Math.hypot(dx, dy),
    ux = dx / length,
    uy = dy / length;
  if (length < 1) return [];
  const limits: { a: number; b: number; height: number }[] = [];
  for (const upper of scene.floors) {
    const height = (upper.elevationMm - floor.elevationMm) / 1000 - SLAB_DEPTH;
    if (height <= 0 || height >= wall.heightMm / 1000) continue;
    for (const w of upper.walls) {
      if (
        !upper.rooms.some(
          (r) => !isOutdoor(r.type) && r.wallRefs.some((ref) => ref.wallId === w.id),
        )
      )
        continue;
      const projection = (p: Vec2) =>
        ((p[0] - wall.startMm[0]) * ux + (p[1] - wall.startMm[1]) * uy) / 1000;
      const cross = (p: Vec2) =>
        Math.abs(-(p[0] - wall.startMm[0]) * uy + (p[1] - wall.startMm[1]) * ux);
      if (cross(w.startMm) > 1 || cross(w.endMm) > 1) continue;
      const a = Math.max(0, Math.min(projection(w.startMm), projection(w.endMm))),
        b = Math.min(length / 1000, Math.max(projection(w.startMm), projection(w.endMm)));
      if (b > a + 0.001) limits.push({ a, b, height });
    }
  }
  const xs = [...new Set([0, length / 1000, ...limits.flatMap((v) => [v.a, v.b])])].sort(
    (a, b) => a - b,
  );
  return xs.slice(0, -1).map((a, i) => ({
    a,
    b: xs[i + 1],
    height: Math.min(
      wall.heightMm / 1000,
      ...limits.filter((v) => v.a <= a + 0.0001 && v.b >= xs[i + 1] - 0.0001).map((v) => v.height),
    ),
  }));
}
export function connectedWallSolids(
  scene: Scene,
  floor: Floor,
  wall: Wall,
  openings: Opening[],
  height = wall.heightMm / 1000,
) {
  return wallHeightRanges(scene, floor, wall).flatMap((range) =>
    wallSolids(wall, openings, Math.min(height, range.height)).flatMap((s) => {
      const a = Math.max(range.a, s.x - s.width / 2),
        b = Math.min(range.b, s.x + s.width / 2);
      return b > a + 0.0001 ? [{ ...s, x: (a + b) / 2, width: b - a }] : [];
    }),
  );
}
export function interstoreyInfill(scene: Scene, floor: Floor) {
  const upper = [...scene.floors]
    .filter((f) => f.elevationMm > floor.elevationMm)
    .sort((a, b) => a.elevationMm - b.elevationMm)[0];
  if (!upper) return [];
  const top = (upper.elevationMm - floor.elevationMm) / 1000 - SLAB_DEPTH,
    coverage = buildingFootprint(upper),
    groups = new Map<number, clipping.Polygon[]>();
  for (const w of floor.walls) {
    const bottom = w.heightMm / 1000;
    if (
      top <= bottom + 0.001 ||
      !floor.rooms.some((r) => !isOutdoor(r.type) && r.wallRefs.some((ref) => ref.wallId === w.id))
    )
      continue;
    const parts = groups.get(bottom) || [],
      footprint = wallFootprint(w);
    if (footprint.length) parts.push(polygon(footprint));
    groups.set(bottom, parts);
  }
  return [...groups]
    .filter(([, parts]) => parts.length)
    .map(([bottom, parts]) => ({
      bottom,
      top,
      polygons: clipping.intersection(clipping.union(parts[0], ...parts.slice(1)), coverage),
    }));
}
export function exteriorWalls(floor: Floor) {
  return floor.walls.flatMap((wall) => {
    const refs = floor.rooms
      .filter((r) => !isOutdoor(r.type))
      .flatMap((r) => r.wallRefs.filter((ref) => ref.wallId === wall.id));
    const sides = new Set(refs.map((r) => r.side));
    return sides.size === 1 ? [{ wall, outward: refs[0].side === 'left' ? 1 : -1 }] : [];
  });
}
