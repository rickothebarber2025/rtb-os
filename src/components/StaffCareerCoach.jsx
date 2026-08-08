import { useCallback, useEffect, useState } from 'react';
import { BellRing, BriefcaseBusiness, CheckCircle2, Sparkles, Target } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import '../styles/staffCareerCoach.css';

export default function StaffCareerCoach() {
  const [feed, setFeed] = useState({ unread_count: 0, messages: [] });
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError('');
    try {
      const { error: coachError } = await supabase.functions.invoke('staff-gemini-coach', { body: {} });
      if (coachError) throw coachError;
      const { data, error: feedError } = await supabase.rpc('get_my_ai_coaching');
      if (feedError) throw feedError;
      setFeed(data || { unread_count: 0, messages: [] });
    } catch (err) {
      setError(err.message || 'Unable to load your RTB coaching brief.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function markRead(messageId = null) {
    if (!supabase) return;
    await supabase.rpc('mark_my_ai_coaching_read', { p_message_id: messageId });
    await load();
  }

  const messages = Array.isArray(feed.messages) ? feed.messages : [];
  const current = messages[0];
  const unread = Number(feed.unread_count || 0);
  const career = current?.career_progress || {};
  const contribution = current?.shop_contribution || {};
  const focus = Array.isArray(current?.focus_points) ? current.focus_points : [];

  return (
    <section className="staff-career-coach">
      <button className="staff-career-coach__header" onClick={() => setOpen((value) => !value)} type="button">
        <div className="staff-career-coach__identity">
          <span className="staff-career-coach__icon"><Sparkles size={17} /></span>
          <div>
            <span>RTB Gemini Coach</span>
            <strong>Your career + shop contribution</strong>
          </div>
        </div>
        <div className="staff-career-coach__badge-wrap">
          <BellRing size={18} />
          {unread > 0 ? <span className="staff-career-coach__badge">{unread > 9 ? '9+' : unread}</span> : null}
        </div>
      </button>

      {open ? (
        <div className="staff-career-coach__body">
          {loading ? <p className="staff-career-coach__muted">Gemini is reviewing your RTB activity…</p> : null}
          {error ? <p className="staff-career-coach__error">{error}</p> : null}

          {!loading && current ? (
            <>
              <div className="staff-career-coach__message">
                <strong>{current.title}</strong>
                <p>{current.body}</p>
              </div>

              {focus.length ? (
                <div className="staff-career-coach__focus">
                  <div className="staff-career-coach__section-title"><Target size={16} /> Focus now</div>
                  <ul>{focus.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
              ) : null}

              <div className="staff-career-coach__grid">
                <article>
                  <div className="staff-career-coach__section-title"><BriefcaseBusiness size={16} /> Career progress</div>
                  <strong>{career.status || 'Building'}</strong>
                  <p>{career.message || 'Your consistency, client service, and follow-through build your RTB growth record.'}</p>
                </article>
                <article>
                  <div className="staff-career-coach__section-title"><CheckCircle2 size={16} /> Shop contribution</div>
                  <strong>{contribution.status || 'Tracked in RTB OS'}</strong>
                  <p>{contribution.message || 'Completed tasks, reliable attendance, checklist participation, and client feedback contribute to your shop impact.'}</p>
                </article>
              </div>

              {unread > 0 ? (
                <button className="staff-career-coach__read" onClick={() => markRead()} type="button">Mark coaching as reviewed</button>
              ) : null}
            </>
          ) : null}

          {!loading && !current && !error ? (
            <p className="staff-career-coach__muted">Your first coaching brief will appear after RTB OS records activity for your profile.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
