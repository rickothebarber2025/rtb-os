import { useEffect, useMemo, useState } from 'react';
import {
  BookOpenCheck,
  Check,
  ClipboardCheck,
  ClipboardList,
  Download,
  FileText,
  GraduationCap,
  Plus,
  RefreshCw,
  SquarePen,
  Trash2,
} from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';
import LoadingState from '../components/LoadingState';
import Modal from '../components/Modal';
import { getAppSetting, saveAppSetting } from '../services/rtbService';
import { getCombinedStaffRoles, getStaffRolesForBusinessName } from '../utils/businessProfiles';
import {
  COMMISSION_TIERS,
  FINANCE_CLOSE_STEPS,
  FORM_TEMPLATES,
  HIRE_STEPS,
  MARKETING_HASHTAGS,
  OPERATING_RHYTHM,
  OPERATIONS_SETTING_KEY,
  OPERATION_CHECKLISTS,
  SQUARE_SETUP_STEPS,
  TRAINING_SECTIONS,
  createDefaultOperationsState,
  getChecklistProgress,
  normalizeOperationsState,
} from '../utils/operationsManual';

const TAB_ITEMS = [
  { icon: ClipboardCheck, id: 'sops', label: 'SOPs' },
  { icon: ClipboardList, id: 'hiring', label: 'Hiring' },
  { icon: FileText, id: 'forms', label: 'Forms' },
  { icon: GraduationCap, id: 'training', label: 'Training' },
  { icon: BookOpenCheck, id: 'reference', label: 'Reference' },
  { icon: RefreshCw, id: 'updates', label: 'Updates' },
];

const SHOP_OPTIONS = ['RTB Lounge', 'RTB Beauty Lounge', 'Both businesses'];

function dateKey(value = new Date()) {
  return value.toISOString().slice(0, 10);
}

