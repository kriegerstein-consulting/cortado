# Cortado

A two-sided marketplace where students book a paid 1:1 career conversation with a verified banker.
Current and former bankers are listed by what they offer, not by name; names and contact details are exchanged once a request is confirmed.

> **Status: MVP prototype.** Booking requests only — no real payments are processed. Built for the Frankfurt School Entrepreneurship course.

## Run it locally

No build step. Serve the folder with any static server and open it in a browser:

```bash
python3 -m http.server 8123
# open http://localhost:8123
```

The site talks to the hosted Supabase project configured in `js/config.js`, so it needs an internet connection.
Open it over `http://` (not by double-clicking the file) so that browser storage and auth work.

## How it works

| Role | What they can do |
|---|---|
| **Visitor** | Browse verified banker profiles |
| **Student** | Request a time slot, follow requests under *My Bookings* |
| **Banker** | Create a profile with price and slots, confirm / decline requests in the *Dashboard* |
| **Both** | One account can be student and banker; switch with the toggle in the navigation |

**Privacy rules**
- Banker profiles show role, employer, location, experience, tags, bio and price. Never the name, LinkedIn or contact details.
- A banker sees the **name, university and target market** of a student who requests a chat.
- Once a request is **confirmed**, both sides see each other's name and email. Not before.

**Banker types and verification**
- **Current** banker: verifies the *work email* with a separate code from the dashboard (**Verify your work email now**). If the domain is on `employer_domains`, the profile becomes `verified` automatically and the employer is set to the canonical name. Otherwise it stays `pending` for manual review.
- **Former** banker: verified manually (LinkedIn review). Profiles carry a visible **Former** badge.
- Nobody can verify themselves. Status changes are made by the team, e.g. in the Supabase SQL editor:
  ```sql
  update public.banker_profiles set status = 'verified' where handle = 'B-1001';
  ```

**Accounts**: email + password. New accounts confirm their email with a code; login afterwards is password only. Password reset works with a code as well.

## Project layout

```
index.html            page shell and views
styles.css            design tokens and components (self-hosted Inter, light/dark)
fonts/                Inter (OFL)
js/
  vendor/supabase.js  supabase-js, vendored (see supabase.VERSION) — no CDN requests
  config.js           Supabase URL + publishable key (public by design)
  core.js             shared state (CD.State), helpers, data layer (CD.store)
  nav.js              routing, role-aware navigation, event delegation
  onboarding.js       sign up / login / password reset / banker + student onboarding
  market.js           marketplace, profile modal, booking request, student bookings
  dashboard.js        banker dashboard, slots, work-email verification
  app.js              boot
supabase/
  migrations/         database schema (apply in order)
  remote-auth/        auth settings applied to the hosted project (subset)
  config.toml         Supabase CLI defaults for local development
```

Plain scripts share one namespace (`window.CD`). The UI renders from an in-memory cache (`CD.State`); `CD.store` loads it from Supabase and performs every write. Clicks and form submits use `data-action` / `data-form` attributes handled by one delegated listener in `nav.js`.

## Backend (Supabase)

Project ref `taeztgpapuyptolbowum`, region `eu-central-1` (Frankfurt).

| Migration | What it adds |
|---|---|
| `…_init_schema` | tables, row level security, `request_booking` / `set_booking_status` functions |
| `…_anonymous_profiles` | names and LinkedIn moved to a private table, public handles, masked `my_bookings` view |
| `…_work_email_verification` | `employer_domains`, `start_work_email_check` / `complete_work_email_check` |
| `…_student_name_for_bankers` | banker sees the student's name on a request |

Key rules, all enforced in the database (not in the browser):
- Clients cannot read raw `bookings`; they read the `my_bookings` view, which fills counterpart name/email only when a request is `confirmed`.
- Booking a slot and changing a status go through `SECURITY DEFINER` functions (atomic, permission-checked).
- Clients cannot set `status`, `rating` or `chats` on a banker profile, and cannot edit employer or role after creation.
- The work email lives in `banker_private` and is never public.

Working with the database (needs a Supabase account with access to the project):

```bash
supabase login
supabase link --project-ref taeztgpapuyptolbowum
supabase db push                                   # apply new migrations
supabase migration new <name>                      # create a migration
supabase config diff --workdir supabase/remote-auth --project-ref taeztgpapuyptolbowum   # preview auth settings
```

`supabase/remote-auth` only declares the auth settings we change (code length, minimum password length, email templates). Everything else, including **SMTP** (sender domain) and the **Confirm signup** template, is managed in the Supabase dashboard. All email templates must contain `{{ .Token }}` because the site uses codes, not links.

Setting up your own project instead: create a Supabase project, run all migrations, enable email + password auth with email confirmation, set the three templates to show `{{ .Token }}`, and put your URL and publishable key into `js/config.js`.

## Security notes

- The **publishable key** in `js/config.js` is meant for browsers; access is limited by row level security. **Never** commit a `service_role` / secret key, SMTP passwords or personal API keys.
- Everything the site loads comes from this repo (fonts, supabase-js), so there are no third-party requests from the browser except to Supabase.
- The access rules were verified with rollback-only SQL tests using synthetic users. These tests are not in the repo yet.

## Not built yet

- Notifications by email (new request, confirmation)
- Real payments, terms and conditions, refund handling
- Impressum and privacy policy for a public launch
- Admin interface for verification (currently manual via SQL / dashboard)
- Automated tests, deployment (static hosting on the Hetzner VPS), production SMTP setup
- Extending the `employer_domains` list beyond the initial 23 banks
