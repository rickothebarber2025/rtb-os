import { formatCurrency } from './formatters';

const RTB_LOGO_URL = '/assets/rtb-logo.jpg';
const CERT_COLORS = {
  brass: '#ffffff',
  brassDeep: '#4a5f72',
  cream: '#ffffff',
  faint: '#7b8e9e',
  ink: '#172836',
  line: '#2a3f52',
  muted: '#a3b4c2',
  paperPattern: '#eef1f4',
  panel: '#1e3243',
  panel2: '#24394b',
};

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

function experienceLine(businessUnitName) {
  const unitLabel = businessUnitName === 'RTB Beauty Lounge' ? 'RTB Beauty Lounge' : 'RTB Lounge';
  return `In recognition of outstanding performance, dedication, and contribution to the ${unitLabel} experience. Congratulations on being named Staff of the Month.`;
}

function drawDiagonalBand(doc, x, y, width, height, color) {
  doc.setFillColor(color);
  doc.triangle(x, y, x + width, y, x + width - height, y + height, 'F');
}

function drawSeal(doc, x, y, businessUnitName, logoDataUrl) {
  doc.setFillColor(CERT_COLORS.ink);
  doc.circle(x, y, 58, 'F');
  doc.setDrawColor(CERT_COLORS.brass);
  doc.setLineWidth(2);
  doc.circle(x, y, 54, 'S');
  doc.circle(x, y, 46, 'S');

  if (logoDataUrl) {
    doc.addImage(logoDataUrl, 'JPEG', x - 46, y - 46, 92, 92);
    return;
  }

  doc.setTextColor(CERT_COLORS.brass);
  doc.setFont('times', 'bold');
  doc.setFontSize(36);
  doc.text('RTB', x, y - 8, { align: 'center' });
  doc.setTextColor(CERT_COLORS.cream);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(businessUnitName === 'RTB Beauty Lounge' ? 'BEAUTY LOUNGE' : 'LOUNGE', x, y + 22, {
    align: 'center',
  });

  doc.setTextColor(CERT_COLORS.brass);
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

  const { jsPDF } = await import('jspdf');
  const businessName = businessUnit?.name || performer.business_unit || 'RTB Lounge';
  const doc = new jsPDF({ format: 'letter', orientation: 'landscape', unit: 'pt' });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const month = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  }).format(generatedAt);
  const logoDataUrl = await imageToDataUrl(RTB_LOGO_URL);

  doc.setFillColor(CERT_COLORS.cream);
  doc.rect(0, 0, width, height, 'F');

  doc.setFillColor(CERT_COLORS.paperPattern);
  for (let x = -100; x < width; x += 170) {
    doc.rect(x, height - 150, 160, 200, 'F');
  }

  drawDiagonalBand(doc, width - 220, 0, 220, 220, CERT_COLORS.brass);
  drawDiagonalBand(doc, width - 150, 0, 220, 220, CERT_COLORS.brassDeep);
  drawDiagonalBand(doc, width - 80, 0, 220, 220, CERT_COLORS.ink);

  doc.setDrawColor(CERT_COLORS.brass);
  doc.setLineWidth(4);
  doc.rect(34, 34, width - 68, height - 68, 'S');
  doc.setLineWidth(1);
  doc.rect(46, 46, width - 92, height - 92, 'S');

  drawSeal(doc, width - 150, 150, businessName, logoDataUrl);

  doc.setTextColor(CERT_COLORS.ink);
  doc.setFont('times', 'normal');
  doc.setFontSize(60);
  doc.text('CERTIFICATE', 70, 145);

  doc.setTextColor(CERT_COLORS.brassDeep);
  doc.setFont('times', 'bold');
  doc.setFontSize(30);
  doc.text('STAFF OF THE MONTH', 74, 188);

  doc.setTextColor(CERT_COLORS.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('THIS AWARD IS PROUDLY PRESENTED TO', 78, 262);

  doc.setTextColor(CERT_COLORS.brassDeep);
  doc.setFont('times', 'italic');
  doc.setFontSize(54);
  doc.text(performer.full_name || 'Top Performer', 78, 340);

  doc.setTextColor(CERT_COLORS.ink);
  doc.setFont('times', 'normal');
  doc.setFontSize(18);
  doc.text(experienceLine(businessName), 78, 395, { maxWidth: 610 });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(CERT_COLORS.brassDeep);
  doc.text(`${month} Staff of the Month`, 78, 452);

  doc.setTextColor(CERT_COLORS.ink);
  doc.setFont('helvetica', 'normal');
  doc.text(`Business: ${businessName}`, 78, 476);
  doc.text(`Top performance sales: ${formatCurrency(performer.total_net_sales)}`, 78, 496);
  doc.text(`Take-home earned: ${formatCurrency(performer.total_take_home)}`, 78, 516);

  doc.setDrawColor(CERT_COLORS.ink);
  doc.line(width - 360, height - 105, width - 120, height - 105);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('RTB LOUNGE', width - 240, height - 82, { align: 'center' });

  doc.setTextColor(CERT_COLORS.brassDeep);
  doc.text('OWNER SIGNATURE', width - 240, height - 65, { align: 'center' });

  doc.save(`${slug(businessName)}-${slug(performer.full_name)}-${slug(month)}-staff-of-the-month.pdf`);
}

