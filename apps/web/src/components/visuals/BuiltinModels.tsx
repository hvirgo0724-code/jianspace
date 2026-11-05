import type { Material } from 'three';
import type { Vec3 } from '../../types';
import type { FurnitureKind } from '../../catalog';
import type { Palette } from './materials';
import { Part, Cylinder } from './ModelPrimitives';

function Disc({ at, size, material }: { at: Vec3; size: Vec3; material: Material }) {
  return (
    <mesh
      position={at}
      rotation={[Math.PI / 2, 0, 0]}
      scale={[size[0], size[2], size[1]]}
      material={material}
      castShadow
      receiveShadow
    >
      <cylinderGeometry args={[0.5, 0.5, 1, 40]} />
    </mesh>
  );
}
function Orb({
  at,
  size,
  material,
  rotation = [0, 0, 0],
}: {
  at: Vec3;
  size: Vec3;
  material: Material;
  rotation?: Vec3;
}) {
  return (
    <mesh
      position={at}
      scale={size}
      rotation={rotation}
      material={material}
      castShadow
      receiveShadow
    >
      <sphereGeometry args={[0.5, 20, 12]} />
    </mesh>
  );
}
function Feet({ palette, height = 0.15 }: { palette: Palette; height?: number }) {
  return (
    <>
      {[-1, 1].flatMap((x) =>
        [-1, 1].map((z) => (
          <Part
            key={`${x}:${z}`}
            at={[x * 0.4, height / 2, z * 0.38]}
            size={[0.055, height, 0.055]}
            material={palette.woodDark}
            radius={0.008}
          />
        )),
      )}
    </>
  );
}
function CaseBody({ palette }: { palette: Palette }) {
  return (
    <>
      <Part at={[0, 0.52, -0.05]} size={[1, 0.96, 0.9]} material={palette.enamel} radius={0.035} />
      {[-1, 1].flatMap((x) =>
        [-1, 1].map((z) => (
          <Part
            key={`${x}:${z}`}
            at={[x * 0.4, 0.025, z * 0.36]}
            size={[0.08, 0.05, 0.1]}
            material={palette.rubber}
            radius={0.012}
          />
        )),
      )}
    </>
  );
}
function DrawerUnit({
  palette,
  doors = false,
  kitchen = false,
}: {
  palette: Palette;
  doors?: boolean;
  kitchen?: boolean;
}) {
  return (
    <>
      <Part
        at={[0, 0.5, -0.025]}
        size={[1, 0.94, 0.95]}
        material={kitchen ? palette.enamel : palette.wood}
        radius={0.012}
      />
      <Part
        at={[0, 0.025, 0]}
        size={[0.92, 0.05, 0.86]}
        material={palette.woodDark}
        radius={0.006}
      />
      {doors
        ? [-1, 1].map((x) => (
            <group key={x}>
              <Part
                at={[x * 0.25, 0.5, 0.465]}
                size={[0.486, 0.86, 0.05]}
                material={kitchen ? palette.linen : palette.wood}
                radius={0.006}
              />
              <Part
                at={[x * 0.055, 0.62, 0.494]}
                size={[0.014, 0.19, 0.012]}
                material={palette.steel}
                radius={0.004}
              />
            </group>
          ))
        : Array.from({ length: 5 }, (_, i) => (
            <group key={i}>
              <Part
                at={[0, 0.13 + i * 0.175, 0.465]}
                size={[0.96, 0.16, 0.05]}
                material={palette.wood}
                radius={0.005}
              />
              <Part
                at={[0, 0.13 + i * 0.175, 0.494]}
                size={[0.25, 0.018, 0.012]}
                material={palette.steel}
                radius={0.003}
              />
            </group>
          ))}
      <Part
        at={[0, 0.985, 0]}
        size={[1, 0.03, 1]}
        material={kitchen ? palette.ceramic : palette.wood}
        radius={0.01}
      />
    </>
  );
}
function Mirror({ palette, at, size }: { palette: Palette; at: Vec3; size: Vec3 }) {
  return (
    <group position={at}>
      <Part at={[0, 0, 0]} size={size} material={palette.wood} radius={0.025} />
      <Part
        at={[0, 0, size[2] / 2 + 0.003]}
        size={[size[0] - 0.05, size[1] - 0.04, 0.006]}
        material={palette.steel}
        radius={0.018}
      />
    </group>
  );
}
function Sink({ palette, y }: { palette: Palette; y: number }) {
  return (
    <>
      <mesh position={[0, y, 0.03]} scale={[0.7, 0.012, 0.55]}>
        <cylinderGeometry args={[0.5, 0.5, 1, 40]} />
        <meshStandardMaterial color="#667d7a" roughness={0.3} metalness={0.5} />
      </mesh>
      <mesh
        position={[0, y + 0.005, 0.03]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[0.7, 0.55, 1]}
        material={palette.steel}
      >
        <torusGeometry args={[0.49, 0.025, 8, 40]} />
      </mesh>
      <Part
        at={[0, y + 0.105, -0.32]}
        size={[0.025, 0.21, 0.025]}
        material={palette.steel}
        radius={0.008}
      />
      <Part
        at={[0, y + 0.2, -0.24]}
        size={[0.025, 0.025, 0.18]}
        material={palette.steel}
        radius={0.008}
      />
    </>
  );
}

