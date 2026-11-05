import { describe, it, expect } from 'vitest';
import homes from '../../../../../packages/scene/navigation.examples.json';
import example from '../../../../../packages/scene/scene.example.json';
import type { Scene, Vec2 } from '../../types';
import { wallPreview, openingMetrics } from './wallPreview';
import { wallHeightRanges } from './buildingEnvelope';
import { isOutdoor } from '../../surfaces';

const scenes = { ...homes, example } as unknown as Record<string, Scene>;
const directions: Vec2[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [0.7, 0.7],
];
describe('full-height walls and doors in every preview direction', () => {
  it.each(Object.entries(scenes))(
    '%s never changes physical wall geometry when orbiting or toggling transparency',
    (_, source) => {
      const scene = structuredClone(source),
        before = JSON.stringify(scene);
      for (const floor of scene.floors)
        for (const wall of floor.walls) {
          const openings = floor.openings.filter((o) => o.wallId === wall.id);
          const physical = wallPreview(scene, floor, wall, openings, floor.rooms, [1, 0], false);
          for (const direction of directions) {
            const preview = wallPreview(scene, floor, wall, openings, floor.rooms, direction, true);
            expect(preview.solids, wall.id).toEqual(physical.solids);
            const sides = new Set(
              floor.rooms
                .filter((r) => !isOutdoor(r.type))
                .flatMap((r) =>
                  r.wallRefs.filter((ref) => ref.wallId === wall.id).map((ref) => ref.side),
                ),
            );
            if (sides.size > 1) expect(preview.opacity).toBe(1);
          }
          for (const opening of openings) {
            const metrics = openingMetrics(opening);
            expect(metrics.height).toBe(opening.heightMm / 1000);
            expect(metrics.top).toBe((opening.heightMm + opening.bottomMm) / 1000);
            expect(metrics.trim).toBeLessThan(metrics.height / 2);
          }
        }
      expect(JSON.stringify(scene)).toBe(before);
    },
  );
  it('retains full interior doors while making only a front exterior wall transparent', () => {
    const scene = structuredClone(example) as unknown as Scene,
      floor = scene.floors[0];
    const previews = floor.walls.map((wall) =>
      wallPreview(
        scene,
        floor,
        wall,
        floor.openings.filter((o) => o.wallId === wall.id),
        floor.rooms,
        [0.7, -0.7],
        true,
      ),
    );
    expect(previews.some((p) => p.opacity < 1)).toBe(true);
    expect(previews.flatMap((p) => p.solids).some((s) => s.height > 2)).toBe(true);
    for (const o of floor.openings.filter((o) => o.kind === 'door'))
      expect(openingMetrics(o).height).toBeGreaterThan(2);
  });
  it('does not let an upper courtyard wall truncate a lower double-height wall', () => {
    const scene = structuredClone(homes.loft) as unknown as Scene,
      floor = scene.floors[0];
    scene.floors[1].rooms.forEach((r) => {
      r.type = 'terrace';
    });
    const wall = floor.walls.find((w) => w.heightMm === 5400)!;
    expect(wallHeightRanges(scene, floor, wall).every((r) => r.height === 5.4)).toBe(true);
  });
  it('recognizes the house wall beside a courtyard as exterior, preserving its full geometry', () => {
    const scene = structuredClone(homes.villa) as unknown as Scene,
      floor = scene.floors[0];
    const wall = floor.walls.find(
      (w) =>
        floor.rooms.some(
          (r) => isOutdoor(r.type) && r.wallRefs.some((ref) => ref.wallId === w.id),
        ) &&
        floor.rooms.some(
          (r) => !isOutdoor(r.type) && r.wallRefs.some((ref) => ref.wallId === w.id),
        ),
    )!;
    expect(wall).toBeDefined();
    const openings = floor.openings.filter((o) => o.wallId === wall.id);
    const full = wallPreview(scene, floor, wall, openings, floor.rooms, [1, 0], false);
    expect(
      directions.some(
        (d) => wallPreview(scene, floor, wall, openings, floor.rooms, d, true).opacity < 1,
      ),
    ).toBe(true);
    for (const d of directions)
      expect(wallPreview(scene, floor, wall, openings, floor.rooms, d, true).solids).toEqual(
        full.solids,
      );
  });
});
