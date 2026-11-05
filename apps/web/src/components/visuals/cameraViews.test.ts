import { describe, expect, it } from 'vitest';
import { overviewCamera } from './cameraViews';

describe('3D overview camera presets', () => {
  it.each([
    [8, 2.8, false],
    [16, 6.8, true],
    [2, 8, true],
    [30, 3.2, false],
  ] as const)(
    'keeps the top camera above a %s m scene and its full %s m walls',
    (span, height, whole) => {
      const top = overviewCamera([5, -8], span, height, whole, 'top');
      expect(top.position[1]).toBeGreaterThan(height);
      expect(top.position[0]).toBe(top.target[0]);
      expect(Math.abs(top.position[2] - top.target[2])).toBeCloseTo(0.001);
      expect([...top.position, ...top.target, top.fov].every(Number.isFinite)).toBe(true);
      const orbit = overviewCamera([5, -8], span, height, whole, 'perspective');
      expect(orbit.target).toEqual(top.target);
      expect(orbit.position[0]).toBeGreaterThan(top.position[0]);
    },
  );
});
