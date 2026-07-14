const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const REPORT_COLORS = {
  brass: '#ffffff',
  info: '#7fb3dd',
  positive: '#5fc79b',
  urgent: '#e8705f',
};

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

function parseInteger(value) {
  const number = Number(String(value || '').replace(/[^\d-]/g, ''));
  return Number.isFinite(number) ? number : 0;
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

function normalizeReportText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function percentage(part, total) {
  if (!total) return 0;
  return Math.round((Number(part || 0) / Number(total || 1)) * 100);
}

function parseStatsPeriod(text) {
  const match = text.match(/Stats and reports\s+([A-Za-z]{3,9}\s+\d{4})/i);
  return match?.[1] || 'Booksy Stats & Reports';
}

function getPeriodMonth(periodLabel) {
  const monthText = periodLabel.match(/[A-Za-z]{3,9}/)?.[0]?.toLowerCase();
  if (!monthText) return 'Report';

  return MONTHS.find((month) => month.toLowerCase() === monthText.slice(0, 3)) || 'Report';
}

function parseBooksyStatsReport(text, fileName) {
  const reportText = normalizeReportText(text);
  const markerCount = [
    'Stats and reports',
    'Appointments & Occupancy',
    'Dashboard Appointments Clients Revenue',
  ].filter((marker) => reportText.toLowerCase().includes(marker.toLowerCase())).length;

  if (markerCount < 2) return null;

  const appointmentMatch = reportText.match(
    /APPOINTMENTS(?:\s+TIME\s+BOOKED)?\s+([\d,]+)(?:\s+[\d.]+%)?(?:\s+([\d,]+)(?:\s+[\d.]+%)?)?/i,
  );
  const statusMatch = reportText.match(/CONFIRMED\s+FINISHED\s+([\d,]+)\s+([\d,]+)/i);
  const noShowMatch = reportText.match(/NO[-\s]?SHOWS\s+CANCELLED\s+([\d,]+)\s+([\d,]+)/i);
  const revenueMatch = reportText.match(/\bRevenue\s+\$?([\d,]+(?:\.\d{2})?)/i);
  const serviceProductMatch = reportText.match(
    /SERVICES\s+PRODUCTS\s+\$?([\d,]+(?:\.\d{2})?)\s+\$?([\d,]+(?:\.\d{2})?)/i,
  );
  const tipsGiftMatch = reportText.match(
    /TIPS\s+GIFT\s+CARDS\s+\$?([\d,]+(?:\.\d{2})?)\s+\$?([\d,]+(?:\.\d{2})?)/i,
  );
  const membershipsPackagesMatch = reportText.match(
    /MEMBERSHIPS\s+PACKAGES\s+\$?([\d,]+(?:\.\d{2})?)\s+\$?([\d,]+(?:\.\d{2})?)/i,
  );
  const clientsMatch = reportText.match(
    /\bClients\s+([\d,]+)(?:\s+[\d.]+%)?\s+NEW\s+RETURNING\s+([\d,]+)\s+([\d,]+)/i,
  );

  if (!appointmentMatch && !revenueMatch && !clientsMatch) return null;

  const periodLabel = parseStatsPeriod(reportText);
  const month = getPeriodMonth(periodLabel);
  const appointments = parseInteger(appointmentMatch?.[1]);
  const timeBooked = parseInteger(appointmentMatch?.[2]);
  const confirmed = parseInteger(statusMatch?.[1]);
  const finished = parseInteger(statusMatch?.[2]);
  const noShows = parseInteger(noShowMatch?.[1]);
  const canceled = parseInteger(noShowMatch?.[2]);
  const ytdRevenue = parseMoney(revenueMatch?.[1]);
  const servicesRevenue = parseMoney(serviceProductMatch?.[1]);
  const productsRevenue = parseMoney(serviceProductMatch?.[2]);
  const tipsRevenue = parseMoney(tipsGiftMatch?.[1]);
  const giftCardsRevenue = parseMoney(tipsGiftMatch?.[2]);
  const membershipsRevenue = parseMoney(membershipsPackagesMatch?.[1]);
  const packagesRevenue = parseMoney(membershipsPackagesMatch?.[2]);
  const allTimeClients = parseInteger(clientsMatch?.[1]);
  const newClients = parseInteger(clientsMatch?.[2]);
  const returningClients = parseInteger(clientsMatch?.[3]);
  const completedAppointments = finished || Math.max(appointments - noShows - canceled, 0);
  const serviceRows = [
    ['Services', servicesRevenue, completedAppointments, canceled],
    ['Products', productsRevenue, 0, 0],
    ['Tips', tipsRevenue, 0, 0],
    ['Gift cards', giftCardsRevenue, 0, 0],
    ['Memberships', membershipsRevenue, 0, 0],
    ['Packages', packagesRevenue, 0, 0],
  ]
    .filter(([, revenue, count]) => revenue || count)
    .map(([name, revenue, count, cancelled]) => ({
      cancelRate: count ? percentage(cancelled, count + cancelled) : 0,
      cancelled,
      count,
      fullName: name,
      name,
      revenue: Number(revenue.toFixed(2)),
    }));

  return {
    businessUnit: 'RTB Lounge',
    clientSegments: [
      { appointments: newClients, color: REPORT_COLORS.info, count: newClients, label: 'New' },
      {
        appointments: returningClients,
        color: REPORT_COLORS.positive,
        count: returningClients,
        label: 'Returning',
      },
      { appointments: canceled, color: REPORT_COLORS.urgent, count: canceled, label: 'Canceled' },
      { appointments: noShows, color: REPORT_COLORS.brass, count: noShows, label: 'No-show' },
    ],
    importedFrom: fileName,
    location: 'Booksy Stats & Reports import',
    monthlyRevenue: [
      {
        appointments,
        month,
        revenue: Number(ytdRevenue.toFixed(2)),
      },
    ],
    recentTransactions: [],
    services: serviceRows,
    source: 'Booksy Stats & Reports PDF',
    staff: [],
    summary: {
      allTimeBookings: appointments,
      allTimeClients,
      completedAppointments,
      confirmedAppointments: confirmed,
      newClients,
      newRevenueShare: percentage(newClients, allTimeClients),
      noShows,
      periodLabel,
      reportKind: 'summary',
      reportMode: 'booksy_file_import',
      returningBase: returningClients,
      returningClients,
      returningRevenueShare: percentage(returningClients, allTimeClients),
      slippingAwayClients: 0,
      timeBooked,
      ytdRevenue: Number(ytdRevenue.toFixed(2)),
    },
    topClients: [],
    upcomingAppointments: [],
    updatedAt: new Date().toISOString(),
  };
}

function parseDelimited(text) {
  const tabCount = (text.match(/\t/g) || []).length;
  const commaCount = (text.match(/,/g) || []).length;
  const lineCount = Math.max(1, (text.match(/\n/g) || []).length + 1);
  const delimiter = tabCount ? '\t' : commaCount > lineCount ? ',' : null;
  const rows = [];
  let cell = '';
  let row = [];
  let quoted = false;

  if (!delimiter) {
    const looseRows = text
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s{2,}|\t/).map((value) => value.trim()))
      .filter((values) => values.some(Boolean));

    if (looseRows.length < 2) {
      throw new Error('The report did not contain enough rows to import.');
    }

    return rowsFromTable(looseRows);
  }

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

  return rowsFromTable(rows);
}

