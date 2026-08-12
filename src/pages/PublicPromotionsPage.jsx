import { useEffect, useState } from 'react';
import { Sparkles, Star } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Public, no-login page -- linked from Instagram/website/QR codes. Only
// ever reads promotions (active + within date window) and
// public_reviews_display (a view that deliberately excludes customer
// email and any internal/staff data -- see the migration that created it).
// Nothing here requires or exposes an account.
export default function PublicPromotionsPage() {
  const [businesses, setBusinesses] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!supabase) {
      setError('This page is temporarily unavailable.');
      setLoading(false);
      return;
    }
    let cancelled = false;

    Promise.all([
      supabase.from('business_units').select('id,name,type'),
      supabase.from('promotions').select('*').order('created_at', { ascending: false }),
      supabase.from('public_reviews_display').select('*').limit(12),
    ])
      .then(([businessRes, promoRes, reviewRes]) => {
        if (cancelled) return;
        if (businessRes.error) throw businessRes.error;
        if (promoRes.error) throw promoRes.error;
        if (reviewRes.error) throw reviewRes.error;
        setBusinesses(businessRes.data || []);
        setPromotions(promoRes.data || []);
        setReviews(reviewRes.data || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Unable to load this page right now.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const businessName = (id) => businesses.find((row) => row.id === id)?.name || '';

  if (loading) {
    return (
      <div className="public-promo-page">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="public-promo-page">
      <header className="public-promo-hero">
        <span className="public-promo-hero__eyebrow">RTB Lounge &amp; RTB Beauty Lounge</span>
        <h1>Deals, Specials &amp; What Clients Are Saying</h1>
        <p>306 Cumberland St, Ottawa</p>
      </header>

      {error ? <div className="public-promo-error">{error}</div> : null}

      <section className="public-promo-section">
        <h2>
          <Sparkles size={20} /> Current Promotions
        </h2>
        {promotions.length ? (
          <div className="public-promo-grid">
            {promotions.map((promo) => (
              <article className="public-promo-card" key={promo.id}>
                {businessName(promo.business_unit_id) ? (
                  <span className="public-promo-card__tag">{businessName(promo.business_unit_id)}</span>
                ) : null}
                <h3>{promo.title}</h3>
                {promo.discount_text ? <strong>{promo.discount_text}</strong> : null}
                <p>{promo.description}</p>
                {promo.ends_at ? <small>Ends {formatDate(promo.ends_at)}</small> : null}
              </article>
            ))}
          </div>
        ) : (
          <p className="public-promo-empty">No current promotions -- check back soon.</p>
        )}
      </section>

      <section className="public-promo-section public-promo-loyalty">
        <h2>Book Regularly? We've Got You</h2>
        <p>
          Rebook with the same barber or stylist for your next visit and mention it at checkout -- our
          regulars are always looked after first when it comes to availability and new promotions.
        </p>
      </section>

      <section className="public-promo-section">
        <h2>
          <Star size={20} /> What Clients Are Saying
        </h2>
        {reviews.length ? (
          <div className="public-promo-grid">
            {reviews.map((review) => (
              <article className="public-review-card" key={review.id}>
                <div className="public-review-card__stars">
                  {Array.from({ length: review.rating }).map((_, index) => (
                    <Star key={index} size={14} fill="currentColor" />
                  ))}
                </div>
                <p>&ldquo;{review.review_text}&rdquo;</p>
                <div className="public-review-card__footer">
                  <strong>{review.reviewer_name || 'Client'}</strong>
                  {review.service_name ? <span> -- {review.service_name}</span> : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="public-promo-empty">Reviews are on their way -- check back soon.</p>
        )}
      </section>
    </div>
  );
}
