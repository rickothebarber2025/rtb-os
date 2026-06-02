import { jsPDF } from 'jspdf';
import { formatCurrency, formatNumber } from './formatters';

function slug(value) {
  return String(value || 'certificate')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function staffTitle(businessUnitName) {
  return businessUnitName === 'RTB Beauty Lounge' ? 'Nail Tech of the Month' : 'Barber of the Month';
}

function drawDiagonalBand(doc, x, y, width, height, color) {
  doc.setFillColor(color);
  doc.triangle(x, y, x + width, y, x + width - height, y + height, 'F');
}

function drawSeal(doc, x, y, businessUnitName) {
  doc.setFillColor('#08090d');
  doc.circle(x, y, 58, 'F');
  doc.setDrawColor('#d6a84f');
  doc.setLineWidth(2);
  doc.circle(x, y, 54, 'S');
  doc.circle(x, y, 46, 'S');

  doc.setTextColor('#d6a84f');
  doc.setFont('times', 'bold');
  doc.setFontSize(36);
  doc.text('RTB', x, y - 8, { align: 'center' });

  doc.setTextColor('#f8fafc');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(businessUnitName === 'RTB Beauty Lounge' ? 'BEAUTY LOUNGE' : 'LOUNGE', x, y + 22, {
    align: 'center',
  });

  doc.setTextColor('#d6a84f');
  doc.setFontSize(8);
  doc.text('NAILS | LASHES | BROWS', x, y + 38, { align: 'center' });
}

export function downloadStaffOfMonthCertificate({
  businessUnit,
  generatedAt = new Date(),
  performer,
}) {
  if (!performer) {
    throw new Error('No staff performance record is available for a certificate.');
  }

  const businessName = businessUnit?.name || performer.business_unit || 'RTB Lounge';
  const doc = new jsPDF({ format: 'letter', orientation: 'landscape', unit: 'pt' });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const awardTitle = staffTitle(businessName);
  const month = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  }).format(generatedAt);

  doc.setFillColor('#f8fafc');
  doc.rect(0, 0, width, height, 'F');

  doc.setFillColor('#f1f5f9');
  for (let x = -100; x < width; x += 170) {
    doc.rect(x, height - 150, 160, 200, 'F');
  }

  drawDiagonalBand(doc, width - 220, 0, 220, 220, '#14a8d8');
  drawDiagonalBand(doc, width - 150, 0, 220, 220, '#1d4f91');
  drawDiagonalBand(doc, width - 80, 0, 220, 220, '#2c286a');

  doc.setDrawColor('#d6a84f');
  doc.setLineWidth(4);
  doc.rect(34, 34, width - 68, height - 68, 'S');
  doc.setLineWidth(1);
  doc.rect(46, 46, width - 92, height - 92, 'S');

  drawSeal(doc, width - 150, 150, businessName);

  doc.setTextColor('#1f2937');
  doc.setFont('times', 'normal');
  doc.setFontSize(60);
  doc.text('CERTIFICATE', 70, 145);

  doc.setTextColor('#1e6aa8');
  doc.setFont('times', 'bold');
  doc.setFontSize(30);
  doc.text('OF ACHIEVEMENT', 74, 188);

  doc.setTextColor('#1f2937');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('THIS AWARD IS PROUDLY PRESENTED TO', 78, 262);

  doc.setTextColor('#1e6aa8');
  doc.setFont('times', 'italic');
  doc.setFontSize(54);
  doc.text(performer.full_name || 'Top Performer', 78, 340);

  doc.setTextColor('#1f2937');
  doc.setFont('times', 'normal');
  doc.setFontSize(18);
  doc.text(
    `In recognition of outstanding performance, dedication, and excellence as ${awardTitle} at ${businessName}.`,
    78,
    395,
    { maxWidth: 610 },
  );

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor('#1e6aa8');
  doc.text(`${month} Performance`, 78, 452);

  doc.setTextColor('#1f2937');
  doc.setFont('helvetica', 'normal');
  doc.text(`Total sales: ${formatCurrency(performer.total_net_sales)}`, 78, 476);
  doc.text(`Average week: ${formatCurrency(performer.avg_weekly_net)}`, 78, 496);
  doc.text(`Weeks recorded: ${formatNumber(performer.weeks_recorded)}`, 78, 516);

  doc.setDrawColor('#1f2937');
  doc.line(120, height - 105, 310, height - 105);
  doc.line(width - 330, height - 105, width - 140, height - 105);

  doc.setFont('times', 'italic');
  doc.setFontSize(18);
  doc.text('Gwen Bouchard', 215, height - 112, { align: 'center' });
  doc.text('Ricardo Joseph', width - 235, height - 112, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('RTB LOUNGE', 215, height - 82, { align: 'center' });
  doc.text('RTB LOUNGE', width - 235, height - 82, { align: 'center' });

  doc.setTextColor('#1e6aa8');
  doc.text('SALON MANAGER', 215, height - 65, { align: 'center' });
  doc.text('OWNER', width - 235, height - 65, { align: 'center' });

  doc.save(`${slug(businessName)}-${slug(performer.full_name)}-${slug(month)}-certificate.pdf`);
}
