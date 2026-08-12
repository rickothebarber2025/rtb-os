import { useEffect, useMemo, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  History,
  Lock,
  MessageSquareText,
  PackageCheck,
  XCircle,
} from 'lucide-react';
import { useAuthProfile } from '../contexts/AuthProfileContext.jsx';
import { supabase } from '../lib/supabaseClient';
import {
  claimMyOperationChecklist,
  confirmMyOperationShift,
  getMyDailyOperations,
  setMyOperationItem,
} from '../services/staffOperationsService';
import { getTodayChecklistStatus } from '../services/rtbService';

const CHECKLIST_TYPES = [
  { id: 'opening', label: 'Opening' },
  { id: 'closing', label: 'Closing' },
];

const STATUS_LABEL = {
  completed: 'Done',
  could_not_complete: 'Could not complete',
  skipped: 'Skipped',
};

function defaultChecklistType() {
  return new Date().getHours() >= 15 ? 'closing' : 'opening';
}

function isOperationsCleaner(profile) {
  const template = String(profile?.permissions?.role_template || '').toLowerCase();
  const title = String(profile?.role_title || profile?.role || '').toLowerCase();
  return template === 'operations_cleaning' || title.includes('operations cleaning') || title.includes('operations & cleaning');
}

function groupItems(items = []) {
  return items.reduce((groups, item) => {
    const category = item.category || 'General';
    if (!groups[category]) groups[category] = [];
    groups[category].push(item);
    return groups;
  }, {});
}

function groupProgress(items = []) {
  const done = items.filter((item) => item.status !== 'pending').length;
  return { done, total: items.length, percent: items.length ? Math.round((done / items.length) * 100) : 0 };
}

function shortDate(value) {
  if (!value) return '';
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric' }).format(date);
}

async function uploadChecklistPhoto(itemId, file) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const extension = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `checklist-photos/${itemId}-${Date.now()}.${extension}`;
  const { error } = await supabase.storage.from('hub-content').upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from('hub-content').getPublicUrl(path);
  return data.publicUrl;
}

