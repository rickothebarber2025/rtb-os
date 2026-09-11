#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const workbenchDir = path.resolve(process.argv[2] || process.env.NEURAL_WORKBENCH_DIR || path.join(os.homedir(), 'Downloads', 'neural-workbench'));
const appPath = path.join(workbenchDir, 'src', 'App.tsx');
const bridgePath = path.join(workbenchDir, 'src', 'lib', 'rtbOsBridge.ts');
const serverPath = path.join(workbenchDir, 'server.ts');

for (const requiredPath of [appPath, serverPath]) {
  if (!fs.existsSync(requiredPath)) {
    console.error(`[A.R.V.I.S.] Required Neural Workbench file not found: ${requiredPath}`);
    process.exit(1);
  }
}

const bridgeSource = `const OPERATIONS_KEY = 'rtb_real_operations_data';
const STAFF_KEY = 'rtb_real_staff_data';
const RAW_SNAPSHOT_KEY = 'rtb_os_snapshot_v1';

function optionalNumber(source: any, keys: string[]) {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && value !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
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
      commissionRate: optionalNumber(member, ['commission_rate', 'commissionRate']),
      tier: member.tier || '',
      chair: member.chair || member.station || '',
      status,
      sales14d: optionalNumber(performanceRow, ['sales14d', 'total_net_sales_14d']),
      orders14d: optionalNumber(performanceRow, ['orders14d', 'orders_14d']),
      openShifts: optionalNumber(member, ['open_shifts', 'openShifts']),
      appointmentsToday: optionalNumber(member, ['appointments_today', 'appointmentsToday']),
      revenueGenerated: optionalNumber(performanceRow, ['today_net_sales', 'revenueGenerated']),
    };
  });
}

function toWorkbenchOperations(payload: any) {
  const summary = payload.masterDashboard?.summary || null;
  const businessName = payload.businessUnit?.name || null;
  const hasSummary = Boolean(summary && Object.keys(summary).length);
  const netSales = hasSummary ? optionalNumber(summary, ['todayNetSales', 'netSalesToday', 'todayRevenue', 'netSales']) : null;
  const grossSales = hasSummary ? optionalNumber(summary, ['todayGrossSales', 'grossSalesToday', 'grossSales']) : null;
  const orders = hasSummary ? optionalNumber(summary, ['todayOrders', 'ordersToday', 'transactionsToday', 'appointmentsToday']) : null;
  const tips = hasSummary ? optionalNumber(summary, ['todayTips', 'tipsToday', 'tips']) : null;
  const emptyBusiness = { netSales: null, grossSales: null, orders: null, tips: null };
  const lounge = { ...emptyBusiness };
  const beauty = { ...emptyBusiness };
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
    sales14d: null,
    orders14d: null,
    activeStaffCount: Array.isArray(payload.staff) ? payload.staff.filter((member: any) => member.active !== false).length : null,
    currency: 'CAD',
    sourceTruth: 'RTB_OS_SUPABASE_BRIDGE',
    dataAvailable: hasSummary,
    unavailableReason: hasSummary ? null : 'RTB OS did not provide a current operational summary.',
    lastUpdated: new Date().toISOString(),
  };
}

async function mirrorSnapshotToServer(rawSnapshot: any, operations: any, staff: any[]) {
  try {
    await fetch('/api/rtb-os/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawSnapshot, operations, staff }),
    });
  } catch (error) {
    console.warn('[RTB OS Bridge] Server mirror unavailable', error);
  }
}

export function installRTBOSBridge() {
  function receive(event: MessageEvent) {
    if (window.parent === window || event.source !== window.parent) return;
    if (event.data?.type !== 'RTB_OS_SNAPSHOT' || event.data?.version !== 1) return;
    const payload = event.data.payload || {};
    const staff = toWorkbenchStaff(payload);
    const operations = toWorkbenchOperations(payload);
    try {
      localStorage.setItem(RAW_SNAPSHOT_KEY, JSON.stringify(event.data));
      localStorage.setItem(STAFF_KEY, JSON.stringify(staff));
      localStorage.setItem(OPERATIONS_KEY, JSON.stringify(operations));
      window.dispatchEvent(new Event('rtb-data-updated'));
      void mirrorSnapshotToServer(event.data, operations, staff);
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

let serverSource = fs.readFileSync(serverPath, 'utf8');
if (!serverSource.includes("app.post('/api/rtb-os/snapshot'")) {
  const healthMarker = "// Healthcheck\napp.get('/api/health', (req, res) => {";
  if (!serverSource.includes(healthMarker)) {
    console.error('[A.R.V.I.S.] Expected Workbench health marker was not found. No server.ts changes made.');
    process.exit(1);
  }
  const snapshotEndpoint = `// RTB OS owner-scoped live snapshot mirror\napp.post('/api/rtb-os/snapshot', (req, res) => {\n  try {\n    const remote = String(req.socket.remoteAddress || '');\n    const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';\n    if (!loopback) return res.status(403).json({ error: 'RTB OS snapshot bridge is localhost-only' });\n    const { rawSnapshot, operations, staff } = req.body || {};\n    if (!rawSnapshot || rawSnapshot.type !== 'RTB_OS_SNAPSHOT' || rawSnapshot.version !== 1) {\n      return res.status(400).json({ error: 'Valid RTB_OS_SNAPSHOT v1 is required' });\n    }\n    if (!operations || !Array.isArray(staff)) {\n      return res.status(400).json({ error: 'Mapped operations and staff are required' });\n    }\n    saveOperationsData({ ...operations, sourceTruth: 'RTB_OS_SUPABASE_BRIDGE', lastUpdated: new Date().toISOString() });\n    saveStaffData(staff);\n    fs.writeFileSync(path.join(DATA_DIR, 'rtb-os-snapshot.json'), JSON.stringify(rawSnapshot, null, 2), 'utf-8');\n    return res.json({ status: 'ok', sourceTruth: 'RTB_OS_SUPABASE_BRIDGE', dataAvailable: operations.dataAvailable === true, staffCount: staff.length, mirroredAt: new Date().toISOString() });\n  } catch (e: any) {\n    return res.status(500).json({ error: e.message || 'Failed to mirror RTB OS snapshot' });\n  }\n});\n\n`;
  serverSource = serverSource.replace(healthMarker, `${snapshotEndpoint}${healthMarker}`);
}
fs.writeFileSync(serverPath, serverSource, 'utf8');

console.log(`[A.R.V.I.S.] RTB OS live-data bridge installed into ${workbenchDir}`);
console.log('[A.R.V.I.S.] Snapshot ingestion is parent-only in the browser and localhost-only on the Workbench server.');
