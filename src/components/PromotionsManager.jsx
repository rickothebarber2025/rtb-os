import { useEffect, useState } from 'react';
import { Plus, Sparkles, Trash2 } from 'lucide-react';
import { getBusinessUnits } from '../services/rtbService';
import { supabase } from '../lib/supabaseClient';
import { formatDate } from '../utils/formatters';

const BLANK_FORM = {
  business_unit_id: '',
  title: '',
  description: '',
  discount_text: '',
  starts_at: '',
  ends_at: '',
};

// Manages the promotions shown on the public, no-login /promotions page.
// Anyone can already read active promotions there (see the RLS policy);
// this is just the admin-only create/edit/delete side.
export default function PromotionsManager() {
  const [businessUnits, setBusinessUnits] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(BLANK_FORM);
  const [saving, setSaving] = useState(false);

  async function load() {
    if (!supabase) return;
    setLoading(true);
    setError('');
    try {
      const { data, error: fetchError } = await supabase
        .from('promotions')
        .select('*')
        .order('created_at', { ascending: false });
      if (fetchError) throw fetchError;
      setPromotions(data || []);
    } catch (err) {
      setError(err.message || 'Unable to load promotions.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    getBusinessUnits()
      .then((rows) => setBusinessUnits(rows || []))
      .catch(() => setBusinessUnits([]));
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave() {
    if (!form.business_unit_id || !form.title.trim() || !form.description.trim()) {
      setError('Choose a business and fill in a title and description first.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const { error: insertError } = await supabase.from('promotions').insert({
        business_unit_id: form.business_unit_id,
        title: form.title.trim(),
        description: form.description.trim(),
        discount_text: form.discount_text.trim() || null,
        starts_at: form.starts_at || null,
        ends_at: form.ends_at || null,
      });
      if (insertError) throw insertError;
      setNotice('Promotion posted. It\u2019s live on the public page now.');
      setForm(BLANK_FORM);
      setFormOpen(false);
      await load();
    } catch (err) {
      setError(err.message || 'Unable to save the promotion.');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(promo) {
    setError('');
    try {
      const { error: updateError } = await supabase
        .from('promotions')
        .update({ active: !promo.active, updated_at: new Date().toISOString() })
        .eq('id', promo.id);
      if (updateError) throw updateError;
      await load();
    } catch (err) {
      setError(err.message || 'Unable to update.');
    }
  }

  async function handleDelete(promo) {
    setError('');
    try {
      const { error: deleteError } = await supabase.from('promotions').delete().eq('id', promo.id);
      if (deleteError) throw deleteError;
      await load();
    } catch (err) {
      setError(err.message || 'Unable to delete.');
    }
  }

  const businessName = (id) => businessUnits.find((row) => row.id === id)?.name || 'Unknown business';

  return (
    <section className="panel full-span">
      <div className="section-header">
        <div>
          <span>Public page</span>
          <h2>Promotions</h2>
        </div>
        <button className="ghost-button small" onClick={() => setFormOpen((value) => !value)} type="button">
          <Plus size={14} /> New promotion
        </button>
      </div>
      <p className="subtle-text">
        Visible to anyone on the public promotions page, no login needed -- share the link on Instagram or
        your booking confirmations.
      </p>

      {error ? <div className="alert danger">{error}</div> : null}
      {notice ? <div className="alert success">{notice}</div> : null}

      {formOpen ? (
        <div className="promo-form">
          <div className="form-grid compact">
            <label className="field">
              <span>Business</span>
              <select
                value={form.business_unit_id}
                onChange={(event) => setForm((current) => ({ ...current, business_unit_id: event.target.value }))}
              >
                <option value="">Choose...</option>
                {businessUnits.map((business) => (
                  <option key={business.id} value={business.id}>
                    {business.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Discount / offer (optional, e.g. "20% off")</span>
              <input
                onChange={(event) => setForm((current) => ({ ...current, discount_text: event.target.value }))}
                value={form.discount_text}
              />
            </label>
          </div>
          <label className="field">
            <span>Title</span>
            <input
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              placeholder="Back to School Special"
              value={form.title}
            />
          </label>
          <label className="field">
            <span>Description</span>
            <textarea
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              rows={2}
              value={form.description}
            />
          </label>
          <div className="form-grid compact">
            <label className="field">
              <span>Starts (optional)</span>
              <input
                onChange={(event) => setForm((current) => ({ ...current, starts_at: event.target.value }))}
                type="date"
                value={form.starts_at}
              />
            </label>
            <label className="field">
              <span>Ends (optional)</span>
              <input
                onChange={(event) => setForm((current) => ({ ...current, ends_at: event.target.value }))}
                type="date"
                value={form.ends_at}
              />
            </label>
          </div>
          <button className="primary-button" disabled={saving} onClick={handleSave} type="button">
            {saving ? 'Posting...' : 'Post promotion'}
          </button>
        </div>
      ) : null}

      {loading ? (
        <p className="subtle-text">Loading...</p>
      ) : promotions.length ? (
        <div className="promo-list">
          {promotions.map((promo) => (
            <div className={`promo-list__row ${promo.active ? '' : 'inactive'}`} key={promo.id}>
              <Sparkles size={16} />
              <div className="promo-list__body">
                <strong>{promo.title}</strong>
                <small>
                  {businessName(promo.business_unit_id)}
                  {promo.discount_text ? ` \u00b7 ${promo.discount_text}` : ''}
                  {promo.ends_at ? ` \u00b7 Ends ${formatDate(promo.ends_at)}` : ''}
                </small>
              </div>
              <button className="ghost-button small" onClick={() => handleToggle(promo)} type="button">
                {promo.active ? 'Deactivate' : 'Activate'}
              </button>
              <button className="icon-button" onClick={() => handleDelete(promo)} type="button" aria-label="Delete">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="subtle-text">No promotions posted yet.</p>
      )}
    </section>
  );
}
