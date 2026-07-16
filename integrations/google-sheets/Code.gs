const RTB_OS_EXPORT_SHEET = 'RTB_OS_EXPORT';
const RTB_OS_STAFF_MAP_SHEET = 'RTB_OS_STAFF_MAP';
const PAY_HISTORY_SHEET = 'Pay History';
const STAFF_DIRECTORY_SHEET = 'Staff Directory';
const RTB_SYNC_URL_PROPERTY = 'RTB_OS_SYNC_URL';
const RTB_SYNC_SECRET_PROPERTY = 'RTB_OS_SYNC_SECRET';
const RTB_AUTO_SYNC_HOURS_PROPERTY = 'RTB_OS_AUTO_SYNC_HOURS';
const DEFAULT_SYNC_URL =
  'https://qbeficojfoqgzjxrzxyg.supabase.co/functions/v1/google-sheets-payroll-sync';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('RTB OS')
    .addItem('Refresh export from Pay History', 'refreshRtbOsPayrollExport')
    .addItem('Sync to RTB OS', 'syncToRtbOs')
    .addItem('Refresh + sync now', 'refreshAndSyncToRtbOs')
    .addSeparator()
    .addItem('Turn on automatic sync', 'installAutomaticRtbOsPayrollSync')
    .addItem('Turn off automatic sync', 'removeAutomaticRtbOsPayrollSync')
    .addSeparator()
    .addItem('Configure sync', 'configureRtbOsSync')
    .addToUi();
}

function configureRtbOsSync() {
  const ui = SpreadsheetApp.getUi();
  const properties = PropertiesService.getScriptProperties();
  const currentUrl = properties.getProperty(RTB_SYNC_URL_PROPERTY) || DEFAULT_SYNC_URL;
  const urlPrompt = ui.prompt(
    'RTB OS sync URL',
    'Enter the Supabase Edge Function URL.',
    ui.ButtonSet.OK_CANCEL,
  );

  if (urlPrompt.getSelectedButton() !== ui.Button.OK) return;

  const syncUrl = urlPrompt.getResponseText().trim() || currentUrl;
  if (!syncUrl) {
    ui.alert('Sync URL was not saved.');
    return;
  }

  const secretPrompt = ui.prompt(
    'RTB OS sync secret',
    'Enter the shared sync secret. It is stored in this workbook script properties.',
    ui.ButtonSet.OK_CANCEL,
  );

  if (secretPrompt.getSelectedButton() !== ui.Button.OK) return;

  const syncSecret = secretPrompt.getResponseText().trim();
  if (!syncSecret) {
    ui.alert('Sync secret was not saved.');
    return;
  }

  properties.setProperties({
    [RTB_SYNC_URL_PROPERTY]: syncUrl,
    [RTB_SYNC_SECRET_PROPERTY]: syncSecret,
  });
  ui.alert('RTB OS sync is configured.');
}

function syncToRtbOs() {
  return syncToRtbOs_({ showAlerts: true, refreshExport: false });
}

function refreshAndSyncToRtbOs() {
  return syncToRtbOs_({ showAlerts: true, refreshExport: true });
}

function syncToRtbOsAutomatic() {
  return syncToRtbOs_({ showAlerts: false, refreshExport: true });
}

function refreshRtbOsPayrollExport() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const count = refreshPayrollExportFromPayHistory_(spreadsheet);
  showMessage_(`RTB OS export refreshed with ${count} payroll rows.`);
}

function installAutomaticRtbOsPayrollSync() {
  const ui = SpreadsheetApp.getUi();
  const properties = PropertiesService.getScriptProperties();
  const prompt = ui.prompt(
    'Automatic RTB OS payroll sync',
    'How often should RTB OS sync this workbook? Enter 1, 2, 4, 6, 8, 12, or 24 hours.',
    ui.ButtonSet.OK_CANCEL,
  );

  if (prompt.getSelectedButton() !== ui.Button.OK) return;

  const hours = Number(prompt.getResponseText().trim() || 6);
  if (![1, 2, 4, 6, 8, 12, 24].includes(hours)) {
    ui.alert('Automatic sync was not installed. Use 1, 2, 4, 6, 8, 12, or 24 hours.');
    return;
  }

  removeAutomaticRtbOsPayrollSync_();
  ScriptApp.newTrigger('syncToRtbOsAutomatic')
    .timeBased()
    .everyHours(hours)
    .create();
  properties.setProperty(RTB_AUTO_SYNC_HOURS_PROPERTY, String(hours));
  ui.alert(`Automatic RTB OS payroll sync is on. It will run every ${hours} hour(s).`);
}

