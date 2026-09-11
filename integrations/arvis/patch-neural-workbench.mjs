#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const workbenchDir = path.resolve(process.argv[2] || process.env.NEURAL_WORKBENCH_DIR || path.join(os.homedir(), 'Downloads', 'neural-workbench'));
const appPath = path.join(workbenchDir, 'src', 'App.tsx');
const bridgePath = path.join(workbenchDir, 'src', 'lib', 'rtbOsBridge.ts');

if (!fs.existsSync(appPath)) {
  console.error(`[A.R.V.I.S.] Neural Workbench App.tsx not found: ${appPath}`);
  process.exit(1);
}

const bridgeSource = `const OPERATIONS_KEY = 'rtb_real_operations_data';
const STAFF_KEY = 'rtb_real_staff_data';
const RAW_SNAPSHOT_KEY = 'rtb_os_snapshot_v1';

function numberFrom(source: any, keys: string[]) {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && value !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function findPerformanceRow(rows: any[], member: any) {
  return rows.find((row) =>
    (row.staff_id && member.id && String(row.staff_id) === String(member.id)) ||
    (row.full_name && member.full_name && String(row.full_name).toLowerCase() === String(member.full_name).toLowerCase())
  ) || null;
}

function normalizeLocation(member: any, businessUnits: any[], currentBusiness: any) {
  const direct = member.business_location || member.businessLocation;
  if (direct) return direct;
  const unit = businessUnits.find((item) => String(item.id) === String(member.business_unit_id));
  return unit?.name || currentBusiness?.name || 'Unassigned';
}

function toWorkbenchStaff(payload: any) {
  const roster = Array.isArray(payload.staff) ? payload.staff : [];
  const performance = Array.isArray(payload.performanceSummary) ? payload.performanceSummary : [];
  const businessUnits = Array.isArray(payload.businessUnits) ? payload.businessUnits : [];

  return roster.map((member: any) => {
    const performanceRow = findPerformanceRow(performance, member);
    const sourceStatus = String(member.status || '').toUpperCase();
    const status = ['ACTIVE', 'BOOKED', 'BREAK', 'OFFLINE'].includes(sourceStatus) ? sourceStatus : 'OFFLINE';
    return {
      id: String(member.id || member.staff_id || member.full_name || crypto.randomUUID()),
      name: member.preferred_name || member.full_name || member.name || 'Unnamed staff',
      preferredName: member.preferred_name || undefined,
      fullName: member.full_name || member.name || undefined,
      role: member.role || 'Staff',
      businessLocation: normalizeLocation(member, businessUnits, payload.businessUnit),
      commissionRate: numberFrom(member, ['commission_rate', 'commissionRate']),
      tier: member.tier || '',
      chair: member.chair || member.station || '',
      status,
      sales14d: numberFrom(performanceRow, ['sales14d', 'total_net_sales_14d']),
      orders14d: numberFrom(performanceRow, ['orders14d', 'orders_14d']),
      openShifts: numberFrom(member, ['open_shifts', 'openShifts']),
      appointmentsToday: numberFrom(member, ['appointments_today', 'appointmentsToday']),
      revenueGenerated: numberFrom(performanceRow, ['today_net_sales', 'revenueGenerated']),
    };
  });
}

function toWorkbenchOperations(payload: any) {
  const summary = payload.masterDashboard?.summary || {};
  const businessName = payload.businessUnit?.name;
  const netSales = numberFrom(summary, ['todayNetSales', 'netSalesToday', 'todayRevenue', 'netSales']);
  const grossSales = numberFrom(summary, ['todayGrossSales', 'grossSalesToday', 'grossSales']);
  const orders = numberFrom(summary, ['todayOrders', 'ordersToday', 'transactionsToday', 'appointmentsToday']);
  const tips = numberFrom(summary, ['todayTips', 'tipsToday', 'tips']);
  const lounge = { netSales: 0, grossSales: 0, orders: 0, tips: 0 };
  const beauty = { netSales: 0, grossSales: 0, orders: 0, tips: 0 };
  if (businessName === 'RTB Lounge') Object.assign(lounge, { netSales, grossSales, orders, tips });
  if (businessName === 'RTB Beauty Lounge') Object.assign(beauty, { netSales, grossSales, orders, tips });

  return {
    todayByBusiness: {
      'RTB Lounge': lounge,
      'RTB Beauty Lounge': beauty,
    },
    totalTodayNet: netSales,
    totalTodayGross: grossSales,
    totalTodayOrders: orders,
    sales14d: 0,
    orders14d: 0,
    activeStaffCount: (Array.isArray(payload.staff) ? payload.staff : []).filter((member: any) => member.active !== false).length,
    currency: 'CAD',
    sourceTruth: 'rtb_os_bridge',
    lastUpdated: new Date().toISOString(),
  };
}

export function installRTBOSBridge() {
  function receive(event: MessageEvent) {
    if (event.data?.type !== 'RTB_OS_SNAPSHOT' || event.data?.version !== 1) return;
    const payload = event.data.payload || {};
    try {
      localStorage.setItem(RAW_SNAPSHOT_KEY, JSON.stringify(event.data));
      localStorage.setItem(STAFF_KEY, JSON.stringify(toWorkbenchStaff(payload)));
      localStorage.setItem(OPERATIONS_KEY, JSON.stringify(toWorkbenchOperations(payload)));
      window.dispatchEvent(new Event('rtb-data-updated'));
    } catch (error) {
      console.warn('[RTB OS Bridge] Could not persist snapshot', error);
    }
  }

  window.addEventListener('message', receive);
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'RTB_WORKBENCH_READY', version: 1 }, '*');
  }
  return () => window.removeEventListener('message', receive);
}
`;

fs.mkdirSync(path.dirname(bridgePath), { recursive: true });
fs.writeFileSync(bridgePath, bridgeSource, 'utf8');

let appSource = fs.readFileSync(appPath, 'utf8');
if (!appSource.includes("./lib/rtbOsBridge")) {
  const importMarker = "import { subscribeToRTBCloudData } from './lib/rtbDataStore';";
  if (!appSource.includes(importMarker)) {
    console.error('[A.R.V.I.S.] Expected rtbDataStore import marker was not found. No App.tsx changes made.');
    process.exit(1);
  }
  appSource = appSource.replace(importMarker, `${importMarker}\nimport { installRTBOSBridge } from './lib/rtbOsBridge';`);
}

if (!appSource.includes('installRTBOSBridge();')) {
  const componentMarker = 'export default function App() {\n';
  if (!appSource.includes(componentMarker)) {
    console.error('[A.R.V.I.S.] Expected App component marker was not found. No App.tsx changes made.');
    process.exit(1);
  }
  appSource = appSource.replace(componentMarker, `${componentMarker}  useEffect(() => installRTBOSBridge(), []);\n`);
}

fs.writeFileSync(appPath, appSource, 'utf8');
console.log(`[A.R.V.I.S.] RTB OS live-data bridge installed into ${workbenchDir}`);
console.log('[A.R.V.I.S.] The Workbench now accepts owner-scoped snapshots from the embedded RTB OS control room.');
