-- Run in Supabase SQL Editor. Create your Auth user first; then insert its UUID into owner_accounts.
-- This is a single-owner application. Never place a service_role key in browser files.
create extension if not exists pgcrypto;
create table if not exists public.owner_accounts (user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.owner_accounts enable row level security;
create policy "owner sees own account" on public.owner_accounts for select to authenticated using (user_id=auth.uid());

create or replace function public.is_bayou_owner() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.owner_accounts where user_id=auth.uid()); $$;
revoke all on function public.is_bayou_owner() from public;
grant execute on function public.is_bayou_owner() to authenticated;

create table if not exists public.courses (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users(id),
 title text not null, code text default '', cu integer not null default 3 check(cu>=0), domain text default '',
 status text not null default 'Not Started' check(status in ('Needs Evaluation','Not Started','In Progress','Passed','Transferred','On Hold')),
 progress integer not null default 0 check(progress between 0 and 100), notes text default '', created_at timestamptz not null default now());
create table if not exists public.resources (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users(id),
 area text default '', topic text default '', title text not null, format text default '', url text not null,
 purpose text default '', status text default '', created_at timestamptz not null default now());
create table if not exists public.flashcards (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users(id),
 course_id uuid not null references public.courses(id) on delete cascade, front text not null, back text not null,
 created_at timestamptz not null default now());
create table if not exists public.quiz_questions (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users(id),
 course_id uuid not null references public.courses(id) on delete cascade, topic text default '', prompt text not null,
 options jsonb not null, correct_index integer not null check(correct_index between 0 and 3),
 explanation text default '', created_at timestamptz not null default now());
create table if not exists public.quiz_attempts (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users(id),
 course_id uuid not null references public.courses(id) on delete cascade,
 score integer not null, total integer not null, answers jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now());
create table if not exists public.private_notes (
 key text primary key, owner_id uuid not null default auth.uid() references auth.users(id),
 body text not null default '', created_at timestamptz not null default now());
create table if not exists public.public_resources (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users(id),
 title text not null, course_code text default '', kind text default 'Study resource',
 description text default '', url text default '', body text default '', published boolean not null default false,
 created_at timestamptz not null default now());

-- Private tables: no anonymous access, even by guessing IDs or querying REST endpoints.
do $$ declare t text; begin
 foreach t in array array['courses','resources','flashcards','quiz_questions','quiz_attempts','private_notes'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy "bayou owner read" on public.%I for select to authenticated using (public.is_bayou_owner() and owner_id=auth.uid())',t);
  execute format('create policy "bayou owner insert" on public.%I for insert to authenticated with check (public.is_bayou_owner() and owner_id=auth.uid())',t);
  execute format('create policy "bayou owner update" on public.%I for update to authenticated using (public.is_bayou_owner() and owner_id=auth.uid()) with check (public.is_bayou_owner() and owner_id=auth.uid())',t);
  execute format('create policy "bayou owner delete" on public.%I for delete to authenticated using (public.is_bayou_owner() and owner_id=auth.uid())',t);
 end loop;
end $$;
-- Public resources are the ONLY table readable without login, and only published records.
alter table public.public_resources enable row level security;
create policy "published resources visible" on public.public_resources for select to anon, authenticated using (published or (public.is_bayou_owner() and owner_id=auth.uid()));
create policy "owner publishes" on public.public_resources for insert to authenticated with check (public.is_bayou_owner() and owner_id=auth.uid());
create policy "owner edits publications" on public.public_resources for update to authenticated using (public.is_bayou_owner() and owner_id=auth.uid()) with check (public.is_bayou_owner() and owner_id=auth.uid());
create policy "owner removes publications" on public.public_resources for delete to authenticated using (public.is_bayou_owner() and owner_id=auth.uid());

-- IMPORTANT: Replace UUID below with your actual Supabase Authentication > Users UUID.
-- Run separately AFTER creating your user:
-- insert into public.owner_accounts (user_id) values ('YOUR-USER-UUID-HERE');
