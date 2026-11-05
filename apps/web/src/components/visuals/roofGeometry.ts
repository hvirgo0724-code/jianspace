import clipping from 'polygon-clipping';
import { ShapeUtils, Vector2 } from 'three';
import type { Scene, Vec2 } from '../../types';
import type { ExteriorStyle } from '../../exteriorStyles';
import { buildingFootprint, SLAB_DEPTH } from './buildingEnvelope';
import { isOutdoor } from '../../surfaces';

/** Roof faces are clipped to the actual building silhouette, including recesses. */
export function buildRoof(scene: Scene, preset: ExteriorStyle) {
  const floors = scene.floors.filter((f) => f.rooms.some((r) => !isOutdoor(r.type)));
  if (!floors.length) return null;
  const levels = floors.map((floor) => {
    const indoor = floor.rooms.filter((r) => !isOutdoor(r.type));
    const refs = new Set(indoor.flatMap((r) => r.wallRefs.map((ref) => ref.wallId)));
    return {
      floor,
      top:
        floor.elevationMm / 1000 +
        Math.max(
          ...indoor.map((r) => r.heightMm / 1000),
          ...floor.walls.filter((w) => refs.has(w.id)).map((w) => w.heightMm / 1000),
        ),
    };
  });
  const base = Math.max(...levels.map((level) => level.top));
  // A double-height ground-floor room can meet the main roof even though the
  // upper floor does not cover it. Include every floor that reaches this level.
  const contributors = levels.filter((level) => Math.abs(level.top - base) < 0.001);
  const union = (polys: clipping.MultiPolygon[]): clipping.MultiPolygon =>
    polys.length ? clipping.union(polys[0], ...polys.slice(1)) : [];
  const footprint = (padding = 0) =>
    union(contributors.map(({ floor }) => buildingFootprint(floor, padding)));
  const body = footprint(),
    outline = footprint(preset.overhang);
  // Setbacks leave parts of the lower storey exposed. Cap those areas at the
  // wall head, without covering the courtyard or filling upper stair openings.
  const lowerCaps = levels
    .filter((level) => level.top < base - 0.001)
    .map(({ floor, top }) => {
      const above = union(
        floors.filter((f) => f.elevationMm > floor.elevationMm).map((f) => buildingFootprint(f)),
      );
      const polygons = above.length
        ? clipping.difference(buildingFootprint(floor), above)
        : buildingFootprint(floor);
      return { floorId: floor.id, bottom: top, top: top + SLAB_DEPTH, polygons };
    })
    .filter((cap) => cap.polygons.length);
  const points = outline.flatMap((poly) => poly[0]);
  if (!points.length) return null;
  const x0 = Math.min(...points.map((p) => p[0])),
    x1 = Math.max(...points.map((p) => p[0])),
    y0 = Math.min(...points.map((p) => p[1])),
    y1 = Math.max(...points.map((p) => p[1])),
    cx = (x0 + x1) / 2,
    cy = (y0 + y1) / 2,
    run = Math.min(x1 - x0, y1 - y0) / 2;
  const eave = base + 0.16;
  const heightAt = ([x, y]: Vec2) =>
    eave +
    (preset.roof === 'flat'
      ? 0
      : preset.rise *
        (preset.roof === 'gable'
          ? Math.max(0, 1 - Math.abs(x - cx) / ((x1 - x0) / 2))
          : Math.max(0, Math.min(x - x0, x1 - x, y - y0, y1 - y) / run)));
  const rect = (a: number, b: number, c: number, d: number): Vec2[] => [
    [a, b],
    [c, b],
    [c, d],
    [a, d],
  ];
  let partitions: Vec2[][];
  if (preset.roof === 'flat') partitions = [rect(x0, y0, x1, y1)];
  else if (preset.roof === 'gable') partitions = [rect(x0, y0, cx, y1), rect(cx, y0, x1, y1)];
  else {
    const a: Vec2 = x1 - x0 <= y1 - y0 ? [cx, y0 + run] : [x0 + run, cy],
      b: Vec2 = x1 - x0 <= y1 - y0 ? [cx, y1 - run] : [x1 - run, cy];
    partitions =
      x1 - x0 <= y1 - y0
        ? [
            [[x0, y0], [x1, y0], a],
            [[x1, y0], [x1, y1], b, a],
            [[x1, y1], [x0, y1], b],
            [[x0, y1], [x0, y0], a, b],
          ]
        : [
            [[x0, y0], [x1, y0], b, a],
            [[x1, y0], [x1, y1], b],
            [[x1, y1], [x0, y1], a, b],
            [[x0, y1], [x0, y0], a],
          ];
  }
  const positions: number[] = [],
    uvs: number[] = [],
    attic: number[] = [];
  const add = (p: Vec2) => {
    positions.push(p[0], heightAt(p), -p[1]);
    uvs.push(p[0], p[1]);
  };
  for (const partition of partitions) {
    const face = clipping.intersection(outline, [[...partition, partition[0]]]);
    for (const rings of face) {
      const paths = rings.map((ring) => ring.slice(0, -1).map(([x, y]) => new Vector2(x, y)));
      const points = paths.flat();
      for (const indices of ShapeUtils.triangulateShape(paths[0], paths.slice(1)))
        for (const i of indices) add([points[i].x, points[i].y]);
    }
  }
  // Split attic boundary at every roof-plane intersection. This closes gables
  // without an oversized triangular box covering a recessed facade.
  const planes = (p: Vec2) =>
    preset.roof === 'gable' ? [p[0] - x0, x1 - p[0]] : [p[0] - x0, x1 - p[0], p[1] - y0, y1 - p[1]];
  for (const poly of body)
    for (const ring of poly)
      for (let i = 0; i < ring.length - 1; i++) {
        const p = ring[i] as Vec2,
          q = ring[i + 1] as Vec2,
          ps = planes(p),
          qs = planes(q),
          ts = [0, 1];
        for (let a = 0; a < ps.length; a++)
          for (let b = a + 1; b < ps.length; b++) {
            const start = ps[a] - ps[b],
              end = qs[a] - qs[b],
              t = start / (start - end);
            if (t > 0.0001 && t < 0.9999) ts.push(t);
          }
        ts.sort((a, b) => a - b);
        for (let j = 0; j < ts.length - 1; j++) {
          const a: Vec2 = [p[0] + (q[0] - p[0]) * ts[j], p[1] + (q[1] - p[1]) * ts[j]],
            b: Vec2 = [p[0] + (q[0] - p[0]) * ts[j + 1], p[1] + (q[1] - p[1]) * ts[j + 1]];
          const lowA = [a[0], base, -a[1]],
            lowB = [b[0], base, -b[1]],
            highA = [a[0], heightAt(a), -a[1]],
            highB = [b[0], heightAt(b), -b[1]];
          attic.push(...lowA, ...lowB, ...highA, ...highA, ...lowB, ...highB);
        }
      }
  const parapet =
    preset.roof === 'flat'
      ? clipping.difference(outline, footprint(Math.max(0, preset.overhang - 0.18)))
      : [];
  return {
    positions,
    uvs,
    attic,
    outline,
    parapet,
    lowerCaps,
    base,
    eave,
    heightAt,
    bounds: { x0, x1, y0, y1 },
  };
}
