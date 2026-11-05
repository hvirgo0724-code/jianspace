import { Component, Suspense, useEffect, useMemo, type ReactNode } from 'react';
import { useGLTF, Edges } from '@react-three/drei';
import {
  Box3,
  Mesh,
  Material,
  Light,
  Color,
  MeshStandardMaterial,
  MeshPhysicalMaterial,
  PlaneGeometry,
  DoubleSide,
  Vector2,
} from 'three';
import type { Furniture, Vec3 } from '../../types';
import { furnitureKind, modelFit, MODEL_URLS, type FurnitureKind } from './sceneMath';
import type { Palette } from './materials';
import ProjectedLabel from './ProjectedLabel';
import { Part, Cylinder } from './ModelPrimitives';
import BuiltinModels from './BuiltinModels';
import ModelBounds from './ModelBounds';

function Duvet({ palette }: { palette: Palette }) {
  const geometry = useMemo(() => {
    const g = new PlaneGeometry(0.96, 0.68, 32, 40);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        z = p.getZ(i);
      p.setY(
        i,
        0.006 * Math.sin(x * 16 + z * 3) +
          0.004 * Math.cos(z * 11 - x * 2) +
          0.0017 * Math.sin(x * 54 + z * 12),
      );
    }
    g.computeVertexNormals();
    return g;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} position={[0, 0.65, 0.12]} castShadow receiveShadow>
      <meshPhysicalMaterial
        color={palette.fabric.color}
        normalMap={palette.fabric.normalMap}
        normalScale={new Vector2(0.1, 0.1)}
        roughness={0.95}
        sheen={0.8}
        side={DoubleSide}
      />
    </mesh>
  );
}
/** Normalised local models: footprint [-.5,.5]², floor Y=0, top Y=1. */
export function ProceduralFurniture({ kind, palette }: { kind: FurnitureKind; palette: Palette }) {
  if (kind === 'bed')
    return (
      <>
        {[-1, 1].flatMap((x) =>
          [-1, 1].map((z) => (
            <Cylinder
              key={`${x}${z}`}
              at={[x * 0.4, 0.1, z * 0.4]}
              radius={0.035}
              height={0.2}
              material={palette.woodDark}
            />
          )),
        )}
        <Part
          at={[0, 0.28, 0.015]}
          size={[1, 0.2, 0.97]}
          material={palette.fabric}
          radius={0.035}
        />
        <Part
          at={[0, 0.51, 0.015]}
          size={[0.97, 0.24, 0.94]}
          material={palette.linen}
          radius={0.06}
        />
        <Part
          at={[0, 0.57, 0.13]}
          size={[0.97, 0.14, 0.7]}
          material={palette.fabric}
          radius={0.04}
        />
        <Duvet palette={palette} />
        <Part
          at={[0, 0.53, -0.465]}
          size={[1, 0.94, 0.07]}
          material={palette.fabric}
          radius={0.03}
        />
        {[-1, 1].map((x) => (
          <group key={x} position={[x * 0.237, 0.7, -0.3]} rotation={[-0.13, 0, x * 0.025]}>
            <Part
              at={[0, 0, 0]}
              size={[0.43, 0.14, 0.22]}
              material={palette.pillow}
              radius={0.055}
            />
            <Part
              at={[0, -0.025, 0.018]}
              size={[0.43, 0.009, 0.22]}
              material={palette.linen}
              radius={0.004}
            />
          </group>
        ))}
      </>
    );
  if (kind === 'wardrobe' || kind === 'bookshelf' || kind === 'cabinet') {
    const tall = kind !== 'cabinet';
    const doors = kind === 'bookshelf' ? 0 : tall ? 3 : 2;
    return (
      <>
        <Part
          at={[0, 0.08, 0]}
          size={[0.94, 0.16, 0.9]}
          material={palette.woodDark}
          radius={0.006}
        />
        {doors > 0 && (
          <Part
            at={[0, 0.55, -0.015]}
            size={[1, 0.9, 0.97]}
            material={palette.wood}
            radius={0.008}
          />
        )}
        {doors ? (
          Array.from({ length: doors }, (_, i) => (
            <group key={i} position={[(i + 0.5) / doors - 0.5, 0, 0]}>
              <Part
                at={[0, 0.55, 0.493]}
                size={[1 / doors - 0.012, 0.87, 0.014]}
                material={i % 2 ? palette.linen : palette.wood}
                radius={0.003}
              />
              <Part
                at={[1 / doors / 2 - 0.035, 0.55, 0.5]}
                size={[0.009, tall ? 0.17 : 0.06, 0.008]}
                material={palette.metal}
                radius={0.003}
              />
            </group>
          ))
        ) : (
          <>
            <Part
              at={[0, 0.55, -0.485]}
              size={[1, 0.9, 0.03]}
              material={palette.woodDark}
              radius={0.003}
            />
            {[-1, 1].map((x) => (
              <Part
                key={x}
                at={[x * 0.475, 0.55, 0]}
                size={[0.05, 0.9, 1]}
                material={palette.wood}
                radius={0.005}
              />
            ))}
            <Part at={[0, 0.985, 0]} size={[1, 0.03, 1]} material={palette.wood} radius={0.005} />
            {[0.27, 0.49, 0.71, 0.92].map((y) => (
              <Part
                key={y}
                at={[0, y, 0.06]}
                size={[0.94, 0.016, 0.9]}
                material={palette.wood}
                radius={0.003}
              />
            ))}
            {Array.from({ length: 10 }, (_, i) => (
              <Part
                key={i}
                at={[-0.38 + i * 0.075, 0.38, 0.25]}
                size={[0.05, 0.19 + (i % 3) * 0.01, 0.35]}
                material={i % 2 ? palette.linen : palette.fabric}
                radius={0.002}
              />
            ))}
          </>
        )}
      </>
    );
  }
  if (kind === 'sofa')
    return (
      <>
        {[-1, 1].flatMap((x) =>
          [-1, 1].map((z) => (
            <Cylinder
              key={`${x}${z}`}
              at={[x * 0.42, 0.09, z * 0.34]}
              radius={0.022}
              height={0.18}
              material={palette.black}
            />
          )),
        )}
        <Part at={[0, 0.3, 0]} size={[0.99, 0.22, 0.94]} material={palette.fabric} radius={0.035} />
        {[-1, 1].map((x) => (
          <Part
            key={x}
            at={[x * 0.46, 0.57, 0]}
            size={[0.08, 0.5, 1]}
            material={palette.fabric}
            radius={0.035}
          />
        ))}
        {[-1, 1].map((x) => (
          <Part
            key={x}
            at={[x * 0.213, 0.5, 0.05]}
            size={[0.417, 0.22, 0.75]}
            material={palette.fabric}
            radius={0.045}
          />
        ))}
        {[-1, 1].map((x) => (
          <Part
            key={x}
            at={[x * 0.213, 0.79, -0.36]}
            size={[0.42, 0.4, 0.18]}
            material={palette.fabric}
            radius={0.04}
            rotate={[-0.1, 0, 0]}
          />
        ))}
      </>
    );
  if (kind === 'chair')
    return (
      <>
        {[-1, 1].flatMap((x) =>
          [-1, 1].map((z) => (
            <Cylinder
              key={`${x}${z}`}
              at={[x * 0.37, 0.23, z * 0.35]}
              radius={0.032}
              height={0.46}
              material={palette.wood}
            />
          )),
        )}
        <Part at={[0, 0.5, 0]} size={[1, 0.16, 0.97]} material={palette.fabric} radius={0.05} />
        <Part
          at={[0, 0.77, -0.41]}
          size={[1, 0.45, 0.18]}
          material={palette.fabric}
          radius={0.06}
        />
      </>
    );
  return (
    <>
      <Part at={[0, 0.95, 0]} size={[1, 0.1, 1]} material={palette.wood} radius={0.025} />
      {[-1, 1].flatMap((x) =>
        [-1, 1].map((z) => (
          <Cylinder
            key={`${x}${z}`}
            at={[x * 0.39, 0.45, z * 0.35]}
            radius={0.025}
            height={0.9}
            material={palette.woodDark}
          />
        )),
      )}
      <Part at={[0, 0.86, 0]} size={[0.85, 0.07, 0.8]} material={palette.woodDark} radius={0.01} />
    </>
  );
}
class AssetBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; onFailure: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFailure();
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
function LoadedModel({
  url,
  dimensions,
  accent,
  tint,
}: {
  url: string;
  dimensions: Vec3;
  accent: string;
  tint: boolean;
}) {
  const loaded = useGLTF(url, false, false);
  const { object, fit, materials } = useMemo(() => {
    const object = loaded.scene.clone(true);
    const materials: Material[] = [];
    const lights: Light[] = [];
    object.traverse((node) => {
      if (node instanceof Light) lights.push(node);
      if (node instanceof Mesh) {
        node.castShadow = true;
        node.receiveShadow = true;
        const customize = (original: Material) => {
          const mat = original.clone();
          materials.push(mat);
          if (tint && mat instanceof MeshStandardMaterial && /fabric|velvet/i.test(mat.name)) {
            mat.color.set(accent);
            if (mat instanceof MeshPhysicalMaterial) {
              mat.sheenColor = new Color(accent).lerp(new Color('#eee3d0'), 0.4);
              mat.sheen = 0.8;
              mat.sheenRoughness = 0.7;
            }
          }
          return mat;
        };
        node.material = Array.isArray(node.material)
          ? node.material.map(customize)
          : customize(node.material);
      }
    });
    lights.forEach((l) => l.removeFromParent());
    object.updateMatrixWorld(true);
    const box = new Box3().setFromObject(object, true);
    return {
      object,
      materials,
      fit: modelFit(box.min.toArray() as Vec3, box.max.toArray() as Vec3, dimensions),
    };
  }, [loaded.scene, ...dimensions, accent, tint]);
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);
  return (
    <group scale={fit.scale} dispose={null}>
      <group position={fit.offset}>
        <primitive object={object} dispose={null} />
      </group>
    </group>
  );
}
export default function Furniture3D({
  f,
  name,
  modelAssetId,
  palette,
  selected,
  showDimensions,
  onSelect,
  onAssetFailure,
}: {
  f: Furniture;
  name: string;
  modelAssetId?: string | null;
  palette: Palette;
  selected: boolean;
  showDimensions: boolean;
  onSelect?: (id: string) => void;
  onAssetFailure: () => void;
}) {
  const kind = furnitureKind(name, modelAssetId),
    [w, d, h] = f.sizeMm.map((v) => Math.max(0.001, v / 1000));
  const url =
    kind === 'sofa'
      ? w < 2
        ? MODEL_URLS['sofa-compact']
        : MODEL_URLS.sofa
      : kind === 'chair'
        ? MODEL_URLS.chair
        : kind === 'coffee-table'
          ? MODEL_URLS['coffee-table']
          : kind === 'table' && /餐桌|dining/i.test(name)
            ? MODEL_URLS['dining-table']
            : kind === 'cabinet' && h < 1.3 && w > d
              ? MODEL_URLS.cabinet
              : null;
  const sideways = (kind === 'wardrobe' || kind === 'bookshelf') && d > w;
  const procedural = (
    <group scale={sideways ? [d, h, w] : [w, h, d]} rotation={[0, sideways ? -Math.PI / 2 : 0, 0]}>
      {[
        'sofa',
        'bed',
        'coffee-table',
        'table',
        'chair',
        'wardrobe',
        'cabinet',
        'bookshelf',
      ].includes(kind) ? (
        <ProceduralFurniture kind={kind} palette={palette} />
      ) : (
        <ModelBounds signature={kind} dimensions={[w, h, d]}>
          <BuiltinModels kind={kind} palette={palette} dimensions={[w, h, d]} />
        </ModelBounds>
      )}
    </group>
  );
  return (
    <group
      position={[f.positionMm[0] / 1000, f.positionMm[2] / 1000, -f.positionMm[1] / 1000]}
      rotation={[0, (f.rotationDeg * Math.PI) / 180, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.(f.id);
      }}
    >
      {url ? (
        <AssetBoundary key={url} fallback={procedural} onFailure={onAssetFailure}>
          <Suspense fallback={procedural}>
            <LoadedModel
              url={url}
              dimensions={[w, h, d]}
              accent={palette.fabric.color.getStyle()}
              tint={kind === 'sofa' || kind === 'chair'}
            />
          </Suspense>
        </AssetBoundary>
      ) : (
        procedural
      )}
      {selected && (
        <mesh position={[0, h / 2, 0]}>
          <boxGeometry args={[w + 0.015, h + 0.015, d + 0.015]} />
          <meshBasicMaterial visible={false} />
          <Edges color="#7a9860" lineWidth={1} />
        </mesh>
      )}
      {selected && showDimensions && (
        <ProjectedLabel
          position={[0, h + 0.18, 0]}
          name={name}
          size={`${f.sizeMm.join(' × ')} mm`}
        />
      )}
    </group>
  );
}
