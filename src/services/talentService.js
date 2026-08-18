import { supabase } from '../lib/supabaseClient';

function client() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}
function dataOrThrow({ data, error }) { if (error) throw error; return data; }

export async function getTalentPipeline(businessUnitId) {
  let query = client().from('talent_pipeline_summary').select('*').order('created_at', { ascending: false });
  if (businessUnitId) query = query.eq('business_unit_id', businessUnitId);
  return dataOrThrow(await query);
}

export async function getTalentReviews(candidateId) {
  return dataOrThrow(await client().from('talent_reviews').select('*').eq('candidate_id', candidateId).order('review_day'));
}

export async function saveTalentCandidate(candidate) {
  const payload = {
    ...candidate,
    permanent_brand_endorsement: candidate.stage === 'official' ? true : Boolean(candidate.permanent_brand_endorsement),
    updated_at: new Date().toISOString(),
  };
  const result = candidate.id
    ? await client().from('talent_candidates').update(payload).eq('id', candidate.id).select().single()
    : await client().from('talent_candidates').insert(payload).select().single();
  return dataOrThrow(result);
}

export async function advanceTalentCandidate(candidate, stage) {
  const earningStage = ['new_talent', 'probation', 'official'].includes(stage);
  return saveTalentCandidate({
    ...candidate,
    stage,
    stage_started_at: new Date().toISOString(),
    public_booking_enabled: earningStage,
    walk_ins_enabled: earningStage,
    social_visibility_enabled: earningStage,
    permanent_brand_endorsement: stage === 'official',
  });
}

export async function saveTalentReview(review) {
  const payload = { ...review };
  delete payload.fit_score;
  delete payload.opportunity_conversion_rate;
  const result = review.id
    ? await client().from('talent_reviews').update(payload).eq('id', review.id).select().single()
    : await client().from('talent_reviews').upsert(payload, { onConflict: 'candidate_id,review_day' }).select().single();
  return dataOrThrow(result);
}

export function calculateFitScore(review = {}) {
  const weights = {
    attendance: .20, reliability: .15, service_quality: .15, client_experience: .15,
    rebooking_retention: .10, policy_compliance: .10, professionalism: .10, content_participation: .05,
  };
  return Math.round(Object.entries(weights).reduce((sum, [key, weight]) => sum + Number(review[key] || 0) * weight, 0) * 10) / 10;
}

export function recommendationFor(review = {}) {
  if (review.critical_failure) return 'exit';
  const score = calculateFitScore(review);
  if (score >= 85) return 'advance';
  if (score >= 75) return 'continue';
  if (score >= 65) return 'improvement_plan';
  return 'exit';
}