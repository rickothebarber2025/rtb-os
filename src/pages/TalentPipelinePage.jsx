import { useEffect, useMemo, useState } from 'react';
import { hasModulePermission } from '../lib/permissions.js';
import { advanceTalentCandidate, assignTalentManager, getTalentManagers, getTalentPipeline, getTalentReviews, recommendationFor, saveTalentCandidate, saveTalentReview } from '../services/talentService';

const STAGES = ['applicant','interview','audition','new_talent','probation','official','exited'];
const REVIEW_DAYS = [7,14,30,60,90];
const KPI_FIELDS = [
  ['attendance','Attendance'],['reliability','Reliability'],['service_quality','Service quality'],
  ['client_experience','Client experience'],['rebooking_retention','Rebooking / retention'],
  ['policy_compliance','Policy compliance'],['professionalism','Professionalism'],['content_participation','Content participation'],
];
const pretty = (value) => String(value || '').replaceAll('_',' ').replace(/\b\w/g, (c) => c.toUpperCase());

export default function TalentPipelinePage({ accessProfile, businessUnit, isAllBusinessesView, onRefresh }) {
  const [rows,setRows] = useState([]); const [selected,setSelected] = useState(null); const [reviews,setReviews] = useState([]); const [managers,setManagers] = useState([]);
  const [busy,setBusy] = useState(false); const [error,setError] = useState('');
  const [form,setForm] = useState({ full_name:'', specialty:'', hiring_reason:'planned_growth', stage:'applicant', assigned_manager_id:'' });
  const canEdit = hasModulePermission(accessProfile,'operations','edit') || hasModulePermission(accessProfile,'roster','edit');

  async function load() {
    if (!businessUnit || isAllBusinessesView) return;
    setError('');
    try {
      const [pipeline, managerRows] = await Promise.all([getTalentPipeline(businessUnit.id), getTalentManagers(businessUnit.id)]);
      setRows(pipeline || []); setManagers(managerRows || []);
      if ((managerRows || []).length === 1) setForm((current) => current.assigned_manager_id ? current : { ...current, assigned_manager_id: managerRows[0].id });
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, [businessUnit?.id, isAllBusinessesView]);
  useEffect(() => { if (selected?.id) getTalentReviews(selected.id).then(setReviews).catch(() => setReviews([])); }, [selected?.id]);

  const pressure = useMemo(() => rows.filter((r) => ['coverage_shortage','urgent_survival'].includes(r.hiring_reason) && r.stage !== 'exited').length, [rows]);

  async function addCandidate(e) {
    e.preventDefault(); if (!canEdit) return; setBusy(true); setError('');
    try { await saveTalentCandidate({ ...form, assigned_manager_id: form.assigned_manager_id || null, business_unit_id: businessUnit.id }); setForm({ full_name:'', specialty:'', hiring_reason:'planned_growth', stage:'applicant', assigned_manager_id: managers.length===1?managers[0].id:'' }); await load(); onRefresh?.({silent:true}); }
    catch(e){ setError(e.message); } finally { setBusy(false); }
  }
  async function move(candidate, stage) { if (!canEdit) return; setBusy(true); try { await advanceTalentCandidate(candidate, stage); await load(); setSelected((s) => s?.id === candidate.id ? {...s,stage} : s); } catch(e){setError(e.message);} finally{setBusy(false);} }
  async function changeManager(candidate, managerId) { if (!canEdit) return; setBusy(true); try { await assignTalentManager(candidate, managerId); await load(); setSelected((s)=>s?.id===candidate.id?{...s,assigned_manager_id:managerId,assigned_manager_name:managers.find((m)=>m.id===managerId)?.full_name||null}:s); } catch(e){setError(e.message);} finally{setBusy(false);} }
  async function addReview(day) {
    if (!canEdit) return;
    const base = Object.fromEntries(KPI_FIELDS.map(([key]) => [key, 0]));
    const review = { candidate_id:selected.id, business_unit_id:selected.business_unit_id, review_day:day, ...base, recommendation:'improvement_plan' };
    await saveTalentReview(review); setReviews(await getTalentReviews(selected.id));
  }
  async function updateReview(review, key, value) {
    if (!canEdit) return;
    const next = {...review,[key]: value}; next.recommendation = recommendationFor(next);
    setReviews((list) => list.map((r) => r.review_day === review.review_day ? next : r));
    await saveTalentReview(next);
  }

  if (isAllBusinessesView) return <div className="panel full-span"><div className="alert warning">Choose one business to manage its Talent Pipeline.</div></div>;

  return <div className="page-grid">
    <section className="panel full-span">
      <div className="section-heading"><div><p className="eyebrow">People system</p><h2>Talent Pipeline</h2><p>Talent ownership now follows the selected business and its Operations managers.</p></div><div className={`status-pill ${pressure ? 'warning' : 'success'}`}>{pressure ? `${pressure} pressure hire${pressure===1?'':'s'}` : 'No pressure hires'}</div></div>
      {error ? <div className="alert danger">{error}</div> : null}
      {!canEdit ? <div className="alert info">You have view access. An Operations or Roster editor can add candidates, assign managers, move stages and complete reviews.</div> : null}
      <form className="form-grid" onSubmit={addCandidate}>
        <label>Candidate<input disabled={!canEdit} required value={form.full_name} onChange={(e)=>setForm({...form,full_name:e.target.value})} /></label>
        <label>Specialty<input disabled={!canEdit} placeholder="Barber, braider, lash tech…" value={form.specialty} onChange={(e)=>setForm({...form,specialty:e.target.value})} /></label>
        <label>Why are we hiring?<select disabled={!canEdit} value={form.hiring_reason} onChange={(e)=>setForm({...form,hiring_reason:e.target.value})}><option value="planned_growth">Planned growth</option><option value="replacement">Replacement</option><option value="coverage_shortage">Coverage shortage</option><option value="urgent_survival">Urgent / survival</option></select></label>
        <label>Operations owner<select disabled={!canEdit} value={form.assigned_manager_id} onChange={(e)=>setForm({...form,assigned_manager_id:e.target.value})}><option value="">Auto-assign if one manager</option>{managers.map((m)=><option value={m.id} key={m.id}>{m.full_name} · {m.role_title || 'Operations'}</option>)}</select></label>
        <button className="primary-button" disabled={busy || !canEdit}>Add to pipeline</button>
      </form>
    </section>

    <section className="panel full-span">
      <div className="table-wrap"><table><thead><tr><th>Talent</th><th>Stage</th><th>Operations owner</th><th>Hiring pressure</th><th>Fit</th><th>Opportunity conversion</th><th>Visibility</th><th></th></tr></thead><tbody>
      {rows.map((r)=><tr key={r.id}><td><strong>{r.full_name}</strong><div className="muted">{r.specialty || '—'}</div></td><td>{pretty(r.stage)}</td><td>{r.assigned_manager_name || 'Unassigned'}</td><td>{pretty(r.hiring_reason)}</td><td>{r.critical_failure ? 'Critical fail' : r.fit_score == null ? 'Not reviewed' : `${r.fit_score}/100`}</td><td>{r.opportunity_conversion_rate == null ? '—' : `${r.opportunity_conversion_rate}%`}</td><td>{r.permanent_brand_endorsement ? 'Official RTB' : r.public_booking_enabled ? 'Earning visibility' : 'Private'}</td><td><button className="secondary-button small" onClick={()=>setSelected(r)}>Review</button></td></tr>)}
      {!rows.length ? <tr><td colSpan="8">No candidates yet.</td></tr> : null}
      </tbody></table></div>
    </section>

    {selected ? <section className="panel full-span">
      <div className="section-heading"><div><p className="eyebrow">Decision record</p><h2>{selected.full_name}</h2><p>{pretty(selected.stage)} · {pretty(selected.hiring_reason)}</p></div><button className="ghost-button" onClick={()=>setSelected(null)}>Close</button></div>
      <div className="form-grid"><label>Assigned Operations manager<select disabled={!canEdit || busy} value={selected.assigned_manager_id || ''} onChange={(e)=>changeManager(selected,e.target.value)}><option value="">Unassigned</option>{managers.map((m)=><option value={m.id} key={m.id}>{m.full_name} · {m.role_title || 'Operations'}</option>)}</select></label></div>
      <div className="button-row">{STAGES.map((stage)=><button key={stage} disabled={busy || !canEdit || selected.stage===stage} className={selected.stage===stage?'primary-button':'secondary-button'} onClick={()=>move(selected,stage)}>{pretty(stage)}</button>)}</div>
      <div className="alert info"><strong>Visibility rule:</strong> New Talent and Probation can be booked, receive walk-ins and social exposure. Permanent brand endorsement only turns on at Official.</div>
      {REVIEW_DAYS.map((day)=>{ const review=reviews.find((r)=>r.review_day===day); return <div className="panel inset" key={day}><div className="section-heading"><h3>Day {day}</h3>{!review?<button disabled={!canEdit} className="secondary-button small" onClick={()=>addReview(day)}>Start review</button>:<span className="status-pill">{pretty(review.recommendation)}</span>}</div>
        {review ? <><div className="form-grid">{KPI_FIELDS.map(([key,label])=><label key={key}>{label}<input disabled={!canEdit} type="number" min="0" max="100" value={review[key]} onChange={(e)=>updateReview(review,key,Number(e.target.value))}/></label>)}</div>
        <h4>RTB opportunity supplied</h4><div className="form-grid">{[['qualified_leads','Qualified leads'],['bookings_from_opportunities','Bookings won'],['walk_ins_assigned','Walk-ins assigned'],['social_features','Social features'],['revenue','Revenue'],['average_ticket','Average ticket']].map(([key,label])=><label key={key}>{label}<input disabled={!canEdit} type="number" min="0" step={key.includes('revenue')||key==='average_ticket'?'0.01':'1'} value={review[key]} onChange={(e)=>updateReview(review,key,Number(e.target.value))}/></label>)}</div>
        <label className="checkbox-row"><input disabled={!canEdit} type="checkbox" checked={review.critical_failure} onChange={(e)=>updateReview(review,'critical_failure',e.target.checked)}/> Critical failure override</label></> : null}
      </div>})}
    </section> : null}
  </div>;
}