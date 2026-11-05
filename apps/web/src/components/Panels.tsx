import { useState, useRef, lazy, Suspense } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  UploadCloud,
  ImagePlus,
  Sparkles,
  Trash2,
  Download,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  XCircle,
  MessageSquare,
  Users,
  TriangleAlert,
  Pencil,
  SlidersHorizontal,
  Paintbrush,
  Columns2,
} from 'lucide-react';
import { api, post } from '../api';
import type { Scene, Asset, Design, Style, Job } from '../types';
import { useNotice } from '../App';
import { Empty, Spinner, Money, Modal } from './UI';
import {
  PHOTO_DIRECTIONS,
  filterPhotos,
  photoKindLabel,
  photoNote,
  photoPosition,
  photoSummary,
  roomName,
  sourceAsset,
} from '../photoLibrary';
import BeforeAfter from './BeforeAfter';
import { FloorPlanPreview } from './Plan2D';
import RenovationBudget from './RenovationBudget';
import AiResultReview from './AiResultReview';
import {
  assetModel,
  jobCreditSummary,
  jobProvider,
  structuralAudit,
  uncertainProviderResult,
} from '../aiWorkflow';
const Scene3D = lazy(() => import('./Scene3D'));

export function PhotosPanel({
  projectId,
  scene,
  assets,
  onAI,
  onInpaint,
  onRevise,
}: {
  projectId: string;
  scene: Scene;
  assets: Asset[];
  onAI: (id: string) => void;
  onInpaint?: (asset: Asset) => void;
  onRevise?: (sourceIds: string[], roomId: string, instruction: string) => void;
}) {
  const notify = useNotice(),
    qc = useQueryClient(),
    input = useRef<HTMLInputElement>(null),
    [uploading, setUploading] = useState(false),
    [saving, setSaving] = useState(false),
    [removing, setRemoving] = useState(false),
    [deleting, setDeleting] = useState<Asset | null>(null),
    [editing, setEditing] = useState<Asset | null>(null),
    [compare, setCompare] = useState<{ before: Asset; after: Asset } | null>(null),
    [roomFilter, setRoomFilter] = useState(''),
    [kindFilter, setKindFilter] = useState<'' | 'photo' | 'style' | 'inpaint'>(''),
    [directionFilter, setDirectionFilter] = useState(''),
    [room, setRoom] = useState(scene.floors[0].rooms[0]?.id || '');
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(files).slice(0, 12)) {
        const body = new FormData();
        body.append('file', f);
        if (room) body.append('roomId', room);
        await api('/projects/' + projectId + '/assets', { method: 'POST', body });
      }
      await qc.invalidateQueries({ queryKey: ['assets', projectId] });
      notify('照片已上传，原始 EXIF 信息已清除。');
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  }
  async function removeAsset() {
    if (!deleting) return;
    setRemoving(true);
    try {
      await api('/assets/' + deleting.id, { method: 'DELETE' });
      await qc.invalidateQueries({ queryKey: ['assets', projectId] });
      notify('图片已移除。');
      setDeleting(null);
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setRemoving(false);
    }
  }
  const photos = assets.filter((a) => a.kind === 'photo' || a.kind === 'generated');
  const visible = filterPhotos(photos, {
    roomId: roomFilter,
    direction: directionFilter,
    kind: kindFilter,
  });
  const rooms = scene.floors.flatMap((f) => f.rooms);
  return (
    <>
      <div className="page-intro">
        <div>
          <h2>给空间留下真实的参照</h2>
          <p>上传毛坯房或现有房间照片，用于装修风格探索。</p>
        </div>
        <label>
          关联房间
          <select value={room} onChange={(e) => setRoom(e.target.value)}>
            {scene.floors
              .flatMap((f) => f.rooms)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {scene.floors.length > 1 &&
                    `${scene.floors.find((f) => f.rooms.some((room) => room.id === r.id))?.name} / `}
                  {r.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      <div className="photo-filters">
        <span>
          <SlidersHorizontal size={14} />
          整理照片
        </span>
        <label>
          类型
          <select
            value={kindFilter}
            onChange={(e) =>
              setKindFilter(e.target.value as '' | 'photo' | 'style' | 'inpaint')
            }
          >
            <option value="">全部类型</option>
            <option value="photo">房间照片</option>
            <option value="style">AI 效果图</option>
            <option value="inpaint">局部改图</option>
          </select>
        </label>
        <label>
          房间
          <select value={roomFilter} onChange={(e) => setRoomFilter(e.target.value)}>
            <option value="">全部房间</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          方向
          <select
            value={directionFilter}
            onChange={(e) => setDirectionFilter(e.target.value)}
          >
            <option value="">全部方向</option>
            {PHOTO_DIRECTIONS.map((d) => (
              <option key={d.code} value={d.code}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <small>
          显示 {visible.length} / {photos.length} 张
        </small>
      </div>
      <div
        className="upload-zone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!uploading) upload(e.dataTransfer.files);
        }}
      >
        <UploadCloud size={33} strokeWidth={1.2} />
        <h3>{uploading ? '正在安全处理照片…' : '把房间照片拖到这里'}</h3>
        <p>JPEG、PNG、WebP · 单张不超过 15 MB · 每次最多 12 张</p>
        <button
          className="button outline"
          disabled={uploading}
          onClick={() => input.current?.click()}
        >
          <ImagePlus size={16} />
          选择照片
        </button>
        <input
          hidden
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={(e) => upload(e.target.files)}
        />
      </div>
      <div className="privacy-note">
        <CheckCircle2 size={16} />
        照片经过旋转校正、缩放与元数据清除后私有保存。单张照片无法可靠恢复精确户型。
      </div>
      {!visible.length && (
        <Empty title={photos.length ? '没有符合筛选的照片' : '还没有房间照片'}>
          {photos.length ? (
            <button
              className="button outline"
              onClick={() => {
                setRoomFilter('');
                setKindFilter('');
                setDirectionFilter('');
              }}
            >
              清除筛选
            </button>
          ) : (
            <p>上传第一张房间照片，按房间、方向和拍摄位置整理。</p>
          )}
        </Empty>
      )}
      <div className="photo-grid">
        {visible.map((a) => (
          <article className="photo-card" key={a.id}>
            <a href={a.url} target="_blank" rel="noreferrer">
              <img src={a.thumbUrl || a.url} alt={a.name} loading="lazy" decoding="async" />
            </a>
            <div>
              <h3>{a.name}</h3>
              <p className="photo-meta">
                {photoSummary(a, scene)} · {photoKindLabel(a)}
                {a.kind === 'photo' ? ' · ' + (a.bytes / 1024).toFixed(0) + ' KB' : ''}
                {a.metadata.referenceType === 'scene_capture' ? ' · 3D 视角参考，非实拍' : ''}
              </p>
              {a.kind === 'generated' && sourceAsset(a, assets) && (
                <p className="photo-lineage">源自：{sourceAsset(a, assets)?.name}</p>
              )}
              {a.kind === 'photo' && photoNote(a) && (
                <p className="photo-note">{photoNote(a)}</p>
              )}
              {a.kind === 'generated' && (
                <AiResultReview
                  asset={a}
                  assets={assets}
                  projectId={projectId}
                  onRevise={onRevise}
                />
              )}
              {a.kind === 'generated' && assetModel(a) && (
                <p>
                  生成模型：{assetModel(a)}
                  {a.metadata.fallbackUsed === true ? ' · 备用模型' : ''}
                </p>
              )}
              {a.metadata.verificationOnly === true && (
                <p className="fine-print">开发验收结果，输入为合成参考与虚构尺寸。</p>
              )}
              <footer>
                {a.kind === 'photo' && (
                  <button onClick={() => onAI(a.id)}>
                    <Sparkles size={15} />
                    探索装修效果
                  </button>
                )}
                {onInpaint && (a.kind === 'photo' || a.kind === 'generated') && (
                  <button onClick={() => onInpaint(a)}>
                    <Paintbrush size={15} />
                    局部改图
                  </button>
                )}
                {a.kind === 'generated' && sourceAsset(a, assets) && (
                  <button
                    onClick={() => {
                      const before = sourceAsset(a, assets);
                      if (before) setCompare({ before, after: a });
                    }}
                  >
                    <Columns2 size={15} />
                    前后对比
                  </button>
                )}
                {a.kind === 'photo' && (
                  <button onClick={() => setEditing(a)}>
                    <Pencil size={15} />
                    拍摄信息
                  </button>
                )}
                <button
                  className="icon-button"
                  aria-label="移除照片"
                  onClick={() => setDeleting(a)}
                >
                  <Trash2 size={16} />
                </button>
              </footer>
            </div>
          </article>
        ))}
      </div>
      {deleting && (
        <Modal title="移除这张图片？" onClose={() => setDeleting(null)}>
          <p className="muted">
            “{deleting.name}”将从项目照片页移除，已生成的历史结果不受影响。当前没有回收站或恢复入口。
          </p>
          <div className="modal-actions">
            <button className="button ghost" onClick={() => setDeleting(null)}>
              取消
            </button>
            <button className="button danger" disabled={removing} onClick={() => void removeAsset()}>
              {removing ? '正在移除…' : '确认移除'}
            </button>
          </div>
        </Modal>
      )}
      {compare && (
        <Modal
          title={'前后对比 · ' + photoKindLabel(compare.after)}
          onClose={() => setCompare(null)}
          wide
        >
          <p className="muted">
            拖动分隔线查看修改前后；局部改图未涂抹的区域应与底图保持一致。
          </p>
          <BeforeAfter
            before={compare.before.url}
            after={compare.after.url}
            afterLabel={photoKindLabel(compare.after)}
          />
        </Modal>
      )}
      {editing && (
        <Modal
          title={'整理拍摄信息 · ' + roomName(scene, editing.roomId)}
          onClose={() => setEditing(null)}
        >
          <p className="muted">
            按房间、拍摄方向和位置整理照片，生成效果图时只会使用所选房间的照片。
          </p>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              setSaving(true);
              try {
                await api('/assets/' + editing.id, {
                  method: 'PATCH',
                  body: JSON.stringify({
                    roomId: String(data.get('roomId') || '') || null,
                    direction: String(data.get('direction') || '') || null,
                    position: String(data.get('position') || ''),
                    note: String(data.get('note') || ''),
                  }),
                });
                await qc.invalidateQueries({ queryKey: ['assets', projectId] });
                setEditing(null);
                notify('拍摄信息已更新。');
              } catch (error) {
                notify((error as Error).message, true);
              } finally {
                setSaving(false);
              }
            }}
          >
            <label>
              关联房间
              <select name="roomId" defaultValue={editing.roomId || ''}>
                <option value="">未关联</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              拍摄方向
              <select name="direction" defaultValue={String(editing.metadata.direction || '')}>
                <option value="">未标注</option>
                {PHOTO_DIRECTIONS.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              拍摄位置
              <input
                name="position"
                maxLength={120}
                defaultValue={photoPosition(editing)}
                placeholder="如：门口、窗边、床头"
              />
            </label>
            <label>
              备注
              <textarea
                name="note"
                maxLength={500}
                defaultValue={photoNote(editing)}
                placeholder="记录逆光、遮挡或待补测的事项"
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="button ghost"
                onClick={() => setEditing(null)}
              >
                取消
              </button>
              <button className="button primary" disabled={saving}>
                {saving ? '正在保存…' : '保存拍摄信息'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
export function VersionsPanel({
  projectId,
  designs,
  styles,
  onApply,
}: {
  projectId: string;
  designs: Design[];
  styles: Style[];
  onApply: (d: Design) => void;
}) {
  const [left, setLeft] = useState(''),
    [right, setRight] = useState(''),
    [view, setView] = useState('2d'),
    [comment, setComment] = useState(''),
    notify = useNotice(),
    qc = useQueryClient();
  const a = designs.find((d) => d.id === left) || designs[0],
    b = designs.find((d) => d.id === right) || designs[1] || designs[0];
  const comments = useQuery({
    queryKey: ['comments', projectId, a?.id],
    queryFn: () =>
      api<{ items: { id: string; body: string; createdAt: string }[] }>(
        `/projects/${projectId}/comments?designId=${a.id}`,
      ),
    enabled: !!a,
  });
  if (!designs.length)
    return (
      <Empty title="还没有保存的方案">
        <p>确认实测后保存一个方案，或生成布局，即可在这里比较。</p>
      </Empty>
    );
  return (
    <>
      <div className="page-intro">
        <div>
          <h2>让不同的可能，放在一起看</h2>
          <p>{designs.length} 个不可变方案版本 · 载入版本会更新草稿，保留原方案</p>
        </div>
        <div className="segmented">
          <button className={view === '2d' ? 'active' : ''} onClick={() => setView('2d')}>
            2D 比较
          </button>
          <button className={view === '3d' ? 'active' : ''} onClick={() => setView('3d')}>
            3D 比较
          </button>
        </div>
      </div>
      <div className="comparison-grid">
        {[a, b].map((d, i) => (
          <section className="comparison-card" key={i}>
            <header>
              <select
                value={d.id}
                onChange={(e) => (i === 0 ? setLeft(e.target.value) : setRight(e.target.value))}
              >
                {designs.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.title}
                  </option>
                ))}
              </select>
              <span>{new Date(d.createdAt).toLocaleDateString('zh-CN')}</span>
            </header>
            <div className="comparison-view">
              {view === '2d' ? (
                <FloorPlanPreview scene={d.scene} />
              ) : (
                <Suspense fallback={<Spinner />}>
                  <Scene3D
                    scene={d.scene}
                    style={styles.find((s) => s.id === d.scene.layout.styleId)}
                  />
                </Suspense>
              )}
            </div>
            {d.scene.layout.analysis && (
              <div className="layout-review">
                <strong>参考评分 {d.scene.layout.analysis.score} / 100</strong>
                {d.scene.layout.analysis.reasons.map((r, i) => (
                  <p key={i}>{r}</p>
                ))}
                {d.scene.layout.analysis.warnings.map((r, i) => (
                  <p className="warning" key={i}>
                    {r}
                  </p>
                ))}
              </div>
            )}
            <footer>
              <span>
                {d.scene.layout.furniture.length} 件家具 ·{' '}
                {styles.find((s) => s.id === d.scene.layout.styleId)?.name || '自定义'}
              </span>
              <button className="button outline compact" onClick={() => onApply(d)}>
                载入为草稿 <ArrowUpRight size={15} />
              </button>
            </footer>
          </section>
        ))}
      </div>
      <section className="comments-panel">
        <h3>
          <MessageSquare size={18} />
          对「{a.title}」的意见
        </h3>
        {comments.data?.items.map((c) => (
          <div className="comment" key={c.id}>
            <p>{c.body}</p>
            <small>{new Date(c.createdAt).toLocaleString('zh-CN')}</small>
          </div>
        ))}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await post('/projects/' + projectId + '/comments', { designId: a.id, body: comment });
              setComment('');
              qc.invalidateQueries({ queryKey: ['comments', projectId, a.id] });
            } catch (err) {
              notify((err as Error).message, true);
            }
          }}
        >
          <input
            required
            maxLength={2000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="记录对这个方案的想法…"
          />
          <button className="button primary">添加意见</button>
        </form>
        <div className="approval-actions">
          <span>对当前版本的决定</span>
          {[
            { id: 'approved', label: '认可方案' },
            { id: 'changes_requested', label: '需要调整' },
          ].map((d) => (
            <button
              key={d.id}
              className="button ghost compact"
              onClick={async () => {
                try {
                  await post('/projects/' + projectId + '/approvals', {
                    designId: a.id,
                    decision: d.id,
                    note: '',
                  });
                  notify('已记录：' + d.label);
                } catch (e) {
                  notify((e as Error).message, true);
                }
              }}
            >
              {d.label}
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
export function BudgetPanel({
  scene,
  onExport,
  projectId,
}: {
  scene: Scene;
  onExport: () => void;
  projectId: string;
}) {
  const catalog = new Map(scene.layout.catalogSnapshot.map((c) => [c.skuId, c])),
    rooms = new Map(
      scene.floors.flatMap((f) =>
        f.rooms.map(
          (r) => [r.id, scene.floors.length > 1 ? `${f.name} / ${r.name}` : r.name] as const,
        ),
      ),
    );
  const lines = scene.layout.furniture.map((f) => ({
    ...catalog.get(f.skuId),
    id: f.id,
    roomName: rooms.get(f.roomId),
    sizeMm: f.sizeMm,
  }));
  const total = lines.reduce((s, c) => s + (c.priceMinor || 0), 0),
    unknown = lines.filter((c) => c.priceMinor == null).length;
  return (
    <>
      <div className="page-intro">
        <div>
          <h2>把家的想法，落到清单上</h2>
          <p>按实测工程量录入材料、人工和家具报价，补充水电与安装费用。</p>
        </div>
        <button className="button outline" onClick={onExport}>
          <Download size={16} />
          导出 CSV
        </button>
      </div>
      <RenovationBudget scene={scene} projectId={projectId} />
      <h3>家具家电报价明细</h3>
      <div className="budget-summary">
        <div>
          <span>已知家具家电小计</span>
          <strong>
            <Money value={total} />
          </strong>
          <small>仅合计已填写价格的项目</small>
        </div>
        <div>
          <span>待询价项目</span>
          <strong>
            {unknown}
            <em> 项</em>
          </strong>
          <small>未知价格没有按免费计入总额</small>
        </div>
        <div>
          <span>家具家电数量</span>
          <strong>
            {lines.length}
            <em> 件</em>
          </strong>
          <small>价格在家具属性中填写</small>
        </div>
      </div>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>物品名称</th>
              <th>所属房间</th>
              <th>尺寸 / mm</th>
              <th>数量</th>
              <th>单价</th>
              <th>来源</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((c) => (
              <tr key={c.id}>
                <td>
                  <strong>{c.name || '自定义家具'}</strong>
                </td>
                <td>{c.roomName}</td>
                <td className="mono">{c.sizeMm.join(' × ')}</td>
                <td>1 件</td>
                <td className={c.priceMinor == null ? 'unknown-price' : ''}>
                  <Money value={c.priceMinor} />
                </td>
                <td>
                  {c.sourceType === 'fixture' ? (
                    <span className="tag amber">演示夹具价格</span>
                  ) : c.sourceType === 'user_input' ? (
                    <span className="tag">用户录入</span>
                  ) : (
                    '待核实'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!lines.length && <Empty title="当前空间还没有家具或家电" />}
      </div>
      <div className="budget-note">
        <TriangleAlert size={18} />
        <div>
          <strong>估算说明</strong>
          <p>
            内置示例价格用于研发演示，不是实时商家报价。请在采购前核实商品、尺寸、数量、运费与安装费。未询价项目不计入已知小计。
          </p>
        </div>
      </div>
    </>
  );
}
const jobNames: Record<string, string> = {
  layout: '规则布局生成',
  style: 'AI 装修效果',
  render: 'AI 装修效果',
  inpaint: '带蒙版局部改图',
  recognize: '平面图识别与 3D 构建',
  export: '方案文件导出',
};
const statusNames: Record<string, string> = {
  queued: '等待处理',
  running: '正在生成',
  cancel_requested: '正在取消',
  cancelled: '已取消',
  succeeded: '已完成',
  failed: '处理失败',
};
function JobProviderDetails({ job }: { job: Job }) {
  const provider = jobProvider(job.output);
  if (!provider) return null;
  return (
    <div className="fine-print">
      {provider.requestedModel && <p>请求主模型：{provider.requestedModel}</p>}
      {provider.model && (
        <p>
          返回结果模型：{provider.model}
          {provider.fallbackUsed ? ' · 已切换备用' : ''}
        </p>
      )}
      {provider.attempts.length > 0 && (
        <details>
          <summary>模型尝试记录（{provider.attempts.length}）</summary>
          <ol>
            {provider.attempts.map((attempt, i) => (
              <li key={i}>
                {attempt.model} · {attempt.status}
                {attempt.httpStatus !== null ? ` · HTTP ${attempt.httpStatus}` : ''}
                {attempt.code ? ` · ${attempt.code}` : ''}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
export function JobsPanel({
  jobs,
  onCancel,
  onVersions,
  onPhotos,
}: {
  jobs: Job[];
  onCancel: (id: string) => void | Promise<unknown>;
  onVersions: () => void;
  onPhotos?: () => void;
}) {
  const cancelling = useRef(new Set<string>());
  const [cancelIds, setCancelIds] = useState<string[]>([]);
  const notify = useNotice();
  async function cancel(id: string) {
    if (cancelling.current.has(id)) return;
    cancelling.current.add(id);
    setCancelIds([...cancelling.current]);
    try {
      await onCancel(id);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : '取消请求失败，请检查任务状态后再尝试。',
        true,
      );
    } finally {
      cancelling.current.delete(id);
      setCancelIds([...cancelling.current]);
    }
  }
  return (
    <>
      <div className="page-intro">
        <div>
          <h2>每一次探索，都有记录</h2>
          <p>查看生成进度、下载导出文件，或继续打磨新的布局。</p>
        </div>
        <span className="tag">自动更新</span>
      </div>
      {!jobs.length ? (
        <Empty title="还没有生成任务">
          <p>在空间设计中生成布局，或导出一份方案。</p>
        </Empty>
      ) : (
        <div className="job-list">
          {jobs.map((j) => (
            <article className={'job-card ' + j.status} key={j.id}>
              <div className="job-icon">
                {j.status === 'succeeded' ? (
                  <CheckCircle2 size={22} />
                ) : j.status === 'failed' ? (
                  <XCircle size={22} />
                ) : j.status === 'running' ? (
                  <Sparkles size={22} className="pulse" />
                ) : (
                  <Clock3 size={22} />
                )}
              </div>
              <div className="job-content">
                <header>
                  <h3>{jobNames[j.type] || j.type}</h3>
                  <span className={'status-pill ' + j.status}>
                    {statusNames[j.status] || j.status}
                  </span>
                </header>
                <p>
                  {new Date(j.createdAt).toLocaleString('zh-CN')} <i />{' '}
                  {jobCreditSummary(j as Job & { reservedCredits?: number })}
                </p>
                <JobProviderDetails job={j} />
                {['running', 'cancel_requested'].includes(j.status) && (
                  <div className="progress-track">
                    <i style={{ width: Math.max(j.progress, 15) + '%' }} />
                  </div>
                )}
                {j.error && (
                  <div className="job-error">
                    {j.error.message}
                    <small>{j.error.code}</small>
                  </div>
                )}
                {['style', 'render', 'inpaint', 'recognize'].includes(j.type) &&
                  ['queued', 'running', 'cancel_requested'].includes(j.status) && (
                    <p className="fine-print">
                      应用积分在成功后结算。若服务商已经接收请求，取消任务仍可能产生服务商用量。
                    </p>
                  )}
                {uncertainProviderResult(j) && (
                  <p className="inline-note warning">
                    请先核对百炼调用记录与账单。应用积分状态不代表服务商未产生用量，当前不会自动重新生图。
                  </p>
                )}
                {j.output?.designIds && (
                  <div className="job-result">
                    <span>生成了 {j.output.designIds.length} 个通过约束校验的布局方案</span>
                    <button className="button outline compact" onClick={onVersions}>
                      比较方案 <ArrowUpRight size={15} />
                    </button>
                  </div>
                )}
                {j.output?.limitations && (
                  <p className="fine-print">{j.output.limitations.join('；')}</p>
                )}
                {j.output?.assets?.map((a) => (
                  <div className="job-result" key={a.id}>
                    {a.mediaType.startsWith('image/') && (
                      <a href={a.url} target="_blank" rel="noreferrer">
                        <img
                          src={a.thumbUrl || a.url}
                          alt="AI 装修概念效果"
                          loading="lazy"
                          decoding="async"
                        />
                      </a>
                    )}
                    <span>{a.name}</span>
                    {assetModel(a) && (
                      <span>
                        实际模型：{assetModel(a)}
                        {a.metadata.fallbackUsed === true ? ' · 已切换备用' : ''}
                      </span>
                    )}
                    {a.metadata.structuralAudit !== undefined && (
                      <span>
                        结构检查：
                        {structuralAudit(a.metadata.structuralAudit)?.needsRevision
                          ? '发现差异，待调整'
                          : '仍需人工核对'}
                      </span>
                    )}
                    <a
                      className="button outline compact"
                      href={a.url}
                      download={a.name}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Download size={15} />
                      下载文件
                    </a>
                    {a.kind === 'generated' && onPhotos && (
                      <button className="button outline compact" onClick={onPhotos}>
                        查看效果与结构复核 <ArrowUpRight size={15} />
                      </button>
                    )}
                  </div>
                ))}
                {j.output?.note && <p className="fine-print">{j.output.note}</p>}
              </div>
              {['queued', 'running'].includes(j.status) && (
                <button
                  className="button ghost compact"
                  disabled={cancelIds.includes(j.id)}
                  onClick={() => void cancel(j.id)}
                >
                  {cancelIds.includes(j.id) ? '正在请求取消…' : '取消任务'}
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );
}
export function MeasurementsPanel({ scene }: { scene: Scene }) {
  return (
    <>
      <p className="muted">
        共 {scene.measurements.length} 条记录。当前版本由尺寸面板保存原始单位与毫米值。
      </p>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>对象</th>
              <th>测量项</th>
              <th>原始数值</th>
              <th>标准值 / mm</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            {scene.measurements.map((m) => (
              <tr key={m.id}>
                <td>
                  {scene.floors.flatMap((f) => f.rooms).find((r) => r.id === m.targetId)?.name ||
                    m.targetId}
                </td>
                <td>
                  {({ width: '宽度', depth: '进深', height: '层高' } as Record<string, string>)[
                    m.measurementType
                  ] || m.measurementType}
                </td>
                <td>
                  {m.rawValue} {m.rawUnit}
                </td>
                <td>{m.normalizedMm}</td>
                <td>{new Date(m.measuredAt).toLocaleString('zh-CN')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!scene.measurements.length && (
        <Empty title="还没有录入实测记录">
          <p>在实测面板填写尺寸并应用后，记录会出现在这里。</p>
        </Empty>
      )}
    </>
  );
}
export function MembersPanel({ projectId }: { projectId: string }) {
  const [expanded, setExpanded] = useState(false),
    notify = useNotice(),
    qc = useQueryClient();
  const members = useQuery({
    queryKey: ['members', projectId],
    queryFn: () =>
      api<{ items: { userId: string; displayName: string; email: string; role: string }[] }>(
        '/projects/' + projectId + '/members',
      ),
    enabled: expanded,
  });
  const shares = useQuery({
    queryKey: ['shares', projectId],
    queryFn: () =>
      api<{ items: { id: string; designId: string; revoked: boolean; expiresAt: number }[] }>(
        '/projects/' + projectId + '/shares',
      ),
    enabled: expanded,
  });
  return (
    <div className="members-panel">
      <button className="button ghost full" onClick={() => setExpanded(!expanded)}>
        <Users size={16} />
        管理成员与分享链接
      </button>
      {expanded && (
        <>
          <div className="member-list">
            {members.data?.items.map((m) => (
              <div key={m.userId}>
                <span>
                  {m.displayName}
                  <small>{m.email}</small>
                </span>
                <span className="tag">
                  {
                    (
                      { owner: '所有者', editor: '编辑者', viewer: '查看者' } as Record<
                        string,
                        string
                      >
                    )[m.role]
                  }
                </span>
              </div>
            ))}
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget,
                d = new FormData(form);
              try {
                await post('/projects/' + projectId + '/members', {
                  email: d.get('email'),
                  role: d.get('role'),
                });
                form.reset();
                qc.invalidateQueries({ queryKey: ['members', projectId] });
                notify('已添加项目成员。');
              } catch (err) {
                notify((err as Error).message, true);
              }
            }}
          >
            <label>
              添加已注册成员
              <input required type="email" name="email" placeholder="成员邮箱" />
            </label>
            <div className="input-grid">
              <select name="role">
                <option value="viewer">查看者</option>
                <option value="editor">编辑者</option>
              </select>
              <button className="button outline">添加成员</button>
            </div>
          </form>
          <div className="share-list">
            {shares.data?.items.map((s) => (
              <div key={s.id}>
                <span>只读链接 · {new Date(s.expiresAt * 1000).toLocaleDateString('zh-CN')}</span>
                <button
                  className="button ghost compact"
                  disabled={s.revoked}
                  onClick={async () => {
                    try {
                      await api('/shares/' + s.id, { method: 'DELETE' });
                      qc.invalidateQueries({ queryKey: ['shares', projectId] });
                      notify('链接已撤销。');
                    } catch (e) {
                      notify((e as Error).message, true);
                    }
                  }}
                >
                  {s.revoked ? '已撤销' : '撤销链接'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
