import {
  Suspense,
  Component,
  useMemo,
  useRef,
  useState,
  useEffect,
  useCallback,
  memo,
  type ReactNode,
  type ComponentRef,
  type RefObject,
} from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, useProgress } from '@react-three/drei';
import {
  ACESFilmicToneMapping,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Vector3,
  type Camera,
  type WebGLRenderer,
} from 'three';
import {
  House,
  Eye,
  Footprints,
  Maximize2,
  Minimize2,
  Ruler,
  RotateCcw,
  Info,
  Layers,
  LoaderCircle,
  Camera as CameraIcon,
  X,
  RotateCw,
  Scan,
} from 'lucide-react';
import type { Scene, Style, Vec2, Vec3, SceneCapture } from '../types';
import { bounds, activeFloor, floorScene } from '../scene';
import Stairs3D from './visuals/Stairs3D';
import Exterior3D from './visuals/Exterior3D';
import Plan2D from './Plan2D';
import Furniture3D from './visuals/Furniture3D';
import Architecture3D from './visuals/Architecture3D';
import { roomCamera, inside as insideWalk } from './visuals/sceneMath';
import { usePalette } from './visuals/materials';
import WalkControls, { type WalkInput, type WalkLocation } from './visuals/WalkControls';
import WalkHUD from './visuals/WalkHUD';
import { buildMultiWorld, canStandMulti } from './visuals/multiWalk';
import { EXTERIOR_STYLES, exteriorStyle, type ExteriorStyleId } from '../exteriorStyles';
import Lighting3D, { LIGHTING_PRESETS, type LightingId } from './visuals/Lighting3D';
import RenderEffects3D from './visuals/RenderEffects3D';
import { overviewCamera, type CameraView } from './visuals/cameraViews';

class Boundary extends Component<
  { children: ReactNode; fallback: ReactNode; onFailure?: () => void },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  componentDidCatch() {
    this.props.onFailure?.();
  }
  render() {
    return this.state.error ? this.props.fallback : this.props.children;
  }
}
type Controls = ComponentRef<typeof OrbitControls>;
function CameraPose({
  pose,
  controls,
  reset,
  fitWidth,
}: {
  pose: { position: Vec3; target: Vec3; fov: number };
  controls: RefObject<Controls | null>;
  reset: number;
  fitWidth: boolean;
}) {
  const { camera, invalidate, size } = useThree();
  const aspect = size.width / Math.max(size.height, 1);
  const signature = JSON.stringify(pose);
  useEffect(() => {
    const next = JSON.parse(signature) as typeof pose;
    const distanceScale = fitWidth ? Math.max(1, 1.2 / Math.max(aspect, 0.25)) : 1;
    camera.position
      .set(...next.position)
      .sub(new Vector3(...next.target))
      .multiplyScalar(distanceScale)
      .add(new Vector3(...next.target));
    if (camera instanceof PerspectiveCamera) {
      camera.fov = next.fov;
      camera.updateProjectionMatrix();
    }
    if (controls.current) {
      controls.current.target.set(...next.target);
      controls.current.update();
    }
    camera.lookAt(...next.target);
    invalidate();
  }, [camera, controls, signature, reset, invalidate, aspect, fitWidth]);
  return null;
}
const RoomModel = memo(function RoomModel({
  scene,
  style,
  roomId,
  selectedId,
  showDimensions,
  onSelect,
  onAssetFailure,
  cutaway,
  direction,
  walkthrough,
  doorStates,
  onDoorToggle,
  fullScene,
  lightRoomId,
  exteriorFrame,
}: {
  scene: Scene;
  style?: Style;
  roomId?: string;
  selectedId?: string | null;
  showDimensions: boolean;
  onSelect?: (id: string) => void;
  onAssetFailure: () => void;
  cutaway: boolean;
  direction: [number, number];
  walkthrough: boolean;
  doorStates: Record<string, boolean>;
  onDoorToggle?: (id: string) => void;
  fullScene: Scene;
  lightRoomId?: string;
  exteriorFrame?: string;
}) {
  const palette = usePalette(style?.accent || '#a3ac8c'),
    catalog = new Map(scene.layout.catalogSnapshot.map((c) => [c.skuId, c]));
  return (
    <>
      <Architecture3D
        scene={scene}
        style={style}
        cutaway={cutaway}
        roomId={roomId}
        direction={direction}
        walkthrough={walkthrough}
        doorStates={doorStates}
        onDoorToggle={onDoorToggle}
        fullScene={fullScene}
        lightRoomId={lightRoomId}
        exteriorFrame={exteriorFrame}
      />
      {scene.layout.furniture
        .filter((f) => !roomId || f.roomId === roomId)
        .map((f) => (
          <Furniture3D
            key={f.id}
            f={f}
            name={catalog.get(f.skuId)?.name || ''}
            modelAssetId={catalog.get(f.skuId)?.modelAssetId}
            palette={palette}
            selected={selectedId === f.id}
            showDimensions={showDimensions}
            onSelect={onSelect}
            onAssetFailure={onAssetFailure}
          />
        ))}
    </>
  );
});
function LoadingStatus() {
  const { active, progress } = useProgress();
  return active ? (
    <div className="view3d-loading" role="status">
      <LoaderCircle size={13} className="spin" />
      加载模型与材质 {Math.round(progress)}%
    </div>
  ) : null;
}

