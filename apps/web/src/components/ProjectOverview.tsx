import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpRight,
  CheckCircle2,
  CircleDashed,
  Ruler,
  Layers3,
  Image,
  Coins,
  TriangleAlert,
  ScanLine,
} from 'lucide-react';
import type { Asset, Design, Issue, Job, Project, Scene, Validation } from '../types';
import { post } from '../api';
import { projectReadiness } from '../projectWorkflow';
import { isInteriorArea } from '../surfaces';
import { FloorPlanPreview } from './Plan2D';

const stages = [
  { id: 'measure', name: '核对尺寸', text: '录入尺寸与来源', icon: Ruler },
  { id: 'editor', name: '设计布局', text: '布置家具与材质', icon: Layers3 },
  { id: 'versions', name: '比较版本', text: '保存与选择方案', icon: Image },
  { id: 'budget', name: '预算交付', text: '报价、导出与沟通', icon: Coins },
];
export function WorkflowNav({
  active,
  onNavigate,
}: {
  active: string;
  onNavigate: (tab: string) => void;
}) {
  return (
    <nav className="workflow-nav" aria-label="项目设计步骤">
      {stages.map((stage, index) => (
        <button
          key={stage.id}
          aria-current={active === stage.id ? 'step' : undefined}
          onClick={() => onNavigate(stage.id)}
        >
          <span className="workflow-number">{String(index + 1).padStart(2, '0')}</span>
          <span>
            <strong>{stage.name}</strong>
            <small>{stage.text}</small>
          </span>
          <ArrowUpRight size={15} />
        </button>
      ))}
    </nav>
  );
}

