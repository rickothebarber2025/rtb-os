import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Scissors, Send, Star } from 'lucide-react';
import LoadingState from '../components/LoadingState';
import {
  getPublicFeedbackSurvey,
  submitPublicFeedbackSurvey,
} from '../services/rtbService';
import { ON_TIME_OPTIONS, RETURN_OPTIONS } from '../utils/customerIntelligence';

const INITIAL_FORM = {
  additional_comments: '',
  appointment_started_on_time: 'yes',
  atmosphere_rating: 5,
  cleanliness_rating: 5,
  favorite_part: '',
  improvement_suggestion: '',
  overall_rating: 5,
  professionalism_rating: 5,
  recommend_business: 10,
  welcome_rating: 5,
  would_return: 'definitely',
};

function StarRating({ label, name, setValue, value }) {
  return (
    <div className="survey-rating">
      <span>{label}</span>
      <div aria-label={label} role="radiogroup">
        {[1, 2, 3, 4, 5].map((rating) => (
          <button
            aria-checked={value === rating}
            aria-label={`${rating} star${rating === 1 ? '' : 's'}`}
            className={value >= rating ? 'active' : ''}
            key={rating}
            role="radio"
            type="button"
            onClick={() => setValue(name, rating)}
          >
            <Star size={28} />
          </button>
        ))}
      </div>
    </div>
  );
}

function OptionGroup({ label, name, options, setValue, value }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="survey-option-grid">
        {options.map((option) => (
          <button
            className={value === option.value ? 'active' : ''}
            key={option.value}
            type="button"
            onClick={() => setValue(name, option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </label>
  );
}

export default function SurveyPage({ token }) {
  const [request, setRequest] = useState(null);
  const [form, setForm] = useState(INITIAL_FORM);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const businessName = request?.businessName || 'RTB';
  const completed = submitted || request?.status === 'completed';
  const expired = request?.status === 'expired';
  const heading = useMemo(() => {
    if (completed) return 'Thank you for the feedback';
    if (expired) return 'This feedback link expired';
    return `How was your visit to ${businessName}?`;
  }, [businessName, completed, expired]);

  useEffect(() => {
    let cancelled = false;

    async function loadSurvey() {
      setLoading(true);
      setError('');

      try {
        const result = await getPublicFeedbackSurvey(token);
        if (!cancelled) setRequest(result.request);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Unable to load this survey.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadSurvey();

    return () => {
      cancelled = true;
    };
  }, [token]);

  function setValue(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function submitSurvey(event) {
    event.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      await submitPublicFeedbackSurvey(token, form);
      setSubmitted(true);
    } catch (err) {
      setError(err.message || 'Unable to submit feedback.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <LoadingState label="Loading feedback survey" />;
  }

  return (
    <main className="survey-page">
      <section className="survey-card">
        <div className="survey-brand">
          <span className="brand-mark">
            <Scissors size={22} />
          </span>
          <div>
            <strong>RTB OS</strong>
            <span>Customer Feedback</span>
          </div>
        </div>

        <div className="survey-hero">
          <span>{request?.serviceName || 'Appointment'}{request?.staffName ? ` with ${request.staffName}` : ''}</span>
          <h1>{heading}</h1>
          <p>
            {completed
              ? 'Your response was saved and will be reviewed by the RTB team.'
              : expired
                ? 'This survey is no longer accepting responses.'
                : `Hi ${request?.customerName || 'there'}, your answers help ${businessName} improve the customer experience.`}
          </p>
        </div>

        {error ? <div className="alert danger">{error}</div> : null}

        {completed ? (
          <div className="survey-complete">
            <CheckCircle2 size={46} />
            <h2>Feedback received</h2>
            <p>Thank you for helping RTB improve.</p>
          </div>
        ) : null}

        {!completed && !expired ? (
          <form className="survey-form" onSubmit={submitSurvey}>
            <StarRating
              label="Overall experience"
              name="overall_rating"
              setValue={setValue}
              value={form.overall_rating}
            />
            <StarRating
              label="How welcoming was the salon?"
              name="welcome_rating"
              setValue={setValue}
              value={form.welcome_rating}
            />
            <StarRating
              label="How clean was the salon?"
              name="cleanliness_rating"
              setValue={setValue}
              value={form.cleanliness_rating}
            />
            <StarRating
              label="How professional was the service?"
              name="professionalism_rating"
              setValue={setValue}
              value={form.professionalism_rating}
            />
            <StarRating
              label="How was the atmosphere?"
              name="atmosphere_rating"
              setValue={setValue}
              value={form.atmosphere_rating}
            />

            <OptionGroup
              label="Did your appointment start on time?"
              name="appointment_started_on_time"
              options={ON_TIME_OPTIONS}
              setValue={setValue}
              value={form.appointment_started_on_time}
            />

            <label className="field">
              <span>What was the best part of your visit?</span>
              <textarea
                value={form.favorite_part}
                onChange={(event) => setValue('favorite_part', event.target.value)}
              />
            </label>

            <label className="field">
              <span>If you owned {businessName}, what is the first thing you would improve?</span>
              <textarea
                value={form.improvement_suggestion}
                onChange={(event) => setValue('improvement_suggestion', event.target.value)}
              />
            </label>

            <OptionGroup
              label="Would you return?"
              name="would_return"
              options={RETURN_OPTIONS}
              setValue={setValue}
              value={form.would_return}
            />

            <label className="field survey-slider">
              <span>Would you recommend us?</span>
              <strong>{form.recommend_business}/10</strong>
              <input
                max="10"
                min="0"
                type="range"
                value={form.recommend_business}
                onChange={(event) => setValue('recommend_business', Number(event.target.value))}
              />
            </label>

            <label className="field">
              <span>Anything else you'd like us to know?</span>
              <textarea
                value={form.additional_comments}
                onChange={(event) => setValue('additional_comments', event.target.value)}
              />
            </label>

            <button className="primary-button survey-submit" disabled={submitting} type="submit">
              <Send size={17} />
              {submitting ? 'Sending feedback...' : 'Send feedback'}
            </button>
          </form>
        ) : null}
      </section>
    </main>
  );
}
