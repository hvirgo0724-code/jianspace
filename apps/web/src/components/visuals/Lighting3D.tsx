import { Suspense, useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import { Object3D } from 'three';

export const LIGHTING_PRESETS = {
  daylight: {
    name: '自然日光',
    sun: '#fff5e5',
    sky: '#dbeaf2',
    ground: '#9caa90',
    intensity: 2.5,
    ambient: 0.16,
    env: 0.48,
    altitude: 50,
  },
  golden: {
    name: '傍晚暖阳',
    sun: '#ffd4a0',
    sky: '#f0ddc9',
    ground: '#a69a83',
    intensity: 2.7,
    ambient: 0.12,
    env: 0.36,
    altitude: 24,
  },
  overcast: {
    name: '柔和阴天',
    sun: '#eef4ff',
    sky: '#dde4e8',
    ground: '#a8aea4',
    intensity: 1.05,
    ambient: 0.36,
    env: 0.68,
    altitude: 65,
  },
} as const;
export type LightingId = keyof typeof LIGHTING_PRESETS;

export default function Lighting3D({
  center,
  span,
  height,
  high,
  presetId,
  direction,
  exposure,
  exterior,
}: {
  center: [number, number];
  span: number;
  height: number;
  high: boolean;
  presetId: LightingId;
  direction: number;
  exposure: number;
  exterior: boolean;
}) {
  const { gl, invalidate } = useThree();
  const preset = LIGHTING_PRESETS[presetId];
  const target = useMemo(() => new Object3D(), []);
  useEffect(() => {
    target.position.set(center[0], height * 0.4, center[1]);
    target.updateMatrixWorld();
    invalidate();
  }, [target, center[0], center[1], height, invalidate]);
  useEffect(() => {
    gl.toneMappingExposure = exposure;
    invalidate();
  }, [gl, exposure, presetId, direction, invalidate]);
  const distance = Math.max(span * 1.6, 18),
    altitude = (preset.altitude * Math.PI) / 180,
    angle = (direction * Math.PI) / 180;
  return (
    <>
      <color attach="background" args={[exterior ? preset.sky : '#e7e4dd']} />
      <ambientLight intensity={preset.ambient} />
      <hemisphereLight args={[preset.sky, preset.ground, 0.44]} />
      <primitive object={target} />
      <directionalLight
        target={target}
        position={[
          center[0] + Math.cos(angle) * distance,
          height * 0.4 + Math.tan(altitude) * distance,
          center[1] + Math.sin(angle) * distance,
        ]}
        intensity={preset.intensity}
        color={preset.sun}
        castShadow
        shadow-mapSize={high ? [2048, 2048] : [1024, 1024]}
        shadow-camera-near={0.5}
        shadow-camera-far={distance * 5 + height}
        shadow-camera-left={-span}
        shadow-camera-right={span}
        shadow-camera-top={span}
        shadow-camera-bottom={-span}
        shadow-bias={-0.00008}
        shadow-normalBias={0.018}
        shadow-radius={3}
      />
      <Suspense fallback={null}>
        <Environment
          files={
            exterior
              ? presetId === 'golden'
                ? '/visuals/lighting/daylight.hdr'
                : '/visuals/lighting/sky.hdr'
              : '/visuals/lighting/interior.hdr'
          }
          environmentIntensity={preset.env}
          environmentRotation={[0, angle, 0]}
        />
      </Suspense>
    </>
  );
}
