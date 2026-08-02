import Papa from 'papaparse';
import { roundMoney, toMoneyNumber } from './payroll.js';

// Retail products from the Square Item Library -- sold at checkout but not
// staff-performed services, so their revenue should never count toward
// staff commission. Ported from the standalone rtb-payroll.html tool,
// which this import replaces.
const PRODUCT_NAMES = [
  'beard oil',
  'l3vel3 5 in 1 hair clipper spray',
  'l3vel3 forming cream styling cream for men',
  'styling powder',
  'leave in conditioner',
  'hair sponge',
  'durags (velvet)',
  'durags (silk)',
  'durags',
  'hair brush',
  'olive oil spray',
  'hair pick',
  'face mask',
];

// Square's own "Staff Name" field uses full legal/booking names that don't
// always match the nicknames staff are recorded under in RTB OS (confirmed
// real staff records: "Ricko" in the app vs "Ricardo Joseph" in Square,
// "Roshi" vs "Rsean Mathurin", etc.) -- these are the exact mappings the
// standalone tool already used successfully, kept as a starting point.
// Anything not covered here falls through to algorithmic matching, and
// anything that still doesn't match goes to manual review rather than
// being silently dropped or misattributed.
const SQUARE_NAME_ALIASES = {
  'daniel ndayishiruye': 'daniel',
  'darryl achy': 'darryl',
  'leyla garba': 'leyla',
  'ricardo joseph': 'ricko',
  'ronia indagiye': 'ronia',
  'rsean mathurin': 'roshi',
  'sara leguizamon': 'sara',
  'steph bell': 'steph',
  'wavyboy gatoni': 'josh',
};

function isProductLabel(label) {
  const low = label.toLowerCase();
  return PRODUCT_NAMES.some((product) => low.startsWith(product) || low.includes(product));
}

const CAT_KEYWORDS = [
  ['Nails', ['acrylic', 'manicure', 'pedicure', 'gel x', 'biab', 'nail']],
  ['Lashes', ['lash', 'foreign refill', 'mini fill']],
  ['Hair & Locs', ['loc', 'braid', 'cornrow', 'twist', 'blow dry', 'blowout']],
  ['Barbering', ['cut', 'beard', 'line up', 'lineup', 'fade', 'student', 'senior', 'kid']],
  ['Custom / Other', ['custom amount']],
];

export function categorizeServiceLabel(label) {
  if (isProductLabel(label)) return 'Retail Product';
  const low = label.toLowerCase();
  const match = CAT_KEYWORDS.find(([, keywords]) => keywords.some((keyword) => low.includes(keyword)));
  return match ? match[0] : 'Other';
}

// A single Square line item's description can bundle several services
// (e.g. a combo ticket), each written as "Label (Variation) - details".
// Retail products tacked onto the end of a combo often have no " - "
// description of their own, so the trailing-item pattern catches those too.
function splitServiceLabels(description) {
  if (!description || !description.trim()) return [];

  const labelPattern = /([^,]+?\((?:[^()]|\([^()]*\))*\))\s-\s/g;
  const trailingPattern = /,\s*([^,()]+\((?:[^()]|\([^()]*\))*\))\s*$/;
  const labels = [];
  let match;

  while ((match = labelPattern.exec(description)) !== null) {
    labels.push(match[1].trim());
  }

  const trailingMatch = description.match(trailingPattern);
  if (trailingMatch) {
    const candidate = trailingMatch[1].trim();
    if (labels.length === 0 || labels[labels.length - 1] !== candidate) {
      labels.push(candidate);
    }
  }

  if (labels.length === 0) {
    const trimmed = description.trim();
    if (trimmed.toLowerCase() === 'custom amount') labels.push('Custom Amount');
    else if (isProductLabel(trimmed)) labels.push(trimmed);
  }

  return labels;
}

function findColumnKey(fields, candidates) {
  const lowered = fields.map((field) => ({ low: field.trim().toLowerCase(), original: field }));
  for (const candidate of candidates) {
    const exact = lowered.find((field) => field.low === candidate);
    if (exact) return exact.original;
  }
  for (const candidate of candidates) {
    const partial = lowered.find((field) => field.low.includes(candidate));
    if (partial) return partial.original;
  }
  return null;
}

