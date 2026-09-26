-- The Coffee Desk — initial schema
-- Auth: Supabase Auth (email OTP / magic link). profiles.id = auth.uid().
-- Writes that need cross-table integrity (booking a slot, changing a booking status) go through
-- SECURITY DEFINER functions; clients get no direct write access to slots.taken or bookings.
-- Verification (banker_profiles.status) is set by us with the service role, never by the client.

-- ---------------------------------------------------------------- types
create type public.banker_type         as enum ('current', 'former');
create type public.verification_status as enum ('pending', 'verified', 'rejected');
create type public.booking_status      as enum ('requested', 'confirmed', 'declined', 'cancelled');

-- ---------------------------------------------------------------- profiles (private, one per user)
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 120),
  is_student    boolean not null default false,
  is_banker     boolean not null default false,
  university    text,
  market        text check (market in ('USA', 'UK', 'DACH', 'Other')),
  interest_tags text[] not null default '{}',
  created_at    timestamptz not null default now(),
  check (is_student or is_banker)
);

-- ---------------------------------------------------------------- banker_profiles (public once verified)
create table public.banker_profiles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references public.profiles (id) on delete cascade,
  type       public.banker_type not null default 'current',
  status     public.verification_status not null default 'pending',
  name       text not null check (char_length(name) between 1 and 120),
  employer   text not null check (char_length(employer) between 1 and 120),
  role       text not null check (char_length(role) between 1 and 160),
  location   text not null check (char_length(location) between 1 and 120),
  period     text check (char_length(period) <= 40),           -- e.g. '2022–2025', for type = 'former'
  years      int  not null check (years between 0 and 50),
  linkedin   text check (char_length(linkedin) <= 200),
  currency   text not null default 'USD' check (currency in ('USD', 'EUR', 'GBP', 'CHF')),
  price      numeric(8, 2) not null check (price between 5 and 500),
  duration   int  not null default 30 check (duration in (30, 45, 60)),
  tags       text[] not null default '{}',
  languages  text[] not null default '{}',
  bio        text not null check (char_length(bio) <= 320),
  response   text not null default 'usually within a day',
  rating     numeric(2, 1),                                     -- null until there are reviews
  chats      int not null default 0,
  created_at timestamptz not null default now()
);
create index banker_profiles_status_idx on public.banker_profiles (status);

-- work email is used only for verification and must never be public
create table public.banker_private (
  banker_id  uuid primary key references public.banker_profiles (id) on delete cascade,
  work_email text
);

-- ---------------------------------------------------------------- slots
create table public.slots (
  id        uuid primary key default gen_random_uuid(),
  banker_id uuid not null references public.banker_profiles (id) on delete cascade,
  start_at  timestamptz not null,
  taken     boolean not null default false
);
create index slots_banker_start_idx on public.slots (banker_id, start_at);

-- ---------------------------------------------------------------- bookings (requests)
create table public.bookings (
  id              uuid primary key default gen_random_uuid(),
  banker_id       uuid not null references public.banker_profiles (id),
  slot_id         uuid not null references public.slots (id),
  student_id      uuid not null references public.profiles (id),
  status          public.booking_status not null default 'requested',
  message         text check (char_length(message) <= 1000),
  -- snapshot at request time, so history survives later edits
  slot_start      timestamptz not null,
  price           numeric(8, 2) not null,
  currency        text not null,
  duration        int not null,
  banker_name     text not null,
  banker_employer text not null,
  student_name    text not null,
  university      text,
  created_at      timestamptz not null default now()
);
create index bookings_student_idx on public.bookings (student_id, created_at desc);
create index bookings_banker_idx  on public.bookings (banker_id, created_at desc);

-- ---------------------------------------------------------------- events (validation / Build-Measure-Learn)
create table public.events (
  id         bigint generated always as identity primary key,
  user_id    uuid,
  name       text not null check (char_length(name) between 1 and 64),
  props      jsonb not null default '{}' check (pg_column_size(props) < 4096),
  created_at timestamptz not null default now()
);

-- ================================================================ row level security
alter table public.profiles        enable row level security;
alter table public.banker_profiles enable row level security;
alter table public.banker_private  enable row level security;
alter table public.slots           enable row level security;
alter table public.bookings        enable row level security;
alter table public.events          enable row level security;

-- profiles: strictly own row
create policy profiles_select_own on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_insert_own on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- banker_profiles: verified ones are public, owners always see their own
create policy bankers_select on public.banker_profiles for select to anon, authenticated
  using (status = 'verified' or user_id = (select auth.uid()));
