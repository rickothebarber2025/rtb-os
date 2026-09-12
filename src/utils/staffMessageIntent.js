/**
 * Turns whatever a staff member types into the right RTB OS record.
 *
 * Staff should never have to pick "Type" and "Priority" from dropdowns
 * before they can say "running 15 late". They type it like a text; this
 * works out where it goes. The rules are deterministic and local — the
 * same intent rules ADA uses on the owner side — so the two never disagree.
 */

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const SHORT_DAYS = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thurs: 4, fri: 5, sat: 6 };

function lower(text) {
  return String(text || '').toLowerCase();
}

function anyMatch(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

/** Next occurrence of a weekday named in the text, if any. */
export function extractRequestedDate(text, now = new Date()) {
  const t = lower(text);
  if (/\btomorrow\b/.test(t)) {
    const d = new Date(now);
    d.setDate(now.getDate() + 1);
    return isoDate(d);
  }
  if (/\btoday\b/.test(t)) return isoDate(now);

  for (let i = 0; i < WEEKDAYS.length; i += 1) {
    const full = new RegExp(`\\b${WEEKDAYS[i]}\\b`);
    if (full.test(t)) {
      const target = new Date(now);
      const delta = (i - now.getDay() + 7) % 7 || 7;
      target.setDate(now.getDate() + delta);
      return isoDate(target);
    }
  }
  for (const [abbr, dayIndex] of Object.entries(SHORT_DAYS)) {
    if (new RegExp(`\\b${abbr}\\b`).test(t)) {
      const target = new Date(now);
      const delta = (dayIndex - now.getDay() + 7) % 7 || 7;
      target.setDate(now.getDate() + delta);
      return isoDate(target);
    }
  }
  return null;
}

export function extractMinutesLate(text) {
  const match = lower(text).match(/(\d{1,3})\s*(min|mins|minutes)\b/);
  return match ? Number(match[1]) : null;
}

/**
 * Classify a message. Returns the destination and the record fields.
 *
 * destination:
 *   'time_off'    → staff_time_off_requests (has real dates)
 *   'operations'  → staff_operations_requests (everything else)
 */
export function classifyStaffMessage(text, now = new Date()) {
  const t = lower(text);
  const trimmed = String(text || '').trim();

  if (anyMatch(t, [
    /\b(need|want|take|request|asking for|get|have|can i (get|have|take))\b.{0,25}\b(day|days|weekend|sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thurs|fri|sat)\s*off\b/,
    /\btime off\b/, /\bday off\b/, /\bvacation\b/, /\bpto\b/,
    /\boff (this|next) (weekend|week|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/,
  ])) {
    const date = extractRequestedDate(text, now);
    return {
      destination: 'time_off',
      label: 'Time off',
      start_date: date,
      end_date: date,
      reason: trimmed,
      needsDate: !date,
    };
  }

  if (anyMatch(t, [
    /\brunning\b.{0,20}\blate\b/, /\b(gonna|going to|will|i'?ll|i'?m|im)\b.{0,20}\blate\b/,
    /\blate\b.{0,30}\b(min|mins|minutes|today|coming|way|there)\b/, /\b(min|mins|minutes)\s+late\b/,
    /\bstuck in traffic\b/, /\btraffic\b/,
  ])) {
    const minutes = extractMinutesLate(text);
    return {
      destination: 'operations',
      label: 'Running late',
      request_type: 'incident',
      category: 'attendance_late',
      priority: minutes && minutes >= 30 ? 'high' : 'normal',
      title: minutes ? `Running ${minutes} min late` : 'Running late',
      details: trimmed,
    };
  }

  if (anyMatch(t, [
    /\bcan'?t (come|make it|be there|work)\b/, /\bwon'?t (be|make it) (in|there)\b/,
    /\bnot coming in\b/, /\b(sick|emergency|hospital)\b/, /\bcalling in\b/,
  ])) {
    return {
      destination: 'operations',
      label: 'Absence',
      request_type: 'incident',
      category: 'attendance_absent',
      priority: 'urgent',
      title: 'Cannot make shift today',
      details: trimmed,
    };
  }

  if (anyMatch(t, [
    /\b(need|out of|order|buy|running low on|restock|low on|more)\b.{0,30}\b(clippers?|blades?|guards?|towels?|foils?|gloves?|razors?|spray|oil|product|gel|wax|shampoo|dye|colou?r|neck strips?|capes?|combs?|brushes|paper|soap|sanitizer)\b/,
    /\bsupply list\b/, /\bsupplies\b/, /\bwe need more\b/,
  ])) {
    return {
      destination: 'operations',
      label: 'Supplies',
      request_type: 'inventory',
      category: 'supplies',
      priority: 'normal',
      title: trimmed.slice(0, 60),
      details: trimmed,
    };
  }

  if (anyMatch(t, [
    /\b(broke|broken|not working|doesn'?t work|isn'?t working|busted|leak|leaking|clogged|no (hot )?water|light(s)? out|ac (is )?(out|broken)|heat (is )?(out|off))\b/,
    /\b(chair|sink|clipper|mirror|door|lock|toilet|fridge|tv|speaker|wifi|router|printer|pos|square)\b.{0,20}\b(broke|broken|down|dead|off|out)\b/,
  ])) {
    return {
      destination: 'operations',
      label: 'Something broke',
      request_type: 'maintenance',
      category: 'maintenance',
      priority: /\b(urgent|asap|now|emergency|flood|fire|no water)\b/.test(t) ? 'urgent' : 'high',
      title: trimmed.slice(0, 60),
      details: trimmed,
    };
  }

  if (anyMatch(t, [/\bclient\b/, /\bcustomer\b/, /\bwalk.?in\b/, /\bno.?show\b/, /\bcomplain/, /\brefund\b/, /\bunhappy\b/, /\bmad\b/])) {
    return {
      destination: 'operations',
      label: 'Client issue',
      request_type: 'incident',
      category: 'client_issue',
      priority: 'high',
      title: trimmed.slice(0, 60),
      details: trimmed,
    };
  }

  if (anyMatch(t, [/\bcommission\b/, /\bmy pay\b/, /\bpaycheck\b/, /\bpay ?stub\b/, /\bpayday\b/, /\b(55|60|65|70)\s*%/])) {
    return {
      destination: 'operations',
      label: 'Pay question',
      request_type: 'incident',
      category: 'commission_pay',
      priority: 'normal',
      title: trimmed.slice(0, 60),
      details: trimmed,
    };
  }

  if (anyMatch(t, [/\bschedule\b/, /\bavailab(le|ility)\b/, /\bclass(es)?\b/, /\bschool\b/, /\bcan (only )?work\b/, /\bshift(s)?\b/])) {
    return {
      destination: 'operations',
      label: 'Schedule change',
      request_type: 'incident',
      category: 'availability_change',
      priority: 'normal',
      title: trimmed.slice(0, 60),
      details: trimmed,
    };
  }

  return {
    destination: 'operations',
    label: 'Question',
    request_type: 'incident',
    category: 'question',
    priority: 'normal',
    title: trimmed.slice(0, 60),
    details: trimmed,
  };
}

/** Quick-start chips shown above the composer. Each is just a seed phrase. */
export const QUICK_STARTS = [
  { label: 'Running late', seed: 'Running about 15 min late, ' },
  { label: 'Time off', seed: 'Can I have ' },
  { label: 'Supplies', seed: 'We need more ' },
  { label: 'Something broke', seed: 'The ' },
  { label: 'Client issue', seed: 'A client ' },
  { label: 'Question', seed: '' },
];

/** Plain-language status for staff. They should never see "pending". */
export function staffFacingStatus(record) {
  const status = lower(record?.status);
  if (record?.manager_note || record?.admin_note) return { label: 'Ricko replied', tone: 'replied' };
  if (['completed', 'resolved', 'approved', 'done'].includes(status)) return { label: 'Done', tone: 'done' };
  if (['denied', 'rejected', 'cancelled'].includes(status)) return { label: 'Not approved', tone: 'denied' };
  if (['in_progress', 'assigned', 'acknowledged', 'seen'].includes(status)) return { label: 'In progress', tone: 'active' };
  return { label: 'Sent', tone: 'sent' };
}
