import { useState } from 'react';
import type { Scene } from '../types';
import { importMeasurements, applyMeasurements, type ImportedMeasurement } from '../measurements';
import { useNotice } from '../App';
import { post } from '../api';
export default function MeasurementImport({
  scene,
  projectId,
  onApply,
}: {
  scene: Scene;
  projectId: string;
  onApply: (s: Scene) => void;
}) {
  const [rows, setRows] = useState<ImportedMeasurement[]>([]),
    [busy, setBusy] = useState(false),
    notify = useNotice(),
    floor = {
      rooms: scene.floors.flatMap((f) => f.rooms),
      walls: scene.floors.flatMap((f) => f.walls),
      openings: scene.floors.flatMap((f) => f.openings),
      obstacles: scene.floors.flatMap((f) => f.obstacles),
    };
  function options(type: string) {
    if (type === 'room')
      return floor.rooms.map((r) => ({
        id: r.id,
        name:
          (scene.floors.find((f) => f.rooms.some((x) => x.id === r.id))?.name || '') +
          ' / ' +
          r.name,
      }));
    if (type === 'wall')
      return floor.walls.map((w, i) => ({ id: w.id, name: `墙段 ${i + 1} (${w.id})` }));
    if (type === 'opening')
      return floor.openings.map((o, i) => ({
        id: o.id,
        name: `${o.kind === 'door' ? '门' : '窗'} ${i + 1} (${o.id})`,
      }));
    return floor.obstacles.map((o) => ({ id: o.id, name: o.id }));
  }
  return (
    <section className="measurement-import">
      <h3>导入量房 CSV 原始记录</h3>
      <a className="button ghost compact" href="/templates/measurement-template.csv" download>
        下载原版量房模板
      </a>
      <p className="fine-print">
        支持开发文档原版模板。房间可按 ID
        或名称匹配，墙与门窗请明确关联后再应用。墙厚、对角线和边长记录存档，暂不自动重建墙面。
      </p>
      <input
        type="file"
        accept=".csv"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try {
            if (file.size > 2 * 1024 * 1024) throw new Error('CSV 不超过 2 MB。');
            setRows(importMeasurements(await file.text(), scene));
          } catch (err) {
            notify((err as Error).message, true);
          } finally {
            e.target.value = '';
          }
        }}
      />
      {rows.length > 0 && (
        <>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>测量对象 / 项</th>
                  <th>原始值</th>
                  <th>关联场景对象</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>
                      {r.label}
                      <small style={{ display: 'block' }}>{r.type}</small>
                    </td>
                    <td>
                      {r.value} {r.unit}
                    </td>
                    <td>
                      <select
                        value={r.targetId}
                        aria-label={`${r.label} ${r.type} 关联对象`}
                        onChange={(e) =>
                          setRows((v) =>
                            v.map((x) =>
                              x.targetType === r.targetType && x.label === r.label
                                ? { ...x, targetId: e.target.value }
                                : x,
                            ),
                          )
                        }
                      >
                        <option value="">请选择对象</option>
                        {options(r.targetType).map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="button primary full"
            disabled={busy || rows.some((r) => !r.targetId)}
            onClick={async () => {
              setBusy(true);
              try {
                const result = applyMeasurements(scene, rows);
                await post('/projects/' + projectId + '/measurements', {
                  records: result.records,
                  sourceAssetIds: [],
                });
                onApply(result.scene);
                notify(`已导入 ${rows.length} 条实测记录，请校验并重新确认户型。`);
              } catch (e) {
                notify((e as Error).message, true);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? '正在导入…' : `应用 ${rows.length} 条实测记录`}
          </button>
        </>
      )}
    </section>
  );
}
