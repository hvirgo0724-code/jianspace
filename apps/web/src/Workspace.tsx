import { useState, useEffect, useRef, useContext, lazy, Suspense } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ChevronRight,
  Undo2,
  Redo2,
  Save,
  ScanLine,
  CheckCheck,
  Sparkles,
  Download,
  Share2,
  Ruler,
  Shapes,
  Image,
  Layers3,
  Coins,
  ListChecks,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  PenTool,
  ArrowUpRight,
  Menu,
  AlertCircle,
  ChevronDown,
  LayoutDashboard,
  UserRound,
  BookOpen,
} from 'lucide-react';
import { api, post, put, ApiError } from './api';
import type {
  Working,
  Project,
  Scene,
  Item,
  Style,
  Capabilities,
  Validation,
  Geometry,
  Design,
  Job,
  Asset,
} from './types';
import { useScene } from './store';
import { id, addFurniture, addRoom, resizedRoom, activeFloor } from './scene';
import { useNotice, UserContext, UserBadge } from './App';
import { Logo, Spinner, Modal, Empty } from './components/UI';
import Plan2D from './components/Plan2D';
import Inspector from './components/Inspector';
import MeasurementImport from './components/MeasurementImport';
import ItemLibrary from './components/ItemLibrary';
import FloorSwitcher from './components/FloorSwitcher';
import SelectionTools from './components/SelectionTools';
import StructurePanel from './components/StructurePanel';
import LayoutBrief from './components/LayoutBrief';
import AiComposer from './components/AiComposer';
import MaskEditor from './components/MaskEditor';
import Assistant from './components/Assistant';
import FloorPlanImport from './components/FloorPlanImport';
import TemplateReset from './components/TemplateReset';
import ProjectOverview, { WorkflowNav } from './components/ProjectOverview';
import { isInteriorArea } from './surfaces';
import { duplicateSelected, moveSelected } from './editorCommands';
import {
  PhotosPanel,
  VersionsPanel,
  BudgetPanel,
  JobsPanel,
  MeasurementsPanel,
  MembersPanel,
} from './components/Panels';
const Scene3D = lazy(() => import('./components/Scene3D'));
const navItems = [
  { id: 'overview', name: '项目概览', icon: LayoutDashboard },
  { id: 'editor', name: '空间设计', icon: Shapes },
  { id: 'measure', name: '实测与户型', icon: Ruler },
  { id: 'photos', name: '房间照片', icon: Image },
  { id: 'versions', name: '方案比较', icon: Layers3 },
  { id: 'budget', name: '预算清单', icon: Coins },
  { id: 'jobs', name: '生成记录', icon: ListChecks },
];