create policy bankers_insert_own on public.banker_profiles for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'pending' and rating is null and chats = 0);
create policy bankers_update_own on public.banker_profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- banker_private: owner only
create policy banker_private_own on public.banker_private for all to authenticated
  using (exists (select 1 from public.banker_profiles bp where bp.id = banker_id and bp.user_id = (select auth.uid())))
  with check (exists (select 1 from public.banker_profiles bp where bp.id = banker_id and bp.user_id = (select auth.uid())));

-- slots: visible whenever the banker profile is visible to the caller; owners add/remove open slots
create policy slots_select on public.slots for select to anon, authenticated
  using (exists (select 1 from public.banker_profiles bp where bp.id = slots.banker_id));
create policy slots_insert_own on public.slots for insert to authenticated
  with check (
    taken = false and start_at > now()
    and exists (select 1 from public.banker_profiles bp where bp.id = banker_id and bp.user_id = (select auth.uid()))
  );
create policy slots_delete_own on public.slots for delete to authenticated
  using (
    taken = false
    and exists (select 1 from public.banker_profiles bp where bp.id = slots.banker_id and bp.user_id = (select auth.uid()))
  );

-- bookings: visible to the student and to the banker; NO direct client writes (use the functions below)
create policy bookings_select on public.bookings for select to authenticated
  using (
    student_id = (select auth.uid())
    or exists (select 1 from public.banker_profiles bp where bp.id = bookings.banker_id and bp.user_id = (select auth.uid()))
  );

-- events: anyone may append, nobody may read via the API
create policy events_insert on public.events for insert to anon, authenticated with check (true);

-- ================================================================ privileges
-- start from nothing, then grant exactly what the policies above expect
revoke all on public.profiles, public.banker_profiles, public.banker_private, public.slots, public.bookings, public.events from anon, authenticated;

grant select, insert, update on public.profiles to authenticated;
grant select on public.banker_profiles to anon, authenticated;
grant insert (user_id, type, name, employer, role, location, period, years, linkedin, currency, price, duration, tags, languages, bio)
  on public.banker_profiles to authenticated;
-- after creation only these fields are editable; employer/role/type changes would bypass verification
grant update (bio, price, currency, duration, tags, languages) on public.banker_profiles to authenticated;
grant select, insert, update on public.banker_private to authenticated;
grant select on public.slots to anon, authenticated;
grant insert (banker_id, start_at) on public.slots to authenticated;
grant delete on public.slots to authenticated;
grant select on public.bookings to authenticated;
grant insert on public.events to anon, authenticated;

-- ================================================================ functions
-- Request a chat: locks the slot, checks everything, creates the booking, marks the slot taken.
create function public.request_booking(p_slot_id uuid, p_message text default '')
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
    banker_name, banker_employer, student_name, university
  ) values (
    v_banker.id, v_slot.id, v_uid, left(coalesce(p_message, ''), 1000), v_slot.start_at, v_banker.price, v_banker.currency, v_banker.duration,
    v_banker.name, v_banker.employer, v_student.name, v_student.university
  ) returning id into v_id;

  update public.slots set taken = true where id = v_slot.id;
  return v_id;
end;
$$;

-- Change a booking's status. Students may cancel their own; bankers may confirm / decline / cancel theirs.
create function public.set_booking_status(p_booking_id uuid, p_status public.booking_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid         uuid := auth.uid();
  v_booking     public.bookings%rowtype;
  v_banker_user uuid;
  v_is_student  boolean;
  v_is_banker   boolean;
  v_ok          boolean := false;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  select user_id into v_banker_user from public.banker_profiles where id = v_booking.banker_id;

  v_is_student := v_booking.student_id = v_uid;
  v_is_banker  := v_banker_user = v_uid;

  if v_is_student and p_status = 'cancelled' and v_booking.status in ('requested', 'confirmed') then
    v_ok := true;
  end if;
  if v_is_banker then
    if v_booking.status = 'requested' and p_status in ('confirmed', 'declined') then v_ok := true; end if;
    if v_booking.status = 'confirmed' and p_status = 'cancelled' then v_ok := true; end if;
  end if;
  if not v_ok then
    raise exception 'status change not allowed' using errcode = '42501';
  end if;

  update public.bookings set status = p_status where id = p_booking_id;
  if p_status in ('cancelled', 'declined') then
    update public.slots set taken = false where id = v_booking.slot_id;
  end if;
end;
$$;

revoke execute on function public.request_booking(uuid, text)                     from public, anon;
revoke execute on function public.set_booking_status(uuid, public.booking_status) from public, anon;
grant  execute on function public.request_booking(uuid, text)                     to authenticated;
grant  execute on function public.set_booking_status(uuid, public.booking_status) to authenticated;
