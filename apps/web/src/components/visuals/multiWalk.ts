import type { Scene, Vec2 } from '../../types';
import { floorScene } from '../../scene';
import { inside } from './sceneMath';
import {
  buildWalkWorld,
  rectangle,
  touchesPolygon,
  WALK_HEIGHT,
  WALK_RADIUS,
  type WalkWorld,
} from './walkMath';

export type Walker = { point: Vec2; elevation: number; floorId: string; stairId?: string };
type Flight = {
  id: string;
  start: Vec2;
  end: Vec2;
  width: number;
  run: number;
  low: number;
  high: number;
  from: string;
  to: string;
};
export type MultiWorld = {
  floors: Map<string, WalkWorld>;
  elevations: Map<string, number>;
  flights: Flight[];
  scene: Scene;
};
export function buildMultiWorld(scene: Scene, doors: Record<string, boolean> = {}): MultiWorld {
  const floors = new Map<string, WalkWorld>(),
    elevations = new Map<string, number>();
  for (const floor of scene.floors) {
    const local = floorScene(scene, floor.id);
    local.floors = [
      {
        ...local.floors[0],
        stairs: (floor.stairs || []).filter((s) => {
          const target = scene.floors.find((t) => t.id === s.targetFloorId);
          return (
            !target ||
            target.elevationMm <= floor.elevationMm ||
            Math.hypot(s.endMm[0] - s.startMm[0], s.endMm[1] - s.startMm[1]) < 1000
          );
        }),
      },
    ];
    floors.set(floor.id, buildWalkWorld(local, doors, scene));
    elevations.set(floor.id, floor.elevationMm / 1000);
  }
  const flights: Flight[] = [];
  for (const f of scene.floors)
    for (const s of f.stairs || []) {
      const target = scene.floors.find((t) => t.id === s.targetFloorId);
      const run = Math.hypot(s.endMm[0] - s.startMm[0], s.endMm[1] - s.startMm[1]) / 1000;
      if (!target || target.elevationMm <= f.elevationMm || run < 1) continue;
      flights.push({
        id: s.id,
        start: s.startMm.map((v) => v / 1000) as Vec2,
        end: s.endMm.map((v) => v / 1000) as Vec2,
        width: s.widthMm / 1000,
        run,
        low: f.elevationMm / 1000,
        high: target.elevationMm / 1000,
        from: f.id,
        to: target.id,
      });
    }
  return { floors, elevations, flights, scene };
}
export function flightProjection(s: Flight, p: Vec2) {
  const ux = (s.end[0] - s.start[0]) / s.run,
    uy = (s.end[1] - s.start[1]) / s.run;
  return {
    along: (p[0] - s.start[0]) * ux + (p[1] - s.start[1]) * uy,
    across: -(p[0] - s.start[0]) * uy + (p[1] - s.start[1]) * ux,
  };
}
function onFlight(s: Flight, p: Vec2, margin = 0) {
  const q = flightProjection(s, p);
  return q.along >= -0.32 && q.along <= s.run + 0.32 && Math.abs(q.across) <= s.width / 2 - margin;
}
function heightAt(s: Flight, p: Vec2) {
  return s.low + (s.high - s.low) * Math.max(0, Math.min(1, flightProjection(s, p).along / s.run));
}
function supportedFloor(world: MultiWorld, floorId: string, p: Vec2) {
  const floor = world.floors.get(floorId);
  if (!floor) return false;
  // Upper slabs must never support a visitor over the open stairwell.
  if (
    world.flights.some(
      (s) => s.to === floorId && onFlight(s, p) && flightProjection(s, p).along < s.run - 0.16,
    )
  )
    return false;
  return (
    floor.rooms.some((r) => r.height >= WALK_HEIGHT && inside(p, r.polygon)) ||
    floor.passages.some((poly) => inside(p, poly))
  );
}
function surface(world: MultiWorld, previous: Walker, p: Vec2): Walker | null {
  const active = world.flights.find((s) => s.id === previous.stairId);
  if (active && onFlight(active, p, WALK_RADIUS)) {
    const q = flightProjection(active, p);
    return {
      point: p,
      elevation: heightAt(active, p),
      floorId: q.along >= active.run - 0.01 ? active.to : active.from,
      stairId: active.id,
    };
  }
  if (active && previous.elevation > active.low + 0.22 && previous.elevation < active.high - 0.22)
    return null;
  const flight = world.flights.find(
    (s) =>
      onFlight(s, p, WALK_RADIUS) &&
      (s.from === previous.floorId || s.to === previous.floorId) &&
      Math.abs(heightAt(s, p) - previous.elevation) <= 0.24,
  );
  if (flight)
    return {
      point: p,
      elevation: heightAt(flight, p),
      floorId: flightProjection(flight, p).along >= flight.run - 0.01 ? flight.to : flight.from,
      stairId: flight.id,
    };
  const floorId = active
    ? previous.elevation >= active.high - 0.22
      ? active.to
      : active.from
    : previous.floorId;
  if (!supportedFloor(world, floorId, p)) return null;
  return { point: p, elevation: world.elevations.get(floorId) || 0, floorId };
}
export function canStandMulti(world: MultiWorld, body: Walker) {
  const active = world.flights.find((s) => s.id === body.stairId);
  const supported = (p: Vec2) =>
    supportedFloor(world, body.floorId, p) ||
    !!(active && onFlight(active, p) && Math.abs(heightAt(active, p) - body.elevation) < 0.45);
  if (!supported(body.point)) return false;
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8;
    if (
      !supported([
        body.point[0] + Math.cos(a) * WALK_RADIUS,
        body.point[1] + Math.sin(a) * WALK_RADIUS,
      ])
    )
      return false;
  }
  for (const f of world.scene.floors) {
    const base = f.elevationMm / 1000;
    const local = world.floors.get(f.id)!;
    for (const barrier of local.barriers) {
      // Barrier height follows its actual object instead of blocking every level.
      const low = base + (barrier.bottom || 0),
        high = base + (barrier.top ?? Math.max(...f.rooms.map((r) => r.heightMm / 1000)));
      if (body.elevation + WALK_HEIGHT <= low + 0.04 || body.elevation >= high - 0.02) continue;
      if (touchesPolygon(body.point, barrier.polygon, WALK_RADIUS)) return false;
    }
    if (!active && f.id === body.floorId) {
      const room = local.rooms.find((r) => inside(body.point, r.polygon));
      if (room && room.height < WALK_HEIGHT) return false;
    }
  }
  return true;
}
export function moveWalker(world: MultiWorld, start: Walker, delta: Vec2) {
  let body = start,
    blocked = false;
  const count = Math.max(1, Math.ceil(Math.hypot(...delta) / 0.035));
  const dx = delta[0] / count,
    dy = delta[1] / count;
  for (let i = 0; i < count; i++) {
    const full: Vec2 = [body.point[0] + dx, body.point[1] + dy];
    const next = surface(world, body, full);
    if (next && canStandMulti(world, next)) {
      body = next;
      continue;
    }
    blocked = true;
    for (const p of [
      [body.point[0] + dx, body.point[1]],
      [body.point[0], body.point[1] + dy],
    ] as Vec2[]) {
      const slide = surface(world, body, p);
      if (slide && canStandMulti(world, slide)) body = slide;
    }
  }
  return { body, blocked };
}
export function stairPolygon(start: Vec2, end: Vec2, width: number) {
  return rectangle(
    [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2],
    Math.hypot(end[0] - start[0], end[1] - start[1]),
    width,
    Math.atan2(end[1] - start[1], end[0] - start[0]),
  );
}
