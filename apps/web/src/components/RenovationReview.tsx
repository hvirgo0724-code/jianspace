import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, FileDown, ShieldAlert } from 'lucide-react';
import { api, csrfToken } from '../api';
import './insight.css';

type Finding = {
  id: string;
  category: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  advice: string;
  evidence: string | null;
  estimatedAmountMinor: number | null;
  source: string;
  budgetItemIds: string[];
};
type Report = {
  summary: string;
  totalFindings: number;
  bySeverity: Record<string, number>;
  byCategory: Record<string, number>;
  contractReliabilityScore: number;
  predictedExtraCostMinor: number;
  llmUsed: boolean;
  llmNote: string;
  documents: Record<string, number>;
  findings: Finding[];
  notes?: string[];
};
const CATEGORY: Record<string, string> = {
  hygiene_corner: '卫生死角',
  over_decoration: '过度装修',
  contract_trap: '合同陷阱',
  cross_doc_mismatch: '跨文档不一致',
  item_prediction: '增项预测',
};
const SEVERITY: Record<string, string> = { high: '高危', medium: '中危', low: '低危' };

function yuan(minor: number | null | undefined) {
  if (minor == null) return '—';
  return (minor / 100).toLocaleString('zh-CN', { maximumFractionDigits: 0 }) + ' 元';
}

