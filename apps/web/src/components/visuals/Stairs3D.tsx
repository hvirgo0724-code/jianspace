import type { Scene, Floor } from '../../types';
import { Part } from './ModelPrimitives';
import { usePalette } from './materials';

export default function Stairs3D({ floor, floors }: { floor: Floor; floors: Scene['floors'] }) {
  const p = usePalette('#8b9a77');
  return (
    <>
      {floor.stairs?.map((s) => {
        const target = floors.find((f) => f.id === s.targetFloorId);
        if (!target) return null;
        const dx = (s.endMm[0] - s.startMm[0]) / 1000,
          dy = (s.endMm[1] - s.startMm[1]) / 1000,
          run = Math.hypot(dx, dy),
          rise = (target.elevationMm - floor.elevationMm) / 1000,
          width = s.widthMm / 1000,
          tread = run / s.stepCount,
          step = rise / s.stepCount;
        return (
          <group
            key={s.id}
            position={[s.startMm[0] / 1000, 0, -s.startMm[1] / 1000]}
            rotation={[0, Math.atan2(dy, dx), 0]}
          >
            {Array.from({ length: s.stepCount }, (_, i) => (
              <group key={i}>
                <Part
                  at={[i * tread + 0.014, (i + 0.5) * step, 0]}
                  size={[0.028, step, width]}
                  material={p.woodDark}
                  radius={0.006}
                />
                <Part
                  at={[(i + 0.5) * tread, (i + 1) * step + 0.012, 0]}
                  size={[tread + 0.02, 0.024, width + 0.025]}
                  material={p.wood}
                  radius={0.005}
                />
                {i % 2 === 0 &&
                  [-1, 1].map((side) => (
                    <Part
                      key={side}
                      at={[(i + 0.5) * tread, (i + 1) * step + 0.47, side * (width / 2 - 0.025)]}
                      size={[0.025, 0.94, 0.025]}
                      material={p.steel}
                      radius={0.004}
                    />
                  ))}
              </group>
            ))}
            {[-1, 1].map((side) => (
              <group key={side}>
                <Part
                  at={[run / 2, rise / 2 - 0.1, side * width * 0.38]}
                  rotate={[0, 0, Math.atan2(rise, run)]}
                  size={[Math.hypot(run, rise), 0.15, 0.075]}
                  material={p.steel}
                  radius={0.012}
                />
                <Part
                  at={[run / 2, rise / 2 + 1, side * (width / 2 - 0.025)]}
                  rotate={[0, 0, Math.atan2(rise, run)]}
                  size={[Math.hypot(run, rise), 0.045, 0.045]}
                  material={p.woodDark}
                  radius={0.01}
                />
              </group>
            ))}
          </group>
        );
      })}
    </>
  );
}
