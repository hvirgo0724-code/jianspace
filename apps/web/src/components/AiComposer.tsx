import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Scene, Asset, Capabilities, Style } from '../types';
import { api, post } from '../api';
import { instructionUsage, referenceLabel } from '../aiWorkflow';
type Context = {
  widthMm: number;
  depthMm: number;
  heightMm: number;
  imageDataUrl: string;
  structureHash: string;
  note: string;
  instructionLimitBytes?: number;
};
export default function AiComposer({
  scene,
  assets,
  projectId,
  caps,
  busy,
  initialPhotos,
  instruction,
  onInstruction,
  onStyle,
  styles,
  onGenerate,
  onMeasure,
  onPhotos,
  availableCredits,
}: {
  scene: Scene;
  assets: Asset[];
  projectId: string;
  caps?: Capabilities;
  busy: boolean;
  initialPhotos: string[];
  instruction: string;
  onInstruction: (s: string) => void;
  onStyle: (s: string) => void;
  styles: Style[];
  onGenerate: (ids: string[], roomId: string) => void | Promise<unknown>;
  onMeasure?: () => void;
  onPhotos?: () => void;
  availableCredits?: number;
}) {
  const rooms = scene.floors.flatMap((f) =>
      f.rooms.map((r) => ({ ...r, label: f.name + ' / ' + r.name })),
    ),
    [roomId, setRoom] = useState(
      assets.find((a) => initialPhotos.includes(a.id))?.roomId || rooms[0]?.id || '',
    ),
    [photos, setPhotos] = useState([...new Set(initialPhotos)].slice(0, 2)),
    [submitting, setSubmitting] = useState(false),
    [submitError, setSubmitError] = useState('');
  const submittingRef = useRef(false);
  const service = caps as
    | (Capabilities & {
        aiModels?: string[];
        aiConfigurationError?: string | null;
        structuralAuditEnabled?: boolean;
      })
    | undefined;
  const confirmed = scene.confirmation.status === 'confirmed';
  const demo = (scene.confirmation as Scene['confirmation'] & { basis?: string }).basis === 'demo';
  const credits = useQuery({
    queryKey: ['credits'],
    queryFn: () => api<{ available: number; reserved: number }>('/credits'),
    enabled: availableCredits === undefined,
    staleTime: 0,
    retry: false,
  });
  const available = availableCredits ?? credits.data?.available;
  const cost = caps?.aiCreditsPerImage ?? 10;
  const insufficient = available !== undefined && available < cost;
  const references = assets.filter((a) => a.kind === 'photo' && a.roomId === roomId);
  const selected = photos.filter((id) => references.some((a) => a.id === id));
  const context = useQuery({
    queryKey: ['ai-context', projectId, roomId, scene],
    queryFn: () =>
      post<Context>('/projects/' + projectId + '/ai-context', { scene, roomId, baseRevision: 0 }),
    enabled: !!roomId,
    retry: false,
  });
  const instructionBudget = instructionUsage(instruction, context.data?.instructionLimitBytes);
  const disabled =
    !caps?.aiImage ||
    !!service?.aiConfigurationError ||
    !confirmed ||
    !selected.length ||
    !context.data ||
    context.isError ||
    context.isFetching ||
    busy ||
    submitting ||
    insufficient ||
    instructionBudget.overLimit ||
    available === undefined;
  async function generate() {
    if (disabled || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError('');
    try {
      await onGenerate(selected, roomId);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '提交失败，请检查生成记录后再尝试。');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }
  return (
    <div className="ai-composer">
      <div className={'inline-note ' + (!caps?.aiImage ? 'warning' : '')}>
        {caps?.aiImage
          ? `本次最多 ${cost} 应用积分，成功后结算，失败释放；服务商用量另计。`
          : '服务端尚未配置 AI 密钥。可先检查实测参考和准备照片。'}
      </div>
      {service?.aiConfigurationError && (
        <p role="alert">AI 配置需要修正：{service.aiConfigurationError}</p>
      )}
      {service?.aiModels?.length ? (
        <p className="fine-print">
          模型顺序：{service.aiModels.join(' → ')}。仅在明确额度耗尽或限流时尝试备用。
        </p>
      ) : null}
      <p role="status" className="fine-print">
        可用应用积分：{available === undefined ? '正在读取…' : available}
        {credits.data?.reserved ? `；其他任务已预留 ${credits.data.reserved}` : ''}。
        {service?.structuralAuditEnabled
          ? '本次包含一次 AI 辅助结构检查，检查结果仍需人工核对。'
          : ''}
      </p>
      {credits.isError && availableCredits === undefined && (
        <p role="alert">
          积分信息读取失败。
          <button className="button ghost compact" onClick={() => void credits.refetch()}>
            重新读取积分
          </button>
        </p>
      )}
      {insufficient && (
        <p role="alert">
          可用应用积分不足，本次需要 {cost} 积分。请先处理已预留任务或联系项目管理员。
        </p>
      )}
      {!confirmed && (
        <div className="inline-note warning" role="status">
          <p>当前尺寸尚未确认。请先核对房间、门窗与实测记录，再回来生成。</p>
          {onMeasure && (
            <button className="button outline compact" onClick={onMeasure}>
              去核对与确认尺寸
            </button>
          )}
        </div>
      )}
      {confirmed && demo && (
        <p className="inline-note warning">
          已确认的是虚构演示尺寸，本次结果仅供流程体验，不代表真实住宅。
        </p>
      )}
      <label>
        生成房间
        <select
          value={roomId}
          disabled={busy || submitting}
          onChange={(e) => {
            setRoom(e.target.value);
            setPhotos([]);
          }}
        >
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <div className="ai-reference">
        <div>
          {context.data ? (
            <>
              <strong>
                {demo ? '演示尺寸参考' : '尺寸参考'}：{context.data.widthMm} ×{' '}
                {context.data.depthMm} × {context.data.heightMm} mm
              </strong>
              <img src={context.data.imageDataUrl} alt="本次生成使用的实测平面参考" />
            </>
          ) : (
            <div>
              <p>{context.isError ? '场景参考生成失败，请先校验户型。' : '正在准备平面参考…'}</p>
              {context.isError && (
                <button className="button ghost compact" onClick={() => void context.refetch()}>
                  重新准备参考
                </button>
              )}
            </div>
          )}
        </div>
        <p>
          平面参考和尺寸会随照片提交，生成后核对墙、门、窗、家具和比例。模型仍可能偏离几何，不会据效果图修改实测场景。
        </p>
      </div>
      <p>选择最多两张与本房间关联的照片或 3D 视角参考，已选 {selected.length} / 2。</p>
      <p className="fine-print">最后一张参考作为视角底图。可取消后按需要的顺序重新选择。</p>
      <div className="photo-picker">
        {references.map((a) => (
          <button
            key={a.id}
            aria-label={'选择参考照片 ' + a.name}
            aria-pressed={selected.includes(a.id)}
            disabled={busy || submitting || (!selected.includes(a.id) && selected.length >= 2)}
            className={selected.includes(a.id) ? 'selected' : ''}
            onClick={() =>
              setPhotos((v) =>
                v.includes(a.id)
                  ? v.filter((id) => id !== a.id)
                  : [...v.filter((id) => references.some((a) => a.id === id)), a.id].slice(0, 2),
              )
            }
          >
            <img src={a.thumbUrl || a.url} alt={a.name} loading="lazy" decoding="async" />
            <span
              style={{
                position: 'absolute',
                inset: 'auto 0 0',
                background: '#283b32dd',
                color: '#fff',
                fontSize: 10,
                padding: 5,
              }}
            >
              {referenceLabel(a)}
              {selected.includes(a.id)
                ? selected.at(-1) === a.id
                  ? ' · 视角底图'
                  : ` · 参考 ${selected.indexOf(a.id) + 1}`
                : ''}
            </span>
          </button>
        ))}
      </div>
      {!references.length && (
        <div className="inline-note warning">
          <p>此房间还没有关联参考，请先上传照片或保存 3D 视角，并选择正确房间。</p>
          {onPhotos && (
            <button className="button outline compact" onClick={onPhotos}>
              去上传房间照片
            </button>
          )}
        </div>
      )}
      <label>
        装修风格
        <select
          disabled={busy || submitting}
          value={scene.layout.styleId}
          onChange={(e) => onStyle(e.target.value)}
        >
          {styles.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {instructionBudget.limit !== null && (
        <p className="fine-print" role={instructionBudget.overLimit ? 'alert' : 'status'}>
          补充要求 {instructionBudget.bytes} / {instructionBudget.limit} UTF-8 字节。
          {instructionBudget.overLimit
            ? '请精简要求，避免结构参考和提示词被服务商截断；中文通常每字占 3 字节。'
            : '已为房间结构参考预留提示词空间。'}
          {instructionBudget.overLimit && (
            <button className="button ghost compact" onClick={() => onInstruction('')}>
              清空后重新简写
            </button>
          )}
        </p>
      )}
      <label>
        补充要求
        <textarea
          maxLength={800}
          disabled={busy || submitting}
          value={instruction}
          onChange={(e) => onInstruction(e.target.value)}
          placeholder="例如保留门窗，增加原木收纳与暖光"
        />
      </label>
      <p className="fine-print">
        提交后可在“生成记录”查看进度。取消已开始的任务不保证撤回服务商用量；结果不确定时请先核对记录，再决定是否重新生成。
      </p>
      {submitError && <p role="alert">{submitError}</p>}
      <button className="button primary full" disabled={disabled} onClick={() => void generate()}>
        {busy || submitting ? '提交中，请勿重复提交…' : `确认并生成 · ${cost} 应用积分`}
      </button>
    </div>
  );
}
