import { useEffect, useMemo, useState } from 'react';
import {
  Brain,
  ClipboardCheck,
  FileText,
  RefreshCw,
  Sparkles,
  Target,
  Trash2,
} from 'lucide-react';
import DataTable from '../components/DataTable';
import EmptyState from '../components/EmptyState';
import LoadingState from '../components/LoadingState';
import MetricCard from '../components/MetricCard';
import StatusBadge from '../components/StatusBadge';
import {
  deleteBusinessIntelligenceSource,
  getBusinessConsultantData,
  runBusinessConsultantAnalysis,
  saveBusinessIntelligenceSource,
  updateImprovementProject,
  updateImprovementTask,
} from '../services/rtbService';
import { isAllBusinessesUnit } from '../utils/businessProfiles';
import {
  SOURCE_TYPES,
  buildConsultantRecommendations,
  buildStaffPerformanceFeedback,
  getProjectProgress,
  getSourceTypeLabel,
} from '../utils/customerIntelligence';
import { formatDate, formatDateTime, formatNumber } from '../utils/formatters';

function blankSource(businessUnit) {
  return {
    body: '',
    business_id: businessUnit?.id || '',
    source_date: new Date().toISOString().slice(0, 10),
    source_type: 'staff_suggestion',
    title: '',
  };
}

function normalizeReport(latestReport, fallback) {
  if (!latestReport) return fallback;
  return {
    biggestProblems: latestReport.biggest_problems || [],
    delegateRecommendations: latestReport.delegate_recommendations || [],
    fixFirst: latestReport.fix_first,
    highestRoi: latestReport.highest_roi,
    lowestCost: latestReport.lowest_cost,
    recurringProblems: latestReport.recurring_problems || [],
    summary: latestReport.summary,
  };
}

function ProjectCard({ onStatus, onTask, project }) {
  return (
    <article className="project-card">
      <div className="project-card__header">
        <div>
          <StatusBadge tone={project.priority === 'high' || project.priority === 'urgent' ? 'danger' : 'warning'}>
            {project.priority}
          </StatusBadge>
          <h3>{project.title}</h3>
          <p>{project.reason}</p>
        </div>
        <strong>{getProjectProgress(project)}%</strong>
      </div>
      <div className="project-meta">
        <span>Cost: {project.estimated_cost}</span>
        <span>Impact: {project.estimated_revenue_impact}</span>
        <span>{formatNumber(project.recurring_count)} signals</span>
      </div>
      <div className="project-progress">
        <span style={{ width: `${getProjectProgress(project)}%` }} />
      </div>
      <div className="project-tasks">
        {(project.tasks || []).map((task) => (
          <button
            className={task.status === 'done' ? 'done' : ''}
            key={task.id}
            type="button"
            onClick={() => onTask(task)}
          >
            <ClipboardCheck size={15} />
            {task.title}
          </button>
        ))}
      </div>
      <div className="action-row">
        <button className="ghost-button small" type="button" onClick={() => onStatus(project, 'in_progress')}>
          Start
        </button>
        <button className="ghost-button small success-action" type="button" onClick={() => onStatus(project, 'done')}>
          Complete
        </button>
      </div>
    </article>
  );
}

