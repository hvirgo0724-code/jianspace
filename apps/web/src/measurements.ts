import type { Scene, Measurement } from './types';
import { id, bounds, resizedRoom, clone } from './scene';
export interface ImportedMeasurement {
  label: string;
  targetType: string;
  targetId: string;
  value: number;
  unit: 'mm' | 'cm' | 'm';
  type: string;
  method: string;
  at: string;
  notes: string;
}
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (quoted) throw new Error('CSV 引号没有闭合。');
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}
export function importMeasurements(text: string, scene: Scene): ImportedMeasurement[] {
  const rows = parseCSV(text),
    head = rows.shift()?.map((x) => x.trim()) || [];
  if (
    !head.includes('measurement_type') ||
    !head.includes('value') ||
    !head.includes('target_type')
  )
    throw new Error('请选择开发文档中的 measurement-template.csv 格式。');
  if (rows.length > 1000) throw new Error('单次最多导入 1000 条测量记录。');
  return rows.map((cells, index) => {
    const get = (k: string) => cells[head.indexOf(k)]?.trim() || '',
      type = get('target_type'),
      unit = get('unit'),
      value = Number(get('value')),
      floor = {
        rooms: scene.floors.flatMap((f) => f.rooms),
        walls: scene.floors.flatMap((f) => f.walls),
        openings: scene.floors.flatMap((f) => f.openings),
        obstacles: scene.floors.flatMap((f) => f.obstacles),
      };
    if (
      !['room', 'wall', 'opening', 'obstacle'].includes(type) ||
      !['mm', 'cm', 'm'].includes(unit) ||
      !get('value') ||
      !Number.isFinite(value) ||
      value <= 0 ||
      value * ({ mm: 1, cm: 10, m: 1000 }[unit] || 1) > 100000
    )
      throw new Error(`第 ${index + 2} 行：对象类型、单位或尺寸无效。`);
    if (
      ![
        'width',
        'depth',
        'height',
        'thickness',
        'offset',
        'bottom',
        'diagonal',
        'edge_length',
      ].includes(get('measurement_type'))
    )
      throw new Error(`第 ${index + 2} 行：测量项无效。`);
    let targetId = '';
    if (type === 'room')
      targetId =
        floor.rooms.find((r) => r.id === get('room_id'))?.id ||
        (floor.rooms.filter((r) => r.name === get('target_label')).length === 1
          ? floor.rooms.find((r) => r.name === get('target_label'))?.id
          : '') ||
        '';
    else
      targetId =
        [...floor.walls, ...floor.openings, ...floor.obstacles].find(
          (o) => o.id === get('target_label'),
        )?.id || '';
    const at = get('measured_at') || new Date().toISOString();
    if (!Number.isFinite(Date.parse(at))) throw new Error(`第 ${index + 2} 行：测量时间无效。`);
    return {
      label: get('target_label'),
      targetType: type,
      targetId,
      value,
      unit: unit as 'mm' | 'cm' | 'm',
      type: get('measurement_type'),
      method: ['laser', 'tape', 'drawing', 'user_estimate', 'other'].includes(get('method'))
        ? get('method')
        : 'other',
      at: new Date(at).toISOString(),
      notes:
        get('notes') + (get('photo_filename') ? '；原照片文件名：' + get('photo_filename') : ''),
    };
  });
}
export function applyMeasurements(
  scene: Scene,
  rows: ImportedMeasurement[],
): { scene: Scene; records: Measurement[] } {
  let next = clone(scene);
  const original = [...next.measurements];
  if (rows.some((r) => !r.targetId)) throw new Error('请为每条记录选择明确的场景对象。');
  const records: Measurement[] = rows.map((r) => ({
    id: id(),
    floorId:
      scene.floors.find((f) =>
        [...f.rooms, ...f.walls, ...f.openings, ...f.obstacles].some((o) => o.id === r.targetId),
      )?.id || '',
    targetType: r.targetType,
    targetId: r.targetId,
    measurementType: r.type,
    rawValue: r.value,
    rawUnit: r.unit,
    normalizedMm: Math.round(r.value * { mm: 1, cm: 10, m: 1000 }[r.unit]),
    method: r.method,
    measuredAt: r.at,
    sourceAssetIds: [],
    notes: r.notes,
  }));
  for (const roomId of new Set(
    records.filter((r) => r.targetType === 'room').map((r) => r.targetId),
  )) {
    const room = next.floors.flatMap((f) => f.rooms).find((r) => r.id === roomId)!;
    const b = bounds(room.boundaryMm);
    const value = (type: string, def: number) =>
      [...records].reverse().find((r) => r.targetId === roomId && r.measurementType === type)
        ?.normalizedMm ?? def;
    next = resizedRoom(
      next,
      room,
      value('width', b.maxX - b.minX),
      value('depth', b.maxY - b.minY),
      value('height', room.heightMm),
    );
  }
  for (const rec of records) {
    if (rec.targetType === 'opening') {
      const o = next.floors.flatMap((f) => f.openings).find((o) => o.id === rec.targetId);
      if (!o) throw new Error('门窗对象不存在。');
      if (rec.measurementType === 'width') o.widthMm = rec.normalizedMm;
      if (rec.measurementType === 'height') o.heightMm = rec.normalizedMm;
      if (rec.measurementType === 'offset') o.offsetMm = rec.normalizedMm;
      if (rec.measurementType === 'bottom') o.bottomMm = rec.normalizedMm;
    }
    if (rec.targetType === 'wall' && rec.measurementType === 'height') {
      const w = next.floors.flatMap((f) => f.walls).find((w) => w.id === rec.targetId);
      if (w) w.heightMm = rec.normalizedMm;
    }
  }
  next.measurements = [...original, ...records];
  next.confirmation = {
    status: 'draft',
    measurementRevision: scene.confirmation.measurementRevision + 1,
  };
  return { scene: next, records };
}
