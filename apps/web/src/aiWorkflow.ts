import type { Asset, Job } from './types';

export const structuralCheckNames = {
  walls: '墙体位置',
  doors: '门洞位置',
  windows: '窗洞位置',
  viewpoint: '拍摄视角',
  furniture: '家具位置',
  proportions: '空间比例',
} as const;

export type StructuralCheckKey = keyof typeof structuralCheckNames;
export type AuditCheck = {
  key: StructuralCheckKey;
  verdict: 'consistent' | 'different' | 'uncertain';
  evidence: string;
};
export type AuditView = {
  status: 'completed' | 'failed' | 'skipped' | 'unknown';
  risk: 'high' | 'low' | 'unknown';
  needsRevision: boolean;
  summary: string;
  originalSummary: string;
  model: string | null;
  checks: AuditCheck[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function shortText(value: unknown, length = 500): string {
  return typeof value === 'string' ? value.slice(0, length) : '';
}

// An unavailable or malformed audit can never be read as successful geometry validation.
export function structuralAudit(value: unknown): AuditView | null {
  const raw = record(value);
  if (!raw) return null;
  const rawChecks = record(raw.checks);
  const checks = (Object.keys(structuralCheckNames) as StructuralCheckKey[]).map((key) => {
    const check = record(rawChecks?.[key]);
    const verdict = check?.verdict;
    return {
      key,
      verdict: verdict === 'consistent' || verdict === 'different' ? verdict : 'uncertain',
      evidence: shortText(check?.evidence) || '没有足够依据，待人工核对。',
    } as AuditCheck;
  });
  const status =
    raw.status === 'completed' || raw.status === 'failed' || raw.status === 'skipped'
      ? raw.status
      : 'unknown';
  const needsRevision =
    raw.decision === 'needs_revision' ||
    raw.risk === 'high' ||
    checks.some((check) => check.verdict === 'different');
  const hasCompleteChecks = checks.every((check) => {
    const rawCheck = record(rawChecks?.[check.key]);
    return (
      rawCheck &&
      ['consistent', 'different', 'uncertain'].includes(String(rawCheck.verdict)) &&
      typeof rawCheck.evidence === 'string' &&
      rawCheck.evidence.trim().length > 0
    );
  });
  // Even low-risk output remains unmeasured and needs manual review.
  const risk = needsRevision
    ? 'high'
    : status === 'completed' && raw.risk === 'low' && hasCompleteChecks
      ? 'low'
      : 'unknown';
  const differences = checks
    .filter((check) => check.verdict === 'different')
    .map((check) => structuralCheckNames[check.key]);
  const unresolved = checks
    .filter((check) => check.verdict === 'uncertain')
    .map((check) => structuralCheckNames[check.key]);
  return {
    status,
    risk,
    needsRevision,
    summary:
      status === 'completed'
        ? (differences.length
            ? `辅助检查提示${differences.join('、')}存在差异。`
            : '辅助检查未报告明确差异。') +
          (unresolved.length
            ? `${unresolved.join('、')}仍不确定，请逐项人工核对。`
            : '各项仍需人工核对，不能据此确认毫米尺寸。')
        : status === 'failed'
          ? '自动检查未完成，生成结果仍需逐项人工核对。'
          : '自动检查信息不足，生成结果仍需逐项人工核对。',
    originalSummary: shortText(raw.summary),
    model: shortText(raw.model, 120) || null,
    checks,
  };
}

export function manualReviewChecks(metadata: Record<string, unknown>): Record<string, string> {
  const checks = record(record(metadata.review)?.checks);
  return Object.fromEntries(
    ['walls', 'doors', 'windows', 'furniture', 'proportions'].map((key) => [
      key,
      checks?.[key] === 'consistent' || checks?.[key] === 'different' ? checks[key] : 'uncertain',
    ]),
  );
}

export function resultNeedsRevision(reviewStatus: unknown, audit: AuditView | null): boolean {
  return reviewStatus === 'needs_revision' || audit?.needsRevision === true;
}

export function assetModel(asset: Asset): string | null {
  return shortText(asset.metadata.model, 120) || null;
}

export function referenceLabel(asset: Asset): string {
  if (asset.metadata.referenceType === 'scene_capture') return '3D 视角参考（非实拍）';
  if (
    asset.name.includes('非实拍') ||
    asset.metadata.referenceKind === 'synthetic-3d-not-a-real-room-photo'
  )
    return '合成参考（非实拍）';
  return '房间照片';
}

export function orderedReferences(ids: string[], assets: Asset[], roomId: string): Asset[] {
  return ids
    .map((id) => assets.find((asset) => asset.id === id))
    .filter(
      (asset): asset is Asset => !!asset && asset.kind === 'photo' && asset.roomId === roomId,
    );
}

export function instructionUsage(text: string, byteLimit?: number) {
  const bytes = new TextEncoder().encode(text).length;
  const limit =
    typeof byteLimit === 'number' && Number.isFinite(byteLimit) && byteLimit >= 0
      ? Math.floor(byteLimit)
      : null;
  return { bytes, limit, overLimit: limit !== null && bytes > limit };
}

export function revisionInstruction(asset: Asset, notes: string): string {
  const audit = structuralAudit(asset.metadata.structuralAudit);
  const differences = audit?.checks
    .filter((check) => check.verdict === 'different')
    .map((check) => structuralCheckNames[check.key] + '：' + check.evidence)
    .join('；');
  const first = '基于最初的房间参考修正，保留原视角和结构。';
  const last = '按当前尺寸修正，不新增开口。';
  // A revision opens an editable confirmation form. Keep its suggested summary
  // small enough for conservative prompt budgets, without splitting emoji.
  let budget = 200 - instructionUsage(first + '\n' + last).bytes;
  const sections = [first];
  for (const text of [
    differences ? '差异：' + differences : '',
    notes.trim() ? '意见：' + notes.trim() : '',
  ]) {
    if (!text || budget <= 4) continue;
    let summary = '';
    let bytes = 0;
    const allowance =
      text.startsWith('差异：') && notes.trim() ? Math.min(budget - 1, 150) : budget - 1;
    for (const character of text) {
      const length = instructionUsage(character).bytes;
      if (bytes + length > allowance) break;
      summary += character;
      bytes += length;
    }
    if (summary) {
      sections.push(summary);
      budget -= bytes + 1;
    }
  }
  return [...sections, last].join('\n');
}

export function jobCreditSummary(
  job: Pick<Job, 'status' | 'chargedCredits'> & {
    reservedCredits?: number;
    currentlyReservedCredits?: number;
    creditState?: string;
  },
): string {
  const reserved = Math.max(0, job.reservedCredits || 0);
  if (job.chargedCredits > 0) return `已结算 ${job.chargedCredits} 应用积分`;
  if (job.creditState === 'released') return `已释放预留的 ${reserved} 应用积分`;
  if (job.creditState === 'reserved')
    return `已预留 ${job.currentlyReservedCredits ?? reserved} 应用积分，尚未结算`;
  if (['queued', 'running', 'cancel_requested'].includes(job.status) && reserved > 0)
    return `已预留 ${reserved} 应用积分，尚未结算`;
  if (['failed', 'cancelled'].includes(job.status) && reserved > 0)
    return `已释放预留的 ${reserved} 应用积分`;
  return '应用积分未扣费';
}

export function uncertainProviderResult(
  job: Pick<Job, 'type' | 'status' | 'error'> & { providerBillingUncertain?: boolean },
): boolean {
  const explicit = job.providerBillingUncertain;
  if (typeof explicit === 'boolean') return explicit;
  return (
    ['style', 'render', 'recognize', 'inpaint'].includes(job.type) &&
    (job.status === 'cancel_requested' ||
      job.status === 'cancelled' ||
      [
        'PROVIDER_REQUEST_UNCERTAIN',
        'WORKER_INTERRUPTED',
        'PROVIDER_DOWNLOAD_FAILED',
        'PROVIDER_INVALID_RESPONSE',
      ].includes(job.error?.code || ''))
  );
}

export function jobProvider(output: unknown): {
  model: string | null;
  requestedModel: string | null;
  fallbackUsed: boolean;
  attempts: { model: string; status: string; code: string | null; httpStatus: number | null }[];
} | null {
  const raw = record(record(output)?.provider);
  if (!raw) return null;
  const attempts = (Array.isArray(raw.modelAttempts) ? raw.modelAttempts : [])
    .slice(0, 3)
    .map(record)
    .filter((item): item is Record<string, unknown> => item !== null)
    .map((item) => ({
      model: shortText(item.model, 120) || '未记录模型',
      status:
        item.status === 'succeeded'
          ? '成功返回'
          : item.status === 'rejected'
            ? '请求被拒绝'
            : '结果未确认',
      code: [
        'AllocationQuota.FreeTierOnly',
        'Throttling.RateQuota',
        'Throttling.AllocationQuota',
      ].includes(String(item.code))
        ? String(item.code)
        : null,
      httpStatus:
        typeof item.httpStatus === 'number' && Number.isInteger(item.httpStatus)
          ? item.httpStatus
          : null,
    }));
  return {
    model: shortText(raw.model, 120) || null,
    requestedModel: shortText(raw.requestedModel, 120) || null,
    fallbackUsed: raw.fallbackUsed === true,
    attempts,
  };
}
