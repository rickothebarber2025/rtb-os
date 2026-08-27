import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarCheck,
  Check,
  ChevronRight,
  Clock3,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
  X,
} from 'lucide-react';
import StatusBadge from './StatusBadge';
import { canManageAccess, canManageStaff } from '../utils/access';
import { isOwnerProfile, MODULE_IDS, MODULE_LABELS, normalizePermissionsPayload } from '../lib/permissions.js';
import { buildPermissionsFromTemplate, getTemplateRoleValue, ROLE_TEMPLATES } from '../lib/roleTemplates.js';
import {
  acknowledgeMyStaffWarning,
  issueStaffWarning,
  listAccessProfiles,
  listMyTimeOffRequests,
  listStaffWarnings,
  savePromotedAccess,
  submitStaffTimeOffRequest,
  updateStaffWarning,
} from '../services/staffExperienceService';
import { supabase } from '../lib/supabaseClient';
import '../styles/agenticStaffWorkspace.css';

const WARNING_PRESETS = [
  { category: 'attendance', title: 'Attendance / lateness', detail: 'Attendance did not meet the expected schedule or communication standard.' },
  { category: 'cleaning', title: 'Cleaning / shop standard', detail: 'Assigned cleaning or shared shop standards were not completed.' },
  { category: 'policy', title: 'Policy not followed', detail: 'An RTB policy or required operating procedure was not followed.' },
  { category: 'performance', title: 'Performance follow-up', detail: 'Performance expectations need a documented follow-up and improvement plan.' },
  { category: 'conduct', title: 'Conduct / teamwork', detail: 'Professional conduct, teamwork, or communication needs correction.' },
  { category: 'cash', title: 'Cash / checkout procedure', detail: 'Cash handling, checkout, or payment procedure was not followed correctly.' },
];

const TIME_OFF_REASONS = ['Personal', 'Appointment', 'Family', 'Vacation', 'School', 'Other'];
const SENSITIVE_MODULES = new Set(['access', 'payroll', 'settings']);

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function earliestAllowedDate() {
  const threshold = Date.now() + 48 * 60 * 60 * 1000;
  const candidate = new Date();
  candidate.setHours(0, 0, 0, 0);
  while (candidate.getTime() < threshold) candidate.setDate(candidate.getDate() + 1);
  return dateKey(candidate);
}

function noticeHours(dateValue) {
  if (!dateValue) return null;
  const start = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;
  return Math.floor((start.getTime() - Date.now()) / 3600000);
}

function formatDay(value) {
  if (!value) return 'Choose a date';
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }).format(date);
}

function warningLevelLabel(level) {
  if (Number(level) >= 3) return 'Final warning';
  if (Number(level) === 2) return 'Written warning';
  return 'Warning';
}

function warningTone(warning) {
  if (warning.status !== 'active') return 'muted';
  if (new Date(warning.expires_at).getTime() <= Date.now()) return 'muted';
  if (Number(warning.level) >= 3) return 'danger';
  if (Number(warning.level) === 2) return 'warning';
  return 'gold';
}

function activeWarning(warning) {
  return warning.status === 'active' && new Date(warning.expires_at).getTime() > Date.now();
}

function findStaffProfile({ staff, staffPortalSummary, user, accessProfile }) {
  if (staffPortalSummary?.staff_profile?.id) return staffPortalSummary.staff_profile;
  const email = String(user?.email || accessProfile?.email || '').trim().toLowerCase();
  if (!email) return null;
  return (staff || []).find((member) => String(member.email || '').trim().toLowerCase() === email) || null;
}

