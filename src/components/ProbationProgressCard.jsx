import { CalendarDays, CheckCircle2, Pencil } from 'lucide-react';
import StatusBadge from './StatusBadge';
import { formatDate } from '../utils/formatters';
import { getProbationInfo } from '../utils/probation';

function daysText(info) {
  if (info.overdue) return `${Math.abs(info.daysLeft)} days overdue`;
  if (info.daysLeft === 0) return 'Graduates today';
  return `${info.daysLeft} days left`;
}

export default function ProbationProgressCard({
  editing = false,
  member,
  onCancelEdit,
  onEdit,
  onGraduate,
  onSaveDate,
  saving = false,
  startDateDraft,
  setStartDateDraft,
  showActions = false,
}) {
  const previewMember = startDateDraft ? { ...member, start_date: startDateDraft } : member;
  const info = getProbationInfo(previewMember);

  return (
    <article className={`probation-card ${info.tone}`}>
      <div className="probation-card__main">
        <div>
          <span>Probation</span>
          <h3>{member.full_name}</h3>
        </div>
        <StatusBadge tone={info.overdue ? 'danger' : info.graduatingSoon ? 'success' : 'gold'}>
          {daysText(info)}
        </StatusBadge>
      </div>

      <div className="probation-progress" aria-label={`Probation progress ${Math.round(info.progress)} percent`}>
        <div style={{ width: `${info.progress}%` }} />
      </div>

      <div className="probation-card__meta">
        <span>
          <CalendarDays size={15} />
          Start {formatDate(info.startDateKey)}
        </span>
        <span>
          <CheckCircle2 size={15} />
          Ends {formatDate(info.endDateKey)}
        </span>
        <span>{info.daysElapsed} days elapsed</span>
      </div>

      {editing ? (
        <div className="probation-edit">
          <label className="field">
            <span>Probation start date</span>
            <input
              onChange={(event) => setStartDateDraft(event.target.value)}
              type="date"
              value={startDateDraft || info.startDateKey}
            />
          </label>
          <div className="action-row end">
            <button className="ghost-button small" type="button" onClick={onCancelEdit}>
              Cancel
            </button>
            <button
              className="primary-button small"
              disabled={saving}
              type="button"
              onClick={() => onSaveDate(startDateDraft || info.startDateKey)}
            >
              Save date
            </button>
          </div>
        </div>
      ) : null}

      {showActions && !editing ? (
        <div className="probation-card__actions">
          <button className="secondary-button small success-action" type="button" onClick={onGraduate}>
            Graduate
          </button>
          <button className="icon-button small" type="button" onClick={onEdit} aria-label={`Edit ${member.full_name} probation date`}>
            <Pencil size={15} />
          </button>
        </div>
      ) : null}
    </article>
  );
}
