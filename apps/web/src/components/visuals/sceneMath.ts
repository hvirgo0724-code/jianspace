import type { Scene, Room, Vec2, Vec3, Wall, Opening } from '../../types';
import { bounds } from '../../scene';
import { MODEL_KINDS, type FurnitureKind } from '../../catalog';
import { isOutdoor } from '../../surfaces';
export type { FurnitureKind } from '../../catalog';

export function furnitureKind(name: string, modelAssetId?: string | null): FurnitureKind {
  const builtin = modelAssetId?.replace(/^builtin-/, '');
  if (modelAssetId?.startsWith('builtin-') && MODEL_KINDS.includes(builtin as FurnitureKind))
    return builtin as FurnitureKind;
  const kinds: [RegExp, FurnitureKind][] = [
    [/烘干机|dryer/i, 'dryer'],
    [/洗衣机|washing.machine|washer/i, 'washing-machine'],
    [/洗碗机|dishwasher/i, 'dishwasher'],
    [/微波炉|microwave/i, 'microwave'],
    [/冰箱|fridge|refrigerator/i, 'refrigerator'],
    [/油烟机|range.hood/i, 'range-hood'],
    [/烤箱|oven/i, 'oven'],
    [/燃气灶|电磁炉|cooktop/i, 'cooktop'],
    [/壁挂空调|挂机|wall.ac/i, 'wall-ac'],
    [/柜机空调|floor.ac/i, 'floor-ac'],
    [/净化器|air.purifier/i, 'air-purifier'],
    [/电视(?!.*柜)|television/i, 'television'],
    [/坐便器|马桶|toilet/i, 'toilet'],
    [/浴缸|bathtub/i, 'bathtub'],
    [/淋浴房|shower/i, 'shower'],
    [/洗手台|vanity/i, 'vanity'],
    [/水槽.*柜|sink.cabinet/i, 'sink-cabinet'],
    [/厨房地柜|中岛台|kitchen.cabinet/i, 'kitchen-cabinet'],
    [/落地灯|floor.lamp/i, 'floor-lamp'],
    [/台灯|table.lamp/i, 'table-lamp'],
    [/绿植|盆栽|plant/i, 'plant'],
    [/梳妆台|dressing.table/i, 'dressing-table'],
    [/抽屉柜|斗柜|chest/i, 'chest'],
    [/鞋柜|shoe.cabinet/i, 'shoe-cabinet'],
    [/贵妃沙发|chaise.sofa/i, 'chaise-sofa'],
    [/脚凳|ottoman/i, 'ottoman'],
    [/长凳|bench/i, 'bench'],
    [/吧椅|bar.stool/i, 'bar-stool'],
    [/餐椅|dining.chair/i, 'dining-chair'],
    [/圆形.*(桌|几)|round.table/i, 'round-table'],
  ];
  for (const [pattern, kind] of kinds) if (pattern.test(name)) return kind;
  if (/床头柜|电视.*柜|收纳柜|边柜|sideboard|nightstand|console/i.test(name)) return 'cabinet';
  if (/衣柜|wardrobe/i.test(name)) return 'wardrobe';
  if (/书架|bookshelf/i.test(name)) return 'bookshelf';
  if (/沙发|sofa/i.test(name)) return 'sofa';
  if (/床|bed/i.test(name)) return 'bed';
  if (/茶几|coffee/i.test(name)) return 'coffee-table';
  if (/桌|table|desk/i.test(name)) return 'table';
  if (/椅|chair/i.test(name)) return 'chair';
  return 'cabinet';
}
export const MODEL_URLS = {
  sofa: '/visuals/models/GlamVelvetSofa.glb',
  chair: '/visuals/models/SheenChair.glb',
  'coffee-table': '/visuals/models/modern_coffee_table_02/scene.gltf',
  cabinet: '/visuals/models/modern_wooden_cabinet/scene.gltf',
  'sofa-compact': '/visuals/models/sofa_03/scene.gltf',
  'dining-table': '/visuals/models/dining_table/scene.gltf',
} as const;

/** Door transform shared by rendering and walk collision (wall-local Three.js X/Z metres). */
export function doorPose(o: Opening, w: Wall, rooms: Room[], walk: boolean, open?: boolean) {
  const width = o.widthMm / 1000;
  const trim = Math.min(0.045, width * 0.09, (o.heightMm / 1000) * 0.08);
  const side = rooms
    .find((r) => r.id === o.swing?.roomId)
    ?.wallRefs.find((ref) => ref.wallId === w.id)?.side;
  const sign = o.swing?.hinge === 'end' ? -1 : 1;
  return {
    width: width - 2 * trim,
    hingeX: o.offsetMm / 1000 + (sign === -1 ? width - trim : trim),
    hingeZ: ((side === 'left' ? -1 : 1) * w.thicknessMm) / 2000,
    centerX: (sign * (width - 2 * trim)) / 2,
    angle:
      ((o.swing?.direction === 'cw' ? -1 : 1) *
        (open === false ? 0 : open === true || walk ? 90 : Math.min(o.swing?.angleDeg || 45, 55)) *
        Math.PI) /
      180,
    sign,
  };
}

export function shouldCutWall(wall: Wall, rooms: Room[], direction: Vec2): boolean {
  const refs = rooms
    .filter((r) => !isOutdoor(r.type))
    .flatMap((r) => r.wallRefs.filter((ref) => ref.wallId === wall.id));
  // An exterior wall can span several rooms on the same side.
  if (!refs.length || new Set(refs.map((ref) => ref.side)).size > 1) return false;
  const dx = wall.endMm[0] - wall.startMm[0],
    dy = wall.endMm[1] - wall.startMm[1],
    length = Math.hypot(dx, dy);
  if (length < 1) return false;
  const sign = refs[0]?.side === 'right' ? -1 : 1;
  return (dy / length) * sign * direction[0] - (dx / length) * sign * direction[1] > 0.15;
}

