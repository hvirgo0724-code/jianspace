import { describe, expect, it } from 'vitest';
import {
  isValidRef,
  primaryIdByClause,
  resolveEvidence,
  sliceHighlight,
  type EvidenceContext,
} from './evidence';

const context: EvidenceContext = {
  document: 'contract',
  documentLabel: '合同',
  paragraph: 2,
  start: 8,
  end: 13,
  contextStart: 0,
  contextEnd: 18,
  text: '前段：最终结算按实际发生量结算。后段',
};

function ref(overrides: Record<string, unknown> = {}) {
  return {
    document: 'contract',
    documentLabel: '合同',
    clauseId: 'contract#2-1',
    paragraph: 2,
    start: 8,
    end: 13,
    keys: ['增项条款'],
    ...overrides,
  };
}

describe('审查证据对照', () => {
  it('用后端窗口换算相对偏移并高亮命中片段', () => {
    const view = resolveEvidence(
      { id: 'f1', evidence: '实际发生量', evidenceRef: ref() },
      { 'contract#2-1': context },
    );
    expect(view.kind).toBe('context');
    if (view.kind !== 'context') return;
    expect(view.label).toBe('合同 · 段 2');
    expect(view.hit).toBe('实际发生量');
    expect(view.before.endsWith('最终结算按')).toBe(true);
    expect(view.after.startsWith('结算。')).toBe(true);
  });

  it('无后端上下文时切本地粘贴文本，并去掉首尾空白', () => {
    const text = '  合同正文：最终结算按实际发生量结算。  ';

    const view = resolveEvidence(
      { id: 'f1', evidence: '实际发生量', evidenceRef: ref({ start: 10, end: 15 }) },
      {},
      { contract: text },
    );
    expect(view.kind).toBe('context');
    if (view.kind !== 'context') return;
    expect(view.hit).toBe('实际发生量');
    expect(view.label).toBe('合同 · 段 2');
  });

  it('上传文件没有原文时给出提示而不是空白', () => {
    const view = resolveEvidence(
      { id: 'f1', evidence: '实际发生量', evidenceRef: ref() },
      {},
      { contract: '粘贴文本不应被用于上传文档' },
      { contract: true },
    );
    expect(view.kind).toBe('unavailable');
    if (view.kind !== 'unavailable') return;
    expect(view.note).toContain('上传文件');
  });

  it('偏移非法或缺失定位时只保留摘录', () => {
    expect(isValidRef(ref({ start: 30, end: 10 }))).toBe(false);
    expect(resolveEvidence({ id: 'f1', evidence: 'x', evidenceRef: ref({ start: 30, end: 10 }) }).kind).toBe(
      'excerpt',
    );
    expect(resolveEvidence({ id: 'f2', evidence: 'x', evidenceRef: null }).kind).toBe('excerpt');
    expect(
      resolveEvidence({ id: 'f3', evidence: 'x', evidenceRef: ref({ start: '6' }) }).kind,
    ).toBe('excerpt');
  });

  it('后端窗口不覆盖偏移时回落到本地文本，仍不可得则提示', () => {
    const broken: EvidenceContext = { ...context, contextStart: 0, contextEnd: 4 };
    expect(
      resolveEvidence(
        { id: 'f1', evidence: '实际发生量', evidenceRef: ref() },
        { 'contract#2-1': broken },
      ).kind,
    ).toBe('unavailable');
  });

  it('多条命中同一段时只保留首条为展开主条目', () => {
    const primary = primaryIdByClause([
      { id: 'a', evidenceRef: ref() },
      { id: 'b', evidenceRef: ref({ clauseId: 'contract#2-1' }) },
      { id: 'c', evidenceRef: ref({ clauseId: 'contract#3-1' }) },
      { id: 'd', evidenceRef: null },
    ]);
    expect(primary).toEqual({ 'contract#2-1': 'a', 'contract#3-1': 'c' });
  });

  it('sliceHighlight 对越界范围做裁剪', () => {
    expect(sliceHighlight('abcdef', -2, 99)).toEqual({ before: '', hit: 'abcdef', after: '' });
    expect(sliceHighlight('abcdef', 4, 2)).toEqual({ before: 'abcd', hit: '', after: 'ef' });
  });
});
