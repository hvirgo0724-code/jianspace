import { describe, expect, it } from 'vitest';
import { ledgerDisplay, memberLabels, type LedgerEntry } from './billing';
describe('account and credit presentation', () => {
  const entry = (type: string, deltaAvailable: number, deltaReserved: number) =>
    ({ type, deltaAvailable, deltaReserved }) as LedgerEntry;
  it('distinguishes reserving, charging and releasing without showing a reserve as consumption', () => {
    expect(ledgerDisplay(entry('reserve', -10, 10))).toEqual({
      label: '任务预留',
      value: '冻结 10 点',
    });
    expect(ledgerDisplay(entry('charge', 0, -10))).toEqual({
      label: '任务完成结算',
      value: '扣除 10 点',
    });
    expect(ledgerDisplay(entry('release', 10, -10))).toEqual({
      label: '未交付额度退回',
      value: '退回 10 点',
    });
  });
  it('labels a one-time trial grant separately from registration and development balances', () => {
    expect(ledgerDisplay(entry('trial_grant', 30, 0)).label).toBe('家庭版试用赠送');
    expect(ledgerDisplay(entry('registration_grant', 6, 0)).value).toBe('+6 点可用');
    expect(ledgerDisplay(entry('development_grant', 100, 0)).label).toBe('开发体验赠送');
  });
  it('keeps project permissions separate from paid-plan or administrator status', () => {
    expect(memberLabels).toEqual({ owner: '拥有者', editor: '可编辑', viewer: '只读' });
    expect(memberLabels.admin).toBeUndefined();
  });
});
