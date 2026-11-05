import { useEffect, useRef, useState } from 'react';
import { Stage, Layer, Line, Rect, Text, Group, Circle, Arc } from 'react-konva';
import type Konva from 'konva';
import type { Scene, Vec2 } from '../types';
import { bounds, activeFloor } from '../scene';
import FloorSwitcher from './FloorSwitcher';
import { useScene } from '../store';
import { furnitureKind } from './visuals/sceneMath';
import { moveSelected, corners } from '../editorCommands';

export function PlanThumbnail({ scene, floorId }: { scene: Scene; floorId?: string }) {
  const f = activeFloor(scene, floorId),
    b = bounds(f.rooms.flatMap((r) => r.boundaryMm));
  const pad = 450;
  return (
    <svg
      viewBox={`${b.minX - pad} ${-b.maxY - pad} ${b.maxX - b.minX + pad * 2} ${b.maxY - b.minY + pad * 2}`}
      className="plan-thumbnail"
      aria-label="户型预览"
    >
      {f.rooms.map((r) => (
        <polygon
          key={r.id}
          points={r.boundaryMm.map(([x, y]) => `${x},${-y}`).join(' ')}
          fill={r.type === 'stairwell' ? '#dfe6e4' : r.type === 'courtyard' ? '#e0e7cf' : '#ece7d8'}
          stroke="#6d7d69"
          strokeWidth="60"
        />
      ))}
      {scene.layout.furniture
        .filter((o) => o.floorId === f.id)
        .map((o) => (
          <rect
            key={o.id}
            x={-o.sizeMm[0] / 2}
            y={-o.sizeMm[1] / 2}
            width={o.sizeMm[0]}
            height={o.sizeMm[1]}
            rx="55"
            fill="#b4bd9a"
            stroke="#87916f"
            strokeWidth="22"
            transform={`translate(${o.positionMm[0]},${-o.positionMm[1]}) rotate(${-o.rotationDeg})`}
          />
        ))}
    </svg>
  );
}
export function FloorPlanPreview({ scene }: { scene: Scene }) {
  const [floorId, setFloorId] = useState(scene.floors[0].id);
  const floor = activeFloor(scene, floorId);
  return (
    <div className="floor-plan-preview">
      <FloorSwitcher scene={scene} floorId={floor.id} onChange={setFloorId} />
      <PlanThumbnail scene={scene} floorId={floor.id} />
    </div>
  );
}
export default function Plan2D({
  draw = false,
  onDraw,
  readOnly = false,
  scene: external,
}: {
  draw?: boolean;
  onDraw?: (points: Vec2[]) => void;
  readOnly?: boolean;
  scene?: Scene;
}) {
  const st = useScene(),
    scene = external || st.scene,
    ref = useRef<HTMLDivElement>(null),
    stage = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ width: 800, height: 600 }),
    [zoom, setZoom] = useState(1),
    [previewFloorId, setPreviewFloor] = useState<string | null>(null),
    [pan, setPan] = useState<Vec2>([0, 0]),
    [panMode, setPanMode] = useState(false),
    [points, setPoints] = useState<Vec2[]>([]);
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ width, height });
    });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!draw) setPoints([]);
  }, [draw]);
  if (!scene) return null;
  const floor = activeFloor(scene, external ? previewFloorId : st.floorId),
    b = bounds(floor.rooms.flatMap((r) => r.boundaryMm)),
    bw = Math.max(b.maxX - b.minX, 1000),
    bh = Math.max(b.maxY - b.minY, 1000),
    scale = Math.min((size.width - 120) / bw, (size.height - 130) / bh) * zoom;
  const ox = (size.width - bw * scale) / 2 - b.minX * scale + pan[0],
    oy = (size.height + bh * scale) / 2 + b.minY * scale + pan[1];
  const map = ([x, y]: Vec2): Vec2 => [ox + x * scale, oy - y * scale];
  const unm = ([x, y]: Vec2): Vec2 => [
    Math.round((x - ox) / scale / 50) * 50,
    Math.round((oy - y) / scale / 50) * 50,
  ];
  const catalog = new Map(scene.layout.catalogSnapshot.map((c) => [c.skuId, c]));
  return (
    <div className={'plan-canvas ' + (draw ? 'drawing' : '')} ref={ref}>
      {readOnly && (
        <div className="plan-floor-tools">
          <FloorSwitcher scene={scene} floorId={floor.id} onChange={setPreviewFloor} />
        </div>
      )}
      <Stage
        ref={stage}
        width={size.width}
        height={size.height}
        draggable={panMode && !draw}
        onDragEnd={(e) => {
          if (e.target === stage.current) {
            setPan([pan[0] + e.target.x(), pan[1] + e.target.y()]);
            e.target.position({ x: 0, y: 0 });
          }
        }}
        onClick={(e) => {
          if (draw) {
            const p = stage.current?.getPointerPosition();
            if (p) setPoints([...points, unm([p.x, p.y])]);
          } else if (!panMode && e.target === e.target.getStage()) st.select(null);
        }}
        onWheel={(e) => {
          e.evt.preventDefault();
          setZoom((z) => Math.max(0.35, Math.min(3, z * (e.evt.deltaY > 0 ? 0.92 : 1.08))));
        }}
      >
        <Layer>
          {floor.rooms.map((r) => {
            const bb = bounds(r.boundaryMm),
              cx = (bb.minX + bb.maxX) / 2,
              cy = (bb.minY + bb.maxY) / 2,
              [sx, sy] = map([cx, cy]);
            return (
              <Group key={r.id} onClick={() => !readOnly && !panMode && st.selectRoom(r.id)}>
                <Line
                  points={r.boundaryMm.flatMap(map)}
                  closed
                  fill={
                    r.type === 'stairwell'
                      ? '#dfe6e4'
                      : r.type === 'courtyard'
                        ? '#e0e7cf'
                        : st.roomId === r.id
                          ? '#eee9d9'
                          : '#f3efe5'
                  }
                  stroke={st.roomId === r.id ? '#83936d' : '#b5b6a8'}
                  strokeWidth={1.5}
                />
                <Text
                  x={sx - 100}
                  y={sy - 16}
                  width={200}
                  align="center"
                  text={r.name}
                  fontSize={13}
                  fill="#7b8370"
                />
                <Text
                  x={sx - 100}
                  y={sy + 5}
                  width={200}
                  align="center"
                  text={`${(r.computedAreaMm2 / 1e6).toFixed(2)} m²`}
                  fontSize={11}
                  fill="#9a9d8c"
                />
                <Line
                  points={[...map([bb.minX, bb.maxY + 240]), ...map([bb.maxX, bb.maxY + 240])]}
                  stroke="#b2b8a9"
                  strokeWidth={0.7}
                />
                <Text
                  x={map([cx, bb.maxY + 240])[0] - 60}
                  y={map([cx, bb.maxY + 240])[1] - 15}
                  width={120}
                  align="center"
                  text={`${Math.round(bb.maxX - bb.minX)} mm`}
                  fontSize={10}
                  fill="#7d8974"
                />
              </Group>
            );
          })}
          {floor.walls.map((w) => (
            <Line
              key={w.id}
              points={[...map(w.startMm), ...map(w.endMm)]}
              stroke={st.selected === w.id ? '#91a462' : '#67735e'}
              strokeWidth={Math.max(w.thicknessMm * scale, 3)}
              lineCap="square"
              onClick={() => !readOnly && st.select(w.id)}
            />
          ))}
          {floor.openings.map((o) => {
            const w = floor.walls.find((x) => x.id === o.wallId);
            if (!w) return null;
            const dx = w.endMm[0] - w.startMm[0],
              dy = w.endMm[1] - w.startMm[1],
              len = Math.hypot(dx, dy),
              a: Vec2 = [
                w.startMm[0] + (dx / len) * o.offsetMm,
                w.startMm[1] + (dy / len) * o.offsetMm,
              ],
              end: Vec2 = [a[0] + (dx / len) * o.widthMm, a[1] + (dy / len) * o.widthMm];
            return (
              <Group key={o.id} onClick={() => !readOnly && st.select(o.id)}>
                <Line
                  points={[...map(a), ...map(end)]}
                  stroke="#faf9f5"
                  strokeWidth={w.thicknessMm * scale + 2}
                />
                <Line
                  points={[...map(a), ...map(end)]}
                  stroke={
                    st.selected === o.id ? '#9a7045' : o.kind === 'window' ? '#9fbcc3' : '#c6b494'
                  }
                  strokeWidth={o.kind === 'window' ? 3 : 1}
                />
                {o.swing && (
                  <Arc
                    x={map(o.swing.hinge === 'start' ? a : end)[0]}
                    y={map(o.swing.hinge === 'start' ? a : end)[1]}
                    innerRadius={0}
                    outerRadius={o.widthMm * scale}
                    angle={o.swing.angleDeg}
                    rotation={
                      (-Math.atan2(dy, dx) * 180) / Math.PI +
                      (o.swing.hinge === 'end' ? -180 : 0) +
                      (o.swing.direction === 'ccw' ? -o.swing.angleDeg : 0)
                    }
                    stroke="#c6b494"
                    strokeWidth={0.8}
                    fill="#dcd2b51a"
                  />
                )}
              </Group>
            );
          })}
          {floor.obstacles.map((o) => (
            <Line
              key={o.id}
              closed
              points={o.polygonMm.flatMap(map)}
              fill="#a6a093"
              stroke="#797367"
              strokeWidth={1}
            />
          ))}
          {floor.stairs?.map((s) => {
            const dx = s.endMm[0] - s.startMm[0],
              dy = s.endMm[1] - s.startMm[1],
              length = Math.hypot(dx, dy),
              nx = ((-dy / length) * s.widthMm) / 2,
              ny = ((dx / length) * s.widthMm) / 2;
            return (
              <Group key={s.id}>
                <Line
                  points={[
                    [s.startMm[0] + nx, s.startMm[1] + ny],
                    [s.endMm[0] + nx, s.endMm[1] + ny],
                    [s.endMm[0] - nx, s.endMm[1] - ny],
                    [s.startMm[0] - nx, s.startMm[1] - ny],
                  ].flatMap((p) => map(p as Vec2))}
                  closed
                  fill="#e4dcc7"
                  stroke="#8d9477"
                  strokeWidth={1}
                />
                {Array.from({ length: s.stepCount }, (_, i) => {
                  const t = (i + 1) / s.stepCount,
                    x = s.startMm[0] + dx * t,
                    y = s.startMm[1] + dy * t;
                  return (
                    <Line
                      key={i}
                      points={[...map([x + nx, y + ny]), ...map([x - nx, y - ny])]}
                      stroke="#a59b82"
                      strokeWidth={0.7}
                    />
                  );
                })}
                <Text
                  x={map(s.startMm)[0] - 35}
                  y={map(s.startMm)[1]}
                  text="楼梯 ↑"
                  fontSize={11}
                  fill="#667451"
                />
              </Group>
            );
          })}
          {scene.layout.furniture
            .filter((o) => o.floorId === floor.id)
            .map((o) => {
              const [x, y] = map([o.positionMm[0], o.positionMm[1]]),
                w = o.sizeMm[0] * scale,
                d = o.sizeMm[1] * scale,
                selected = st.selectedIds.includes(o.id),
                bad = st.issues.some((i) => i.objectIds.includes(o.id)),
                name = catalog.get(o.skuId)?.name || '自定义家具',
                kind = furnitureKind(name, catalog.get(o.skuId)?.modelAssetId);
              return (
                <Group
                  key={o.id}
                  x={x}
                  y={y}
                  rotation={-o.rotationDeg}
                  draggable={!readOnly && !draw && !panMode && !o.locked}
                  onClick={(e) => !readOnly && !panMode && st.select(o.id, e.evt.shiftKey)}
                  onTap={() => !readOnly && !panMode && st.select(o.id)}
                  onDragStart={() => {
                    if (!st.selectedIds.includes(o.id)) st.select(o.id);
                  }}
                  onDragEnd={(e) => {
                    const p = unm([e.target.x(), e.target.y()]);
                    st.change((s) => {
                      moveSelected(
                        s,
                        useScene.getState().selectedIds,
                        p[0] - o.positionMm[0],
                        p[1] - o.positionMm[1],
                      );
                    });
                  }}
                >
                  <Rect
                    x={-w / 2}
                    y={-d / 2}
                    width={w}
                    height={d}
                    cornerRadius={3}
                    fill={bad ? '#dfb9a9' : selected ? '#b6c599' : '#d3c7ac'}
                    stroke={bad ? '#b66d52' : selected ? '#627946' : '#a89a7a'}
                    strokeWidth={selected ? 2 : 1}
                    shadowColor="#77705b"
                    shadowBlur={3}
                    shadowOpacity={0.12}
                    shadowOffsetY={2}
                  />
                  {(kind === 'sofa' || kind === 'chaise-sofa') && (
                    <>
                      <Rect
                        x={-w / 2 + 4}
                        y={d / 2 - 10}
                        width={w - 8}
                        height={7}
                        cornerRadius={2}
                        fill="#b7ac91"
                      />
                      <Line points={[0, -d / 2 + 3, 0, d / 2 - 12]} stroke="#b9af96" />
                    </>
                  )}
                  {kind === 'bed' && (
                    <>
                      <Rect
                        x={-w / 2 + 4}
                        y={-d / 2 + 4}
                        width={w - 8}
                        height={d * 0.28}
                        cornerRadius={3}
                        fill="#f3eee1"
                      />
                      <Line
                        points={[-w / 2 + 3, -d / 2 + d * 0.4, w / 2 - 3, -d / 2 + d * 0.4]}
                        stroke="#ad9f86"
                      />
                    </>
                  )}
                  <Text
                    x={-w / 2}
                    y={-6}
                    width={w}
                    text={name.length > 8 ? name.slice(0, 7) : name}
                    fontSize={Math.min(11, w / 5)}
                    align="center"
                    fill="#615f4c"
                    rotation={0}
                  />
                  {o.locked && <Circle x={w / 2 - 5} y={-d / 2 + 5} radius={3} fill="#65784b" />}
                </Group>
              );
            })}
          {!readOnly &&
            st.selectedIds.length === 1 &&
            (() => {
              const f = scene.layout.furniture.find((f) => f.id === st.selectedIds[0]);
              const room = floor.rooms.find((r) => r.id === f?.roomId);
              if (
                !f ||
                !room ||
                room.boundaryMm.length !== 4 ||
                !room.boundaryMm.every((p, i) => {
                  const q = room.boundaryMm[(i + 1) % 4];
                  return p[0] === q[0] || p[1] === q[1];
                })
              )
                return null;
              const rb = bounds(room.boundaryMm),
                fb = bounds(corners(f)),
                cx = f.positionMm[0],
                cy = f.positionMm[1];
              const guides: [Vec2, Vec2, number][] = [
                [[rb.minX, cy], [fb.minX, cy], fb.minX - rb.minX],
                [[fb.maxX, cy], [rb.maxX, cy], rb.maxX - fb.maxX],
                [[cx, rb.minY], [cx, fb.minY], fb.minY - rb.minY],
                [[cx, fb.maxY], [cx, rb.maxY], rb.maxY - fb.maxY],
              ];
              return guides
                .filter((g) => g[2] >= 0)
                .map(([a, b, d], i) => {
                  const pa = map(a),
                    pb = map(b);
                  return (
                    <Group key={i}>
                      <Line
                        points={[...pa, ...pb]}
                        stroke="#ab7849"
                        dash={[4, 3]}
                        strokeWidth={1}
                      />
                      <Text
                        x={(pa[0] + pb[0]) / 2 - 24}
                        y={(pa[1] + pb[1]) / 2 - 15}
                        width={64}
                        text={Math.round(d) + ' mm'}
                        fontSize={9}
                        fill="#9b7048"
                      />
                    </Group>
                  );
                });
            })()}
          {points.length > 0 && (
            <>
              <Line points={points.flatMap(map)} stroke="#72844f" strokeWidth={2} dash={[5, 3]} />
              {points.map((p, i) => (
                <Circle key={i} x={map(p)[0]} y={map(p)[1]} radius={4} fill="#72844f" />
              ))}
            </>
          )}
        </Layer>
      </Stage>
      <div className="canvas-scale">
        <span>1 m</span>
        <i style={{ width: 1000 * scale }} /> <small>实测尺寸 · 毫米</small>
      </div>
      <div className="canvas-zoom">
        <button aria-pressed={panMode} onClick={() => setPanMode((v) => !v)}>
          平移
        </button>
        <button onClick={() => setZoom((z) => Math.max(0.35, z - 0.15))} aria-label="缩小">
          −
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom((z) => Math.min(3, z + 0.15))} aria-label="放大">
          +
        </button>
        <button
          onClick={() => {
            setZoom(1);
            setPan([0, 0]);
          }}
        >
          适应
        </button>
      </div>
      {draw && (
        <div className="draw-prompt">
          <span>点击网格绘制房间净边界（{points.length} 个点），按 50 mm 吸附</span>
          <button
            disabled={points.length < 3}
            onClick={() => {
              onDraw?.(points);
              setPoints([]);
            }}
          >
            完成轮廓
          </button>
          <button onClick={() => setPoints([])}>重画</button>
        </div>
      )}
    </div>
  );
}
