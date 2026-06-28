export const BOOKSY_IMPORT_MAPPINGS_KEY = 'booksy_import_mappings';

export function normalizeImportName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function uniqueNames(values) {
  const seen = new Map();

  values.forEach((value) => {
    const name = String(value || '').trim();
    const key = normalizeImportName(name);
    if (!name || !key || seen.has(key)) return;
    seen.set(key, name);
  });

  return [...seen.values()];
}

function normalizeMappingRecord(record) {
  if (!record || typeof record !== 'object') return {};
  return record;
}

export function normalizeImportMappings(value) {
  return {
    services: normalizeMappingRecord(value?.services),
    staff: normalizeMappingRecord(value?.staff),
    updatedAt: value?.updatedAt || null,
    version: 1,
  };
}

function collectStaffNames(dashboard) {
  return uniqueNames([
    ...getRows(dashboard?.staff).map((row) => row.name),
    ...getRows(dashboard?.recentTransactions).map((row) => row.staffer),
    ...getRows(dashboard?.upcomingAppointments).map((row) => row.staffer),
  ]).filter((name) => !/^unknown staff$/i.test(name));
}

function collectServiceNames(dashboard) {
  return uniqueNames([
    ...getRows(dashboard?.services).map((row) => row.name || row.fullName),
    ...getRows(dashboard?.recentTransactions).map((row) => row.service),
    ...getRows(dashboard?.upcomingAppointments).map((row) => row.service),
  ]).filter((name) => !/^unknown service$/i.test(name));
}

function getRows(rows) {
  return Array.isArray(rows) ? rows : [];
}

function buildStaffLookup(staff) {
  const lookup = new Map();

  getRows(staff)
    .filter((member) => member?.active !== false)
    .forEach((member) => {
      const key = normalizeImportName(member.full_name);
      if (key && !lookup.has(key)) lookup.set(key, member);
    });

  return lookup;
}

function buildServiceLookup(existingServices) {
  const lookup = new Map();

  uniqueNames(existingServices).forEach((service) => {
    const key = normalizeImportName(service);
    if (key && !lookup.has(key)) lookup.set(key, service);
  });

  return lookup;
}

function staffChoiceFromAlias(alias, staffById, staffByName) {
  if (!alias) return null;
  if (alias.action === 'ignore') {
    return {
      action: 'ignore',
      matchType: 'remembered',
      remember: true,
      sourceName: alias.sourceName,
    };
  }

  const target = staffById.get(alias.targetId) || staffByName.get(normalizeImportName(alias.targetName));
  if (!target) return null;

  return {
    action: 'match',
    matchType: 'remembered',
    remember: true,
    sourceName: alias.sourceName,
    targetId: target.id,
    targetName: target.full_name,
  };
}

function serviceChoiceFromAlias(alias, serviceLookup) {
  if (!alias) return null;
  if (alias.action === 'ignore') {
    return {
      action: 'ignore',
      matchType: 'remembered',
      remember: true,
      sourceName: alias.sourceName,
    };
  }

  const targetName =
    serviceLookup.get(normalizeImportName(alias.targetName)) || alias.targetName || alias.sourceName;
  if (!targetName) return null;

  return {
    action: alias.action === 'create' ? 'create' : 'match',
    matchType: 'remembered',
    remember: true,
    sourceName: alias.sourceName,
    targetName,
  };
}

export function createBooksyImportReview({ dashboard, existingDashboard, mappings, staff }) {
  const normalizedMappings = normalizeImportMappings(mappings);
  const staffByName = buildStaffLookup(staff);
  const staffById = new Map(getRows(staff).map((member) => [member.id, member]));
  const serviceLookup = buildServiceLookup([
    ...getRows(existingDashboard?.services).map((service) => service.name || service.fullName),
    ...Object.values(normalizedMappings.services).map((mapping) => mapping?.targetName),
  ]);

  const staffReview = collectStaffNames(dashboard).map((sourceName) => {
    const key = normalizeImportName(sourceName);
    const remembered = staffChoiceFromAlias(normalizedMappings.staff[key], staffById, staffByName);
    if (remembered) return { ...remembered, key, sourceName };

    const exactMatch = staffByName.get(key);
    if (exactMatch) {
      return {
        action: 'match',
        key,
        matchType: 'exact',
        remember: false,
        sourceName,
        targetId: exactMatch.id,
        targetName: exactMatch.full_name,
      };
    }

    return {
      action: 'create',
      key,
      matchType: 'pending',
      remember: true,
      sourceName,
      targetId: '',
      targetName: sourceName,
    };
  });

  const serviceReview = collectServiceNames(dashboard).map((sourceName) => {
    const key = normalizeImportName(sourceName);
    const remembered = serviceChoiceFromAlias(normalizedMappings.services[key], serviceLookup);
    if (remembered) return { ...remembered, key, sourceName };

    const exactMatch = serviceLookup.get(key);
    if (exactMatch) {
      return {
        action: 'match',
        key,
        matchType: 'exact',
        remember: false,
        sourceName,
        targetName: exactMatch,
      };
    }

    return {
      action: 'create',
      key,
      matchType: 'pending',
      remember: true,
      sourceName,
      targetName: sourceName,
    };
  });

  return {
    dashboard,
    mappings: normalizedMappings,
    serviceReview,
    staffReview,
  };
}

