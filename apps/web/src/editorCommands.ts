import type { Scene, Furniture, Vec2, Floor } from './types';
import { clone, id, bounds, area } from './scene';
import { inside } from './components/visuals/sceneMath';

export function corners(f: Furniture): Vec2[] {
  const a = (f.rotationDeg * Math.PI) / 180,
    c = Math.cos(a),
    sn = Math.sin(a);
  return (
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as Vec2[]
  ).map(([x, y]) => [
    f.positionMm[0] + (c * x * f.sizeMm[0]) / 2 - (sn * y * f.sizeMm[1]) / 2,
    f.positionMm[1] + (sn * x * f.sizeMm[0]) / 2 + (c * y * f.sizeMm[1]) / 2,
  ]);
}
function intersects(a: Furniture, b: Furniture) {
  if (
    Math.min(a.positionMm[2] + a.sizeMm[2], b.positionMm[2] + b.sizeMm[2]) <=
    Math.max(a.positionMm[2], b.positionMm[2])
  )
    return false;
  const pa = corners(a),
    pb = corners(b);
  return [...pa, ...pb].every((_, i) => {
    const poly = i < 4 ? pa : pb,
      j = i % 4,
      p = poly[j],
      q = poly[(j + 1) % 4],
      axis = [q[1] - p[1], p[0] - q[0]];
    const aa = pa.map((v) => v[0] * axis[0] + v[1] * axis[1]),
      bb = pb.map((v) => v[0] * axis[0] + v[1] * axis[1]);
    return (
      Math.min(Math.max(...aa), Math.max(...bb)) - Math.max(Math.min(...aa), Math.min(...bb)) > 1
    );
  });
}
function polygonOverlap(p: Vec2[], q: Vec2[]) {
  if (p.some((a) => inside(a, q)) || q.some((a) => inside(a, p))) return true;
  const cross = (a: Vec2, b: Vec2, c: Vec2) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return p.some((a, i) =>
    q.some((c, j) => {
      const b = p[(i + 1) % p.length],
        d = q[(j + 1) % q.length];
      return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
    }),
  );
}
export function moveSelected(s: Scene, ids: string[], dx: number, dy: number) {
  s.layout.furniture
    .filter((f) => ids.includes(f.id) && !f.locked)
    .forEach((f) => {
      f.positionMm[0] += Math.round(dx);
      f.positionMm[1] += Math.round(dy);
    });
}
export function duplicateSelected(s: Scene, ids: string[]) {
  const originals = s.layout.furniture.filter((f) => ids.includes(f.id) && !f.locked);
  if (!originals.length) throw new Error('请先选择未锁定家具。');
  const offsets: Vec2[] = [];
  for (let radius = 500; radius <= 6000; radius += 500)
    for (const [x, y] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ])
      offsets.push([x * radius, y * radius]);
  const offset = offsets.find(([dx, dy]) =>
    originals.every((o) => {
      const n = clone(o);
      n.positionMm = [o.positionMm[0] + dx, o.positionMm[1] + dy, o.positionMm[2]];
      const floor = s.floors.find((f) => f.id === o.floorId)!;
      const room = floor.rooms.find((r) => r.id === o.roomId)!;
      const fixed = floor.obstacles
        .filter(
          (ob) =>
            Math.min(n.positionMm[2] + n.sizeMm[2], ob.baseZMm + ob.heightMm) >
            Math.max(n.positionMm[2], ob.baseZMm),
        )
        .map((ob) => ob.polygonMm);
      for (const stair of floor.stairs || []) {
        const dx = stair.endMm[0] - stair.startMm[0],
          dy = stair.endMm[1] - stair.startMm[1],
          len = Math.hypot(dx, dy);
        if (!len) continue;
        const nx = ((-dy / len) * stair.widthMm) / 2,
          ny = ((dx / len) * stair.widthMm) / 2;
        fixed.push([
          [stair.startMm[0] + nx, stair.startMm[1] + ny],
          [stair.endMm[0] + nx, stair.endMm[1] + ny],
          [stair.endMm[0] - nx, stair.endMm[1] - ny],
          [stair.startMm[0] - nx, stair.startMm[1] - ny],
        ]);
      }
      return (
        corners(n).every((p) => inside(p, room.boundaryMm)) &&
        !fixed.some((polygon) => polygonOverlap(corners(n), polygon)) &&
        !s.layout.furniture.some((f) => f.floorId === n.floorId && intersects(n, f))
      );
    }),
  );
  if (!offset) throw new Error('房间内未找到可放下整组副本的位置，请先腾出空间。');
  return originals.map((o) => {
    const n = clone(o),
      sku = s.layout.catalogSnapshot.find((c) => c.skuId === o.skuId)!;
    n.id = id();
    n.skuId = 'CUSTOM-' + id();
    n.positionMm = [o.positionMm[0] + offset[0], o.positionMm[1] + offset[1], o.positionMm[2]];
    s.layout.catalogSnapshot.push({ ...clone(sku), skuId: n.skuId });
    s.layout.furniture.push(n);
    return n.id;
  });
}
export function alignSelected(s: Scene, ids: string[], mode: string) {
  const objects = s.layout.furniture.filter((f) => ids.includes(f.id) && !f.locked);
  if (objects.length < 2) throw new Error('请至少选择两件未锁定家具。');
  const boxes = objects.map((f) => ({ f, b: bounds(corners(f)) }));
  const whole = bounds(objects.flatMap(corners));
  for (const { f, b } of boxes) {
    const dx =
      mode === 'left'
        ? whole.minX - b.minX
        : mode === 'right'
          ? whole.maxX - b.maxX
          : mode === 'center'
            ? (whole.minX + whole.maxX - b.minX - b.maxX) / 2
            : 0;
    const dy =
      mode === 'bottom'
        ? whole.minY - b.minY
        : mode === 'top'
          ? whole.maxY - b.maxY
          : mode === 'middle'
            ? (whole.minY + whole.maxY - b.minY - b.maxY) / 2
            : 0;
    f.positionMm[0] += Math.round(dx);
    f.positionMm[1] += Math.round(dy);
  }
}