export default function Scene3D({
  scene: sourceScene,
  style,
  onSelect,
  cutaway = true,
  roomId,
  selectedId,
  onRoomChange,
  floorId,
  onFloorChange,
  onCaptureReference,
  onExteriorChange,
  onCutawayChange,
}: {
  scene: Scene;
  style?: Style;
  onSelect?: (id: string) => void;
  cutaway?: boolean;
  roomId?: string;
  selectedId?: string | null;
  onRoomChange?: (roomId: string) => void;
  floorId?: string;
  onFloorChange?: (floorId: string) => void;
  onCaptureReference?: (capture: SceneCapture) => Promise<void>;
  onExteriorChange?: (styleId: ExteriorStyleId) => void;
  onCutawayChange?: (value: boolean) => void;
}) {
  const [seeThroughWalls, setSeeThroughWalls] = useState(cutaway);
  useEffect(() => setSeeThroughWalls(cutaway), [cutaway]);
  const [exteriorId, setExteriorId] = useState<ExteriorStyleId>(
    sourceScene.layout.exterior?.styleId || 'modern',
  );
  useEffect(() => {
    setExteriorId(sourceScene.layout.exterior?.styleId || 'modern');
  }, [sourceScene.layout.exterior?.styleId]);
  const facade = exteriorStyle(exteriorId);
  const [previewFloor, setPreviewFloor] = useState(sourceScene.floors[0].id);
  const [doorStates, setDoorStates] = useState<Record<string, boolean>>({});
  const [doorPanel, setDoorPanel] = useState(false);
  const [walkEntry, setWalkEntry] = useState<{ point: Vec2; floorId: string; yaw: number } | null>(
    null,
  );
  const floor = activeFloor(sourceScene, floorId || previewFloor);
  const scene = useMemo(() => floorScene(sourceScene, floor.id), [sourceScene, floor.id]);
  const floorScenes = useMemo(
    () => sourceScene.floors.map((f) => ({ floor: f, scene: floorScene(sourceScene, f.id) })),
    [sourceScene],
  );
  const [mode, setMode] = useState<'overview' | 'room' | 'walk' | 'building' | 'exterior'>(
      'overview',
    ),
    [currentRoom, setRoom] = useState(roomId || scene.floors[0].rooms[0].id),
    [quality, setQuality] = useState<'high' | 'balanced'>(() =>
      window.matchMedia('(max-width: 700px)').matches ? 'balanced' : 'high',
    ),
    [showDimensions, setDimensions] = useState(true),
    [credits, setCredits] = useState(false),
    [assetFailed, setAssetFailed] = useState(false),
    [reset, setReset] = useState(0),
    [azimuth, setAzimuth] = useState(Math.PI / 4),
    [walkActive, setWalkActive] = useState(false),
    [walkLocation, setWalkLocation] = useState<WalkLocation | null>(null),
    [expanded, setExpanded] = useState(false),
    [captureBusy, setCaptureBusy] = useState(false),
    [captureError, setCaptureError] = useState('');
  const [lightingPanel, setLightingPanel] = useState(false);
  const [cameraView, setCameraView] = useState<CameraView>('perspective');
  const [autoRotate, setAutoRotate] = useState(false);
  useEffect(() => {
    const pause = () => {
      if (document.hidden) setAutoRotate(false);
    };
    document.addEventListener('visibilitychange', pause);
    return () => document.removeEventListener('visibilitychange', pause);
  }, []);
  const [lightingId, setLightingId] = useState<LightingId>('daylight');
  const [sunDirection, setSunDirection] = useState(125);
  const [exposure, setExposure] = useState(1);
  const [contactShadows, setContactShadows] = useState(true);
  const [effectsFailed, setEffectsFailed] = useState(false);
  const [renderImage, setRenderImage] = useState<{
    url: string;
    width: number;
    height: number;
  } | null>(null);
  useEffect(
    () => () => {
      if (renderImage) URL.revokeObjectURL(renderImage.url);
    },
    [renderImage],
  );
  const renderState = useRef<{ gl: WebGLRenderer; camera: Camera } | null>(null);
  const { active: loadingAssets } = useProgress();
  const controls = useRef<Controls>(null),
    lastAzimuth = useRef(Math.PI / 4),
    region = useRef<HTMLDivElement>(null),
    toolbar = useRef<HTMLDivElement>(null),
    walkInput = useRef<WalkInput>({ forward: 0, strafe: 0, step: null, turn: 0 }),
    wake = useRef<() => void>(() => {});
  useEffect(() => {
    const tools = toolbar.current,
      host = region.current;
    if (!tools || !host) return;
    const measure = () =>
      host.style.setProperty(
        '--view3d-panel-top',
        `${tools.offsetTop + tools.offsetHeight + 10}px`,
      );
    const observer = new ResizeObserver(measure);
    observer.observe(tools);
    measure();
    return () => observer.disconnect();
  }, []);
  const world = useMemo(
    () => buildMultiWorld(sourceScene, doorStates),
    [sourceScene.floors, sourceScene.layout.furniture, doorStates],
  );
  const toggleDoor = (id: string) => {
    const next = { ...doorStates, [id]: !(doorStates[id] ?? true) };
    if (
      mode === 'walk' &&
      walkLocation?.available &&
      !next[id] &&
      !canStandMulti(buildMultiWorld(sourceScene, next), {
        point: walkLocation.point,
        elevation: walkLocation.elevation,
        floorId: walkLocation.floorId,
        stairId: walkLocation.stairId,
      })
    ) {
      setCaptureError('门扇附近有人，请退开后再关门。');
      return;
    }
    setCaptureError('');
    setDoorStates(next);
    wake.current();
  };
  const goToStair = (s: (typeof world.flights)[number], top: boolean) => {
    const ux = (s.end[0] - s.start[0]) / s.run,
      uy = (s.end[1] - s.start[1]) / s.run;
    const point: Vec2 = top
      ? [s.end[0] + ux * 0.42, s.end[1] + uy * 0.42]
      : [s.start[0] - ux * 0.23, s.start[1] - uy * 0.23];
    const fid = top ? s.to : s.from,
      owner = sourceScene.floors.find((f) => f.id === fid)!;
    if (!canStandMulti(world, { point, elevation: owner.elevationMm / 1000, floorId: fid })) {
      setCaptureError('楼梯口净空不足，请检查门扇、家具及平台。');
      return;
    }
    const targetRoom =
      owner.rooms.find((r) =>
        world.floors.get(fid)!.rooms.some((w) => w.id === r.id && insideWalk(point, w.polygon)),
      ) || owner.rooms[0];
    setPreviewFloor(fid);
    onFloorChange?.(fid);
    onRoomChange?.(targetRoom.id);
    setRoom(targetRoom.id);
    setWalkEntry({ point, floorId: fid, yaw: top ? Math.atan2(ux, -uy) : Math.atan2(-ux, uy) });
    setReset((v) => v + 1);
  };
  const direction = useMemo<[number, number]>(
    () => [Math.sin(azimuth), -Math.cos(azimuth)],
    [azimuth],
  );
  const failAsset = useCallback(() => setAssetFailed(true), []);
  const pauseWalk = useCallback(() => setWalkActive(false), []);
  const chooseMode = (next: typeof mode) => {
    setAutoRotate(false);
    setCameraView('perspective');
    setWalkActive(false);
    setCredits(false);
    if (next === 'walk' && window.matchMedia('(max-width: 700px)').matches) setExpanded(true);
    if (next === 'walk' && mode !== 'walk') setWalkLocation(null);
    setMode(next);
  };
  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [expanded]);
  useEffect(() => {
    if (roomId) setRoom(roomId);
  }, [roomId]);
  useEffect(() => {
    setWalkActive(false);
    setWalkLocation(null);
    setReset((v) => v + 1);
  }, [floor.id]);
  useEffect(() => {
    setAutoRotate(false);
    setCameraView('perspective');
  }, [floor.id]);
  const room = scene.floors[0].rooms.find((r) => r.id === currentRoom) || scene.floors[0].rooms[0],
    points = (
      mode === 'room'
        ? [room]
        : mode === 'building' || mode === 'exterior'
          ? sourceScene.floors.flatMap((f) => f.rooms)
          : floor.rooms
    ).flatMap((r) => r.boundaryMm),
    b = bounds(points),
    cx = (b.minX + b.maxX) / 2000,
    cz = -(b.minY + b.maxY) / 2000,
    span = Math.max((b.maxX - b.minX) / 1000, (b.maxY - b.minY) / 1000, 2),
    high = quality === 'high',
    buildingHeight =
      Math.max(
        ...sourceScene.floors.map(
          (f) => f.elevationMm + Math.max(...f.rooms.map((r) => r.heightMm)),
        ),
      ) / 1000;
  const pose =
    mode === 'room'
      ? roomCamera(scene, room)
      : overviewCamera(
          [cx, cz],
          span,
          mode === 'building' || mode === 'exterior'
            ? buildingHeight
            : Math.max(...floor.rooms.map((r) => r.heightMm)) / 1000,
          mode === 'building' || mode === 'exterior',
          cameraView,
        );
  // CameraPose handles subsequent changes; keep Canvas configuration stable while orbiting.
  const initialCamera = useMemo(
    () => ({ position: pose.position, fov: pose.fov, near: 0.03, far: 200 }),
    [],
  );
  const fallback = (
    <>
      <div className="webgl-warning">3D 预览暂不可用，已显示同源 2D 户型。</div>
      <Plan2D scene={scene} readOnly />
    </>
  );
  return (
    <div
      ref={region}
      className={`three-canvas realistic-view ${mode === 'walk' ? 'walk-view' : ''} ${expanded ? 'walk-expanded' : ''}`}
      role="region"
      aria-label="三维空间预览"
      tabIndex={0}
      data-walk-region
      data-render-quality={quality}
      data-postprocessing={high && !effectsFailed ? 'enabled' : 'disabled'}
      data-camera-view={cameraView}
      data-auto-rotate={autoRotate}
    >
      <Boundary fallback={fallback}>
        <Canvas
          shadows
          dpr={high ? [1, 1.75] : 1}
          frameloop={autoRotate ? 'always' : 'demand'}
          camera={initialCamera}
          gl={{
            antialias: true,
            preserveDrawingBuffer: true,
            toneMapping: ACESFilmicToneMapping,
            toneMappingExposure: 1.05,
          }}
          onCreated={({ gl, camera }) => {
            gl.shadowMap.type = PCFSoftShadowMap;
            renderState.current = { gl, camera };
            if (!gl.extensions.has('EXT_color_buffer_float')) {
              setEffectsFailed(true);
              setQuality('balanced');
            }
          }}
          fallback={<span>三维参考画布；可切换 2D 户型查看平面数据。</span>}
        >
          <Boundary fallback={null} onFailure={failAsset}>
            <Lighting3D
              center={[cx, cz]}
              span={span}
              height={buildingHeight}
              high={high}
              presetId={lightingId}
              direction={sunDirection}
              exposure={exposure}
              exterior={mode === 'exterior'}
            />
          </Boundary>
          <Suspense fallback={null}>
            {floorScenes.map(({ floor: f, scene: local }) => {
              const all = mode === 'building' || mode === 'exterior' || mode === 'walk';
              return (
                <group
                  key={f.id}
                  visible={all || f.id === floor.id}
                  position={[0, all ? f.elevationMm / 1000 : 0, 0]}
                >
                  <RoomModel
                    scene={local}
                    style={style}
                    roomId={mode === 'room' && f.id === floor.id ? room.id : undefined}
                    selectedId={mode === 'walk' ? undefined : selectedId}
                    showDimensions={mode !== 'walk' && showDimensions}
                    onSelect={mode === 'walk' ? undefined : onSelect}
                    onAssetFailure={failAsset}
                    cutaway={(mode === 'building' || mode === 'overview') && seeThroughWalls}
                    direction={direction}
                    walkthrough={mode === 'walk'}
                    doorStates={doorStates}
                    onDoorToggle={toggleDoor}
                    fullScene={sourceScene}
                    lightRoomId={mode === 'walk' ? walkLocation?.roomId || room.id : room.id}
                    exteriorFrame={mode === 'exterior' ? facade.frame : undefined}
                  />
                  <Stairs3D floor={f} floors={sourceScene.floors} />
                </group>
              );
            })}
            {mode === 'exterior' && <Exterior3D scene={sourceScene} preset={facade} />}
            {mode === 'overview' && (
              <>
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, -0.19, cz]} receiveShadow>
                  <planeGeometry args={[span * 5, span * 5]} />
                  <meshStandardMaterial color="#eeeae2" roughness={1} />
                </mesh>
              </>
            )}
          </Suspense>
          {mode === 'walk' ? (
            <WalkControls
              scene={sourceScene}
              world={world}
              room={room}
              active={walkActive}
              reset={reset}
              input={walkInput}
              wake={wake}
              onLocation={setWalkLocation}
              onPause={pauseWalk}
              entry={walkEntry}
            />
          ) : (
            <>
              <OrbitControls
                ref={controls}
                makeDefault
                target={pose.target}
                minDistance={mode === 'room' ? 0.25 : 2}
                maxDistance={Math.max(span * 8, 12)}
                maxPolarAngle={mode === 'room' ? Math.PI * 0.86 : Math.PI * 0.49}
                enableDamping
                autoRotate={autoRotate}
                autoRotateSpeed={0.6}
                onStart={() => setAutoRotate(false)}
                onChange={() => {
                  const angle = controls.current?.getAzimuthalAngle();
                  if (angle != null && Math.abs(angle - lastAzimuth.current) > 0.24) {
                    lastAzimuth.current = angle;
                    setAzimuth(angle);
                  }
                }}
              />
              <CameraPose
                pose={pose}
                controls={controls}
                reset={reset}
                fitWidth={mode !== 'room'}
              />
            </>
          )}
          {high && !effectsFailed && (
            <Boundary fallback={null} onFailure={() => setEffectsFailed(true)}>
              <RenderEffects3D contactShadows={contactShadows} />
            </Boundary>
          )}
        </Canvas>
      </Boundary>
      <div ref={toolbar} className="view3d-tools" role="toolbar" aria-label="三维参考视图">
        <div className="view3d-mode">
          <button
            className={mode === 'overview' ? 'active' : ''}
            onClick={() => chooseMode('overview')}
          >
            <House size={13} />
            {sourceScene.floors.length > 1 ? '本层俯览' : '全屋俯览'}
          </button>
          {sourceScene.floors.length > 1 && (
            <button
              className={mode === 'building' ? 'active' : ''}
              onClick={() => chooseMode('building')}
            >
              <Layers size={13} />
              整栋剖面
            </button>
          )}
          <button
            className={mode === 'exterior' ? 'active' : ''}
            onClick={() => chooseMode('exterior')}
          >
            建筑外观
          </button>
          <button className={mode === 'room' ? 'active' : ''} onClick={() => chooseMode('room')}>
            <Eye size={13} />
            房间视角
          </button>
          <button className={mode === 'walk' ? 'active' : ''} onClick={() => chooseMode('walk')}>
            <Footprints size={13} />
            步行漫游
          </button>
        </div>
        {sourceScene.floors.length > 1 && (
          <select
            aria-label="3D 楼层"
            value={floor.id}
            onChange={(e) => {
              setPreviewFloor(e.target.value);
              onFloorChange?.(e.target.value);
              if (mode === 'building') chooseMode('overview');
            }}
          >
            {sourceScene.floors.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        )}
        {(mode === 'room' || mode === 'walk') && (
          <select
            value={mode === 'walk' ? walkLocation?.roomId || room.id : room.id}
            aria-label={mode === 'walk' ? '漫游前往房间' : '3D 房间'}
            onChange={(e) => {
              const targetFloor = sourceScene.floors.find((f) =>
                f.rooms.some((r) => r.id === e.target.value),
              );
              if (targetFloor && targetFloor.id !== floor.id) {
                setPreviewFloor(targetFloor.id);
                onFloorChange?.(targetFloor.id);
              }
              setRoom(e.target.value);
              setWalkEntry(null);
              onRoomChange?.(e.target.value);
              if (mode === 'walk') setReset((v) => v + 1);
            }}
          >
            {(mode === 'walk' ? sourceScene.floors.flatMap((f) => f.rooms) : scene.floors[0].rooms)
              .filter((r) => r.type !== 'stairwell')
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </select>
        )}
        <div className="view3d-options">
          {mode !== 'walk' && mode !== 'room' && (
            <>
              <button
                aria-label="3D 顶视图"
                aria-pressed={cameraView === 'top'}
                title="从上方查看房屋布局，保持真实墙门高度"
                onClick={() => {
                  setAutoRotate(false);
                  setCameraView((v) => (v === 'top' ? 'perspective' : 'top'));
                }}
              >
                <Scan size={13} />
                顶视
              </button>
              <button
                aria-label="自动旋转 3D"
                aria-pressed={autoRotate}
                title="环绕查看；手动拖动画面或切换模式时停止"
                onClick={() => {
                  setCameraView('perspective');
                  setAutoRotate((value) => !value);
                }}
              >
                <RotateCw size={13} />
                {autoRotate ? '停止旋转' : '自动旋转'}
              </button>
            </>
          )}
          {(mode === 'overview' || mode === 'building') && (
            <button
              aria-label="切换墙体显示"
              aria-pressed={seeThroughWalls}
              title="仅透明前侧外墙，保留墙体与门窗实测高度"
              onClick={() => {
                setSeeThroughWalls(!seeThroughWalls);
                onCutawayChange?.(!seeThroughWalls);
              }}
            >
              {seeThroughWalls ? '透明外墙' : '完整墙'}
            </button>
          )}
          {onCaptureReference && (mode === 'room' || mode === 'walk') && (
            <button
              disabled={captureBusy || walkActive || loadingAssets}
              title={
                walkActive
                  ? '先暂停漫游，再固定当前视角'
                  : '保存不含界面按钮的3D参考，并沿用当前相机进行AI装修'
              }
              onClick={async () => {
                const current = renderState.current;
                if (!current || !(current.camera instanceof PerspectiveCamera)) return;
                const id =
                  mode === 'walk' && !walkLocation?.stairId
                    ? walkLocation?.roomId
                    : mode === 'room'
                      ? room.id
                      : null;
                if (!id) {
                  setCaptureError('请先进入一个有效房间。');
                  return;
                }
                setCaptureBusy(true);
                setCaptureError('');
                try {
                  const p = current.camera.position;
                  const target = p
                    .clone()
                    .add(current.camera.getWorldDirection(new Vector3()).multiplyScalar(3));
                  const elevation =
                    mode === 'walk'
                      ? sourceScene.floors.find((f) => f.rooms.some((r) => r.id === id))
                          ?.elevationMm || 0
                      : 0;
                  const mm = (v: Vector3): Vec3 => [
                    Math.round(v.x * 1000),
                    Math.round(-v.z * 1000),
                    Math.round(v.y * 1000) - elevation,
                  ];
                  await onCaptureReference({
                    imageDataUrl: current.gl.domElement.toDataURL('image/jpeg', 0.92),
                    roomId: id,
                    scene: sourceScene,
                    camera: {
                      positionMm: mm(p),
                      targetMm: mm(target),
                      fovDeg: current.camera.fov,
                      aspectRatio: current.camera.aspect,
                    },
                  });
                } catch (e) {
                  setCaptureError((e as Error).message || '当前视角参考创建失败，请稍后再试。');
                } finally {
                  setCaptureBusy(false);
                }
              }}
            >
              <CameraIcon size={13} />
              {captureBusy ? '保存参考中…' : '以此视角装修'}
            </button>
          )}
          <button aria-expanded={doorPanel} onClick={() => setDoorPanel((v) => !v)}>
            门控
          </button>
          <button
            aria-expanded={lightingPanel}
            onClick={() => {
              setLightingPanel((v) => !v);
              setDoorPanel(false);
            }}
          >
            光影
          </button>
          <button
            aria-label="切换渲染精度"
            title="在画质和设备负载之间切换"
            onClick={() => setQuality((q) => (q === 'high' ? 'balanced' : 'high'))}
          >
            <Layers size={13} />
            {high ? '高清' : '流畅'}
          </button>
          <button
            aria-pressed={showDimensions}
            title="选中家具时显示其尺寸"
            onClick={() => setDimensions((v) => !v)}
          >
            <Ruler size={13} />
            尺寸
          </button>
          <button
            aria-label="重置 3D 视角"
            onClick={() => {
              setAutoRotate(false);
              setCameraView('perspective');
              setReset((v) => v + 1);
            }}
          >
            <RotateCcw size={13} />
          </button>
          {
            <button
              aria-label={expanded ? '还原3D视图' : '放大3D视图'}
              onClick={() => {
                setExpanded((v) => !v);
                region.current?.focus({ preventScroll: true });
              }}
            >
              {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
          }
          <button aria-label="模型来源与说明" onClick={() => setCredits((v) => !v)}>
            <Info size={13} />
          </button>
        </div>
      </div>
      <LoadingStatus />
      {lightingPanel && (
        <div className="render-settings-panel" role="group" aria-label="光影与画质设置">
          <div className="render-settings-heading">
            <strong>光影与画质</strong>
            <button aria-label="关闭光影设置" onClick={() => setLightingPanel(false)}>
              <X size={14} />
            </button>
          </div>
          <label>
            光照氛围
            <select
              aria-label="光照氛围"
              value={lightingId}
              onChange={(e) => setLightingId(e.target.value as LightingId)}
            >
              {Object.entries(LIGHTING_PRESETS).map(([id, p]) => (
                <option key={id} value={id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            太阳方向 <output>{sunDirection}°</output>
            <input
              aria-label="太阳方向"
              type="range"
              min="0"
              max="360"
              step="5"
              value={sunDirection}
              onChange={(e) => setSunDirection(Number(e.target.value))}
            />
          </label>
          <label>
            画面曝光 <output>{exposure.toFixed(2)}</output>
            <input
              aria-label="画面曝光"
              type="range"
              min="0.6"
              max="1.5"
              step="0.05"
              value={exposure}
              onChange={(e) => setExposure(Number(e.target.value))}
            />
          </label>
          <label className="render-shadow-toggle">
            <input
              type="checkbox"
              checked={contactShadows}
              disabled={!high || effectsFailed}
              onChange={(e) => setContactShadows(e.target.checked)}
            />
            接触阴影 · 高清模式
          </label>
          <p>
            {high && !effectsFailed ? '高清：接触阴影与精细抗锯齿' : '流畅：保留材质与基础阴影'}
            。仅调整当前预览光影。
          </p>
          <div className="render-settings-actions">
            <button
              onClick={() => {
                setLightingId('daylight');
                setSunDirection(125);
                setExposure(1);
                setContactShadows(true);
              }}
            >
              恢复光影
            </button>
            <button
              disabled={loadingAssets || walkActive}
              onClick={() => {
                const canvas = renderState.current?.gl.domElement;
                if (!canvas) return;
                try {
                  canvas.toBlob((blob) => {
                    if (!blob) {
                      setCaptureError('当前画面导出失败，请重试。');
                      return;
                    }
                    setRenderImage({
                      url: URL.createObjectURL(blob),
                      width: canvas.width,
                      height: canvas.height,
                    });
                  }, 'image/png');
                } catch {
                  setCaptureError('当前画面导出失败，请刷新预览后重试。');
                }
              }}
            >
              导出当前画面
            </button>
          </div>
          {renderImage && (
            <a
              className="render-image-download"
              href={renderImage.url}
              download="筑见-当前3D视角.png"
            >
              下载 PNG 图像 · {renderImage.width} × {renderImage.height}
            </a>
          )}
        </div>
      )}
      {effectsFailed && (
        <div className="render-fallback-note" role="status">
          当前设备使用基础渲染模式
        </div>
      )}
      {mode === 'exterior' && (
        <div className="exterior-style-panel">
          <label>
            建筑外观样式
            <select
              aria-label="建筑外观样式"
              value={exteriorId}
              onChange={(e) => {
                const id = exteriorStyle(e.target.value).id;
                setExteriorId(id);
                onExteriorChange?.(id);
              }}
            >
              {EXTERIOR_STYLES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <p>{facade.description}</p>
        </div>
      )}
      {doorPanel && (
        <div className="view3d-door-panel" role="group" aria-label="房门开关控制">
          <strong>房门开关 · 漫游状态</strong>
          <p>点击门扇或下方按钮；关闭的门会阻挡通行。</p>
          {sourceScene.floors
            .flatMap((f) =>
              f.openings
                .filter((o) => o.kind === 'door' && o.model !== 'archway')
                .map((o) => ({ o, f })),
            )
            .map(({ o, f }, i) => (
              <button
                key={o.id}
                onClick={() => toggleDoor(o.id)}
                aria-pressed={doorStates[o.id] ?? true}
              >
                {doorStates[o.id] === false ? '打开' : '关闭'}门 {i + 1} · {f.name} /{' '}
                {f.rooms.find((r) => r.id === o.connects[0])?.name || '入口'}
              </button>
            ))}
        </div>
      )}
      {captureError && (
        <div className="webgl-warning" role="alert">
          {captureError}
        </div>
      )}
      {mode === 'walk' && (
        <WalkHUD
          world={world.floors.get(walkLocation?.floorId || floor.id) || world.floors.get(floor.id)!}
          location={walkLocation}
          active={walkActive}
          input={walkInput}
          navigation={
            world.flights.length > 0 && (
              <div className="walk-stair-shortcuts" role="group" aria-label="楼梯导航">
                {world.flights.map((s, i) => (
                  <span key={s.id}>
                    <button onClick={() => goToStair(s, false)}>前往楼梯口 {i + 1}</button>{' '}
                    <button onClick={() => goToStair(s, true)}>前往楼梯上口 {i + 1}</button>
                  </span>
                ))}
              </div>
            )
          }
          onStart={() => {
            setWalkActive(true);
            if (window.matchMedia('(max-width: 700px)').matches) setExpanded(true);
            region.current?.focus({ preventScroll: true });
            wake.current();
          }}
          onPause={pauseWalk}
          onExit={() => chooseMode('overview')}
          onInput={() => {
            region.current?.focus({ preventScroll: true });
            wake.current();
          }}
        />
      )}
      {credits && (
        <div className="view3d-credits">
          <button
            className="icon-button"
            aria-label="关闭模型说明"
            onClick={() => setCredits(false)}
          >
            <X size={15} />
          </button>
          <strong>真实造型，实测尺寸</strong>
          <p>
            模型按场景尺寸适配，用于造型、材质和空间关系参考。商品结构、色差与施工细节以实物和现场复核为准。
          </p>
          <p>
            Glam Velvet Sofa © 2021 Wayfair, LLC / Eric Chadwick，CC BY 4.0；Sheen Chair 为
            CC0。茶几、低柜、小户型沙发、餐桌、木地板与环境光来自 Poly
            Haven（CC0）。床与高柜为本项目参数化模型。
          </p>
          <a href="/visuals/CREDITS.html" target="_blank" rel="noreferrer">
            查看作者、授权与修改说明 ↗
          </a>
        </div>
      )}
      {assetFailed && (
        <div className="view3d-resource-note" role="status">
          部分资源未能加载，已使用本地细化模型或基础灯光。
        </div>
      )}
      <div className="three-hint">
        <span>
          {mode === 'walk'
            ? 'WASD / 方向键移动 · 拖动环顾 · Esc 暂停'
            : mode === 'room'
              ? `初始视高 ${pose.position[1].toFixed(2)} m · 拖动环绕`
              : '拖动旋转 · 滚轮缩放 · 右键平移'}
        </span>
        <span>
          {sourceScene.floors.length > 1
            ? `${mode === 'walk' ? walkLocation?.floorName || floor.name : floor.name} · 可沿楼梯上下层`
            : '造型参考 · 尺寸按录入值适配'}
        </span>
      </div>
    </div>
  );
}
