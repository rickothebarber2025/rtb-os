import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ClipboardCheck,
  Link,
  Mail,
  MessageSquareText,
  RefreshCw,
  Send,
  Sparkles,
  Star,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import DataTable from '../components/DataTable';
import EmptyState from '../components/EmptyState';
import LoadingState from '../components/LoadingState';
import MetricCard from '../components/MetricCard';
import StatusBadge from '../components/StatusBadge';
import {
  createFeedbackRequest,
  dispatchDueFeedbackRequests,
  expireOldFeedbackRequests,
  getFeedbackDashboard,
  processFeedbackQueue,
  syncBooksyGmail,
  updateImprovementProject,
  updateImprovementTask,
} from '../services/rtbService';
import { canManageAppointments, canManageOperations, canManagePerformance } from '../utils/access';
import { isAllBusinessesUnit } from '../utils/businessProfiles';
import {
  buildCustomerInsightSections,
  calculateFeedbackMetrics,
  getProjectProgress,
} from '../utils/customerIntelligence';
import { formatDateTime, formatNumber, formatPercent } from '../utils/formatters';

function blankRequest(businessUnit, staff = []) {
  const firstStaff = staff.find((member) => member.active !== false);
  return {
    business_id: businessUnit?.id || '',
    customer_email: '',
    customer_name: '',
    customer_phone: '',
    delay_hours: 2,
    delivery_channel: 'email',
    service_name: '',
    staff_id: firstStaff?.id || '',
  };
}

function getToneForPriority(priority) {
  if (priority === 'urgent' || priority === 'high') return 'danger';
  if (priority === 'medium') return 'warning';
  return 'muted';
}

function FeedbackList({ items, title }) {
  return (
    <div className="intelligence-list">
      <h3>{title}</h3>
      {items?.length ? (
        items.map((item) => (
          <div key={typeof item === 'string' ? item : item.key || item.title}>
            <span>{typeof item === 'string' ? item : item.title}</span>
            {typeof item === 'string' ? null : <small>{item.count} mentions</small>}
          </div>
        ))
      ) : (
        <p className="subtle-text">No pattern yet.</p>
      )}
    </div>
  );
}