// Shared aggregation core used by both parseSquarePayrollCsv (all rows in
// one bucket) and parseSquarePayrollCsvByLocation (one bucket per Location
// value) -- extracted so both paths run the exact same tested logic rather
// than risk two copies drifting apart.
function aggregateRows(rows, { staffKey, revenueKey, tipKey, dateKey, descriptionKey }) {
  const bySquareName = {};
  let transactionCount = 0;
  let totalRevenueGross = 0;
  let totalTips = 0;
  let totalProductRevenue = 0;
  let weekMin = null;
  let weekMax = null;

  rows.forEach((row) => {
    const name = (staffKey ? row[staffKey] : '').trim();
    if (!name) return;

    const revenue = revenueKey ? toMoneyNumber(String(row[revenueKey] || '').replace(/[^0-9.-]/g, '')) : 0;
    const tips = tipKey ? toMoneyNumber(String(row[tipKey] || '').replace(/[^0-9.-]/g, '')) : 0;

    if (!bySquareName[name]) {
      bySquareName[name] = { netSales: 0, productRevenue: 0, tips: 0, txnCount: 0 };
    }
    bySquareName[name].tips = roundMoney(bySquareName[name].tips + tips);
    bySquareName[name].txnCount += 1;
    totalTips = roundMoney(totalTips + tips);
    totalRevenueGross = roundMoney(totalRevenueGross + revenue);
    transactionCount += 1;

    if (dateKey && row[dateKey]) {
      const value = row[dateKey];
      if (!weekMin || value < weekMin) weekMin = value;
      if (!weekMax || value > weekMax) weekMax = value;
    }

    const description = descriptionKey ? row[descriptionKey] : '';
    const labels = splitServiceLabels(description);

    if (labels.length) {
      const share = roundMoney(revenue / labels.length);
      labels.forEach((label) => {
        const category = categorizeServiceLabel(label);
        if (category === 'Retail Product') {
          bySquareName[name].productRevenue = roundMoney(bySquareName[name].productRevenue + share);
          totalProductRevenue = roundMoney(totalProductRevenue + share);
        } else {
          bySquareName[name].netSales = roundMoney(bySquareName[name].netSales + share);
        }
      });
    } else {
      // No parseable description -- can't identify it as a retail product,
      // so treat it as commissionable service revenue rather than drop it.
      bySquareName[name].netSales = roundMoney(bySquareName[name].netSales + revenue);
    }
  });

  return {
    bySquareName,
    meta: {
      totalProductRevenue,
      totalRevenueGross,
      totalRevenueNet: roundMoney(totalRevenueGross - totalProductRevenue),
      totalTips,
      transactionCount,
      weekMax,
      weekMin,
    },
  };
}

function findCsvKeys(fields) {
  return {
    dateKey: findColumnKey(fields, ['date']),
    descriptionKey: findColumnKey(fields, ['description']),
    locationKey: findColumnKey(fields, ['location']),
    revenueKey: findColumnKey(fields, ['net sales', 'revenue']),
    staffKey: findColumnKey(fields, ['staff name', 'staff']),
    tipKey: findColumnKey(fields, ['tip']),
  };
}

// Parses a raw Square transaction export (one row per payment, not a
// pre-aggregated payroll sheet) into per-Square-staff-name totals, with
// retail product revenue split out separately so it never counts toward
// commission. This is genuinely new: the existing google-sheets-payroll-sync
// function expects already-computed payroll numbers, not raw transactions.
export function parseSquarePayrollCsv(csvText) {
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  const keys = findCsvKeys(parsed.meta.fields || []);
  return aggregateRows(parsed.data || [], keys);
}

