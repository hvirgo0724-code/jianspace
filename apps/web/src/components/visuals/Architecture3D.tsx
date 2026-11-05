import { useMemo } from 'react';
import { Shape, DoubleSide } from 'three';
import type { Scene, Style, Room, Wall, Opening, Vec3 } from '../../types';
import { wallSolids, inside, doorPose, roomInteriorPoint } from './sceneMath';
import { useFloorTextures } from './materials';
import SurfaceMaterial from './SurfaceMaterial';
import { isOutdoor } from '../../surfaces';
import { stairPolygon } from './multiWalk';
import { slabShapes } from './slabs';
import FloorStructure3D from './FloorStructure3D';
import { wallHeightRanges, exteriorWalls } from './buildingEnvelope';
import { wallPreview, openingMetrics } from './wallPreview';

function Solid({
  position,
  size,
  color,
  metal = false,
  opacity = 1,
}: {
  position: Vec3;
  size: Vec3;
  color: string;
  metal?: boolean;
  opacity?: number;
}) {
  return (
    <mesh position={position} castShadow={opacity === 1} receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={color}
        roughness={metal ? 0.3 : 0.68}
        metalness={metal ? 0.6 : 0}
        transparent={opacity < 1}
        opacity={opacity}
        depthWrite={opacity === 1}
      />
    </mesh>
  );
}
function Portal({
  opening: o,
  wall: w,
  rooms,
  walkthrough,
  doorStates,
  onDoorToggle,
  frameColor,
}: {
  opening: Opening;
  wall: Wall;
  rooms: Room[];
  walkthrough: boolean;
  doorStates: Record<string, boolean>;
  onDoorToggle?: (id: string) => void;
  frameColor?: string;
}) {
  const { width, height: h, bottom, trim, x } = openingMetrics(o);
  if (h <= 0.01) return null;
  const pose = doorPose(o, w, rooms, walkthrough, doorStates[o.id]);
  const door = o.kind === 'door';
  const trimColor = door
    ? '#c6b59d'
    : frameColor ||
      (o.model === 'floor-to-ceiling' || o.model === 'panoramic' ? '#454d4a' : '#e8e5da');
  return (
    <group position={[x, bottom, 0]}>
      {[-1, 1].map((sign) => (
        <Solid
          key={sign}
          position={[sign * (width / 2 - trim / 2), h / 2, 0]}
          size={[trim, h, w.thicknessMm / 1000 + 0.018]}
          color={trimColor}
        />
      ))}
      <Solid
        position={[0, h - trim / 2, 0]}
        size={[width, trim, w.thicknessMm / 1000 + 0.02]}
        color={trimColor}
      />
      {door && o.model === 'archway' ? null : door ? (
        <>
          <Solid
            position={[0, 0.009, 0]}
            size={[width, 0.018, w.thicknessMm / 1000]}
            color="#8f8575"
          />
          <group
            position={[pose.hingeX - x, 0, pose.hingeZ]}
            rotation={[0, pose.angle, 0]}
            onClick={(e) => {
              if (onDoorToggle && e.delta < 6) {
                e.stopPropagation();
                onDoorToggle(o.id);
              }
            }}
          >
            <Solid
              position={[pose.centerX, (h - trim) / 2, 0]}
              size={[width - trim * 2, h - trim, 0.035]}
              color="#c8b28f"
            />
            {[-1, 1].map((sign) => (
              <group key={sign}>
                <Solid
                  position={[pose.sign * (pose.width - 0.1), Math.min(1, h * 0.5), sign * 0.035]}
                  size={[Math.min(0.11, width * 0.2), 0.018, 0.026]}
                  color="#8d897b"
                  metal
                />
                <Solid
                  position={[pose.centerX, (h - trim) * 0.55, sign * 0.019]}
                  size={[
                    Math.max(0.03, pose.width - 0.16),
                    Math.max(0.03, (h - trim) * 0.64),
                    0.003,
                  ]}
                  color="#c3ac8a"
                />
              </group>
            ))}
          </group>
        </>
      ) : (
        <>
          <Solid
            position={[0, trim / 2, 0]}
            size={[width, trim, w.thicknessMm / 1000 + 0.045]}
            color={trimColor}
          />
          {Array.from({ length: Math.max(1, Math.ceil(width / 1.25)) - 1 }, (_, i) => (
            <Solid
              key={i}
              position={[-width / 2 + ((i + 1) * width) / Math.ceil(width / 1.25), h / 2, 0]}
              size={[0.035, h, 0.075]}
              color={
                o.model === 'panoramic' || o.model === 'floor-to-ceiling' ? '#454d4a' : trimColor
              }
            />
          ))}
          {o.model === 'floor-to-ceiling' && (
            <Solid position={[0, h * 0.3, 0]} size={[width, 0.03, 0.075]} color="#454d4a" />
          )}
          <Solid
            position={[width * 0.12, h * 0.48, -w.thicknessMm / 2000 - 0.015]}
            size={[0.018, Math.min(0.12, h * 0.2), 0.035]}
            color="#8c958e"
            metal
          />
          <mesh position={[0, h / 2, 0.003]} receiveShadow>
            <planeGeometry
              args={[Math.max(0.01, width - trim * 2), Math.max(0.01, h - trim * 2)]}
            />
            <meshPhysicalMaterial
              side={DoubleSide}
              color="#d6e4e4"
              metalness={0.06}
              roughness={0.08}
              transparent
              opacity={0.28}
              transmission={0.35}
              thickness={0.008}
              envMapIntensity={1.5}
              depthWrite={false}
            />
          </mesh>
        </>
      )}
    </group>
  );
}
function WallModel({
  wall: w,
  rooms,
  openings,
  style,
  cutaway,
  direction,
  walkthrough,
  doorStates,
  onDoorToggle,
  fullScene,
  floor,
  frameColor,
}: {
  wall: Wall;
  rooms: Room[];
  openings: Opening[];
  style?: Style;
  cutaway: boolean;
  direction: Vec2Like;
  walkthrough: boolean;
  doorStates: Record<string, boolean>;
  onDoorToggle?: (id: string) => void;
  fullScene: Scene;
  floor: Scene['floors'][number];
  frameColor?: string;
}) {
  const dx = (w.endMm[0] - w.startMm[0]) / 1000,
    dy = (w.endMm[1] - w.startMm[1]) / 1000,
    length = Math.hypot(dx, dy);
  if (length < 0.001) return null;
  const adjacent = rooms.filter((r) => r.wallRefs.some((ref) => ref.wallId === w.id));
  const { solids, opacity } = wallPreview(fullScene, floor, w, openings, rooms, direction, cutaway);
  const height = w.heightMm / 1000;
  const heightRanges = wallHeightRanges(fullScene, floor, w);
  const skirtSegments = wallSolids(
    w,
    openings.filter((o) => o.bottomMm === 0),
    0.085,
  );
  const roomRange = (r: Room) => {
    const projected = r.boundaryMm.map(
      (p) => (((p[0] - w.startMm[0]) / 1000) * dx + ((p[1] - w.startMm[1]) / 1000) * dy) / length,
    );
    return [Math.max(0, Math.min(...projected)), Math.min(length, Math.max(...projected))];
  };
  return (
    <group
      position={[w.startMm[0] / 1000, 0, -w.startMm[1] / 1000]}
      rotation={[0, Math.atan2(dy, dx), 0]}
    >
      {solids.map((s, i) => (
        <Solid
          key={i}
          position={[s.x, s.bottom + s.height / 2, 0]}
          size={[s.width, s.height, w.thicknessMm / 1000]}
          color={style?.wall || '#eee9dd'}
          opacity={opacity}
        />
      ))}
      {adjacent.map((r) => {
        const side = r.wallRefs.find((ref) => ref.wallId === w.id)?.side === 'left' ? -1 : 1;
        const [low, high] = roomRange(r);
        return skirtSegments.map((s, i) => {
          const a = Math.max(low, s.x - s.width / 2),
            b = Math.min(high, s.x + s.width / 2);
          return b > a ? (
            <Solid
              key={r.id + i}
              position={[(a + b) / 2, 0.0425, side * (w.thicknessMm / 2000 + 0.009)]}
              size={[b - a, 0.085, 0.018]}
              color="#cfc7b7"
              opacity={opacity}
            />
          ) : null;
        });
      })}
      {opacity === 1 &&
        adjacent.map((r) => {
          const side = r.wallRefs.find((ref) => ref.wallId === w.id)?.side === 'left' ? -1 : 1;
          const [low, high] = roomRange(r);
          return (
            <Solid
              key={`cornice-${r.id}`}
              position={[
                (low + high) / 2,
                Math.min(
                  height,
                  r.heightMm / 1000,
                  ...heightRanges.filter((v) => v.b > low && v.a < high).map((v) => v.height),
                ) - 0.035,
                side * (w.thicknessMm / 2000 + 0.012),
              ]}
              size={[Math.max(0.001, high - low), 0.07, 0.024]}
              color="#eee9de"
            />
          );
        })}
      {openings.map((o) => (
        <Portal
          key={o.id}
          opening={o}
          wall={w}
          rooms={rooms}
          walkthrough={walkthrough}
          doorStates={doorStates}
          onDoorToggle={onDoorToggle}
          frameColor={frameColor}
        />
      ))}
    </group>
  );
}
type Vec2Like = [number, number];
export default function Architecture3D({
  scene,
  style,
  cutaway,
  roomId,
  direction,
  walkthrough = false,
  doorStates = {},
  onDoorToggle,
  fullScene,
  lightRoomId,
  exteriorFrame,
}: {
  scene: Scene;
  style?: Style;
  cutaway: boolean;
  roomId?: string;
  direction: Vec2Like;
  walkthrough?: boolean;
  doorStates?: Record<string, boolean>;
  onDoorToggle?: (id: string) => void;
  fullScene?: Scene;
  lightRoomId?: string;
  exteriorFrame?: string;
}) {
  const floor = scene.floors[0],
    rooms = roomId ? floor.rooms.filter((r) => r.id === roomId) : floor.rooms;
  const shapes = useMemo(
    () =>
      rooms.map((r) => {
        const shape = new Shape();
        r.boundaryMm.forEach(([x, y], i) =>
          i === 0 ? shape.moveTo(x / 1000, y / 1000) : shape.lineTo(x / 1000, y / 1000),
        );
        shape.closePath();
        return shape;
      }),
    [floor.rooms, roomId],
  );
  const withStairHoles = (shape: Shape, ceiling: boolean) => {
    const all = fullScene || scene;
    const cuts: [number, number][][] = [];
    for (const f of all.floors)
      for (const stair of f.stairs || []) {
        if ((ceiling && f.id !== floor.id) || (!ceiling && stair.targetFloorId !== floor.id))
          continue;
        const points = stairPolygon(
          stair.startMm.map((v) => v / 1000) as [number, number],
          stair.endMm.map((v) => v / 1000) as [number, number],
          stair.widthMm / 1000 + 0.12,
        );
        cuts.push(points);
      }
    return slabShapes(
      shape.getPoints().map((p) => [p.x, p.y]),
      cuts,
    );
  };
  const maps = useFloorTextures();
  const wallIds = new Set(rooms.flatMap((r) => r.wallRefs.map((ref) => ref.wallId)));
  const exteriorWallIds = new Set(exteriorWalls(floor).map(({ wall }) => wall.id));
  return (
    <>
      <FloorStructure3D scene={fullScene || scene} floor={floor} />
      {shapes.map((shape, i) => (
        <group key={rooms[i].id}>
          {(roomId || walkthrough) && !isOutdoor(rooms[i].type) && (
            <>
              <mesh
                rotation={[-Math.PI / 2, 0, 0]}
                position={[0, rooms[i].heightMm / 1000, 0]}
                castShadow
                receiveShadow
              >
                <shapeGeometry args={[withStairHoles(shape, true)]} />
                <meshStandardMaterial color="#f4f1e8" roughness={0.95} side={DoubleSide} />
              </mesh>
              {(() => {
                const r = rooms[i],
                  location = roomInteriorPoint(r);
                return (
                  <group
                    position={[location[0] / 1000, r.heightMm / 1000 - 0.026, -location[1] / 1000]}
                  >
                    {r.id === lightRoomId && (
                      <pointLight
                        position={[0, -0.3, 0]}
                        color="#fff1d2"
                        intensity={10}
                        distance={7}
                        decay={2}
                      />
                    )}
                    <mesh>
                      <cylinderGeometry args={[0.24, 0.24, 0.035, 32]} />
                      <meshStandardMaterial color="#d2cbbd" roughness={0.4} metalness={0.3} />
                    </mesh>
                    <mesh position={[0, -0.021, 0]}>
                      <cylinderGeometry args={[0.219, 0.219, 0.014, 32]} />
                      <meshStandardMaterial
                        color="#fff5dc"
                        emissive="#ffedc0"
                        emissiveIntensity={0.65}
                        roughness={0.45}
                      />
                    </mesh>
                  </group>
                );
              })()}
            </>
          )}
          {rooms[i].type !== 'stairwell' && (
            <>
              {isOutdoor(rooms[i].type) && (
                <mesh
                  rotation={[-Math.PI / 2, 0, 0]}
                  position={[0, -0.16, 0]}
                  castShadow
                  receiveShadow
                >
                  <extrudeGeometry
                    args={[withStairHoles(shape, false), { depth: 0.16, bevelEnabled: false }]}
                  />
                  <meshStandardMaterial color="#d0c9ba" roughness={0.85} />
                </mesh>
              )}
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]} receiveShadow>
                <shapeGeometry args={[withStairHoles(shape, false)]} />
                <SurfaceMaterial
                  id={
                    scene.layout.materials.find(
                      (m) => m.targetType === 'room_floor' && m.targetId === rooms[i].id,
                    )?.materialId
                  }
                  roomType={rooms[i].type}
                  wood={maps}
                />
              </mesh>
            </>
          )}
        </group>
      ))}
      {floor.walls
        .filter((w) => wallIds.has(w.id))
        .map((w) => (
          <WallModel
            key={w.id}
            wall={w}
            rooms={rooms}
            openings={floor.openings.filter((o) => o.wallId === w.id)}
            style={style}
            cutaway={cutaway}
            direction={direction}
            walkthrough={walkthrough}
            doorStates={doorStates}
            onDoorToggle={onDoorToggle}
            fullScene={fullScene || scene}
            floor={floor}
            frameColor={exteriorWallIds.has(w.id) ? exteriorFrame : undefined}
          />
        ))}
      {floor.obstacles
        .filter(
          (o) => !roomId || o.polygonMm.some((p) => rooms.some((r) => inside(p, r.boundaryMm))),
        )
        .map((o) => {
          const shape = new Shape();
          o.polygonMm.forEach(([x, y], i) =>
            i === 0 ? shape.moveTo(x / 1000, y / 1000) : shape.lineTo(x / 1000, y / 1000),
          );
          shape.closePath();
          return (
            <mesh
              key={o.id}
              rotation={[-Math.PI / 2, 0, 0]}
              position={[0, o.baseZMm / 1000, 0]}
              castShadow
              receiveShadow
            >
              <extrudeGeometry args={[shape, { depth: o.heightMm / 1000, bevelEnabled: false }]} />
              <meshStandardMaterial color={style?.wall || '#e7e2d7'} roughness={0.8} />
              {o.kind === 'planter' && (
                <group
                  position={[
                    o.polygonMm.reduce((sum, p) => sum + p[0], 0) / o.polygonMm.length / 1000,
                    o.polygonMm.reduce((sum, p) => sum + p[1], 0) / o.polygonMm.length / 1000,
                    -o.heightMm / 1000,
                  ]}
                  rotation={[Math.PI / 2, 0, 0]}
                >
                  {[-0.2, 0, 0.2].map((v, i) => (
                    <mesh key={i} position={[v, 0.35, (i % 2) * 0.15]} castShadow>
                      <sphereGeometry args={[0.32, 12, 10]} />
                      <meshStandardMaterial color={i % 2 ? '#5b7446' : '#78935a'} roughness={0.9} />
                    </mesh>
                  ))}
                </group>
              )}
            </mesh>
          );
        })}
    </>
  );
}
