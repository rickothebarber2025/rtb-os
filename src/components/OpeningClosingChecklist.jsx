import { useEffect, useState } from 'react';
import { Camera, CheckCircle2, Lock, MessageSquareText, RotateCcw, XCircle } from 'lucide-react';
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
  const [checklistType, setChecklistType] = useState(defaultChecklistType);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState('');
  const [drafts, setDrafts] = useState({});
  const [teamStatus, setTeamStatus] = useState([]);
  const [teamStatusLoading, setTeamStatusLoading] = useState(true);
  const [teamStatusError, setTeamStatusError] = useState('');

  async function loadTeamStatus() {
    if (!isAdmin || !businessUnitId) {
      setTeamStatusLoading(false);
      return;
    }
    setTeamStatusLoading(true);
    setTeamStatusError('');
    try {
      const runs = await getTodayChecklistStatus(businessUnitId, checklistType);
      setTeamStatus(runs || []);
    } catch (err) {
      setTeamStatusError(err.message || 'Unable to load today’s team status.');
    } finally {
      setTeamStatusLoading(false);
    }
  }

  useEffect(() => {
    loadTeamStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessUnitId, checklistType, isAdmin]);

  async function load() {
    if (!businessUnitId) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await getMyDailyOperations(businessUnitId);
      setData(result);
    } catch (err) {
      setError(err.message || 'Unable to load checklists.');
    } finally {
      setLoading(false);
    }
    if (isAdmin) await loadTeamStatus();
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessUnitId]);

  if (!businessUnitId) return null;

  const stationRun = data?.checklists?.find((run) => run.type === checklistType && run.scope === 'station') || null;
  const sharedRun = data?.checklists?.find((run) => run.type === checklistType && run.scope === 'shared') || null;

  async function handleClaim(scope) {
    setWorking(`claim-${scope}`);
    setError('');
    setNotice('');
    try {
      const runId = await claimMyOperationChecklist(businessUnitId, checklistType, scope);
      if (!runId) throw new Error('Checklist start was not confirmed by the database.');
      await load();
      setNotice(`${checklistType === 'opening' ? 'Opening' : 'Closing'} checklist started.`);
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
      setNotice(status === 'pending' ? 'Task reopened.' : 'Task saved and attributed to your account.');
    } catch (err) {
      setError(err.message || 'Unable to update this task. Nothing was marked complete.');
    } finally {
      setWorking('');
    }
  }

  async function handlePhoto(item, file) {
    if (!file) return;
    setWorking(`${item.id}-photo`);
    setError('');
    setNotice('');
    try {
      const photoUrl = await uploadChecklistPhoto(item.id, file);
      const note = drafts[item.id]?.note ?? item.note ?? '';
      const nextStatus = item.status === 'pending' ? 'completed' : item.status;
      const saved = await setMyOperationItem(item.id, nextStatus, { note, photoUrl });
      if (!saved?.id || !saved.completed_by_staff_id) {
        throw new Error('Photo uploaded, but the checklist update was not confirmed.');
      }
      await load();
      setNotice('Photo and checklist update saved.');
    } catch (err) {
      setError(err.message || 'Unable to upload that photo.');
    } finally {
      setWorking('');
    }
  }

  async function handleConfirm() {
    setWorking('confirm');
    setError('');
    setNotice('');
    try {
      const result = await confirmMyOperationShift(businessUnitId, checklistType);
      if (!result?.confirmed) {
        setError(result?.message || 'Some required tasks still need to be completed or explained.');
      } else {
        await load();
        setNotice(`${checklistType === 'opening' ? 'Opening' : 'Closing'} confirmed and recorded under your name.`);
      }
    } catch (err) {
      setError(err.message || 'Unable to confirm this shift. Nothing was finalized.');
    } finally {
      setWorking('');
    }
  }

  function renderItem(item) {
    const isPending = item.status === 'pending';
    const busy = working === item.id || working === `${item.id}-photo`;

    return (
      <div className={`occ-item occ-item--${item.status}`} key={item.id}>
        <div className="occ-item__main">
          <span className="occ-item__label">
            {item.label}
            {!item.required ? <em> (optional)</em> : null}
          </span>
          {!isPending ? (
            <small className="occ-item__meta">
              {STATUS_LABEL[item.status] || item.status}
              {item.completed_by_name ? ` by ${item.completed_by_name}` : ''}
            </small>
          ) : null}
          {item.note ? (
            <small className="occ-item__note">
              <MessageSquareText size={12} /> {item.note}
            </small>
          ) : null}
          {item.photo_url ? (
            <a className="occ-item__photo-link" href={item.photo_url} rel="noreferrer" target="_blank">
              <Camera size={12} /> View photo
            </a>
          ) : null}
        </div>

        {isPending ? (
          <div className="occ-item__actions">
            <input
              className="occ-item__note-input"
              disabled={readOnly || busy}
              onChange={(event) =>
                setDrafts((current) => ({ ...current, [item.id]: { note: event.target.value } }))
              }
              placeholder="Optional note"
              value={drafts[item.id]?.note ?? ''}
            />
            <div className="occ-item__buttons">
              <button
                className="ghost-button small success-action"
                disabled={readOnly || busy}
                onClick={() => handleSetStatus(item, 'completed')}
                type="button"
              >
                <CheckCircle2 size={14} /> {busy ? 'Saving...' : 'Done'}
              </button>
              <button
                className="ghost-button small"
                disabled={readOnly || busy}
                onClick={() => handleSetStatus(item, 'skipped')}
                type="button"
              >
                Skip
              </button>
              <button
                className="ghost-button small danger-action"
                disabled={readOnly || busy}
                onClick={() => handleSetStatus(item, 'could_not_complete')}
                type="button"
              >
                <XCircle size={14} /> Can't complete
              </button>
              <label className="ghost-button small occ-photo-button">
                <Camera size={14} />
                <input
                  accept="image/*"
                  disabled={readOnly || busy}
                  hidden
                  onChange={(event) => handlePhoto(item, event.target.files?.[0])}
                  type="file"
                />
              </label>
            </div>
          </div>
        ) : (
          <button
            className="ghost-button small"
            disabled={readOnly || busy}
            onClick={() => handleSetStatus(item, 'pending')}
            type="button"
          >
            <RotateCcw size={14} /> Reopen
          </button>
        )}
      </div>
    );
  }

  function renderChecklist(run, scope, title, description) {
    if (!run) {
      return (
        <div className="occ-claim-card">
          <div>
            <strong>{title}</strong>
            <p>{description}</p>
          </div>
          <button
            className="secondary-button small"
            disabled={readOnly || working === `claim-${scope}`}
            onClick={() => handleClaim(scope)}
            type="button"
          >
            {working === `claim-${scope}` ? 'Starting...' : 'Start checklist'}
          </button>
        </div>
      );
    }

    return (
      <div className="occ-checklist">
        <div className="occ-checklist__header">
          <strong>{run.completion_percent}% complete</strong>
          {run.final_confirmed_at ? (
            <span className="occ-confirmed-badge">
              <Lock size={12} /> Confirmed by {run.final_confirmed_by_name}
            </span>
          ) : null}
        </div>
        <div className="occ-item-list">{run.items.map(renderItem)}</div>
      </div>
    );
  }

  return (
    <section className="panel full-span occ-panel">
      <div className="section-header">
        <div>
          <span>Opening / Closing</span>
          <h2>Station and shared responsibilities</h2>
        </div>
        <div className="occ-type-toggle">
          {CHECKLIST_TYPES.map((type) => (
            <button
              className={checklistType === type.id ? 'active' : ''}
              key={type.id}
              onClick={() => setChecklistType(type.id)}
              type="button"
            >
              {type.label}
            </button>
          ))}
        </div>
      </div>

      {isAdmin ? (
        <div className="occ-team-today">
          <div className="occ-team-today__header">
            <span>Team today · {checklistType}</span>
          </div>
          {teamStatusError ? <div className="alert danger">{teamStatusError}</div> : null}
          {teamStatusLoading ? (
            <p className="subtle-text">Loading team status...</p>
          ) : teamStatus.length ? (
            <div className="occ-team-today__grid">
              {teamStatus.map((run) => (
                <div className="occ-team-today__card" key={run.id}>
                  <div className="occ-team-today__card-header">
                    <strong>{run.scope === 'station' ? run.owner?.full_name || 'Unknown staff' : 'Shared shop'}</strong>
                    <span>{run.completion_percent}%</span>
                  </div>
                  <ul>
                    {(run.items || []).map((item) => (
                      <li key={item.id} className={`occ-team-today__item occ-team-today__item--${item.status}`}>
                        <span>{item.label}</span>
                        <small>
                          {item.status === 'pending'
                            ? 'Not done'
                            : `${STATUS_LABEL[item.status] || item.status}${item.completed_by?.full_name ? ` by ${item.completed_by.full_name}` : ''}`}
                        </small>
                        {item.note ? <em>{item.note}</em> : null}
                      </li>
                    ))}
                  </ul>
                  {run.scope === 'shared' ? (
                    <div className="occ-team-today__confirm">
                      {run.final_confirmed_at
                        ? `Confirmed by ${run.confirmed_by?.full_name || 'someone'}`
                        : 'Not confirmed yet'}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="subtle-text">Nobody has started {checklistType} checklists yet today.</p>
          )}
        </div>
      ) : null}

      {error ? <div className="alert danger">{error}</div> : null}
      {notice ? <div className="alert success">{notice}</div> : null}

      {loading ? (
        <p className="subtle-text">Loading checklists...</p>
      ) : (
        <div className="occ-grid">
          <div className="occ-column">
            <h3>My Station / Work Area</h3>
            {renderChecklist(stationRun, 'station', 'My Station', 'Your own station — only you can complete these.')}
          </div>
          <div className="occ-column">
            <h3>Shared Shop</h3>
            {renderChecklist(sharedRun, 'shared', 'Shared Shop', 'Any staff member can complete shared responsibilities.')}
            {sharedRun && !sharedRun.final_confirmed_at ? (
              <button
                className="primary-button full-width occ-confirm-button"
                disabled={readOnly || working === 'confirm'}
                onClick={handleConfirm}
                type="button"
              >
                <Lock size={15} /> {working === 'confirm' ? 'Confirming...' : `Confirm ${checklistType}`}
              </button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
