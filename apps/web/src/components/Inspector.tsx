import { useState } from 'react';
import {
  Ruler,
  RotateCw,
  LockKeyhole,
  UnlockKeyhole,
  Trash2,
  Move,
  DoorOpen,
  Info,
  Check,
} from 'lucide-react';
import type { Scene, Vec3, Opening } from '../types';
import { useScene } from '../store';
import { bounds, resizedRoom, id, activeFloor } from '../scene';
import { useNotice } from '../App';
import { syncRoomBoundaries } from '../editorCommands';
import { FLOOR_FINISHES, floorFinish, isOutdoor } from '../surfaces';

export default function Inspector({ scene, roomId }: { scene: Scene; roomId?: string }) {
  const st = useScene(),
    notify = useNotice(),
    floor = activeFloor(scene, st.floorId),
    furniture = scene.layout.furniture.find((f) => f.id === st.selected),
    opening = floor.openings.find((o) => o.id === st.selected),
    wall = floor.walls.find((w) => w.id === st.selected),
    room = floor.rooms.find((r) => r.id === roomId) || floor.rooms[0];
  const [unit, setUnit] = useState('mm');
  if (furniture) {
    const item = scene.layout.catalogSnapshot.find((c) => c.skuId === furniture.skuId);
    return (
      <>
        <div className="panel-heading">
          <h3>家具属性</h3>
          <span className="tag">{furniture.locked ? '已锁定' : '可编辑'}</span>
        </div>
        <div className="inspector-body">
          <h2>{item?.name || '自定义家具'}</h2>
          <p className="muted">尺寸化通用模型，需核实实际商品。</p>
          <form
            key={furniture.id + furniture.rotationDeg + furniture.positionMm.join(',')}
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              st.change((s) => {
                const f = s.layout.furniture.find((x) => x.id === furniture.id)!;
                f.positionMm = [Number(d.get('x')), Number(d.get('y')), Number(d.get('z'))];
                const size: Vec3 = [Number(d.get('w')), Number(d.get('d')), Number(d.get('h'))];
                if (size.some((x, i) => x !== f.sizeMm[i])) {
                  const sku = 'CUSTOM-' + id();
                  s.layout.catalogSnapshot.push({
                    skuId: sku,
                    name: item?.name || '自定义家具',
                    sizeMm: size,
                    priceMinor: null,
                    currency: 'CNY',
                    sourceType: 'user_input',
                    quotedAt: new Date().toISOString(),
                    modelAssetId: item?.modelAssetId || null,
                    productUrl: null,
                  });
                  f.skuId = sku;
                  f.sizeMm = size;
                }
                f.roomId = String(d.get('room'));
                const cat = s.layout.catalogSnapshot.find((c) => c.skuId === f.skuId)!;
                const price = String(d.get('price'));
                const previousPrice = item?.priceMinor == null ? '' : String(item.priceMinor / 100);
                if (price !== previousPrice) {
                  cat.priceMinor = price === '' ? null : Math.round(Number(price) * 100);
                  cat.sourceType = 'user_input';
                  cat.quotedAt = new Date().toISOString();
                }
              });
              notify('家具属性已更新，请检查是否发生冲突。');
            }}
          >
            <div className="field-group-title">
              <Move size={14} />
              中心位置 · mm
            </div>
            <div className="input-grid three">
              {['x', 'y', 'z'].map((k, i) => (
                <label key={k}>
                  {k.toUpperCase()}
                  <input
                    name={k}
                    type="number"
                    step="1"
                    required
                    defaultValue={furniture.positionMm[i]}
                    min={i === 2 ? 0 : -1000000}
                    max={1000000}
                    disabled={furniture.locked}
                  />
                </label>
              ))}
            </div>
            <div className="field-group-title">
              <Ruler size={14} />长 × 深 × 高 · mm
            </div>
            <div className="input-grid three">
              {['w', 'd', 'h'].map((k, i) => (
                <label key={k}>
                  {['宽', '深', '高'][i]}
                  <input
                    name={k}
                    type="number"
                    required
                    step="1"
                    min="1"
                    max="100000"
                    defaultValue={furniture.sizeMm[i]}
                    disabled={furniture.locked}
                  />
                </label>
              ))}
            </div>
            <label>
              所属房间
              <select name="room" defaultValue={furniture.roomId} disabled={furniture.locked}>
                {floor.rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              用户询价 / 元
              <input
                name="price"
                type="number"
                step="0.01"
                min="0"
                max="1000000000"
                defaultValue={item?.priceMinor == null ? '' : item.priceMinor / 100}
                placeholder="留空为待询价"
                disabled={furniture.locked}
              />
            </label>
            <button className="button outline full" disabled={furniture.locked}>
              应用属性
            </button>
          </form>
          <div className="property-actions">
            <button
              disabled={furniture.locked}
              onClick={() =>
                st.change((s) => {
                  const f = s.layout.furniture.find((x) => x.id === furniture.id)!;
                  f.rotationDeg = (f.rotationDeg + 90) % 360;
                })
              }
            >
              <RotateCw size={16} />
              旋转 90°
            </button>
            <button
              onClick={() =>
                st.change((s) => {
                  s.layout.furniture.find((x) => x.id === furniture.id)!.locked = !furniture.locked;
                })
              }
            >
              {furniture.locked ? <UnlockKeyhole size={16} /> : <LockKeyhole size={16} />}{' '}
              {furniture.locked ? '解锁家具' : '锁定家具'}
            </button>
          </div>
          <button
            className="button danger full"
            disabled={furniture.locked}
            onClick={() => {
              st.change(
                (s) =>
                  (s.layout.furniture = s.layout.furniture.filter((x) => x.id !== furniture.id)),
              );
              st.select(null);
            }}
          >
            <Trash2 size={15} />
            移除家具
          </button>
          <p className="fine-print">锁定后，规则布局会保留该家具的位置与旋转。</p>
        </div>
      </>
    );
  }
  if (opening) {
    return (
      <>
        <div className="panel-heading">
          <h3>{opening.kind === 'door' ? '门洞属性' : '窗洞属性'}</h3>
          <DoorOpen size={17} />
        </div>
        <div className="inspector-body">
          <p className="muted">沿所属墙起点的中心线定位，单位 mm。</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              st.change((s) => {
                const o = activeFloor(s, floor.id).openings.find((x) => x.id === opening.id)!;
                o.widthMm = +d.get('width')!;
                o.heightMm = +d.get('height')!;
                o.offsetMm = +d.get('offset')!;
                o.bottomMm = +d.get('bottom')!;
                o.model = String(d.get('model')) as Opening['model'];
                if (o.swing) {
                  o.swing.direction = d.get('direction') as 'cw' | 'ccw';
                  o.swing.hinge = d.get('hinge') as 'start' | 'end';
                  o.swing.angleDeg = Number(d.get('angle'));
                  o.swing.roomId = String(d.get('swingRoom'));
                }
                s.confirmation.status = 'draft';
                s.confirmation.measurementRevision++;
              });
              notify('门窗尺寸已更新，需重新确认实测。');
            }}
          >
            <label>
              门窗造型
              <select
                name="model"
                defaultValue={opening.model || (opening.kind === 'door' ? 'hinged' : 'casement')}
              >
                {opening.kind === 'door' ? (
                  <>
                    <option value="hinged">平开门</option>
                    <option value="archway">开放通道（无门扇）</option>
                  </>
                ) : (
                  <>
                    <option value="casement">标准窗</option>
                    <option value="panoramic">全景大窗</option>
                    <option value="floor-to-ceiling">落地玻璃窗</option>
                  </>
                )}
              </select>
            </label>
            {[
              ['offset', '沿墙偏移', opening.offsetMm, 0],
              ['width', '洞口宽度', opening.widthMm, 1],
              ['height', '洞口高度', opening.heightMm, 1],
              ['bottom', '离地高度', opening.bottomMm, 0],
            ].map(([key, label, value, min]) => (
              <label key={String(key)}>
                {label}
                <input
                  name={String(key)}
                  type="number"
                  min={Number(min)}
                  max="100000"
                  required
                  step="1"
                  defaultValue={value}
                />
              </label>
            ))}
            {opening.swing && (
              <>
                <label>
                  门轴端点
                  <select name="hinge" defaultValue={opening.swing.hinge}>
                    <option value="start">洞口起点</option>
                    <option value="end">洞口终点</option>
                  </select>
                </label>
                <label>
                  开向
                  <select name="direction" defaultValue={opening.swing.direction}>
                    <option value="ccw">逆时针</option>
                    <option value="cw">顺时针</option>
                  </select>
                </label>
                <label>
                  开启房间
                  <select name="swingRoom" defaultValue={opening.swing.roomId}>
                    {opening.connects.filter(Boolean).map((rid) => (
                      <option key={rid} value={rid!}>
                        {floor.rooms.find((r) => r.id === rid)?.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  开启角度
                  <input
                    name="angle"
                    type="number"
                    min="1"
                    max="180"
                    step="1"
                    defaultValue={opening.swing.angleDeg}
                  />
                </label>
              </>
            )}
            <button className="button primary full">应用门窗尺寸</button>
          </form>
          {opening.swing && (
            <p className="fine-print">
              开向：{opening.swing.direction === 'ccw' ? '逆时针' : '顺时针'} /{' '}
              {opening.swing.angleDeg}°。碰撞校验包含门扇扇形区域。
            </p>
          )}
          <button
            className="button danger full"
            onClick={() => {
              st.change((s) => {
                activeFloor(s, floor.id).openings = activeFloor(s, floor.id).openings.filter(
                  (x) => x.id !== opening.id,
                );
                s.confirmation.status = 'draft';
              });
              st.select(null);
            }}
          >
            删除此门窗
          </button>
        </div>
      </>
    );
  }
  if (wall) {
    return (
      <>
        <div className="panel-heading">
          <h3>墙体属性</h3>
          <Ruler size={16} />
        </div>
        <div className="inspector-body">
          <dl className="property-list">
            <dt>墙段长度</dt>
            <dd>
              {Math.round(
                Math.hypot(wall.endMm[0] - wall.startMm[0], wall.endMm[1] - wall.startMm[1]),
              )}{' '}
              mm
            </dd>
            <dt>墙厚</dt>
            <dd>{wall.thicknessMm} mm</dd>
            <dt>墙高</dt>
            <dd>{wall.heightMm} mm</dd>
            <dt>结构性质</dt>
            <dd>未知 · 需专业复核</dd>
          </dl>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              try {
                st.change((s) => {
                  const w = activeFloor(s, floor.id).walls.find((x) => x.id === wall.id)!;
                  w.heightMm = +d.get('height')!;
                  w.startMm = [Number(d.get('sx')), Number(d.get('sy'))];
                  w.endMm = [Number(d.get('ex')), Number(d.get('ey'))];
                  w.thicknessMm = Number(d.get('thickness'));
                  for (const other of activeFloor(s, floor.id).walls.filter(
                    (x) => x.id !== wall.id,
                  )) {
                    for (const point of ['startMm', 'endMm'] as const) {
                      if (
                        other[point][0] === wall.startMm[0] &&
                        other[point][1] === wall.startMm[1]
                      )
                        other[point] = [...w.startMm];
                      else if (
                        other[point][0] === wall.endMm[0] &&
                        other[point][1] === wall.endMm[1]
                      )
                        other[point] = [...w.endMm];
                    }
                  }
                  syncRoomBoundaries(floor, activeFloor(s, floor.id));
                  s.confirmation.status = 'draft';
                });
                notify('墙体、连接端点与房间内表面已联动更新，请运行校验。');
              } catch (error) {
                notify((error as Error).message, true);
              }
            }}
          >
            <label>
              实测墙厚 / mm
              <input
                name="thickness"
                type="number"
                min="50"
                max="1000"
                step="1"
                required
                defaultValue={wall.thicknessMm}
              />
            </label>
            <label>
              实测墙高 / mm
              <input
                name="height"
                type="number"
                step="1"
                min="100"
                max="100000"
                defaultValue={wall.heightMm}
              />
            </label>
            <details className="coordinate-details">
              <summary>墙中心线坐标 · mm</summary>
              <div className="input-grid">
                {[
                  ['sx', '起点 X', wall.startMm[0]],
                  ['sy', '起点 Y', wall.startMm[1]],
                  ['ex', '终点 X', wall.endMm[0]],
                  ['ey', '终点 Y', wall.endMm[1]],
                ].map(([key, label, value]) => (
                  <label key={String(key)}>
                    {label}
                    <input
                      name={String(key)}
                      type="number"
                      step="1"
                      required
                      min="-1000000"
                      max="1000000"
                      defaultValue={value}
                    />
                  </label>
                ))}
              </div>
            </details>
            <button className="button outline full">应用墙体属性</button>
          </form>
          <div className="field-group-title">添加门窗</div>
          {(['door', 'window', 'panoramic', 'floor-to-ceiling', 'archway'] as const).map(
            (preset) => (
              <button
                className="button outline full"
                key={preset}
                onClick={() => {
                  const kind = preset === 'door' || preset === 'archway' ? 'door' : 'window';
                  const length = Math.hypot(
                    wall.endMm[0] - wall.startMm[0],
                    wall.endMm[1] - wall.startMm[1],
                  );
                  const ranges = floor.openings
                    .filter((o) => o.wallId === wall.id)
                    .map((o) => [o.offsetMm - 100, o.offsetMm + o.widthMm + 100])
                    .sort((a, b) => a[0] - b[0]);
                  let cursor = 150;
                  const gaps: number[][] = [];
                  for (const [a, b] of ranges) {
                    if (a > cursor) gaps.push([cursor, a]);
                    cursor = Math.max(cursor, b);
                  }
                  if (cursor < length - 150) gaps.push([cursor, length - 150]);
                  const gap = gaps.sort((a, b) => b[1] - b[0] - (a[1] - a[0]))[0];
                  if (!gap || gap[1] - gap[0] < 500) {
                    notify('该墙没有足够的空闲区间，请先调整已有门窗。', true);
                    return;
                  }
                  const width = Math.floor(
                    Math.min(
                      preset === 'panoramic'
                        ? 3200
                        : preset === 'floor-to-ceiling'
                          ? 2800
                          : kind === 'door'
                            ? 1000
                            : 1400,
                      gap[1] - gap[0],
                    ),
                  );
                  const bottom =
                    kind === 'door'
                      ? 0
                      : preset === 'floor-to-ceiling'
                        ? 100
                        : preset === 'panoramic'
                          ? 600
                          : 900;
                  const height = Math.min(
                    wall.heightMm - bottom - 120,
                    kind === 'door'
                      ? 2200
                      : preset === 'floor-to-ceiling'
                        ? 2600
                        : preset === 'panoramic'
                          ? 1800
                          : 1400,
                  );
                  if (height < 400) {
                    notify('墙高不足以放置所选门窗。', true);
                    return;
                  }
                  const oid = 'opening-' + id();
                  const connected = floor.rooms
                    .filter((r) => r.wallRefs.some((ref) => ref.wallId === wall.id))
                    .map((r) => r.id);
                  st.change((s) => {
                    activeFloor(s, floor.id).openings.push({
                      id: oid,
                      kind: kind as 'door' | 'window',
                      wallId: wall.id,
                      model:
                        preset === 'door' ? 'hinged' : preset === 'window' ? 'casement' : preset,
                      offsetMm: Math.round((gap[0] + gap[1] - width) / 2),
                      widthMm: width,
                      bottomMm: bottom,
                      heightMm: height,
                      connects: [connected[0] || room.id, connected[1] || null],
                      ...(preset === 'door'
                        ? {
                            swing: {
                              hinge: 'start' as const,
                              direction: 'ccw' as const,
                              angleDeg: 90,
                              roomId: connected[0] || room.id,
                            },
                          }
                        : {}),
                    });
                    s.confirmation.status = 'draft';
                  });
                  st.select(oid);
                }}
              >
                + 添加
                {
                  {
                    door: '平开门',
                    window: '标准窗',
                    panoramic: '全景大窗',
                    'floor-to-ceiling': '落地窗',
                    archway: '开放通道',
                  }[preset]
                }
              </button>
            ),
          )}
          <div className="inline-note">
            <Info size={17} />
            调整墙厚会联动房间净边界；门窗、家具与跨层结构仍需运行校验。
          </div>
        </div>
      </>
    );
  }
  if (!room) return <div className="inspector-body">请选择房间或家具。</div>;
  const b = bounds(room.boundaryMm),
    factor = unit === 'm' ? 1000 : unit === 'cm' ? 10 : 1;
  return (
    <>
      <div className="panel-heading">
        <h3>空间属性</h3>
        <SettingsIcon />
      </div>
      <div className="inspector-body">
        <div className="room-heading">
          <span>SPACE / {floor.rooms.indexOf(room) + 1}</span>
          <h2>{room.name}</h2>
          <strong>
            {(room.computedAreaMm2 / 1e6).toFixed(2)}{' '}
            <small>m² {isOutdoor(room.type) ? '院落面积' : '净面积'}</small>
          </strong>
        </div>
        <form
          key={room.id + '-' + unit + '-' + room.boundaryMm.flat().join(',')}
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget),
              w = Math.round(Number(data.get('width')) * factor),
              d = Math.round(Number(data.get('depth')) * factor),
              h = Math.round(Number(data.get('height')) * factor);
            if (Math.min(w, d, h) < 100 || Math.max(w, d, h) > 100000) {
              notify('尺寸需在 100—100,000 mm 之间。', true);
              return;
            }
            const next = resizedRoom(scene, room, w, d, h, unit as 'mm' | 'cm' | 'm');
            const r = activeFloor(next, floor.id).rooms.find((x) => x.id === room.id)!;
            r.name = String(data.get('name'));
            r.type = String(data.get('roomType'));
            st.replace(next);
            notify('实测尺寸已应用，2D 与 3D 会同步更新。');
          }}
        >
          <label>
            空间名称
            <input name="name" required maxLength={100} defaultValue={room.name} />
          </label>
          <label>
            空间类型
            <select name="roomType" defaultValue={room.type}>
              {Object.entries({
                living: '客厅',
                bedroom: '卧室',
                kitchen: '厨房',
                bathroom: '卫生间',
                dining: '餐厅',
                study: '书房',
                hall: '过厅 / 走廊',
                courtyard: '小院',
                terrace: '露台',
                garage: '车库',
                stairwell: '楼梯井 / 挑空',
                other: '其他空间',
              }).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="field-group-title">
            <Ruler size={15} />
            实测净尺寸
            <select
              aria-label="尺寸单位"
              className="unit-select"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            >
              <option>mm</option>
              <option>cm</option>
              <option>m</option>
            </select>
          </div>
          <div className="input-grid">
            {[
              ['width', '宽度', b.maxX - b.minX],
              ['depth', '进深', b.maxY - b.minY],
              ['height', '层高', room.heightMm],
            ].map(([key, title, value]) => (
              <label key={String(key)}>
                {title} / {unit}
                <input
                  name={String(key)}
                  type="number"
                  step={unit === 'm' ? '.001' : unit === 'cm' ? '.1' : '1'}
                  required
                  min={100 / factor}
                  max={100000 / factor}
                  defaultValue={Number(value) / factor}
                />
              </label>
            ))}
          </div>
          <p className="fine-print">
            宽深调整按房间外接矩形缩放，并平移相邻空间。请复核门窗、家具和非矩形轮廓。
          </p>
          <button className="button primary full">
            <Check size={15} />
            应用实测尺寸
          </button>
        </form>
        <label>
          地面铺装
          <select
            aria-label="地面铺装"
            value={
              floorFinish(
                scene.layout.materials.find(
                  (m) => m.targetType === 'room_floor' && m.targetId === room.id,
                )?.materialId,
                room.type,
              ).id
            }
            onChange={(e) =>
              st.change((s) => {
                s.layout.materials = s.layout.materials.filter(
                  (m) => !(m.targetType === 'room_floor' && m.targetId === room.id),
                );
                s.layout.materials.push({
                  targetType: 'room_floor',
                  targetId: room.id,
                  materialId: e.target.value,
                });
              })
            }
          >
            {FLOOR_FINISHES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <p className="fine-print">每个房间独立保存；更换材质不改变尺寸，2D/3D 共用同一方案。</p>
        <details className="coordinate-details">
          <summary>精确编辑轮廓点</summary>
          <p className="fine-print">每行 x,y，逆时针；坐标为整数 mm。</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              try {
                const text = String(new FormData(e.currentTarget).get('points'));
                const p = text
                  .trim()
                  .split('\n')
                  .map((line) => line.split(',').map((v) => Number(v.trim())));
                if (
                  p.length < 3 ||
                  p.some(
                    (v) =>
                      v.length !== 2 || v.some((x) => !Number.isInteger(x) || Math.abs(x) > 1e6),
                  )
                )
                  throw new Error('坐标格式错误。');
                st.change((s) => {
                  activeFloor(s, floor.id).rooms.find((x) => x.id === room.id)!.boundaryMm = p as [
                    number,
                    number,
                  ][];
                  s.confirmation.status = 'draft';
                });
                notify('已更新房间净轮廓，请同步核对墙体位置并运行校验。');
              } catch (e) {
                notify((e as Error).message, true);
              }
            }}
          >
            <textarea
              name="points"
              rows={6}
              defaultValue={room.boundaryMm.map((p) => p.join(',')).join('\n')}
            />
            <button className="button outline full">应用轮廓点</button>
          </form>
        </details>
        <div className="inspector-note">
          <Info size={15} />
          <span>尺寸由你的实测数据决定；照片仅用于风格参考。</span>
        </div>
      </div>
    </>
  );
}
function SettingsIcon() {
  return <Ruler size={17} />;
}
