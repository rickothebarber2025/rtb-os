const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function normalizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function pickValue(row, candidates) {
  const normalizedCandidates = candidates.map(normalizeKey);
  const entry = Object.entries(row).find(([key]) =>
    normalizedCandidates.some((candidate) => normalizeKey(key).includes(candidate)),
  );

  return entry?.[1] || '';
}

function parseMoney(value) {
  const text = String(value || '').trim();
  if (!text || text === '-') return 0;

  const negative = /^\(.*\)$/.test(text) || text.startsWith('-');
  const number = Number(text.replace(/[^\d.]/g, ''));

  if (!Number.isFinite(number)) return 0;
  return negative ? -number : number;
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatPeriod(dates) {
  if (!dates.length) return 'Imported report';

  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const formatter = new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return `${formatter.format(first)} - ${formatter.format(last)}`;
}

function parseDelimited(text) {
  const delimiter = (text.match(/\t/g) || []).length > (text.match(/,/g) || []).length ? '\t' : ',';
  const rows = [];
  let cell = '';
  let row = [];
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === delimiter && !quoted) {
      row.push(cell.trim());
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);

  if (rows.length < 2) {
    throw new Error('The report did not contain enough rows to import.');
  }

  const headers = rows[0];
  return rows.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])),
  );
}

function toRecord(row) {
  const status = pickValue(row, ['status', 'appointment status', 'booking status']);
  const statusText = status.toLowerCase();
  const date = parseDate(pickValue(row, ['date', 'appointment date', 'booking date', 'start time', 'created at']));
  const staff = pickValue(row, ['staff', 'barber', 'provider', 'employee', 'specialist', 'team member']) || 'Unknown staff';
  const service = pickValue(row, ['service', 'service name', 'appointment service', 'treatment']) || 'Unknown service';
  const client = pickValue(row, ['client', 'customer', 'customer name', 'client name']) || 'Unknown client';
  const amount = parseMoney(
    pickValue(row, [
      'net sales',
      'gross sales',
      'revenue',
      'amount',
      'total',
      'price',
      'paid',
      'payment',
      'sale',
    ]),
  );

  return {
    amount,
    canceled: /cancel/.test(statusText),
    client,
    date,
    noShow: /no show|noshow|no-show/.test(statusText),
    service,
    staff,
    status,
  };
}

function toArray(map, mapper) {
  return [...map.entries()].map(([key, value]) => mapper(key, value));
}

export function parseBooksyReport(text, fileName = 'Booksy report') {
  const rawRows = parseDelimited(text);
  const records = rawRows.map(toRecord);
  const usableRows = records.filter((record) => record.date || record.amount || record.service !== 'Unknown service');

  if (!usableRows.length) {
    throw new Error('No appointment rows were found. Export the Booksy appointments or sales report as CSV.');
  }

  const dates = usableRows.map((record) => record.date).filter(Boolean);
  const monthly = new Map();
  const staff = new Map();
  const services = new Map();
  const clients = new Map();

  let totalRevenue = 0;
  let noShows = 0;
  let canceled = 0;

  for (const record of usableRows) {
    const revenue = record.canceled ? 0 : record.amount;
    totalRevenue += revenue;
    noShows += record.noShow ? 1 : 0;
    canceled += record.canceled ? 1 : 0;

    if (record.date) {
      const month = MONTHS[record.date.getMonth()];
      const monthRow = monthly.get(month) || { appointments: 0, revenue: 0 };
      monthRow.appointments += 1;
      monthRow.revenue += revenue;
      monthly.set(month, monthRow);
    }

    const staffRow = staff.get(record.staff) || { appointments: 0, mayAppointments: 0, revenue: 0 };
    staffRow.appointments += 1;
    staffRow.mayAppointments += record.date?.getMonth() === 4 ? 1 : 0;
    staffRow.revenue += revenue;
    staff.set(record.staff, staffRow);

    const serviceRow = services.get(record.service) || { canceled: 0, count: 0, revenue: 0 };
    serviceRow.canceled += record.canceled ? 1 : 0;
    serviceRow.count += 1;
    serviceRow.revenue += revenue;
    services.set(record.service, serviceRow);

    const clientRow = clients.get(record.client) || { bookings: 0, noShows: 0, value: 0 };
    clientRow.bookings += 1;
    clientRow.noShows += record.noShow ? 1 : 0;
    clientRow.value += revenue;
    clients.set(record.client, clientRow);
  }

  const monthlyRevenue = MONTHS.filter((month) => monthly.has(month)).map((month) => ({
    appointments: monthly.get(month).appointments,
    month,
    revenue: Number(monthly.get(month).revenue.toFixed(2)),
  }));

  const staffRows = toArray(staff, (name, row) => ({
    appointments: row.appointments,
    color: '#C9A84C',
    mayAppointments: row.mayAppointments,
    name,
    occupancy: 0,
    revenue: Number(row.revenue.toFixed(2)),
    visitTime: null,
    workHours: null,
  })).sort((a, b) => b.revenue - a.revenue);

  const serviceRows = toArray(services, (name, row) => ({
    cancelRate: row.count ? Math.round((row.canceled / row.count) * 100) : 0,
    cancelled: row.canceled,
    count: row.count,
    fullName: name,
    name,
    revenue: Number(row.revenue.toFixed(2)),
  })).sort((a, b) => b.revenue - a.revenue);

  const clientRows = toArray(clients, (name, row) => ({
    bookings: row.bookings,
    name,
    noShows: row.noShows,
    value: Number(row.value.toFixed(2)),
  })).sort((a, b) => b.value - a.value);

  const returningClients = clientRows.filter((client) => client.bookings > 1).length;
  const firstVisitClients = clientRows.filter((client) => client.bookings === 1).length;
  const totalClients = clientRows.length;

  return {
    businessUnit: 'RTB Lounge',
    clientSegments: [
      { appointments: firstVisitClients, color: '#5B9BE0', count: firstVisitClients, label: 'First Visit' },
      { appointments: returningClients, color: '#4CAF7D', count: returningClients, label: 'Returning' },
      { appointments: canceled, color: '#E05252', count: canceled, label: 'Canceled' },
      { appointments: noShows, color: '#E09040', count: noShows, label: 'No-show' },
    ],
    importedFrom: fileName,
    location: 'Booksy report import',
    monthlyRevenue,
    recentTransactions: usableRows
      .filter((record) => record.date)
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, 20)
      .map((record) => ({
        amount: Number(record.amount.toFixed(2)),
        client: record.client,
        date: new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short' }).format(record.date),
        service: record.service,
        staffer: record.staff,
      })),
    services: serviceRows,
    source: 'Booksy CSV Import',
    staff: staffRows,
    summary: {
      allTimeBookings: usableRows.length,
      allTimeClients: totalClients,
      completedAppointments: usableRows.length - canceled,
      noShows,
      periodLabel: formatPeriod(dates),
      reportMode: 'booksy_file_import',
      returningBase: returningClients,
      slippingAwayClients: 0,
      ytdRevenue: Number(totalRevenue.toFixed(2)),
    },
    topClients: clientRows.slice(0, 10),
    upcomingAppointments: [],
    updatedAt: new Date().toISOString(),
  };
}
