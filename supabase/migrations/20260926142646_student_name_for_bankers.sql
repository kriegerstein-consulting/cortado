-- A banker sees the NAME of a student who requests a chat (the student initiates the contact).
-- Bankers stay anonymous towards students until they confirm; a student's email is still shared only after confirmation.
--
-- Same view as before plus one appended column (CREATE OR REPLACE VIEW only allows appending):
--   student_name: the student's name for the banker, NULL when the viewer is the student themself.
create or replace view public.my_bookings as
select
  b.id, b.banker_id, b.slot_id, b.status, b.slot_start, b.price, b.currency, b.duration, b.message, b.created_at,
  b.banker_headline, b.banker_employer,
  bp.handle       as banker_handle,
  sp.handle       as student_handle,
  sp.university   as student_university,
  sp.market       as student_market,
  sp.interest_tags as student_tags,
  (b.student_id = auth.uid()) as viewer_is_student,
  case when b.status = 'confirmed'
       then case when b.student_id = auth.uid() then bpr.full_name else sp.name end
  end as counterpart_name,
  case when b.status = 'confirmed'
       then case when b.student_id = auth.uid() then bu.email::text else su.email::text end
  end as counterpart_email,
  case when b.student_id = auth.uid() then null else sp.name end as student_name
from public.bookings b
join public.banker_profiles bp  on bp.id = b.banker_id
join public.banker_private  bpr on bpr.banker_id = bp.id
join public.profiles        sp  on sp.id = b.student_id
join auth.users             bu  on bu.id = bp.user_id
join auth.users             su  on su.id = b.student_id
where b.student_id = auth.uid() or bp.user_id = auth.uid();

revoke all on public.my_bookings from anon, authenticated;
grant select on public.my_bookings to authenticated;
