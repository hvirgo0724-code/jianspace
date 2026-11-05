import { createContext, useContext, useState, useCallback, useEffect, lazy, Suspense } from 'react';
import TemplatePicker from './components/TemplatePicker';
import {
  Routes,
  Route,
  Navigate,
  useNavigate,
  Link,
  useParams,
  useSearchParams,
  useLocation,
} from 'react-router-dom';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  LayoutGrid,
  FolderOpen,
  Clock3,
  LogOut,
  Search,
  ShieldCheck,
  ChevronRight,
  House,
  Ruler,
  Box,
  Leaf,
  Copy,
  UserRound,
  BookOpen,
  Wallet,
  ScanLine,
} from 'lucide-react';
import { api, post } from './api';
import type { User, Project, ProjectPage, Capabilities, Design } from './types';
import { Logo, Spinner, Empty, Modal, Toast } from './components/UI';
import { PlanThumbnail, FloorPlanPreview } from './components/Plan2D';
const Scene3D = lazy(() => import('./components/Scene3D'));
import Workspace from './Workspace';
import { type ProjectSort } from './projectWorkflow';
import PlansPage, { GuidePage, usePlans } from './components/Plans';
import AccountPage from './components/Account';
import ErrorBoundary from './components/ErrorBoundary';
import Assistant from './components/Assistant';

