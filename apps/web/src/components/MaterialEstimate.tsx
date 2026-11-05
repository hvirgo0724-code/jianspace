import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Sparkles, Upload } from 'lucide-react';
import { api } from '../api';
import type { Style } from '../types';
import './insight.css';

type Tier = {
  tier: string;
  label: string;
  desc: string;
  floorTotal: number;
  wallTotal: number;
  cabinetTotal: number;
  bathroomTotal: number;
  lightingTotal: number;
  markupPercent: number;
  subtotal: number;
  total: number;
};
type MaterialItem = {
  category: string;
  name: string;
  quantity: number;
  unit: string;
  unitPrice: Record<string, number>;
};
type Estimate = {
  areaM2: number;
  styleName: string | null;
  styleMaterials: Record<string, string>;
  tiers: Tier[];
  items: MaterialItem[];
  recommendation: string;
};
type Inferred = {
  ok: boolean;
  styleGuess?: string;
  notes?: string;
  materials: {
    surface: string;
    name: string;
    color: string;
    finish: string;
    confidence: number;
    tierSuggestions: { tier: string; suggestion: string }[];
  }[];
};

function yuan(value: number) {
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

export default function MaterialEstimate() {
  const { projectId = '' } = useParams();
  const [styles, setStyles] = useState<Style[]>([]);
  const [styleId, setStyleId] = useState('warm-wood');
  const [area, setArea] = useState(90);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [inferred, setInferred] = useState<Inferred | null>(null);
  const [inferBusy, setInferBusy] = useState(false);

  useEffect(() => {
    void api<{ items: unknown[]; styles: Style[] }>('/catalog')
      .then((data) => setStyles(data.styles))
      .catch(() => setError('风格列表加载失败。'));
  }, []);

  useEffect(() => {
    void api<{ scene?: { rooms?: { shape?: { pointsMm?: number[][] } }[] } }>(
      `/projects/${projectId}/working-copy`,
    )
      .then((working) => {
        const rooms = working.scene?.rooms ?? [];
        let areaMm2 = 0;
        for (const room of rooms) {
          const points = room.shape?.pointsMm ?? [];
          if (points.length < 3) continue;
          let sum = 0;
          for (let i = 0; i < points.length; i += 1) {
            const [x1, y1] = points[i];
            const [x2, y2] = points[(i + 1) % points.length];
            sum += x1 * y2 - x2 * y1;
          }
          areaMm2 += Math.abs(sum) / 2;
        }
        if (areaMm2 > 0) setArea(Math.round((areaMm2 / 1_000_000) * 10) / 10);
      })
      .catch(() => undefined);
  }, [projectId]);

  async function runEstimate() {
    setBusy(true);
    setError('');
    try {
      const result = await api<Estimate>('/materials/estimate', {
        method: 'POST',
        body: JSON.stringify({ scene: { totalAreaMm2: area * 1_000_000 }, styleId }),
      });
      setEstimate(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : '材料估算失败。');
    } finally {
      setBusy(false);
    }
  }

  async function inferFromImage() {
    if (!image) return;
    setInferBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.append('image', image);
      form.append('styleHint', styles.find((s) => s.id === styleId)?.name ?? '');
      const result = await api<Inferred>('/materials/from-image', { method: 'POST', body: form });
      setInferred(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : '效果图材料识别失败。');
    } finally {
      setInferBusy(false);
    }
  }

  function exportCsv() {
    if (!estimate) return;
    const rows: string[][] = [['品类', '材料', '用量', '单位', '经济档单价', '标准档单价', '高档档单价']];
    for (const item of estimate.items) {
      rows.push([
        item.category,
        item.name,
        String(item.quantity),
        item.unit,
        String(item.unitPrice.economy),
        String(item.unitPrice.standard),
        String(item.unitPrice.premium),
      ]);
    }
    rows.push([]);
    rows.push(['档位', '地面', '墙面', '柜体', '卫浴', '灯具', '管理费比例', '合计']);
    for (const tier of estimate.tiers) {
      rows.push([
        tier.label,
        String(tier.floorTotal),
        String(tier.wallTotal),
        String(tier.cabinetTotal),
        String(tier.bathroomTotal),
        String(tier.lightingTotal),
        `${tier.markupPercent}%`,
        String(tier.total),
      ]);
    }
    const csv = '\uFEFF' + rows.map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `筑见-材料清单-${estimate.styleName ?? '通用'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="insight-page">
      <div className="insight-head">
        <h1 className="insight-title">
          <Sparkles size={20} style={{ verticalAlign: '-3px', marginRight: 8 }} />
          材料清单与三档预算
        </h1>
      </div>
      <p className="insight-sub">
        按户型面积与所选风格生成地面、墙面、柜体、卫浴、灯具的用量与三个预算档位；
        也可以上传 AI 效果图，从画面里反推实际做法与对应材料建议。
      </p>
      <Link className="back-link" to={`/projects/${projectId}`}>
        <ArrowLeft size={15} /> 返回项目
      </Link>

      <div className="insight-card" style={{ marginTop: 16 }}>
        <h2>输入条件</h2>
        <p className="hint">面积默认取项目房间的净面积合计，可手动覆盖。</p>
        <div className="insight-grid">
          <div className="insight-upload">
            <label>装修风格</label>
            <select value={styleId} onChange={(e) => setStyleId(e.target.value)}>
              {styles.map((style) => (
                <option value={style.id} key={style.id}>
                  {style.name}
                </option>
              ))}
            </select>
          </div>
          <div className="insight-upload">
            <label>套内面积（㎡）</label>
            <input
              type="number"
              min={20}
              max={600}
              value={area}
              onChange={(e) => setArea(Number(e.target.value) || 0)}
            />
          </div>
          <div className="insight-upload">
            <label>上传 AI 效果图（可选）</label>
            <input type="file" accept="image/*" onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
          </div>
        </div>
        <div className="insight-actions">
          <button className="insight-primary" onClick={() => void runEstimate()} disabled={busy}>
            {busy ? '计算中…' : '生成材料清单'}
          </button>
          <button className="insight-ghost" onClick={() => void inferFromImage()} disabled={!image || inferBusy}>
            <Upload size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />
            {inferBusy ? '识别中…' : '从效果图反推材料'}
          </button>
          {estimate && (
            <button className="insight-ghost" onClick={exportCsv}>
              <Download size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />
              导出 CSV
            </button>
          )}
        </div>
        {error && <div className="insight-error">{error}</div>}
      </div>

      {estimate && (
        <div className="insight-card">
          <h2>
            三档预算 · {estimate.styleName ?? '通用'} · {estimate.areaM2} ㎡
          </h2>
          <p className="hint">推荐档位：{estimate.tiers.find((t) => t.tier === estimate.recommendation)?.label}</p>
          <table className="tier-table">
            <thead>
              <tr>
                <th>档位</th>
                <th>地面</th>
                <th>墙面</th>
                <th>柜体</th>
                <th>卫浴</th>
                <th>灯具</th>
                <th>管理费</th>
                <th style={{ textAlign: 'right' }}>合计</th>
              </tr>
            </thead>
            <tbody>
              {estimate.tiers.map((tier) => (
                <tr key={tier.tier} className={estimate.recommendation === tier.tier ? 'recommended' : ''}>
                  <td>
                    <b>{tier.label}</b>
                    <br />
                    <span style={{ color: '#919789', fontSize: 11 }}>{tier.desc}</span>
                  </td>
                  <td className="num">{yuan(tier.floorTotal)}</td>
                  <td className="num">{yuan(tier.wallTotal)}</td>
                  <td className="num">{yuan(tier.cabinetTotal)}</td>
                  <td className="num">{yuan(tier.bathroomTotal)}</td>
                  <td className="num">{yuan(tier.lightingTotal)}</td>
                  <td className="num">{tier.markupPercent}%</td>
                  <td className="num">{yuan(tier.total)} 元</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {estimate && (
        <div className="insight-card">
          <h2>材料清单</h2>
          <p className="hint">用量按套内面积估算，实际以现场实测与施工图为准。</p>
          {estimate.items.map((item) => (
            <div className="material-item" key={item.category}>
              <div>
                <b>{item.name}</b>
                <br />
                <span>{item.category}</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                {item.quantity} {item.unit}
                <br />
                <span>
                  {yuan(item.unitPrice.economy)} / {yuan(item.unitPrice.standard)} /{' '}
                  {yuan(item.unitPrice.premium)} 元
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {inferred && (
        <div className="insight-card">
          <h2>效果图材料反推{inferred.styleGuess ? ` · ${inferred.styleGuess}` : ''}</h2>
          <p className="hint">{inferred.notes || '根据画面可见表面推断，仅供选材参考。'}</p>
          {inferred.materials.map((material, index) => (
            <div className="material-item" key={`${material.name}-${index}`}>
              <div>
                <b>
                  {material.surface} · {material.name}
                </b>
                <br />
                <span>
                  {[material.color, material.finish].filter(Boolean).join(' / ')} · 置信度{' '}
                  {Math.round(material.confidence * 100)}%
                </span>
                <div style={{ marginTop: 6 }}>
                  {material.tierSuggestions.map((tier) => (
                    <span className="chip" key={tier.tier} style={{ marginRight: 6 }}>
                      {tier.tier}：{tier.suggestion}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
