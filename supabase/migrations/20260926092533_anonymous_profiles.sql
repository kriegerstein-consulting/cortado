-- Anonymous profiles
-- Public listings show only what a person offers (role, employer, location, experience, tags, bio).
-- Names, LinkedIn and contact details stay private until a booking request is CONFIRMED;
-- then both sides see each other's name and email. Until then bankers see students only as
-- "Student S-1234 · university · target market".
--
-- Written against the schema of 20260926090336_init_schema.sql. No data exists yet, so columns can be
-- moved/dropped safely. Do not run this on a database that already holds real profiles without a backfill.

-- ---------------------------------------------------------------- public handles ("B-1001", "S-1001")
create sequence public.banker_handle_seq start 1000;
create sequence public.student_handle_seq start 1000;

alter table public.banker_profiles
  add column handle text not null default ('B-' || nextval('public.banker_handle_seq')::text);
create unique index banker_profiles_handle_key on public.banker_profiles (handle);

alter table public.profiles
  add column handle text not null default ('S-' || nextval('public.student_handle_seq')::text);
create unique index profiles_handle_key on public.profiles (handle);

-- ---------------------------------------------------------------- identifying fields move to the private table
alter table public.banker_private
  add column full_name text not null default '',
  add column linkedin  text check (char_length(linkedin) <= 200);
alter table public.banker_private alter column full_name drop default;

alter table public.banker_profiles
  drop column name,
  drop column linkedin;

-- clients may set only these columns on their own profile row (handle is assigned by the database)
revoke insert, update on public.profiles from authenticated;
grant insert (id, name, is_student, is_banker, university, market, interest_tags) on public.profiles to authenticated;
grant update (name, is_student, is_banker, university, market, interest_tags)      on public.profiles to authenticated;

-- ---------------------------------------------------------------- bookings: no names stored on the row
alter table public.bookings
  drop column banker_name,
  drop column student_name,
  add column banker_headline text not null default '';
alter table public.bookings alter column banker_headline drop default;

-- the raw table is no longer readable by clients; they read the masked view below
revoke select on public.bookings from authenticated;
drop policy bookings_select on public.bookings;

-- SECURITY DEFINER view (intended): it reads the private tables as its owner and filters to the caller's own
-- bookings via auth.uid(). counterpart_name / counterpart_email are NULL unless status = 'confirmed'.
create view public.my_bookings as
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
  end as counterpart_email
from public.bookings b
join public.banker_profiles bp  on bp.id = b.banker_id
join public.banker_private  bpr on bpr.banker_id = bp.id
join public.profiles        sp  on sp.id = b.student_id
join auth.users             bu  on bu.id = bp.user_id
join auth.users             su  on su.id = b.student_id
where b.student_id = auth.uid() or bp.user_id = auth.uid();

revoke all on public.my_bookings from anon, authenticated;
grant select on public.my_bookings to authenticated;

-- ---------------------------------------------------------------- request_booking: snapshot the public headline, not names
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

  insert into public.bookings (
    banker_id, slot_id, student_id, message, slot_start, price, currency, duration,
    banker_headline, banker_employer
  ) values (
    v_banker.id, v_slot.id, v_uid, left(coalesce(p_message, ''), 1000), v_slot.start_at, v_banker.price, v_banker.currency, v_banker.duration,
    case when v_banker.type = 'former' then 'Former ' else '' end || v_banker.role, v_banker.employer
  ) returning id into v_id;

  update public.slots set taken = true where id = v_slot.id;
  return v_id;
end;
$$;

revoke execute on function public.request_booking(uuid, text) from public, anon;
grant  execute on function public.request_booking(uuid, text) to authenticated;
