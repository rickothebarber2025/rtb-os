import { MessageCircleOff } from 'lucide-react';

export default function MessagesPage() {
  return (
    <div className="page-grid">
      <section className="panel full-span">
        <div style={{ display: 'grid', gap: 10, justifyItems: 'start' }}>
          <MessageCircleOff size={28} />
          <div>
            <span className="eyebrow">RTB Messaging</span>
            <h2>Messaging disabled</h2>
            <p className="subtle-text">
              The previous messaging integration has been removed from RTB OS. No background sync or messaging worker is running.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
