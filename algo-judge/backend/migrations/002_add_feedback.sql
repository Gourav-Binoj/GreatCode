-- Feedback submitted from the Feedback page.
--
-- Run this in the Supabase SQL editor.
--
-- The frontend inserts here directly with the anon key rather than
-- going through FastAPI, because the backend on Render's free tier
-- cold-starts in ~45s and a feedback form that appears to hang is a
-- feedback form nobody uses. Supabase is always warm.

create table if not exists public.feedback (
  id          uuid primary key default gen_random_uuid(),

  -- Null for signed-out visitors. Not a foreign key to auth.users so
  -- that deleting an account never destroys the feedback it left.
  user_id     uuid,
  email       text,

  category    text not null default 'General',
  rating      smallint,
  message     text not null,

  created_at  timestamptz not null default now(),

  -- Set once the email notification has gone out. The notify
  -- endpoint refuses to send twice for the same row, so a replayed
  -- request cannot be used to flood the inbox.
  notified_at timestamptz,

  constraint feedback_rating_range
    check (rating is null or (rating >= 1 and rating <= 5)),

  constraint feedback_message_length
    check (char_length(message) between 1 and 5000),

  constraint feedback_category_allowed
    check (category in ('General', 'Bug', 'Feature request', 'Question'))
);

create index if not exists feedback_created_at_idx
  on public.feedback (created_at desc);


alter table public.feedback enable row level security;


-- Anyone may leave feedback, signed in or not.
drop policy if exists feedback_insert_any on public.feedback;

create policy feedback_insert_any
  on public.feedback
  for insert
  to anon, authenticated
  with check (true);


-- No SELECT or UPDATE policy is created, so the anon key can write
-- feedback and nothing else. Without that, any visitor could read
-- every message and email address ever submitted.
--
-- The backend reads and marks rows with the service role, which
-- bypasses RLS. Read your feedback in the Supabase dashboard, or
-- with:
--   select created_at, category, rating, email, message
--   from public.feedback
--   order by created_at desc;
