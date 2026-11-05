import { useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  Ruler,
  Layers3,
  Sparkles,
  Wallet,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { UserContext } from '../App';
import { api } from '../api';
import type { PlanCatalog } from '../billing';
import { Logo, Spinner, Empty } from './UI';

export function usePlans() {
  return useQuery({
    queryKey: ['plans'],
    queryFn: () => api<PlanCatalog>('/plans'),
    staleTime: 30_000,
  });
}
export function PublicHeader() {
  const user = useContext(UserContext);
  return (
    <header className="public-header">
      <Link to="/">
        <Logo />
      </Link>
      <nav aria-label="产品说明导航">
        <Link to="/guide">功能与流程</Link>
        <Link to="/plans">套餐与收费</Link>
        <Link className="button primary compact" to={user ? '/account' : '/?auth=login'}>
          {user ? '账户与套餐' : '登录 / 注册'}
          <ArrowRight size={14} />
        </Link>
      </nav>
    </header>
  );
}
export function PlanCards({
  catalog,
  onSelect,
  current,
}: {
  catalog: PlanCatalog;
  onSelect: (id: string) => void;
  current?: string;
}) {
  return (
    <div className="plan-cards">
      {catalog.items.map((plan) => (
        <article key={plan.id} className={`plan-card ${plan.id === 'family' ? 'featured' : ''}`}>
          {plan.id === 'family' && <span className="plan-recommend">推荐体验</span>}
          <p>{plan.description}</p>
          <h2>{plan.name}</h2>
          <strong className="plan-price">{plan.priceLabel}</strong>
          <ul>
            {plan.features.map((item) => (
              <li key={item}>
                <Check size={15} />
                {item}
              </li>
            ))}
          </ul>
          <button className="button full" onClick={() => onSelect(plan.id)}>
            {current === plan.id
              ? '当前套餐说明'
              : plan.id === 'free'
                ? '从示例开始'
                : plan.id === 'family'
                  ? '进入试用'
                  : '了解专业协作'}
            <ArrowRight size={15} />
          </button>
        </article>
      ))}
    </div>
  );
}
export function CostExplanation({ catalog }: { catalog: PlanCatalog }) {
  return (
    <section className="billing-explanation">
      <div>
        <span className="eyebrow">CREDITS, CLEARLY</span>
        <h2>每次生成，额度清楚可查</h2>
        <p>应用积分用于本平台任务结算，不是服务商余额。免费编辑和预览不消耗积分。</p>
      </div>
      <div className="billing-costs">
        <div>
          <span>AI 效果图 / 局部改图</span>
          <strong>
            {catalog.costs.style} / {catalog.costs.inpaint} 点 / 次
          </strong>
        </div>
        <div>
          <span>平面图识别草稿</span>
          <strong>{catalog.costs.recognize} 点 / 次</strong>
        </div>
        <div>
          <span>规则布局候选</span>
          <strong>{catalog.costs.layout} 点</strong>
        </div>
        <div>
          <span>2D / 3D、预算与导出</span>
          <strong>{catalog.costs.export} 点</strong>
        </div>
      </div>
      <p>
        提交前展示实际配置费率并预留额度；成功交付后结算一次，未交付释放预留。网络重发采用同一请求键，避免重复结算。外部服务商可能单独计费，中断状态以任务提示为准。
      </p>
      <p>
        家庭版免费试用 {catalog.trialDays} 天，每个注册账户限一次，赠送 {catalog.trialCredits}{' '}
        点。到期回到免费体验，不自动续费、不自动扣款；未用积分保留。正式价格与支付服务尚未开放。
      </p>
    </section>
  );
}
export default function PlansPage() {
  const query = usePlans(),
    user = useContext(UserContext),
    navigate = useNavigate();
  return (
    <div className="public-page">
      <PublicHeader />
      <main className="public-body">
        <div className="public-title">
          <span className="eyebrow">PLANS</span>
          <h1>先完成一次可用的方案</h1>
          <p>
            正式发布时的价格需依据真实生成成本与付费实验确定。当前保留免费体验与家庭版试用，不接入真实支付。
          </p>
        </div>
        {query.isPending ? (
          <Spinner />
        ) : query.isError ? (
          <Empty title="套餐信息暂不可用">
            <button className="button" onClick={() => void query.refetch()}>
              重试
            </button>
          </Empty>
        ) : (
          <>
            <PlanCards
              catalog={query.data}
              onSelect={(id) => navigate(user ? `/account?plan=${id}` : '/?auth=register')}
            />
            <CostExplanation catalog={query.data} />
          </>
        )}
        <section className="product-boundary">
          <ShieldCheck size={24} />
          <div>
            <h2>你决定尺寸，AI 提供表达</h2>
            <p>
              效果图、尺寸化概念模型与预算草稿用于方案沟通，不替代现场复尺与专业复核。专业协作中的品牌素材、团队模板和批量
              API 等是后续规划，当前不出售。
            </p>
            <Link to="/guide">了解完整工作流程与功能边界 →</Link>
          </div>
        </section>
      </main>
      <footer className="public-footer">
        筑见 · 以实测为依据，以生活为尺度。<Link to="/guide">使用说明</Link>
      </footer>
    </div>
  );
}

const capabilities = [
  {
    icon: Ruler,
    title: '实测录入与结构版本',
    text: '按房间录入净尺寸、层高和门窗；规则校验定位到具体对象，明确来源后冻结结构版本。',
    tag: '确定性规则',
  },
  {
    icon: Layers3,
    title: '2D 可编辑布局',
    text: '拖动、旋转、锁定与复制家具，替换地面材质；尺寸以毫米保存，支持撤销、重做与自动保存。',
    tag: '对象级编辑',
  },
  {
    icon: Sparkles,
    title: '同源 3D 与多风格视觉',
    text: '二维与三维共用结构与家具。顶视、环绕、门控和跨层漫游用于查看布局；AI 风格图独立生成并保留复核意见。',
    tag: '2D / 3D 一致',
  },
  {
    icon: Wallet,
    title: '预算草稿与来源',
    text: '家具快照、工程量、损耗与用户单价分别列示；未知价格单独列出，不按 0 元合计。',
    tag: '金额可追溯',
  },
  {
    icon: Users,
    title: '版本比较与受控分享',
    text: '比较布局、3D 与方案版本，旧版载入生成新草稿。只读链接可设到期时间并撤销；登录成员可评论和确认。',
    tag: '沟通闭环',
  },
  {
    icon: ShieldCheck,
    title: '账户与数据',
    text: '会话隔离与项目成员权限由服务端校验；账户页查看真实积分、项目权限及数据导出，照片改进授权默认关闭且尚未开放。',
    tag: '数据有边界',
  },
];
export function GuidePage() {
  const plans = usePlans();
  return (
    <div className="public-page">
      <PublicHeader />
      <main className="public-body">
        <div className="public-title">
          <span className="eyebrow">HOW IT WORKS</span>
          <h1>让家的想象，有据可依</h1>
          <p>先记录真实空间，再打磨布局、风格与预算。每一份输出都能找到它的尺寸和版本依据。</p>
        </div>
        <div className="capability-grid">
          {capabilities.map((c) => (
            <article key={c.title}>
              <c.icon size={24} />
              <span>{c.tag}</span>
              <h2>{c.title}</h2>
              <p>{c.text}</p>
            </article>
          ))}
        </div>
        <section className="guide-workflow">
          <span className="eyebrow">WORKFLOW</span>
          <h2>从量房到方案交付</h2>
          {[
            [
              '建立住宅项目',
              '选择户型起点或上传清晰的单层平面图。示例尺寸是虚构参考，识别结果先预览再载入。',
            ],
            [
              '实测录入',
              '逐房间录入宽深高、墙体、门窗和固定物；区分毫米、厘米、米，保留原始记录。',
            ],
            [
              '校验并确认结构',
              '修正阻断问题，核对实际尺寸；演示与实测来源分别确认，冻结后由方案和预算引用。',
            ],
            [
              '布局与风格',
              '先生成满足硬约束的布局，再比较配色与 AI 视觉。切换配色不移动家具，AI 图需要人工复核。',
            ],
            [
              '预算与交付',
              '补齐报价，保留待询价项；选择固定版本导出 PDF、JSON 或 CSV，再受控分享与确认。',
            ],
          ].map(([title, text], i) => (
            <div key={title}>
              <b>0{i + 1}</b>
              <span>
                <h3>{title}</h3>
                <p>{text}</p>
              </span>
            </div>
          ))}
        </section>
        {plans.data && <CostExplanation catalog={plans.data} />}
        <section className="guide-faq">
          <h2>开始前，你可能想了解</h2>
          {[
            [
              '体验、注册与套餐有什么区别？',
              '本地体验账户仅用于开发演示，数据与其他账户隔离。注册用户默认免费体验，可开启一次家庭版免费试用。系统管理员身份与套餐分开，不由套餐购买获得。项目内另有拥有者、可编辑和只读权限。',
            ],
            [
              '平面图能直接变成准确的 3D 吗？',
              '目前识别清晰的单层图片，并按轴对齐矩形近似建立可编辑草稿。识别会有误差，需要逐房复核。暂不支持 PDF、DWG、任意 CAD 墙网或照片扫描重建。',
            ],
            [
              '试用到期会扣款或删除项目吗？',
              '不会自动续费或扣款。已保存项目和未用积分保留；回到免费套餐后，创建、复制或恢复归档项目需要符合进行中自有项目上限。共享给你的项目不占自有项目名额。',
            ],
            [
              '能导出施工图或保证施工可行吗？',
              '当前导出方案沟通资料和带依据的预算草稿，不提供施工图、BIM 或 DWG。不判定承重与隐蔽管线，不给出水电燃气施工结论，不保证效果图物品可采购。',
            ],
            [
              '局部修改和专业协作开放了吗？',
              '已支持手工修改家具、门窗、材质及配色，也支持带蒙版局部 AI 改图：涂抹区域才重绘，区域外由服务端锁定为原图。品牌商品库、团队模板和批量 API 尚未开放，专业版可登记意向。',
            ],
            [
              '清理浏览器会丢失项目吗？',
              '已保存数据位于当前服务端数据库和文件存储；浏览器草稿仅作恢复备份。清理前先确认保存成功，个人 JSON 导出不包含原始照片文件。',
            ],
          ].map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </section>
        <div className="guide-end">
          <Link className="button primary" to="/plans">
            查看套餐与额度
            <ArrowRight size={16} />
          </Link>
        </div>
      </main>
    </div>
  );
}