export default function AiConsultantPage({ businessUnit, staff, performanceSummary }) {
  const [data, setData] = useState(null);
  const [sourceForm, setSourceForm] = useState(() => blankSource(businessUnit));
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const allBusinessesView = isAllBusinessesUnit(businessUnit);
  const scopedBusinessId = allBusinessesView ? null : businessUnit?.id;
  const fallbackReport = useMemo(
    () =>
      buildConsultantRecommendations({
        feedback: data?.feedback || [],
        projects: data?.projects || [],
        sources: data?.sources || [],
      }),
    [data],
  );
  const report = normalizeReport(data?.latestReport, fallbackReport);
  const openProjects = (data?.projects || []).filter(
    (project) => !['done', 'ignored'].includes(project.status),
  );
  const performanceFeedback = useMemo(
    () => buildStaffPerformanceFeedback(performanceSummary || [], staff || []),
    [performanceSummary, staff],
  );

  async function loadData() {
    setLoading(true);
    setError('');

    try {
      setData(await getBusinessConsultantData(scopedBusinessId));
    } catch (err) {
      setError(err.message || 'Unable to load AI Business Consultant.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setSourceForm(blankSource(businessUnit));
  }, [businessUnit]);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedBusinessId]);

  function updateSourceField(field, value) {
    setSourceForm((current) => ({ ...current, [field]: value }));
  }

  async function saveSource(event) {
    event.preventDefault();
    setWorking('source');
    setError('');
    setNotice('');

    try {
      await saveBusinessIntelligenceSource(sourceForm);
      setSourceForm(blankSource(businessUnit));
      setNotice('Business intelligence source saved.');
      await loadData();
    } catch (err) {
      setError(err.message || 'Unable to save source.');
    } finally {
      setWorking('');
    }
  }

  async function deleteSource(source) {
    setWorking(source.id);
    setError('');
    setNotice('');

    try {
      await deleteBusinessIntelligenceSource(source.id);
      setNotice('Source removed.');
      await loadData();
    } catch (err) {
      setError(err.message || 'Unable to remove source.');
    } finally {
      setWorking('');
    }
  }

  async function generateReport() {
    if (!scopedBusinessId) return;
    setWorking('report');
    setError('');
    setNotice('');

    try {
      await runBusinessConsultantAnalysis(scopedBusinessId);
      setNotice('AI Business Consultant report generated.');
      await loadData();
    } catch (err) {
      setError(err.message || 'Unable to generate consultant report.');
    } finally {
      setWorking('');
    }
  }

  async function updateProjectStatus(project, status) {
    setWorking(project.id);
    setError('');

    try {
      await updateImprovementProject(project.id, { status });
      await loadData();
    } catch (err) {
      setError(err.message || 'Unable to update project.');
    } finally {
      setWorking('');
    }
  }

  async function toggleTask(task) {
    setWorking(task.id);
    setError('');

    try {
      await updateImprovementTask(task.id, {
        status: task.status === 'done' ? 'open' : 'done',
      });
      await loadData();
    } catch (err) {
      setError(err.message || 'Unable to update task.');
    } finally {
      setWorking('');
    }
  }

  if (loading) return <LoadingState label="Loading AI Business Consultant" />;

  return (
    <div className="page-grid ai-consultant-page">
      <section className="hero-panel full-span">
        <div>
          <span className="eyebrow">AI Business Consultant</span>
          <h2>One place for every business signal</h2>
          <p>
            Combine customer feedback, Google reviews, business audits, uploaded document notes,
            staff suggestions, meeting notes, financial reports, and incident reports into the next
            best actions for {businessUnit?.name || 'RTB'}.
          </p>
        </div>
        <div className="action-row">
          <button className="secondary-button" type="button" onClick={loadData}>
            <RefreshCw size={16} />
            Refresh
          </button>
          <button
            className="primary-button"
            disabled={!scopedBusinessId || working === 'report'}
            type="button"
            onClick={generateReport}
          >
            <Sparkles size={16} />
            {working === 'report' ? 'Analyzing...' : 'Generate report'}
          </button>
        </div>
      </section>

      {notice ? <div className="alert success full-span">{notice}</div> : null}
      {error ? <div className="alert danger full-span">{error}</div> : null}
      {allBusinessesView ? (
        <div className="alert warning full-span">
          <strong>Choose one business to generate a report.</strong>
          <span>All Businesses view can show combined data, but AI reports are saved per business.</span>
        </div>
      ) : null}

      <section className="metrics-grid">
        <MetricCard icon={Brain} label="Intelligence sources" trend="Reviews, notes, docs" value={formatNumber(data?.sources?.length || 0)} />
        <MetricCard icon={Target} label="Open projects" trend="Active improvements" value={formatNumber(openProjects.length)} />
        <MetricCard icon={Sparkles} label="AI reports" trend={data?.latestReport ? `Latest ${formatDate(data.latestReport.created_at)}` : 'Not generated yet'} value={formatNumber(data?.reports?.length || 0)} />
        <MetricCard icon={ClipboardCheck} label="Feedback signals" trend="Survey responses" value={formatNumber(data?.feedback?.filter((row) => row.feedback_response_id).length || 0)} />
      </section>

      <section className="panel full-span consultant-summary">
        <div className="section-header">
          <div>
            <span>Readout</span>
            <h2>What RTB OS recommends</h2>
          </div>
          <StatusBadge tone={data?.latestReport ? 'success' : 'muted'}>
            {data?.latestReport ? 'AI report' : 'Live fallback'}
          </StatusBadge>
        </div>
        <p>{report.summary}</p>
        <div className="consultant-answer-grid">
          <div>
            <span>What should I fix first?</span>
            <strong>{report.fixFirst}</strong>
          </div>
          <div>
            <span>Highest ROI</span>
            <strong>{report.highestRoi}</strong>
          </div>
          <div>
            <span>Costs the least</span>
            <strong>{report.lowestCost}</strong>
          </div>
        </div>
      </section>

      <section className="panel full-span performance-feedback-panel">
        <div className="section-header">
          <div>
            <span>Staff coaching</span>
            <h2>Personalized performance feedback</h2>
          </div>
        </div>
        {performanceFeedback.length ? (
          <div className="feedback-cards">
            {performanceFeedback.map((feedback) => (
              <article key={feedback.staff_id} className="feedback-card">
                <div className="feedback-card__header">
                  <div>
                    <strong>{feedback.full_name}</strong>
                    <span>{formatNumber(feedback.weeksRecorded)} weeks recorded</span>
                  </div>
                  <StatusBadge
                    tone={
                      feedback.priority === 'high'
                        ? 'danger'
                        : feedback.priority === 'medium'
                        ? 'warning'
                        : 'success'
                    }
                  >
                    {feedback.priority}
                  </StatusBadge>
                </div>
                <p>{feedback.summary}</p>
                <ul>
                  <li>
                    <strong>Growth:</strong> {feedback.growthTip}
                  </li>
                  <li>
                    <strong>Customer service:</strong> {feedback.customerServiceTip}
                  </li>
                  <li>
                    <strong>Next action:</strong> {feedback.action}
                  </li>
                </ul>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Brain}
            title="No performance coaching yet"
            message="Once payroll and performance data are available, RTB OS can generate coaching insights for each staff member."
          />
        )}
      </section>

      <section className="panel two-thirds">
        <div className="section-header">
          <div>
            <span>Problems</span>
            <h2>Three biggest problems</h2>
          </div>
        </div>
        {report.biggestProblems?.length ? (
          <div className="consultant-problem-list">
            {report.biggestProblems.map((problem, index) => (
              <article key={`${problem.title}-${index}`}>
                <span>{index + 1}</span>
                <div>
                  <h3>{problem.title}</h3>
                  <p>{problem.detail}</p>
                </div>
                <StatusBadge tone={problem.priority === 'high' || problem.priority === 'urgent' ? 'danger' : 'warning'}>
                  {problem.priority || 'medium'}
                </StatusBadge>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Brain}
            title="Not enough intelligence yet"
            message="Add sources or collect feedback to generate a stronger consultant readout."
          />
        )}
      </section>

      <section className="panel">
        <div className="section-header">
          <div>
            <span>Delegate</span>
            <h2>What to delegate</h2>
          </div>
        </div>
        <div className="intelligence-list compact">
          {report.delegateRecommendations?.length ? (
            report.delegateRecommendations.map((item) => (
              <div key={item.task}>
                <span>{item.task}</span>
                <small>{item.why}</small>
              </div>
            ))
          ) : (
            <p className="subtle-text">No delegation recommendations yet.</p>
          )}
        </div>
      </section>

      <section className="panel full-span">
        <div className="section-header">
          <div>
            <span>Add context</span>
            <h2>Business intelligence source</h2>
          </div>
        </div>
        <form className="form-grid" onSubmit={saveSource}>
          <label className="field">
            <span>Source type</span>
            <select
              value={sourceForm.source_type}
              onChange={(event) => updateSourceField('source_type', event.target.value)}
            >
              {SOURCE_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Date</span>
            <input
              type="date"
              value={sourceForm.source_date}
              onChange={(event) => updateSourceField('source_date', event.target.value)}
            />
          </label>
          <label className="field wide">
            <span>Title</span>
            <input
              required
              value={sourceForm.title}
              onChange={(event) => updateSourceField('title', event.target.value)}
            />
          </label>
          <label className="field wide">
            <span>Notes, document text, review, audit, report, or incident details</span>
            <textarea
              required
              value={sourceForm.body}
              onChange={(event) => updateSourceField('body', event.target.value)}
            />
          </label>
          <div className="action-row end wide">
            <button className="primary-button" disabled={!scopedBusinessId || working === 'source'} type="submit">
              <FileText size={16} />
              {working === 'source' ? 'Saving...' : 'Save source'}
            </button>
          </div>
        </form>
      </section>

      <section className="panel full-span">
        <div className="section-header">
          <div>
            <span>Projects</span>
            <h2>Current improvement work</h2>
          </div>
        </div>
        {openProjects.length ? (
          <div className="project-grid">
            {openProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onStatus={updateProjectStatus}
                onTask={toggleTask}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Target}
            title="No active projects"
            message="Recurring customer issues and consultant findings will create projects here."
          />
        )}
      </section>

      <section className="panel full-span">
        <div className="section-header">
          <div>
            <span>Sources</span>
            <h2>Recent intelligence inputs</h2>
          </div>
        </div>
        <DataTable>
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th>Title</th>
                <th>Date</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(data?.sources || []).slice(0, 20).map((source) => (
                <tr key={source.id}>
                  <td>{getSourceTypeLabel(source.source_type)}</td>
                  <td>{source.title}</td>
                  <td>{formatDate(source.source_date)}</td>
                  <td>{formatDateTime(source.created_at)}</td>
                  <td>
                    <button className="icon-button small danger" type="button" onClick={() => deleteSource(source)}>
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      </section>
    </div>
  );
}
