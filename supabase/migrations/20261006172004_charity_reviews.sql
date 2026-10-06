-- Charity model + reviews (replaces paid chats and employer verification)
--
-- After the compliance feedback (conflict of interest, mixing private activity with the employment relationship,
-- work-email verification) the model changes:
--   * Bankers receive nothing. The amount a student pays for a chat is a DONATION to a charity the banker picks
--     from our curated list. Cortado collects it and forwards 100%; Cortado earns money from ads only.
--   * No employer verification. Bankers list themselves with a self-declaration (declared_at).
--     Profiles go live immediately; the team can still hide one by setting status = 'rejected'.
--     From now on banker_profiles.status = 'verified' simply means "listed".
--   * Trust comes from reviews: after a confirmed chat has started, the student can rate it once (1–5 + comment).
--     banker_profiles.rating / chats are maintained by submit_review and stay read-only for clients.

-- ---------------------------------------------------------------- charities (curated list, public)
create table public.charities (
  id    text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  name  text not null,
  cause text not null,
  url   text not null,
  sort  int  not null default 0
);
alter table public.charities enable row level security;
create policy charities_select on public.charities for select to anon, authenticated using (true);
revoke all on public.charities from anon, authenticated;
grant select on public.charities to anon, authenticated;

insert into public.charities (id, name, cause, url, sort) values
  ('arbeiterkind', 'ArbeiterKind.de',               'First-generation students on their way into university and work', 'https://www.arbeiterkind.de', 10),
  ('teach-first',  'Teach First',                    'Educational equity for children from low-income backgrounds',      'https://www.teachfirst.org.uk', 20),
  ('unicef',       'UNICEF',                         'Children''s rights and emergency relief worldwide',                'https://www.unicef.org', 30),
  ('msf',          'Doctors Without Borders (MSF)',  'Medical humanitarian aid in crises and conflicts',                 'https://www.msf.org', 40),
  ('givedirectly', 'GiveDirectly',                   'Direct cash transfers to people living in extreme poverty',        'https://www.givedirectly.org', 50),
  ('ifrc',         'Red Cross / Red Crescent (IFRC)','Disaster relief and community health',                            'https://www.ifrc.org', 60),
  ('wwf',          'WWF',                            'Nature conservation and climate protection',                       'https://www.worldwildlife.org', 70);

-- ---------------------------------------------------------------- banker_profiles: charity + self-declaration, live on creation
alter table public.banker_profiles
  add column charity_id  text references public.charities (id),
  add column declared_at timestamptz not null default now();
update public.banker_profiles set charity_id = 'arbeiterkind' where charity_id is null;
alter table public.banker_profiles alter column charity_id set not null;

update public.banker_profiles set status = 'verified' where status = 'pending';
alter table public.banker_profiles alter column status set default 'verified';

drop policy bankers_insert_own on public.banker_profiles;
create policy bankers_insert_own on public.banker_profiles for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'verified' and rating is null and chats = 0);

grant insert (charity_id) on public.banker_profiles to authenticated;
grant update (charity_id) on public.banker_profiles to authenticated;

-- ---------------------------------------------------------------- remove work-email verification
drop function public.start_work_email_check(text);
drop function public.complete_work_email_check(text);
drop table public.work_email_checks;
drop table public.employer_domains;
alter table public.banker_private
  drop column work_email,
  drop column work_email_verified_at;

-- ---------------------------------------------------------------- bookings: snapshot the charity
alter table public.bookings
  add column charity_id   text references public.charities (id),
  add column charity_name text;
update public.bookings b
   set charity_id = bp.charity_id, charity_name = c.name
  from public.banker_profiles bp join public.charities c on c.id = bp.charity_id
 where bp.id = b.banker_id and b.charity_id is null;