function StaffWarningManager({ businessUnit, onRefresh, staff }) {
  const [selectedId, setSelectedId] = useState(() => staff.find((member) => member.active)?.id || '');
  const [warnings, setWarnings] = useState([]);
  const [preset, setPreset] = useState(WARNING_PRESETS[0]);
  const [level, setLevel] = useState(1);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const selected = staff.find((member) => member.id === selectedId) || null;

  const load = useCallback(async () => {
    if (!selectedId) return setWarnings([]);
    try { setWarnings(await listStaffWarnings({ staffId: selectedId })); } catch (err) { setError(err.message); }
  }, [selectedId]);

  useEffect(() => { load(); }, [load]);

  async function issue() {
    if (!selected) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await issueStaffWarning({
        business_unit_id: selected.business_unit_id || businessUnit?.id,
        category: preset.category,
        details: note.trim() || preset.detail,
        level,
        staff_id: selected.id,
        title: preset.title,
      });
      setNote('');
      setMessage(`${warningLevelLabel(level)} added to ${selected.full_name}.`);
      await load();
      await onRefresh?.();
    } catch (err) { setError(err.message || 'Unable to issue warning.'); }
    finally { setBusy(false); }
  }

  async function closeWarning(warning, status) {
    setBusy(true); setError('');
    try {
      await updateStaffWarning(warning.id, { status, resolution_note: status === 'resolved' ? 'Resolved by management.' : 'Voided by management.' });
      await load();
      await onRefresh?.();
    } catch (err) { setError(err.message || 'Unable to update warning.'); }
    finally { setBusy(false); }
  }

  const currentWarnings = warnings.filter(activeWarning);

  return (
    <section className="panel full-span ax-workspace">
      <div className="ax-header">
        <div><span className="eyebrow">Staff profile · accountability</span><h2>Warnings that follow the employee profile</h2><p>Choose the person, choose what happened, add context only when needed, and RTB OS handles the record and staff notification.</p></div>
        <StatusBadge tone={currentWarnings.length ? 'warning' : 'success'}>{currentWarnings.length ? `${currentWarnings.length} active` : 'Clear'}</StatusBadge>
      </div>

      <div className="ax-staff-strip">
        {staff.filter((member) => member.active).map((member) => (
          <button className={member.id === selectedId ? 'active' : ''} key={member.id} onClick={() => setSelectedId(member.id)} type="button">
            <strong>{member.preferred_name || member.full_name}</strong><span>{member.role}</span>
          </button>
        ))}
      </div>

      {selected ? <div className="ax-two-column">
        <div className="ax-card">
          <div className="ax-step"><span>1</span><strong>What happened?</strong></div>
          <div className="ax-choice-grid">
            {WARNING_PRESETS.map((item) => <button className={preset.category === item.category ? 'active' : ''} key={item.category} onClick={() => setPreset(item)} type="button"><strong>{item.title}</strong><small>{item.detail}</small></button>)}
          </div>
          <div className="ax-step"><span>2</span><strong>How serious is it?</strong></div>
          <div className="ax-segmented">
            {[1,2,3].map((item) => <button className={level === item ? 'active' : ''} key={item} onClick={() => setLevel(item)} type="button">{item === 1 ? 'Warning' : item === 2 ? 'Written' : 'Final'}</button>)}
          </div>
          <label className="field"><span>Anything specific to add?</span><textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional context — the standard wording is already prepared." /></label>
          <div className="ax-confirm-line"><ShieldCheck size={18}/><span><strong>{warningLevelLabel(level)} for {selected.full_name}</strong><small>Visible on their profile for 90 days unless management resolves or voids it.</small></span><button className="primary-button" disabled={busy} onClick={issue} type="button">Issue warning</button></div>
        </div>

        <div className="ax-card">
          <div className="ax-card-title"><div><span>Profile record</span><h3>{selected.full_name}</h3></div><StatusBadge tone={currentWarnings.length >= 3 ? 'danger' : currentWarnings.length ? 'warning' : 'success'}>{currentWarnings.length}/3 active</StatusBadge></div>
          {warnings.length ? <div className="ax-record-list">{warnings.slice(0,8).map((warning) => <article key={warning.id}><div><StatusBadge tone={warningTone(warning)}>{warningLevelLabel(warning.level)}</StatusBadge><strong>{warning.title}</strong><small>{warning.details}</small></div><div><small>{warning.acknowledged_at ? 'Staff acknowledged' : 'Awaiting acknowledgement'}</small>{warning.status === 'active' && activeWarning(warning) ? <span className="ax-inline-actions"><button onClick={() => closeWarning(warning,'resolved')} type="button">Resolve</button><button onClick={() => closeWarning(warning,'void')} type="button">Void</button></span> : <StatusBadge tone="muted">{activeWarning(warning) ? warning.status : warning.status === 'active' ? 'expired' : warning.status}</StatusBadge>}</div></article>)}</div> : <div className="ax-empty"><Check size={20}/><strong>No warnings on this profile</strong><span>New warnings will appear here and in the staff member’s Hub.</span></div>}
        </div>
      </div> : null}
      {error ? <div className="alert danger">{error}</div> : null}{message ? <div className="alert success">{message}</div> : null}
    </section>
  );
}

