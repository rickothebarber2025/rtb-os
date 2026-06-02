import { jsPDF } from 'jspdf';
import { formatCurrency, formatNumber } from './formatters';

const RTB_LOGO_URL = '/assets/rtb-logo.jpg';

async function imageToDataUrl(url) {
  const response = await fetch(url);
  if (!response.ok) return null;

  const blob = await response.blob();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

function slug(value) {
  return String(value || 'certificate')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function staffTitle(businessUnitName) {
  return businessUnitName === 'RTB Beauty Lounge' ? 'Nail Tech of the Month' : 'Barber of the Month';
}

function experienceLine(businessUnitName, awardTitle) {
  const unitLabel = businessUnitName === 'RTB Beauty Lounge' ? 'RTB Beauty Lounge' : 'RTB Lounge';
  return `In recognition of outstanding performance, dedication, and contribution to the ${unitLabel} experience as ${awardTitle}.`;
}

function drawDiagonalBand(doc, x, y, width, height, color) {
  doc.setFillColor(color);
  doc.triangle(x, y, x + width, y, x + width - height, y + height, 'F');
}

function drawSeal(doc, x, y, businessUnitName, logoDataUrl) {
  doc.setFillColor('#08090d');
  doc.circle(x, y, 58, 'F');
  doc.setDrawColor('#d6a84f');
  doc.setLineWidth(2);
  doc.circle(x, y, 54, 'S');
  doc.circle(x, y, 46, 'S');

  if (logoDataUrl) {
    doc.addImage(logoDataUrl, 'JPEG', x - 46, y - 46, 92, 92);
    return;
  }

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

export async function downloadStaffOfMonthCertificate({
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
  const logoDataUrl = await imageToDataUrl(RTB_LOGO_URL);

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

  drawSeal(doc, width - 150, 150, businessName, logoDataUrl);

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
  doc.text(experienceLine(businessName, awardTitle), 78, 395, { maxWidth: 610 });

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
  doc.line(width - 360, height - 105, width - 120, height - 105);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('RTB LOUNGE', width - 240, height - 82, { align: 'center' });

  doc.setTextColor('#1e6aa8');
  doc.text('OWNER SIGNATURE', width - 240, height - 65, { align: 'center' });

  doc.save(`${slug(businessName)}-${slug(performer.full_name)}-${slug(month)}-certificate.pdf`);
}