// Square's own export already tags every transaction with a "Location"
// column (confirmed real values: "RTB Lounge", "RTB Beauty Lounge", exact
// matches to the business_units.name of each real business) -- so one CSV
// covering both businesses' sales can be split into two independent
// aggregations without needing two separate exports. Rows with a location
// value that doesn't match a known business go under the empty-string key
// so callers can flag them rather than silently drop the revenue.
export function parseSquarePayrollCsvByLocation(csvText) {
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  const fields = parsed.meta.fields || [];
  const keys = findCsvKeys(fields);
  const rowsByLocation = {};

  (parsed.data || []).forEach((row) => {
    const location = (keys.locationKey ? row[keys.locationKey] : '').trim();
    if (!rowsByLocation[location]) rowsByLocation[location] = [];
    rowsByLocation[location].push(row);
  });

  const byLocation = {};
  Object.entries(rowsByLocation).forEach(([location, rows]) => {
    byLocation[location] = aggregateRows(rows, keys);
  });

  return byLocation;
}

function normalizeName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[._|/-]+/g, ' ')
    .replace(/[^a-z0-9\s@]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchKey(value) {
  return normalizeName(value).replace(/[^a-z0-9]+/g, '');
}

function firstWord(value) {
  return normalizeName(value).split(/\s+/)[0] || '';
}

function addStaffKeys(keys, member) {
  [
    member.full_name,
    member.preferred_name,
    member.social_handle,
    member.instagram_handle,
    member.pos_profile,
    member.booking_platform_profile,
    member.square_team_member_id,
    member.source_staff_id,
  ].forEach((value) => {
    const key = matchKey(value);
    if (key) keys.add(key);
  });

  if (member.email) {
    const email = normalizeName(member.email);
    const emailName = email.split('@')[0];
    [email, emailName].forEach((value) => {
      const key = matchKey(value);
      if (key) keys.add(key);
    });
  }

  [
    member.alias,
    member.aliases,
    member.staff_aliases,
    member.source_identities,
    member.identities,
  ].forEach((value) => {
    if (!value) return;
    const values = Array.isArray(value) ? value : [value];
    values.forEach((item) => {
      if (!item) return;
      if (typeof item === 'string') {
        const key = matchKey(item);
        if (key) keys.add(key);
        return;
      }

      [
        item.alias,
        item.alias_key,
        item.source_display_name,
        item.preferred_name,
        item.source_email,
        item.source_staff_id,
      ].forEach((nested) => {
        const key = matchKey(nested);
        if (key) keys.add(key);
      });
    });
  });
}

function uniqueMatch(matches) {
  const byId = new Map();
  matches.filter(Boolean).forEach((member) => {
    if (member?.id) byId.set(member.id, member);
  });
  return byId.size === 1 ? [...byId.values()][0] : null;
}

function findByMatchKey(staffList, key) {
  if (!key) return null;
  return uniqueMatch(
    (staffList || []).filter((member) => {
      const keys = new Set();
      addStaffKeys(keys, member);
      return keys.has(key);
    }),
  );
}

// Tries, in order: known Square aliases, exact normalized staff identifiers
// (full/preferred name, POS profile, email, social handle, saved aliases),
// then a cautious first-word fallback. Ambiguous matches stay in review
// instead of being silently assigned to the wrong staff member.
export function matchSquareNameToStaff(squareName, staffList) {
  const normalized = normalizeName(squareName);
  const squareKey = matchKey(squareName);
  const aliasTarget = SQUARE_NAME_ALIASES[normalized] || SQUARE_NAME_ALIASES[squareKey];

  if (aliasTarget) {
    const aliasMatch = findByMatchKey(staffList, matchKey(aliasTarget));
    if (aliasMatch) return aliasMatch;
  }

  const exactMatch = findByMatchKey(staffList, squareKey);
  if (exactMatch) return exactMatch;

  const squareFirst = firstWord(squareName);
  const firstWordMatch = uniqueMatch(
    (staffList || []).filter((member) => {
      const candidateNames = [
        member.full_name,
        member.preferred_name,
        member.pos_profile,
        member.booking_platform_profile,
      ];
      return candidateNames.some((name) => {
        const staffFirst = firstWord(name);
        return staffFirst && squareFirst && (staffFirst === squareFirst || squareFirst.startsWith(staffFirst) || staffFirst.startsWith(squareFirst));
      });
    }),
  );

  return firstWordMatch || null;
}