function StaffFrontDesk({ businessUnit, onRefresh, staffProfile }) {
  const [warnings, setWarnings] = useState([]);
  const [requests, setRequests] = useState([]);
  const [mode, setMode] = useState('one');
  const [startDate, setStartDate] = useState(earliestAllowedDate());
  const [endDate, setEndDate] = useState(earliestAllowedDate());
  const [reason, setReason] = useState('Personal');
  const [otherReason, setOtherReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!staffProfile?.id) return;
    try {
      const [warningRows, requestRows] = await Promise.all([listStaffWarnings({ staffId: staffProfile.id }), listMyTimeOffRequests(staffProfile.id)]);
      setWarnings(warningRows); setRequests(requestRows);
    } catch (err) { setError(err.message || 'Unable to load staff updates.'); }
  }, [staffProfile?.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!supabase || !staffProfile?.id) return undefined;
    const channel = supabase.channel(`ax-staff-${staffProfile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_warnings', filter: `staff_id=eq.${staffProfile.id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_time_off_requests', filter: `staff_id=eq.${staffProfile.id}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load, staffProfile?.id]);

  function setRequestMode(next) {
    setMode(next);
    const first = startDate || earliestAllowedDate();
    setStartDate(first);
    if (next === 'one') setEndDate(first);
    if (next === 'two') { const date = new Date(`${first}T12:00:00`); date.setDate(date.getDate()+1); setEndDate(dateKey(date)); }
  }

  function changeStart(value) {
    setStartDate(value);
    if (mode === 'one') setEndDate(value);
    if (mode === 'two') { const date = new Date(`${value}T12:00:00`); date.setDate(date.getDate()+1); setEndDate(dateKey(date)); }
    if (mode === 'custom' && (!endDate || endDate < value)) setEndDate(value);
  }

  const hours = noticeHours(startDate);
  const policyOkay = Number(hours) >= 48;
  const activeWarnings = warnings.filter(activeWarning);
  const unacknowledged = activeWarnings.filter((warning) => !warning.acknowledged_at);

  async function sendRequest() {
    if (!policyOkay || !staffProfile?.id) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await submitStaffTimeOffRequest({
        business_unit_id: staffProfile.business_unit_id || businessUnit?.id,
        end_date: endDate,
        reason: reason === 'Other' ? otherReason.trim() || 'Other' : reason,
        staff_id: staffProfile.id,
        start_date: startDate,
      });
      setMessage('Your request is with management now. You’ll see the decision here automatically.');
      await load(); await onRefresh?.();
    } catch (err) { setError(err.message || 'Unable to send time-off request.'); }
    finally { setBusy(false); }
  }

  async function acknowledge(warningId) {
    setBusy(true); setError('');
    try { await acknowledgeMyStaffWarning(warningId); await load(); await onRefresh?.(); }
    catch (err) { setError(err.message || 'Unable to acknowledge warning.'); }
    finally { setBusy(false); }
  }

  return (
    <section className="panel full-span ax-workspace ax-front-desk">
      <div className="ax-header"><div><span className="eyebrow">RTB front desk</span><h2>What do you need today?</h2><p>No paperwork maze. Choose the task and RTB OS handles the policy, routing and status in the background.</p></div><Sparkles size={24}/></div>

      {activeWarnings.length ? <div className="ax-warning-stack"><div className="ax-card-title"><div><span>Your profile</span><h3>{activeWarnings.length} active warning{activeWarnings.length === 1 ? '' : 's'}</h3></div><StatusBadge tone={unacknowledged.length ? 'warning' : 'muted'}>{unacknowledged.length ? `${unacknowledged.length} needs acknowledgement` : 'Acknowledged'}</StatusBadge></div>{activeWarnings.map((warning) => <article key={warning.id}><AlertTriangle size={18}/><span><strong>{warningLevelLabel(warning.level)} · {warning.title}</strong><small>{warning.details}</small></span>{warning.acknowledged_at ? <StatusBadge tone="success">Acknowledged</StatusBadge> : <button className="secondary-button small" disabled={busy} onClick={() => acknowledge(warning.id)} type="button">I’ve read this</button>}</article>)}</div> : null}

      <div className="ax-card">
        <div className="ax-card-title"><div><span>Time off</span><h3>Request it like you’re speaking to a manager</h3></div><StatusBadge tone="gold">48-hour notice</StatusBadge></div>
        <div className="ax-step"><span>1</span><strong>How much time?</strong></div>
        <div className="ax-segmented"><button className={mode==='one'?'active':''} onClick={() => setRequestMode('one')} type="button">One day</button><button className={mode==='two'?'active':''} onClick={() => setRequestMode('two')} type="button">Two days</button><button className={mode==='custom'?'active':''} onClick={() => setRequestMode('custom')} type="button">Custom</button></div>
        <div className="ax-date-row"><label><span>Starting</span><input min={earliestAllowedDate()} type="date" value={startDate} onChange={(event) => changeStart(event.target.value)} /></label>{mode==='custom' ? <label><span>Until</span><input min={startDate || earliestAllowedDate()} type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label> : <div className="ax-date-summary"><CalendarCheck size={20}/><span><strong>{formatDay(startDate)}{endDate !== startDate ? ` → ${formatDay(endDate)}` : ''}</strong><small>{mode === 'two' ? 'Two-day request' : 'One-day request'}</small></span></div>}</div>
        <div className="ax-step"><span>2</span><strong>What’s it for?</strong></div>
        <div className="ax-chip-row">{TIME_OFF_REASONS.map((item) => <button className={reason===item?'active':''} key={item} onClick={() => setReason(item)} type="button">{item}</button>)}</div>
        {reason === 'Other' ? <label className="field"><span>Short reason</span><input value={otherReason} onChange={(event) => setOtherReason(event.target.value)} placeholder="A few words is enough" /></label> : null}
        <div className={policyOkay ? 'ax-policy success' : 'ax-policy danger'}><Clock3 size={18}/><span><strong>{policyOkay ? 'Notice requirement met' : 'Too soon for the standard request flow'}</strong><small>{policyOkay ? `${hours} hours notice. Management will receive this as a pending request.` : 'Requests need at least 48 hours before the requested day. For an emergency, contact management directly.'}</small></span></div>
        <div className="ax-confirm-line"><UserRoundCheck size={18}/><span><strong>{formatDay(startDate)}{endDate !== startDate ? ` through ${formatDay(endDate)}` : ''}</strong><small>{reason === 'Other' ? otherReason || 'Other' : reason} · You’ll get the decision automatically.</small></span><button className="primary-button" disabled={busy || !policyOkay || !startDate || !endDate} onClick={sendRequest} type="button">Send request <ChevronRight size={15}/></button></div>
      </div>

      {requests.length ? <div className="ax-request-strip">{requests.slice(0,4).map((request) => <article key={request.id}><span><strong>{formatDay(request.start_date)}{request.end_date !== request.start_date ? ` → ${formatDay(request.end_date)}` : ''}</strong><small>{request.reason || 'Time off'}{request.admin_note ? ` · ${request.admin_note}` : ''}</small></span><StatusBadge tone={request.status === 'approved' ? 'success' : request.status === 'denied' ? 'danger' : 'warning'}>{request.status}</StatusBadge></article>)}</div> : null}
      {error ? <div className="alert danger">{error}</div> : null}{message ? <div className="alert success">{message}</div> : null}
    </section>
  );
}