export async function downloadOnboardingCertificate({
  businessUnit,
  certificate,
  issuedAt = new Date(certificate?.issued_at || Date.now()),
}) {
  if (!certificate) {
    throw new Error('No onboarding certificate is available yet.');
  }

  const { jsPDF } = await import('jspdf');
  const businessName = businessUnit?.name || 'RTB Lounge';
  const doc = new jsPDF({ format: 'letter', orientation: 'landscape', unit: 'pt' });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const logoDataUrl = await imageToDataUrl(RTB_LOGO_URL);
  const issuedLabel = new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(issuedAt);
  const policies = Array.isArray(certificate.policy_versions) ? certificate.policy_versions : [];

  doc.setFillColor(CERT_COLORS.cream);
  doc.rect(0, 0, width, height, 'F');
  doc.setDrawColor(CERT_COLORS.line);
  doc.setLineWidth(4);
  doc.rect(34, 34, width - 68, height - 68, 'S');
  doc.setLineWidth(1);
  doc.rect(48, 48, width - 96, height - 96, 'S');

  drawDiagonalBand(doc, width - 220, 0, 220, 220, CERT_COLORS.brassDeep);
  drawDiagonalBand(doc, width - 115, 0, 220, 220, CERT_COLORS.ink);
  drawSeal(doc, width - 150, 150, businessName, logoDataUrl);

  doc.setTextColor(CERT_COLORS.ink);
  doc.setFont('times', 'normal');
  doc.setFontSize(52);
  doc.text('ONBOARDING CERTIFICATE', 72, 140);

  doc.setTextColor(CERT_COLORS.brassDeep);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('RTB OS STAFF ONBOARDING COMPLETION', 76, 176);

  doc.setTextColor(CERT_COLORS.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('THIS CERTIFIES THAT', 78, 250);

  doc.setTextColor(CERT_COLORS.brassDeep);
  doc.setFont('times', 'italic');
  doc.setFontSize(50);
  doc.text(certificate.issued_to || 'New Staff Member', 78, 322);

  doc.setTextColor(CERT_COLORS.ink);
  doc.setFont('times', 'normal');
  doc.setFontSize(17);
  doc.text(
    `completed RTB standards, operational training, knowledge checks, practical shop certification, and required policy signatures for ${businessName}.`,
    78,
    376,
    { maxWidth: 620 },
  );

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(`Certificate: ${certificate.certificate_number}`, 78, 444);
  doc.text(`Issued: ${issuedLabel}`, 78, 466);
  doc.text(`Policy versions recorded: ${policies.length}`, 78, 488);

  doc.setDrawColor(CERT_COLORS.ink);
  doc.line(width - 360, height - 105, width - 120, height - 105);
  doc.setTextColor(CERT_COLORS.ink);
  doc.setFont('helvetica', 'bold');
  doc.text('MANAGER APPROVAL', width - 240, height - 82, { align: 'center' });
  doc.setTextColor(CERT_COLORS.brassDeep);
  doc.text('RTB OS', width - 240, height - 65, { align: 'center' });

  doc.save(`${slug(businessName)}-${slug(certificate.issued_to)}-onboarding-certificate.pdf`);
}
