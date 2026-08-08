import { useCallback, useEffect, useMemo, useState } from 'react';
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
  const [expanded, setExpanded] = useState(true);
  const [loading, setLoading] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');

  const enabled = useMemo(
    () => Boolean(businessUnitId && businessUnitId !== 'all-businesses' && ['dashboard', 'operations', 'staff-hub'].includes(activePage)),
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
      throw new Error(functionError.message || 'RTB Gemini request failed.');
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }, []);

  const loadBrief = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError('');
    try {
      const result = await invokeGemini({ action: 'summary', businessId: businessUnitId });
      setBrief(result);
    } catch (err) {
      setError(err.message || 'Unable to load RTB Gemini brief.');
    } finally {
      setLoading(false);
    }
  }, [businessUnitId, enabled, invokeGemini]);

  useEffect(() => {
    if (!enabled) return;
    loadBrief();
  }, [enabled, loadBrief]);

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
      setError(err.message || 'Unable to ask RTB Gemini.');
    } finally {
      setAsking(false);
    }
  }

  if (!enabled) return null;

  const current = answer || brief;
  const audienceLabel = current?.audience === 'staff_hub' ? 'My Staff Hub brief' : 'Owner operations brief';

  return (
    <section className="gemini-ops-brief">
      <div className="gemini-ops-brief__topline">
        <div className="gemini-ops-brief__identity">
          <span className="gemini-ops-brief__icon"><Sparkles size={17} /></span>
          <div>
            <span>RTB Gemini</span>
            <strong>{audienceLabel}</strong>
          </div>
        </div>
        <div className="gemini-ops-brief__controls">
          <button aria-label="Refresh Gemini brief" disabled={loading} onClick={loadBrief} type="button">
            <RefreshCw className={loading ? 'spin' : ''} size={16} />
          </button>
          <button aria-label={expanded ? 'Collapse Gemini brief' : 'Expand Gemini brief'} onClick={() => setExpanded((value) => !value)} type="button">
            {expanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
          </button>
        </div>
      </div>

      {error ? <div className="gemini-ops-brief__error">{error}</div> : null}

      {expanded ? (
        <div className="gemini-ops-brief__body">
          {loading && !current ? (
            <div className="gemini-ops-brief__loading"><Bot size={18} /> Reading RTB OS activity…</div>
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
                  <summary>Why Gemini is saying this</summary>
                  <ul>{current.evidence.slice(0, 5).map((item) => <li key={item}>{item}</li>)}</ul>
                </details>
              ) : null}
            </>
          ) : null}

          <div className="gemini-ops-brief__quick-prompts">
            {QUICK_PROMPTS.map((prompt) => (
              <button disabled={asking} key={prompt} onClick={() => ask(prompt)} type="button">{prompt}</button>
            ))}
          </div>

          <div className="gemini-ops-brief__ask">
            <input
              aria-label="Ask RTB Gemini"
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  ask();
                }
              }}
              placeholder="Ask RTB Gemini about the shop…"
              value={question}
            />
            <button disabled={asking || !question.trim()} onClick={() => ask()} type="button">
              <Send size={16} />
              {asking ? 'Thinking…' : 'Ask'}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
