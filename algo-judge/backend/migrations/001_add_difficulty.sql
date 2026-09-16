-- Adds the AI-estimated difficulty rating to saved problems.
--
-- Run this in the Supabase SQL editor before saving any new problem,
-- otherwise /finalize-problem fails on the missing column.
--
-- The check constraint keeps the column aligned with the Literal in
-- gemini_parser.py, so a bad value fails loudly at the database
-- rather than reaching the UI as an unstyled badge.

alter table public.problems
  add column if not exists difficulty text
    not null
    default 'Medium';

alter table public.problems
  drop constraint if exists problems_difficulty_check;

alter table public.problems
  add constraint problems_difficulty_check
    check (difficulty in ('Easy', 'Medium', 'Hard'));
