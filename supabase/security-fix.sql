-- ==========================================================================
-- Comic-Vault - Security fix (run once in Supabase -> SQL Editor; safe to re-run)
--
-- Removes rules that let ANYONE, even without logging in, insert rows or
-- upload files. Supabase allows an action if ANY rule allows it, so these
-- cancelled out the proper "authors only" rules.
--
-- After this, only the author-only rules remain:
--   comics:   "Authenticated users can create comics" / "authors insert own comics"
--   chapters: "Authors can create chapters for their comics" / "authors manage own chapters"
--   pages:    "Authors can insert pages into their chapters" / "authors manage own pages"
-- Reading stays public (unchanged).
-- ==========================================================================

-- Database: inserts with no check at all
drop policy if exists "Allow public inserts for comics"   on public.comics;
drop policy if exists "Allow public inserts for chapters" on public.chapters;
drop policy if exists "Allow public inserts for pages"    on public.pages;

-- Storage: anonymous uploads to the old, unused "covers" and "chapter-pages"
-- buckets. Viewing existing files in them is left as it was.
drop policy if exists "Allow Public Select and Insert 1cmn924_1" on storage.objects;
drop policy if exists "Allow Public Select and Insert 1dz9pvo_1" on storage.objects;

-- Check: this should now list NO insert rule whose check is just "true"
select tablename, policyname, cmd, with_check
from pg_policies
where schemaname in ('public', 'storage') and cmd in ('INSERT', 'ALL')
order by tablename, policyname;