export default function ProjectOverview({
  project,
  scene,
  revision,
  designs,
  assets,
  jobs,
  loadingData,
  dataError,
  onNavigate,
  onAction,
  onIssue,
}: {
  project: Project;
  scene: Scene;
  revision: number;
  designs: Design[];
  assets: Asset[];
  jobs: Job[];
  loadingData: boolean;
  dataError: boolean;
  onNavigate: (tab: string) => void;
  onAction: (action: string) => void;
  onIssue: (id: string, issues: Issue[]) => void;
}) {
  const validation = useQuery({
    queryKey: ['overview-validation', project.id, scene],
    queryFn: () =>
      post<Validation>(`/projects/${project.id}/geometry-drafts/validate`, {
        scene,
        baseRevision: revision,
      }),
    staleTime: 30_000,
    retry: false,
  });
  const ready = projectReadiness(scene, designs, assets, validation.data);
  const rooms = scene.floors.flatMap((f) => f.rooms);
  const area =
    rooms.filter((r) => isInteriorArea(r.type)).reduce((sum, r) => sum + r.computedAreaMm2, 0) /
    1e6;
  const busyJobs = jobs.filter((j) => ['queued', 'running', 'cancel_requested'].includes(j.status));
  const next =
    !validation.data || !validation.data.valid
      ? {
          label: '核对户型与冲突',
          tab: 'measure',
          text: '先检查房间、门窗和家具，再确认尺寸来源。',
        }
      : !ready.confirmed
        ? {
            label: '确认尺寸来源',
            action: 'confirm',
            text: '当前校验通过；确认真实实测或虚构演示来源后，可生成布局和保存版本。',
          }
        : !ready.currentDesigns.length
          ? {
              label: '保存一个方案版本',
              action: 'save',
              text: '保存当前布局作为固定版本，方便比较、分享与后续追溯。',
            }
          : {
              label: '完善预算报价',
              tab: 'budget',
              text: '核对材料、人工与家具价格，再选择版本导出。未知价格会继续单列。',
            };
  const checks = [
    {
      label: '结构校验',
      ready: ready.validationState === 'passed',
      value: validation.isPending
        ? '检查中…'
        : validation.isError
          ? '检查失败，可重试'
          : `${ready.errors.length} 项错误 · ${ready.warnings.length} 项提醒`,
      tab: 'measure',
    },
    {
      label: '尺寸来源',
      ready: ready.confirmed,
      value: ready.confirmed
        ? scene.confirmation.basis === 'demo'
          ? '演示尺寸已确认 · 非实测'
          : '实测来源已确认'
        : '待核对与确认',
      action: 'confirm',
    },
    {
      label: '当前结构的方案',
      ready: ready.currentDesigns.length > 0,
      value: loadingData ? '载入中…' : `${ready.currentDesigns.length} 个版本`,
      tab: 'versions',
    },
    {
      label: '房间照片（选填）',
      ready: ready.photos.length > 0,
      value: loadingData ? '载入中…' : `${ready.photos.length} 张原始上传照片`,
      tab: 'photos',
    },
    {
      label: '装修报价',
      ready: ready.roomsWithQuotes > 0,
      value: `${ready.roomsWithQuotes} 个房间已录报价`,
      tab: 'budget',
    },
    {
      label: '家具价格',
      ready: scene.layout.furniture.length > 0 && ready.unknownPrices === 0,
      value: `${ready.unknownPrices} 件待询价 / ${scene.layout.furniture.length} 件家具`,
      tab: 'budget',
    },
  ];
  const act = (item: { action?: string; tab?: string }) =>
    item.action ? onAction(item.action) : item.tab && onNavigate(item.tab);
  return (
    <div className="project-overview">
      <section className="overview-next">
        <div>
          <span className="eyebrow">YOUR NEXT STEP</span>
          <h2>{next.label}</h2>
          <p>{next.text}</p>
        </div>
        <button className="button primary" onClick={() => act(next)}>
          {next.label}
          <ArrowUpRight size={16} />
        </button>
      </section>
      {scene.confirmation.basis === 'demo' && (
        <p className="overview-demo">
          <Ruler size={15} />
          当前采用虚构演示尺寸，预览与方案不代表真实住宅实测。
        </p>
      )}
      {dataError && (
        <p className="overview-demo" role="alert">
          部分版本、附件或任务暂未载入。请刷新重试，当前数字不代表完整项目记录。
        </p>
      )}
      <section className="overview-import">
        <ScanLine size={24} />
        <div>
          <strong>已有房屋平面图？</strong>
          <p>
            上传清晰的单层图纸，自动识别房间与门窗，生成可编辑的 2D/3D
            草稿。载入后仍需复核尺寸与门窗，并完成实测确认。
          </p>
        </div>
        <button className="button outline compact" onClick={() => onAction('floorplan')}>
          上传平面图生成户型
          <ArrowUpRight size={15} />
        </button>
      </section>
      <div className="overview-grid">
        <section className="overview-card overview-plan">
          <header>
            <div>
              <span className="eyebrow">SPACE AT A GLANCE</span>
              <h2>{project.name}</h2>
            </div>
            <button className="button ghost compact" onClick={() => onNavigate('editor')}>
              进入设计
              <ArrowUpRight size={16} />
            </button>
          </header>
          <FloorPlanPreview scene={scene} />
          <dl className="overview-stats">
            <div>
              <dt>室内净面积</dt>
              <dd>
                {area.toFixed(2)}
                <small> m²</small>
              </dd>
            </div>
            <div>
              <dt>住宅楼层</dt>
              <dd>
                {scene.floors.length}
                <small> 层</small>
              </dd>
            </div>
            <div>
              <dt>空间 / 门窗</dt>
              <dd>
                {rooms.length}
                <small> / {scene.floors.reduce((sum, f) => sum + f.openings.length, 0)}</small>
              </dd>
            </div>
            <div>
              <dt>家具家电</dt>
              <dd>
                {scene.layout.furniture.length}
                <small> 件</small>
              </dd>
            </div>
          </dl>
          {project.description && <p className="overview-description">{project.description}</p>}
        </section>
        <section className="overview-card">
          <header>
            <div>
              <span className="eyebrow">PROJECT CHECKLIST</span>
              <h2>资料与设计状态</h2>
            </div>
          </header>
          <div className="overview-checks">
            {checks.map((item) => (
              <button key={item.label} onClick={() => act(item)}>
                {item.ready ? (
                  <CheckCircle2 size={19} className="ready" />
                ) : (
                  <CircleDashed size={19} />
                )}
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.value}</small>
                </span>
                <ArrowUpRight size={14} />
              </button>
            ))}
          </div>
          <p className="overview-note">
            检查当前草稿；照片可选，已录报价仍需核实。旧结构的方案保留在版本列表中。
          </p>
        </section>
        <section className="overview-card">
          <header>
            <div>
              <span className="eyebrow">STRUCTURE & LAYOUT</span>
              <h2>校验与提醒</h2>
            </div>
            <button
              className="button ghost compact"
              disabled={validation.isFetching}
              onClick={() => void validation.refetch()}
            >
              重新检查
            </button>
          </header>
          {validation.isPending ? (
            <p className="overview-note">正在校验当前户型…</p>
          ) : validation.isError ? (
            <p className="overview-note" role="alert">
              {validation.error.message}
            </p>
          ) : validation.data.issues.length ? (
            <div className="overview-issues">
              {validation.data.issues.slice(0, 5).map((issue, index) => (
                <button
                  key={index}
                  onClick={() =>
                    issue.objectIds[0]
                      ? onIssue(issue.objectIds[0], validation.data?.issues || [])
                      : onNavigate('measure')
                  }
                >
                  <TriangleAlert size={16} />
                  <span>
                    {issue.message}
                    <small>{issue.code}</small>
                  </span>
                  <ArrowUpRight size={14} />
                </button>
              ))}
              {validation.data.issues.length > 5 && (
                <p className="overview-note">
                  还有 {validation.data.issues.length - 5} 项，请进入实测与户型查看。
                </p>
              )}
            </div>
          ) : (
            <p className="overview-success">
              <CheckCircle2 size={19} />
              未发现结构、门扇与家具冲突。尺寸准确性仍以你的核对为准。
            </p>
          )}
        </section>
        <section className="overview-card">
          <header>
            <div>
              <span className="eyebrow">SAVED & IN PROGRESS</span>
              <h2>最近版本与任务</h2>
            </div>
            <button className="button ghost compact" onClick={() => onNavigate('versions')}>
              查看版本
              <ArrowUpRight size={14} />
            </button>
          </header>
          {loadingData ? (
            <p className="overview-note">正在载入记录…</p>
          ) : (
            <>
              {designs.slice(0, 3).map((design) => (
                <button
                  className="overview-record"
                  key={design.id}
                  onClick={() => onNavigate('versions')}
                >
                  <Layers3 size={16} />
                  <span>
                    <strong>{design.title}</strong>
                    <small>
                      {ready.currentDesigns.some((d) => d.id === design.id)
                        ? '当前结构'
                        : '历史结构'}{' '}
                      · {new Date(design.createdAt).toLocaleDateString('zh-CN')}
                    </small>
                  </span>
                  <ArrowUpRight size={14} />
                </button>
              ))}
              {!designs.length && (
                <p className="overview-note">还没有保存的方案，编辑完成后可以保存第一个版本。</p>
              )}
              <button className="overview-record" onClick={() => onNavigate('jobs')}>
                <CircleDashed size={16} />
                <span>
                  <strong>
                    {busyJobs.length ? `${busyJobs.length} 个任务进行中` : '当前没有进行中的任务'}
                  </strong>
                  <small>{jobs.length} 条生成与导出记录</small>
                </span>
                <ArrowUpRight size={14} />
              </button>
            </>
          )}
          <div className="overview-actions">
            <button className="button outline compact" onClick={() => onAction('share')}>
              分享固定版本
            </button>
            <button className="button outline compact" onClick={() => onAction('export')}>
              导出方案
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
