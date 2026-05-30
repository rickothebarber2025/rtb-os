export const currency = new Intl.NumberFormat('en-US', {
  currency: 'USD',
  maximumFractionDigits: 2,
  style: 'currency',
});

export const compactCurrency = new Intl.NumberFormat('en-US', {
  currency: 'USD',
  maximumFractionDigits: 0,
  notation: 'compact',
  style: 'currency',
});

export function formatCurrency(value) {
  return currency.format(Number(value || 0));
}

export function formatCompactCurrency(value) {
  return compactCurrency.format(Number(value || 0));
}

export function formatPercent(value) {
  return `${Number(value || 0).toFixed(0)}%`;
}

export function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(Number(value || 0));
}

export function formatDate(value) {
  if (!value) return 'Not set';
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}
