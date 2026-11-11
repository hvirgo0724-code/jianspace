/** 审查证据的原文对照：优先用后端返回的上下文窗口，其次切本地粘贴文本。 */

export type EvidenceRef = {
  document?: string;
  documentLabel?: string;
  clauseId?: string;
  paragraph?: number;
  start?: number;
  end?: number;
  keys?: string[];
};

export type EvidenceContext = {
  document: string;
  documentLabel: string;
  paragraph: number;
  start: number;
  end: number;
  contextStart: number;
  contextEnd: number;
  text: string;
};

export type EvidenceView =
  | { kind: 'excerpt' }
  | { kind: 'unavailable'; label: string; note: string }
  | {
      kind: 'context';
      label: string;
      paragraph: number;
      before: string;
      hit: string;
      after: string;
    };

const LOCAL_PAD = 240;

export type EvidenceFinding = {
  id: string;
  evidence?: string | null;
  evidenceRef?: EvidenceRef | null;
};

export function isValidRef(
  ref: EvidenceRef | null | undefined,
): ref is EvidenceRef & { document: string; start: number; end: number } {
  return (
    !!ref &&
    typeof ref.document === 'string' &&
    Number.isInteger(ref.start) &&
    Number.isInteger(ref.end) &&
    (ref.start as number) >= 0 &&
    (ref.end as number) > (ref.start as number)
  );
}

export function sliceHighlight(text: string, start: number, end: number) {
  const from = Math.max(0, Math.min(start, text.length));
  const to = Math.max(from, Math.min(end, text.length));
  return { before: text.slice(0, from), hit: text.slice(from, to), after: text.slice(to) };
}

export function primaryIdByClause(findings: EvidenceFinding[]): Record<string, string> {
  const primary: Record<string, string> = {};
  for (const finding of findings) {
    const key = finding.evidenceRef?.clauseId;
    if (key && !primary[key]) primary[key] = finding.id;
  }
  return primary;
}

/**
 * 决定单条发现能否展开原文：
 * - 后端已按 clauseId 返回上下文窗口时直接用，偏移以窗口起点换算；
 * - 否则在文档是粘贴文本且非上传文件时本地切命中片段前后；
 * - 都没有则给出明确提示，偏移非法或缺定位只保留摘录。
 */
export function resolveEvidence(
  finding: EvidenceFinding,
  contexts: Record<string, EvidenceContext> = {},
  texts: Record<string, string> = {},
  uploaded: Record<string, boolean> = {},
): EvidenceView {
  const ref = finding.evidenceRef;
  if (!isValidRef(ref)) return { kind: 'excerpt' };

  const label = ref.documentLabel || ref.document;
  const window = ref.clauseId ? contexts[ref.clauseId] : undefined;
  if (window && typeof window.text === 'string') {
    const start = ref.start - window.contextStart;
    const end = ref.end - window.contextStart;
    const span = window.contextEnd - window.contextStart;
    if (start >= 0 && end <= span && end <= window.text.length) {
      return {
        kind: 'context',
        label: `${window.documentLabel || label} · 段 ${window.paragraph}`,
        paragraph: window.paragraph,
        ...sliceHighlight(window.text, start, end),
      };
    }
  }

  const text = texts[ref.document];
  if (text && !uploaded[ref.document]) {
    const trimmed = text.trim();
    if (ref.end <= trimmed.length) {
      const start = Math.max(0, ref.start - LOCAL_PAD);
      const end = Math.min(trimmed.length, ref.end + LOCAL_PAD);
      return {
        kind: 'context',
        label: `${label} · 段 ${ref.paragraph ?? '—'}`,
        paragraph: ref.paragraph ?? 0,
        ...sliceHighlight(trimmed.slice(start, end), ref.start - start, ref.end - start),
      };
    }
  }

  return {
    kind: 'unavailable',
    label,
    note: '该文档是上传文件，服务端未保留原文；可把文本粘贴到上方输入框后重新审查，即可展开对照。',
  };
}
