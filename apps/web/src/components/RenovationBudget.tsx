import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Scene, RoomRates, ExtraCost } from '../types';
import { useScene } from '../store';
import { id } from '../scene';
import { post } from '../api';
import { Money } from './UI';
type Estimate = {
  knownSubtotalMinor: number;
  unknownLineCount: number;
  renovationSubtotalMinor: number;
  contingencyMinor: number;
  estimatedTotalMinor: number;
  quantities: { roomId: string; floorAreaM2: number; wallAreaM2: number; ceilingAreaM2: number }[];
  lines: {
    itemKey: string;
    title: string;
    category: string;
    quantity: number;
    unit: string;
    unitPriceMinor: number | null;
    amountMinor: number | null;
  }[];
};
const fields = [
  ['floorMaterialMinor', '地面材料'],
  ['floorLaborMinor', '地面人工'],
  ['wallMaterialMinor', '墙面材料'],
  ['wallLaborMinor', '墙面人工'],
  ['ceilingMaterialMinor', '顶面材料'],
  ['ceilingLaborMinor', '顶面人工'],
] as const;
export default function RenovationBudget({
  scene,
  projectId,
}: {
  scene: Scene;
  projectId: string;
}) {
  const st = useScene(),
    rooms = scene.floors.flatMap((f) =>
      f.rooms.map((r) => ({ ...r, label: f.name + ' / ' + r.name })),
    ),
    [roomId, setRoom] = useState(rooms[0].id),
    [snapshot, setSnapshot] = useState(scene);
  useEffect(() => {
    const t = setTimeout(() => setSnapshot(scene), 350);
    return () => clearTimeout(t);
  }, [scene]);
  const estimate = useQuery({
    queryKey: ['estimate', projectId, snapshot],
    queryFn: () =>
      post<Estimate>('/projects/' + projectId + '/estimate', {
        scene: snapshot,
        baseRevision: st.revision,
      }),
  });
  const config = scene.layout.renovation || {},
    rate = config.rooms?.find((r) => r.roomId === roomId) || { roomId, enabled: false },
    extras = config.extraLines || [],
    q = estimate.data?.quantities.find((x) => x.roomId === roomId);
  const setRate = (key: keyof RoomRates, value: number | boolean | null) =>
    st.change((s) => {
      s.layout.renovation = {
        ...s.layout.renovation,
        rooms: [
          ...(s.layout.renovation?.rooms || []).filter((r) => r.roomId !== roomId),
          { ...rate, [key]: value },
        ],
      };
    });
  const setExtra = (lineId: string, patch: Partial<ExtraCost>) =>
    st.change((s) => {
      s.layout.renovation = {
        ...s.layout.renovation,
        extraLines: extras.map((x) => (x.id === lineId ? { ...x, ...patch } : x)),
      };
    });
  return (
    <section className="renovation-budget">
      <h3>装修工程量与报价</h3>
      <p role="status">
        {snapshot !== scene || estimate.isFetching
          ? '正在更新估算，金额以更新完成后为准。'
          : '估算已更新。'}
      </p>
      <p className="fine-print">
        墙面按净周长×层高扣除关联门窗估算，异形墙、矮墙和造型需人工复核。材料加损耗，人工不加；单价由你填写。
      </p>
      <p>
        已纳入 {(config.rooms || []).filter((r) => r.enabled).length} / {rooms.length}{' '}
        个房间；未启用房间的装修费用不在估算中。
      </p>
      <button
        className="button outline compact"
        onClick={() =>
          st.change((s) => {
            s.layout.renovation = {
              ...s.layout.renovation,
              rooms: rooms.map((r) => ({
                ...config.rooms?.find((x) => x.roomId === r.id),
                roomId: r.id,
                enabled: true,
              })),
            };
          })
        }
      >
        纳入全部房间，保留各自报价
      </button>
      <div className="budget-summary renovation-summary">
        {[
          ['已知报价合计', estimate.data?.knownSubtotalMinor],
          ['其中装修项目', estimate.data?.renovationSubtotalMinor],
          ['预留金', estimate.data?.contingencyMinor],
          ['已知预计总额', estimate.data?.estimatedTotalMinor],
        ].map(([title, value]) => (
          <div key={String(title)}>
            <span>{title}</span>
            <strong>
              <Money value={value as number | undefined} />
            </strong>
          </div>
        ))}
      </div>
      <p>全清单待询价：{estimate.data?.unknownLineCount ?? '—'} 项；待询价金额未计入总额。</p>
      {estimate.isError && (
        <p role="alert">
          估算暂不可用，请检查输入。<button onClick={() => void estimate.refetch()}>重试</button>
        </p>
      )}
      <details open className="quote-editor">
        <summary>按房间录入材料和人工单价</summary>
        <label>
          报价房间
          <select value={roomId} onChange={(e) => setRoom(e.target.value)}>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <p>
          地面 {q?.floorAreaM2 ?? '—'}㎡ · 墙面 {q?.wallAreaM2 ?? '—'}㎡ · 顶面{' '}
          {q?.ceilingAreaM2 ?? '—'}㎡
        </p>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={rate.enabled}
            onChange={(e) => setRate('enabled', e.target.checked)}
          />
          将本房间材料与人工加入估算
        </label>
        <div className="quote-grid">
          {fields.map(([key, label]) => (
            <label key={key}>
              {label} / 元·㎡
              <input
                type="number"
                min="0"
                max="1000000"
                step=".01"
                value={rate[key] == null ? '' : Number(rate[key]) / 100}
                placeholder="待询价"
                onChange={(e) =>
                  setRate(key, e.target.value === '' ? null : Math.round(+e.target.value * 100))
                }
              />
            </label>
          ))}
        </div>
        <button
          className="button ghost compact"
          onClick={() =>
            st.change((s) => {
              s.layout.renovation = {
                ...s.layout.renovation,
                rooms: rooms.map((r) => ({ ...rate, roomId: r.id })),
              };
            })
          }
        >
          将当前房间单价套用到全部房间
        </button>
        <div className="input-grid">
          {[
            ['wastePercent', '材料损耗 / %', 5],
            ['contingencyPercent', '预留金 / %', 0],
          ].map(([key, title, def]) => (
            <label key={String(key)}>
              {title}
              <input
                type="number"
                min="0"
                max="30"
                value={config[key as 'wastePercent' | 'contingencyPercent'] ?? Number(def)}
                onChange={(e) =>
                  st.change((s) => {
                    s.layout.renovation = {
                      ...s.layout.renovation,
                      [key]: Math.max(0, Math.min(30, +e.target.value)),
                    };
                  })
                }
              />
            </label>
          ))}
        </div>
      </details>
      <details className="quote-editor">
        <summary>水电、安装及补充费用（{extras.length} 项）</summary>
        {extras.map((x) => (
          <div className="extra-cost" key={x.id}>
            <label>
              项目
              <input
                maxLength={120}
                value={x.title}
                onChange={(e) => setExtra(x.id, { title: e.target.value })}
              />
            </label>
            <div className="quote-grid">
              <label>
                类别
                <select
                  value={x.category}
                  onChange={(e) =>
                    setExtra(x.id, { category: e.target.value as ExtraCost['category'] })
                  }
                >
                  {[
                    ['electrical', '电路'],
                    ['plumbing', '水路'],
                    ['labor', '人工'],
                    ['material', '材料'],
                    ['other', '其他'],
                  ].map(([v, t]) => (
                    <option key={v} value={v}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                数量
                <input
                  type="number"
                  min=".001"
                  max="1000000"
                  step=".001"
                  value={x.quantity}
                  onChange={(e) => setExtra(x.id, { quantity: Math.max(0.001, +e.target.value) })}
                />
              </label>
              <label>
                单位
                <input
                  maxLength={20}
                  value={x.unit}
                  onChange={(e) => setExtra(x.id, { unit: e.target.value })}
                />
              </label>
              <label>
                单价 / 元
                <input
                  type="number"
                  min="0"
                  step=".01"
                  value={x.unitPriceMinor == null ? '' : x.unitPriceMinor / 100}
                  onChange={(e) =>
                    setExtra(x.id, {
                      unitPriceMinor:
                        e.target.value === '' ? null : Math.round(+e.target.value * 100),
                    })
                  }
                />
              </label>
            </div>
            <button
              className="button ghost compact"
              onClick={() =>
                st.change((s) => {
                  s.layout.renovation = {
                    ...s.layout.renovation,
                    extraLines: extras.filter((r) => r.id !== x.id),
                  };
                })
              }
            >
              移除此费用
            </button>
          </div>
        ))}
        <button
          className="button outline"
          onClick={() =>
            st.change((s) => {
              s.layout.renovation = {
                ...s.layout.renovation,
                extraLines: [
                  ...extras,
                  {
                    id: id(),
                    title: '新增费用',
                    category: 'other',
                    quantity: 1,
                    unit: '项',
                    unitPriceMinor: null,
                  },
                ],
              };
            })
          }
        >
          添加补充费用
        </button>
      </details>
      {!!estimate.data?.lines.some((l) => l.category !== 'furniture') && (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>装修项目</th>
                <th>工程量</th>
                <th>用户单价</th>
                <th>金额</th>
              </tr>
            </thead>
            <tbody>
              {estimate.data.lines
                .filter((l) => l.category !== 'furniture')
                .map((l) => (
                  <tr key={l.itemKey}>
                    <td>{l.title}</td>
                    <td>
                      {l.quantity} {l.unit}
                    </td>
                    <td>
                      <Money value={l.unitPriceMinor} />
                    </td>
                    <td>
                      <Money value={l.amountMinor} />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
