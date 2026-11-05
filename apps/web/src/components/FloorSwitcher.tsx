import type { Scene } from '../types';
export default function FloorSwitcher({
  scene,
  floorId,
  onChange,
}: {
  scene: Scene;
  floorId: string;
  onChange: (id: string) => void;
}) {
  if (scene.floors.length < 2) return null;
  return (
    <div className="floor-switcher" role="group" aria-label="选择楼层">
      {scene.floors.map((f) => (
        <button
          key={f.id}
          type="button"
          aria-pressed={floorId === f.id}
          onClick={() => onChange(f.id)}
        >
          {f.name}
          <small>标高 {(f.elevationMm / 1000).toFixed(2)} m</small>
        </button>
      ))}
    </div>
  );
}