function monthLabel(value = new Date()) {
  return value.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function createId(prefix) {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getOperationsRoleOptions(shop, fallbackBusinessName) {
  if (shop === 'Both businesses') return getCombinedStaffRoles();
  return getStaffRolesForBusinessName(shop || fallbackBusinessName);
}

function blankHire(businessUnitName) {
  const roleOptions = getOperationsRoleOptions(businessUnitName, businessUnitName);

  return {
    date: dateKey(),
    name: '',
    role: roleOptions[0],
    shop: businessUnitName || 'RTB Lounge',
  };
}

function formatDate(value) {
  if (!value) return 'Not set';
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00`));
}

function updatePdfCursor(doc, y) {
  if (y <= 720) return y;
  doc.addPage();
  return 64;
}

function writePdfHeader(doc, title, subtitle) {
  doc.setFillColor(8, 9, 13);
  doc.rect(0, 0, 612, 792, 'F');
  doc.setTextColor(214, 168, 79);
  doc.setFont('times', 'bold');
  doc.setFontSize(24);
  doc.text('RTB OS', 54, 58);
  doc.setTextColor(247, 243, 232);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(title, 54, 96);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(167, 173, 186);
  doc.text(subtitle, 54, 116);
}

async function downloadPdf(title, subtitle, sections, filename) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ format: 'letter', unit: 'pt' });
  writePdfHeader(doc, title, subtitle);
  let y = 152;

  sections.forEach((section) => {
    y = updatePdfCursor(doc, y + 10);
    doc.setTextColor(214, 168, 79);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(section.title, 54, y);
    y += 20;

    doc.setTextColor(247, 243, 232);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);

    section.lines.forEach((line) => {
      const wrapped = doc.splitTextToSize(line, 500);
      wrapped.forEach((part) => {
        y = updatePdfCursor(doc, y);
        doc.text(part, 70, y);
        y += 15;
      });
      y += 3;
    });
  });

  y = updatePdfCursor(doc, y + 18);
  doc.setDrawColor(113, 120, 136);
  doc.line(54, y, 250, y);
  doc.line(340, y, 536, y);
  doc.setTextColor(167, 173, 186);
  doc.setFontSize(9);
  doc.text('Team member / completed by', 54, y + 14);
  doc.text('RTB representative', 340, y + 14);
  doc.save(filename);
}

function ChecklistCard({ checklist, checklistKey, checks, onDownload, onReset, onToggle }) {
  const progress = getChecklistProgress(checklist.items, checks);

  return (
    <article className="ops-checklist-card">
      <div className="section-header">
        <div>
          <span>{checklist.cadence}</span>
          <h2>{checklist.title}</h2>
        </div>
        <div className="action-row">
          <button className="ghost-button small" type="button" onClick={() => onDownload(checklistKey)}>
            <Download size={15} />
            PDF
          </button>
          <button className="ghost-button small" type="button" onClick={() => onReset(checklistKey)}>
            Reset
          </button>
        </div>
      </div>
      <div className="ops-progress">
        <span style={{ width: `${progress.percent}%` }} />
      </div>
      <div className="ops-progress-meta">
        <strong>{progress.percent}% complete</strong>
        <span>{progress.done} of {progress.total}</span>
      </div>
      <div className="ops-checklist-items">
        {checklist.items.map((item, index) => (
          <button
            className={`ops-check-item ${checks[index] ? 'done' : ''}`}
            key={item}
            type="button"
            onClick={() => onToggle(checklistKey, index)}
          >
            <span>{checks[index] ? <Check size={15} /> : null}</span>
            {item}
          </button>
        ))}
      </div>
    </article>
  );
}

function FormPreview({ form }) {
  return (
    <div className="ops-template-preview">
      {form.sections.map(([title, lines]) => (
        <section key={title}>
          <h3>{title}</h3>
          <ul>
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default function OperationsPage({ businessUnit, staff }) {
  const [activeTab, setActiveTab] = useState('sops');
  const [state, setState] = useState(() => createDefaultOperationsState());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [hireForm, setHireForm] = useState(() => blankHire(businessUnit?.name));
  const [editingHire, setEditingHire] = useState(null);
  const [selectedForm, setSelectedForm] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [logNote, setLogNote] = useState('');

  const activeStaff = useMemo(
    () => staff.filter((member) => member.active).map((member) => member.full_name),
    [staff],
  );
  const hireRoleOptions = useMemo(
    () => getOperationsRoleOptions(hireForm.shop, businessUnit?.name),
    [businessUnit?.name, hireForm.shop],
  );
  const editingHireRoleOptions = useMemo(() => {
    if (!editingHire) return [];
    return [
      ...new Set(
        [editingHire.role, ...getOperationsRoleOptions(editingHire.shop, businessUnit?.name)].filter(Boolean),
      ),
    ];
  }, [businessUnit?.name, editingHire]);

  useEffect(() => {
    let cancelled = false;

    async function loadOperationsState() {
      setLoading(true);
      setError('');

      try {
        const saved = await getAppSetting(OPERATIONS_SETTING_KEY);
        if (!cancelled) setState(normalizeOperationsState(saved));
      } catch (err) {
        if (!cancelled) setError(err.message || 'Unable to load operations data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadOperationsState();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setHireForm((current) => {
      const shop = current.shop || businessUnit?.name || 'RTB Lounge';
      const roleOptions = getOperationsRoleOptions(shop, businessUnit?.name);

      return {
        ...current,
        role: roleOptions.includes(current.role) ? current.role : roleOptions[0],
        shop,
      };
    });
  }, [businessUnit?.name]);

  async function persist(nextState, successMessage) {
    setState(nextState);
    setSaving(true);
    setError('');
    setNotice('');

    try {
      await saveAppSetting(OPERATIONS_SETTING_KEY, nextState);
      if (successMessage) setNotice(successMessage);
    } catch (err) {
      setError(err.message || 'Unable to save operations data.');
    } finally {
      setSaving(false);
    }
  }

  function toggleChecklistItem(checklistKey, index) {
    const current = state.checklists[checklistKey] || [];
    const updated = current.map((checked, itemIndex) => (itemIndex === index ? !checked : checked));
    persist(
      {
        ...state,
        checklists: {
          ...state.checklists,
          [checklistKey]: updated,
        },
      },
      'Checklist updated.',
    );
  }

  function resetChecklist(checklistKey) {
    const checklist = OPERATION_CHECKLISTS[checklistKey];
    persist(
      {
        ...state,
        checklists: {
          ...state.checklists,
          [checklistKey]: checklist.items.map(() => false),
        },
      },
      `${checklist.title} reset.`,
    );
  }

  function addHire(event) {
    event.preventDefault();
    const name = hireForm.name.trim();
    if (!name) {
      setError('Add a staff name before creating a workflow.');
      return;
    }

    const nextHire = {
      ...hireForm,
      id: createId('hire'),
      name,
      stepDates: HIRE_STEPS.map(() => ''),
      steps: HIRE_STEPS.map(() => false),
    };

    persist(
      {
        ...state,
        hires: [nextHire, ...state.hires],
      },
      `${name} was added to the hiring workflow.`,
    );
    setHireForm(blankHire(businessUnit?.name));
  }

  function updateHireStep(hireId, stepIndex) {
    const hires = state.hires.map((hire) => {
      if (hire.id !== hireId) return hire;

      const steps = HIRE_STEPS.map((_, index) => Boolean(hire.steps?.[index]));
      const stepDates = HIRE_STEPS.map((_, index) => hire.stepDates?.[index] || '');
      steps[stepIndex] = !steps[stepIndex];
      stepDates[stepIndex] = steps[stepIndex] ? dateKey() : '';

      return { ...hire, stepDates, steps };
    });

    persist({ ...state, hires }, 'Hiring workflow updated.');
  }

  function saveEditedHire(event) {
    event.preventDefault();
    const name = editingHire.name.trim();
    if (!name) {
      setError('Staff name cannot be blank.');
      return;
    }

    const hires = state.hires.map((hire) =>
      hire.id === editingHire.id ? { ...hire, ...editingHire, name } : hire,
    );
    persist({ ...state, hires }, `${name} was updated.`);
    setEditingHire(null);
  }

  function deleteHire(hireId) {
    const hire = state.hires.find((item) => item.id === hireId);
    setConfirmAction({
      description: `Remove ${hire?.name || 'this workflow'} from the operations tracker? This only removes the onboarding workflow and does not delete their roster profile.`,
      label: 'Remove workflow',
      run: () =>
        persist(
          {
            ...state,
            hires: state.hires.filter((item) => item.id !== hireId),
          },
          'Hiring workflow removed.',
        ),
      tone: 'danger',
      title: 'Remove hiring workflow',
    });
  }

  function addChangeLog(event) {
    event.preventDefault();
    const note = logNote.trim();
    if (!note) return;

    persist(
      {
        ...state,
        changelog: [{ date: monthLabel(), note }, ...state.changelog],
      },
      'Change logged.',
    );
    setLogNote('');
  }

  function deleteChangeLog(index) {
    setConfirmAction({
      description: 'Remove this change-log note? This is only for cleaning up mistakes in the log.',
      label: 'Remove note',
      run: () =>
        persist(
          {
            ...state,
            changelog: state.changelog.filter((_, itemIndex) => itemIndex !== index),
          },
          'Change-log note removed.',
        ),
      tone: 'danger',
      title: 'Remove change-log note',
    });
  }

  async function runConfirmedAction() {
    if (!confirmAction) return;
    await confirmAction.run();
    setConfirmAction(null);
  }

  function downloadChecklistPdf(checklistKey) {
    const checklist = OPERATION_CHECKLISTS[checklistKey];
    const checks = state.checklists[checklistKey] || [];
    const progress = getChecklistProgress(checklist.items, checks);
    downloadPdf(
      checklist.title,
      `${checklist.cadence} - ${progress.done} of ${progress.total} complete`,
      [
        {
          lines: checklist.items.map((item, index) => `${checks[index] ? '[x]' : '[ ]'} ${item}`),
          title: 'Checklist',
        },
      ],
      `rtb-${checklistKey}-checklist.pdf`,
    );
  }

  function downloadHirePdf(hire) {
    const steps = HIRE_STEPS.map((step, index) => {
      const done = Boolean(hire.steps?.[index]);
      const date = hire.stepDates?.[index] ? ` - ${formatDate(hire.stepDates[index])}` : '';
      return `${done ? '[x]' : '[ ]'} ${step.title}${date}: ${step.detail}`;
    });

    downloadPdf(
      `${hire.name} onboarding workflow`,
      `${hire.role} - ${hire.shop} - started ${formatDate(hire.date)}`,
      [{ lines: steps, title: 'Workflow status' }],
      `rtb-${hire.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-onboarding.pdf`,
    );
  }

  function downloadFormPdf(form) {
    downloadPdf(
      form.name,
      `${form.tag} template - RTB Lounge / RTB Beauty Lounge`,
      form.sections.map(([title, lines]) => ({ lines, title })),
      `rtb-${form.id}.pdf`,
    );
  }

  function renderSops() {
    return (
      <div className="ops-checklist-grid">
        {Object.entries(OPERATION_CHECKLISTS).map(([key, checklist]) => (
          <ChecklistCard
            checklist={checklist}
            checklistKey={key}
            checks={state.checklists[key] || []}
            key={key}
            onDownload={downloadChecklistPdf}
            onReset={resetChecklist}
            onToggle={toggleChecklistItem}
          />
        ))}
      </div>
    );
  }

  function renderHiring() {
    return (
      <div className="ops-two-column">
        <section className="panel">
          <div className="section-header">
            <div>
              <span>Onboarding</span>
              <h2>Add staff to workflow</h2>
            </div>
          </div>
          <form className="stack" onSubmit={addHire}>
            <label className="field">
              <span>Staff member</span>
              <input
                list="operations-staff-list"
                placeholder="Type a name or pick from roster"
                value={hireForm.name}
                onChange={(event) => setHireForm({ ...hireForm, name: event.target.value })}
              />
              <datalist id="operations-staff-list">
                {activeStaff.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </label>
            <div className="form-grid">
              <label className="field">
                <span>Role</span>
                <select
                  value={hireForm.role}
                  onChange={(event) => setHireForm({ ...hireForm, role: event.target.value })}
                >
                  {hireRoleOptions.map((role) => (
                    <option key={role}>{role}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Shop</span>
                <select
                  value={hireForm.shop}
                  onChange={(event) => {
                    const shop = event.target.value;
                    const roleOptions = getOperationsRoleOptions(shop, businessUnit?.name);
                    setHireForm({
                      ...hireForm,
                      role: roleOptions.includes(hireForm.role) ? hireForm.role : roleOptions[0],
                      shop,
                    });
                  }}
                >
                  {SHOP_OPTIONS.map((shop) => (
                    <option key={shop}>{shop}</option>
                  ))}
                </select>
              </label>
              <label className="field wide">
                <span>Start date</span>
                <input
                  type="date"
                  value={hireForm.date}
                  onChange={(event) => setHireForm({ ...hireForm, date: event.target.value })}
                />
              </label>
            </div>
            <button className="primary-button" disabled={saving} type="submit">
              <Plus size={16} />
              Add workflow
            </button>
          </form>
        </section>

        <section className="panel">
          <div className="section-header">
            <div>
              <span>Reference</span>
              <h2>9-step hiring workflow</h2>
            </div>
          </div>
          <ol className="ops-reference-list">
            {HIRE_STEPS.map((step) => (
              <li key={step.title}>
                <strong>{step.title}</strong>
                <span>{step.detail}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="panel full-span">
          <div className="section-header">
            <div>
              <span>Active workflows</span>
              <h2>Staff process tracker</h2>
            </div>
          </div>
          {state.hires.length ? (
            <div className="ops-hire-list">
              {state.hires.map((hire) => {
                const progress = getChecklistProgress(HIRE_STEPS, hire.steps);
                return (
                  <article className="ops-hire-card" key={hire.id}>
                    <div className="ops-hire-card__top">
                      <div>
                        <strong>{hire.name}</strong>
                        <span>{hire.role} - {hire.shop} - started {formatDate(hire.date)}</span>
                      </div>
                      <div className="action-row">
                        <button className="ghost-button small" type="button" onClick={() => downloadHirePdf(hire)}>
                          <Download size={15} />
                          PDF
                        </button>
                        <button className="ghost-button small" type="button" onClick={() => setEditingHire(hire)}>
                          <SquarePen size={15} />
                          Edit
                        </button>
                        <button className="ghost-button small danger-action" type="button" onClick={() => deleteHire(hire.id)}>
                          <Trash2 size={15} />
                          Remove
                        </button>
                      </div>
                    </div>
                    <div className="ops-progress">
                      <span style={{ width: `${progress.percent}%` }} />
                    </div>
                    <div className="ops-progress-meta">
                      <strong>{progress.percent}% complete</strong>
                      <span>{progress.done} of {progress.total}</span>
                    </div>
                    <div className="ops-step-grid">
                      {HIRE_STEPS.map((step, index) => (
                        <button
                          className={`ops-step ${hire.steps?.[index] ? 'done' : ''}`}
                          key={step.title}
                          type="button"
                          onClick={() => updateHireStep(hire.id, index)}
                        >
                          <span>{index + 1}</span>
                          <strong>{step.title}</strong>
                          <small>{hire.stepDates?.[index] ? formatDate(hire.stepDates[index]) : step.detail}</small>
                        </button>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-state compact">
              <h3>No hiring workflows yet</h3>
              <p>Add someone above when they enter the onboarding process.</p>
            </div>
          )}
        </section>
      </div>
    );
  }

  function renderForms() {
    return (
      <div className="ops-form-grid">
        {FORM_TEMPLATES.map((form) => (
          <article className="ops-form-card" key={form.id}>
            <div>
              <span>{form.tag}</span>
              <h2>{form.name}</h2>
              <p>{form.description}</p>
            </div>
            <div className="action-row">
              <button className="ghost-button small" type="button" onClick={() => setSelectedForm(form)}>
                Open
              </button>
              <button className="primary-button small" type="button" onClick={() => downloadFormPdf(form)}>
                <Download size={15} />
                PDF
              </button>
            </div>
          </article>
        ))}
      </div>
    );
  }

  function renderTraining() {
    return (
      <div className="ops-training-grid">
        {TRAINING_SECTIONS.map((section) => (
          <section className="panel" key={section.title}>
            <div className="section-header">
              <div>
                <span>Training</span>
                <h2>{section.title}</h2>
              </div>
            </div>
            <div className="ops-reference-list">
              {section.rows.map(([label, detail]) => (
                <div className="ops-reference-row" key={label}>
                  <strong>{label}</strong>
                  <span>{detail}</span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  }

  function renderReference() {
    return (
      <div className="ops-reference-layout">
        <section className="panel full-span">
          <div className="section-header">
            <div>
              <span>Commission</span>
              <h2>Tier structure</h2>
            </div>
          </div>
          <div className="ops-tier-grid">
            {COMMISSION_TIERS.map((tier) => (
              <article className={`ops-tier-card ${tier.tone}`} key={tier.name}>
                <div>
                  <span>{tier.duration}</span>
                  <h3>{tier.name}</h3>
                  <strong>{tier.split}</strong>
                </div>
                <ul>
                  {tier.expectations.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <small>{tier.notes.join(' - ')}</small>
              </article>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="section-header">
            <div>
              <span>Rhythm</span>
              <h2>Operating rhythm</h2>
            </div>
          </div>
          <div className="ops-reference-list">
            {OPERATING_RHYTHM.map((group) => (
              <div className="ops-reference-row" key={group.cadence}>
                <strong>{group.cadence}</strong>
                <span>{group.items.join(' - ')}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="section-header">
            <div>
              <span>Square</span>
              <h2>Setup steps</h2>
            </div>
          </div>
          <ol className="ops-reference-list">
            {SQUARE_SETUP_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>

        <section className="panel">
          <div className="section-header">
            <div>
              <span>Finance</span>
              <h2>Month-end close</h2>
            </div>
          </div>
          <ol className="ops-reference-list">
            {FINANCE_CLOSE_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>

        <section className="panel">
          <div className="section-header">
            <div>
              <span>Marketing</span>
              <h2>Standard hashtags</h2>
            </div>
            <button
              className="ghost-button small"
              type="button"
              onClick={() => navigator.clipboard?.writeText(MARKETING_HASHTAGS.join(' '))}
            >
              Copy
            </button>
          </div>
          <div className="ops-chip-list">
            {MARKETING_HASHTAGS.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        </section>
      </div>
    );
  }

  function renderUpdates() {
    return (
      <div className="ops-two-column">
        <section className="panel">
          <div className="section-header">
            <div>
              <span>Change log</span>
              <h2>Add a change</h2>
            </div>
          </div>
          <form className="stack" onSubmit={addChangeLog}>
            <label className="field">
              <span>What changed?</span>
              <textarea
                placeholder="Example: Updated weekend opening time or added a new service rule"
                value={logNote}
                onChange={(event) => setLogNote(event.target.value)}
              />
            </label>
            <button className="primary-button" disabled={saving || !logNote.trim()} type="submit">
              <Plus size={16} />
              Log change
            </button>
          </form>
        </section>
        <section className="panel">
          <div className="section-header">
            <div>
              <span>Status</span>
              <h2>Saved in Supabase</h2>
            </div>
          </div>
          <p className="subtle-text">
            This extension is now part of RTB OS. It saves in the existing app settings record, so
            it follows your login and works from the live Netlify site.
          </p>
        </section>
        <section className="panel full-span">
          <div className="section-header">
            <div>
              <span>History</span>
              <h2>Change log</h2>
            </div>
          </div>
          <div className="ops-log-list">
            {state.changelog.length ? (
              state.changelog.map((item, index) => (
                <article className="ops-log-item" key={`${item.date}-${item.note}`}>
                  <div>
                    <span>{item.date}</span>
                    <p>{item.note}</p>
                  </div>
                  <button
                    className="icon-button small danger"
                    type="button"
                    aria-label="Remove change-log note"
                    onClick={() => deleteChangeLog(index)}
                  >
                    <Trash2 size={15} />
                  </button>
                </article>
              ))
            ) : (
              <div className="empty-state compact">
                <h3>No change-log notes</h3>
                <p>Add notes when a policy, workflow, or form changes.</p>
              </div>
            )}
          </div>
        </section>
      </div>
    );
  }

  function renderActiveTab() {
    if (activeTab === 'hiring') return renderHiring();
    if (activeTab === 'forms') return renderForms();
    if (activeTab === 'training') return renderTraining();
    if (activeTab === 'reference') return renderReference();
    if (activeTab === 'updates') return renderUpdates();
    return renderSops();
  }

  if (loading) {
    return <LoadingState label="Loading operations manual" />;
  }

  return (
    <div className="page-grid operations-page">
      <section className="hero-panel full-span">
        <div>
          <h2>RTB Operating System</h2>
          <p>
            SOPs, hiring workflows, forms, training, and internal process notes for both RTB Lounge
            and RTB Beauty Lounge.
          </p>
        </div>
        <div className="hero-meta">
          <span>{saving ? 'Saving...' : 'Cloud saved'}</span>
          <strong>{businessUnit?.name || 'Both businesses'}</strong>
        </div>
      </section>

      <section className="panel full-span">
        <div className="insight-tabs ops-tabs" role="tablist" aria-label="Operations sections">
          {TAB_ITEMS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                className={activeTab === tab.id ? 'active' : ''}
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </section>

      {notice ? <div className="alert success full-span">{notice}</div> : null}
      {error ? <div className="alert danger full-span">{error}</div> : null}

      <div className="full-span">{renderActiveTab()}</div>

      {selectedForm ? (
        <Modal title={selectedForm.name} onClose={() => setSelectedForm(null)}>
          <p className="modal-description">{selectedForm.description}</p>
          <FormPreview form={selectedForm} />
          <div className="action-row end">
            <button className="ghost-button" type="button" onClick={() => setSelectedForm(null)}>
              Close
            </button>
            <button className="primary-button" type="button" onClick={() => downloadFormPdf(selectedForm)}>
              <Download size={16} />
              Download PDF
            </button>
          </div>
        </Modal>
      ) : null}

      {editingHire ? (
        <Modal title="Edit hiring workflow" onClose={() => setEditingHire(null)}>
          <form className="stack" onSubmit={saveEditedHire}>
            <label className="field">
              <span>Staff member</span>
              <input
                value={editingHire.name}
                onChange={(event) => setEditingHire({ ...editingHire, name: event.target.value })}
              />
            </label>
            <div className="form-grid">
              <label className="field">
                <span>Role</span>
                <select
                  value={editingHire.role}
                  onChange={(event) => setEditingHire({ ...editingHire, role: event.target.value })}
                >
                  {editingHireRoleOptions.map((role) => (
                    <option key={role}>{role}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Shop</span>
                <select
                  value={editingHire.shop}
                  onChange={(event) => {
                    const shop = event.target.value;
                    const roleOptions = getOperationsRoleOptions(shop, businessUnit?.name);
                    setEditingHire({
                      ...editingHire,
                      role: roleOptions.includes(editingHire.role)
                        ? editingHire.role
                        : roleOptions[0],
                      shop,
                    });
                  }}
                >
                  {SHOP_OPTIONS.map((shop) => (
                    <option key={shop}>{shop}</option>
                  ))}
                </select>
              </label>
              <label className="field wide">
                <span>Start date</span>
                <input
                  type="date"
                  value={editingHire.date || ''}
                  onChange={(event) => setEditingHire({ ...editingHire, date: event.target.value })}
                />
              </label>
            </div>
            <div className="action-row end">
              <button className="ghost-button" type="button" onClick={() => setEditingHire(null)}>
                Cancel
              </button>
              <button className="primary-button" disabled={saving} type="submit">
                Save changes
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {confirmAction ? (
        <ConfirmDialog
          busy={saving}
          confirmLabel={confirmAction.label}
          description={confirmAction.description}
          onClose={() => setConfirmAction(null)}
          onConfirm={runConfirmedAction}
          title={confirmAction.title}
          tone={confirmAction.tone}
        />
      ) : null}
    </div>
  );
}
