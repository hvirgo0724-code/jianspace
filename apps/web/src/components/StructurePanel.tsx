import { useScene } from '../store';
import { id, activeFloor } from '../scene';
import { useNotice } from '../App';
export default function StructurePanel({ onValidate }: { onValidate: () => void }) {
  const st = useScene(),
    notify = useNotice();
  if (!st.scene) return null;
  const scene = st.scene,
    floor = activeFloor(scene, st.floorId);
  const apply = (form: HTMLFormElement, stairId?: string) => {
    const d = new FormData(form);
    st.change((s) => {
      const f = activeFloor(s, floor.id);
      if (!stairId) f.elevationMm = Number(d.get('elevation'));
      else {
        const stair = f.stairs!.find((x) => x.id === stairId)!;
        stair.startMm = [Number(d.get('sx')), Number(d.get('sy'))];
        stair.endMm = [Number(d.get('ex')), Number(d.get('ey'))];
        stair.widthMm = Number(d.get('width'));
        stair.stepCount = Number(d.get('steps'));
        stair.targetFloorId = String(d.get('target'));
      }
      s.confirmation = {
        status: 'draft',
        measurementRevision: s.confirmation.measurementRevision + 1,
      };
    });
    notify('结构参数已更新，需要重新校验和确认实测。');
    onValidate();
  };
  return (
    <details className="structure-panel">
      <summary>楼层与楼梯参数</summary>
      <form
        key={floor.id + '-level'}
        onSubmit={(e) => {
          e.preventDefault();
          apply(e.currentTarget);
        }}
      >
        <label>
          本层标高 / mm
          <input
            name="elevation"
            type="number"
            step="1"
            min="-100000"
            max="100000"
            required
            defaultValue={floor.elevationMm}
          />
        </label>
        <button className="button outline compact">应用楼层标高</button>
      </form>
      {(floor.stairs || []).map((stair) => (
        <form
          key={stair.id + JSON.stringify(stair)}
          onSubmit={(e) => {
            e.preventDefault();
            apply(e.currentTarget, stair.id);
          }}
        >
          <h4>直跑楼梯 · {stair.id.slice(0, 18)}</h4>
          <div className="input-grid">
            {[
              ['sx', '起点 X', stair.startMm[0]],
              ['sy', '起点 Y', stair.startMm[1]],
              ['ex', '终点 X', stair.endMm[0]],
              ['ey', '终点 Y', stair.endMm[1]],
              ['width', '梯段宽', stair.widthMm],
              ['steps', '踏步数', stair.stepCount],
            ].map(([key, title, value]) => (
              <label key={String(key)}>
                {title}
                <input
                  name={String(key)}
                  type="number"
                  required
                  step="1"
                  min={key === 'steps' ? 3 : key === 'width' ? 600 : -100000}
                  max={key === 'steps' ? 40 : key === 'width' ? 3000 : 100000}
                  defaultValue={value}
                />
              </label>
            ))}
          </div>
          <label>
            到达楼层
            <select name="target" defaultValue={stair.targetFloorId}>
              {scene.floors
                .filter((f) => f.id !== floor.id)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </select>
          </label>
          <button className="button outline full">应用楼梯参数并校验</button>
          <button
            type="button"
            className="button ghost full"
            onClick={() =>
              st.change((s) => {
                activeFloor(s, floor.id).stairs = activeFloor(s, floor.id).stairs?.filter(
                  (x) => x.id !== stair.id,
                );
                s.confirmation.status = 'draft';
              })
            }
          >
            移除参考楼梯
          </button>
        </form>
      ))}
      {scene.floors.some((f) => f.elevationMm > floor.elevationMm) && (
        <button
          className="button outline full"
          type="button"
          onClick={() => {
            const target = scene.floors.find((f) => f.elevationMm > floor.elevationMm)!;
            const p = floor.rooms[0].boundaryMm,
              xs = p.map((v) => v[0]),
              ys = p.map((v) => v[1]);
            const cx = Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
              y = Math.min(...ys) + 300;
            st.change((s) => {
              const f = activeFloor(s, floor.id);
              f.stairs = [
                ...(f.stairs || []),
                {
                  id: 'stair-' + id(),
                  startMm: [cx, y],
                  endMm: [cx, y + 3000],
                  widthMm: 1000,
                  targetFloorId: target.id,
                  stepCount: 18,
                },
              ];
              s.confirmation.status = 'draft';
            });
            notify('已添加参考楼梯，请按实测调整起终点并校验平台位置。');
          }}
        >
          添加直跑参考楼梯
        </button>
      )}
      <p className="fine-print">
        坐标与宽度单位
        mm。标高差决定梯高；调整后需复核洞口、平台与上下层对位。跨层漫游仍使用楼层切换。
      </p>
    </details>
  );
}
