-- THE SAME CURATOR TABLE SERVES ALL THREE TOOLS.
--
-- Owner, 2026-09-16: "do the admin page" -- for VehiclePro and CutPro, not
-- just WallPro. wallpro_proofs (20260915030000) already IS that admin page:
-- a curator uploads a before/after, writes its words, orders it, publishes
-- it, no deploy. It was scoped to `brand` (which page-skin: designpro vs
-- weprintwraps) because WallPro is the only tool with a partner skin. It has
-- no notion of WHICH TOOL a row belongs to, because only one tool used it.
--
-- `tool_key` is that missing dimension, orthogonal to `brand`: `brand` picks
-- the skin a WallPro row shows under, `tool_key` picks which tool's band a
-- row belongs to at all. VehiclePro and CutPro have no partner skin, so their
-- rows are always `brand = 'designpro'` and differ only by `tool_key`.
--
-- The table, its bucket and its RLS are UNCHANGED otherwise: a curator with
-- admin/tester role may write, anyone may read a published row, and an empty
-- result for a tool that has never had a row published renders nothing --
-- the same "shows nothing when it has nothing" rule the band has always
-- followed, now true per tool instead of per brand.
--
-- Existing rows (there are none in production yet) default to 'wallpro', so
-- this is additive and changes no currently-published row's tool.

ALTER TABLE public.wallpro_proofs
  ADD COLUMN IF NOT EXISTS tool_key text NOT NULL DEFAULT 'wallpro'
    CHECK (tool_key IN ('vehiclepro', 'wallpro', 'cutpro'));

DROP INDEX IF EXISTS public.wallpro_proofs_band;
CREATE INDEX IF NOT EXISTS wallpro_proofs_band
  ON public.wallpro_proofs(tool_key, brand, published, position);
