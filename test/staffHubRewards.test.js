import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildStaffHubRewards } from '../src/utils/staffHubInsights.js';

function accessPayload(modules = {}, roleTitle = 'Staff Portal') {
  return {
    modules: {
      appointments: 'none',
      operations: 'none',
      payroll: 'none',
      performance: 'none',
      staff_hub: 'view',
      ...modules,
    },
    role_title: roleTitle,
  };
}

test('staff reward board only calls a sales week a record when payroll history proves it', () => {
  const rewards = buildStaffHubRewards({
    accessPayload: accessPayload(),
    entries: [
      { id: 'new', net_sales: 1225, week_start: '2026-08-24' },
      { id: 'old', net_sales: 900, week_start: '2026-08-17' },
    ],
    monthlyGoal: { goal: 5000, percentComplete: 67 },
    ownActivityReviewSummary: { five_star_reviews: 4, review_count: 6 },
    ownPerformance: { best_week_net: 1225, weeks_recorded: 2 },
    rank: 4,
    roleTemplate: 'staff_portal',
    rtbScore: { score: 76 },
  });

  const record = rewards.rewards.find((reward) => reward.id === 'record-sales');

  assert.equal(record.status, 'earned');
  assert.match(record.detail, /New personal high/);
  assert.equal(record.source, 'Payroll history');
  assert.equal(rewards.headline.id, 'record-sales');
});

test('staff reward board does not fake record-breaking sales from one saved week', () => {
  const rewards = buildStaffHubRewards({
    accessPayload: accessPayload(),
    entries: [{ id: 'first', net_sales: 1500, week_start: '2026-08-24' }],
    monthlyGoal: { goal: 5000, percentComplete: 30 },
    ownActivityReviewSummary: { five_star_reviews: 0, review_count: 0 },
    roleTemplate: 'staff_portal',
    rtbScore: { score: 0 },
  });

  const record = rewards.rewards.find((reward) => reward.id === 'record-sales');

  assert.equal(record.status, 'locked');
  assert.match(record.detail, /two saved payroll weeks/);
  assert.equal(record.targetLabel, '2 payroll weeks');
});

test('staff reward board changes the motivation track for extra operations permissions', () => {
  const rewards = buildStaffHubRewards({
    accessPayload: accessPayload({ operations: 'edit' }, 'Operations Assistant'),
    dailyOperations: { checklistCompletion: 100, operationsScore: 94 },
    entries: [
      { id: 'new', net_sales: 725, week_start: '2026-08-24' },
      { id: 'old', net_sales: 680, week_start: '2026-08-17' },
    ],
    monthlyGoal: { goal: 5000, percentComplete: 45 },
    ownActivityReviewSummary: { five_star_reviews: 2, review_count: 3 },
    roleTemplate: 'operations_assistant',
    rtbScore: { score: 82 },
    tasks: [{ id: 'close', status: 'completed', title: 'Restock towels' }],
  });

  const roleReward = rewards.rewards.find((reward) => reward.id === 'role-operations');

  assert.equal(rewards.roleTrack.label, 'Operations track');
  assert.equal(roleReward.status, 'earned');
  assert.equal(roleReward.tab, 'daily');
  assert.match(roleReward.detail, /Daily ops are clean/);
});

test('staff reward board UI is wired as clickable app navigation, not decorative badges', () => {
  const page = fs.readFileSync(new URL('../src/pages/StaffHubPage.jsx', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');

  assert.match(page, /buildStaffHubRewards/);
  assert.match(page, /Reward Board/);
  assert.match(page, /onClick=\{\(\) => setActiveTab\(reward\.tab\)\}/);
  assert.match(page, /staffHubRewards\.roleTrack\.label/);
  assert.match(css, /\.staff-hub-reward-grid/);
  assert.match(css, /\.staff-hub-reward-spotlight/);
});
