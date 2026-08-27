drop policy if exists talent_reviews_insert on public.talent_reviews;
create policy talent_reviews_insert on public.talent_reviews for insert to authenticated
with check (
  private.can_manage_talent_business(business_unit_id)
  and exists (
    select 1 from public.talent_candidates c
    where c.id = talent_reviews.candidate_id
      and c.business_unit_id = talent_reviews.business_unit_id
  )
);

drop policy if exists talent_reviews_update on public.talent_reviews;
create policy talent_reviews_update on public.talent_reviews for update to authenticated
using (private.can_manage_talent_business(business_unit_id))
with check (
  private.can_manage_talent_business(business_unit_id)
  and exists (
    select 1 from public.talent_candidates c
    where c.id = talent_reviews.candidate_id
      and c.business_unit_id = talent_reviews.business_unit_id
  )
);
