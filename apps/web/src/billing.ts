import type { User } from './types';
export interface PlanCatalog {
  paymentEnabled: boolean;
  trialDays: number;
  trialCredits: number;
  registrationCredits: number;
  costs: { style: number; inpaint: number; recognize: number; layout: number; export: number };
  items: {
    id: string;
    name: string;
    priceLabel: string;
    description: string;
    features: string[];
  }[];
}
export interface Account {
  user: User;
  emailVerified: boolean;
  revision: number;
  accountType: 'demo' | 'registered' | 'admin';
  professionalInterest: boolean;
  plan: {
    id: string;
    name: string;
    maxActiveProjects: number | null;
    aiDailyLimit: number;
    trialUsed: boolean;
    trialExpiresAt: number | null;
    autoRenew: boolean;
    paymentEnabled: boolean;
  };
  credits: { available: number; reserved: number; charged: number; released: number };
  stats: {
    activeProjects: number;
    ownedActiveProjects: number;
    totalProjects: number;
    jobs: number;
    storageBytes: number;
  };
  projects: { id: string; name: string; role: string; memberCount: number; archived: boolean }[];
  privacy: { modelImprovementConsent: boolean; consentAvailable: boolean; storageMode: string };
}
export interface LedgerEntry {
  id: string;
  type: string;
  deltaAvailable: number;
  deltaReserved: number;
  createdAt: string;
}
export const accountLabels = {
  demo: '本地体验账户',
  registered: '注册用户',
  admin: '运维管理账户',
};
export const memberLabels: Record<string, string> = {
  owner: '拥有者',
  editor: '可编辑',
  viewer: '只读',
};
export function ledgerDisplay(entry: LedgerEntry) {
  if (entry.type === 'reserve')
    return { label: '任务预留', value: `冻结 ${entry.deltaReserved} 点` };
  if (entry.type === 'charge')
    return { label: '任务完成结算', value: `扣除 ${-entry.deltaReserved} 点` };
  if (entry.type === 'release')
    return { label: '未交付额度退回', value: `退回 ${entry.deltaAvailable} 点` };
  const labels: Record<string, string> = {
    development_grant: '开发体验赠送',
    registration_grant: '注册赠送',
    trial_grant: '家庭版试用赠送',
    operations_grant: '运维发放',
  };
  return {
    label: labels[entry.type] || '积分账本变动',
    value: `${entry.deltaAvailable >= 0 ? '+' : ''}${entry.deltaAvailable} 点可用`,
  };
}
