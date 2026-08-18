import { useEffect, useMemo, useState } from 'react';
import { MessageCircle, Plus, RefreshCw, Send, Wifi, WifiOff } from 'lucide-react';
import {
  getTextNowMessages,
  getTextNowStatus,
  sendTextNowSms,
} from '../services/textNowService';
import '../styles/messages.css';

function normalizeDirection(value) {
  const text = String(value || '').toLowerCase();
  return text.includes('sent') || text.includes('out') ? 'outgoing' : 'incoming';
}

function formatWhen(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

function groupConversations(messages = []) {
  const map = new Map();
  for (const message of messages) {
    const number = message.number || 'Unknown';
    if (!map.has(number)) map.set(number, []);
    map.get(number).push(message);
  }
  return [...map.entries()]
    .map(([number, rows]) => ({
      number,
      messages: [...rows].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0)),
      latest: [...rows].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))[0],
      unread: rows.filter((row) => !row.read && normalizeDirection(row.direction) === 'incoming').length,
    }))
    .sort((a, b) => new Date(b.latest?.date || 0) - new Date(a.latest?.date || 0));
}

export default function MessagesPage() {
  const [status, setStatus] = useState({ connected: false, configured: false });
  const [messages, setMessages] = useState([]);
  const [selectedNumber, setSelectedNumber] = useState('');
  const [newNumber, setNewNumber] = useState('');
  const [composingNew, setComposingNew] = useState(false);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const conversations = useMemo(() => groupConversations(messages), [messages]);
  const selected = conversations.find((item) => item.number === selectedNumber) || (!composingNew ? conversations[0] || null : null);
  const targetNumber = composingNew ? newNumber.trim() : selected?.number || selectedNumber;

  async function load() {
    setLoading(true);
    setError('');
    try {
      const health = await getTextNowStatus();
      setStatus(health);
      const result = await getTextNowMessages(150);
      setMessages(result.messages || []);
      if (!selectedNumber && !composingNew && result.messages?.length) setSelectedNumber(result.messages[0].number || '');
    } catch (err) {
      setStatus({ connected: false, configured: false });
      setError(err.message || 'Unable to load TextNow.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function startNewMessage() {
    setComposingNew(true);
    setSelectedNumber('');
    setNewNumber('');
    setDraft('');
    setError('');
  }

  async function send() {
    const number = targetNumber;
    const message = draft.trim();
    if (!number || !message) return;
    setSending(true);
    setError('');
    try {
      await sendTextNowSms(number, message);
      setDraft('');
      setComposingNew(false);
      setSelectedNumber(number);
      setNewNumber('');
      await load();
    } catch (err) {
      setError(err.message || 'Unable to send message.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="messages-page">
      <section className="panel full-span messages-page__header">
        <div>
          <span className="eyebrow">RTB Messaging</span>
          <h2>TextNow Inbox</h2>
          <p>Client texts inside RTB OS. TextNow credentials stay on the server-side bridge.</p>
        </div>
        <div className="messages-page__header-actions">
          <span className={`messages-status ${status.connected ? 'connected' : 'disconnected'}`}>
            {status.connected ? <Wifi size={15} /> : <WifiOff size={15} />}
            {status.connected ? 'Connected' : 'Not connected'}
          </span>
          <button className="ghost-button" disabled={loading} onClick={load} type="button">
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
      </section>

      {error ? <div className="alert warning full-span">{error}</div> : null}

      <section className="messages-shell full-span">
        <aside className="messages-list" aria-label="Text conversations">
          <div className="messages-list__heading">
            <div><strong>Conversations</strong><small>{conversations.length}</small></div>
            <button className="icon-button" aria-label="Start new message" onClick={startNewMessage} type="button"><Plus size={17} /></button>
          </div>
          {loading ? <p className="subtle-text messages-list__loading">Loading TextNow…</p> : null}
          {!loading && !conversations.length ? (
            <div className="messages-empty"><MessageCircle size={28} /><strong>No conversations yet</strong><span>Start a new text when the bridge is connected.</span></div>
          ) : null}
          {conversations.map((conversation) => (
            <button
              className={`messages-conversation ${!composingNew && selected?.number === conversation.number ? 'active' : ''}`}
              key={conversation.number}
              onClick={() => { setComposingNew(false); setSelectedNumber(conversation.number); setDraft(''); }}
              type="button"
            >
              <span className="messages-conversation__avatar">{conversation.number.slice(-2)}</span>
              <span className="messages-conversation__copy">
                <strong>{conversation.number}</strong>
                <small>{conversation.latest?.content || 'Message'}</small>
              </span>
              <span className="messages-conversation__meta">
                <small>{formatWhen(conversation.latest?.date)}</small>
                {conversation.unread ? <b>{conversation.unread}</b> : null}
              </span>
            </button>
          ))}
        </aside>

        <div className="messages-thread">
          {composingNew ? (
            <>
              <header className="messages-thread__header messages-thread__new">
                <label htmlFor="textnow-new-number">To</label>
                <input
                  autoFocus
                  id="textnow-new-number"
                  inputMode="tel"
                  onChange={(event) => setNewNumber(event.target.value)}
                  placeholder="Phone number"
                  value={newNumber}
                />
              </header>
              <div className="messages-thread__empty"><MessageCircle size={34} /><strong>New TextNow message</strong><span>Enter the client's phone number, then type the message below.</span></div>
              <div className="messages-composer">
                <textarea aria-label="New TextNow message" onChange={(event) => setDraft(event.target.value)} placeholder="Type a message…" rows={2} value={draft} />
                <button className="primary-button" disabled={sending || !draft.trim() || !newNumber.trim()} onClick={send} type="button"><Send size={16} /> {sending ? 'Sending…' : 'Send'}</button>
              </div>
            </>
          ) : selected ? (
            <>
              <header className="messages-thread__header"><div><strong>{selected.number}</strong><small>{selected.messages.length} messages</small></div></header>
              <div className="messages-thread__body" role="log" aria-live="polite">
                {selected.messages.map((message) => {
                  const direction = normalizeDirection(message.direction);
                  return (
                    <div className={`message-bubble-row ${direction}`} key={`${message.id}-${message.date}`}>
                      <div className="message-bubble"><span>{message.content}</span><small>{formatWhen(message.date)}</small></div>
                    </div>
                  );
                })}
              </div>
              <div className="messages-composer">
                <textarea
                  aria-label={`Message ${selected.number}`}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }}
                  placeholder="Type a message…"
                  rows={2}
                  value={draft}
                />
                <button className="primary-button" disabled={sending || !draft.trim()} onClick={send} type="button"><Send size={16} /> {sending ? 'Sending…' : 'Send'}</button>
              </div>
            </>
          ) : (
            <div className="messages-thread__empty"><MessageCircle size={34} /><strong>Select a conversation</strong><span>TextNow conversations will open here.</span><button className="primary-button" onClick={startNewMessage} type="button"><Plus size={16} /> New message</button></div>
          )}
        </div>
      </section>
    </div>
  );
}