export default function Workspace() {
  const { projectId: pid = '' } = useParams(),
    user = useContext(UserContext),
    notify = useNotice(),
    qc = useQueryClient(),
    nav = useNavigate(),
    [params, setParams] = useSearchParams();
  const st = useScene();
  const [tab, setTab] = useState('overview'),
    [view, setView] = useState<'2d' | '3d'>('2d'),
    [cutaway, setCutaway] = useState(true),
    [draw, setDraw] = useState(false),
    [right, setRight] = useState(true),
    [mobileNav, setMobileNav] = useState(false),
    [busy, setBusy] = useState<string | null>(null),
    [modal, setModal] = useState<string | null>(null),
    [shareLink, setShareLink] = useState(''),
    [restore, setRestore] = useState<Scene | null>(null),
    [aiPhotos, setAiPhotos] = useState<string[]>([]),
    [maskAsset, setMaskAsset] = useState<Asset | null>(null),
    [instruction, setInstruction] = useState(''),
    [confirmationBasis, setConfirmationBasis] = useState<'user_measured' | 'demo'>('user_measured');
  const saving = useRef<Promise<Working> | null>(null),
    blocked = useRef(false),
    loaded = useRef('');
  const prefix = '/projects/' + pid;
  useEffect(() => {
    if (params.get('floorplan') !== '1') return;
    setModal('floorplan');
    const next = new URLSearchParams(params);
    next.delete('floorplan');
    setParams(next, { replace: true });
  }, [params, setParams]);
  const project = useQuery({ queryKey: ['project', pid], queryFn: () => api<Project>(prefix) });
  const working = useQuery({
    queryKey: ['working', pid],
    queryFn: () => api<Working>(prefix + '/working-copy'),
    staleTime: Infinity,
  });
  const catalog = useQuery({
    queryKey: ['catalog'],
    queryFn: () => api<{ items: Item[]; styles: Style[] }>('/catalog'),
  });
  const caps = useQuery({
    queryKey: ['capabilities'],
    queryFn: () => api<Capabilities>('/capabilities'),
  });
  const assets = useQuery({
    queryKey: ['assets', pid],
    queryFn: () => api<{ items: Asset[] }>(prefix + '/assets'),
  });
  const jobs = useQuery({
    queryKey: ['jobs', pid],
    queryFn: () => api<{ items: Job[] }>(prefix + '/jobs'),
    refetchInterval: (q) =>
      q.state.data?.items.some((j) => ['queued', 'running', 'cancel_requested'].includes(j.status))
        ? 1500
        : 5000,
  });
  const designs = useQuery({
    queryKey: ['designs', pid],
    queryFn: () => api<{ items: Design[] }>(prefix + '/designs'),
  });
  const backupKey = `jianspace-draft:${user?.id}:${pid}`;
  useEffect(() => {
    if (working.data && loaded.current !== pid) {
      useScene.getState().load(pid, working.data);
      loaded.current = pid;
      blocked.current = false;
      try {
        const raw = localStorage.getItem(backupKey);
        if (raw) {
          const b = JSON.parse(raw);
          if (b.scene && b.dirty && JSON.stringify(b.scene) !== JSON.stringify(working.data.scene))
            setRestore(b.scene);
        }
      } catch {}
    }
  }, [working.data, pid, backupKey]);
  const seenJobs = useRef(new Set<string>());
  useEffect(() => {
    for (const job of jobs.data?.items || []) {
      const marker = job.id + ':' + job.status;
      if (
        ['succeeded', 'failed', 'cancelled'].includes(job.status) &&
        !seenJobs.current.has(marker)
      ) {
        seenJobs.current.add(marker);
        if (job.status === 'succeeded') {
          qc.invalidateQueries({ queryKey: ['designs', pid] });
          qc.invalidateQueries({ queryKey: ['assets', pid] });
        }
        qc.invalidateQueries({ queryKey: ['credits'] });
      }
    }
  }, [jobs.data, pid, qc]);
  async function save(): Promise<Working> {
    if (saving.current) await saving.current;
    const state = useScene.getState();
    if (!state.scene || state.projectId !== pid) throw new Error('项目尚未载入。');
    if (blocked.current) throw new Error('存在保存冲突，请先处理浏览器草稿。');
    if (!state.dirty)
      return {
        scene: state.scene,
        revision: state.revision,
        baseDesignId: state.baseDesignId,
        updatedAt: new Date().toISOString(),
      };
    const source = state.scene;
    state.setStatus('保存中…');
    const promise = put<Working>(prefix + '/working-copy', {
      scene: source,
      baseRevision: state.revision,
      baseDesignId: state.baseDesignId,
    });
    saving.current = promise;
    try {
      const w = await promise;
      useScene.getState().saved(w, source);
      qc.setQueryData(['working', pid], w);
      qc.invalidateQueries({ queryKey: ['projects'] });
      return w;
    } catch (e) {
      useScene
        .getState()
        .setStatus(e instanceof ApiError && e.status === 409 ? '保存冲突' : '保存失败');
      if (e instanceof ApiError && e.status === 409) {
        blocked.current = true;
        setModal('conflict');
      }
      throw e;
    } finally {
      saving.current = null;
    }
  }
  useEffect(() => {
    if (st.projectId !== pid || !st.scene) return;
    try {
      localStorage.setItem(
        backupKey,
        JSON.stringify({ scene: st.scene, revision: st.revision, dirty: st.dirty, at: Date.now() }),
      );
    } catch {
      notify('浏览器草稿空间不足，请及时保存到服务器。', true);
    }
    if (!st.dirty || blocked.current) return;
    const timer = setTimeout(() => save().catch((e) => notify((e as Error).message, true)), 1300);
    return () => clearTimeout(timer);
  }, [st.scene, st.dirty, pid, st.revision]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (useScene.getState().dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) &&
        !target.closest('[data-walk-region]')
      ) {
        const state = useScene.getState();
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && state.selectedIds.length) {
          e.preventDefault();
          try {
            let ids: string[] = [];
            state.change((s) => {
              ids = duplicateSelected(s, state.selectedIds);
            });
            state.selectMany(ids);
          } catch (err) {
            notify((err as Error).message, true);
          }
        }
        if (e.key === 'Delete' && state.selectedIds.length) {
          e.preventDefault();
          state.change((s) => {
            s.layout.furniture = s.layout.furniture.filter(
              (f) => !state.selectedIds.includes(f.id) || f.locked,
            );
          });
          state.selectMany([]);
        }
        if (
          ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) &&
          state.selectedIds.length
        ) {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 50;
          state.change((s) =>
            moveSelected(
              s,
              state.selectedIds,
              e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
              e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0,
            ),
          );
        }
      }
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 's') {
          e.preventDefault();
          save()
            .then(() => notify('草稿已保存'))
            .catch((e) => notify(e.message, true));
        }
        if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) && e.key === 'z') {
          e.preventDefault();
          e.shiftKey ? useScene.getState().redo() : useScene.getState().undo();
        }
      }
    };
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('beforeunload', handler);
      window.removeEventListener('keydown', key);
    };
  }, [pid]);
  async function run(label: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError) {
        const details = e.details as Validation;
        if (details?.issues) useScene.getState().setIssues(details.issues);
      }
      notify((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  }
  async function validate() {
    const state = useScene.getState();
    const report = await post<Validation>(prefix + '/geometry-drafts/validate', {
      scene: state.scene,
      baseRevision: state.revision,
    });
    state.setIssues(report.issues);
    notify(
      report.valid
        ? '校验通过：户型、门扇与家具未发现冲突。'
        : `发现 ${report.issues.length} 个问题，请按提示调整。`,
      !report.valid,
    );
  }
  async function confirm() {
    const w = await save();
    const g = await post<Geometry>(prefix + '/geometry-versions', {
      scene: w.scene,
      baseRevision: w.revision,
    });
    await post(prefix + '/geometry-versions/' + g.id + '/confirm', {
      expectedStructureHash: g.structureHash,
      basis: confirmationBasis,
      confirmMeasuredDimensions: confirmationBasis === 'user_measured',
      confirmDemoDimensions: confirmationBasis === 'demo',
    });
    const next = await api<Working>(prefix + '/working-copy');
    useScene.getState().load(pid, next);
    qc.setQueryData(['working', pid], next);
    qc.invalidateQueries({ queryKey: ['project', pid] });
    setModal(null);
    notify(
      confirmationBasis === 'demo'
        ? '演示尺寸已确认，后续结果继续标为虚构参考。'
        : '实测户型已确认，可以生成布局和保存方案。',
    );
  }
  async function freeze(title: string) {
    const w = await save();
    await post<Design>(prefix + '/designs', {
      title,
      geometryVersionId: w.scene.geometryVersionId,
      scene: w.scene,
      baseRevision: w.revision,
      parentDesignId: w.baseDesignId,
    });
    qc.invalidateQueries({ queryKey: ['designs', pid] });
    const next = await api<Working>(prefix + '/working-copy');
    useScene.getState().load(pid, next);
    setModal(null);
    notify('方案已保存为不可变版本。');
  }
  async function job(type: string, extra: Record<string, unknown> = {}) {
    const saved = await save();
    const request = {
      type,
      ...extra,
      parameters: {
        ...((extra.parameters || {}) as Record<string, unknown>),
        sourceRevision: saved.revision,
      },
    };
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(request)),
    );
    const signature = Array.from(new Uint8Array(digest), (v) =>
      v.toString(16).padStart(2, '0'),
    ).join('');
    const keyName = `jianspace-job-request:${user?.id}:${pid}:${signature}`;
    let requestKey: string = id();
    try {
      requestKey = sessionStorage.getItem(keyName) || requestKey;
      sessionStorage.setItem(keyName, requestKey);
    } catch {}
    let result: Job;
    try {
      result = await post<Job>(prefix + '/jobs', request, { 'Idempotency-Key': requestKey });
      try {
        sessionStorage.removeItem(keyName);
      } catch {}
    } catch (e) {
      // A lost response can still mean the server accepted the paid task.
      // Retain the same key for the same saved request across refresh/retry.
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        try {
          sessionStorage.removeItem(keyName);
        } catch {}
      }
      throw e;
    }
    qc.invalidateQueries({ queryKey: ['jobs', pid] });
    qc.invalidateQueries({ queryKey: ['credits'] });
    notify(
      type === 'layout'
        ? '布局任务已提交，完成后可在方案比较中查看。'
        : type === 'export'
          ? '导出已提交，文件将在生成记录中提供下载。'
          : '效果图任务已提交，可在生成记录查看进度。',
    );
    return result;
  }
  const scene = st.projectId === pid ? st.scene : null,
    style =
      catalog.data?.styles.find((s) => s.id === scene?.layout.styleId) || catalog.data?.styles[0];
  const pending =
    jobs.data?.items.filter((j) => ['queued', 'running', 'cancel_requested'].includes(j.status))
      .length || 0;
  if (project.isError || working.isError)
    return (
      <Empty title="无法打开项目">
        <p>{(project.error || (working.error as Error))?.message}</p>
        <Link className="button" to="/projects">
          返回项目
        </Link>
      </Empty>
    );
  if (!scene || !project.data) return <Spinner label="正在载入你的空间…" />;
  const floor = activeFloor(scene, st.floorId);
  const room = floor.rooms.find((r) => r.id === st.roomId) || floor.rooms[0];
  return (
    <div className="workspace">
      <aside className={'workspace-sidebar ' + (mobileNav ? 'mobile-open' : '')}>
        <Link
          to="/projects"
          onClick={(e) => {
            if (st.dirty) {
              e.preventDefault();
              run('保存', async () => {
                await save();
                nav('/projects');
              });
            }
          }}
        >
          <Logo small />
        </Link>
        <Link to="/projects" className="back-link">
          <ArrowLeft size={15} />
          返回工作台
        </Link>
        <div className="sidebar-label">项目空间</div>
        {navItems.map((item) => (
          <button
            key={item.id}
            className={'nav-item ' + (tab === item.id ? 'active' : '')}
            onClick={() => {
              setTab(item.id);
              setMobileNav(false);
            }}
          >
            <item.icon size={18} />
            {item.name}
            {item.id === 'jobs' && pending > 0 && <span>{pending}</span>}
          </button>
        ))}
        <button
          className="nav-item"
          disabled={!!busy}
          onClick={() =>
            void run('保存草稿', async () => {
              await save();
              nav('/account');
            })
          }
        >
          <UserRound size={18} />
          账户与套餐
        </button>
        <button
          className="nav-item"
          disabled={!!busy}
          onClick={() =>
            void run('保存草稿', async () => {
              await save();
              nav('/guide');
            })
          }
        >
          <BookOpen size={18} />
          功能与流程
        </button>
        <div className="sidebar-bottom">
          <div className="project-status">
            <span
              className={'live-dot ' + (scene.confirmation.status === 'confirmed' ? '' : 'amber')}
            />
            {scene.confirmation.status === 'confirmed'
              ? scene.confirmation.basis === 'demo'
                ? '演示尺寸已确认 · 非实测'
                : '实测户型已确认'
              : '等待尺寸确认'}
            <small>修改结构尺寸后需重新确认</small>
          </div>
          <UserBadge />
        </div>
      </aside>
      <main className="workspace-main">
        <header className="workspace-header">
          <div>
            <button
              className="mobile-menu icon-button"
              aria-label="打开导航"
              onClick={() => setMobileNav(!mobileNav)}
            >
              <Menu size={21} />
            </button>
            <Link to="/projects">我的项目</Link>
            <ChevronRight size={14} />
            <button className="project-title" onClick={() => setModal('settings')}>
              {project.data.name}
              <ChevronDown size={13} />
            </button>
            <span
              className={
                'save-state ' +
                (st.status.includes('失败') || st.status.includes('冲突') ? 'bad' : '')
              }
            >
              <span />
              {st.status}
            </span>
          </div>
          <div className="header-actions">
            <button
              className="button ghost compact"
              aria-label="上传平面图生成户型"
              onClick={() => setModal('floorplan')}
            >
              <ScanLine size={16} />
              <span>上传平面图</span>
            </button>
            <button
              className="button ghost compact"
              aria-label="分享方案"
              onClick={() => setModal('share')}
            >
              <Share2 size={16} />
              <span>分享</span>
            </button>
            <button
              className="button outline compact"
              aria-label="导出方案"
              onClick={() => setModal('export')}
            >
              <Download size={16} />
              <span>导出</span>
            </button>
            <button
              className="button primary compact"
              aria-label="保存方案"
              onClick={() => setModal('save')}
              disabled={!!busy}
            >
              <Save size={15} />
              <span>保存方案</span>
            </button>
          </div>
        </header>
        <div className="workspace-title">
          <div>
            <span className="eyebrow">
              {tab === 'editor' ? 'DESIGN YOUR EVERYDAY' : 'YOUR SPACE, IN DETAIL'}
            </span>
            <h1>
              {navItems.find((n) => n.id === tab)?.name}
              <small>
                {scene.floors.length > 1 && `${scene.floors.length} 层 · `}
                {scene.floors.flatMap((f) => f.rooms).length} 个空间 ·{' '}
                {(
                  scene.floors
                    .flatMap((f) => f.rooms)
                    .filter((r) => isInteriorArea(r.type))
                    .reduce((a, r) => a + r.computedAreaMm2, 0) / 1e6
                ).toFixed(2)}{' '}
                m²
              </small>
            </h1>
          </div>
          <div className="workspace-title-actions">
            {(tab === 'editor' || tab === 'measure') && (
              <>
                <button className="button ghost compact" onClick={() => run('校验', validate)}>
                  <ScanLine size={16} />
                  校验场景
                </button>
                <button
                  className={
                    'button ' +
                    (scene.confirmation.status === 'confirmed' ? 'confirmed-button' : 'outline')
                  }
                  onClick={() => setModal('confirm')}
                >
                  <CheckCheck size={16} />
                  {scene.confirmation.status === 'confirmed'
                    ? scene.confirmation.basis === 'demo'
                      ? '演示尺寸已确认'
                      : '已确认实测'
                    : '确认尺寸来源'}
                </button>
              </>
            )}
          </div>
        </div>
        <WorkflowNav active={tab} onNavigate={setTab} />
        {tab === 'editor' || tab === 'measure' ? (
          <div className={'editor-layout ' + (!right ? 'hide-inspector' : '')}>
            <aside className="asset-panel">
              <div className="panel-heading">
                <h3>空间列表</h3>
                <button
                  className={'icon-button ' + (draw ? 'selected' : '')}
                  aria-label="绘制新房间"
                  title="绘制新房间"
                  onClick={() => {
                    setView('2d');
                    setDraw(!draw);
                  }}
                >
                  <Plus size={17} />
                </button>
              </div>
              <FloorSwitcher
                scene={scene}
                floorId={floor.id}
                onChange={(id) => {
                  st.selectFloor(id);
                  setDraw(false);
                }}
              />
              <div className="room-list">
                {floor.rooms.map((r, i) => (
                  <button
                    key={r.id}
                    className={st.roomId === r.id ? 'active' : ''}
                    onClick={() => st.selectRoom(r.id)}
                  >
                    <span className="room-icon">{String(i + 1).padStart(2, '0')}</span>
                    <span>
                      {r.name}
                      <small>{(r.computedAreaMm2 / 1e6).toFixed(2)} m²</small>
                    </span>
                    <ChevronRight size={13} />
                  </button>
                ))}
              </div>
              <StructurePanel onValidate={() => void run('结构校验', validate)} />
              <button className="button ghost full" onClick={() => setModal('template-reset')}>
                重设户型框架
              </button>
              <button className="button outline full" onClick={() => setModal('floorplan')}>
                上传平面图生成户型
              </button>
              {tab === 'measure' ? (
                <div className="measurement-guide">
                  <Ruler size={24} />
                  <h4>以净尺寸为准</h4>
                  <p>测量内墙完成面之间的距离，并记录层高、门窗和固定设施。</p>
                  <p>在右侧录入房间尺寸。非矩形房间可绘制轮廓，或编辑坐标点。</p>
                  <button className="button outline full" onClick={() => setModal('measurements')}>
                    查看实测记录
                  </button>
                  <button className="button ghost full" onClick={() => setModal('import')}>
                    导入场景 / CSV
                  </button>
                </div>
              ) : (
                <ItemLibrary
                  items={catalog.data?.items || []}
                  roomName={room?.name || '当前房间'}
                  loading={catalog.isPending}
                  error={catalog.isError}
                  onRetry={() => void catalog.refetch()}
                  onAdd={(item) => {
                    let fid = '';
                    st.change((s) => {
                      fid = addFurniture(s, item, room.id).id;
                    });
                    st.select(fid);
                    setRight(true);
                  }}
                />
              )}
              <details className="object-list">
                <summary>场景对象与门窗</summary>
                {scene.layout.furniture
                  .filter((f) => f.floorId === floor.id)
                  .map((f) => (
                    <button
                      key={f.id}
                      onClick={() => {
                        st.select(f.id);
                        setRight(true);
                      }}
                    >
                      {scene.layout.catalogSnapshot.find((c) => c.skuId === f.skuId)?.name ||
                        '自定义家具'}
                      <small>{f.locked ? '已锁定' : '家具'}</small>
                    </button>
                  ))}
                {floor.openings.map((o, i) => (
                  <button
                    key={o.id}
                    onClick={() => {
                      st.select(o.id);
                      setRight(true);
                    }}
                  >
                    {o.kind === 'door' ? '门洞' : '窗洞'} {i + 1}
                    <small>{o.widthMm} mm</small>
                  </button>
                ))}
                {floor.walls.map((w, i) => (
                  <button
                    key={w.id}
                    onClick={() => {
                      st.select(w.id);
                      setRight(true);
                    }}
                  >
                    墙段 {i + 1}
                    <small>未知结构</small>
                  </button>
                ))}
              </details>
            </aside>
            <section className="canvas-section">
              <div className="canvas-toolbar">
                <div className="segmented">
                  <button className={view === '2d' ? 'active' : ''} onClick={() => setView('2d')}>
                    2D 户型
                  </button>
                  <button
                    className={view === '3d' ? 'active' : ''}
                    onClick={() => {
                      setView('3d');
                      setDraw(false);
                    }}
                  >
                    3D 空间
                  </button>
                </div>
                <div className="tool-buttons">
                  <button
                    className="icon-button"
                    disabled={!st.past.length}
                    aria-label="撤销"
                    title="撤销 Ctrl+Z"
                    onClick={st.undo}
                  >
                    <Undo2 size={16} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={!st.future.length}
                    aria-label="重做"
                    title="重做 Ctrl+Shift+Z"
                    onClick={st.redo}
                  >
                    <Redo2 size={16} />
                  </button>
                  <i />
                  {view === '2d' ? (
                    <button
                      className={'icon-button ' + (draw ? 'selected' : '')}
                      aria-label="绘制房间"
                      title="绘制房间"
                      onClick={() => setDraw(!draw)}
                    >
                      <PenTool size={16} />
                    </button>
                  ) : (
                    <button className="button ghost compact" onClick={() => setCutaway(!cutaway)}>
                      {cutaway ? '显示完整墙' : '透明前侧外墙'}
                    </button>
                  )}
                  <button
                    className="icon-button"
                    aria-label={right ? '隐藏属性' : '显示属性'}
                    onClick={() => setRight(!right)}
                  >
                    {right ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
                  </button>
                </div>
              </div>
              {view === '2d' && <SelectionTools />}
              <div className="canvas-container">
                {view === '2d' ? (
                  <Plan2D
                    draw={draw}
                    onDraw={(points) => {
                      st.change((s) =>
                        addRoom(s, points, '新空间 ' + (floor.rooms.length + 1), floor.id),
                      );
                      setDraw(false);
                      notify('轮廓已加入草稿，请校验边界与墙体。');
                    }}
                  />
                ) : (
                  <Suspense fallback={<Spinner label="正在准备 3D 空间…" />}>
                    <Scene3D
                      scene={scene}
                      style={style}
                      cutaway={cutaway}
                      onCutawayChange={setCutaway}
                      onSelect={st.select}
                      roomId={room?.id}
                      floorId={floor.id}
                      onFloorChange={st.selectFloor}
                      selectedId={st.selected}
                      onRoomChange={st.selectRoom}
                      onExteriorChange={(styleId) =>
                        st.change((draft) => {
                          draft.layout.exterior = { styleId };
                        })
                      }
                      onCaptureReference={(capture) =>
                        run('创建3D参考', async () => {
                          const w = await save();
                          const asset = await post<Asset>(prefix + '/scene-references', {
                            ...capture,
                            baseRevision: w.revision,
                          });
                          await qc.invalidateQueries({ queryKey: ['assets', pid] });
                          setAiPhotos([asset.id]);
                          setInstruction(
                            '保留当前相机、墙角、门窗和家具布局，仅改善表面材质与灯光。',
                          );
                          setModal('ai');
                          notify('3D视角参考已保存为非实拍图片，可用于同视角装修生成。');
                        })
                      }
                    />
                  </Suspense>
                )}
              </div>
              {st.issues.length > 0 && (
                <div className="issue-tray">
                  <strong>
                    <AlertCircle size={16} />
                    发现 {st.issues.length} 个问题
                  </strong>
                  {st.issues.slice(0, 5).map((i, n) => (
                    <button key={n} onClick={() => i.objectIds[0] && st.select(i.objectIds[0])}>
                      {i.message}
                      <span>{i.code}</span>
                    </button>
                  ))}
                  {st.issues.length > 5 && (
                    <small>另有 {st.issues.length - 5} 项，可在校验接口响应中查看。</small>
                  )}
                </div>
              )}
              <div className="canvas-footer">
                <span>
                  <Ruler size={14} />
                  毫米级同源场景 · 50 mm 拖动吸附
                </span>
                <span>尺寸化概念模型，不作为施工图</span>
              </div>
              {tab === 'editor' && (
                <div className="style-strip">
                  <div>
                    <span className="eyebrow">MAKE IT YOURS</span>
                    <strong>选择生活的色调</strong>
                  </div>
                  <div className="style-options">
                    {catalog.data?.styles.map((s) => (
                      <button
                        key={s.id}
                        className={scene.layout.styleId === s.id ? 'active' : ''}
                        onClick={() => st.change((next) => (next.layout.styleId = s.id))}
                        title={s.description}
                      >
                        <i style={{ background: s.color }} />
                        {s.name}
                      </button>
                    ))}
                  </div>
                  <button
                    className="button primary compact"
                    onClick={() => setModal('layout')}
                    disabled={!!busy || pending > 0}
                  >
                    <Sparkles size={16} />
                    {busy === '生成布局' ? '提交中…' : '生成布局'}
                  </button>
                </div>
              )}
            </section>
            <aside className="inspector-panel">
              <Inspector key={st.selected || st.roomId || 'room'} scene={scene} roomId={room?.id} />
              {tab === 'editor' && (
                <div className="ai-card">
                  <Sparkles size={22} />
                  <strong>看见家的更多可能</strong>
                  <p>以房间照片探索装修风格，生成概念效果图。</p>
                  <span className={'config-status ' + (caps.data?.aiImage ? 'ready' : '')}>
                    {caps.data?.aiImage ? 'AI 服务已启用' : '待配置 AI 服务密钥'}
                  </span>
                  <button className="button outline full" onClick={() => setModal('ai')}>
                    生成装修效果 <ArrowUpRight size={14} />
                  </button>
                </div>
              )}
            </aside>
          </div>
        ) : (
          <div className="workspace-page">
            {tab === 'overview' && (
              <ProjectOverview
                project={project.data}
                scene={scene}
                revision={st.revision}
                designs={designs.data?.items || []}
                assets={assets.data?.items || []}
                jobs={jobs.data?.items || []}
                loadingData={designs.isPending || assets.isPending || jobs.isPending}
                dataError={designs.isError || assets.isError || jobs.isError}
                onNavigate={setTab}
                onAction={setModal}
                onIssue={(id, issues) => {
                  st.select(id);
                  st.setIssues(issues);
                  setTab('measure');
                  setRight(true);
                }}
              />
            )}
            {tab === 'photos' && (
              <PhotosPanel
                projectId={pid}
                scene={scene}
                assets={assets.data?.items || []}
                onInpaint={setMaskAsset}
                onAI={(a) => {
                  setAiPhotos([a]);
                  setModal('ai');
                }}
                onRevise={(ids, roomId, text) => {
                  setAiPhotos(ids);
                  st.selectRoom(roomId);
                  setInstruction(text);
                  setModal('ai');
                }}
              />
            )}
            {tab === 'versions' && (
              <VersionsPanel
                projectId={pid}
                designs={designs.data?.items || []}
                styles={catalog.data?.styles || []}
                onApply={(d) => {
                  st.replace(d.scene, d.id);
                  setTab('editor');
                  notify('已载入版本到当前草稿，原版本保留。');
                }}
              />
            )}
            {tab === 'budget' && (
              <BudgetPanel
                projectId={pid}
                scene={scene}
                onExport={() =>
                  run('导出', async () => {
                    await job('export', { parameters: { format: 'csv' } });
                    setTab('jobs');
                  })
                }
              />
            )}{' '}
            {tab === 'jobs' && (
              <JobsPanel
                jobs={jobs.data?.items || []}
                onCancel={(jid) =>
                  run('取消', async () => {
                    await post('/jobs/' + jid + '/cancel', {});
                    qc.invalidateQueries({ queryKey: ['jobs', pid] });
                  })
                }
                onVersions={() => setTab('versions')}
                onPhotos={() => setTab('photos')}
              />
            )}
          </div>
        )}
      </main>
      {restore && (
        <Modal title="发现浏览器中的未保存草稿" onClose={() => setRestore(null)}>
          <p className="muted">上次离开时留有本地修改。恢复后会继续使用服务器的最新修订号保存。</p>
          <div className="modal-actions">
            <button
              className="button outline"
              onClick={() => {
                localStorage.removeItem(backupKey);
                setRestore(null);
              }}
            >
              使用服务器版本
            </button>
            <button
              className="button primary"
              onClick={() => {
                st.replace(restore);
                setRestore(null);
                notify('已恢复浏览器草稿，请校验后保存。');
              }}
            >
              恢复本地草稿
            </button>
          </div>
        </Modal>
      )}
      {modal === 'confirm' && (
        <Modal title="确认尺寸来源" onClose={() => setModal(null)}>
          <p>确认后，当前墙体、房间轮廓与门窗将形成独立的几何版本。后续布局会使用这份版本。</p>
          <div className="confirm-summary">
            <span>
              净面积
              <strong>
                {(
                  scene.floors
                    .flatMap((f) => f.rooms)
                    .filter((r) => isInteriorArea(r.type))
                    .reduce((a, r) => a + r.computedAreaMm2, 0) / 1e6
                ).toFixed(2)}{' '}
                m²
              </strong>
            </span>
            <span>
              房间数<strong>{scene.floors.flatMap((f) => f.rooms).length}</strong>
            </span>
            <span>
              门窗数<strong>{scene.floors.flatMap((f) => f.openings).length}</strong>
            </span>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run('确认实测', confirm);
            }}
          >
            <label>
              本次尺寸依据
              <select
                value={confirmationBasis}
                onChange={(e) => setConfirmationBasis(e.target.value as typeof confirmationBasis)}
              >
                <option value="user_measured">真实房屋实测数据</option>
                <option value="demo">演示尺寸（虚构参考，非实测）</option>
              </select>
            </label>
            <label className="checkbox-row">
              <input key={confirmationBasis} type="checkbox" required />
              {confirmationBasis === 'demo'
                ? '我知悉这些是演示尺寸，只用于流程与效果参考，不代表真实房屋。'
                : '我已核对实际净尺寸、层高和门窗位置；示例尺寸已按需要替换。'}
            </label>
            <p className="fine-print">仅确认用户测量数据，不代表结构安全、拆改许可或施工审查。</p>
            <button className="button primary full" disabled={!!busy}>
              {busy
                ? '正在确认…'
                : confirmationBasis === 'demo'
                  ? '校验并确认演示尺寸'
                  : '校验并确认实测'}
            </button>
          </form>
        </Modal>
      )}
      {modal === 'save' && (
        <Modal title="保存为一个方案版本" onClose={() => setModal(null)}>
          <p className="muted">版本会固定此刻的户型与家具布局，可用于比较、分享和预算。</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const title = String(new FormData(e.currentTarget).get('title'));
              run('保存方案', () => freeze(title));
            }}
          >
            <label>
              方案名称
              <input
                name="title"
                required
                maxLength={120}
                defaultValue={`${style?.name || '我的方案'} · ${new Date().toLocaleDateString('zh-CN')}`}
              />
            </label>
            <div className="inline-note">
              需要已确认尺寸来源，并通过家具与门扇冲突校验；演示版本会保留虚构标记。
            </div>
            <button className="button primary full" disabled={!!busy}>
              {busy ? '正在保存…' : '保存方案'}
            </button>
          </form>
        </Modal>
      )}
      {modal === 'export' && (
        <Modal title="导出你的空间方案" onClose={() => setModal(null)}>
          <p className="muted">将当前草稿生成下载文件，文件会保存在生成记录中。</p>
          <div className="export-options">
            {[
              { id: 'pdf', title: 'PDF 方案书', desc: '户型平面图 + 装修与家具估算' },
              { id: 'json', title: 'JSON 场景', desc: '可再次导入的完整尺寸与布局数据' },
              {
                id: 'csv',
                title: 'CSV 预算清单',
                desc: '装修材料、人工与家具报价，可用 Excel 打开',
              },
            ].map((f) => (
              <button
                disabled={!!busy}
                key={f.id}
                onClick={() =>
                  run('导出', async () => {
                    await job('export', { parameters: { format: f.id } });
                    setModal(null);
                    setTab('jobs');
                  })
                }
              >
                <span>{f.id.toUpperCase()}</span>
                <div>
                  <strong>{f.title}</strong>
                  <p>{f.desc}</p>
                </div>
                <Download size={18} />
              </button>
            ))}
          </div>
        </Modal>
      )}
      {modal === 'share' && (
        <Modal
          title="分享一个固定方案"
          onClose={() => {
            setModal(null);
            setShareLink('');
          }}
        >
          <p className="muted">链接只允许查看选定版本，72 小时后过期；可随时撤销。</p>
          {shareLink ? (
            <>
              <input
                readOnly
                value={shareLink}
                onFocus={(e) => e.target.select()}
                aria-label="分享链接"
              />
              <button
                className="button primary full"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(shareLink);
                    notify('分享链接已复制。');
                  } catch {
                    notify('请选中上方链接复制。');
                  }
                }}
              >
                复制分享链接
              </button>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const designId = String(new FormData(e.currentTarget).get('design'));
                run('分享', async () => {
                  const s = await post<{ path: string }>(prefix + '/shares', {
                    designId,
                    expiresInHours: 72,
                  });
                  setShareLink(location.origin + s.path);
                });
              }}
            >
              <label>
                选择方案
                <select name="design" required>
                  {designs.data?.items.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
                </select>
              </label>
              {!designs.data?.items.length ? (
                <p className="inline-note">请先保存一个方案版本。</p>
              ) : (
                <button className="button primary full" disabled={!!busy}>
                  创建只读链接
                </button>
              )}
            </form>
          )}
          <MembersPanel projectId={pid} />
        </Modal>
      )}
      {modal === 'measurements' && (
        <Modal title="实测记录" wide onClose={() => setModal(null)}>
          <MeasurementsPanel scene={scene} />
        </Modal>
      )}
      {modal === 'template-reset' && (
        <Modal title="重设户型框架" wide onClose={() => setModal(null)}>
          <TemplateReset
            scene={scene}
            onApply={(s) => {
              st.replace(s);
              setModal(null);
              setTab('editor');
              setView('3d');
              notify('新户型已载入未确认草稿，可通过撤销恢复原草稿。');
            }}
          />
        </Modal>
      )}
      {modal === 'floorplan' && (
        <Modal title="上传平面图生成户型" wide onClose={() => setModal(null)}>
          <FloorPlanImport
            projectId={pid}
            assets={assets.data?.items || []}
            caps={caps.data}
            onBeforeGenerate={save}
            onApply={(s) => {
              st.replace(s);
              setTab('editor');
              setView('3d');
              setModal(null);
              notify('识别结果已载入未确认草稿，请校对尺寸及门窗。');
            }}
          />
        </Modal>
      )}
      {modal === 'import' && (
        <Modal title="导入实测或场景数据" wide onClose={() => setModal(null)}>
          <MeasurementImport
            scene={scene}
            projectId={pid}
            onApply={(s) => {
              st.replace(s);
              setModal(null);
            }}
          />
          <p className="muted">
            支持本应用导出的 JSON 场景，或 CSV：room_name,width_mm,depth_mm,height_mm。CSV
            房间名需与当前空间相同。
          </p>
          <input
            type="file"
            accept=".json,.csv"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                const text = await file.text();
                if (file.name.toLowerCase().endsWith('.json')) {
                  const s = JSON.parse(text) as Scene;
                  const report = await post<Validation>(prefix + '/geometry-drafts/validate', {
                    scene: s,
                    baseRevision: st.revision,
                  });
                  if (report.issues.some((i) => i.code === 'SCHEMA_INVALID'))
                    throw new Error('场景 JSON 格式不符合当前 Schema。');
                  st.replace(s);
                } else {
                  let s = structuredClone(scene);
                  const lines = text
                    .replace(/^\uFEFF/, '')
                    .trim()
                    .split(/\r?\n/);
                  if (lines.shift()?.trim() !== 'room_name,width_mm,depth_mm,height_mm')
                    throw new Error('CSV 表头不匹配。');
                  for (const line of lines) {
                    const [name, w, d, h] = line.split(',');
                    const room = activeFloor(s, floor.id).rooms.find((r) => r.name === name.trim());
                    if (
                      !room ||
                      ![w, d, h].every((n) => Number.isFinite(+n) && +n >= 100 && +n <= 100000)
                    )
                      throw new Error('CSV 房间名或尺寸无效：' + line);
                    s = resizedRoom(s, room, +w, +d, +h);
                  }
                  st.replace(s);
                }
                setModal(null);
                notify('数据已导入草稿，请校验并重新确认实测。');
              } catch (err) {
                notify((err as Error).message, true);
              } finally {
                e.target.value = '';
              }
            }}
          />
          <p className="fine-print">导入后保留原有版本；几何变更需重新确认。</p>
        </Modal>
      )}
      {modal === 'layout' && (
        <Modal title="居住需求与布局优化" onClose={() => setModal(null)}>
          <LayoutBrief
            scene={scene}
            projectId={pid}
            busy={!!busy || pending > 0}
            onGenerate={() =>
              void run('生成布局', async () => {
                await job('layout');
                setModal(null);
                setTab('jobs');
              })
            }
          />
        </Modal>
      )}
      {modal === 'ai' && (
        <Modal title="生成装修概念效果" onClose={() => setModal(null)} wide>
          <AiComposer
            scene={scene}
            assets={assets.data?.items || []}
            projectId={pid}
            caps={caps.data}
            busy={!!busy}
            initialPhotos={aiPhotos}
            instruction={instruction}
            onInstruction={setInstruction}
            onMeasure={() => {
              setTab('measure');
              setModal('confirm');
            }}
            onPhotos={() => {
              setTab('photos');
              setModal(null);
            }}
            styles={catalog.data?.styles || []}
            onStyle={(styleId) =>
              st.change((s) => {
                s.layout.styleId = styleId;
              })
            }
            onGenerate={(ids, roomId) =>
              run('生成效果', async () => {
                await job('style', {
                  assetIds: ids,
                  roomIds: [roomId],
                  styleIds: [scene.layout.styleId],
                  instruction,
                  maxCredits: caps.data?.aiCreditsPerImage || 0,
                  parameters: { geometryGuide: true },
                });
                setModal(null);
                setTab('jobs');
              })
            }
          />
        </Modal>
      )}
      {maskAsset && (
        <MaskEditor
          asset={maskAsset}
          cost={caps.data?.aiInpaintCredits ?? 8}
          aiEnabled={!!caps.data?.aiInpaint}
          onClose={() => setMaskAsset(null)}
          onSubmit={async ({ assetId, maskDataUrl, instruction: request }) => {
            await job('inpaint', {
              assetIds: [assetId],
              instruction: request,
              maskDataUrl,
              maxCredits: caps.data?.aiInpaintCredits ?? 0,
            });
            setMaskAsset(null);
            setTab('jobs');
            notify('局部改图已提交，完成后可在生成记录查看。');
          }}
        />
      )}
      {modal === 'settings' && (
        <Modal title="项目设置" onClose={() => setModal(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              run('更新项目', async () => {
                await api(prefix, {
                  method: 'PATCH',
                  body: JSON.stringify({
                    name: data.get('name'),
                    description: data.get('description'),
                    baseRevision: project.data.revision,
                  }),
                });
                qc.invalidateQueries({ queryKey: ['project', pid] });
                qc.invalidateQueries({ queryKey: ['projects'] });
                setModal(null);
              });
            }}
          >
            <label>
              项目名称
              <input name="name" required maxLength={120} defaultValue={project.data.name} />
            </label>
            <label>
              居住需求
              <textarea
                name="description"
                defaultValue={project.data.description}
                maxLength={2000}
              />
            </label>
            <button className="button primary full" disabled={!!busy}>
              保存设置
            </button>
          </form>
          <button className="button danger full" onClick={() => setModal('delete')}>
            删除项目
          </button>
        </Modal>
      )}
      {modal === 'delete' && (
        <Modal title="删除这个项目" onClose={() => setModal(null)}>
          <p>
            删除后项目和分享链接将立即无法访问。当前本地版本使用软删除，物理数据需通过运维清理命令移除。
          </p>
          <button
            className="button danger full"
            onClick={() =>
              run('删除', async () => {
                await api(prefix, { method: 'DELETE' });
                localStorage.removeItem(backupKey);
                qc.invalidateQueries({ queryKey: ['projects'] });
                nav('/projects');
              })
            }
            disabled={!!busy}
          >
            确认删除项目
          </button>
        </Modal>
      )}
      <Assistant projectId={pid} onNavigate={setTab} />
      {modal === 'conflict' && (
        <Modal title="另一会话保存了新版本" onClose={() => setModal(null)}>
          <p>你的修改仍保留在当前浏览器。可以下载 JSON 留存，再载入服务器的最新版本。</p>
          <button
            className="button outline full"
            onClick={() => {
              const blob = new Blob([JSON.stringify(st.scene, null, 2)], {
                  type: 'application/json',
                }),
                url = URL.createObjectURL(blob),
                a = document.createElement('a');
              a.href = url;
              a.download = '筑见-冲突草稿.json';
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            下载我的草稿 JSON
          </button>
          <button
            className="button primary full"
            onClick={() =>
              run('载入', async () => {
                const w = await api<Working>(prefix + '/working-copy');
                st.load(pid, w);
                blocked.current = false;
                setModal(null);
              })
            }
          >
            载入服务器最新版本
          </button>
        </Modal>
      )}
    </div>
  );
}
