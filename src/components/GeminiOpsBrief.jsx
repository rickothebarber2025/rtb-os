import { useCallback, useMemo, useState } from 'react';
import { Bot, CheckCircle2, ChevronDown, ChevronUp, RefreshCw, Send, Sparkles, X } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import '../styles/geminiOpsBrief.css';

const QUICK_PROMPTS = [
  'What needs my attention right now?',
  'What important staff texts still need action?',
  'What am I personally doing that should be delegated?',
  'Who has unfinished responsibilities today?',
  'What patterns should I address before they become problems?',
];

export default function GeminiOpsBrief({ activePage, businessUnitId }) {
  const [brief, setBrief] = useState(null);
  const [answer, setAnswer] = useState(null);
  const [question, setQuestion] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [asking, setAsking] = useState(false);
  const [caseWorking, setCaseWorking] = useState('');
  const [error, setError] = useState('');
  const [briefLoaded, setBriefLoaded] = useState(false);

  const enabled = useMemo(
    () => Boolean(businessUnitId && businessUnitId !== 'all-businesses' && ['dashboard', 'operations'].includes(activePage)),
    [activePage, businessUnitId],
  );

  const invokeAda = useCallback(async (body) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { data, error: functionError } = await supabase.functions.invoke('ada-agent', { body });
    if (functionError) {
      const response = functionError?.context;
      if (response?.json) {
        try {
          const payload = await (response.clone ? response.clone() : response).json();
          throw new Error(payload?.error || functionError.message);
        } catch (readError) {
          if (readError instanceof Error && readError.message !== functionError.message) throw readError;
        }
      }
      throw new Error(functionError.message || 'Ada request failed.');
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }, []);

  const loadBrief = useCallback(async () => {
    if (!enabled || briefLoaded) return;
    setLoading(true);
    setError('');
    try {
      const [cachedResult, communicationsResult] = await Promise.all([
        supabase.functions.invoke('rtb-gemini', {
          body: { action: 'cached', businessId: businessUnitId },
        }),
        invokeAda({ action: 'communications', businessId: businessUnitId }),
      ]);
      const cached = cachedResult?.error ? null : cachedResult?.data;
      const communicationCases = communicationsResult?.cases || [];
      if (cached?.summary || cached?.answer || communicationCases.length) {
        setBrief({
          ...(cached || {}),
          audience: cached?.audience || 'admin',
          communication_cases: communicationCases,
        });
      }
      setBriefLoaded(true);
    } catch (err) {
      setError('Ada is temporarily unavailable. The rest of RTB OS still works normally.');
      console.warn('Ada brief unavailable', err);
    } finally {
      setLoading(false);
    }
  }, [briefLoaded, businessUnitId, enabled, invokeAda]);

  async function toggleExpanded() {
    const next = !expanded;
    setExpanded(next);
    if (next && !briefLoaded) await loadBrief();
  }

  async function refreshBrief() {
    if (!enabled) return;
    setLoading(true);
    setError('');
    try {
      const result = await invokeAda({ action: 'summary', businessId: businessUnitId });
      setBrief(result);
      setAnswer(null);
      setBriefLoaded(true);
    } catch (err) {
      setError('Ada is temporarily unavailable. The rest of RTB OS still works normally.');
      console.warn('Ada brief unavailable', err);
    } finally {
      setLoading(false);
    }
  }

  async function ask(prompt = question) {
    const text = String(prompt || '').trim();
    if (!enabled || !text) return;
    setAsking(true);
    setError('');
    try {
      const result = await invokeAda({ action: 'ask', businessId: businessUnitId, question: text });
      setAnswer(result);
      setQuestion('');
      setExpanded(true);
    } catch (err) {
      setError('Ada is temporarily unavailable. Try again later; no other app features are affected.');
      console.warn('Ada question unavailable', err);
    } finally {
      setAsking(false);
    }
  }

  async function updateCaseStatus(caseId, status) {
    if (!caseId || caseWorking) return;
    setCaseWorking(caseId);
    setError('');
    try {
      await invokeAda({ action: 'case-status', businessId: businessUnitId, caseId, status });
      await refreshBrief();
    } catch (err) {
      setError('Unable to update that communication item.');
      console.warn('Ada communication case update failed', err);
    } finally {
      setCaseWorking('');
    }
  }

  if (!enabled) return null;

  const current = answer || brief;
  const audienceLabel = current?.audience === 'staff_hub' ? 'Staff copilot' : 'Owner copilot';
  const communicationCases = current?.communication_cases || [];

  return (
    <section className={`gemini-ops-brief ${expanded ? 'is-expanded' : 'is-collapsed'}`}>
      <div className="gemini-ops-brief__topline">
        <div className="gemini-ops-brief__identity">
          <span className="gemini-ops-brief__icon" aria-hidden="true"><Sparkles size={17} /></span>
          <div>
            <span>Ada</span>
            <strong>{audienceLabel}</strong>
            {!expanded ? <small>RTB-aware · communications-aware · action focused</small> : null}
          </div>
        </div>
        <div className="gemini-ops-brief__controls">
          {expanded ? (
            <button aria-label="Get a fresh Ada brief" disabled={loading} onClick={refreshBrief} type="button">
              <RefreshCw aria-hidden="true" className={loading ? 'spin' : ''} size={16} />
            </button>
          ) : null}
          <button aria-label={expanded ? 'Collapse Ada' : 'Open Ada'} onClick={toggleExpanded} type="button">
            {expanded ? <ChevronUp aria-hidden="true" size={17} /> : <ChevronDown aria-hidden="true" size={17} />}
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="gemini-ops-brief__body">
          {error ? <div className="gemini-ops-brief__error" role="status">{error}</div> : null}

          {loading && !current ? (
            <div className="gemini-ops-brief__loading"><Bot aria-hidden="true" size={18} /> Ada is reviewing saved RTB information…</div>
          ) : current ? (
            <>
              <p className="gemini-ops-brief__summary">{current.answer || current.summary}</p>

              {communicationCases.length ? (
                <div className="gemini-ops-brief__suggested-tasks">
                  <strong>Important communications still open</strong>
                  <ul>
                    {communicationCases.slice(0, 6).map((item) => (
                      <li key={item.id}>
                        <b>{item.contact_name ? `${item.contact_name}: ` : ''}{item.title}</b>
                        {item.summary ? <span>{item.summary}</span> : null}
                        <small>
                          {item.priority || 'normal'}
                          {item.source_count > 1 ? ` · ${item.source_count} related messages` : ''}
                          {item.approval_required ? ' · approval required' : ''}
                          {item.due_hint ? ` · ${item.due_hint}` : ''}
                        </small>
                        {item.next_action ? <span><strong>Next:</strong> {item.next_action}</span> : null}
                        <div className="action-row">
                          <button
                            className="ghost-button small success-action"
                            disabled={caseWorking === item.id}
                            onClick={() => updateCaseStatus(item.id, 'resolved')}
                            type="button"
                          >
                            <CheckCircle2 size={14} />
                            Resolved
                          </button>
                          <button
                            className="ghost-button small"
                            disabled={caseWorking === item.id}
                            onClick={() => updateCaseStatus(item.id, 'ignored')}
                            type="button"
                          >
                            <X size={14} />
                            Ignore
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {current.priorities?.length ? (
                <div className="gemini-ops-brief__priorities">
                  {current.priorities.slice(0, 4).map((item) => <span key={item}>{item}</span>)}
                </div>
              ) : null}

              {current.suggested_tasks?.length ? (
                <div className="gemini-ops-brief__suggested-tasks">
                  <strong>Suggested actions</strong>
                  <ul>
                    {current.suggested_tasks.slice(0, 4).map((task, index) => (
                      <li key={`${task.title}-${index}`}>
                        <b>{task.title}</b>
                        <span>{task.details}</span>
                        <small>
                          {task.suggested_staff_name ? `Owner: ${task.suggested_staff_name}` : 'Owner: unassigned'}
                          {task.priority ? ` · ${task.priority}` : ''}
                          {task.due_hint ? ` · ${task.due_hint}` : ''}
                        </small>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {current.risks?.length ? (
                <details className="gemini-ops-brief__evidence">
                  <summary>Risks Ada sees</summary>
                  <ul>{current.risks.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul>
                </details>
              ) : null}

              {current.opportunities?.length ? (
                <details className="gemini-ops-brief__evidence">
                  <summary>Opportunities</summary>
                  <ul>{current.opportunities.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul>
                </details>
              ) : null}

              {current.evidence?.length ? (
                <details className="gemini-ops-brief__evidence">
                  <summary>Why Ada is saying this</summary>
                  <ul>{current.evidence.slice(0, 5).map((item) => <li key={item}>{item}</li>)}</ul>
                </details>
              ) : null}
            </>
          ) : (
            <p className="gemini-ops-brief__summary">Ask Ada about the business, staff, important messages, unfinished work, patterns, or what you should do next.</p>
          )}

          <div className="gemini-ops-brief__quick-prompts">
            {QUICK_PROMPTS.map((prompt) => (
              <button disabled={asking} key={prompt} onClick={() => ask(prompt)} type="button">{prompt}</button>
            ))}
          </div>

          <div className="gemini-ops-brief__ask">
            <input
              aria-label="Ask Ada"
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  ask();
                }
              }}
              placeholder="Ask Ada anything about this business…"
              value={question}
            />
            <button disabled={asking || !question.trim()} onClick={() => ask()} type="button">
              <Send aria-hidden="true" size={16} />
              {asking ? 'Thinking…' : 'Ask Ada'}
            </button>
          </div>
          <small className="gemini-ops-brief__usage-note">RTB AI does not run in the background. Ada loads saved intelligence and communication cases when opened, and uses AI only when you ask or refresh.</small>
        </div>
      ) : null}
    </section>
  );
}