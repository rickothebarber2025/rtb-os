import { parseBooksyEmail } from './supabase/functions/_shared/booksy-parser.js';
import { buildStaffCandidates, matchStaffAssignment } from './supabase/functions/_shared/source-attribution.js';
import fs from 'fs';

const staff = JSON.parse(fs.readFileSync('/tmp/rtb_lounge_staff.json', 'utf-8'));
const events = JSON.parse(fs.readFileSync('/tmp/events_to_fix.json', 'utf-8'));

const candidates = buildStaffCandidates({ aliases: [], identities: [], staff });

const results = events.map((event) => {
  const parsed = parseBooksyEmail({
    body: event.body,
    subject: event.subject,
    headers: {},
    messageId: event.id,
    threadId: event.id,
  });
  const parsedEvent = parsed.events?.[0] || {};
  const match = matchStaffAssignment(parsedEvent, candidates, {});
  return {
    id: event.id,
    staffName: parsedEvent.staffName,
    matchedStaffId: match.staffId,
    matchedStaffName: match.staffName,
    confidence: match.confidence,
    explanation: match.explanation,
  };
});

console.log(JSON.stringify(results, null, 2));
