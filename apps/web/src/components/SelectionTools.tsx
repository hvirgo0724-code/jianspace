import { useState } from 'react';
import { useScene } from '../store';
import { alignSelected, duplicateSelected, moveSelected } from '../editorCommands';
import { useNotice } from '../App';
export default function SelectionTools() {
  const st = useScene(),
    notify = useNotice(),
    [dx, setX] = useState(100),
    [dy, setY] = useState(0);
  const items = st.scene?.layout.furniture.filter((f) => st.selectedIds.includes(f.id)) || [];
  const command = (fn: Parameters<typeof st.change>[0], message: string) => {
    try {
      st.change(fn);
      notify(message);
    } catch (e) {
      notify((e as Error).message, true);
    }
  };
  return (
    <div className="selection-tools">
      <button type="button" aria-pressed={st.multiSelect} onClick={st.toggleMulti}>
        多选 {st.multiSelect ? '开' : '关'}
      </button>
      {items.length > 0 && (
        <>
          <span>
            已选 {items.length} 件{items.some((f) => f.locked) ? ' · 锁定项跳过' : ''}
          </span>
          <button
            type="button"
            onClick={() => {
              let copied: string[] = [];
              command((s) => {
                copied = duplicateSelected(s, st.selectedIds);
              }, '副本已放入可用位置，请检查门口与通路。');
              if (copied.length) st.selectMany(copied);
            }}
          >
            复制
          </button>
          {items.length > 1 && (
            <select
              aria-label="批量对齐"
              defaultValue=""
              onChange={(e) => {
                const mode = e.target.value;
                if (mode)
                  command((s) => alignSelected(s, st.selectedIds, mode), '已对齐，请检查碰撞。');
                e.target.value = '';
              }}
            >
              <option value="">对齐…</option>
              {[
                ['left', '左边'],
                ['center', '水平居中'],
                ['right', '右边'],
                ['top', '上边'],
                ['middle', '垂直居中'],
                ['bottom', '下边'],
              ].map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          )}
          <label>
            ΔX
            <input
              aria-label="批量移动 X / mm"
              type="number"
              step="50"
              value={dx}
              onChange={(e) => setX(+e.target.value)}
            />
          </label>
          <label>
            ΔY
            <input
              aria-label="批量移动 Y / mm"
              type="number"
              step="50"
              value={dy}
              onChange={(e) => setY(+e.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={() =>
              command((s) => moveSelected(s, st.selectedIds, dx, dy), '位置已移动，请检查碰撞。')
            }
          >
            移动 mm
          </button>
          <button
            type="button"
            onClick={() =>
              command((s) => {
                s.layout.furniture = s.layout.furniture.filter(
                  (f) => !st.selectedIds.includes(f.id) || f.locked,
                );
                st.selectMany([]);
              }, '已移除未锁定物品。')
            }
          >
            移除
          </button>
        </>
      )}
      <small>Shift 点选可多选；拖动任一选中物品移动整组</small>
    </div>
  );
}
