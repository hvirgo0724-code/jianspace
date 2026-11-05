import { useContext, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  UserRound,
  Sparkles,
  Download,
  ShieldCheck,
  ArrowLeft,
  HardDrive,
  Check,
  BookOpen,
  LayoutGrid,
} from 'lucide-react';
import { UserBadge, UserContext, useNotice } from '../App';
import { api, post } from '../api';
import {
  accountLabels,
  ledgerDisplay,
  memberLabels,
  type Account,
  type LedgerEntry,
} from '../billing';
import { Logo, Spinner, Empty, Modal } from './UI';
import { PlanCards, usePlans, CostExplanation } from './Plans';

export default function AccountPage() {
  const user = useContext(UserContext),
    notice = useNotice(),
    qc = useQueryClient(),
    nav = useNavigate(),
    [params] = useSearchParams();
  const query = useQuery({
    queryKey: ['account'],
    queryFn: () => api<Account>('/account'),
    refetchOnWindowFocus: true,
  });
  const credits = useQuery({
    queryKey: ['credits'],
    queryFn: () => api<{ ledger: LedgerEntry[] }>('/credits'),
  });
  const plans = usePlans();
  const [modal, setModal] = useState<string | null>(() =>
    ['free', 'family', 'professional'].includes(params.get('plan') || '')
      ? params.get('plan')
      : null,
  );
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const verifyStarted = useRef(false);
  const verifyToken = params.get('verify');
  useEffect(() => {
    if (!verifyToken || verifyStarted.current) return;
    verifyStarted.current = true;
    void (async () => {
      try {
        await post('/auth/email/verify/confirm', { token: verifyToken });
        await qc.invalidateQueries({ queryKey: ['account'] });
        notice('邮箱已验证。');
      } catch (error) {
        notice((error as Error).message, true);
      } finally {
        nav('/account', { replace: true });
      }
    })();
  }, [verifyToken, nav, notice, qc]);
  async function requestEmailVerification() {
    setVerifying(true);
    try {
      const result = await post<{ alreadyVerified?: boolean }>(
        '/auth/email/verify/request',
        {},
      );
      notice(
        result.alreadyVerified
          ? '该邮箱已经验证。'
          : '验证邮件已发送，请在 24 小时内打开邮件中的链接。',
      );
    } catch (error) {
      notice((error as Error).message, true);
    } finally {
      setVerifying(false);
    }
  }
  async function closeAccount(confirmEmail: string, password: string) {
    setBusy(true);
    try {
      await api('/account', {
        method: 'DELETE',
        body: JSON.stringify({ confirmEmail, password }),
      });
      for (const key of Object.keys(localStorage))
        if (key.startsWith('jianspace-draft:')) localStorage.removeItem(key);
      qc.clear();
      setDeleteOpen(false);
      nav('/');
      notice('账户已注销，所有会话与授权已失效。');
    } catch (error) {
      notice((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function mutate(path: string, body: unknown) {
    setBusy(true);
    try {
      await post(path, body);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['account'] }),
        qc.invalidateQueries({ queryKey: ['credits'] }),
        qc.invalidateQueries({ queryKey: ['me'] }),
      ]);
      setModal(null);
      notice('账户状态已更新。');
    } catch (error) {
      notice((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  if (query.isPending) return <Spinner label="正在载入账户资料…" />;
  if (query.isError || !query.data)
    return (
      <Empty title="账户资料载入失败">
        <button className="button" onClick={() => void query.refetch()}>
          重试
        </button>
        <Link className="button" to="/projects">
          返回项目
        </Link>
      </Empty>
    );
  const account = query.data,
    catalog = plans.data,
    plan = account.plan;
  return (
    <div className="app-shell account-shell">
      <aside className="main-sidebar">
        <Link to="/projects">
          <Logo />
        </Link>
        <div className="sidebar-label">我的工作空间</div>
        <Link className="nav-item" to="/projects">
          <LayoutGrid size={18} />
          项目工作台
        </Link>
        <Link className="nav-item active" to="/account">
          <UserRound size={18} />
          账户与套餐
        </Link>
        <Link className="nav-item" to="/plans">
          <Sparkles size={18} />
          套餐与收费
        </Link>
        <Link className="nav-item" to="/guide">
          <BookOpen size={18} />
          功能与流程
        </Link>
        <div className="sidebar-bottom">
          <UserBadge />
        </div>
      </aside>
      <div className="main-content">
        <header className="topbar">
          <Link to="/projects">
            <ArrowLeft size={14} />
            返回工作台
          </Link>
          <span className="environment-pill">{accountLabels[account.accountType]}</span>
        </header>
        <main className="account-body">
          <div className="account-heading">
            <div>
              <span className="eyebrow">ACCOUNT & PLAN</span>
              <h1>账户与套餐</h1>
              <p>
                管理个人资料、生成额度、数据导出与隐私选择。已保存项目位于当前服务端，由账户与成员权限控制访问。
              </p>
            </div>
            <button className="button primary" onClick={() => setModal('plans')}>
              <Sparkles size={16} />
              查看套餐
            </button>
          </div>
          <section className="account-stats">
            <div>
              <small>可用额度</small>
              <strong>
                {account.credits.available}
                <i> 点</i>
              </strong>
              <span>预留 {account.credits.reserved} 点</span>
            </div>
            <div>
              <small>进行中项目</small>
              <strong>{account.stats.activeProjects}</strong>
              <span>
                自有 {account.stats.ownedActiveProjects} / {plan.maxActiveProjects ?? '不限'} · 累计{' '}
                {account.stats.totalProjects}
              </span>
            </div>
            <div>
              <small>生成任务</small>
              <strong>{account.stats.jobs}</strong>
              <span>
                已结算 {account.credits.charged} 点 · 释放 {account.credits.released} 点
              </span>
            </div>
            <div>
              <small>自有文件占用</small>
              <strong>
                {(account.stats.storageBytes / 1048576).toFixed(2)}
                <i> MB</i>
              </strong>
              <span>照片、参考与生成资产；不含数据库体积</span>
            </div>
          </section>
          <div className="account-columns">
            <div>
              <section className="account-card">
                <header>
                  <div>
                    <h2>个人资料</h2>
                    <p>用户身份、系统角色与套餐分别管理。</p>
                  </div>
                  <span className="account-pill">
                    <ShieldCheck size={14} />
                    已登录
                  </span>
                </header>
                <form
                  key={account.revision}
                  onSubmit={async (event) => {
                    event.preventDefault();
                    setBusy(true);
                    const displayName = String(
                      new FormData(event.currentTarget).get('displayName') || '',
                    ).trim();
                    try {
                      await api('/account', {
                        method: 'PATCH',
                        body: JSON.stringify({ displayName, baseRevision: account.revision }),
                      });
                      await Promise.all([
                        qc.invalidateQueries({ queryKey: ['account'] }),
                        qc.invalidateQueries({ queryKey: ['me'] }),
                      ]);
                      notice('个人资料已保存。');
                    } catch (e) {
                      notice((e as Error).message, true);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <div className="account-fields">
                    <label>
                      显示名称
                      <input
                        name="displayName"
                        required
                        maxLength={80}
                        defaultValue={account.user.displayName}
                      />
                    </label>
                    <label>
                      邮箱
                      <input readOnly value={account.user.email} />
                    </label>
                    <label>
                      用户类型
                      <input readOnly value={accountLabels[account.accountType]} />
                    </label>
                    <label>
                      当前套餐
                      <input readOnly value={plan.name} />
                    </label>
                    <label>
                      试用到期
                      <input
                        readOnly
                        value={
                          plan.trialExpiresAt
                            ? new Date(plan.trialExpiresAt * 1000).toLocaleString('zh-CN')
                            : '无试用到期日期'
                        }
                      />
                    </label>
                    <label>
                      续费方式
                      <input readOnly value="不自动续费 · 不自动扣款" />
                    </label>
                  </div>
                  <div className="account-verify">
                    <span className={account.emailVerified ? 'tag' : 'tag amber'}>
                      {account.emailVerified ? '邮箱已验证' : '邮箱未验证'}
                    </span>
                    {!account.emailVerified && account.accountType !== 'demo' && (
                      <button
                        type="button"
                        className="button outline compact"
                        disabled={busy || verifying}
                        onClick={() => void requestEmailVerification()}
                      >
                        {verifying ? '正在发送…' : '发送验证邮件'}
                      </button>
                    )}
                    {!account.emailVerified && account.accountType === 'demo' && (
                      <small>体验账户使用一次性地址，无需验证。</small>
                    )}
                  </div>
                  <button className="button outline compact" disabled={busy}>
                    保存资料
                  </button>
                </form>
              </section>
              <section className="account-card">
                <header>
                  <div>
                    <h2>数据与隐私</h2>
                    <p>原始照片是否用于模型改进需独立选择，默认关闭。</p>
                  </div>
                </header>
                <div className="account-privacy">
                  <div>
                    <span>
                      <strong>允许将脱敏照片用于模型改进</strong>
                      <small>此项授权尚未开放，当前不将上传照片用于模型训练。</small>
                    </span>
                    <input
                      type="checkbox"
                      aria-label="允许照片用于模型改进（未开放）"
                      disabled
                      checked={false}
                      readOnly
                    />
                  </div>
                  <div>
                    <span>
                      <strong>导出个人数据</strong>
                      <small>
                        导出自有项目、量测、方案、报价、任务状态与完整积分账本；原始媒体单独下载。
                      </small>
                    </span>
                    <button
                      className="button outline compact"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const data = await api('/account/export');
                          const url = URL.createObjectURL(
                            new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
                          );
                          const anchor = document.createElement('a');
                          anchor.href = url;
                          anchor.download = '筑见-个人数据导出.json';
                          anchor.click();
                          setTimeout(() => URL.revokeObjectURL(url), 1000);
                          notice('个人数据导出已生成。');
                        } catch (e) {
                          notice((e as Error).message, true);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <Download size={15} />
                      JSON
                    </button>
                  </div>
                  <div>
                    <span>
                      <strong>账户安全与数据管理</strong>
                      <small>
                        密码恢复位于登录页；账户注销见下方，注销后不可恢复。
                      </small>
                    </span>
                    <Link className="button ghost compact" to="/guide">
                      了解说明
                    </Link>
                  </div>
                </div>
              </section>
              <section className="account-card account-danger">
                <header>
                  <div>
                    <h2>注销账户</h2>
                    <p>永久关闭当前账户，撤销所有会话、分享与成员授权。</p>
                  </div>
                </header>
                <div className="account-privacy">
                  <div>
                    <span>
                      <strong>删除账户与自有项目访问</strong>
                      <small>
                        自有项目立即进入删除状态，媒体文件由清理命令回收；共享给你的项目仅移除你的成员身份。操作不可恢复。
                      </small>
                    </span>
                    <button
                      className="button danger compact"
                      disabled={busy}
                      onClick={() => setDeleteOpen(true)}
                    >
                      注销账户
                    </button>
                  </div>
                </div>
              </section>
              <section className="account-card">
                <header>
                  <div>
                    <h2>项目成员概览</h2>
                    <p>套餐限制自有项目数量；项目角色决定具体访问权限。</p>
                  </div>
                </header>
                <div className="account-projects">
                  {account.projects.length ? (
                    account.projects.map((p) => (
                      <Link key={p.id} to={`/projects/${p.id}`}>
                        <strong>{p.name}</strong>
                        <span>
                          {memberLabels[p.role] || p.role} · {p.memberCount} 人
                          {p.archived ? ' · 已归档' : ''}
                        </span>
                      </Link>
                    ))
                  ) : (
                    <p className="muted">还没有项目，先建立你的第一份量房资料。</p>
                  )}
                </div>
              </section>
            </div>
            <div>
              <section className="account-plan-summary">
                <span className="eyebrow">CURRENT PLAN</span>
                <h2>{plan.name}</h2>
                <p>
                  {catalog
                    ? `风格生成 ${catalog.costs.style} 点 / 次 · 局部改图 ${catalog.costs.inpaint} 点 / 次 · 平面图识别 ${catalog.costs.recognize} 点 / 次`
                    : '费率以任务提交前确认面板为准'}
                </p>
                <div>
                  <span>
                    剩余额度<strong>{account.credits.available}</strong>
                  </span>
                  <span>
                    已预留<strong>{account.credits.reserved}</strong>
                  </span>
                </div>
                <p>
                  规则布局、预览与导出不消耗应用积分。每天 AI 任务上限 {plan.aiDailyLimit} 次，按
                  UTC 日期统计。
                </p>
                <button className="button full" onClick={() => setModal('plans')}>
                  套餐与额度说明
                </button>
              </section>
              <section className="account-card">
                <header>
                  <div>
                    <h2>额度明细</h2>
                    <p>最近 50 条预留、完成、退回与赠送记录。</p>
                  </div>
                </header>
                <div className="account-ledger">
                  {credits.isPending ? (
                    <Spinner />
                  ) : credits.isError ? (
                    <button className="button" onClick={() => void credits.refetch()}>
                      账本载入失败，重试
                    </button>
                  ) : !credits.data?.ledger.length ? (
                    <p className="muted">暂无积分变动。</p>
                  ) : (
                    credits.data.ledger.map((entry) => {
                      const value = ledgerDisplay(entry);
                      return (
                        <div key={entry.id}>
                          <span>
                            <strong>{value.label}</strong>
                            <small>{new Date(entry.createdAt).toLocaleString('zh-CN')}</small>
                          </span>
                          <b>{value.value}</b>
                        </div>
                      );
                    })
                  )}
                </div>
                <p className="account-note">
                  预留不是重复扣费；成功结算扣除预留，未交付释放到可用余额。
                </p>
              </section>
              <section className="account-card">
                <header>
                  <h2>存储使用</h2>
                  <HardDrive size={18} />
                </header>
                <p className="account-note">
                  当前文件保存在
                  {account.privacy.storageMode === 'local' ? '本地服务目录' : '配置的对象存储'}
                  ，结构和方案位于服务端数据库。清理浏览器前请确认草稿已保存；未声明固定存储套餐容量。
                </p>
                <Link className="button ghost full" to="/guide">
                  功能边界与使用说明
                </Link>
              </section>
            </div>
          </div>
          <p className="account-bottom">
            {accountLabels[account.accountType]} · {user?.email} · 当前没有真实支付或自动续费
          </p>
        </main>
      </div>
      {modal && (
        <Modal
          title={
            modal === 'family'
              ? '家庭版免费试用'
              : modal === 'professional'
                ? '专业协作 · 后续开放'
                : modal === 'free'
                  ? '免费体验说明'
                  : '套餐与额度'
          }
          wide={modal === 'plans'}
          onClose={() => !busy && setModal(null)}
        >
          {plans.isPending ? (
            <Spinner />
          ) : plans.isError || !catalog ? (
            <Empty title="套餐信息载入失败">
              <button className="button" onClick={() => void plans.refetch()}>
                重试
              </button>
            </Empty>
          ) : modal === 'plans' ? (
            <>
              <PlanCards catalog={catalog} current={plan.id} onSelect={setModal} />
              <CostExplanation catalog={catalog} />
            </>
          ) : modal === 'family' ? (
            <>
              <p>
                完整 V1 流程，适合打磨一套住宅。免费试用 {catalog.trialDays}{' '}
                天，限每个注册账户一次，赠送 {catalog.trialCredits}{' '}
                点；不要求银行卡、不发起支付、到期不自动续费。
              </p>
              <ul className="trial-features">
                {catalog.items
                  .find((p) => p.id === 'family')
                  ?.features.map((f) => (
                    <li key={f}>
                      <Check size={15} />
                      {f}
                    </li>
                  ))}
              </ul>
              <p className="account-note">
                到期后已保存项目与未用积分保留；新增、复制和恢复归档需要符合免费套餐名额。带蒙版局部
                AI 改图按次消耗应用积分，结果保存为新图片。
              </p>
              {account.accountType === 'demo' ? (
                <p className="inline-note">
                  本地体验账户已开放完整流程，体验积分不是购买记录，不重复领取家庭版试用。
                </p>
              ) : plan.trialUsed ? (
                <p className="inline-note">
                  本账户已使用家庭版试用。
                  {plan.id === 'family' ? '目前仍在试用期内。' : '试用已到期，现为免费体验。'}
                </p>
              ) : (
                <button
                  className="button primary full"
                  disabled={busy}
                  onClick={() => void mutate('/account/trial', {})}
                >
                  {busy ? '正在开启…' : '免费开启家庭版试用'}
                </button>
              )}
            </>
          ) : modal === 'professional' ? (
            <>
              <p>
                设计师与门店的多项目工作台。团队模板、品牌素材、客户资料交付与批量 API
                是后续规划，当前不出售，不承诺开放时间。
              </p>
              <p className="account-note">
                登记仅保存在本账户，不发送邮件、不改变套餐、不扣除积分。
              </p>
              <button
                className="button primary full"
                disabled={busy}
                onClick={() =>
                  void mutate('/account/professional-interest', {
                    interested: !account.professionalInterest,
                  })
                }
              >
                {account.professionalInterest ? '取消专业版意向' : '登记专业版意向'}
              </button>
            </>
          ) : (
            <>
              <p>
                免费体验包含 1 个进行中的自有住宅项目、实测校验、2D/3D
                与漫游、规则布局、预算、导出和受控分享。新注册赠送 {catalog.registrationCredits}{' '}
                点，AI 任务按实际费率使用积分。
              </p>
              <p>
                自有已归档项目不占名额，共享给你的项目不占自有名额。家庭版试用到期不会删除已有项目。
              </p>
              <Link className="button primary full" to="/projects">
                返回项目工作台
              </Link>
            </>
          )}
        </Modal>
      )}
      {deleteOpen && (
        <Modal title="确认注销账户" onClose={() => !busy && setDeleteOpen(false)}>
          <p className="danger-note">
            注销后当前账户无法登录，所有会话立即失效，自有项目进入删除状态且不可恢复。
          </p>
          <ul className="trial-features">
            <li>
              <Check size={15} />
              立即退出所有设备并撤销 CSRF 会话
            </li>
            <li>
              <Check size={15} />
              撤销分享链接，取消排队中的生成任务
            </li>
            <li>
              <Check size={15} />
              清除账户资料、积分账本与成员身份
            </li>
          </ul>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (busy) return;
              const data = new FormData(event.currentTarget);
              void closeAccount(
                String(data.get('confirmEmail') || ''),
                String(data.get('confirmPassword') || ''),
              );
            }}
          >
            <label>
              输入账户邮箱以确认
              <input
                name="confirmEmail"
                required
                autoComplete="off"
                placeholder={account.user.email}
              />
            </label>
            {account.accountType !== 'demo' && (
              <label>
                登录密码
                <input
                  name="confirmPassword"
                  type="password"
                  required
                  autoComplete="current-password"
                />
              </label>
            )}
            <p className="inline-note">
              当前邮箱 <strong>{account.user.email}</strong>
              ；本地体验账户免密码确认。注销不扣除积分，也不触发支付或退款。
            </p>
            <button className="button danger full" disabled={busy}>
              {busy ? '正在注销…' : '永久注销账户'}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