function PromotionWorkspace({ accessProfile, businessUnits, onRefresh }) {
  const [profiles, setProfiles] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const canManage = canManageAccess(accessProfile);

  const load = useCallback(async () => {
    if (!canManage) return;
    try {
      const rows = (await listAccessProfiles()).filter((profile) => !isOwnerProfile(profile));
      setProfiles(rows);
      if (!selectedId && rows[0]) setSelectedId(rows[0].id);
    } catch (err) { setError(err.message || 'Unable to load access profiles.'); }
  }, [canManage, selectedId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const profile = profiles.find((item) => item.id === selectedId);
    if (profile) setDraft({ ...profile, permissions: normalizePermissionsPayload(profile.permissions) });
  }, [profiles, selectedId]);

  if (!canManage || !draft) return null;
  const payload = normalizePermissionsPayload(draft.permissions);

  function applyTemplate(templateId) {
    const nextPermissions = buildPermissionsFromTemplate(templateId, {
      business_scope: payload.business_scope,
      business_unit_ids: payload.business_unit_ids,
    });
    setDraft((current) => ({ ...current, permissions: nextPermissions, role: getTemplateRoleValue(templateId) }));
  }

  function setModule(moduleId, value) {
    setDraft((current) => ({ ...current, permissions: { ...normalizePermissionsPayload(current.permissions), modules: { ...normalizePermissionsPayload(current.permissions).modules, [moduleId]: value } } }));
  }

  async function save() {
    setBusy(true); setError(''); setMessage('');
    try {
      const updated = await savePromotedAccess(draft);
      setMessage(`${updated.full_name || updated.email} now has ${normalizePermissionsPayload(updated.permissions).role_title} access.`);
      await load(); await onRefresh?.();
    } catch (err) { setError(err.message || 'Unable to save role access.'); }
    finally { setBusy(false); }
  }

  const shared = MODULE_IDS.filter((id) => payload.modules[id] !== 'none');
  return (
    <section className="panel full-span ax-workspace">
      <div className="ax-header"><div><span className="eyebrow">Promote with control</span><h2>Choose the role, then choose exactly what comes with it</h2><p>A role template is the starting point—not a blank cheque. You keep final control over every area of RTB OS.</p></div><StatusBadge tone="gold">Owner controlled</StatusBadge></div>
      <div className="ax-promotion-grid">
        <div className="ax-card">
          <div className="ax-step"><span>1</span><strong>Who are you changing?</strong></div>
          <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name || profile.email} · {normalizePermissionsPayload(profile.permissions).role_title}</option>)}</select>
          <div className="ax-step"><span>2</span><strong>Choose the responsibility level</strong></div>
          <div className="ax-role-grid">{ROLE_TEMPLATES.filter((template) => !['owner','custom'].includes(template.id)).map((template) => <button className={payload.role_template===template.id?'active':''} key={template.id} onClick={() => applyTemplate(template.id)} type="button"><strong>{template.title}</strong><small>{template.description}</small></button>)}</div>
        </div>
        <div className="ax-card">
          <div className="ax-card-title"><div><span>Access package</span><h3>{payload.role_title}</h3></div><StatusBadge tone="success">{shared.length} areas</StatusBadge></div>
          <div className="ax-access-list">{MODULE_IDS.map((moduleId) => { const level = payload.modules[moduleId]; const enabled = level !== 'none'; return <article key={moduleId}><label><input checked={enabled} onChange={(event) => setModule(moduleId,event.target.checked?'view':'none')} type="checkbox"/><span><strong>{MODULE_LABELS[moduleId]}</strong><small>{SENSITIVE_MODULES.has(moduleId)?'Sensitive access':'Standard access'}</small></span></label>{enabled ? <select value={level} onChange={(event) => setModule(moduleId,event.target.value)}><option value="view">View</option><option value="edit">Edit</option><option value="admin">Admin</option></select> : <StatusBadge tone="muted">Hidden</StatusBadge>}</article>; })}</div>
          <div className="ax-confirm-line"><ShieldCheck size={18}/><span><strong>{draft.full_name || draft.email}</strong><small>{payload.role_title} · {shared.length} areas shared · changes sync to their active session.</small></span><button className="primary-button" disabled={busy} onClick={save} type="button">Apply access</button></div>
        </div>
      </div>
      {error ? <div className="alert danger">{error}</div> : null}{message ? <div className="alert success">{message}</div> : null}
    </section>
  );
}

export default function AgenticStaffWorkspace({ activePage, accessProfile, businessUnit, businessUnits, onRefresh, staff, staffPortalSummary, user }) {
  const staffProfile = useMemo(() => findStaffProfile({ staff, staffPortalSummary, user, accessProfile }), [accessProfile, staff, staffPortalSummary, user]);
  if (activePage === 'staff' && canManageStaff(accessProfile)) return <StaffWarningManager businessUnit={businessUnit} onRefresh={onRefresh} staff={staff || []} />;
  if (activePage === 'staff-hub' && staffProfile && !isOwnerProfile(accessProfile)) return <StaffFrontDesk businessUnit={businessUnit} onRefresh={onRefresh} staffProfile={staffProfile} />;
  if (activePage === 'access') return <PromotionWorkspace accessProfile={accessProfile} businessUnits={businessUnits || []} onRefresh={onRefresh} />;
  return null;
}
