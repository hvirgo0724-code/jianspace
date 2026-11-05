import { describe, expect, it } from 'vitest';
import type { Asset } from './types';
import {
  jobCreditSummary,
  jobProvider,
  instructionUsage,
  manualReviewChecks,
  orderedReferences,
  resultNeedsRevision,
  revisionInstruction,
  structuralAudit,
  uncertainProviderResult,
} from './aiWorkflow';

describe('AI workflow risk and credit messages', () => {
  it('preserves original image order and the final viewpoint reference despite reverse asset sorting', () => {
    const assets = [
      { id: 'last-view', kind: 'photo', roomId: 'room-1' },
      { id: 'other-room', kind: 'photo', roomId: 'room-2' },
      { id: 'ai-output', kind: 'generated', roomId: 'room-1' },
      { id: 'first-reference', kind: 'photo', roomId: 'room-1' },
    ] as Asset[];
    expect(
      orderedReferences(['first-reference', 'last-view'], assets, 'room-1').map((a) => a.id),
    ).toEqual(['first-reference', 'last-view']);
    expect(
      orderedReferences(
        ['first-reference', 'deleted', 'other-room', 'ai-output'],
        assets,
        'room-1',
      ).map((a) => a.id),
    ).toEqual(['first-reference']);
  });
  it('uses UTF-8 bytes for Chinese and emoji prompt budgets without silently truncating', () => {
    expect(instructionUsage('门窗A😀', 10)).toEqual({ bytes: 11, limit: 10, overLimit: true });
    expect(instructionUsage('门窗', 6).overLimit).toBe(false);
    expect(instructionUsage('门窗', undefined)).toEqual({
      bytes: 6,
      limit: null,
      overLimit: false,
    });
  });
  it('does not turn failed or malformed audits into low-risk approval', () => {
    expect(structuralAudit(null)).toBeNull();
    for (const status of ['failed', 'skipped']) {
      const failed = structuralAudit({ status, risk: 'low', checks: null });
      expect(failed?.risk).toBe('unknown');
      expect(failed?.checks.every((c) => c.verdict === 'uncertain')).toBe(true);
    }
    const malformed = structuralAudit({
      status: 'completed',
      risk: 'low',
      checks: { doors: { verdict: 'approved' } },
    });
    expect(malformed?.risk).toBe('unknown');
    expect(malformed?.checks.find((c) => c.key === 'doors')?.verdict).toBe('uncertain');
  });
  it('keeps explicit structural differences high risk even if the overall model says low', () => {
    const audit = structuralAudit({
      status: 'completed',
      risk: 'low',
      checks: {
        doors: { verdict: 'different', evidence: '结果新增了一个门洞' },
      },
    });
    expect(audit?.needsRevision).toBe(true);
    expect(audit?.risk).toBe('high');
    expect(audit?.checks.find((c) => c.key === 'doors')?.evidence).toContain('新增');
  });
  it('never copies automated checks into manual confirmation or clears high risk with a reviewed label', () => {
    const automatedChecks = Object.fromEntries(
      ['walls', 'doors', 'windows', 'viewpoint', 'furniture', 'proportions'].map((key) => [
        key,
        { verdict: 'consistent', evidence: '仅为AI目视判断' },
      ]),
    );
    const automatic = { status: 'completed', risk: 'low', checks: automatedChecks };
    expect(Object.values(manualReviewChecks({ structuralAudit: automatic }))).toEqual(
      Array(5).fill('uncertain'),
    );
    const high = structuralAudit({ ...automatic, risk: 'high', decision: 'needs_revision' });
    expect(resultNeedsRevision('reviewed', high)).toBe(true);
    expect(resultNeedsRevision('needs_revision', structuralAudit(automatic))).toBe(true);
    expect(resultNeedsRevision('pending', structuralAudit({ status: 'skipped' }))).toBe(false);
  });
  it('summarizes normalized checks instead of repeating a contradictory model summary', () => {
    const audit = structuralAudit({
      status: 'completed',
      risk: 'high',
      summary: '墙体一致，没有风险。',
      checks: {
        viewpoint: { verdict: 'different', evidence: '相机朝向发生变化' },
        walls: { verdict: 'uncertain', evidence: '视角变化无法确定墙体位置' },
      },
    });
    expect(audit?.summary).toContain('拍摄视角存在差异');
    expect(audit?.summary).toContain('墙体位置');
    expect(audit?.summary).toContain('仍不确定');
    expect(audit?.summary).not.toContain('没有风险');
    expect(audit?.originalSummary).toBe('墙体一致，没有风险。');
  });
  it('uses original references and bounded correction text, not an AI result as an input photo', () => {
    const asset = {
      metadata: {
        structuralAudit: {
          status: 'completed',
          risk: 'high',
          checks: {
            doors: { verdict: 'different', evidence: '新增门洞' },
          },
        },
      },
    } as unknown as Asset;
    const instruction = revisionInstruction(asset, '保留原来的开口。'.repeat(100));
    expect(instruction).toContain('最初的房间参考');
    expect(instruction).toContain('新增门洞');
    expect(instruction.length).toBeLessThanOrEqual(800);
    expect(instructionUsage(instruction).bytes).toBeLessThanOrEqual(200);
    const emoji = revisionInstruction(asset, '😀不要改变门窗'.repeat(100));
    expect(instructionUsage(emoji).bytes).toBeLessThanOrEqual(200);
    expect(emoji).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
  });
  it('distinguishes a running reservation from terminal release and one successful charge', () => {
    expect(
      jobCreditSummary({ status: 'running', chargedCredits: 0, reservedCredits: 10 }),
    ).toContain('已预留 10');
    expect(
      jobCreditSummary({ status: 'cancel_requested', chargedCredits: 0, reservedCredits: 10 }),
    ).toContain('尚未结算');
    expect(
      jobCreditSummary({ status: 'failed', chargedCredits: 0, reservedCredits: 10 }),
    ).toContain('已释放');
    expect(jobCreditSummary({ status: 'succeeded', chargedCredits: 10, reservedCredits: 10 })).toBe(
      '已结算 10 应用积分',
    );
    expect(
      jobCreditSummary({
        status: 'cancelled',
        chargedCredits: 0,
        reservedCredits: 10,
        creditState: 'released',
      }),
    ).toContain('已释放');
  });
  it('keeps provider-billing uncertainty visible after cancellation or interrupted requests', () => {
    expect(
      uncertainProviderResult({
        type: 'style',
        status: 'failed',
        error: { code: 'WORKER_INTERRUPTED', message: '' },
      }),
    ).toBe(true);
    expect(uncertainProviderResult({ type: 'style', status: 'cancelled', error: null })).toBe(true);
    expect(
      uncertainProviderResult({
        type: 'style',
        status: 'cancelled',
        error: null,
        providerBillingUncertain: false,
      }),
    ).toBe(false);
    expect(uncertainProviderResult({ type: 'export', status: 'cancelled', error: null })).toBe(
      false,
    );
    expect(
      uncertainProviderResult({
        type: 'style',
        status: 'failed',
        error: { code: 'PROVIDER_QUOTA_EXHAUSTED', message: '' },
      }),
    ).toBe(false);
  });
  it('shows bounded sanitized attempt metadata and excludes raw provider messages', () => {
    const result = jobProvider({
      provider: {
        requestedModel: 'qwen-image-2.0-pro',
        model: 'qwen-image-2.0',
        fallbackUsed: true,
        modelAttempts: [
          {
            model: 'qwen-image-2.0-pro',
            status: 'rejected',
            code: 'AllocationQuota.FreeTierOnly',
            httpStatus: 403,
            message: 'untrusted secret',
          },
          { model: 'qwen-image-2.0', status: 'succeeded', httpStatus: 200 },
        ],
      },
    });
    expect(result?.fallbackUsed).toBe(true);
    expect(result?.attempts[0].code).toBe('AllocationQuota.FreeTierOnly');
    expect(JSON.stringify(result)).not.toContain('untrusted secret');
    expect(jobProvider({ provider: null })).toBeNull();
  });
});
