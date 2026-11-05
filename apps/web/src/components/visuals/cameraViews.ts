import type { Vec3 } from '../../types';

export type CameraView = 'perspective' | 'top';
export function overviewCamera(
  center: [number, number],
  span: number,
  height: number,
  wholeBuilding: boolean,
  view: CameraView,
) {
  const [cx, cz] = center;
  const targetY = wholeBuilding ? height * 0.4 : 0.65;
  return {
    position:
      view === 'top'
        ? ([cx, targetY + Math.max(span * 1.65, height + span * 0.7), cz + 0.001] as Vec3)
        : ([
            cx + span * 0.92,
            span * 0.9 + (wholeBuilding ? height * 0.4 : 0),
            cz + span * 0.98,
          ] as Vec3),
    target: [cx, targetY, cz] as Vec3,
    fov: 42,
  };
}
