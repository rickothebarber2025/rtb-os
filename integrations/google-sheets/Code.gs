const RTB_OS_EXPORT_SHEET = 'RTB_OS_EXPORT';
const RTB_SYNC_URL_PROPERTY = 'RTB_OS_SYNC_URL';
const RTB_SYNC_SECRET_PROPERTY = 'RTB_OS_SYNC_SECRET';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('RTB OS')
    .addItem('Sync to RTB OS', 'syncToRtbOs')
    .addSeparator()
    .addItem('Configure sync', 'configureRtbOsSync')
    .addToUi();
}

function configureRtbOsSync() {
  const ui = SpreadsheetApp.getUi();
  const properties = PropertiesService.getScriptProperties();
  const currentUrl = properties.getProperty(RTB_SYNC_URL_PROPERTY) || '';
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
  const ui = SpreadsheetApp.getUi();
  const properties = PropertiesService.getScriptProperties();
  const syncUrl = properties.getProperty(RTB_SYNC_URL_PROPERTY);
  const syncSecret = properties.getProperty(RTB_SYNC_SECRET_PROPERTY);

  if (!syncUrl || !syncSecret) {
    ui.alert('Open RTB OS > Configure sync before running the first sync.');
    return;
  }

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(RTB_OS_EXPORT_SHEET);

  if (!sheet) {
    ui.alert(`Sheet "${RTB_OS_EXPORT_SHEET}" was not found.`);
    return;
  }

  const rows = getExportRows_(sheet, spreadsheet.getSpreadsheetTimeZone());
  if (!rows.length) {
    ui.alert(`No data rows found in "${RTB_OS_EXPORT_SHEET}".`);
    return;
  }

  const validationError = validateExportRows_(rows);
  if (validationError) {
    ui.alert(validationError);
    return;
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
    ui.alert(
      body.message ||
        `Synced ${body.records_upserted || rows.length} payroll records to RTB OS.`,
    );
    return;
  }

  ui.alert(`RTB OS sync failed: ${body.error || `HTTP ${status}`}`);
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
