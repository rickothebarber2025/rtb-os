import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import EmptyState from './EmptyState';
import { supabase } from '../lib/supabaseClient';
import { formatDateTime } from '../utils/formatters';

export default function ClientErrorLog() {
  const [errors, setErrors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    supabase
      .from('app_client_errors')
      .select('id,message,page,user_email,created_at')
      .order('created_at', { ascending: false })
      .limit(30)
      .then(({ data, error: fetchError }) => {
        if (cancelled) return;
        if (fetchError) {
          setError(fetchError.message);
        } else {
          setErrors(data || []);
        }
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="panel full-span">
      <div className="section-header">
        <div>
          <span>App Errors</span>
          <h2>{errors.length ? `${errors.length} recent` : 'Nothing recent'}</h2>
        </div>
      </div>
      <p className="subtle-text">
        Whenever a page crashes for anyone, it shows up here automatically -- no screenshot needed.
      </p>
      {error ? <div className="alert danger">{error}</div> : null}
      {loading ? (
        <p className="subtle-text">Loading...</p>
      ) : errors.length ? (
        <div className="client-error-list">
          {errors.map((row) => (
            <div className="client-error-row" key={row.id}>
              <AlertTriangle size={16} />
              <div>
                <strong>{row.message}</strong>
                <small>
                  {formatDateTime(row.created_at)}
                  {row.user_email ? ` \u00b7 ${row.user_email}` : ''}
                </small>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={AlertTriangle} title="Clean" message="No app crashes logged recently." />
      )}
    </section>
  );
}
