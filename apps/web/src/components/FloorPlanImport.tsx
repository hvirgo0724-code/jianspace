import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, post, ApiError } from '../api';
import type { Asset, Capabilities, Job, Scene } from '../types';
import { id } from '../scene';
import { useNotice } from '../App';
import Plan2D from './Plan2D';
import { Spinner } from './UI';
const Scene3D = lazy(() => import('./Scene3D'));
type Draft = {
  scene: Scene;
  warnings: string[];
  sourceAssetId: string;
  requiresMeasurementConfirmation: boolean;
  roomCount: number;
};
export default function FloorPlanImport({
  projectId,
  assets,
  caps,
  onBeforeGenerate,
  onApply,
}: {
  projectId: string;
  assets: Asset[];
  caps?: Capabilities;
  onBeforeGenerate: () => Promise<unknown>;
  onApply: (scene: Scene) => void;
}) {
  const qc = useQueryClient(),
    notice = useNotice();
  const [source, setSource] = useState(assets.find((a) => a.kind === 'floorplan')?.id || '');
  const [width, setWidth] = useState(10000),
    [height, setHeight] = useState(2800),
    [busy, setBusy] = useState(false),
    [jobId, setJobId] = useState(
      () => sessionStorage.getItem('jianspace-plan-job:' + projectId) || '',
    ),
    [resultId, setResultId] = useState(''),
    [view, setView] = useState<'2d' | '3d'>('2d'),
    [ack, setAck] = useState(false);
  const sending = useRef(false);
  const cost = caps?.aiPlanCredits ?? 5;
  const job = useQuery({
    queryKey: ['plan-job', jobId],
    queryFn: () => api<Job>('/jobs/' + jobId),
    enabled: !!jobId,
    refetchInterval: (q) =>
      !q.state.data || ['queued', 'running', 'cancel_requested'].includes(q.state.data.status)
        ? 1500
        : false,
  });
  const active =
    !!jobId && (!job.data || ['queued', 'running', 'cancel_requested'].includes(job.data.status));
  const draft = useQuery({
    queryKey: ['recognized-plan', resultId],
    queryFn: () => api<Draft>('/assets/' + resultId + '/content'),
    enabled: !!resultId,
  });
  useEffect(() => {
    if (!job.data || ['queued', 'running', 'cancel_requested'].includes(job.data.status)) return;
    void qc.invalidateQueries({ queryKey: ['assets', projectId] });
    void qc.invalidateQueries({ queryKey: ['credits'] });
    void qc.invalidateQueries({ queryKey: ['jobs', projectId] });
    if (job.data.status === 'succeeded' && job.data.output.assets?.[0])
      setResultId(job.data.output.assets[0].id);
  }, [job.data?.status, job.data?.id, qc, projectId]);
  const credits = useQuery({
    queryKey: ['credits'],
    queryFn: () => api<{ available: number; reserved: number }>('/credits'),
  });
  async function upload(file: File) {
    if (file.size > 15 * 1024 * 1024) {
      notice('平面图不能超过 15 MB。', true);
      return;
    }
    setBusy(true);
    try {
      const data = new FormData();
      data.append('file', file);
      data.append('kind', 'floorplan');
      const asset = await api<Asset>('/projects/' + projectId + '/assets', {
        method: 'POST',
        body: data,
      });
      await qc.invalidateQueries({ queryKey: ['assets', projectId] });
      setSource(asset.id);
      setAck(false);
    } catch (e) {
      notice((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function generate() {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setAck(false);
    const storageKey = `jianspace-plan-submit:${projectId}:${source}:${width}:${height}`;
    let key = sessionStorage.getItem(storageKey);
    if (!key) {
      key = id();
      sessionStorage.setItem(storageKey, key);
    }
    try {
      await onBeforeGenerate();
      const created = await post<Job>(
        '/projects/' + projectId + '/jobs',
        {
          type: 'recognize',
          assetIds: [source],
          parameters: { planWidthMm: width, heightMm: height },
          maxCredits: cost,
        },
        { 'Idempotency-Key': key },
      );
      sessionStorage.removeItem(storageKey);
      sessionStorage.setItem('jianspace-plan-job:' + projectId, created.id);
      setJobId(created.id);
      setResultId('');
      void qc.invalidateQueries({ queryKey: ['credits'] });
      void qc.invalidateQueries({ queryKey: ['jobs', projectId] });
    } catch (e) {
      if (e instanceof ApiError && e.status < 500) sessionStorage.removeItem(storageKey);
      notice((e as Error).message, true);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="floorplan-import">
      <p>
        上传清晰的单层平面图，识别房间和门窗后构建可编辑的 2D/3D
        草稿。当前按轴对齐房间近似；斜墙、弧墙、复杂楼梯需校正，不会自动标成实测。
      </p>
      <ol className="floorplan-steps">
        <li>
          <strong>上传图纸</strong>
          <span>单层、清晰、无遮挡</span>
        </li>
        <li>
          <strong>填写尺寸</strong>
          <span>外轮廓总宽与本层层高</span>
        </li>
        <li>
          <strong>预览载入</strong>
          <span>复核后载入未确认草稿</span>
        </li>
      </ol>
      <label className="floorplan-drop">
        <Upload size={22} />
        <strong>点击选择平面图</strong>
        <span>JPEG / PNG / WebP，不超过 15 MB</span>
        <input
          aria-label="上传房屋平面图"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy || active}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = '';
          }}
        />
      </label>
      <label>
        选择平面图
        <select
          aria-label="选择平面图"
          value={source}
          disabled={busy || active}
          onChange={(e) => setSource(e.target.value)}
        >
          <option value="">请选择</option>
          {assets
            .filter((a) => a.kind === 'floorplan')
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
      </label>
      {source && (
        <img
          className="floorplan-source"
          src={'/api/assets/' + source + '/content'}
          alt="待识别的原始房屋平面图"
        />
      )}
      <div className="input-grid">
        <label>
          建筑外轮廓总宽 / mm
          <input
            aria-label="平面图总宽 mm"
            type="number"
            min={2000}
            max={100000}
            step={1}
            value={width}
            disabled={busy || active}
            onChange={(e) => setWidth(Number(e.target.value))}
          />
        </label>
        <label>
          本层层高 / mm
          <input
            aria-label="识别层高 mm"
            type="number"
            min={2000}
            max={8000}
            value={height}
            disabled={busy || active}
            onChange={(e) => setHeight(Number(e.target.value))}
          />
        </label>
      </div>
      <p className="fine-print">
        总宽指建筑轮廓，不包括图纸留白、尺寸标注或图框；不清楚时应先测量。图片会发送至已配置的百炼视觉服务，识别消耗服务商
        token，用量另计。一次成功任务结算 {cost} 应用积分，失败释放；超时不自动重试。
      </p>
      <p>
        可用应用积分 {credits.data?.available ?? '—'}
        {credits.data?.reserved ? ` · 已冻结 ${credits.data.reserved}` : ''}
      </p>
      {!caps?.aiPlan && <p role="status">视觉识别服务未启用，请配置服务端密钥和视觉模型。</p>}
      <button
        className="button primary full"
        disabled={
          !source ||
          !caps?.aiPlan ||
          busy ||
          active ||
          !Number.isInteger(width) ||
          width < 2000 ||
          width > 100000 ||
          !Number.isInteger(height) ||
          height < 2000 ||
          height > 8000 ||
          (credits.data?.available ?? 0) < cost
        }
        onClick={() => void generate()}
      >
        {busy ? '正在提交…' : active ? '识别与构建中…' : `确认识别并构建 · ${cost} 应用积分`}
      </button>
      {active && (
        <p role="status">
          识别任务已保存，可关闭面板稍后回来查看。
          <button
            className="button ghost compact"
            onClick={() =>
              void post('/jobs/' + jobId + '/cancel', {})
                .then(() => job.refetch())
                .catch((e) => notice(e.message, true))
            }
          >
            取消识别
          </button>
        </p>
      )}
      {job.data?.error && (
        <p role="alert">
          {job.data.error.message}（{job.data.error.code}）
        </p>
      )}
      <details open={!jobId}>
        <summary>已生成的识别草稿</summary>
        {assets
          .filter((a) => a.kind === 'recognized_plan')
          .map((a) => (
            <button
              className="button outline compact"
              key={a.id}
              onClick={() => {
                setResultId(a.id);
                setAck(false);
              }}
            >
              {a.name} · {a.id.slice(0, 8)}
            </button>
          ))}
      </details>
      {resultId &&
        (draft.isPending ? (
          <Spinner label="读取识别草稿…" />
        ) : draft.isError ? (
          <p role="alert">识别结果读取失败，请重新打开。</p>
        ) : (
          draft.data && (
            <>
              <h3>识别出 {draft.data.roomCount} 个空间 · 待核对尺寸</h3>
              <ul className="floorplan-warnings">
                {draft.data.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
              <div className="segmented">
                <button aria-pressed={view === '2d'} onClick={() => setView('2d')}>
                  识别平面
                </button>
                <button aria-pressed={view === '3d'} onClick={() => setView('3d')}>
                  构建 3D 预览
                </button>
              </div>
              <div className="floorplan-preview">
                {view === '2d' ? (
                  <Plan2D scene={draft.data.scene} readOnly />
                ) : (
                  <Suspense fallback={<Spinner />}>
                    <Scene3D scene={draft.data.scene} />
                  </Suspense>
                )}
              </div>
              <label className="floorplan-ack">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                我会复核墙线、门窗及每个房间尺寸，仅载入为未确认草稿。当前草稿将被替换，可撤销；已有保存版本保留。
              </label>
              <button
                className="button primary full"
                disabled={!ack || busy || active}
                onClick={() => onApply(draft.data.scene)}
              >
                载入识别草稿并进入 3D
              </button>
            </>
          )
        ))}
    </section>
  );
}
