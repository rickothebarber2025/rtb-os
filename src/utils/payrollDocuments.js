import { formatCurrency, formatDate, formatPercent } from './formatters';

function slug(value) {
  return String(value || 'rtb-payroll')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function payrollFileName(run, suffix) {
  return `${slug(run.week_label || run.week_start || 'payroll')}-${suffix}`;
}

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadBlob(content, type, fileName) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function drawDocumentHeader(doc, title, businessName, weekLabel) {
  doc.setFillColor('#08090d');
  doc.rect(0, 0, 612, 88, 'F');
  doc.setTextColor('#f1c768');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text(title, 38, 42);
  doc.setTextColor('#f8fafc');
  doc.setFontSize(10);
  doc.text(`${businessName} | ${weekLabel}`, 38, 62);
}

function drawSummary(doc, run, startY = 112) {
  const values = [
    ['Total net sales', formatCurrency(run.total_net_sales)],
    ['Staff payout', formatCurrency(run.total_staff_payout)],
    ['Deductions', formatCurrency(run.total_deductions)],
    ['RTB net', formatCurrency(run.rtb_net)],
  ];

  values.forEach(([label, value], index) => {
    const x = 38 + index * 138;
    doc.setTextColor('#6b7280');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(label.toUpperCase(), x, startY);
    doc.setTextColor('#111827');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(value, x, startY + 20);
  });
}

export function downloadPayrollRunCsv(run, businessUnit) {
  const entries = run.payroll_entries || [];
  const rows = [
    [
      'Business',
      'Week',
      'Status',
      'Staff',
      'Role',
      'Tier',
      'Net sales',
      'Tips',
      'Base rate',
      'Applied rate',
      'Deduction',
      'Take home',
      'Adjusted',
      'Notes',
    ],
    ...entries.map((entry) => [
      businessUnit?.name || '',
      run.week_label || '',
      run.status || 'draft',
      entry.staff_name_snapshot || '',
      entry.role_snapshot || '',
      entry.tier_snapshot || '',
      Number(entry.net_sales || 0).toFixed(2),
      Number(entry.tips || 0).toFixed(2),
      Number(entry.base_commission_rate || 0).toFixed(2),
      Number(entry.applied_commission_rate || 0).toFixed(2),
      Number(entry.deduction || 0).toFixed(2),
      Number(entry.take_home || 0).toFixed(2),
      entry.adjusted ? 'Yes' : 'No',
      entry.notes || '',
    ]),
  ];

  downloadBlob(
    rows.map((row) => row.map(csvCell).join(',')).join('\n'),
    'text/csv;charset=utf-8',
    payrollFileName(run, 'payroll.csv'),
  );
}

export async function downloadPayrollRunPdf(run, businessUnit) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ format: 'letter', unit: 'pt' });
  const businessName = businessUnit?.name || 'RTB';
  const entries = run.payroll_entries || [];

  drawDocumentHeader(doc, 'Payroll Summary', businessName, run.week_label || 'Payroll run');
  drawSummary(doc, run);

  let y = 174;
  doc.setFillColor('#f3f4f6');
  doc.rect(34, y - 17, 544, 24, 'F');
  doc.setTextColor('#374151');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('STAFF', 42, y);
  doc.text('SALES', 250, y);
  doc.text('RATE', 330, y);
  doc.text('DEDUCTION', 390, y);
  doc.text('TAKE HOME', 478, y);
  y += 26;

  for (const entry of entries) {
    if (y > 742) {
      doc.addPage();
      drawDocumentHeader(doc, 'Payroll Summary', businessName, run.week_label || 'Payroll run');
      y = 112;
    }

    doc.setTextColor('#111827');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(entry.staff_name_snapshot || 'Staff', 42, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor('#6b7280');
    doc.setFontSize(7);
    doc.text(`${entry.role_snapshot || 'Staff'} | ${entry.tier_snapshot || 'standard'}`, 42, y + 11);

    doc.setTextColor('#111827');
    doc.setFontSize(9);
    doc.text(formatCurrency(entry.net_sales), 250, y);
    doc.text(formatPercent(entry.applied_commission_rate), 330, y);
    doc.text(formatCurrency(entry.deduction), 390, y);
    doc.setFont('helvetica', 'bold');
    doc.text(formatCurrency(entry.take_home), 478, y);

    doc.setDrawColor('#e5e7eb');
    doc.line(38, y + 19, 574, y + 19);
    y += 36;
  }

  doc.save(`${payrollFileName(run, 'payroll')}.pdf`);
}

export async function downloadPaystubPdf(run, entry, businessUnit) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ format: 'letter', unit: 'pt' });
  const businessName = businessUnit?.name || 'RTB';
  const title = run.status === 'locked' ? 'Pay Statement' : 'Draft Pay Statement';

  drawDocumentHeader(doc, title, businessName, run.week_label || 'Payroll run');

  doc.setTextColor('#111827');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text(entry.staff_name_snapshot || 'Staff member', 38, 134);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor('#6b7280');
  doc.text(`${entry.role_snapshot || 'Staff'} | ${entry.tier_snapshot || 'standard'}`, 38, 152);

  const rows = [
    ['Period start', formatDate(run.week_start)],
    ['Period end', formatDate(run.week_end)],
    ['Net sales', formatCurrency(entry.net_sales)],
    ['Tips', formatCurrency(entry.tips)],
    ['Base commission', formatPercent(entry.base_commission_rate)],
    ['Applied commission', formatPercent(entry.applied_commission_rate)],
    ['RTB deduction', formatCurrency(entry.deduction)],
    ['Take home', formatCurrency(entry.take_home)],
  ];

  let y = 198;
  rows.forEach(([label, value], index) => {
    doc.setFillColor(index % 2 === 0 ? '#f9fafb' : '#ffffff');
    doc.rect(38, y - 18, 536, 34, 'F');
    doc.setTextColor('#6b7280');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(label, 50, y + 2);
    doc.setTextColor('#111827');
    doc.setFont('helvetica', 'bold');
    doc.text(value, 562, y + 2, { align: 'right' });
    y += 34;
  });

  if (entry.adjusted) {
    doc.setFillColor('#fff7ed');
    doc.rect(38, y + 10, 536, 48, 'F');
    doc.setTextColor('#9a3412');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(
      entry.fixed_rate_snapshot
        ? 'Fixed commission lowered by 5 points because net sales were below $500.'
        : `Commission adjusted to ${formatPercent(entry.applied_commission_rate)} because net sales were below $500.`,
      50,
      y + 38,
    );
  }

  if (entry.notes) {
    doc.setTextColor('#6b7280');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Notes: ${entry.notes}`, 38, y + 88, { maxWidth: 536 });
  }

  doc.setTextColor('#9ca3af');
  doc.setFontSize(8);
  doc.text('Generated by RTB OS', 38, 750);
  doc.save(`${payrollFileName(run, slug(entry.staff_name_snapshot || 'staff'))}.pdf`);
}
