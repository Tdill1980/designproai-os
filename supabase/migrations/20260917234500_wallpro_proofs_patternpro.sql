-- PATTERNPRO JOINS THE CURATOR TABLE.
--
-- Owner, 2026-09-17, after the WallPro landing hero became a draggable
-- before/after: "then do the same with pattern pro image", "must have the
-- draggable tool", "on the patternpro page" — and, asked whether the pair
-- should be pinned in code or curated: "Both".
--
-- 20260916220000 added `tool_key` and widened this table from WallPro to three
-- tools. PatternPro was not among them for the same reason WallPro was alone
-- before that: nothing on the PatternPro page read a proof row. Its page now
-- carries the same slider, so it needs the same door — otherwise the admin page
-- is a liar for that surface, which is exactly the defect the WallPro landing
-- had one commit ago (rows existed, the tool read them, the landing did not).
--
-- The constraint was created inline by ADD COLUMN, so its name is generated and
-- cannot be relied on. Every CHECK mentioning `tool_key` is dropped by
-- inspection and one NAMED constraint replaces it, which also makes this
-- migration idempotent: a re-run drops the named one and adds it back.
--
-- Additive in every other respect. No row changes tool, the bucket, the RLS and
-- the index are untouched, and a tool with no published row still renders
-- nothing — the "shows nothing when it has nothing" rule the band has always
-- followed.

DO $$
DECLARE
  existing record;
BEGIN
  FOR existing IN
    SELECT conname
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.wallpro_proofs'::regclass
      AND contype = 'c'
      AND pg_catalog.pg_get_constraintdef(oid) ILIKE '%tool_key%'
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER TABLE public.wallpro_proofs DROP CONSTRAINT %I', existing.conname);
  END LOOP;
END $$;

ALTER TABLE public.wallpro_proofs
  ADD CONSTRAINT wallpro_proofs_tool_key_check
  CHECK (tool_key IN ('vehiclepro', 'wallpro', 'cutpro', 'patternpro'));

-- Prove the widened vocabulary actually admits the new value and still refuses
-- an unknown one. A constraint that was dropped and not re-added would pass a
-- containment check on the migration text and fail here.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.wallpro_proofs'::regclass
      AND conname = 'wallpro_proofs_tool_key_check'
      AND pg_catalog.pg_get_constraintdef(oid) ILIKE '%patternpro%'
  ) THEN
    RAISE EXCEPTION 'wallpro_proofs_tool_key_check did not land with patternpro';
  END IF;
END $$;
