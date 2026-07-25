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

// Parses a raw Square transaction export (one row per payment, not a
// pre-aggregated payroll sheet) into per-Square-staff-name totals, with
// retail product revenue split out separately so it never counts toward
// commission. This is genuinely new: the existing google-sheets-payroll-sync
// function expects already-computed payroll numbers, not raw transactions.
export function parseSquarePayrollCsv(csvText) {
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  const fields = parsed.meta.fields || [];
  const staffKey = findColumnKey(fields, ['staff name', 'staff']);
  const revenueKey = findColumnKey(fields, ['net sales', 'revenue']);
  const tipKey = findColumnKey(fields, ['tip']);
  const dateKey = findColumnKey(fields, ['date']);
  const descriptionKey = findColumnKey(fields, ['description']);

  const bySquareName = {};
  let transactionCount = 0;
  let totalRevenueGross = 0;
  let totalTips = 0;
  let totalProductRevenue = 0;
  let weekMin = null;
  let weekMax = null;

  (parsed.data || []).forEach((row) => {
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

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

function firstWord(value) {
  return normalizeName(value).split(/\s+/)[0] || '';
}

// Tries, in order: the known alias table, an exact full-name match, then a
// first-word match in either direction. Anything left over is genuinely
// ambiguous and should go to manual review rather than guess -- silently
// misattributing one staff member's revenue to another would be a real
// payroll error, not just a cosmetic one.
export function matchSquareNameToStaff(squareName, staffList) {
  const normalized = normalizeName(squareName);
  const aliasTarget = SQUARE_NAME_ALIASES[normalized];

  if (aliasTarget) {
    const aliasMatch = (staffList || []).find((member) => normalizeName(member.full_name) === aliasTarget);
    if (aliasMatch) return aliasMatch;
  }

  const exactMatch = (staffList || []).find((member) => normalizeName(member.full_name) === normalized);
  if (exactMatch) return exactMatch;

  const squareFirst = firstWord(squareName);
  const firstWordMatch = (staffList || []).find((member) => {
    const staffFirst = firstWord(member.full_name);
    return staffFirst && squareFirst && (staffFirst === squareFirst || squareFirst.startsWith(staffFirst) || staffFirst.startsWith(squareFirst));
  });

  return firstWordMatch || null;
}
