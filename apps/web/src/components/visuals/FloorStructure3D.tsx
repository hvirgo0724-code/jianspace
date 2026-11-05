import { useMemo } from 'react';
import type { Floor, Scene } from '../../types';
import { structuralSlab, interstoreyInfill, SLAB_DEPTH } from './buildingEnvelope';
import { polygonShapes } from './slabs';

export default function FloorStructure3D({ scene, floor }: { scene: Scene; floor: Floor }) {
  const geometry = useMemo(
    () => ({
      slab: polygonShapes(structuralSlab(scene, floor)),
      infill: interstoreyInfill(scene, floor).map((v) => ({
        ...v,
        shapes: polygonShapes(v.polygons),
      })),
    }),
    [scene.floors, floor],
  );
  return (
    <>
      {geometry.slab.length > 0 && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, -SLAB_DEPTH, 0]}
          castShadow
          receiveShadow
        >
          <extrudeGeometry args={[geometry.slab, { depth: SLAB_DEPTH, bevelEnabled: false }]} />
          <meshStandardMaterial color="#c9c3b7" roughness={0.88} />
        </mesh>
      )}
      {geometry.infill.map(
        (v, i) =>
          v.shapes.length > 0 && (
            <mesh
              key={i}
              rotation={[-Math.PI / 2, 0, 0]}
              position={[0, v.bottom, 0]}
              castShadow
              receiveShadow
            >
              <extrudeGeometry
                args={[v.shapes, { depth: v.top - v.bottom, bevelEnabled: false }]}
              />
              <meshStandardMaterial color="#d7d2c7" roughness={0.85} />
            </mesh>
          ),
      )}
    </>
  );
}
