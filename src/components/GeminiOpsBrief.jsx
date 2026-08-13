import { useCallback, useMemo, useState } from 'react';
import { Bot, ChevronDown, ChevronUp, RefreshCw, Send, Sparkles } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import '../styles/geminiOpsBrief.css';

const QUICK_PROMPTS = [
  'What needs my attention right now?',
  'Who has unfinished responsibilities today?',
  'Summarize opening and closing activity.',
  'What should I follow up on before tomorrow?',
];

export default function GeminiOpsBrief({ activePage, businessUnitId }) {
  const [brief, setBrief] = useState(null);
  const [answer, setAnswer] = useState(null);
  const [question, setQuestion] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const [cachedChecked, setCachedChecked] = useState(false);

  const enabled = useMemo(
    () => Boolean(businessUnitId && businessUnitId !== 'all-businesses' && ['dashboard', 'operations'].includes(activePage)),
    [activePage, businessUnitId],
  );

  const invokeGemini = useCallback(async (body) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { data, error: functionError } = await supabase.functions.invoke('rtb-gemini', { body });
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
      throw new Error(functionError.message || 'RTB AI request failed.');
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }, []);

  const loadCachedBrief = useCallback(async () => {
    if (!enabled || cachedChecked) return;
    setLoading(true);
    setError('');
    try {
      const result = await invokeGemini({ action: 'cached', businessId: businessUnitId });
      if (result?.summary || result?.answer) setBrief(result);
      setCachedChecked(true);
    } catch (_err) {
      // Cached help is optional. Never turn a passive AI widget into a page error.
      setCachedChecked(true);
    } finally {
      setLoading(false);
    }
  }, [businessUnitId, cachedChecked, enabled, invokeGemini]);

  async function toggleExpanded() {
    const next = !expanded;
    setExpanded(next);
    if (next && !cachedChecked) await loadCachedBrief();
  }

  async function refreshBrief() {
    if (!enabled) return;
    setLoading(true);
    setError('');
    try {
      const result = await invokeGemini({ action: 'summary', businessId: businessUnitId });
      setBrief(result);
      setAnswer(null);
      setCachedChecked(true);
    } catch (err) {
      setError('AI is temporarily unavailable. The rest of RTB OS still works normally.');
      console.warn('RTB AI brief unavailable', err);
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
      const result = await invokeGemini({ action: 'ask', businessId: businessUnitId, question: text });
      setAnswer(result);
      setQuestion('');
      setExpanded(true);
    } catch (err) {
      setError('AI is temporarily unavailable. Try again later; no other app features are affected.');
      console.warn('RTB AI question unavailable', err);
    } finally {
      setAsking(false);
    }
  }

  if (!enabled) return null;

  const current = answer || brief;
  const audienceLabel = current?.audience === 'staff_hub' ? 'AI helper' : 'Owner AI helper';

  return (
    <section className={`gemini-ops-brief ${expanded ? 'is-expanded' : 'is-collapsed'}`}>
      <div className="gemini-ops-brief__topline">
        <div className="gemini-ops-brief__identity">
          <span className="gemini-ops-brief__icon" aria-hidden="true"><Sparkles size={17} /></span>
          <div>
            <span>RTB AI</span>
            <strong>{audienceLabel}</strong>
            {!expanded ? <small>On demand · uses AI only when you ask</small> : null}
          </div>
        </div>
        <div className="gemini-ops-brief__controls">
          {expanded ? (
            <button aria-label="Get a fresh AI brief" disabled={loading} onClick={refreshBrief} type="button">
              <RefreshCw aria-hidden="true" className={loading ? 'spin' : ''} size={16} />
            </button>
          ) : null}
          <button aria-label={expanded ? 'Collapse AI helper' : 'Open AI helper'} onClick={toggleExpanded} type="button">
            {expanded ? <ChevronUp aria-hidden="true" size={17} /> : <ChevronDown aria-hidden="true" size={17} />}
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="gemini-ops-brief__body">
          {error ? <div className="gemini-ops-brief__error" role="status">{error}</div> : null}

          {loading && !current ? (
            <div className="gemini-ops-brief__loading"><Bot aria-hidden="true" size={18} /> Checking saved AI help…</div>
          ) : current ? (
            <>
              <p className="gemini-ops-brief__summary">{current.answer || current.summary}</p>
              {current.priorities?.length ? (
                <div className="gemini-ops-brief__priorities">
                  {current.priorities.slice(0, 3).map((item) => <span key={item}>{item}</span>)}
                </div>
              ) : null}
              {current.evidence?.length ? (
                <details className="gemini-ops-brief__evidence">
                  <summary>Why AI is saying this</summary>
                  <ul>{current.evidence.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul>
                </details>
              ) : null}
            </>
          ) : (
            <p className="gemini-ops-brief__summary">Ask a quick question when you need help. RTB AI does not run in the background.</p>
          )}

          <div className="gemini-ops-brief__quick-prompts">
            {QUICK_PROMPTS.map((prompt) => (
              <button disabled={asking} key={prompt} onClick={() => ask(prompt)} type="button">{prompt}</button>
            ))}
          </div>

          <div className="gemini-ops-brief__ask">
            <input
              aria-label="Ask RTB AI"
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  ask();
                }
              }}
              placeholder="Ask only when you need help…"
              value={question}
            />
            <button disabled={asking || !question.trim()} onClick={() => ask()} type="button">
              <Send aria-hidden="true" size={16} />
              {asking ? 'Thinking…' : 'Ask'}
            </button>
          </div>
          <small className="gemini-ops-brief__usage-note">AI stays idle until you ask a question or request a fresh brief.</small>
        </div>
      ) : null}
    </section>
  );
}
