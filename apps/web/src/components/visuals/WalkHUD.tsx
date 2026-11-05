import {
  useMemo,
  useRef,
  useState,
  type RefObject,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  RotateCw,
  Pause,
  Play,
  MapPinned,
  Navigation,
  X,
  MousePointer2,
  Footprints,
} from 'lucide-react';
import type { WalkWorld } from './walkMath';
import type { WalkInput, WalkLocation } from './WalkControls';

function WalkMap({ world, location }: { world: WalkWorld; location: WalkLocation | null }) {
  const map = useMemo(() => {
    const points = world.rooms.flatMap((r) => r.polygon),
      xs = points.map((p) => p[0]),
      ys = points.map((p) => p[1]);
    const minX = Math.min(...xs),
      maxX = Math.max(...xs),
      minY = Math.min(...ys),
      maxY = Math.max(...ys);
    const scale = 106 / Math.max(maxX - minX, maxY - minY, 1);
    const project = (p: [number, number]) => [
      12 + (p[0] - minX) * scale,
      12 + (maxY - p[1]) * scale,
    ];
    return { project, height: 24 + (maxY - minY) * scale, width: 24 + (maxX - minX) * scale };
  }, [world]);
  const xy = location ? map.project(location.point) : null;
  return (
    <svg viewBox={`0 0 ${map.width} ${map.height}`} role="img" aria-label="户型小地图与当前朝向">
      {world.rooms.map((r) => (
        <polygon
          key={r.id}
          points={r.polygon.map((p) => map.project(p).join(',')).join(' ')}
          fill={r.id === location?.roomId ? '#dce9cc' : '#f4f0e5'}
          stroke="#a9b598"
          strokeWidth="1"
        />
      ))}
      {world.passages.map((p, i) => (
        <polygon key={i} points={p.map((p) => map.project(p).join(',')).join(' ')} fill="#c8d9bf" />
      ))}
      {world.barriers
        .filter((b) => b.kind === 'furniture' || b.kind === 'obstacle')
        .map((b, i) => (
          <polygon
            key={i}
            points={b.polygon.map((p) => map.project(p).join(',')).join(' ')}
            fill="#b1b69b"
            opacity="0.8"
          />
        ))}
      {xy && (
        <g transform={`translate(${xy[0]},${xy[1]}) rotate(${(-location!.yaw * 180) / Math.PI})`}>
          <path d="M0 -19 L-10 -1 Q0 -5 10 -1Z" fill="#769158" opacity="0.2" />
          <circle r="4.7" fill="#688447" stroke="#fff" strokeWidth="1.6" />
          <path d="M0 -8 L-3 -3 L3 -3Z" fill="#536f36" />
        </g>
      )}
    </svg>
  );
}