create or replace function public.request_booking(p_slot_id uuid, p_message text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_student public.profiles%rowtype;
  v_slot    public.slots%rowtype;
  v_banker  public.banker_profiles%rowtype;
  v_charity public.charities%rowtype;
  v_id      uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_student from public.profiles where id = v_uid;
  if not found or not v_student.is_student then
    raise exception 'student profile required' using errcode = '42501';
  end if;

  select * into v_slot from public.slots where id = p_slot_id for update;
  if not found then
    raise exception 'slot not found' using errcode = 'P0002';
  end if;
  if v_slot.taken or v_slot.start_at <= now() then
    raise exception 'slot not available' using errcode = 'P0001';
  end if;

  select * into v_banker from public.banker_profiles where id = v_slot.banker_id;
  if v_banker.status <> 'verified' then
    raise exception 'banker not available' using errcode = 'P0001';
  end if;
  if v_banker.user_id = v_uid then
    raise exception 'cannot book your own profile' using errcode = 'P0001';
  end if;
  select * into v_charity from public.charities where id = v_banker.charity_id;

  insert into public.bookings (
    banker_id, slot_id, student_id, message, slot_start, price, currency, duration,
    banker_headline, banker_employer, charity_id, charity_name
  ) values (
    v_banker.id, v_slot.id, v_uid, left(coalesce(p_message, ''), 1000), v_slot.start_at, v_banker.price, v_banker.currency, v_banker.duration,
    case when v_banker.type = 'former' then 'Former ' else '' end || v_banker.role, v_banker.employer,
    v_charity.id, v_charity.name
  ) returning id into v_id;

  update public.slots set taken = true where id = v_slot.id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------- reviews (public, anonymous)
create table public.reviews (
  booking_id uuid primary key references public.bookings (id) on delete cascade,
  banker_id  uuid not null references public.banker_profiles (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  rating     int  not null check (rating between 1 and 5),
  comment    text not null default '' check (char_length(comment) <= 500),
  created_at timestamptz not null default now()
);
create index reviews_banker_idx on public.reviews (banker_id, created_at desc);
alter table public.reviews enable row level security;
create policy reviews_select on public.reviews for select to anon, authenticated using (true);
revoke all on public.reviews from anon, authenticated;
-- who wrote a review is never exposed: only these columns are readable
grant select (banker_id, rating, comment, created_at) on public.reviews to anon, authenticated;

-- Rate a chat: only the student of a confirmed booking, once, after the chat has started.
create function public.submit_review(p_booking_id uuid, p_rating int, p_comment text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_booking public.bookings%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'rating must be between 1 and 5' using errcode = 'P0001';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id and student_id = v_uid for update;
  if not found then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  if v_booking.status <> 'confirmed' then
    raise exception 'only confirmed chats can be rated' using errcode = 'P0001';
  end if;
  if v_booking.slot_start > now() then
    raise exception 'you can rate the chat once it has taken place' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.reviews where booking_id = p_booking_id) then
    raise exception 'you have already rated this chat' using errcode = 'P0001';
  end if;

  insert into public.reviews (booking_id, banker_id, student_id, rating, comment)
  values (p_booking_id, v_booking.banker_id, v_uid, p_rating, left(trim(coalesce(p_comment, '')), 500));

  update public.banker_profiles bp
     set rating = s.avg_rating, chats = s.n
    from (select round(avg(rating)::numeric, 1) as avg_rating, count(*)::int as n
            from public.reviews where banker_id = v_booking.banker_id) s
   where bp.id = v_booking.banker_id;
end;
$$;

revoke execute on function public.submit_review(uuid, int, text) from public, anon;
grant  execute on function public.submit_review(uuid, int, text) to authenticated;

-- ---------------------------------------------------------------- my_bookings: append charity + own review
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
  case when b.student_id = auth.uid() then null else sp.name end as student_name,
  b.charity_name,
  r.rating        as review_rating,
  r.comment       as review_comment
from public.bookings b
join public.banker_profiles bp  on bp.id = b.banker_id
join public.banker_private  bpr on bpr.banker_id = bp.id
join public.profiles        sp  on sp.id = b.student_id
join auth.users             bu  on bu.id = bp.user_id
join auth.users             su  on su.id = b.student_id
left join public.reviews    r   on r.booking_id = b.id
where b.student_id = auth.uid() or bp.user_id = auth.uid();

revoke all on public.my_bookings from anon, authenticated;
grant select on public.my_bookings to authenticated;