/** Source bounds and display dimensions are in Three.js X/Y/Z metres. */
export function modelFit(min: Vec3, max: Vec3, target: Vec3): { scale: Vec3; offset: Vec3 } {
  const extents = max.map((v, i) => v - min[i]);
  if (
    extents.some((v) => !Number.isFinite(v) || v < 1e-7) ||
    target.some((v) => !Number.isFinite(v) || v <= 0)
  )
    throw new Error('模型缺少可用的三维边界');
  return {
    scale: target.map((v, i) => v / extents[i]) as Vec3,
    offset: [-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2],
  };
}
export function inside(point: Vec2, polygon: Vec2[]): boolean {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [x, y] = polygon[i],
      [px, py] = polygon[j];
    if (y > point[1] !== py > point[1] && point[0] < ((px - x) * (point[1] - y)) / (py - y) + x)
      result = !result;
  }
  return result;
}
/** A ceiling fixture belongs inside the room, including concave floor plans. */
export function roomInteriorPoint(room: Room): Vec2 {
  const b = bounds(room.boundaryMm);
  const center: Vec2 = [
    room.boundaryMm.reduce((s, p) => s + p[0], 0) / room.boundaryMm.length,
    room.boundaryMm.reduce((s, p) => s + p[1], 0) / room.boundaryMm.length,
  ];
  if (inside(center, room.boundaryMm)) return center;
  let best: Vec2 = room.boundaryMm[0],
    clearance = -1;
  for (let x = 0; x < 13; x++)
    for (let y = 0; y < 13; y++) {
      const p: Vec2 = [
        b.minX + ((x + 0.5) / 13) * (b.maxX - b.minX),
        b.minY + ((y + 0.5) / 13) * (b.maxY - b.minY),
      ];
      if (!inside(p, room.boundaryMm)) continue;
      const nearest = Math.min(
        ...room.boundaryMm.map((a, i) => {
          const c = room.boundaryMm[(i + 1) % room.boundaryMm.length],
            dx = c[0] - a[0],
            dy = c[1] - a[1];
          const t = Math.max(
            0,
            Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
          );
          return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
        }),
      );
      if (nearest > clearance) {
        clearance = nearest;
        best = p;
      }
    }
  return best;
}
export function roomCamera(
  scene: Scene,
  room: Room,
): { position: Vec3; target: Vec3; fov: number } {
  const b = bounds(room.boundaryMm),
    w = b.maxX - b.minX,
    d = b.maxY - b.minY;
  const stored = scene.layout.cameraViews.find(
    (c) =>
      c.roomId === room.id &&
      inside([c.positionMm[0], c.positionMm[1]], room.boundaryMm) &&
      inside([c.targetMm[0], c.targetMm[1]], room.boundaryMm),
  );
  if (stored)
    return {
      position: [
        stored.positionMm[0] / 1000,
        Math.min(1.6, (room.heightMm / 1000) * 0.65),
        -stored.positionMm[1] / 1000,
      ],
      target: [
        stored.targetMm[0] / 1000,
        Math.min(1.2, (room.heightMm / 1000) * 0.5),
        -stored.targetMm[1] / 1000,
      ],
      fov: Math.max(50, Math.min(75, stored.fovDeg)),
    };
  const points = [0.12, 0.85, 0.5, 0.3, 0.65]
    .flatMap((x) =>
      [0.14, 0.82, 0.5, 0.3, 0.65].map((y) => [b.minX + w * x, b.minY + d * y] as Vec2),
    )
    .filter((p) => inside(p, room.boundaryMm));
  const start = points[0] || room.boundaryMm[0];
  const end =
    [...points].sort(
      (a, c) =>
        Math.hypot(c[0] - start[0], c[1] - start[1]) - Math.hypot(a[0] - start[0], a[1] - start[1]),
    )[0] || start;
  return {
    position: [start[0] / 1000, Math.min(1.6, (room.heightMm / 1000) * 0.65), -start[1] / 1000],
    target: [end[0] / 1000, Math.min(1.15, (room.heightMm / 1000) * 0.45), -end[1] / 1000],
    fov: 60,
  };
}
/** Split wall solids at every opening edge, retaining stacked door/window holes. */
export function wallSolids(wall: Wall, openings: Opening[], height: number) {
  const length =
    Math.hypot(wall.endMm[0] - wall.startMm[0], wall.endMm[1] - wall.startMm[1]) / 1000;
  const edges = [
    0,
    length,
    ...openings.flatMap((o) => [o.offsetMm / 1000, (o.offsetMm + o.widthMm) / 1000]),
  ]
    .filter((x) => x >= 0 && x <= length)
    .sort((a, b) => a - b);
  const solids: { x: number; bottom: number; width: number; height: number }[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const a = edges[i],
      b = edges[i + 1];
    if (b - a < 1e-5) continue;
    const mid = (a + b) / 2;
    let cursor = 0;
    for (const op of openings
      .filter((o) => mid > o.offsetMm / 1000 && mid < (o.offsetMm + o.widthMm) / 1000)
      .sort((a, b) => a.bottomMm - b.bottomMm)) {
      const low = Math.min(height, op.bottomMm / 1000);
      if (low > cursor)
        solids.push({ x: (a + b) / 2, bottom: cursor, width: b - a, height: low - cursor });
      cursor = Math.max(cursor, (op.bottomMm + op.heightMm) / 1000);
    }
    if (cursor < height)
      solids.push({ x: (a + b) / 2, bottom: cursor, width: b - a, height: height - cursor });
  }
  return solids;
}