export default function WalkHUD({
  world,
  location,
  active,
  input,
  onStart,
  onPause,
  onExit,
  onInput,
  navigation,
}: {
  world: WalkWorld;
  location: WalkLocation | null;
  active: boolean;
  input: RefObject<WalkInput>;
  onStart: () => void;
  onPause: () => void;
  onExit: () => void;
  onInput: () => void;
  navigation?: ReactNode;
}) {
  const [mapOpen, setMapOpen] = useState(true);
  const [stick, setStick] = useState<[number, number]>([0, 0]);
  const stickPointer = useRef<number | null>(null);
  const available = location?.available ?? true;
  const updateStick = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect(),
      dx = (e.clientX - r.left - r.width / 2) / 32,
      dy = (e.clientY - r.top - r.height / 2) / 32;
    const length = Math.max(1, Math.hypot(dx, dy));
    const x = dx / length,
      y = dy / length;
    setStick([x * 25, y * 25]);
    input.current.strafe = Math.abs(x) < 0.12 ? 0 : x;
    input.current.forward = Math.abs(y) < 0.12 ? 0 : -y;
    onInput();
  };
  const stopStick = (e: PointerEvent<HTMLDivElement>) => {
    if (stickPointer.current !== e.pointerId) return;
    stickPointer.current = null;
    setStick([0, 0]);
    input.current.forward = input.current.strafe = 0;
    onInput();
  };
  return (
    <>
      <div className="walk-status">
        <span className="walk-location">
          <Navigation size={13} />
          <strong>
            {location?.floorName} /{' '}
            {location?.stairId ? '楼梯通行中' : location?.roomName || '正在定位'}
          </strong>
          <span>视高 1.60 m</span>
        </span>
        <span className="walk-coordinates" aria-label="漫游位置">
          {location
            ? `X ${location.point[0].toFixed(2)} · Y ${location.point[1].toFixed(2)} · 标高 ${location.elevation.toFixed(2)} m`
            : '寻找安全落点'}
        </span>
        <span className="walk-obstruction" role="status">
          {location?.blocked ? '前方受阻，请转向绕行' : ''}
        </span>
      </div>
      {active && (
        <>
          <div className="walk-crosshair" aria-hidden="true" />
          <div className="walk-move-controls" aria-label="漫游移动控制">
            <div
              className="walk-joystick"
              role="group"
              aria-label="触屏移动摇杆"
              onPointerDown={(e) => {
                if (stickPointer.current !== null) return;
                e.preventDefault();
                stickPointer.current = e.pointerId;
                e.currentTarget.setPointerCapture(e.pointerId);
                updateStick(e);
              }}
              onPointerMove={(e) => {
                if (stickPointer.current === e.pointerId) updateStick(e);
              }}
              onPointerUp={stopStick}
              onPointerCancel={stopStick}
              onLostPointerCapture={stopStick}
            >
              <span className="walk-stick-ring" />
              <span
                className="walk-stick-knob"
                style={{ transform: `translate(${stick[0]}px,${stick[1]}px)` }}
              />
              <Footprints size={13} />
            </div>
            <div className="walk-step-pad">
              <button
                aria-label="前进一步"
                onClick={() => {
                  input.current.step = [1, 0];
                  onInput();
                }}
              >
                <ArrowUp size={16} />
              </button>
              <button
                aria-label="左移一步"
                onClick={() => {
                  input.current.step = [0, -1];
                  onInput();
                }}
              >
                <ArrowLeft size={16} />
              </button>
              <button
                aria-label="后退一步"
                onClick={() => {
                  input.current.step = [-1, 0];
                  onInput();
                }}
              >
                <ArrowDown size={16} />
              </button>
              <button
                aria-label="右移一步"
                onClick={() => {
                  input.current.step = [0, 1];
                  onInput();
                }}
              >
                <ArrowRight size={16} />
              </button>
            </div>
            <span className="walk-control-caption">摇杆行走 / 点击步进</span>
          </div>
          <div className="walk-turn-controls">
            <button
              aria-label="向左转身"
              title="向左转身 30°"
              onClick={() => {
                input.current.turn = Math.PI / 6;
                onInput();
              }}
            >
              <RotateCcw size={16} />
            </button>
            <button
              aria-label="向右转身"
              title="向右转身 30°"
              onClick={() => {
                input.current.turn = -Math.PI / 6;
                onInput();
              }}
            >
              <RotateCw size={16} />
            </button>
            <button aria-label="暂停漫游" onClick={onPause}>
              <Pause size={16} />
            </button>
          </div>
        </>
      )}
      <div className={`walk-map ${mapOpen ? 'open' : ''}`}>
        <button
          aria-label={mapOpen ? '收起小地图' : '展开小地图'}
          aria-expanded={mapOpen}
          onClick={() => setMapOpen((v) => !v)}
        >
          <MapPinned size={13} />
          <span>当前位置</span>
        </button>
        {mapOpen && (
          <>
            <WalkMap world={world} location={location} />
            <span className="walk-distance">已漫游 {(location?.distance || 0).toFixed(1)} m</span>
          </>
        )}
      </div>
      {!active && (
        <div className="walk-intro">
          <div className="walk-intro-card">
            <span className="walk-eyebrow">
              <Footprints size={14} /> WALK THROUGH YOUR HOME
            </span>
            <h3>{available ? '走进你的家' : '暂时没有可站立的位置'}</h3>
            <p>
              {available
                ? '以人的高度，感受每个房间的尺度与动线。'
                : '请检查房间层高与家具摆放，留出可通行的地面。'}
            </p>
            {available && (
              <div className="walk-instructions">
                <span>
                  <kbd>W A S D</kbd> / 方向键行走
                </span>
                <span>
                  <MousePointer2 size={13} /> 拖动画面环顾，触屏摇杆移动
                </span>
                <span>沿门洞前往相邻房间 · Esc 暂停</span>
              </div>
            )}
            {navigation}
            <div className="walk-intro-actions">
              <button className="primary" disabled={!available} onClick={onStart}>
                <Play size={14} />
                {location && location.distance > 0 ? '继续漫游' : '开始漫游'}
              </button>
              <button onClick={onExit}>
                <X size={13} />
                退出
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