function rowsFromTable(rows) {
  const headerIndex = Math.max(0, rows.findIndex((row) => {
    const normalized = normalizeKey(row.join(' '));
    const matches = [
      'date',
      'client',
      'customer',
      'service',
      'staff',
      'barber',
      'provider',
      'amount',
      'price',
      'total',
      'status',
    ].filter((term) => normalized.includes(term)).length;

    return row.length >= 3 && matches >= 2;
  }));
  const headers = rows[headerIndex];

  return rows.slice(headerIndex + 1).map((values) =>
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
  const statsReport = parseBooksyStatsReport(text, fileName);
  if (statsReport) return statsReport;

  const rawRows = parseDelimited(text);
  const records = rawRows.map(toRecord);
  const usableRows = records.filter((record) => record.date || record.amount || record.service !== 'Unknown service');

  if (!usableRows.length) {
    throw new Error('No appointment rows were found. Import a Booksy appointments or sales report as PDF, CSV, or TSV.');
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
    color: REPORT_COLORS.brass,
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
  const newRevenueShare = percentage(firstVisitClients, totalClients);
  const returningRevenueShare = percentage(returningClients, totalClients);

  return {
    businessUnit: 'RTB Lounge',
    clientSegments: [
      {
        appointments: firstVisitClients,
        color: REPORT_COLORS.info,
        count: firstVisitClients,
        label: 'First Visit',
      },
      {
        appointments: returningClients,
        color: REPORT_COLORS.positive,
        count: returningClients,
        label: 'Returning',
      },
      { appointments: canceled, color: REPORT_COLORS.urgent, count: canceled, label: 'Canceled' },
      { appointments: noShows, color: REPORT_COLORS.brass, count: noShows, label: 'No-show' },
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
    source: 'Booksy File Import',
    staff: staffRows,
    summary: {
      allTimeBookings: usableRows.length,
      allTimeClients: totalClients,
      completedAppointments: usableRows.length - canceled,
      newClients: firstVisitClients,
      newRevenueShare,
      noShows,
      periodLabel: formatPeriod(dates),
      reportKind: 'appointments',
      reportMode: 'booksy_file_import',
      returningBase: returningClients,
      returningClients,
      returningRevenueShare,
      slippingAwayClients: 0,
      ytdRevenue: Number(totalRevenue.toFixed(2)),
    },
    topClients: clientRows.slice(0, 10),
    upcomingAppointments: [],
    updatedAt: new Date().toISOString(),
  };
}