export default function OpeningClosingChecklist({ businessUnitId, isAdmin, readOnly }) {
  const { profile: authProfile } = useAuthProfile();
  const cleanerMode = isOperationsCleaner(authProfile);
  const showAdminTeam = Boolean(isAdmin && !cleanerMode);
  const [checklistType, setChecklistType] = useState(() => (cleanerMode ? 'opening' : defaultChecklistType()));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState('');
  const [drafts, setDrafts] = useState({});
  const [expandedItemId, setExpandedItemId] = useState(null);
  const [openCategories, setOpenCategories] = useState({});
  const [checklistView, setChecklistView] = useState(() => (cleanerMode ? 'cleaning' : 'station'));
  const [teamStatus, setTeamStatus] = useState([]);
  const [teamStatusLoading, setTeamStatusLoading] = useState(false);
  const [teamStatusError, setTeamStatusError] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (!cleanerMode) return;
    setChecklistType('opening');
    setChecklistView('cleaning');
  }, [cleanerMode]);

  async function loadTeamStatus() {
    if (!showAdminTeam || !businessUnitId) return;
    setTeamStatusLoading(true);
    setTeamStatusError('');
    try {
      setTeamStatus((await getTodayChecklistStatus(businessUnitId, checklistType)) || []);
    } catch (err) {
      setTeamStatusError(err.message || 'Unable to load today’s team status.');
    } finally {
      setTeamStatusLoading(false);
    }
  }

  async function load() {
    if (!businessUnitId) return;
    setLoading(true);
    setError('');
    try {
      setData(await getMyDailyOperations(businessUnitId));
    } catch (err) {
      setError(err.message || 'Unable to load checklists.');
    } finally {
      setLoading(false);
    }
    if (showAdminTeam) await loadTeamStatus();
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessUnitId, cleanerMode, checklistType]);

  const stationRun = data?.checklists?.find((run) => run.type === checklistType && run.scope === 'station') || null;
  const sharedRun = data?.checklists?.find((run) => run.type === checklistType && run.scope === 'shared') || null;
  const cleaningRun = data?.checklists?.find((run) => run.type === 'opening' && run.scope === 'cleaning') || null;
  const activeCleanerRun = cleaningRun || (cleanerMode ? sharedRun : null);
  const activeRun = cleanerMode ? activeCleanerRun : checklistView === 'shared' ? sharedRun : stationRun;
  const categories = useMemo(() => groupItems(activeRun?.items || []), [activeRun]);
  const history = useMemo(() => {
    const rows = Array.isArray(data?.history) ? data.history : [];
    return cleanerMode ? rows.filter((row) => row.scope === 'cleaning' || row.scope === 'shared').slice(0, 30) : rows.slice(0, 20);
  }, [cleanerMode, data?.history]);

  useEffect(() => {
    if (!activeRun?.items?.length) return;
    const grouped = groupItems(activeRun.items);
    const initial = {};
    Object.entries(grouped).forEach(([category, items], index) => {
      const progress = groupProgress(items);
      initial[category] = progress.percent < 100 || index === 0;
    });
    setOpenCategories(initial);
  }, [activeRun?.id]);

  async function handleClaim(scope) {
    setWorking(`claim-${scope}`);
    setError('');
    setNotice('');
    try {
      const type = cleanerMode ? 'opening' : checklistType;
      const runId = await claimMyOperationChecklist(businessUnitId, type, scope);
      if (!runId) throw new Error('Checklist start was not confirmed by the database.');
      await load();
      setNotice(cleanerMode ? 'Whole-salon cleaning checklist resumed.' : `${type === 'opening' ? 'Opening' : 'Closing'} checklist resumed.`);
    } catch (err) {
      setError(err.message || 'Unable to start this checklist.');
    } finally {
      setWorking('');
    }
  }

  async function handleSetStatus(item, status) {
    const note = drafts[item.id]?.note ?? item.note ?? '';
    if (status !== 'completed' && item.required && !note.trim()) {
      setError(`Add a note explaining why "${item.label}" wasn't completed.`);
      return;
    }
    setWorking(item.id);
    setError('');
    setNotice('');
    try {
      const saved = await setMyOperationItem(item.id, status, { note, photoUrl: item.photo_url || '' });
      if (!saved?.id) throw new Error('Checklist update was not confirmed.');
      await load();
      setNotice(status === 'pending' ? 'Task reopened.' : 'Progress saved automatically.');
    } catch (err) {
      setError(err.message || 'Unable to update this task.');
    } finally {
      setWorking('');
    }
  }

  async function handlePhoto(item, file) {
    if (!file) return;
    setWorking(`${item.id}-photo`);
    try {
      const photoUrl = await uploadChecklistPhoto(item.id, file);
      const note = drafts[item.id]?.note ?? item.note ?? '';
      const nextStatus = item.status === 'pending' ? 'completed' : item.status;
      await setMyOperationItem(item.id, nextStatus, { note, photoUrl });
      await load();
      setNotice('Photo and progress saved automatically.');
    } catch (err) {
      setError(err.message || 'Unable to upload that photo.');
    } finally {
      setWorking('');
    }
  }

  async function handleConfirm() {
    setWorking('confirm');
    try {
      const result = await confirmMyOperationShift(businessUnitId, checklistType);
      if (!result?.confirmed) setError(result?.message || 'Required tasks remain.');
      else {
        await load();
        setNotice('Shift checklist confirmed and recorded.');
      }
    } catch (err) {
      setError(err.message || 'Unable to confirm this shift.');
    } finally {
      setWorking('');
    }
  }

  function renderItem(item) {
    const isPending = item.status === 'pending';
    const busy = working === item.id || working === `${item.id}-photo`;
    const expanded = expandedItemId === item.id;
    return (
      <div className={`occ-item occ-item--${item.status}`} key={item.id}>
        <div className="occ-item__row">
          <button aria-label={isPending ? `Mark ${item.label} done` : `Reopen ${item.label}`} className={`occ-item__check ${isPending ? '' : `occ-item__check--${item.status}`}`} disabled={readOnly || busy} onClick={() => handleSetStatus(item, isPending ? 'completed' : 'pending')} type="button">
            {!isPending ? (item.status === 'completed' ? <CheckCircle2 size={17} /> : <XCircle size={17} />) : null}
          </button>
          <button className="occ-item__main occ-item__main--button" onClick={() => setExpandedItemId(expanded ? null : item.id)} type="button">
            <span className="occ-item__label">{item.label}{!item.required ? <em> (optional)</em> : null}</span>
            {!isPending ? <small className="occ-item__meta">{STATUS_LABEL[item.status] || item.status}{item.completed_by_name ? ` · ${item.completed_by_name}` : ''}</small> : null}
            {item.note ? <small className="occ-item__note"><MessageSquareText size={12} /> {item.note}</small> : null}
          </button>
          <button className="occ-item__more" onClick={() => setExpandedItemId(expanded ? null : item.id)} type="button">{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
        </div>
        {expanded ? (
          <div className="occ-item__actions">
            <input className="occ-item__note-input" disabled={readOnly || busy} onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: { note: event.target.value } }))} placeholder="Note / issue" value={drafts[item.id]?.note ?? item.note ?? ''} />
            <div className="occ-item__buttons">
              {isPending ? <button className="ghost-button small" onClick={() => handleSetStatus(item, 'skipped')} type="button">Skip</button> : null}
              {isPending ? <button className="ghost-button small danger-action" onClick={() => handleSetStatus(item, 'could_not_complete')} type="button">Can't complete</button> : null}
              <label className="ghost-button small occ-photo-button"><Camera size={14} /> Photo<input accept="image/*" hidden onChange={(event) => handlePhoto(item, event.target.files?.[0])} type="file" /></label>
              {item.photo_url ? <a className="ghost-button small" href={item.photo_url} rel="noreferrer" target="_blank">View photo</a> : null}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  function renderGroupedChecklist(run, scope, title, description) {
    if (!run) {
      return <div className="occ-claim-card"><div><strong>{title}</strong><p>{description}</p></div><button className="secondary-button small" disabled={readOnly || working === `claim-${scope}`} onClick={() => handleClaim(scope)} type="button">{working === `claim-${scope}` ? 'Starting...' : 'Start / resume'}</button></div>;
    }
    return (
      <div className="occ-checklist occ-checklist--compact">
        <div className="occ-checklist__header"><div><strong>{run.completion_percent}% complete</strong><small> · auto-saved</small></div>{run.final_confirmed_at ? <span className="occ-confirmed-badge"><Lock size={12} /> Confirmed</span> : null}</div>
        <div className="occ-category-list">
          {Object.entries(categories).map(([category, items]) => {
            const progress = groupProgress(items);
            const open = Boolean(openCategories[category]);
            return (
              <section className="occ-category" key={category}>
                <button className="occ-category__header" onClick={() => setOpenCategories((current) => ({ ...current, [category]: !open }))} type="button">
                  <span>{category === 'Restocking & Inventory' ? <PackageCheck size={16} /> : open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}<strong>{category}</strong></span>
                  <small>{progress.done}/{progress.total} · {progress.percent}%</small>
                </button>
                {open ? <div className="occ-category__items">{items.map(renderItem)}</div> : null}
              </section>
            );
          })}
        </div>
      </div>
    );
  }

  if (!businessUnitId) return null;

  return (
    <section className="panel full-span occ-panel">
      <div className="section-header">
        <div><span>{cleanerMode ? 'Operations Cleaning' : 'Daily compliance'}</span><h2>{cleanerMode ? 'Whole-salon cleaning, restocking & inventory' : 'My station & salon responsibilities'}</h2></div>
        {!cleanerMode ? <div className="occ-type-toggle">{CHECKLIST_TYPES.map((type) => <button className={checklistType === type.id ? 'active' : ''} key={type.id} onClick={() => setChecklistType(type.id)} type="button">{type.label}</button>)}</div> : null}
      </div>

      {cleanerMode ? <div className="occ-cleaner-scope-note"><strong>Whole shop scope</strong><p>Common areas, reception, washroom, Beauty floor, restocking, inventory checks, maintenance reporting and final walkthrough. Service providers remain responsible for disinfecting/reprocessing their own service tools and stations.</p></div> : <div className="occ-view-toggle"><button className={checklistView === 'station' ? 'active' : ''} onClick={() => setChecklistView('station')} type="button">My Station</button><button className={checklistView === 'shared' ? 'active' : ''} onClick={() => setChecklistView('shared')} type="button">Salon Overall</button>{showAdminTeam ? <button className={checklistView === 'team' ? 'active' : ''} onClick={() => setChecklistView('team')} type="button">Team Today</button> : null}</div>}

      {error ? <div className="alert danger">{error}</div> : null}
      {notice ? <div className="alert success">{notice}</div> : null}
      {loading ? <p className="subtle-text">Loading saved progress...</p> : null}
      {!loading && cleanerMode ? renderGroupedChecklist(activeCleanerRun, 'cleaning', 'Whole Salon', 'Start once, then resume throughout the shift. Progress stays saved.') : null}
      {!loading && !cleanerMode && checklistView === 'station' ? renderGroupedChecklist(stationRun, 'station', 'My Station', 'Tasks are matched to your role and services.') : null}
      {!loading && !cleanerMode && checklistView === 'shared' ? <>{renderGroupedChecklist(sharedRun, 'shared', 'Salon Overall', 'Shared opening/closing responsibilities.')}{sharedRun && !sharedRun.final_confirmed_at ? <button className="primary-button full-width occ-confirm-button" disabled={working === 'confirm'} onClick={handleConfirm} type="button">{working === 'confirm' ? 'Confirming...' : `Confirm ${checklistType}`}</button> : null}</> : null}

      {!loading && showAdminTeam && checklistView === 'team' ? <div className="occ-team-today">{teamStatusError ? <div className="alert danger">{teamStatusError}</div> : null}{teamStatusLoading ? <p className="subtle-text">Loading team status...</p> : <div className="occ-history-grid">{teamStatus.map((run) => <div className="occ-history-card" key={run.id}><strong>{run.scope === 'station' ? run.owner?.full_name || 'Staff' : run.scope === 'cleaning' ? 'Operations Cleaning' : 'Salon Overall'}</strong><span>{run.completion_percent}%</span><small>{run.items?.filter((item) => item.status !== 'pending').length || 0}/{run.items?.length || 0} recorded</small></div>)}</div>}</div> : null}

      <div className="occ-history">
        <button className="occ-history__toggle" onClick={() => setShowHistory((value) => !value)} type="button"><History size={16} /><strong>{cleanerMode ? 'Cleaning history' : 'Checklist history'}</strong><span>{history.length} records</span>{showHistory ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
        {showHistory ? <div className="occ-history-grid">{history.map((row) => <div className="occ-history-card" key={row.id}><strong>{shortDate(row.date)} · {row.scope === 'cleaning' ? 'Whole salon' : row.type}</strong><span>{row.completion_percent}%</span><small>{row.completed_items}/{row.total_items} tasks · {row.staff_name || 'Staff'}</small></div>)}</div> : null}
      </div>
    </section>
  );
}