function targetForChoice(choice, fallback) {
  if (!choice || choice.action === 'ignore') return fallback;
  return choice.targetName || fallback;
}

function mergeNumber(current, next, field) {
  return Number(current?.[field] || 0) + Number(next?.[field] || 0);
}

function mergeStaffRows(rows, choices) {
  const merged = new Map();

  getRows(rows).forEach((row) => {
    const choice = choices.get(normalizeImportName(row.name));
    if (choice?.action === 'ignore') return;
    const name = targetForChoice(choice, row.name);
    const current = merged.get(name) || {
      ...row,
      appointments: 0,
      mayAppointments: 0,
      name,
      revenue: 0,
    };

    current.appointments = mergeNumber(current, row, 'appointments');
    current.mayAppointments = mergeNumber(current, row, 'mayAppointments');
    current.revenue = mergeNumber(current, row, 'revenue');
    merged.set(name, current);
  });

  return [...merged.values()]
    .map((row) => ({ ...row, revenue: Number(row.revenue.toFixed(2)) }))
    .sort((a, b) => b.revenue - a.revenue);
}

function mergeServiceRows(rows, choices) {
  const merged = new Map();

  getRows(rows).forEach((row) => {
    const choice = choices.get(normalizeImportName(row.name || row.fullName));
    if (choice?.action === 'ignore') return;
    const name = targetForChoice(choice, row.name || row.fullName);
    const current = merged.get(name) || {
      ...row,
      cancelled: 0,
      count: 0,
      fullName: name,
      name,
      revenue: 0,
    };

    current.cancelled = mergeNumber(current, row, 'cancelled');
    current.count = mergeNumber(current, row, 'count');
    current.revenue = mergeNumber(current, row, 'revenue');
    current.cancelRate = current.count ? Math.round((current.cancelled / current.count) * 100) : 0;
    merged.set(name, current);
  });

  return [...merged.values()]
    .map((row) => ({ ...row, revenue: Number(row.revenue.toFixed(2)) }))
    .sort((a, b) => b.revenue - a.revenue);
}

function mapAppointmentRows(rows, staffChoices, serviceChoices) {
  return getRows(rows).map((row) => {
    const staffChoice = staffChoices.get(normalizeImportName(row.staffer));
    const serviceChoice = serviceChoices.get(normalizeImportName(row.service));

    return {
      ...row,
      service: serviceChoice?.action === 'ignore'
        ? `Ignored: ${row.service}`
        : targetForChoice(serviceChoice, row.service),
      staffer: staffChoice?.action === 'ignore'
        ? `Ignored: ${row.staffer}`
        : targetForChoice(staffChoice, row.staffer),
    };
  });
}

export function applyBooksyImportReview(dashboard, staffReview, serviceReview) {
  const staffChoices = new Map(staffReview.map((choice) => [choice.key, choice]));
  const serviceChoices = new Map(serviceReview.map((choice) => [choice.key, choice]));

  return {
    ...dashboard,
    importReview: {
      reviewedAt: new Date().toISOString(),
      servicesIgnored: serviceReview.filter((choice) => choice.action === 'ignore').length,
      servicesMapped: serviceReview.filter((choice) => choice.action !== 'ignore').length,
      staffIgnored: staffReview.filter((choice) => choice.action === 'ignore').length,
      staffMapped: staffReview.filter((choice) => choice.action !== 'ignore').length,
    },
    recentTransactions: mapAppointmentRows(dashboard.recentTransactions, staffChoices, serviceChoices),
    services: mergeServiceRows(dashboard.services, serviceChoices),
    staff: mergeStaffRows(dashboard.staff, staffChoices),
    upcomingAppointments: mapAppointmentRows(dashboard.upcomingAppointments, staffChoices, serviceChoices),
  };
}

export function mergeRememberedImportMappings(existing, staffReview, serviceReview) {
  const now = new Date().toISOString();
  const next = normalizeImportMappings(existing);

  staffReview.forEach((choice) => {
    if (!choice.remember || choice.matchType === 'exact') return;
    next.staff[choice.key] = {
      action: choice.action,
      sourceName: choice.sourceName,
      targetId: choice.action === 'match' ? choice.targetId : null,
      targetName: choice.action === 'ignore' ? null : choice.targetName,
      updatedAt: now,
    };
  });

  serviceReview.forEach((choice) => {
    if (!choice.remember || choice.matchType === 'exact') return;
    next.services[choice.key] = {
      action: choice.action,
      sourceName: choice.sourceName,
      targetName: choice.action === 'ignore' ? null : choice.targetName,
      updatedAt: now,
    };
  });

  return {
    ...next,
    updatedAt: now,
  };
}
