import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Asset } from '../types';
import { api } from '../api';
import { Modal } from './UI';
import { useNotice } from '../App';
import {
  assetModel,
  manualReviewChecks,
  orderedReferences,
  referenceLabel,
  resultNeedsRevision,
  revisionInstruction,
  structuralAudit,
  structuralCheckNames,
} from '../aiWorkflow';
type Reference = {
  roomId: string;
  roomName: string;
  floorName: string;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  structureHash: string;
  confirmationBasis?: 'user_measured' | 'demo' | 'draft';
};
const checks = [
  ['walls', '墙体位置'],
  ['doors', '门洞位置'],
  ['windows', '窗洞位置'],
  ['furniture', '家具位置'],
  ['proportions', '空间比例'],
] as const;
export default function AiResultReview({
  asset,
  assets,
  projectId,
  onRevise,
}: {
  asset: Asset;
  assets: Asset[];
  projectId: string;
  onRevise?: (sourceIds: string[], roomId: string, instruction: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    qc = useQueryClient(),
    notify = useNotice();
  const ref = asset.metadata.geometryReference as Reference | undefined;
  const review = asset.metadata.review as
    | { checks?: Record<string, string>; notes?: string; status?: string; contextChanged?: boolean }
    | undefined;
  const [states, setStates] = useState<Record<string, string>>(manualReviewChecks(asset.metadata)),
    [notes, setNotes] = useState(review?.notes || '');
  const ids = Array.isArray(asset.metadata.referenceAssetIds)
      ? asset.metadata.referenceAssetIds.filter((id): id is string => typeof id === 'string')
      : [],
    sources = orderedReferences(ids, assets, ref?.roomId || ''),
    audit = structuralAudit(asset.metadata.structuralAudit),
    model = assetModel(asset);
  const guide = useQuery({
    queryKey: ['ai-review-guide', asset.id],
    queryFn: () => api<{ imageDataUrl: string }>('/assets/' + asset.id + '/reference'),
    enabled: open && !!ref,
  });
  if (!ref) return null;
  const needsRevision = resultNeedsRevision(review?.status, audit);
  return (
    <>
      <button
        className="button outline compact"
        onClick={() => {
          setStates(manualReviewChecks(asset.metadata));
          setNotes(review?.notes || '');
          setOpen(true);
        }}
      >
        核对结构与比例{needsRevision ? ' · 待调整' : ''}
      </button>
      {open && (
        <Modal title="尺寸参考与 AI 结果复核" onClose={() => setOpen(false)} wide>
          <p>
            {ref.floorName} / {ref.roomName} · {ref.widthMm} × {ref.depthMm} × {ref.heightMm} mm
          </p>
          {ref.confirmationBasis === 'demo' && (
            <p className="inline-note warning">本结果使用虚构演示尺寸，不能代表真实住宅。</p>
          )}
          {model && (
            <p className="fine-print">
              实际生成模型：{model}
              {asset.metadata.fallbackUsed === true ? ' · 本次使用了备用模型' : ''}
            </p>
          )}
          <div className="ai-comparison">
            {sources.length > 0 && (
              <figure>
                <figcaption>原始参考 · {sources.length} 张</figcaption>
                {sources.map((source, i) => (
                  <span key={source.id}>
                    <small>
                      参考 {ids.indexOf(source.id) + 1} · {referenceLabel(source)}
                      {ids.length > 1 && source.id === ids.at(-1) ? ' · 视角底图' : ''}
                    </small>
                    <img
                      style={{ height: sources.length > 1 ? 105 : 210 }}
                      src={source.url}
                      alt={'生成所用原始照片 ' + (i + 1)}
                    />
                  </span>
                ))}
              </figure>
            )}
            <figure>
              <figcaption>生成时的尺寸平面</figcaption>
              {guide.data ? (
                <img src={guide.data.imageDataUrl} alt="生成时的实测平面快照" />
              ) : (
                <p>
                  {guide.isError ? '平面参考读取失败，可重新打开后重试。' : '正在读取生成时的平面…'}
                </p>
              )}
            </figure>
            <figure>
              <figcaption>AI 概念效果</figcaption>
              <img src={asset.url} alt="待核对的AI装修效果" />
            </figure>
          </div>
          {sources.length < ids.length && (
            <p role="status">部分原始参考已不可用，当前无法完整对照，请保留不确定项。</p>
          )}
          {audit ? (
            <section
              className={'inline-note ai-structural-audit ' + (audit.risk === 'high' ? 'warning' : '')}
              aria-label="AI 辅助结构检查"
            >
              <strong>
                AI 辅助结构检查 ·{' '}
                {audit.risk === 'high'
                  ? '发现差异，待调整'
                  : audit.risk === 'low'
                    ? '未见明显差异，待人工核对'
                    : '信息不足，待人工核对'}
              </strong>
              <p>{audit.summary}</p>
              <p className="fine-print">
                辅助检查不验证毫米尺寸，也不自动确认结构。
                {audit.model ? `检查模型：${audit.model}。` : ''}
              </p>
              <details>
                <summary>查看逐项依据</summary>
                {audit.checks.map((check) => (
                  <p key={check.key}>
                    <strong>
                      {structuralCheckNames[check.key]}：
                      {check.verdict === 'different'
                        ? '发现差异'
                        : check.verdict === 'consistent'
                          ? '未见明显差异'
                          : '不确定'}
                    </strong>
                    <br />
                    {check.evidence}
                  </p>
                ))}
                {audit.originalSummary && (
                  <p>
                    <strong>模型原始说明（可能不准确，以逐项依据和人工核对为准）</strong>
                    <br />
                    {audit.originalSummary}
                  </p>
                )}
              </details>
            </section>
          ) : (
            <p className="inline-note warning">本结果没有自动结构检查记录，请逐项人工核对。</p>
          )}
          <p className="fine-print">
            逐项人工核对。比例无法从单张图精确测量，可保留“不确定”；此记录不代表自动几何验证或施工验收。
          </p>
          {review?.contextChanged && (
            <p role="alert">当前户型或家具布置已变化，本结果基于旧场景，请重新生成。</p>
          )}
          {audit?.needsRevision && (
            <p role="alert">
              自动检查已记录结构差异。下面可保存你的复核意见，结果仍会保留“待调整”，需要修正后重新核对。
            </p>
          )}
          <div className="quote-grid">
            {checks.map(([k, title]) => (
              <label key={k}>
                {title}
                <select
                  value={states[k]}
                  onChange={(e) => setStates({ ...states, [k]: e.target.value })}
                >
                  <option value="uncertain">不确定 / 待核对</option>
                  <option value="consistent">人工判断一致</option>
                  <option value="different">发现差异</option>
                </select>
              </label>
            ))}
          </div>
          <label>
            差异和调整说明
            <textarea maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <button
            disabled={busy}
            className="button primary full"
            onClick={async () => {
              setBusy(true);
              try {
                await api('/assets/' + asset.id + '/review', {
                  method: 'PATCH',
                  body: JSON.stringify({ checks: states, notes }),
                });
                await qc.invalidateQueries({ queryKey: ['assets', projectId] });
                notify('复核记录已保存。');
                setOpen(false);
              } catch (e) {
                notify((e as Error).message, true);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? '正在保存…' : '保存人工复核记录'}
          </button>
          {onRevise && (
            <button
              className="button outline full"
              disabled={busy || !sources.length || sources.length !== ids.length}
              onClick={() => {
                setOpen(false);
                onRevise(
                  sources.map((source) => source.id),
                  ref.roomId,
                  revisionInstruction(asset, notes),
                );
              }}
            >
              根据差异重新调整
            </button>
          )}
          {onRevise && (
            <p className="fine-print">
              重新调整会打开生成前确认页面，使用原始参考与当前尺寸，并填入简短差异摘要。请检查和编辑要求；提交后是一项新的生成任务。
              {sources.length !== ids.length ? '原始参考不完整，请先补齐或重新选择参考。' : ''}
            </p>
          )}
        </Modal>
      )}
    </>
  );
}