function removeAutomaticRtbOsPayrollSync() {
  const removed = removeAutomaticRtbOsPayrollSync_();
  PropertiesService.getScriptProperties().deleteProperty(RTB_AUTO_SYNC_HOURS_PROPERTY);
  SpreadsheetApp.getUi().alert(
    removed
      ? 'Automatic RTB OS payroll sync is off.'
      : 'No automatic RTB OS payroll sync trigger was installed.',
  );
}

function syncToRtbOs_(options) {
  const showAlerts = options && options.showAlerts !== false;
  const refreshExport = Boolean(options && options.refreshExport);
  const properties = PropertiesService.getScriptProperties();
  const syncUrl = properties.getProperty(RTB_SYNC_URL_PROPERTY);
  const syncSecret = properties.getProperty(RTB_SYNC_SECRET_PROPERTY);

  if (!syncUrl || !syncSecret) {
    showMessage_('Open RTB OS > Configure sync before running the first sync.', showAlerts);
    return { ok: false, error: 'Sync is not configured.' };
  }

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (refreshExport) {
    refreshPayrollExportFromPayHistory_(spreadsheet);
  }

  const sheet = spreadsheet.getSheetByName(RTB_OS_EXPORT_SHEET);

  if (!sheet) {
    showMessage_(`Sheet "${RTB_OS_EXPORT_SHEET}" was not found. Run RTB OS > Refresh export from Pay History.`, showAlerts);
    return { ok: false, error: 'Export sheet was not found.' };
  }

  const rows = getExportRows_(sheet, spreadsheet.getSpreadsheetTimeZone());
  if (!rows.length) {
    showMessage_(`No data rows found in "${RTB_OS_EXPORT_SHEET}".`, showAlerts);
    return { ok: false, error: 'No export rows found.' };
  }

  const validationError = validateExportRows_(rows);
  if (validationError) {
    showMessage_(validationError, showAlerts);
    return { ok: false, error: validationError };
  }

  const payload = {
    rows,
    sheetName: RTB_OS_EXPORT_SHEET,
    spreadsheetId: spreadsheet.getId(),
    spreadsheetName: spreadsheet.getName(),
    syncedAt: new Date().toISOString(),
  };

  const response = UrlFetchApp.fetch(syncUrl, {
    contentType: 'application/json',
    headers: {
      'X-RTB-Sync-Token': syncSecret,
    },
    method: 'post',
    muteHttpExceptions: true,
    payload: JSON.stringify(payload),
  });

  const status = response.getResponseCode();
  const bodyText = response.getContentText();
  let body = {};

  try {
    body = JSON.parse(bodyText);
  } catch (err) {
    body = { error: bodyText || 'No response body returned.' };
  }

  if (status >= 200 && status < 300 && body.ok !== false) {
    showMessage_(
      body.message ||
        `Synced ${body.records_upserted || rows.length} payroll records to RTB OS.`,
      showAlerts,
    );
    return { ok: true, body };
  }

  const error = `RTB OS sync failed: ${body.error || `HTTP ${status}`}`;
  showMessage_(error, showAlerts);
  return { ok: false, error };
}

function refreshPayrollExportFromPayHistory_(spreadsheet) {
  const payHistory = spreadsheet.getSheetByName(PAY_HISTORY_SHEET);
  if (!payHistory) {
    throw new Error(`Sheet "${PAY_HISTORY_SHEET}" was not found.`);
  }

  const staffMap = ensureStaffMap_(spreadsheet);
  const values = payHistory.getDataRange().getValues();
  if (values.length < 2) {
    writeExportRows_(spreadsheet, []);
    return 0;
  }

  const headers = values[0].map((header) => normalizeHeader_(header));
  const rows = values.slice(1)
    .map((row) => mapPayHistoryRow_(row, headers, staffMap, spreadsheet.getSpreadsheetTimeZone()))
    .filter(Boolean);

  writeExportRows_(spreadsheet, rows);
  return rows.length;
}

