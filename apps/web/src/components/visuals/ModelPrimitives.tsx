import { RoundedBox } from '@react-three/drei';
import type { Material } from 'three';
import type { Vec3 } from '../../types';
export function Part({
  at,
  size,
  material,
  radius = 0.025,
  rotate = [0, 0, 0],
}: {
  at: Vec3;
  size: Vec3;
  material: Material;
  radius?: number;
  rotate?: Vec3;
}) {
  return (
    <RoundedBox
      position={at}
      args={size}
      radius={Math.min(radius, ...size.map((v) => v * 0.4))}
      smoothness={3}
      rotation={rotate}
      material={material}
      castShadow={!material.transparent}
      receiveShadow
    />
  );
}
export function Cylinder({
  at,
  radius,
  height,
  material,
}: {
  at: Vec3;
  radius: number;
  height: number;
  material: Material;
}) {
  return (
    <mesh position={at} castShadow receiveShadow material={material}>
      <cylinderGeometry args={[radius, radius * 0.92, height, 12]} />
    </mesh>
  );
}
