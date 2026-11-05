import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useThree } from '@react-three/fiber';
import type { Group } from 'three';
import type { Vec3 } from '../../types';
import { modelFit } from './sceneMath';
import { localModelBounds } from './geometryBounds';
export default function ModelBounds({
  children,
  signature,
  dimensions,
}: {
  children: ReactNode;
  signature: string;
  dimensions: Vec3;
}) {
  const outer = useRef<Group>(null),
    source = useRef<Group>(null),
    invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    if (!outer.current || !source.current) return;
    const box = localModelBounds(source.current);
    if (box.isEmpty()) return;
    const fit = modelFit(box.min.toArray() as Vec3, box.max.toArray() as Vec3, [1, 1, 1]);
    outer.current.scale.set(...fit.scale);
    outer.current.position.set(...(fit.offset.map((v, i) => v * fit.scale[i]) as Vec3));
    invalidate();
  }, [signature, ...dimensions, invalidate]);
  return (
    <group ref={outer}>
      <group ref={source}>{children}</group>
    </group>
  );
}
