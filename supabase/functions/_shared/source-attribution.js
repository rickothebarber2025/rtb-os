export const ASSIGNMENT_THRESHOLDS = {
  auto: 95,
  audit: 75,
  ambiguityWindow: 5,
};

export function normalizeSourceText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function compactSourceKey(value) {
  return normalizeSourceText(value).replace(/\s+/g, "");
}

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function parseServices(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    return value.split(/[,|]/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

export function buildStaffCandidates({ aliases = [], identities = [], staff = [] } = {}) {
  const identityByStaffId = new Map();
  identities.forEach((identity) => {
    const staffId = identity.staff_id;
    if (!staffId) return;
    const existing = identityByStaffId.get(staffId) || [];
    existing.push(identity);
    identityByStaffId.set(staffId, existing);
  });

  const aliasesByStaffId = new Map();
  aliases.forEach((alias) => {
    const staffId = alias.staff_id;
    if (!staffId) return;
    const existing = aliasesByStaffId.get(staffId) || [];
    existing.push(alias.alias);
    aliasesByStaffId.set(staffId, existing);
  });

  return staff
    .filter((member) => member && member.active !== false)
    .map((member) => {
      const memberIdentities = identityByStaffId.get(member.id) || [];
      const sourceIds = memberIdentities.map((identity) => identity.source_staff_id);
      const emails = [
        member.email,
        ...memberIdentities.map((identity) => identity.source_email),
      ];
      const names = [
        member.full_name,
        member.preferred_name,
        ...memberIdentities.map((identity) => identity.source_display_name),
        ...memberIdentities.map((identity) => identity.preferred_name),
        ...toArray(aliasesByStaffId.get(member.id)),
      ];
      const services = [
        ...parseServices(member.services_offered),
        ...memberIdentities.flatMap((identity) => parseServices(identity.services)),
      ];
      const locations = [
        member.business_location,
        ...memberIdentities.map((identity) => identity.business_location),
      ];

      return {
        aliases: unique(names).map((name) => ({
          key: compactSourceKey(name),
          name,
          words: normalizeSourceText(name),
        })),
        businessUnitId: member.business_unit_id,
        emails: unique(emails).map(normalizeEmail),
        id: member.id,
        locations: unique(locations).map(normalizeSourceText),
        name: member.full_name,
        raw: member,
        services: unique(services).map(normalizeSourceText),
        sourceIds: unique(sourceIds).map(String),
      };
    });
}

function scoreCandidate(item, candidate, context = {}) {
  const reasons = [];
  let score = 0;

  const sourceStaffId = String(item.sourceStaffId || item.staff_id || "").trim();
  if (sourceStaffId && candidate.sourceIds.includes(sourceStaffId)) {
    score = Math.max(score, 100);
    reasons.push("Exact source staff ID matched.");
  }

  const email = normalizeEmail(item.staffEmail || item.staff_email || item.email);
  if (email && candidate.emails.includes(email)) {
    score = Math.max(score, 98);
    reasons.push("Exact staff email matched.");
  }

  const staffNameKey = compactSourceKey(item.staffName || item.staff_name);
  if (staffNameKey && candidate.aliases.some((alias) => alias.key === staffNameKey)) {
    score = Math.max(score, 95);
    reasons.push("Exact staff name or saved alias matched.");
  }

  const reviewText = normalizeSourceText(item.reviewText || item.review_text || "");
  if (reviewText) {
    const mentionedAlias = candidate.aliases.find((alias) => {
      if (!alias.words || alias.words.length < 3) return false;
      return new RegExp(`(^|\\s)${alias.words.replace(/\s+/g, "\\s+")}(\\s|$)`, "i").test(reviewText);
    });
    if (mentionedAlias) {
      score = Math.max(score, 86);
      reasons.push(`Review text mentions ${mentionedAlias.name}.`);
    }
  }

  const service = normalizeSourceText(item.serviceName || item.service_name);
  if (service && candidate.services.some((candidateService) => candidateService && service.includes(candidateService))) {
    score = Math.max(score, Math.min(score + 8, 92));
    reasons.push("Service matches this staff profile.");
  }

  const location = normalizeSourceText(item.location);
  if (location && candidate.locations.some((candidateLocation) => candidateLocation && location.includes(candidateLocation))) {
    score = Math.max(score, Math.min(score + 5, 90));
    reasons.push("Business location matches this staff profile.");
  }

  const bookingIdentifier = String(item.bookingIdentifier || item.booking_identifier || "").trim();
  const bookingStaffId = bookingIdentifier ? context.bookingStaffById?.get(bookingIdentifier) : null;
  if (bookingStaffId && bookingStaffId === candidate.id) {
    score = Math.max(score, 88);
    reasons.push("Booking ID previously matched this staff member.");
  }

  if (context.appointmentMatches?.has(candidate.id)) {
    score = Math.max(score, 82);
    reasons.push("Client, service, and appointment time are close to an existing appointment.");
  }

  return { candidate, reasons, score: Math.min(100, score) };
}

function hasAnyAttributionSignal(item) {
  return Boolean(
    item.sourceStaffId ||
      item.staff_id ||
      item.staffEmail ||
      item.staff_email ||
      item.email ||
      item.staffName ||
      item.staff_name ||
      item.bookingIdentifier ||
      item.booking_identifier ||
      item.serviceName ||
      item.service_name ||
      item.reviewText ||
      item.review_text,
  );
}

function hasDirectStaffSignal(item) {
  return Boolean(
    item.sourceStaffId ||
      item.staff_id ||
      item.staffEmail ||
      item.staff_email ||
      item.email ||
      item.staffName ||
      item.staff_name ||
      item.bookingIdentifier ||
      item.booking_identifier,
  );
}

export function matchStaffAssignment(item, candidates, context = {}) {
  const scored = candidates
    .map((candidate) => scoreCandidate(item, candidate, context))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score);

  const alternatives = scored.slice(0, 5).map((match) => ({
    confidence: match.score,
    reasons: match.reasons,
    staff_id: match.candidate.id,
    staff_name: match.candidate.name,
  }));

  if (!scored.length) {
    const shouldStayGeneral = context.allowGeneralBusiness && !hasDirectStaffSignal(item);
    return {
      alternativeMatches: alternatives,
      confidence: 0,
      explanation: shouldStayGeneral
        ? "No direct staff attribution signal was present, so this stays at the business level."
        : hasAnyAttributionSignal(item)
        ? "No staff profile matched the source identifiers, names, aliases, booking, service, or review text."
        : "No staff attribution signal was present, so this stays at the business level.",
      reasons: [],
      staffId: null,
      staffName: null,
      status: shouldStayGeneral || (context.allowGeneralBusiness && !hasAnyAttributionSignal(item))
        ? "general_business"
        : "unresolved",
    };
  }

  const [best, second] = scored;
  const ambiguous =
    second &&
    best.score >= ASSIGNMENT_THRESHOLDS.audit &&
    best.score - second.score <= ASSIGNMENT_THRESHOLDS.ambiguityWindow;

  if (ambiguous) {
    return {
      alternativeMatches: alternatives,
      confidence: best.score,
      explanation: "Multiple staff members matched too closely, so RTB OS did not guess.",
      reasons: best.reasons,
      staffId: null,
      staffName: null,
      status: "unresolved",
    };
  }

  const status =
    best.score >= ASSIGNMENT_THRESHOLDS.auto
      ? "auto_assigned"
      : best.score >= ASSIGNMENT_THRESHOLDS.audit
      ? "flagged_for_audit"
      : "unresolved";

  return {
    alternativeMatches: alternatives,
    confidence: best.score,
    explanation: best.reasons.join(" ") || "Matched by source attribution rules.",
    reasons: best.reasons,
    staffId: status === "unresolved" ? null : best.candidate.id,
    staffName: status === "unresolved" ? null : best.candidate.name,
    status,
  };
}

export function assignmentNeedsManagerReview(assignment) {
  return assignment.status === "unresolved" || assignment.status === "flagged_for_audit";
}
