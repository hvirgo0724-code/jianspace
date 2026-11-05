import type { Scene, Floor, Wall, Opening, Room, Vec2 } from '../../types';
import { connectedWallSolids } from './buildingEnvelope';
import { shouldCutWall } from './sceneMath';

/** View controls change visibility only. All dimensions come from the scene. */
export function openingMetrics(opening: Opening) {
  const width = opening.widthMm / 1000,
    height = opening.heightMm / 1000,
    bottom = opening.bottomMm / 1000;
  return {
    width,
    height,
    bottom,
    top: bottom + height,
    x: opening.offsetMm / 1000 + width / 2,
    trim: Math.min(0.045, width * 0.09, height * 0.08),
  };
}

export function wallPreview(
  scene: Scene,
  floor: Floor,
  wall: Wall,
  openings: Opening[],
  rooms: Room[],
  direction: Vec2,
  seeThrough: boolean,
) {
  return {
    solids: connectedWallSolids(scene, floor, wall, openings),
    opacity: seeThrough && shouldCutWall(wall, rooms, direction) ? 0.16 : 1,
  };
}