function face(w: Floor['walls'][number], side: 'left' | 'right'): [Vec2, Vec2] {
  const dx = w.endMm[0] - w.startMm[0],
    dy = w.endMm[1] - w.startMm[1],
    len = Math.hypot(dx, dy),
    sign = side === 'left' ? 1 : -1;
  if (len < 1) throw new Error('墙段不能为零长度。');
  const nx = (((-dy / len) * w.thicknessMm) / 2) * sign,
    ny = (((dx / len) * w.thicknessMm) / 2) * sign;
  return [
    [w.startMm[0] + nx, w.startMm[1] + ny],
    [w.endMm[0] + nx, w.endMm[1] + ny],
  ];
}
/** Preserve the face-line references at each old corner and rebuild their intersections. */
export function syncRoomBoundaries(before: Floor, after: Floor) {
  for (const room of after.rooms) {
    const original = before.rooms.find((r) => r.id === room.id)!;
    const refs = original.wallRefs.map((ref) => ({
      ref,
      old: face(
        before.walls.find((w) => w.id === ref.wallId)!,
        ref.side,
      ),
      next: face(
        after.walls.find((w) => w.id === ref.wallId)!,
        ref.side,
      ),
    }));
    room.boundaryMm = original.boundaryMm.map((p) => {
      const matches = refs.filter(({ old: [a, b] }) => {
        const dx = b[0] - a[0],
          dy = b[1] - a[1],
          len = Math.hypot(dx, dy),
          t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (len * len);
        return Math.abs(dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / len < 2 && t >= -0.1 && t <= 1.1;
      });
      for (let i = 0; i < matches.length; i++)
        for (let j = i + 1; j < matches.length; j++) {
          const [a, b] = matches[i].next,
            [c, d] = matches[j].next,
            ux = b[0] - a[0],
            uy = b[1] - a[1],
            vx = d[0] - c[0],
            vy = d[1] - c[1],
            den = ux * vy - uy * vx;
          if (Math.abs(den) < 1e-6) continue;
          const t = ((c[0] - a[0]) * vy - (c[1] - a[1]) * vx) / den;
          const next: Vec2 = [Math.round(a[0] + t * ux), Math.round(a[1] + t * uy)];
          if (next.some((v) => !Number.isFinite(v) || Math.abs(v) > 1000000))
            throw new Error('墙线交点过远，请检查平行墙关系。');
          return next;
        }
      return p;
    });
    if (area(room.boundaryMm) < 10000) throw new Error('墙体调整导致房间面积过小。');
    room.computedAreaMm2 = area(room.boundaryMm);
  }
}
