-- Work-email verification for current bankers
--
-- The login email (password account) is verified by Supabase Auth. A banker's WORK email is verified separately,
-- because one account can be student and banker and must not be tied to the employer mailbox.
--
-- Flow (no extra mail service needed):
--   1. The banker (signed in) calls start_work_email_check(work_email) and receives a secret nonce.
--   2. The browser asks Supabase Auth to send an email code to the work address using a throwaway client that
--      is NOT the banker's own session, and verifies it. That proves control of the work mailbox.
--   3. With that throwaway session the browser calls complete_work_email_check(nonce). The function checks that the
--      signed-in mailbox equals the address registered under the nonce, then marks the banker's work email as verified.
--      If the domain is on employer_domains, the profile becomes 'verified' and its employer is set to the canonical name.
--   Only someone who holds the nonce (the banker's own browser) AND can read the work mailbox can complete a check.

alter table public.banker_private add column work_email_verified_at timestamptz;

-- ---------------------------------------------------------------- known employer domains (extend as needed)
create table public.employer_domains (
  domain   text primary key check (domain = lower(domain)),
  employer text not null
);
alter table public.employer_domains enable row level security;   -- no policies: readable only by the functions below
revoke all on public.employer_domains from anon, authenticated;

insert into public.employer_domains (domain, employer) values
  ('db.com',                 'Deutsche Bank'),
  ('gs.com',                 'Goldman Sachs'),
  ('jpmorgan.com',           'J.P. Morgan'),
  ('morganstanley.com',      'Morgan Stanley'),
  ('ubs.com',                'UBS'),
  ('citi.com',               'Citi'),
  ('barclays.com',           'Barclays'),
  ('bnpparibas.com',         'BNP Paribas'),
  ('hsbc.com',               'HSBC'),
  ('commerzbank.com',        'Commerzbank'),
  ('bofa.com',               'Bank of America'),
  ('socgen.com',             'Société Générale'),
  ('nomura.com',             'Nomura'),
  ('jefferies.com',          'Jefferies'),
  ('lazard.com',             'Lazard'),
  ('evercore.com',           'Evercore'),
  ('moelis.com',             'Moelis'),
  ('rothschildandco.com',    'Rothschild & Co'),
  ('hl.com',                 'Houlihan Lokey'),
  ('pwpartners.com',         'Perella Weinberg Partners'),
  ('centerview.com',         'Centerview Partners'),
  ('blackstone.com',         'Blackstone'),
  ('kkr.com',                'KKR');

-- ---------------------------------------------------------------- pending checks
create table public.work_email_checks (
  nonce      text primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  banker_id  uuid not null references public.banker_profiles (id) on delete cascade,
  work_email text not null,
  expires_at timestamptz not null,
  used_at    timestamptz
);
alter table public.work_email_checks enable row level security;   -- no policies: functions only
revoke all on public.work_email_checks from anon, authenticated;

-- ---------------------------------------------------------------- step 1: register the address, get a nonce
create function public.start_work_email_check(p_work_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_banker public.banker_profiles%rowtype;
  v_email  text := lower(trim(coalesce(p_work_email, '')));
  v_nonce  text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into v_banker from public.banker_profiles where user_id = v_uid;
  if not found or v_banker.type <> 'current' then
    raise exception 'a current banker profile is required' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid email address' using errcode = 'P0001';
  end if;

  update public.banker_private
     set work_email = v_email, work_email_verified_at = null
   where banker_id = v_banker.id;
  insert into public.work_email_checks (nonce, user_id, banker_id, work_email, expires_at)
       values (v_nonce, v_uid, v_banker.id, v_email, now() + interval '30 minutes');
  return v_nonce;
end;
$$;

-- ---------------------------------------------------------------- step 3: confirm from the work-mailbox session
create function public.complete_work_email_check(p_nonce text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_email    text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_chk      public.work_email_checks%rowtype;
  v_domain   text;
  v_employer text;
  v_auto     boolean := false;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_chk from public.work_email_checks where nonce = p_nonce for update;
  if not found or v_chk.used_at is not null or v_chk.expires_at < now() then
    raise exception 'verification expired or invalid' using errcode = 'P0001';
  end if;
  if v_email = '' or v_email <> v_chk.work_email then
    raise exception 'this mailbox does not match the registered work email' using errcode = '42501';
  end if;

  update public.work_email_checks set used_at = now() where nonce = p_nonce;
  update public.banker_private set work_email_verified_at = now() where banker_id = v_chk.banker_id;

  v_domain := split_part(v_email, '@', 2);
  select d.employer into v_employer
    from public.employer_domains d
   where v_domain = d.domain or v_domain like '%.' || d.domain
   order by length(d.domain) desc
   limit 1;

  if v_employer is not null then
    update public.banker_profiles
       set status = 'verified', employer = v_employer
     where id = v_chk.banker_id and status = 'pending' and type = 'current';
    v_auto := found;
  end if;

  return jsonb_build_object('mailbox_verified', true, 'auto_verified', v_auto, 'employer', v_employer);
end;
$$;

revoke execute on function public.start_work_email_check(text)    from public, anon;
revoke execute on function public.complete_work_email_check(text) from public, anon;
grant  execute on function public.start_work_email_check(text)    to authenticated;
grant  execute on function public.complete_work_email_check(text) to authenticated;
