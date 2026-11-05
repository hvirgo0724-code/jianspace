import { useMemo, useEffect } from 'react';
import { useTexture } from '@react-three/drei';
import { RepeatWrapping, NoColorSpace, Vector2 } from 'three';

/** Clone cached textures so repeats/disposal never mutate another room's material. */
export function usePbrDetail(kind: 'roof' | 'plaster') {
  const originals = useTexture([
    `/visuals/textures/${kind}-normal.jpg`,
    `/visuals/textures/${kind}-roughness.jpg`,
  ]);
  const maps = useMemo(
    () =>
      originals.map((source) => {
        const map = source.clone();
        map.wrapS = map.wrapT = RepeatWrapping;
        map.colorSpace = NoColorSpace;
        const metres = kind === 'roof' ? 1.5 : 2.23;
        map.repeat.set(1 / metres, 1 / metres);
        map.anisotropy = 8;
        map.needsUpdate = true;
        return map;
      }),
    [originals[0], originals[1], kind],
  );
  useEffect(() => () => maps.forEach((map) => map.dispose()), [maps]);
  return {
    normalMap: maps[0],
    roughnessMap: maps[1],
    normalScale: new Vector2(kind === 'roof' ? 0.65 : 0.16, kind === 'roof' ? 0.65 : 0.16),
  };
}
