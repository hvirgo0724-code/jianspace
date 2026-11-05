import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import fixture from '../../../../../packages/scene/scene.example.json';
import type { Scene, Vec3, Room } from '../../types';
import {
  furnitureKind,
  modelFit,
  wallSolids,
  roomCamera,
  inside,
  shouldCutWall,
  roomInteriorPoint,
} from './sceneMath';
describe('dimension-preserving visual models', () => {
  it('distinguishes a shared partition from an exterior wall spanning multiple rooms', () => {
    const floor = (fixture as unknown as Scene).floors[0];
    const shared = floor.walls.find(
      (w) =>
        new Set(
          floor.rooms.flatMap((r) =>
            r.wallRefs.filter((ref) => ref.wallId === w.id).map((ref) => ref.side),
          ),
        ).size > 1,
    )!;
    const north = floor.walls.find((w) => w.startMm[1] === 5100 && w.endMm[1] === 5100)!;
    expect(shouldCutWall(shared, floor.rooms, [0.7, -0.7])).toBe(false);
    expect(shouldCutWall(north, floor.rooms, [0.7, -0.7])).toBe(false);
  });
  it('fits asymmetric source bounds to exact input width, height and depth', () => {
    const min: Vec3 = [-2, 0.12, -0.4],
      max: Vec3 = [1, 1.2, 0.6],
      target: Vec3 = [2.2, 0.9, 0.9],
      fit = modelFit(min, max, target);
    const lo = min.map((v, i) => (v + fit.offset[i]) * fit.scale[i]),
      hi = max.map((v, i) => (v + fit.offset[i]) * fit.scale[i]);
    expect(lo[1]).toBeCloseTo(0);
    expect(hi[1]).toBeCloseTo(0.9);
    expect(hi[0] - lo[0]).toBeCloseTo(2.2);
    expect(hi[2] - lo[2]).toBeCloseTo(0.9);
    expect((lo[0] + hi[0]) / 2).toBeCloseTo(0);
  });
  it('rejects missing source dimensions instead of generating infinite scales', () => {
    expect(() => modelFit([0, 0, 0], [0, 1, 1], [1, 1, 1])).toThrow();
  });
  it('does not mistake a nightstand for a bed or a coffee table for a chair', () => {
    expect(furnitureKind('床头柜')).toBe('cabinet');
    expect(furnitureKind('演示茶几')).toBe('coffee-table');
    expect(furnitureKind('双门衣柜')).toBe('wardrobe');
    expect(furnitureKind('演示床')).toBe('bed');
  });
  it('keeps the window opening empty while retaining its sill and header', () => {
    const scene = fixture as unknown as Scene,
      w = scene.floors[0].walls.find((w) =>
        scene.floors[0].openings.some((o) => o.kind === 'window' && o.wallId === w.id),
      )!,
      o = scene.floors[0].openings.find((o) => o.kind === 'window')!;
    const solids = wallSolids(w, [o], 2.8),
      mid = (o.offsetMm + o.widthMm / 2) / 1000;
    expect(
      solids.filter((s) => Math.abs(s.x - mid) < s.width / 2).map((s) => [s.bottom, s.height]),
    ).toEqual([
      [0, 0.9],
      [2.4, expect.closeTo(0.4)],
    ]);
  });
  it('chooses an indoor eye-level camera for an L-shaped room without stored cameras', () => {
    const s = structuredClone(fixture) as unknown as Scene;
    const r: Room = {
      ...s.floors[0].rooms[0],
      id: 'L',
      boundaryMm: [
        [0, 0],
        [5000, 0],
        [5000, 1500],
        [1500, 1500],
        [1500, 5000],
        [0, 5000],
      ],
    };
    const pose = roomCamera(s, r);
    expect(inside([pose.position[0] * 1000, -pose.position[2] * 1000], r.boundaryMm)).toBe(true);
    expect(pose.position[1]).toBeCloseTo(1.6);
    expect(inside(roomInteriorPoint(r), r.boundaryMm)).toBe(true);
  });
});
describe('self-hosted licensed assets', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../public/visuals');
  const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8')) as {
    assets: { file: string; sha256: string; license: string }[];
  };
  it('ships every credited file with its recorded checksum', () => {
    expect(manifest.assets.length).toBeGreaterThan(10);
    for (const item of manifest.assets) {
      const data = readFileSync(resolve(root, item.file));
      expect(createHash('sha256').update(data).digest('hex')).toBe(item.sha256);
      expect(['CC0-1.0', 'CC-BY-4.0']).toContain(item.license);
    }
  });
  it('includes all glTF buffers and textures locally without external runtime URLs', () => {
    for (const item of manifest.assets.filter((x) => x.file.endsWith('.gltf'))) {
      const p = resolve(root, item.file);
      const json = JSON.parse(readFileSync(p, 'utf8')) as {
        buffers: { uri: string }[];
        images: { uri: string }[];
      };
      for (const resource of [...json.buffers, ...json.images]) {
        expect(resource.uri.startsWith('http')).toBe(false);
        expect(existsSync(resolve(dirname(p), resource.uri))).toBe(true);
      }
    }
  });
});
