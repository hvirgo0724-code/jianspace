import { useMemo, useEffect } from 'react';
import {
  BufferGeometry,
  BoxGeometry,
  Float32BufferAttribute,
  CanvasTexture,
  RepeatWrapping,
  SRGBColorSpace,
  DoubleSide,
} from 'three';
import type { Scene, Vec3 } from '../../types';
import type { ExteriorStyle } from '../../exteriorStyles';
import { buildRoof } from './roofGeometry';
import {
  exteriorWalls,
  connectedWallSolids,
  wallHeightRanges,
  SLAB_DEPTH,
} from './buildingEnvelope';
import { polygonShapes } from './slabs';
import { usePbrDetail } from './pbrTextures';

function texture(kind: 'roof' | 'facade', preset: ExteriorStyle) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#e9e6de';
  c.fillRect(0, 0, 256, 256);
  c.strokeStyle = '#b6b2a9';
  c.lineWidth = 1.4;
  if (kind === 'roof') {
    if (preset.roof === 'gable')
      for (let x = 0; x < 256; x += 32) {
        c.fillStyle = '#b9bdbb';
        c.fillRect(x, 0, 2, 256);
      }
    else if (preset.roof === 'hip')
      for (let y = 0; y < 256; y += 32) {
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(256, y);
        c.stroke();
        for (let x = 0; x < 256; x += 16) {
          c.fillStyle = x % 32 ? '#d0c9bb' : '#efeadf';
          c.fillRect(x, y + 2, 5, 28);
        }
      }
  } else if (preset.id === 'nordic') {
    for (let x = 0; x < 256; x += 21) {
      c.fillStyle = '#b4a18b';
      c.fillRect(x, 0, 2, 256);
      c.fillStyle = '#d2c3ac';
      c.fillRect(x + 10, 0, 1, 256);
    }
  } else
    for (let y = 0; y < 256; y += 64) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(256, y);
      c.stroke();
      for (let x = (y / 64) % 2 ? 64 : 0; x < 256; x += 128) {
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x, y + 64);
        c.stroke();
      }
    }
  const map = new CanvasTexture(canvas);
  map.wrapS = map.wrapT = RepeatWrapping;
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 8;
  map.repeat.set(kind === 'roof' ? 0.7 : 1, kind === 'roof' ? 0.7 : 1);
  return map;
}
function Box({ at, size, color }: { at: Vec3; size: Vec3; color: string }) {
  return (
    <mesh position={at} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.72} />
    </mesh>
  );
}
function FacadeGeometry({ width, height }: { width: number; height: number }) {
  const geometry = useMemo(() => {
    const box = new BoxGeometry(width, height, 0.032),
      uv = box.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * width, uv.getY(i) * height);
    return box;
  }, [width, height]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <primitive object={geometry} attach="geometry" />;
}
export default function Exterior3D({ scene, preset }: { scene: Scene; preset: ExteriorStyle }) {
  const roofDetail = usePbrDetail('roof');
  const plasterDetail = usePbrDetail('plaster');
  const roof = useMemo(() => buildRoof(scene, preset), [scene.floors, preset]);
  const resources = useMemo(() => {
    const skin = new BufferGeometry(),
      attic = new BufferGeometry();
    skin.setAttribute('position', new Float32BufferAttribute(roof?.positions || [], 3));
    skin.setAttribute('uv', new Float32BufferAttribute(roof?.uvs || [], 2));
    skin.computeVertexNormals();
    attic.setAttribute('position', new Float32BufferAttribute(roof?.attic || [], 3));
    attic.computeVertexNormals();
    return {
      skin,
      attic,
      roofMap: texture('roof', preset),
      facadeMap: texture('facade', preset),
      parapet: polygonShapes(roof?.parapet || []),
      eave: polygonShapes(roof?.outline || []),
      lowerCaps: (roof?.lowerCaps || []).map((cap) => ({
        ...cap,
        shapes: polygonShapes(cap.polygons),
      })),
    };
  }, [roof, preset]);
  useEffect(
    () => () => {
      resources.skin.dispose();
      resources.attic.dispose();
      resources.roofMap.dispose();
      resources.facadeMap.dispose();
    },
    [resources],
  );
  const facades = useMemo(
    () => scene.floors.map((floor) => ({ floor, walls: exteriorWalls(floor) })),
    [scene.floors],
  );
  const ground = Math.min(...scene.floors.map((f) => f.elevationMm));
  if (!roof) return null;
  return (
    <>
      <mesh geometry={resources.skin} castShadow>
        <meshStandardMaterial
          {...(preset.roof === 'hip' ? roofDetail : {})}
          map={resources.roofMap}
          color={preset.roofColor}
          roughness={0.83}
          side={DoubleSide}
        />
      </mesh>
      <mesh geometry={resources.attic} castShadow>
        <meshStandardMaterial
          color={preset.id === 'nordic' ? preset.lower : preset.wall}
          roughness={0.86}
          side={DoubleSide}
        />
      </mesh>
      {preset.roof === 'flat' ? (
        <>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, roof.eave, 0]} castShadow>
            <extrudeGeometry args={[resources.parapet, { depth: 0.42, bevelEnabled: false }]} />
            <meshStandardMaterial color={preset.wall} roughness={0.82} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, roof.eave + 0.42, 0]}>
            <extrudeGeometry args={[resources.parapet, { depth: 0.045, bevelEnabled: false }]} />
            <meshStandardMaterial color={preset.accent} roughness={0.5} metalness={0.15} />
          </mesh>
        </>
      ) : (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, roof.base, 0]} castShadow>
          <extrudeGeometry args={[resources.eave, { depth: 0.16, bevelEnabled: false }]} />
          <meshStandardMaterial color={preset.accent} roughness={0.7} />
        </mesh>
      )}
      {resources.lowerCaps.map((cap) => (
        <mesh
          key={cap.floorId}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, cap.bottom, 0]}
          castShadow
          receiveShadow
        >
          <extrudeGeometry
            args={[cap.shapes, { depth: cap.top - cap.bottom, bevelEnabled: false }]}
          />
          <meshStandardMaterial color={preset.accent} roughness={0.8} />
        </mesh>
      ))}
      {preset.id === 'chinese' && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, roof.base - 0.13, 0]} castShadow>
          <extrudeGeometry args={[resources.eave, { depth: 0.055, bevelEnabled: false }]} />
          <meshStandardMaterial color={preset.accent} roughness={0.75} />
        </mesh>
      )}
      {facades.map(({ floor, walls }) => {
        const lower = floor.elevationMm === ground;
        const color = lower ? preset.lower : preset.wall;
        const corners = new Map<
          string,
          { at: [number, number]; directions: number[]; heights: number[]; thickness: number }
        >();
        for (const { wall: w } of walls)
          for (const [index, point] of [w.startMm, w.endMm].entries()) {
            const key = point.join(','),
              value = corners.get(key) || {
                at: point,
                directions: [],
                heights: [],
                thickness: w.thicknessMm / 1000,
              };
            const range = wallHeightRanges(scene, floor, w);
            value.directions.push(Math.atan2(w.endMm[1] - w.startMm[1], w.endMm[0] - w.startMm[0]));
            value.heights.push(
              (index === 0 ? range[0] : range.at(-1))?.height || w.heightMm / 1000,
            );
            corners.set(key, value);
          }
        return (
          <group key={floor.id} position={[0, floor.elevationMm / 1000, 0]}>
            {walls.map(({ wall: w, outward }) => {
              const openings = floor.openings.filter((o) => o.wallId === w.id),
                solids = connectedWallSolids(scene, floor, w, openings),
                length = Math.hypot(w.endMm[0] - w.startMm[0], w.endMm[1] - w.startMm[1]) / 1000;
              const entrance =
                lower &&
                openings.find(
                  (o) =>
                    o.kind === 'door' &&
                    o.connects.some((id) =>
                      floor.rooms.some(
                        (r) => r.id === id && (r.type === 'living' || r.type === 'hall'),
                      ),
                    ),
                );
              return (
                <group
                  key={w.id}
                  position={[w.startMm[0] / 1000, 0, -w.startMm[1] / 1000]}
                  rotation={[
                    0,
                    Math.atan2(w.endMm[1] - w.startMm[1], w.endMm[0] - w.startMm[0]),
                    0,
                  ]}
                >
                  {solids.map((s, i) => (
                    <mesh
                      key={i}
                      position={[
                        s.x,
                        s.bottom + s.height / 2,
                        outward * (w.thicknessMm / 2000 + 0.018),
                      ]}
                      castShadow
                      receiveShadow
                    >
                      <FacadeGeometry width={s.width} height={s.height} />
                      <meshStandardMaterial
                        {...(!lower ? plasterDetail : {})}
                        color={color}
                        map={lower ? resources.facadeMap : null}
                        roughness={0.87}
                      />
                    </mesh>
                  ))}
                  {!lower && (
                    <Box
                      at={[length / 2, -SLAB_DEPTH / 2, outward * (w.thicknessMm / 2000 + 0.04)]}
                      size={[length + 0.045, SLAB_DEPTH, 0.075]}
                      color={preset.accent}
                    />
                  )}
                  {lower && (
                    <Box
                      at={[length / 2, -0.09, outward * (w.thicknessMm / 2000 + 0.015)]}
                      size={[length, 0.18, 0.04]}
                      color={preset.accent}
                    />
                  )}
                  {entrance && (
                    <Box
                      at={[
                        (entrance.offsetMm + entrance.widthMm / 2) / 1000,
                        Math.min(
                          w.heightMm / 1000 - 0.25,
                          (entrance.bottomMm + entrance.heightMm) / 1000 + 0.25,
                        ),
                        outward * (w.thicknessMm / 2000 + 0.5),
                      ]}
                      size={[entrance.widthMm / 1000 + 0.65, 0.12, 1.08]}
                      color={preset.accent}
                    />
                  )}
                </group>
              );
            })}
            {[...corners.values()]
              .filter((p) =>
                p.directions.some((a) => p.directions.some((b) => Math.abs(Math.sin(a - b)) > 0.5)),
              )
              .map((p) => {
                const height = Math.min(...p.heights);
                return (
                  <Box
                    key={p.at.join(',')}
                    at={[p.at[0] / 1000, height / 2, -p.at[1] / 1000]}
                    size={[p.thickness + 0.05, height, p.thickness + 0.05]}
                    color={preset.id === 'mediterranean' ? preset.lower : preset.accent}
                  />
                );
              })}
          </group>
        );
      })}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[
          (roof.bounds.x0 + roof.bounds.x1) / 2,
          ground / 1000 - 0.22,
          -(roof.bounds.y0 + roof.bounds.y1) / 2,
        ]}
        receiveShadow
      >
        <planeGeometry
          args={[
            Math.max(40, roof.bounds.x1 - roof.bounds.x0 + 20),
            Math.max(40, roof.bounds.y1 - roof.bounds.y0 + 20),
          ]}
        />
        <meshStandardMaterial color="#aeb79e" roughness={1} />
      </mesh>
    </>
  );
}