export default function RenovationReview() {
  const { projectId = '' } = useParams();
  const [contract, setContract] = useState('');
  const [quote, setQuote] = useState('');
  const [drawing, setDrawing] = useState('');
  const [contractFile, setContractFile] = useState<File | null>(null);
  const [quoteFile, setQuoteFile] = useState<File | null>(null);
  const [drawingFile, setDrawingFile] = useState<File | null>(null);
  const [useLlm, setUseLlm] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  async function analyze() {
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      if (contractFile) form.append('contract', contractFile);
      if (quoteFile) form.append('quote', quoteFile);
      if (drawingFile) form.append('drawing', drawingFile);
      form.append('contractText', contract);
      form.append('quoteText', quote);
      form.append('drawingText', drawing);
      form.append('useLlm', String(useLlm));
      const result = await api<Report>('/review/analyze', { method: 'POST', body: form });
      setReport(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : '审查失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }

  async function downloadPdf() {
    if (!report) return;
    setPdfBusy(true);
    setError('');
    try {
      const response = await fetch('/api/review/report-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken(),
        },
        credentials: 'include',
        body: JSON.stringify({ report }),
      });
      if (!response.ok) throw new Error('报告生成失败，请稍后重试。');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = '筑见-装修避坑审查报告.pdf';
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : '报告生成失败。');
    } finally {
      setPdfBusy(false);
    }
  }

  const score = report?.contractReliabilityScore ?? 0;
  const scoreClass = score >= 70 ? 'good' : score >= 45 ? 'warn' : 'bad';

  return (
    <div className="insight-page">
      <div className="insight-head">
        <h1 className="insight-title">
          <ShieldAlert size={20} style={{ verticalAlign: '-3px', marginRight: 8 }} />
          装修避坑审查
        </h1>
      </div>
      <p className="insight-sub">
        上传或粘贴合同、报价单与设计说明，逐条找出对业主不利的条款、看不见的增项与卫生死角。
        本地知识库覆盖 18 类常见坑位，开启深度分析后由大模型补充语义级陷阱，并叠加合同与报价单的交叉核对。
      </p>
      <Link className="back-link" to={`/projects/${projectId}`}>
        <ArrowLeft size={15} /> 返回项目
      </Link>

      <div className="insight-card" style={{ marginTop: 16 }}>
        <h2>第一步 · 提供材料</h2>
        <p className="hint">支持 PDF / TXT / MD / CSV，也可直接粘贴文字。至少提供一份。</p>
        <div className="insight-grid">
          <div className="insight-upload">
            <label>合同</label>
            <input type="file" accept=".pdf,.txt,.md,.csv" onChange={(e) => setContractFile(e.target.files?.[0] ?? null)} />
            <textarea
              style={{ marginTop: 8 }}
              placeholder="也可以直接粘贴合同正文…"
              value={contract}
              onChange={(e) => setContract(e.target.value)}
            />
          </div>
          <div className="insight-upload">
            <label>报价单</label>
            <input type="file" accept=".pdf,.txt,.md,.csv" onChange={(e) => setQuoteFile(e.target.files?.[0] ?? null)} />
            <textarea
              style={{ marginTop: 8 }}
              placeholder="也可以直接粘贴报价单内容…"
              value={quote}
              onChange={(e) => setQuote(e.target.value)}
            />
          </div>
          <div className="insight-upload">
            <label>设计说明</label>
            <input type="file" accept=".pdf,.txt,.md,.csv" onChange={(e) => setDrawingFile(e.target.files?.[0] ?? null)} />
            <textarea
              style={{ marginTop: 8 }}
              placeholder="也可以直接粘贴设计说明…"
              value={drawing}
              onChange={(e) => setDrawing(e.target.value)}
            />
          </div>
        </div>
        <div className="insight-actions">
          <button className="insight-primary" onClick={() => void analyze()} disabled={busy}>
            {busy ? '正在审查…' : '开始审查'}
          </button>
          <label className="insight-note">
            <input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} /> 开启大模型深度分析
          </label>
          {report && (
            <button className="insight-ghost" onClick={() => void downloadPdf()} disabled={pdfBusy}>
              <FileDown size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />
              {pdfBusy ? '生成中…' : '下载 PDF 报告'}
            </button>
          )}
        </div>
        {error && <div className="insight-error">{error}</div>}
      </div>

      {report && (
        <>
          <div className="insight-card">
            <div className="score-row">
              <div className={`score-badge ${scoreClass}`}>{score}</div>
              <div className="stat-grid">
                <div className="stat">
                  <b>{report.totalFindings}</b>
                  <span>问题总数</span>
                </div>
                <div className="stat">
                  <b>{report.bySeverity.high ?? 0}</b>
                  <span>高危</span>
                </div>
                <div className="stat">
                  <b>{report.bySeverity.medium ?? 0}</b>
                  <span>中危</span>
                </div>
                <div className="stat">
                  <b>{report.bySeverity.low ?? 0}</b>
                  <span>低危</span>
                </div>
                <div className="stat">
                  <b>{yuan(report.predictedExtraCostMinor)}</b>
                  <span>预计增项</span>
                </div>
                <div className="stat">
                  <b>{report.llmUsed ? '已启用' : '规则'}</b>
                  <span>分析方式</span>
                </div>
              </div>
            </div>
            <p className="hint" style={{ marginTop: 12 }}>
              {report.summary}
              {report.llmNote ? `（${report.llmNote}）` : ''}
            </p>
            {report.notes?.length ? <p className="hint">{report.notes.join(' · ')}</p> : null}
          </div>

          <div className="insight-card">
            <h2>问题清单</h2>
            <p className="hint">按严重程度排序，可直接据此与装修公司逐条沟通。</p>
            {report.findings.map((finding) => (
              <div className={`finding ${finding.severity}`} key={finding.id}>
                <div className="finding-head">
                  <strong>{finding.title}</strong>
                  <span className={`chip ${finding.severity}`}>{SEVERITY[finding.severity]}</span>
                  <span className="chip">{CATEGORY[finding.category] ?? finding.category}</span>
                  {finding.source === 'llm' && <span className="chip">大模型</span>}
                  {finding.estimatedAmountMinor ? (
                    <span className="chip">影响 {yuan(finding.estimatedAmountMinor)}</span>
                  ) : null}
                </div>
                <p>{finding.description}</p>
                <p>
                  <b>建议：</b>
                  {finding.advice}
                </p>
                {finding.evidence && <p className="evidence">依据：{finding.evidence}</p>}
                {finding.budgetItemIds.length > 0 && (
                  <span className="budget-link">
                    关联预算条目 {finding.budgetItemIds.length} 项
                  </span>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
