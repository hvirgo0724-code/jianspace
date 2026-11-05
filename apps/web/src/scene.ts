import type { Scene, Room, Vec2, Item, Furniture } from './types';
import { syncRoomBoundaries } from './editorCommands';
export const clone = <T>(x: T): T => structuredClone(x);
export const id = () => crypto.randomUUID();
export const activeFloor = (s: Scene, floorId?: string | null) =>
  s.floors.find((f) => f.id === floorId) || s.floors[0];
export function floorScene(s: Scene, floorId: string): Scene {
  const floor = activeFloor(s, floorId);
  return {
    ...s,
    floors: [floor],
    layout: { ...s.layout, furniture: s.layout.furniture.filter((f) => f.floorId === floor.id) },
  };
}
export function bounds(points: Vec2[]) {
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}
export function area(p: Vec2[]) {
  return (
    Math.abs(
      p.reduce(
        (s, v, i) => s + v[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * v[1],
        0,
      ),
    ) / 2
  );
}
export function normalize(s: Scene) {
  s.floors.forEach((f) =>
    f.rooms.forEach((r) => (r.computedAreaMm2 = Math.round(area(r.boundaryMm)))),
  );
  return s;
}
export function resizedRoom(
  scene: Scene,
  room: Room,
  width: number,
  depth: number,
  height: number,
  rawUnit: 'm' | 'cm' | 'mm' = 'mm',
) {
  const s = clone(scene),
    b = bounds(room.boundaryMm),
    floor = s.floors.find((f) => f.rooms.some((r) => r.id === room.id))!;
  const dx = width - (b.maxX - b.minX),
    dy = depth - (b.maxY - b.minY);
  function map(p: Vec2): Vec2 {
    return [
      Math.round(
        p[0] <= b.minX
          ? p[0]
          : p[0] >= b.maxX
            ? p[0] + dx
            : b.minX + ((p[0] - b.minX) * width) / (b.maxX - b.minX),
      ),
      Math.round(
        p[1] <= b.minY
          ? p[1]
          : p[1] >= b.maxY
            ? p[1] + dy
            : b.minY + ((p[1] - b.minY) * depth) / (b.maxY - b.minY),
      ),
    ];
  }
  [floor].forEach((f) => {
    f.rooms.forEach((r) => {
      r.boundaryMm = r.boundaryMm.map(map);
      if (r.id === room.id) r.heightMm = height;
    });
    f.walls.forEach((w) => {
      w.startMm = map(w.startMm);
      w.endMm = map(w.endMm);
      const related = (rooms: Room[]) =>
        rooms.filter((r) => r.wallRefs.some((ref) => ref.wallId === w.id));
      const previousHeight = Math.max(
        1,
        ...related(scene.floors.find((x) => x.id === f.id)!.rooms).map((r) => r.heightMm),
      );
      const nextHeight = Math.max(1, ...related(f.rooms).map((r) => r.heightMm));
      // Low guard walls at a mezzanine edge keep their own height during room resizing.
      w.heightMm = w.heightMm < previousHeight ? Math.min(w.heightMm, nextHeight) : nextHeight;
    });
    f.obstacles.forEach((o) => (o.polygonMm = o.polygonMm.map(map)));
    f.stairs?.forEach((stair) => {
      stair.startMm = map(stair.startMm);
      stair.endMm = map(stair.endMm);
    });
    syncRoomBoundaries(
      scene.floors.find((x) => x.id === f.id)!,
      f,
    );
  });
  s.layout.furniture.forEach((f) => {
    if (f.floorId === floor.id && f.roomId !== room.id) {
      const mapped = map([f.positionMm[0], f.positionMm[1]]);
      f.positionMm = [...mapped, f.positionMm[2]];
    }
  });
  s.confirmation = { status: 'draft', measurementRevision: s.confirmation.measurementRevision + 1 };
  for (const [measurementType, normalizedMm] of [
    ['width', width],
    ['depth', depth],
    ['height', height],
  ] as const) {
    s.measurements.push({
      id: id(),
      floorId: floor.id,
      targetType: 'room',
      targetId: room.id,
      measurementType,
      rawValue: normalizedMm / (rawUnit === 'm' ? 1000 : rawUnit === 'cm' ? 10 : 1),
      rawUnit,
      normalizedMm,
      method: 'tape',
      measuredAt: new Date().toISOString(),
      sourceAssetIds: [],
      notes: '用户在尺寸面板录入的实测数值',
    });
  }
  return normalize(s);
}
export function addFurniture(s: Scene, item: Item, roomId: string): Furniture {
  const floor = s.floors.find((f) => f.rooms.some((r) => r.id === roomId)) || s.floors[0],
    room = floor.rooms.find((r) => r.id === roomId) || floor.rooms[0],
    b = bounds(room.boundaryMm),
    sku = 'CUSTOM-' + id();
  s.layout.catalogSnapshot.push({
    skuId: sku,
    name: item.name,
    sizeMm: [...item.sizeMm],
    priceMinor: null,
    currency: 'CNY',
    sourceType: 'user_input',
    quotedAt: new Date().toISOString(),
    modelAssetId: item.modelKind ? 'builtin-' + item.modelKind : null,
    productUrl: null,
  });
  const f: Furniture = {
    id: id(),
    floorId: floor.id,
    roomId: room.id,
    skuId: sku,
    positionMm: [
      Math.round((b.minX + b.maxX) / 2),
      Math.round((b.minY + b.maxY) / 2),
      Math.max(0, Math.min(item.baseZMm || 0, room.heightMm - item.sizeMm[2] - 20)),
    ],
    sizeMm: [...item.sizeMm],
    rotationDeg: 0,
    locked: false,
  };
  if (item.placement === 'wall') {
    const signed = room.boundaryMm.reduce((sum, p, i) => {
      const next = room.boundaryMm[(i + 1) % room.boundaryMm.length];
      return sum + p[0] * next[1] - next[0] * p[1];
    }, 0);
    const candidates = room.boundaryMm
      .map((p, i) => {
        const next = room.boundaryMm[(i + 1) % room.boundaryMm.length],
          dx = next[0] - p[0],
          dy = next[1] - p[1],
          len = Math.hypot(dx, dy),
          sign = signed >= 0 ? 1 : -1;
        return {
          x: (p[0] + next[0]) / 2,
          y: (p[1] + next[1]) / 2,
          nx: (-dy / len) * sign,
          ny: (dx / len) * sign,
          len,
        };
      })
      .filter((e) => e.len >= item.sizeMm[0] + 80)
      .sort((a, c) => c.y - a.y);
    const within = (p: Vec2) => {
      let yes = false;
      for (let i = 0, j = room.boundaryMm.length - 1; i < room.boundaryMm.length; j = i++) {
        const a = room.boundaryMm[i],
          c = room.boundaryMm[j];
        if (
          a[1] > p[1] !== c[1] > p[1] &&
          p[0] < ((c[0] - a[0]) * (p[1] - a[1])) / (c[1] - a[1]) + a[0]
        )
          yes = !yes;
      }
      return yes;
    };
    for (const e of candidates) {
      const point: Vec2 = [
        e.x + e.nx * (item.sizeMm[1] / 2 + 30),
        e.y + e.ny * (item.sizeMm[1] / 2 + 30),
      ];
      const angle = Math.atan2(e.ny, e.nx) + Math.PI / 2,
        c = Math.cos(angle),
        sn = Math.sin(angle);
      if (
        ![-1, 1].every((x) =>
          [-1, 1].every((y) =>
            within([
              point[0] + (c * x * item.sizeMm[0]) / 2 - (sn * y * item.sizeMm[1]) / 2,
              point[1] + (sn * x * item.sizeMm[0]) / 2 + (c * y * item.sizeMm[1]) / 2,
            ]),
          ),
        )
      )
        continue;
      f.positionMm[0] = Math.round(point[0]);
      f.positionMm[1] = Math.round(point[1]);
      f.rotationDeg = Math.round((((angle * 180) / Math.PI + 360) % 360) * 1000) / 1000;
      break;
    }
  }
  s.layout.furniture.push(f);
  return f;
}
export function addRoom(s: Scene, points: Vec2[], name: string, floorId?: string | null) {
  let p = [...points];
  const signed = p.reduce(
    (a, v, i) => a + v[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * v[1],
    0,
  );
  if (signed < 0) p.reverse();
  const refs: Room['wallRefs'] = [];
  const f = activeFloor(s, floorId);
  p.forEach((a, i) => {
    const b = p[(i + 1) % p.length],
      len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!len) return;
    const nx = ((b[1] - a[1]) / len) * 100,
      ny = (-(b[0] - a[0]) / len) * 100,
      wallId = 'wall-' + id();
    f.walls.push({
      id: wallId,
      startMm: [a[0] + nx, a[1] + ny],
      endMm: [b[0] + nx, b[1] + ny],
      heightMm: 2800,
      thicknessMm: 200,
      structuralRole: 'unknown',
      locked: true,
    });
    refs.push({ wallId, side: 'left' });
  });
  f.rooms.push({
    id: 'room-' + id(),
    name,
    type: 'other',
    boundaryMm: p,
    heightMm: 2800,
    computedAreaMm2: area(p),
    wallRefs: refs,
  });
  s.confirmation.status = 'draft';
  return normalize(s);
}