function ensureStaffMap_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(RTB_OS_STAFF_MAP_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(RTB_OS_STAFF_MAP_SHEET);
    sheet.hideSheet();
  }

  const existing = readStaffMapSheet_(sheet);
  const directoryRows = readStaffDirectory_(spreadsheet);
  let nextRow = Math.max(sheet.getLastRow() + 1, 2);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, 4).setValues([
      ['staff_name', 'business', 'role', 'email'],
    ]);
    nextRow = 2;
  }

  const additions = directoryRows.filter((staff) => !existing.has(normalizeStaffKey_(staff.staff_name)));
  if (additions.length) {
    sheet.getRange(nextRow, 1, additions.length, 4).setValues(
      additions.map((staff) => [
        staff.staff_name,
        staff.business,
        staff.role,
        staff.email,
      ]),
    );
  }

  return readStaffMapSheet_(sheet);
}

function readStaffMapSheet_(sheet) {
  const values = sheet.getDataRange().getValues();
  const map = new Map();
  if (values.length < 2) return map;

  values.slice(1).forEach((row) => {
    const staffName = String(row[0] || '').trim();
    if (!staffName) return;

    map.set(normalizeStaffKey_(staffName), {
      business: String(row[1] || 'RTB Lounge').trim() || 'RTB Lounge',
      role: String(row[2] || '').trim(),
      email: String(row[3] || '').trim(),
    });
  });

  return map;
}

function readStaffDirectory_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(STAFF_DIRECTORY_SHEET);
  if (!sheet) return [];

  const values = sheet.getDataRange().getValues();
  const staff = [];
  let currentBusiness = 'RTB Lounge';
  let currentRole = '';

  values.forEach((row) => {
    const staffName = String(row[0] || '').trim();
    const email = String(row[1] || '').trim();
    const group = String(row[3] || '').trim().toLowerCase();

    if (group.includes('beauty')) {
      currentBusiness = 'RTB Beauty Lounge';
      currentRole = 'beauty professional';
    } else if (group.includes('barber')) {
      currentBusiness = 'RTB Lounge';
      currentRole = 'barber';
    } else if (group.includes('stylist')) {
      currentBusiness = 'RTB Lounge';
      currentRole = 'hairstylist';
    }

    if (!staffName || staffName.toLowerCase() === 'flow' || staffName.toLowerCase() === 'emails') return;

    staff.push({
      staff_name: staffName,
      business: currentBusiness,
      role: currentRole,
      email,
    });
  });

  return staff;
}

function mapPayHistoryRow_(row, headers, staffMap, timeZone) {
  const record = {};
  headers.forEach((header, index) => {
    if (header) record[header] = row[index];
  });

  const staffName = String(record.staff || record.staff_name || '').trim();
  const weekStart = record.week_start;
  const weekEnd = record.week_end;
  if (!staffName || !weekStart || !weekEnd) return null;

  const mappedStaff = staffMap.get(normalizeStaffKey_(staffName)) || {};
  const commissionRate = Math.max(0, normalizePercent_(record.commission || record.commission_rate || record.commission_percent));
  const netSales = Math.max(0, normalizeMoney_(record.revenue));
  const tips = Math.max(0, normalizeMoney_(record.tips));
  const deduction = Math.max(0, normalizeMoney_(record.deductions));
  const takeHome = Math.max(0, normalizeMoney_(record.net_pay));
  const payrollStatus = String(record.payroll_status || '').trim();

  return {
    business: mappedStaff.business || 'RTB Lounge',
    week_start: normalizeDate_(weekStart, timeZone),
    week_end: normalizeDate_(weekEnd, timeZone),
    week_label: formatWeekLabel_(weekStart, weekEnd, timeZone),
    staff_name: staffName,
    net_sales: netSales,
    tips,
    commission_rate: commissionRate,
    applied_commission_rate: commissionRate,
    deduction,
    take_home: takeHome,
    tier: tierFromRate_(commissionRate),
    role: mappedStaff.role || '',
    notes: payrollStatus ? `Google Sheets payroll status: ${payrollStatus}` : '',
    paystub_status: paystubStatusFromPayrollStatus_(payrollStatus),
  };
}