export default function CustomerIntelligencePage({
  accessProfile,
  businessUnit,
  isAllBusinessesView,
  setActivePage,
  staff,
}) {
  const canEditPerformance = canManagePerformance(accessProfile);
  const canEditAppointments = canManageAppointments(accessProfile);
  const canEditOperations = canManageOperations(accessProfile);
  const [data, setData] = useState(null);
  const [requestForm, setRequestForm] = useState(() => blankRequest(businessUnit, staff));
  const [lastSurveyUrl, setLastSurveyUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [mobileTab, setMobileTab] = useState('overview');
  const mobileGroupClass = (id) => (mobileTab === id ? 'is-active-mobile-tab' : '');

  const scopedBusinessId = isAllBusinessesUnit(businessUnit) ? null : businessUnit?.id;
  const canCreateRequest = Boolean(scopedBusinessId) && canEditPerformance;
  const canRunBooksySync = Boolean(scopedBusinessId) && (canEditAppointments || canEditOperations);
  const syncRuns = data?.syncRuns || [];
  const metrics = useMemo(
    () =>
      calculateFeedbackMetrics({
        requests: data?.requests || [],
        responses: data?.feedback || [],
        summary: data?.summary,
      }),
    [data],
  );
  const insights = useMemo(
    () => buildCustomerInsightSections(data?.feedback || [], data?.projects || []),
    [data],
  );
  const activeProjects = (data?.projects || []).filter(
    (project) => !['done', 'ignored'].includes(project.status),
  );

  useEffect(() => {
    setRequestForm((current) => ({
      ...blankRequest(businessUnit, staff),
      ...current,
      business_id: businessUnit?.id || current.business_id,
    }));
  }, [businessUnit, staff]);

  async function loadDashboard() {
    setLoading(true);
    setError('');

    try {
      setData(await getFeedbackDashboard(scopedBusinessId));
    } catch (err) {
      setError(err.message || 'Unable to load customer intelligence.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedBusinessId]);

  function updateRequestField(field, value) {
    setRequestForm((current) => ({ ...current, [field]: value }));
  }

  async function copySurveyUrl() {
    if (!lastSurveyUrl || !navigator.clipboard?.writeText) return;
    await navigator.clipboard.writeText(lastSurveyUrl);
    setNotice('Survey link copied.');
  }

  async function createRequest(event) {
    event.preventDefault();
    if (!canEditPerformance) {
      setError('Performance edit access is required to create feedback requests.');
      return;
    }

    setWorking('create');
    setError('');
    setNotice('');

    try {
      const result = await createFeedbackRequest(requestForm);
      setLastSurveyUrl(result.request?.surveyUrl || '');
      setRequestForm(blankRequest(businessUnit, staff));
      setNotice('Feedback request created. Send now or copy the survey link.');
      await loadDashboard();
    } catch (err) {
      setError(err.message || 'Unable to create feedback request.');
    } finally {
      setWorking('');
    }
  }

  async function runAction(action) {
    const allowed = action === 'booksy-gmail' ? canRunBooksySync : canEditPerformance;

    if (!allowed) {
      setError('You do not have the required access for this action.');
      return;
    }

    setWorking(action);
    setError('');
    setNotice('');

    try {
      if (action === 'dispatch') {
        const result = await dispatchDueFeedbackRequests(scopedBusinessId);
        setNotice(`${formatNumber(result.dispatched)} sent, ${formatNumber(result.failed)} failed.`);
      }

      if (action === 'expire') {
        const result = await expireOldFeedbackRequests(scopedBusinessId);
        setNotice(`${formatNumber(result.expired)} old links expired.`);
      }

      if (action === 'process') {
        const result = await processFeedbackQueue(scopedBusinessId, 10);
        setNotice(`${formatNumber(result.processed)} feedback analysis jobs processed.`);
      }

      if (action === 'booksy-gmail') {
        const result = await syncBooksyGmail(scopedBusinessId, { maxMessages: 25 });
        setNotice(
          `Booksy Gmail sync complete: ${formatNumber(result.inserted)} new, ${formatNumber(result.updated)} updated, ${formatNumber(result.unresolved)} need review.`,
        );
      }

      await loadDashboard();
    } catch (err) {
      setError(err.message || 'Action failed.');
    } finally {
      setWorking('');
    }
  }

  async function updateProjectStatus(project, status) {
    if (!canEditPerformance) {
      setError('Performance edit access is required to update improvement projects.');
      return;
    }

    setWorking(project.id);
    setError('');

    try {
      await updateImprovementProject(project.id, { status });
      await loadDashboard();
    } catch (err) {
      setError(err.message || 'Unable to update project.');
    } finally {
      setWorking('');
    }
  }

  async function toggleTask(task) {
    if (!canEditPerformance) {
      setError('Performance edit access is required to update improvement tasks.');
      return;
    }

    setWorking(task.id);
    setError('');

    try {
      await updateImprovementTask(task.id, {
        status: task.status === 'done' ? 'open' : 'done',
      });
      await loadDashboard();
    } catch (err) {
      setError(err.message || 'Unable to update task.');
    } finally {
      setWorking('');
    }
  }

  if (loading) return <LoadingState label="Loading customer intelligence" />;

  return (
    <div className="page-grid customer-intelligence-page">
      <section className="hero-panel full-span">
        <div>
          <span className="eyebrow">Customer Intelligence</span>
          <h2>Feedback that turns into action</h2>
          <p>
            Collect post-appointment surveys, analyze recurring issues, and convert customer
            feedback into tracked improvement projects for {businessUnit?.name || 'RTB'}.
          </p>
        </div>
        <div className="action-row">
          <button className="secondary-button" type="button" onClick={loadDashboard}>
            <RefreshCw size={16} />
            Refresh
          </button>
          <button className="primary-button" type="button" onClick={() => setActivePage('ai-consultant')}>
            <Sparkles size={16} />
            AI Consultant
          </button>
        </div>
      </section>

      {notice ? <div className="alert success full-span">{notice}</div> : null}
      {error ? <div className="alert danger full-span">{error}</div> : null}
      {isAllBusinessesView ? (
        <div className="alert warning full-span">
          <strong>All Businesses view is read-only for request creation.</strong>
          <span>Select one business before creating a customer feedback request.</span>
        </div>
      ) : null}
      {!canEditPerformance ? (
        <div className="alert warning full-span">
          <strong>Customer IQ view-only mode.</strong>
          <span>Performance edit access is required to send requests or update projects.</span>
        </div>
      ) : null}

      <nav className="dashboard-mobile-tabs" aria-label="Customer Intelligence sections">
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'activity', label: 'Activity' },
        ].map((tab) => (
          <button
            aria-current={mobileTab === tab.id ? 'page' : undefined}
            className={`dashboard-mobile-tabs__item ${mobileTab === tab.id ? 'active' : ''}`}
            key={tab.id}
            type="button"
            onClick={() => setMobileTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <section className={`metrics-grid ${mobileGroupClass('overview')}`} data-mobile-group="overview">
        <MetricCard icon={Star} label="Average rating" trend="1-5 customer score" value={metrics.averageRating || '0'} />
        <MetricCard icon={Target} label="Customer satisfaction" trend="4+ star responses" value={formatPercent(metrics.customerSatisfaction)} />
        <MetricCard icon={TrendingUp} label="NPS score" trend="Promoters minus detractors" value={metrics.npsScore} />
        <MetricCard icon={MessageSquareText} label="Response rate" trend={`${formatNumber(metrics.completedResponses)} of ${formatNumber(metrics.totalRequests)}`} value={formatPercent(metrics.responseRate)} />
      </section>

      <section className={`panel two-thirds ${mobileGroupClass('overview')}`} data-mobile-group="overview">
        <div className="section-header">
          <div>
            <span>Request feedback</span>
            <h2>Create a survey link</h2>
          </div>
          <StatusBadge tone={canCreateRequest ? 'success' : 'muted'}>
            {canCreateRequest ? 'Ready' : 'Choose business'}
          </StatusBadge>
        </div>

        <form className="form-grid" onSubmit={createRequest}>
          <label className="field">
            <span>Customer name</span>
            <input
              disabled={!canEditPerformance}
              required
              value={requestForm.customer_name}
              onChange={(event) => updateRequestField('customer_name', event.target.value)}
            />
          </label>
          <label className="field">
            <span>Service</span>
            <input
              disabled={!canEditPerformance}
              placeholder="Lash fill, haircut, manicure..."
              value={requestForm.service_name}
              onChange={(event) => updateRequestField('service_name', event.target.value)}
            />
          </label>
          <label className="field">
            <span>Email</span>
            <input
              disabled={!canEditPerformance}
              type="email"
              value={requestForm.customer_email}
              onChange={(event) => updateRequestField('customer_email', event.target.value)}
            />
          </label>
          <label className="field">
            <span>Phone</span>
            <input
              disabled={!canEditPerformance}
              value={requestForm.customer_phone}
              onChange={(event) => updateRequestField('customer_phone', event.target.value)}
            />
          </label>
          <label className="field">
            <span>Staff</span>
            <select
              disabled={!canEditPerformance}
              value={requestForm.staff_id}
              onChange={(event) => updateRequestField('staff_id', event.target.value)}
            >
              <option value="">Unassigned</option>
              {staff.filter((member) => member.active !== false).map((member) => (
                <option key={member.id} value={member.id}>
                  {member.full_name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Delay hours</span>
            <input
              disabled={!canEditPerformance}
              min="0"
              max="168"
              type="number"
              value={requestForm.delay_hours}
              onChange={(event) => updateRequestField('delay_hours', Number(event.target.value))}
            />
          </label>
          <label className="field">
            <span>Send by</span>
            <select
              disabled={!canEditPerformance}
              value={requestForm.delivery_channel}
              onChange={(event) => updateRequestField('delivery_channel', event.target.value)}
            >
              <option value="email">Email</option>
              <option value="sms">SMS</option>
              <option value="manual">Manual link</option>
            </select>
          </label>
          <div className="action-row end wide">
            {lastSurveyUrl ? (
              <button className="secondary-button" type="button" onClick={copySurveyUrl}>
                <Link size={16} />
                Copy last link
              </button>
            ) : null}
            <button
              className="primary-button"
              disabled={!canCreateRequest || working === 'create'}
              title={!canEditPerformance ? 'Performance edit access is required.' : undefined}
              type="submit"
            >
              <Mail size={16} />
              {working === 'create' ? 'Creating...' : 'Create request'}
            </button>
          </div>
        </form>

        {lastSurveyUrl ? (
          <div className="survey-link-box">
            <span>Last survey link</span>
            <code>{lastSurveyUrl}</code>
          </div>
        ) : null}
      </section>

      <section className={`panel ${mobileGroupClass('overview')}`} data-mobile-group="overview">
        <div className="section-header">
          <div>
            <span>Automation</span>
            <h2>Feedback queue</h2>
          </div>
        </div>
        <div className="stack">
          <button
            className="secondary-button"
            disabled={working === 'dispatch' || !canEditPerformance}
            title={!canEditPerformance ? 'Performance edit access is required.' : undefined}
            type="button"
            onClick={() => runAction('dispatch')}
          >
            <Send size={16} />
            Send due requests
          </button>
          <button
            className="secondary-button"
            disabled={working === 'process' || !canEditPerformance}
            title={!canEditPerformance ? 'Performance edit access is required.' : undefined}
            type="button"
            onClick={() => runAction('process')}
          >
            <Sparkles size={16} />
            Process AI queue
          </button>
          <button
            className="secondary-button"
            disabled={working === 'booksy-gmail' || !canRunBooksySync}
            title={!canRunBooksySync ? 'Choose one business and use appointments or operations edit access.' : undefined}
            type="button"
            onClick={() => runAction('booksy-gmail')}
          >
            <RefreshCw size={16} />
            Sync Booksy Gmail
          </button>
          <button
            className="ghost-button"
            disabled={working === 'expire' || !canEditPerformance}
            title={!canEditPerformance ? 'Performance edit access is required.' : undefined}
            type="button"
            onClick={() => runAction('expire')}
          >
            Expire old links
          </button>
          <p className="subtle-text">
            Feedback email requires `RESEND_API_KEY`; Booksy Gmail requires its Supabase function secrets.
          </p>
          {syncRuns[0] ? (
            <div className="survey-link-box">
              <span>Last source sync</span>
              <code>
                {syncRuns[0].source} - {syncRuns[0].status} - {formatDateTime(syncRuns[0].started_at)}
              </code>
            </div>
          ) : null}
        </div>
      </section>

      <section className={`panel full-span ${mobileGroupClass('overview')}`} data-mobile-group="overview">
        <div className="section-header">
          <div>
            <span>Patterns</span>
            <h2>What customers are saying</h2>
          </div>
        </div>
        <div className="intelligence-grid">
          <FeedbackList items={insights.topCompliments} title="Top compliments" />
          <FeedbackList items={insights.topComplaints} title="Top complaints" />
          <FeedbackList items={insights.recurringIssues} title="Recurring issues" />
        </div>
      </section>

      <section className={`panel full-span ${mobileGroupClass('activity')}`} data-mobile-group="activity">
        <div className="section-header">
          <div>
            <span>Projects</span>
            <h2>Improvements created from feedback</h2>
          </div>
        </div>

        {activeProjects.length ? (
          <div className="project-grid">
            {activeProjects.map((project) => (
              <article className="project-card" key={project.id}>
                <div className="project-card__header">
                  <div>
                    <StatusBadge tone={getToneForPriority(project.priority)}>{project.priority}</StatusBadge>
                    <h3>{project.title}</h3>
                    <p>{project.reason}</p>
                  </div>
                  <strong>{getProjectProgress(project)}%</strong>
                </div>
                <div className="project-meta">
                  <span>Cost: {project.estimated_cost}</span>
                  <span>Impact: {project.estimated_revenue_impact}</span>
                  <span>{formatNumber(project.recurring_count)} mentions</span>
                </div>
                <div className="project-progress">
                  <span style={{ width: `${getProjectProgress(project)}%` }} />
                </div>
                <div className="project-tasks">
                  {(project.tasks || []).map((task) => (
                    <button
                      className={task.status === 'done' ? 'done' : ''}
                      disabled={!canEditPerformance}
                      key={task.id}
                      title={!canEditPerformance ? 'Performance edit access is required.' : undefined}
                      type="button"
                      onClick={() => toggleTask(task)}
                    >
                      <ClipboardCheck size={15} />
                      {task.title}
                    </button>
                  ))}
                </div>
                <div className="action-row">
                  <button
                    className="ghost-button small"
                    disabled={!canEditPerformance}
                    title={!canEditPerformance ? 'Performance edit access is required.' : undefined}
                    type="button"
                    onClick={() => updateProjectStatus(project, 'in_progress')}
                  >
                    Start
                  </button>
                  <button
                    className="ghost-button small success-action"
                    disabled={!canEditPerformance}
                    title={!canEditPerformance ? 'Performance edit access is required.' : undefined}
                    type="button"
                    onClick={() => updateProjectStatus(project, 'done')}
                  >
                    Complete
                  </button>
                  <button
                    className="ghost-button small danger-action"
                    disabled={!canEditPerformance}
                    title={!canEditPerformance ? 'Performance edit access is required.' : undefined}
                    type="button"
                    onClick={() => updateProjectStatus(project, 'ignored')}
                  >
                    Ignore
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={TrendingDown}
            title="No feedback projects yet"
            message="Recurring issues will automatically create improvement projects after responses are analyzed."
          />
        )}
      </section>

      <section className={`panel full-span ${mobileGroupClass('activity')}`} data-mobile-group="activity">
        <div className="section-header">
          <div>
            <span>Responses</span>
            <h2>Recent feedback</h2>
          </div>
        </div>
        <DataTable>
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Service</th>
                <th>Rating</th>
                <th>NPS</th>
                <th>Category</th>
                <th>Priority</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {(data?.feedback || []).slice(0, 20).map((row) => (
                <tr key={row.feedback_request_id}>
                  <td>{row.customer_name}</td>
                  <td>{row.service_name}</td>
                  <td>{row.overall_rating ? `${row.overall_rating}/5` : row.request_status}</td>
                  <td>{row.recommend_business ?? '-'}</td>
                  <td>{row.main_category || '-'}</td>
                  <td>
                    {row.priority ? (
                      <StatusBadge tone={getToneForPriority(row.priority)}>{row.priority}</StatusBadge>
                    ) : (
                      <StatusBadge tone="muted">Queued</StatusBadge>
                    )}
                  </td>
                  <td>{formatDateTime(row.response_created_at || row.request_created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      </section>
    </div>
  );
}
