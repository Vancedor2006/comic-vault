-- ==========================================================================
-- Comic-Vault - Upload engine setup
-- Run once in Supabase Dashboard -> SQL Editor. Safe to re-run.
--
-- Matches the existing schema:
--   comics(id, slug, title, synopsis, genre, reading_mode, cover_url, created_at, author_id -> profiles.id)
--   chapters(id, comic_id, chapter_number, title, created_at)
--   pages(id, chapter_id, page_number, image_url, created_at)
--
-- Adds: write permissions (RLS) for creators, and the "comics" storage bucket.
-- Existing read policies are left untouched; these are added alongside them.
-- ==========================================================================

-- ---------- Table write permissions ---------------------------------------
alter table public.comics   enable row level security;
alter table public.chapters enable row level security;
alter table public.pages    enable row level security;

-- comics: a logged-in user can create/edit/delete only comics they author
drop policy if exists "authors insert own comics" on public.comics;
drop policy if exists "authors update own comics" on public.comics;
drop policy if exists "authors delete own comics" on public.comics;
create policy "authors insert own comics" on public.comics for insert to authenticated with check (author_id = auth.uid());
create policy "authors update own comics" on public.comics for update to authenticated using (author_id = auth.uid());
create policy "authors delete own comics" on public.comics for delete to authenticated using (author_id = auth.uid());

-- chapters: writable if the parent comic belongs to the user
drop policy if exists "authors manage own chapters" on public.chapters;
create policy "authors manage own chapters" on public.chapters for all to authenticated
  using      (exists (select 1 from public.comics c where c.id = comic_id and c.author_id = auth.uid()))
  with check (exists (select 1 from public.comics c where c.id = comic_id and c.author_id = auth.uid()));

-- pages: writable if the chapter's comic belongs to the user
drop policy if exists "authors manage own pages" on public.pages;
create policy "authors manage own pages" on public.pages for all to authenticated
  using (exists (
    select 1 from public.chapters ch join public.comics c on c.id = ch.comic_id
    where ch.id = chapter_id and c.author_id = auth.uid()))
  with check (exists (
    select 1 from public.chapters ch join public.comics c on c.id = ch.comic_id
    where ch.id = chapter_id and c.author_id = auth.uid()));

-- ---------- Storage bucket -------------------------------------------------
-- Public bucket: anyone can view images by URL. 10 MB limit, images only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comics', 'comics', true, 10485760, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Creators may only write inside a folder named after their own user id:
--   comics/{auth.uid()}/...
drop policy if exists "creators upload to own folder" on storage.objects;
drop policy if exists "creators update own files"     on storage.objects;
drop policy if exists "creators delete own files"     on storage.objects;
create policy "creators upload to own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'comics' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "creators update own files" on storage.objects for update to authenticated
  using (bucket_id = 'comics' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "creators delete own files" on storage.objects for delete to authenticated
  using (bucket_id = 'comics' and (storage.foldername(name))[1] = auth.uid()::text);