type Notice = (message: string, error?: boolean) => void;
const NoticeContext = createContext<Notice>(() => {});
export const useNotice = () => useContext(NoticeContext);
export const UserContext = createContext<User | null>(null);
function RouteScroll() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}
export default function App() {
  const [notice, setNotice] = useState<{ message: string; error?: boolean } | null>(null),
    clear = useCallback(() => setNotice(null), []);
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<User>('/me'), retry: false });
  const notify = useCallback<Notice>((message, error = false) => setNotice({ message, error }), []);
  return (
    <NoticeContext.Provider value={notify}>
      <UserContext.Provider value={me.data || null}>
        <ErrorBoundary>
          <RouteScroll />
          <Routes>
          <Route
            path="/"
            element={
              me.isLoading ? (
                <Spinner />
              ) : me.data ? (
                <Navigate to="/projects" replace />
              ) : (
                <Welcome />
              )
            }
          />
          <Route
            path="/projects"
            element={
              me.isLoading ? <Spinner /> : me.data ? <Dashboard /> : <Navigate to="/" replace />
            }
          />
          <Route
            path="/projects/:projectId"
            element={
              me.isLoading ? <Spinner /> : me.data ? <Workspace /> : <Navigate to="/" replace />
            }
          />
          <Route path="/share/:token" element={<PublicShare />} />
          <Route path="/plans" element={<PlansPage />} />
          <Route path="/guide" element={<GuidePage />} />
          <Route
            path="/account"
            element={
              me.isLoading ? (
                <Spinner />
              ) : me.data ? (
                <AccountPage />
              ) : (
                <Navigate to="/?auth=login" replace />
              )
            }
          />
          <Route path="/reset" element={<ResetPassword />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        {notice && <Toast {...notice} onClose={clear} />}
        </ErrorBoundary>
      </UserContext.Provider>
    </NoticeContext.Provider>
  );
}
function Welcome() {
  const [params] = useSearchParams();
  const [auth, setAuth] = useState<'login' | 'register' | null>(() =>
      params.get('auth') === 'register'
        ? 'register'
        : params.get('auth') === 'login'
          ? 'login'
          : null,
    ),
    [busy, setBusy] = useState(false),
    nav = useNavigate(),
    qc = useQueryClient(),
    notify = useNotice();
  const cap = useQuery({
    queryKey: ['capabilities'],
    queryFn: () => api<Capabilities>('/capabilities'),
  });
  async function demo() {
    setBusy(true);
    try {
      await post('/auth/demo', {});
      await qc.invalidateQueries({ queryKey: ['me'] });
      const p = await post<Project>('/projects', {
        name: '我的第一间理想家',
        templateId: 'two-room',
      });
      nav('/projects/' + p.id);
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="welcome">
      <nav>
        <Logo />
        <span className="welcome-nav">从真实尺寸，走向理想生活。</span>
        <Link className="welcome-help-btn" to="/guide">
          功能说明
        </Link>
        <Link className="welcome-help-btn" to="/plans">
          套餐与收费
        </Link>
        <button className="button ghost" onClick={() => setAuth('login')}>
          登录 / 注册 <ArrowUpRight size={16} />
        </button>
      </nav>
      <main className="welcome-main">
        <div className="welcome-copy">
          <div className="eyebrow">
            <span />
            空间设计，从你开始
          </div>
          <h1>
            每一寸真实，
            <br />
            都有理想的<span>模样。</span>
          </h1>
          <p>
            上传房间照片，录入实测尺寸。
            <br />在 2D 与 3D 之间，自由探索属于你的家。
          </p>
          <div className="welcome-actions">
            {cap.data?.demo && (
              <button className="button primary large" disabled={busy} onClick={demo}>
                {busy ? '正在准备空间…' : '开启设计体验'}
                <ArrowRight size={18} />
              </button>
            )}
            <button className="button ghost" onClick={() => setAuth('register')}>
              创建我的账户 <ArrowUpRight size={17} />
            </button>
          </div>
          <div className="welcome-trust">
            <span>
              <Ruler size={16} />
              实测尺寸为准
            </span>
            <span>
              <Box size={16} />
              2D / 3D 同步
            </span>
            <span>
              <ShieldCheck size={16} />
              私有项目空间
            </span>
          </div>
        </div>
        <div className="welcome-art">
          <div className="art-grid" />
          <div className="mini-space">
            <div className="mini-floor" />
            <div className="mini-wall one" />
            <div className="mini-wall two" />
            <div className="mini-rug" />
            <div className="mini-sofa" />
            <div className="mini-table" />
            <div className="mini-plant">
              <Leaf size={50} />
            </div>
          </div>
          <span className="art-label">YOUR SPACE, REIMAGINED.</span>
          <div className="art-tag">
            <span className="live-dot" />
            从毛坯，到理想生活 <ArrowUpRight size={15} />
          </div>
          <div className="art-measure">
            4,000 mm <i />
          </div>
        </div>
      </main>
      <footer>
        <span>筑见 · 实测空间设计</span>
        <Link to="/guide">让家的想象，有据可依 · 使用说明</Link>
        <span>独立 Web 应用 / 开发预览版</span>
      </footer>
      {auth && <AuthModal mode={auth} setMode={setAuth} onClose={() => setAuth(null)} />}
    </div>
  );
}
function AuthModal({
  mode,
  setMode,
  onClose,
}: {
  mode: 'login' | 'register';
  setMode: (s: 'login' | 'register') => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false),
    notify = useNotice(),
    qc = useQueryClient(),
    nav = useNavigate();
  const plans = usePlans();
  return (
    <Modal title={mode === 'login' ? '欢迎回到筑见' : '创建你的设计空间'} onClose={onClose}>
      <p className="muted">保存真实户型，让每一次设计都有迹可循。</p>
      {mode === 'register' && plans.data && (
        <p className="inline-note">
          免费体验包含 1 个进行中自有项目，新注册赠送 {plans.data.registrationCredits}{' '}
          点应用积分；家庭版可免费试用 {plans.data.trialDays} 天。不发起支付。
        </p>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          setBusy(true);
          try {
            await post('/auth/' + mode, {
              email: data.get('email'),
              password: data.get('password'),
              ...(mode === 'register' ? { displayName: data.get('name') } : {}),
            });
            await qc.invalidateQueries({ queryKey: ['me'] });
            nav('/projects');
            onClose();
          } catch (err) {
            notify((err as Error).message, true);
          } finally {
            setBusy(false);
          }
        }}
      >
        {mode === 'register' && (
          <label>
            称呼
            <input
              name="name"
              placeholder="你的名字"
              required
              maxLength={80}
              autoComplete="nickname"
            />
          </label>
        )}
        <label>
          邮箱
          <input
            name="email"
            type="email"
            required
            placeholder="you@example.com"
            autoComplete="email"
          />
        </label>
        <label>
          密码
          <input
            name="password"
            type="password"
            required
            minLength={mode === 'register' ? 12 : 1}
            maxLength={128}
            placeholder={mode === 'register' ? '至少 12 个字符' : '请输入密码'}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          />
        </label>
        <button className="button primary full" disabled={busy}>
          {busy ? '正在处理…' : mode === 'login' ? '登录' : '创建账户'}
        </button>
      </form>
      <div className="auth-switch">
        {mode === 'login' ? '还没有账户？' : '已有账户？'}
        <button onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? '立即注册' : '返回登录'}
        </button>
        {mode === 'login' && (
          <button
            onClick={async () => {
              const email = window.prompt('输入注册邮箱，发送密码恢复邮件');
              if (email)
                try {
                  await post('/auth/password/forgot', { email });
                  notify('如该邮箱已注册，将收到恢复链接。');
                } catch (e) {
                  notify((e as Error).message, true);
                }
            }}
          >
            忘记密码
          </button>
        )}
      </div>
    </Modal>
  );
}
export function UserBadge() {
  const u = useContext(UserContext);
  return (
    <span className="user-badge">
      <span>{u?.displayName.slice(0, 1)}</span>
      <span>
        {u?.displayName}
        <small>
          {u?.isDemo ? '本地体验账户' : u?.role === 'admin' ? '运维管理账户' : '注册用户'}
        </small>
      </span>
    </span>
  );
}
export function Dashboard() {
  const user = useContext(UserContext),
    nav = useNavigate(),
    qc = useQueryClient(),
    notify = useNotice();
  const [modal, setModal] = useState(false),
    [template, setTemplate] = useState('three-bedroom'),
    [startMode, setStartMode] = useState<'template' | 'floorplan'>('template'),
    [filter, setFilter] = useState('all'),
    [search, setSearch] = useState(''),
    [projectStatus, setProjectStatus] = useState('all'),
    [sort, setSort] = useState<ProjectSort>('updated'),
    [copySource, setCopySource] = useState<Project | null>(null),
    [copying, setCopying] = useState(false),
    [busy, setBusy] = useState(false);
  const archived = filter === 'archived';
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const term = debouncedSearch.trim();
  const projects = useInfiniteQuery({
    queryKey: ['projects', archived, term, projectStatus, sort],
    queryFn: ({ pageParam }) =>
      api<ProjectPage>(
        `/projects?limit=24&archived=${archived}&offset=${pageParam}` +
          `&q=${encodeURIComponent(term)}&status=${projectStatus}&sort=${sort}`,
      ),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.nextCursor ? Number(last.nextCursor) : undefined),
  });
  const loaded = projects.data?.pages.flatMap((page) => page.items) || [];
  const total = projects.data?.pages[0]?.total ?? 0;
  const activeTotal = projects.data?.pages[0]?.activeTotal ?? 0;
  const rows = loaded;
  const activeProjects = loaded.filter((p) => !p.archived);
  async function logout() {
    try {
      await post('/auth/logout', {});
      for (const key of Object.keys(localStorage))
        if (key.startsWith('jianspace-draft:')) localStorage.removeItem(key);
      qc.clear();
      nav('/');
    } catch (e) {
      notify((e as Error).message, true);
    }
  }
  return (
    <div className="app-shell">
      <aside className="main-sidebar">
        <Link to="/projects">
          <Logo />
        </Link>
        <div className="sidebar-label">我的工作空间</div>
        <button
          className={'nav-item ' + (filter === 'all' ? 'active' : '')}
          onClick={() => setFilter('all')}
        >
          <LayoutGrid size={18} />
          我的项目<span>{activeTotal}</span>
        </button>
        <button
          className={'nav-item ' + (filter === 'archived' ? 'active' : '')}
          onClick={() => setFilter('archived')}
        >
          <FolderOpen size={18} />
          已归档项目
        </button>
        <Link className="nav-item" to="/account">
          <UserRound size={18} />
          账户与套餐
        </Link>
        <Link className="nav-item" to="/plans">
          <Wallet size={18} />
          套餐与收费
        </Link>
        <Link className="nav-item" to="/guide">
          <BookOpen size={18} />
          功能与流程
        </Link>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <Leaf size={23} />
            <strong>好设计，从真实开始</strong>
            <p>
              先测量，再想象。
              <br />
              把每一寸空间交还生活。
            </p>
          </div>
          <UserBadge />
          <button className="nav-item" onClick={logout}>
            <LogOut size={17} />
            退出账户
          </button>
        </div>
      </aside>
      <div className="main-content">
        <header className="topbar">
          <span>
            工作台 <ChevronRight size={14} /> 我的项目
          </span>
          <div>
            <span className="environment-pill">开发预览</span>
            <span className="avatar">{user?.displayName.slice(0, 1)}</span>
          </div>
        </header>
        <main className="dashboard-body">
          <section className="dashboard-heading">
            <div>
              <div className="eyebrow">A LITTLE CLOSER TO HOME</div>
              <h1>
                让家的想象，在这里开始<span>。</span>
              </h1>
              <p>从一份实测户型开始，慢慢打磨你的理想空间。</p>
            </div>
            <div className="dashboard-heading-actions">
              <button
                className="button outline"
                onClick={() => {
                  setStartMode('floorplan');
                  setModal(true);
                }}
              >
                <ScanLine size={17} />
                上传户型图
              </button>
              <button
                className="button primary"
                onClick={() => {
                  setStartMode('template');
                  setModal(true);
                }}
              >
                <Plus size={18} />
                新建项目
              </button>
            </div>
          </section>
          <section className="start-banner">
            <div className="banner-icon">
              <House size={31} strokeWidth={1} />
            </div>
            <div>
              <h3>真实尺寸，更多可能。</h3>
              <p>录入实测数据，让 2D 户型、3D 预览与布局方案始终一致。</p>
            </div>
            <button
              onClick={() => {
                setStartMode('template');
                setModal(true);
              }}
            >
              开始一个新空间 <ArrowUpRight size={18} />
            </button>
            <div className="banner-lines" />
          </section>
          <section className="dashboard-stats" aria-label="项目状态统计">
            <div>
              <small>进行中的空间</small>
              <strong>
                {activeTotal}
                <span> 个项目</span>
              </strong>
            </div>
            <div>
              <small>尺寸来源已确认</small>
              <strong>
                {activeProjects.filter((p) => p.geometryStatus === 'confirmed').length}
                <span> 个项目</span>
              </strong>
            </div>
            <div>
              <small>已有方案版本</small>
              <strong>
                {activeProjects.filter((p) => p.currentDesignId).length}
                <span> 个项目</span>
              </strong>
            </div>
            {projects.hasNextPage && (
              <p className="stats-scope">
                尺寸与方案统计基于当前筛选已载入的 {activeProjects.length} 个工作项目；加载更多后自动更新。
              </p>
            )}
          </section>
          <div className="projects-controls">
            <h2>
              {filter === 'archived' ? '已归档' : '全部'}项目 <small>{total}</small>
              {projects.hasNextPage && (
                <em>
                  已载入 {loaded.length} / {total}
                </em>
              )}
            </h2>
            <div>
              <label className="search-box">
                <Search size={16} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索名称或项目说明"
                  aria-label="搜索项目"
                />
              </label>
              <select
                aria-label="筛选尺寸状态"
                value={projectStatus}
                onChange={(e) => setProjectStatus(e.target.value)}
              >
                <option value="all">全部尺寸状态</option>
                <option value="draft">尺寸待确认</option>
                <option value="confirmed">尺寸已确认</option>
              </select>
              <label className="project-sort">
                <Clock3 size={15} />
                <select
                  aria-label="项目排序"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as ProjectSort)}
                >
                  <option value="updated">最近更新</option>
                  <option value="name">项目名称</option>
                  <option value="area">面积从大到小</option>
                </select>
              </label>
            </div>
          </div>
          {projects.isPending ? (
            <div className="project-grid" aria-busy="true" aria-label="正在载入项目">
              {[0, 1, 2].map((i) => (
                <div className="project-skeleton" key={i}>
                  <span />
                  <i />
                  <i />
                </div>
              ))}
            </div>
          ) : projects.isError ? (
            <Empty title="项目加载失败">
              <button className="button" onClick={() => projects.refetch()}>
                重试
              </button>
            </Empty>
          ) : (
            <>
              {!rows.length && (
                <Empty
                  title={
                    search || projectStatus !== 'all'
                      ? '没有匹配的项目'
                      : filter === 'archived'
                        ? '暂时没有归档项目'
                        : '从第一个空间开始'
                  }
                >
                  {(search || projectStatus !== 'all') && (
                    <button
                      className="button outline"
                      onClick={() => {
                        setSearch('');
                        setProjectStatus('all');
                      }}
                    >
                      清除筛选
                    </button>
                  )}
                </Empty>
              )}
              <div className="project-grid">
                {rows.map((p) => (
                  <article className="project-card" key={p.id}>
                    <button className="project-preview" onClick={() => nav('/projects/' + p.id)}>
                      {p.scenePreview && <PlanThumbnail scene={p.scenePreview} />}
                      <span className={'project-tag ' + (p.currentGeometryId ? 'confirmed' : '')}>
                        {p.archived
                          ? '已归档'
                          : p.geometryStatus === 'confirmed'
                            ? p.confirmationBasis === 'demo'
                              ? '演示尺寸已确认'
                              : '已确认实测'
                            : '尺寸待确认'}
                      </span>
                      <span className="open-project">
                        <ArrowUpRight size={22} />
                      </span>
                    </button>
                    <div className="project-meta">
                      <button onClick={() => nav('/projects/' + p.id)}>
                        <h3>{p.name}</h3>
                      </button>
                      <p>
                        {p.areaM2?.toFixed(1) || '—'} m² <i /> {p.rooms || 0} 个空间 <i />{' '}
                        {p.currentDesignId ? '已有方案' : '设计草稿'}
                      </p>
                      <footer>
                        <span>{new Date(p.updatedAt).toLocaleDateString('zh-CN')} 更新</span>
                        <div className="project-card-actions">
                          <button
                            aria-label={`复制项目：${p.name}`}
                            title="复制为独立草稿"
                            onClick={() => setCopySource(p)}
                          >
                            <Copy size={16} />
                          </button>
                          <button
                            aria-label={p.archived ? '取消归档' : '归档项目'}
                            title={p.archived ? '取消归档' : '归档项目'}
                            onClick={async () => {
                              try {
                                await post('/projects/' + p.id + '/archive', {
                                  archived: !p.archived,
                                  baseRevision: p.revision,
                                });
                                qc.invalidateQueries({ queryKey: ['projects'] });
                              } catch (e) {
                                notify((e as Error).message, true);
                              }
                            }}
                          >
                            <FolderOpen size={16} />
                          </button>
                        </div>
                      </footer>
                    </div>
                  </article>
                ))}
                <button className="new-project-card" onClick={() => setModal(true)}>
                  <span>
                    <Plus size={27} strokeWidth={1.2} />
                  </span>
                  <strong>新建一个空间</strong>
                  <small>把关于家的想法，变成现实</small>
                </button>
              </div>
              {projects.hasNextPage && (
                <div className="load-more">
                  <button
                    className="button outline"
                    disabled={projects.isFetchingNextPage}
                    onClick={() => void projects.fetchNextPage()}
                  >
                    {projects.isFetchingNextPage
                      ? '正在载入…'
                      : `加载更多项目（已载入 ${loaded.length} / ${total}）`}
                  </button>
                </div>
              )}
            </>
          )}
          <div className="dashboard-foot">
            <span>
              <ShieldCheck size={15} />
              你的照片与户型仅对授权成员可见
            </span>
            <span>以实测为依据 · 以生活为尺度</span>
          </div>
        </main>
        <Assistant />
      </div>
      {copySource && (
        <Modal title="复制项目" onClose={() => !copying && setCopySource(null)}>
          <p className="muted">
            以「{copySource.name}」的最新草稿创建独立项目，保留户型、家具和报价。原项目保持不变。
          </p>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const name = String(new FormData(event.currentTarget).get('copyName') || '').trim();
              if (!name || copying) return;
              setCopying(true);
              try {
                const copied = await post<Project>(`/projects/${copySource.id}/copy`, { name });
                await qc.invalidateQueries({ queryKey: ['projects'] });
                setCopySource(null);
                notify('独立副本已创建，请重新核对尺寸来源。');
                nav('/projects/' + copied.id);
              } catch (error) {
                notify((error as Error).message, true);
              } finally {
                setCopying(false);
              }
            }}
          >
            <label>
              新项目名称
              <input
                name="copyName"
                maxLength={120}
                required
                defaultValue={`${copySource.name.slice(0, 115)} · 副本`}
                pattern=".*\S.*"
              />
            </label>
            <p className="inline-note">
              副本需要重新确认尺寸；照片、识别原图、历史版本和分享链接不会复制。
            </p>
            <button className="button primary full" disabled={copying}>
              {copying ? '正在复制…' : '创建独立副本'}
              <Copy size={16} />
            </button>
          </form>
        </Modal>
      )}
      {modal && (
        <Modal title="开启一个新空间" onClose={() => setModal(false)} wide>
          <p className="muted">选择起点，随后用你的实测数据替换示例尺寸。</p>
          <div className="segmented create-mode" role="tablist" aria-label="创建方式">
            <button
              type="button"
              role="tab"
              aria-selected={startMode === 'template'}
              className={startMode === 'template' ? 'active' : ''}
              onClick={() => setStartMode('template')}
            >
              从模板开始
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={startMode === 'floorplan'}
              className={startMode === 'floorplan' ? 'active' : ''}
              onClick={() => setStartMode('floorplan')}
            >
              上传平面图
            </button>
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const data = new FormData(e.currentTarget);
              try {
                const p = await post<Project>('/projects', {
                  name: data.get('name'),
                  description: data.get('description'),
                  templateId: startMode === 'template' ? data.get('template') : template,
                });
                qc.invalidateQueries({ queryKey: ['projects'] });
                nav('/projects/' + p.id + (startMode === 'floorplan' ? '?floorplan=1' : ''));
              } catch (err) {
                notify((err as Error).message, true);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              项目名称
              <input name="name" required maxLength={120} placeholder="例如：我们的第一套家" />
            </label>
            {startMode === 'template' ? (
              <TemplatePicker value={template} onChange={setTemplate} />
            ) : (
              <div className="create-floorplan">
                <ScanLine size={22} />
                <div>
                  <strong>创建后直接上传单层平面图</strong>
                  <p>
                    系统会先用标准模板建立项目，再打开识别面板；识别结果会替换当前草稿并标为
                    “未确认”，需要你复核墙线、门窗和每个房间尺寸。
                  </p>
                </div>
              </div>
            )}
            <label>
              关于这个家
              <textarea
                name="description"
                maxLength={2000}
                placeholder="记录居住人数、生活习惯与期待（选填）"
              />
            </label>
            <div className="inline-note">
              <Ruler size={17} />
              {startMode === 'floorplan'
                ? '请准备清晰的 JPEG / PNG / WebP 平面图，并知道建筑外轮廓总宽。'
                : '示例数据仅用于体验，请在生成前核对你的实测尺寸。'}
            </div>
            <button className="button primary full" disabled={busy}>
              {busy
                ? '正在创建…'
                : startMode === 'floorplan'
                  ? '创建并上传平面图'
                  : '创建项目'}
              <ArrowRight size={17} />
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
function PublicShare() {
  const { token } = useParams(),
    q = useQuery({
      queryKey: ['share', token],
      queryFn: () =>
        api<{ projectName: string; design: Design; budget: unknown }>('/public/shares/' + token),
      retry: false,
    });
  const [mode, setMode] = useState('3d');
  return (
    <div className="shared-page">
      <header>
        <Logo />
        <span>只读分享 · 固定方案版本</span>
        <Link to="/">
          创建我的空间 <ArrowUpRight size={16} />
        </Link>
      </header>
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <Empty title={(q.error as Error).message} />
      ) : (
        q.data && (
          <>
            <div className="shared-title">
              <h1>{q.data.projectName}</h1>
              <p>
                {q.data.design.title} · {new Date(q.data.design.createdAt).toLocaleString('zh-CN')}
              </p>
              <div className="segmented">
                <button className={mode === '2d' ? 'active' : ''} onClick={() => setMode('2d')}>
                  2D 户型
                </button>
                <button className={mode === '3d' ? 'active' : ''} onClick={() => setMode('3d')}>
                  3D 空间
                </button>
              </div>
            </div>
            <div className="shared-view">
              {mode === '3d' ? (
                <Suspense fallback={<Spinner />}>
                  <Scene3D scene={q.data.design.scene} />
                </Suspense>
              ) : (
                <FloorPlanPreview scene={q.data.design.scene} />
              )}
            </div>
            <p className="disclaimer">
              概念空间方案；效果与通用家具模型需结合现场复核，不作为施工依据。
            </p>
          </>
        )
      )}
    </div>
  );
}
function ResetPassword() {
  const [done, setDone] = useState(false),
    notify = useNotice();
  return (
    <div className="reset-page">
      <Logo />
      <div className="modal">
        <h1>设置新密码</h1>
        {done ? (
          <p>
            密码已更新，<Link to="/">返回登录</Link>。
          </p>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await post('/auth/password/reset', {
                  token: new URLSearchParams(location.search).get('token'),
                  newPassword: new FormData(e.currentTarget).get('password'),
                });
                setDone(true);
              } catch (err) {
                notify((err as Error).message, true);
              }
            }}
          >
            <label>
              新密码
              <input required type="password" name="password" minLength={12} maxLength={128} />
            </label>
            <button className="button primary">更新密码</button>
          </form>
        )}
      </div>
    </div>
  );
}
