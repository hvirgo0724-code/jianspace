import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Camera, Check, Wand2 } from 'lucide-react';
import { api, post } from '../api';
import type { Asset, Job, Style } from '../types';
import './insight.css';

type Working = {
  revision: number;
  scene: {
    geometryVersionId?: string;
    confirmation?: { status?: string; basis?: string };
    layout?: { styleId?: string };
  };
};

export default function QuickRender() {
  const { projectId = '' } = useParams();
  const [styles, setStyles] = useState<Style[]>([]);
  const [styleId, setStyleId] = useState('');
  const [working, setWorking] = useState<Working | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [asset, setAsset] = useState<Asset | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef<number | null>(null);

  useEffect(() => {
    void api<{ items: unknown[]; styles: Style[] }>('/catalog')
      .then((data) => {
        setStyles(data.styles);
        setStyleId((current) => current || data.styles[0]?.id || '');
      })
      .catch(() => setError('风格列表加载失败。'));
    void api<Working>(`/projects/${projectId}/working-copy`)
      .then((data) => {
        setWorking(data);
        setStyleId((current) => current || data.scene.layout?.styleId || '');
      })
      .catch(() => setError('项目场景加载失败。'));
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [projectId]);

  useEffect(() => {
    if (!photo) {
      setPreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const confirmed =
    working?.scene.confirmation?.status === 'confirmed' && !!working?.scene.geometryVersionId;
  const styleName = styles.find((s) => s.id === styleId)?.name ?? '';
  const step = job ? 3 : asset ? 2 : 1;

  async function upload() {
    if (!photo) return;
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', photo);
      form.append('kind', 'photo');
      const uploaded = await api<Asset>(`/projects/${projectId}/assets`, {
        method: 'POST',
        body: form,
      });
      setAsset(uploaded);
    } catch (e) {
      setError(e instanceof Error ? e.message : '照片上传失败。');
    } finally {
      setBusy(false);
    }
  }

  function poll(jobId: string) {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = window.setInterval(() => {
      void api<Job>(`/jobs/${jobId}`)
        .then((next) => {
          setJob(next);
          if (['succeeded', 'failed', 'cancelled'].includes(next.status) && timer.current) {
            window.clearInterval(timer.current);
            timer.current = null;
          }
        })
        .catch(() => undefined);
    }, 2500);
  }

  async function generate() {
    if (!asset || !styleId || !working) return;
    setBusy(true);
    setError('');
    try {
      const created = await post<Job>(`/projects/${projectId}/jobs`, {
        type: 'style',
        geometryVersionId: working.scene.geometryVersionId,
        assetIds: [asset.id],
        styleIds: [styleId],
        instruction: `按${styleName}风格生成室内效果图，保持户型结构与门窗位置不变。`,
        parameters: { sourceRevision: working.revision },
        maxCredits: 12,
      });
      setJob(created);
      poll(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : '效果图任务提交失败。');
    } finally {
      setBusy(false);
    }
  }

  const resultAsset = job?.output?.assets?.[0];

  return (
    <div className="insight-page">
      <div className="insight-head">
        <h1 className="insight-title">
          <Wand2 size={20} style={{ verticalAlign: '-3px', marginRight: 8 }} />
          三步快速出图
        </h1>
      </div>
      <p className="insight-sub">
        上传一张毛坯房或房间照片，选一个风格，一次生成效果图。结构必须已经在「实测与户型」中确认。
      </p>
      <Link className="back-link" to={`/projects/${projectId}`}>
        <ArrowLeft size={15} /> 返回项目
      </Link>

      {!confirmed && (
        <div className="insight-card" style={{ marginTop: 16 }}>
          <h2>还不能出图</h2>
          <p className="hint">
            当前项目的结构尚未确认。请回到工作台，在「实测与户型」中录入尺寸并确认结构，再回到这里生成效果图。
          </p>
          <Link className="insight-primary" to={`/projects/${projectId}`} style={{ display: 'inline-block', textDecoration: 'none' }}>
            去确认结构
          </Link>
        </div>
      )}

      {confirmed && (
        <>
          <div className="steps" style={{ marginTop: 18 }}>
            <div className={`step ${step === 1 ? 'active' : 'done'}`}>
              {step > 1 ? <Check size={13} style={{ verticalAlign: '-2px' }} /> : null} 1 · 上传照片
            </div>
            <div className={`step ${step === 2 ? 'active' : step > 2 ? 'done' : ''}`}>
              {step > 2 ? <Check size={13} style={{ verticalAlign: '-2px' }} /> : null} 2 · 选择风格
            </div>
            <div className={`step ${step === 3 ? 'active' : ''}`}>3 · 生成效果图</div>
          </div>

          <div className="insight-card">
            <div className="insight-grid">
              <div className="insight-upload">
                <label>
                  <Camera size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />
                  房间照片
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    setPhoto(e.target.files?.[0] ?? null);
                    setAsset(null);
                    setJob(null);
                  }}
                />
                <div className="quick-preview" style={{ marginTop: 10 }}>
                  {previewUrl ? <img src={previewUrl} alt="待生成照片" /> : <span className="insight-note">上传后可在这里预览</span>}
                </div>
              </div>
              <div className="insight-upload">
                <label>风格</label>
                <select value={styleId} onChange={(e) => setStyleId(e.target.value)}>
                  {styles.map((style) => (
                    <option value={style.id} key={style.id}>
                      {style.name}
                    </option>
                  ))}
                </select>
                <p className="hint" style={{ marginTop: 10 }}>
                  {styles.find((s) => s.id === styleId)?.description}
                </p>
              </div>
            </div>
            <div className="insight-actions">
              <button className="insight-primary" onClick={() => void upload()} disabled={!photo || busy || !!asset}>
                {asset ? '照片已上传' : busy ? '上传中…' : '上传照片'}
              </button>
              <button
                className="insight-primary"
                onClick={() => void generate()}
                disabled={!asset || !styleId || busy || !!job}
              >
                {busy && asset ? '提交中…' : job ? '任务已提交' : '生成效果图'}
              </button>
            </div>
            {error && <div className="insight-error">{error}</div>}
            {job && (
              <div className="job-state">
                任务 {job.id.slice(0, 8)} · 状态 {job.status} · 进度 {job.progress}%
                {job.error ? ` · ${job.error.message}` : ''}
                {resultAsset && (
                  <div className="quick-preview" style={{ marginTop: 12 }}>
                    <img src={resultAsset.url} alt="生成效果图" />
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