function writeExportRows_(spreadsheet, rows) {
  let sheet = spreadsheet.getSheetByName(RTB_OS_EXPORT_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(RTB_OS_EXPORT_SHEET);
  }

  const headers = [
    'business',
    'week_start',
    'week_end',
    'week_label',
    'staff_name',
    'net_sales',
    'tips',
    'commission_rate',
    'applied_commission_rate',
    'deduction',
    'take_home',
    'tier',
    'role',
    'notes',
    'paystub_status',
  ];

  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(
      rows.map((row) => headers.map((header) => row[header])),
    );
  }

  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
}

function getExportRows_(sheet, timeZone) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map((header) => normalizeHeader_(header));

  return values
    .slice(1)
    .filter((row) => row.some((cell) => cell !== '' && cell !== null))
    .map((row) => {
      const record = {};

      headers.forEach((header, index) => {
        if (!header) return;
        record[header] = normalizeCell_(row[index], timeZone);
      });

      return record;
    });
}

function validateExportRows_(rows) {
  const missingBusinessRows = [];
  const missingRequiredRows = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const hasBusiness = Boolean(row.business || row.business_unit || row.business_unit_id);
    const hasRequiredFields = Boolean(row.week_start && row.week_end && row.staff_name);

    if (!hasBusiness) missingBusinessRows.push(rowNumber);
    if (!hasRequiredFields) missingRequiredRows.push(rowNumber);
  });

  if (missingBusinessRows.length) {
    return `RTB OS sync stopped. Add a business, business_unit, or business_unit_id value on row(s): ${missingBusinessRows.join(', ')}. Use "RTB Lounge" or "RTB Beauty Lounge".`;
  }

  if (missingRequiredRows.length) {
    return `RTB OS sync stopped. week_start, week_end, and staff_name are required on row(s): ${missingRequiredRows.join(', ')}.`;
  }

  return '';
}

function normalizeHeader_(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeCell_(value, timeZone) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, timeZone, 'yyyy-MM-dd');
  }

  return value;
}

function normalizeDate_(value, timeZone) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, timeZone, 'yyyy-MM-dd');
  }

  return String(value || '').trim();
}

function normalizeMoney_(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  const parsed = Number(
    String(value || '')
      .replace(/[^\d.-]/g, '')
      .trim(),
  );

  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizePercent_(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value <= 1 ? value * 100 : value;
  }

  const parsed = Number(
    String(value || '')
      .replace(/[^\d.-]/g, '')
      .trim(),
  );

  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeStaffKey_(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function tierFromRate_(rate) {
  if (rate >= 70) return 'elite';
  if (rate >= 65) return 'growth';
  if (rate >= 60) return 'standard';
  if (rate >= 55) return 'performance_review';
  if (rate >= 50) return 'probation';
  return '';
}

function paystubStatusFromPayrollStatus_(status) {
  const text = String(status || '').trim().toLowerCase();
  if (!text) return 'sent';
  if (text.includes('pending')) return 'pending';
  if (text.includes('not on payroll') || text.includes('no pay') || text.includes('skipped')) {
    return 'skipped';
  }
  if (text.includes('failed')) return 'failed';
  return 'sent';
}

function formatWeekLabel_(weekStart, weekEnd, timeZone) {
  const start = weekStart instanceof Date ? weekStart : new Date(weekStart);
  const end = weekEnd instanceof Date ? weekEnd : new Date(weekEnd);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${weekStart} - ${weekEnd}`;
  }

  return `${Utilities.formatDate(start, timeZone, 'MMM d')} - ${Utilities.formatDate(end, timeZone, 'MMM d, yyyy')}`;
}

function removeAutomaticRtbOsPayrollSync_() {
  let removed = false;
  ScriptApp.getProjectTriggers().forEach((trigger) => {
    if (trigger.getHandlerFunction() === 'syncToRtbOsAutomatic') {
      ScriptApp.deleteTrigger(trigger);
      removed = true;
    }
  });
  return removed;
}

function showMessage_(message, showAlerts) {
  if (showAlerts === false) {
    console.log(message);
    return;
  }

  SpreadsheetApp.getUi().alert(message);
}