/** Authored generic models. Normalised units are scaled by the user's measured dimensions. */
export default function BuiltinModels({
  kind,
  palette: p,
  dimensions,
}: {
  kind: FurnitureKind;
  palette: Palette;
  dimensions: Vec3;
}) {
  if (kind === 'refrigerator')
    return (
      <>
        <CaseBody palette={p} />
        {[-1, 1].map((x) => (
          <group key={x}>
            <Part
              at={[x * 0.25, 0.65, 0.44]}
              size={[0.487, 0.67, 0.07]}
              material={p.enamel}
              radius={0.018}
            />
            <Part
              at={[x * 0.052, 0.64, 0.49]}
              size={[0.018, 0.26, 0.018]}
              material={p.steel}
              radius={0.006}
            />
          </group>
        ))}
        <Part at={[0, 0.19, 0.44]} size={[0.987, 0.24, 0.07]} material={p.enamel} radius={0.014} />
        <Part at={[0, 0.28, 0.49]} size={[0.46, 0.012, 0.018]} material={p.steel} radius={0.003} />
        <Part
          at={[-0.23, 0.83, 0.48]}
          size={[0.16, 0.07, 0.012]}
          material={p.screen}
          radius={0.006}
        />
      </>
    );
  if (kind === 'washing-machine' || kind === 'dryer') {
    const diameterY = (0.64 * dimensions[0]) / dimensions[1];
    return (
      <>
        <CaseBody palette={p} />
        <Part at={[0, 0.89, 0.445]} size={[0.96, 0.14, 0.07]} material={p.enamel} radius={0.01} />
        <Disc
          at={[-0.26, 0.89, 0.49]}
          size={[0.095, (0.095 * dimensions[0]) / dimensions[1], 0.018]}
          material={p.steel}
        />
        <Part
          at={[0.22, 0.89, 0.485]}
          size={[0.25, 0.055, 0.018]}
          material={p.screen}
          radius={0.005}
        />
        <Disc
          at={[0, 0.45, 0.435]}
          size={[0.74, (0.74 * dimensions[0]) / dimensions[1], 0.08]}
          material={p.steel}
        />
        <Disc
          at={[0, 0.45, 0.48]}
          size={[0.67, (0.67 * dimensions[0]) / dimensions[1], 0.025]}
          material={p.rubber}
        />
        <Disc at={[0, 0.45, 0.496]} size={[0.59, diameterY * 0.92, 0.006]} material={p.screen} />
        <Part
          at={[0.29, 0.47, 0.49]}
          size={[0.035, 0.12, 0.018]}
          material={p.enamel}
          radius={0.009}
        />
        <Part
          at={[-0.28, 0.11, 0.45]}
          size={[0.18, 0.065, 0.02]}
          material={p.enamel}
          radius={0.01}
        />
        {kind === 'dryer' &&
          [0, 1, 2].map((i) => (
            <Part
              key={i}
              at={[-0.34 + i * 0.12, 0.77, 0.483]}
              size={[0.075, 0.008, 0.008]}
              material={p.steel}
              radius={0.002}
            />
          ))}
      </>
    );
  }
  if (kind === 'dishwasher' || kind === 'oven' || kind === 'microwave')
    return (
      <>
        <CaseBody palette={p} />
        <Part
          at={[0, 0.46, 0.442]}
          size={[0.97, 0.8, 0.075]}
          material={kind === 'dishwasher' ? p.steel : p.screen}
          radius={0.02}
        />
        {kind !== 'dishwasher' && (
          <Part
            at={[kind === 'microwave' ? -0.1 : 0, 0.44, 0.483]}
            size={[kind === 'microwave' ? 0.63 : 0.78, 0.52, 0.012]}
            material={p.black}
            radius={0.024}
          />
        )}
        <Part at={[0, 0.83, 0.49]} size={[0.66, 0.025, 0.019]} material={p.steel} radius={0.008} />
        <Part
          at={[0.18, 0.93, 0.456]}
          size={[0.28, 0.055, 0.07]}
          material={p.screen}
          radius={0.004}
        />
        {[-1, 1].map((x) => (
          <Disc
            key={x}
            at={[x * 0.33, 0.93, 0.495]}
            size={[0.08, (0.08 * dimensions[0]) / dimensions[1], 0.009]}
            material={p.steel}
          />
        ))}
      </>
    );
  if (kind === 'cooktop')
    return (
      <>
        <Part at={[0, 0.31, 0]} size={[1, 0.62, 1]} material={p.black} radius={0.03} />
        {[-1, 1].map((x) => (
          <group key={x} position={[x * 0.27, 0.7, -0.02]}>
            <mesh scale={[0.34, 0.12, 0.55]} material={p.steel}>
              <cylinderGeometry args={[0.5, 0.5, 1, 24]} />
            </mesh>
            {[0, Math.PI / 2].map((a) => (
              <Part
                key={a}
                at={[0, 0.08, 0]}
                size={[0.43, 0.08, 0.045]}
                rotate={[0, a, 0]}
                material={p.rubber}
                radius={0.008}
              />
            ))}
          </group>
        ))}
        {[-1, 1].map((x) => (
          <Cylinder
            key={x}
            at={[x * 0.12, 0.91, 0.36]}
            radius={0.045}
            height={0.18}
            material={p.steel}
          />
        ))}
      </>
    );
  if (kind === 'range-hood')
    return (
      <>
        <Part at={[0, 0.21, 0]} size={[1, 0.32, 1]} material={p.steel} radius={0.04} />
        <Part at={[0, 0.66, -0.25]} size={[0.36, 0.68, 0.5]} material={p.steel} radius={0.01} />
        <Part at={[0, 0.37, 0.31]} size={[0.88, 0.03, 0.28]} material={p.screen} radius={0.01} />
        {[-1, 1].map((x) => (
          <Part
            key={x}
            at={[x * 0.33, 0.04, 0.18]}
            size={[0.09, 0.02, 0.09]}
            material={p.glow}
            radius={0.02}
          />
        ))}
      </>
    );
  if (kind === 'wall-ac')
    return (
      <>
        <Part at={[0, 0.5, -0.02]} size={[1, 1, 0.96]} material={p.enamel} radius={0.09} />
        <Part at={[0, 0.21, 0.473]} size={[0.89, 0.21, 0.045]} material={p.rubber} radius={0.035} />
        {[0, 1, 2].map((i) => (
          <Part
            key={i}
            at={[0, 0.17 + i * 0.055, 0.497]}
            size={[0.86, 0.023, 0.006]}
            material={p.enamel}
            radius={0.003}
          />
        ))}
        <Part
          at={[0.32, 0.56, 0.465]}
          size={[0.09, 0.06, 0.05]}
          material={p.screen}
          radius={0.012}
        />
      </>
    );
  if (kind === 'floor-ac' || kind === 'air-purifier')
    return (
      <>
        <Part at={[0, 0.5, 0]} size={[1, 1, 1]} material={p.enamel} radius={0.12} />
        <Part at={[0, 0.64, 0.465]} size={[0.65, 0.53, 0.05]} material={p.rubber} radius={0.05} />
        {Array.from({ length: kind === 'floor-ac' ? 10 : 14 }, (_, i) => (
          <Part
            key={i}
            at={[0, 0.41 + i * (kind === 'floor-ac' ? 0.046 : 0.033), 0.497]}
            size={[0.61, 0.012, 0.006]}
            material={p.steel}
            radius={0.002}
          />
        ))}
        <Part at={[0, 0.93, 0.45]} size={[0.26, 0.038, 0.06]} material={p.screen} radius={0.01} />
      </>
    );
  if (kind === 'television')
    return (
      <>
        <Part at={[0, 0.59, -0.24]} size={[1, 0.82, 0.08]} material={p.black} radius={0.018} />
        <Part
          at={[0, 0.59, -0.193]}
          size={[0.95, 0.75, 0.012]}
          material={p.screen}
          radius={0.008}
        />
        <Part at={[0, 0.13, -0.24]} size={[0.065, 0.2, 0.08]} material={p.steel} radius={0.01} />
        <Part at={[0, 0.025, 0]} size={[0.6, 0.05, 1]} material={p.black} radius={0.02} />
        <Part
          at={[0.4, 0.2, -0.188]}
          size={[0.012, 0.009, 0.006]}
          material={p.glow}
          radius={0.003}
        />
      </>
    );
  if (kind === 'chest' || kind === 'shoe-cabinet' || kind === 'kitchen-cabinet')
    return <DrawerUnit palette={p} doors={kind !== 'chest'} kitchen={kind === 'kitchen-cabinet'} />;
  if (kind === 'sink-cabinet' || kind === 'vanity') {
    const h = kind === 'vanity' ? 0.46 : 0.74;
    return (
      <>
        <group scale={[1, h, 1]}>
          <DrawerUnit palette={p} doors kitchen />
        </group>
        <Sink palette={p} y={h + 0.01} />
        {kind === 'vanity' && (
          <Mirror palette={p} at={[0, 0.81, -0.46]} size={[0.95, 0.38, 0.065]} />
        )}
      </>
    );
  }
  if (kind === 'toilet')
    return (
      <>
        <Part at={[0, 0.72, -0.29]} size={[0.74, 0.56, 0.42]} material={p.ceramic} radius={0.08} />
        <Part at={[0, 0.23, 0.12]} size={[0.53, 0.46, 0.65]} material={p.ceramic} radius={0.1} />
        <Orb at={[0, 0.42, 0.14]} size={[1, 0.3, 0.72]} material={p.ceramic} />
        <mesh position={[0, 0.568, 0.14]} scale={[0.77, 0.009, 0.56]} material={p.screen}>
          <cylinderGeometry args={[0.5, 0.5, 1, 40]} />
        </mesh>
        <mesh
          position={[0, 0.575, 0.14]}
          rotation={[Math.PI / 2, 0, 0]}
          scale={[0.85, 0.64, 1]}
          material={p.ceramic}
        >
          <torusGeometry args={[0.44, 0.065, 12, 40]} />
        </mesh>
        <Part at={[0, 0.99, -0.29]} size={[0.17, 0.02, 0.11]} material={p.steel} radius={0.02} />
      </>
    );
  if (kind === 'bathtub')
    return (
      <>
        <Part at={[0, 0.49, 0]} size={[1, 0.98, 1]} material={p.ceramic} radius={0.16} />
        <mesh position={[0, 0.973, 0]} scale={[0.87, 0.012, 0.78]} material={p.screen}>
          <cylinderGeometry args={[0.5, 0.5, 1, 48]} />
        </mesh>
        <mesh
          position={[0, 0.985, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          scale={[0.92, 0.85, 1]}
          material={p.ceramic}
        >
          <torusGeometry args={[0.47, 0.035, 12, 48]} />
        </mesh>
      </>
    );
  if (kind === 'shower')
    return (
      <>
        <Part at={[0, 0.025, 0]} size={[1, 0.05, 1]} material={p.ceramic} radius={0.02} />
        {[-1, 1].flatMap((x) =>
          [-1, 1].map((z) => (
            <Part
              key={`${x}:${z}`}
              at={[x * 0.48, 0.52, z * 0.48]}
              size={[0.025, 0.96, 0.025]}
              material={p.steel}
              radius={0.005}
            />
          )),
        )}
        <Part at={[0, 0.52, 0.482]} size={[0.94, 0.94, 0.008]} material={p.glass} radius={0.001} />
        <Part at={[0.482, 0.52, 0]} size={[0.008, 0.94, 0.94]} material={p.glass} radius={0.001} />
        <Part at={[-0.482, 0.52, 0]} size={[0.008, 0.94, 0.94]} material={p.glass} radius={0.001} />
        <Part
          at={[0.16, 0.5, 0.495]}
          size={[0.014, 0.13, 0.01]}
          material={p.steel}
          radius={0.004}
        />
        <Part at={[0, 0.7, -0.46]} size={[0.025, 0.49, 0.025]} material={p.steel} radius={0.006} />
        <Part at={[0, 0.935, -0.37]} size={[0.14, 0.018, 0.2]} material={p.steel} radius={0.035} />
      </>
    );
  if (kind === 'round-table')
    return (
      <>
        <mesh position={[0, 0.95, 0]} material={p.wood} castShadow receiveShadow>
          <cylinderGeometry args={[0.5, 0.5, 0.1, 48]} />
        </mesh>
        {[-1, 1].flatMap((x) =>
          [-1, 1].map((z) => (
            <Part
              key={`${x}:${z}`}
              at={[x * 0.27, 0.45, z * 0.27]}
              size={[0.045, 0.9, 0.045]}
              material={p.woodDark}
              radius={0.008}
            />
          )),
        )}
      </>
    );
  if (kind === 'dining-chair' || kind === 'bar-stool') {
    const y = kind === 'bar-stool' ? 0.72 : 0.49;
    return (
      <>
        <Feet palette={p} height={y - 0.045} />
        <Part at={[0, y, 0]} size={[1, 0.09, 0.93]} material={p.fabric} radius={0.06} />
        <Part
          at={[0, (y + 1) / 2, -0.425]}
          size={[0.94, 1 - y, 0.15]}
          material={p.wood}
          radius={0.04}
        />
        {kind === 'bar-stool' && (
          <Part at={[0, 0.3, 0.36]} size={[0.81, 0.025, 0.025]} material={p.steel} radius={0.005} />
        )}
      </>
    );
  }
  if (kind === 'ottoman' || kind === 'bench')
    return (
      <>
        <Feet palette={p} height={0.24} />
        <Part at={[0, 0.58, 0]} size={[1, 0.68, 1]} material={p.fabric} radius={0.12} />
        <Part at={[0, 0.94, 0]} size={[0.96, 0.12, 0.96]} material={p.linen} radius={0.055} />
      </>
    );
  if (kind === 'chaise-sofa')
    return (
      <>
        <Feet palette={p} height={0.17} />
        <Part at={[0, 0.3, -0.19]} size={[1, 0.26, 0.62]} material={p.fabric} radius={0.04} />
        <Part at={[-0.31, 0.34, 0.15]} size={[0.38, 0.34, 0.7]} material={p.fabric} radius={0.07} />
        <Part at={[0, 0.74, -0.42]} size={[1, 0.52, 0.16]} material={p.fabric} radius={0.07} />
        {[-1, 1].map((x) => (
          <Part
            key={x}
            at={[x * 0.46, 0.52, -0.2]}
            size={[0.08, 0.55, 0.6]}
            material={p.fabric}
            radius={0.035}
          />
        ))}
        {[-0.2, 0.2].map((x) => (
          <Part
            key={x}
            at={[x, 0.5, -0.16]}
            size={[0.38, 0.16, 0.51]}
            material={p.linen}
            radius={0.04}
          />
        ))}
      </>
    );
  if (kind === 'dressing-table')
    return (
      <>
        <Feet palette={p} height={0.42} />
        <Part at={[0, 0.46, 0]} size={[1, 0.1, 1]} material={p.wood} radius={0.018} />
        <Part at={[0, 0.39, 0.43]} size={[0.8, 0.1, 0.1]} material={p.wood} radius={0.012} />
        <Part at={[0, 0.39, 0.495]} size={[0.17, 0.012, 0.009]} material={p.steel} radius={0.003} />
        <Mirror palette={p} at={[0, 0.78, -0.46]} size={[0.78, 0.44, 0.07]} />
      </>
    );
  if (kind === 'floor-lamp' || kind === 'table-lamp')
    return (
      <>
        <mesh position={[0, 0.025, 0]} material={p.steel} castShadow>
          <cylinderGeometry args={[0.33, 0.35, 0.05, 32]} />
        </mesh>
        <Cylinder at={[0, 0.42, 0]} radius={0.022} height={0.8} material={p.steel} />
        <mesh position={[0, 0.86, 0]} material={p.linen} castShadow>
          <cylinderGeometry args={[0.31, 0.5, 0.28, 40, 1, true]} />
        </mesh>
        <mesh position={[0, 0.73, 0]} material={p.glow}>
          <cylinderGeometry args={[0.47, 0.47, 0.012, 32]} />
        </mesh>
      </>
    );
  if (kind === 'plant')
    return (
      <>
        <mesh position={[0, 0.16, 0]} material={p.ceramic} castShadow receiveShadow>
          <cylinderGeometry args={[0.3, 0.23, 0.32, 32]} />
        </mesh>
        <mesh position={[0, 0.323, 0]} material={p.woodDark}>
          <cylinderGeometry args={[0.27, 0.27, 0.008, 24]} />
        </mesh>
        <Cylinder at={[0, 0.6, 0]} radius={0.018} height={0.56} material={p.woodDark} />
        {Array.from({ length: 9 }, (_, i) => {
          const a = i * 2.4,
            y = 0.44 + (i % 4) * 0.145;
          return (
            <Orb
              key={i}
              at={[Math.cos(a) * 0.19, y, Math.sin(a) * 0.19]}
              size={[0.43, 0.12, 0.22]}
              material={p.leaf}
              rotation={[0.2, a, 0.28]}
            />
          );
        })}
      </>
    );
  return null;
}
