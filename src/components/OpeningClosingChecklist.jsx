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
import {
  getNextBestChecklistItem,
  getSmartCategoryExpansion,
  getSmartChecklistType,
  getSmartChecklistView,
} from '../utils/smartDefaults.js';

const CHECKLIST_TYPES = [
  { id: 'opening', label: 'Opening' },
  { id: 'closing', label: 'Closing' },
];

const STATUS_LABEL = {
  completed: 'Done',
  could_not_complete: 'Could not complete',
  skipped: 'Skipped',
};

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

function goalGradientCopy(progress) {
  const remaining = Math.max(0, progress.total - progress.done);
  if (!progress.total) return 'Ready when you are';
  if (remaining === 0) return 'Everything is done';
  if (remaining === 1) return 'Final task';
  if (remaining <= 3) return `${remaining} left · almost there`;
  if (progress.percent >= 50) return `${remaining} left · finish strong`;
  return `${remaining} tasks left`;
}

function endowedProgress(progress) {
  if (!progress.total) return 0;
  if (progress.done >= progress.total) return 100;
  // The extra completed step represents real setup already done by RTB OS:
  // role, location, checklist and saved-progress context are prepared before
  // the worker starts. Task completion remains separately displayed truthfully.
  return Math.round(((progress.done + 1) / (progress.total + 1)) * 100);
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
  const [checklistType, setChecklistType] = useState('opening');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState('');
  const [drafts, setDrafts] = useState({});
  const [expandedItemId, setExpandedItemId] = useState(null);
  const [openCategories, setOpenCategories] = useState({});
  const [checklistView, setChecklistView] = useState('station');
  const [teamStatus, setTeamStatus] = useState([]);
  const [teamStatusLoading, setTeamStatusLoading] = useState(false);
  const [teamStatusError, setTeamStatusError] = useState('');
  const [showHistory, setShowHistory] = useState(false);

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

  useEffect(() => {
    const runs = Array.isArray(data?.checklists) ? data.checklists : [];
    if (!runs.length && !cleanerMode) {
      setChecklistType(getSmartChecklistType({ runs }));
      return;
    }

    if (cleanerMode) {
      setChecklistType('opening');
      setChecklistView('cleaning');
      return;
    }

    const smartType = getSmartChecklistType({ runs });
    const smartView = getSmartChecklistView({ profile: authProfile, runs });
    if (smartType !== checklistType) setChecklistType(smartType);
    setChecklistView(smartView);
    // Apply defaults when the daily data set changes; manual choices remain
    // available after this initial context resolution.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.staff_id, cleanerMode]);

  const stationRun = data?.checklists?.find((run) => run.type === checklistType && run.scope === 'station') || null;
  const sharedRun = data?.checklists?.find((run) => run.type === checklistType && run.scope === 'shared') || null;
  const cleaningRun = data?.checklists?.find((run) => run.type === 'opening' && run.scope === 'cleaning') || null;
  const activeCleanerRun = cleaningRun || (cleanerMode ? sharedRun : null);
  const activeRun = cleanerMode ? activeCleanerRun : checklistView === 'shared' ? sharedRun : stationRun;
  const activeItems = activeRun?.items || [];
  const categories = useMemo(() => groupItems(activeItems), [activeItems]);
  const progress = useMemo(() => groupProgress(activeItems), [activeItems]);
  const nextItem = useMemo(() => getNextBestChecklistItem(activeItems), [activeItems]);
  const nextCategory = nextItem?.category || 'General';
  const history = useMemo(() => {
    const rows = Array.isArray(data?.history) ? data.history : [];
    return cleanerMode ? rows.filter((row) => row.scope === 'cleaning' || row.scope === 'shared').slice(0, 30) : rows.slice(0, 20);
  }, [cleanerMode, data?.history]);

  useEffect(() => {
    if (!activeItems.length) return;
    setOpenCategories(getSmartCategoryExpansion(activeItems));
  }, [activeRun?.id]);

  function focusNextItem() {
    if (!nextItem) return;
    setOpenCategories((current) => ({ ...current, [nextCategory]: true }));
    setExpandedItemId(nextItem.id);
    window.setTimeout(() => {
      document.getElementById(`checklist-item-${nextItem.id}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 80);
  }

  async function handleClaim(scope) {
    setWorking(`claim-${scope}`);
    setError('');
    setNotice('');
    try {
      const type = cleanerMode ? 'opening' : checklistType;
      const runId = await claimMyOperationChecklist(businessUnitId, type, scope);
      if (!runId) throw new Error('Checklist start was not confirmed by the database.');
      await load();
      setNotice(cleanerMode ? 'Your cleaning route is ready and saved.' : `${type === 'opening' ? 'Opening' : 'Closing'} is ready and saved.`);
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
      setNotice(status === 'pending' ? 'Task reopened.' : 'Saved. Your next task is ready.');
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
      setNotice('Photo saved. Your progress is up to date.');
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
    const isNext = nextItem?.id === item.id;
    return (
      <div
        className={`occ-item occ-item--${item.status} ${isNext ? 'occ-item--next' : ''}`}
        id={`checklist-item-${item.id}`}
        key={item.id}
      >
        <div className="occ-item__row">
          <button aria-label={isPending ? `Mark ${item.label} done` : `Reopen ${item.label}`} className={`occ-item__check ${isPending ? '' : `occ-item__check--${item.status}`}`} disabled={readOnly || busy} onClick={() => handleSetStatus(item, isPending ? 'completed' : 'pending')} type="button">
            {!isPending ? (item.status === 'completed' ? <CheckCircle2 size={17} /> : <XCircle size={17} />) : null}
          </button>
          <button className="occ-item__main occ-item__main--button" onClick={() => setExpandedItemId(expanded ? null : item.id)} type="button">
            <span className="occ-item__label">{item.label}{!item.required ? <em> (optional)</em> : null}</span>
            {isNext ? <small className="occ-item__meta">Recommended next</small> : null}
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

  function renderSmartFlow(run) {
    if (!run) return null;
    const visualPercent = endowedProgress(progress);
    const nearFinish = progress.percent >= 70;
    return (
      <div className={`smart-flow ${nearFinish ? 'smart-flow--finish' : ''}`}>
        <div className="smart-flow__eyebrow">
          <span>{goalGradientCopy(progress)}</span>
          <span className="smart-flow__head-start"><CheckCircle2 size={13} /> Setup ready</span>
        </div>
        <h3 className="smart-flow__title">
          {progress.done >= progress.total && progress.total
            ? 'You completed the route.'
            : nextItem
              ? `Next: ${nextItem.label}`
              : 'Your work is ready.'}
        </h3>
        <p className="smart-flow__description">
          RTB OS has already selected the right role, location and saved shift context. Complete one task at a time; everything saves automatically.
        </p>
        <div className="smart-flow__track" aria-label={`${progress.percent}% of checklist tasks completed`}>
          <div className="smart-flow__fill" style={{ width: `${visualPercent}%` }} />
        </div>
        <div className="smart-flow__meta">
          <span>{progress.done} of {progress.total} tasks recorded</span>
          <strong>{progress.percent}% actual completion</strong>
        </div>
        {nextItem ? (
          <div className="smart-flow__next">
            <div className="smart-flow__next-copy">
              <small>Best next action</small>
              <strong>{nextItem.label}</strong>
              <span>{nextCategory}</span>
            </div>
            <button className="primary-button smart-flow__action" onClick={focusNextItem} type="button">
              Do this next
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  function renderGroupedChecklist(run, scope, title, description) {
    if (!run) {
      return (
        <div className="occ-claim-card">
          <div>
            <strong>{title}</strong>
            <p>{description}</p>
            <small>Role and location are already set up. Starting creates your saved progress.</small>
          </div>
          <button className="primary-button small" disabled={readOnly || working === `claim-${scope}`} onClick={() => handleClaim(scope)} type="button">
            {working === `claim-${scope}` ? 'Getting it ready...' : 'Start now'}
          </button>
        </div>
      );
    }
    return (
      <div className="occ-checklist occ-checklist--compact">
        {renderSmartFlow(run)}
        <div className="occ-checklist__header"><div><strong>{run.completion_percent}% complete</strong><small> · auto-saved</small></div>{run.final_confirmed_at ? <span className="occ-confirmed-badge"><Lock size={12} /> Confirmed</span> : null}</div>
        <div className="occ-category-list">
          {Object.entries(categories).map(([category, items]) => {
            const categoryProgress = groupProgress(items);
            const open = Boolean(openCategories[category]);
            const current = category === nextCategory && Boolean(nextItem);
            return (
              <section className={`occ-category ${current ? 'occ-category--current' : ''}`} key={category}>
                <button className="occ-category__header" onClick={() => setOpenCategories((currentState) => ({ ...currentState, [category]: !open }))} type="button">
                  <span>{category === 'Restocking & Inventory' || category.endsWith('· Restocking & Inventory') ? <PackageCheck size={16} /> : open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}<strong>{category}</strong></span>
                  <small>{categoryProgress.done}/{categoryProgress.total} · {categoryProgress.percent}%</small>
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
        <div><span>{cleanerMode ? 'Operations Cleaning' : 'Daily compliance'}</span><h2>{cleanerMode ? 'Whole-RTB cleaning, restocking & inventory' : 'My station & salon responsibilities'}</h2></div>
        {!cleanerMode ? <div className="occ-type-toggle">{CHECKLIST_TYPES.map((type) => <button className={checklistType === type.id ? 'active' : ''} key={type.id} onClick={() => setChecklistType(type.id)} type="button">{type.label}</button>)}</div> : null}
      </div>

      {cleanerMode ? <div className="occ-cleaner-scope-note"><strong>Whole RTB scope</strong><p>RTB Lounge + RTB Beauty Lounge. Common areas, reception, washrooms, floors, restocking, inventory checks, maintenance reporting and final walkthrough. Service providers remain responsible for disinfecting/reprocessing their own service tools and stations.</p></div> : <div className="occ-view-toggle"><button className={checklistView === 'station' ? 'active' : ''} onClick={() => setChecklistView('station')} type="button">My Station</button><button className={checklistView === 'shared' ? 'active' : ''} onClick={() => setChecklistView('shared')} type="button">Salon Overall</button>{showAdminTeam ? <button className={checklistView === 'team' ? 'active' : ''} onClick={() => setChecklistView('team')} type="button">Team Today</button> : null}</div>}

      {error ? <div className="alert danger">{error}</div> : null}
      {notice ? <div className="alert success">{notice}</div> : null}
      {loading ? <p className="subtle-text">Finding where you left off...</p> : null}
      {!loading && cleanerMode ? renderGroupedChecklist(activeCleanerRun, 'cleaning', 'Whole RTB', 'One route across both businesses. Start once, resume anytime during the shift.') : null}
      {!loading && !cleanerMode && checklistView === 'station' ? renderGroupedChecklist(stationRun, 'station', 'My Station', 'Matched automatically to your role and services.') : null}
      {!loading && !cleanerMode && checklistView === 'shared' ? <>{renderGroupedChecklist(sharedRun, 'shared', 'Salon Overall', 'Shared opening/closing responsibilities.')}{sharedRun && !sharedRun.final_confirmed_at ? <button className="primary-button full-width occ-confirm-button" disabled={working === 'confirm'} onClick={handleConfirm} type="button">{working === 'confirm' ? 'Confirming...' : progress.percent === 100 ? `Finish ${checklistType}` : `Confirm ${checklistType}`}</button> : null}</> : null}

      {!loading && showAdminTeam && checklistView === 'team' ? <div className="occ-team-today">{teamStatusError ? <div className="alert danger">{teamStatusError}</div> : null}{teamStatusLoading ? <p className="subtle-text">Loading team status...</p> : <div className="occ-history-grid">{teamStatus.map((run) => <div className="occ-history-card" key={run.id}><strong>{run.scope === 'station' ? run.owner?.full_name || 'Staff' : run.scope === 'cleaning' ? 'Operations Cleaning' : 'Salon Overall'}</strong><span>{run.completion_percent}%</span><small>{run.items?.filter((item) => item.status !== 'pending').length || 0}/{run.items?.length || 0} recorded</small></div>)}</div>}</div> : null}

      <div className="occ-history">
        <button className="occ-history__toggle" onClick={() => setShowHistory((value) => !value)} type="button"><History size={16} /><strong>{cleanerMode ? 'Cleaning history' : 'Checklist history'}</strong><span>{history.length} records</span>{showHistory ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
        {showHistory ? <div className="occ-history-grid">{history.map((row) => <div className="occ-history-card" key={row.id}><strong>{shortDate(row.date)} · {row.scope === 'cleaning' ? 'Whole salon' : row.type}</strong><span>{row.completion_percent}%</span><small>{row.completed_items}/{row.total_items} tasks · {row.staff_name || 'Staff'}</small></div>)}</div> : null}
      </div>
    </section>
  );
}
