import { useState, useEffect } from 'react';
import type { Scene } from '../types';
import { useScene } from '../store';
import { post } from '../api';
import { useNotice } from '../App';
export default function LayoutBrief({
  scene,
  projectId,
  onGenerate,
  busy,
}: {
  scene: Scene;
  projectId: string;
  onGenerate: () => void;
  busy: boolean;
}) {
  const st = useScene(),
    notify = useNotice(),
    [review, setReview] = useState<{
      score: number;
      reasons: string[];
      warnings: string[];
      note: string;
    } | null>(null);
  const pref = scene.layout.preferences || {};
  useEffect(() => setReview(null), [scene]);
  const update = (key: string, value: unknown) =>
    st.change((s) => {
      s.layout.preferences = { ...s.layout.preferences, [key]: value };
      delete s.layout.analysis;
    });
  return (
    <div className="layout-brief">
      <p>
        根据家庭需求检查门口净空、房间通路与窗前遮挡，保留结构和锁定家具。预算用于提示超支，当前不会自动替换商品。
      </p>
      <div className="input-grid">
        <label>
          居住人数
          <input
            type="number"
            min="1"
            max="20"
            value={pref.occupants || 1}
            onChange={(e) => update('occupants', Math.max(1, Math.min(20, +e.target.value)))}
          />
        </label>
        <label>
          参考通路宽度 / mm
          <input
            type="number"
            min="400"
            max="1500"
            step="50"
            value={pref.passageMm ?? (pref.elderly ? 900 : 600)}
            onChange={(e) => update('passageMm', Math.max(400, Math.min(1500, +e.target.value)))}
          />
        </label>
      </div>
      <div className="brief-options">
        {[
          ['children', '有儿童'],
          ['elderly', '有长者'],
          ['storagePriority', '重视收纳'],
        ].map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={Boolean(pref[key as keyof typeof pref])}
              onChange={(e) => {
                update(key, e.target.checked);
                if (key === 'elderly' && e.target.checked) update('passageMm', 900);
              }}
            />
            {label}
          </label>
        ))}
      </div>
      <label>
        目标家具采购预算 / 元
        <input
          type="number"
          min="0"
          step="100"
          value={pref.budgetMinor == null ? '' : pref.budgetMinor / 100}
          onChange={(e) =>
            update('budgetMinor', e.target.value === '' ? null : Math.round(+e.target.value * 100))
          }
          placeholder="可留空；未报价物品仍待询价"
        />
      </label>
      <button
        className="button outline full"
        disabled={busy}
        onClick={async () => {
          try {
            const source = useScene.getState().scene;
            const result = await post<typeof review>('/projects/' + projectId + '/layout-review', {
              scene: source,
              baseRevision: st.revision,
            });
            if (useScene.getState().scene === source) setReview(result);
          } catch (e) {
            notify((e as Error).message, true);
          }
        }}
      >
        检查当前动线与需求
      </button>
      {review && (
        <div className="layout-review">
          <strong>参考评分 {review.score} / 100</strong>
          {review.reasons.map((r, i) => (
            <p key={i}>{r}</p>
          ))}
          {review.warnings.length ? (
            <ul>
              {review.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : (
            <p>当前参考检查未发现问题。</p>
          )}
          <small>{review.note}</small>
        </div>
      )}
      <button className="button primary full" disabled={busy} onClick={onGenerate}>
        {busy ? '提交中…' : '保存需求并生成布局'}
      </button>
    </div>
  );
}
