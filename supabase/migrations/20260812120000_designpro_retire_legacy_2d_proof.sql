-- Retire the legacy 2D-proof authority from the sanctioned Calls 1-7 engine.
--
-- Calls 1-7 produce the seven immutable source renders and nothing else. The
-- 2D production proof is Call 8, and this operating system now authors it
-- itself: one continuous flat wrap design, cut into the six production panels
-- at fixed rectangles.
--
-- 'generate-2d-proof' remained in the frozen engine contract from the period
-- when the historical pipeline owned the proof. While it was sanctioned here, a
-- legacy runner carrying that function could present a valid contract and claim
-- generation work for this system. Removing the blob makes that claim fail at
-- the door with generation_contract_drift instead of consuming attempts.
--
-- This is a deliberate breaking change to the handoff contract. A generation
-- runner must present designpro.calls-1-7-engine.v2 -- that is, it must have
-- given up 2D-proof authority -- before it can hand seven renders to this
-- system. The version bump makes a stale runner fail with a legible mismatch
-- rather than an opaque hash difference.

CREATE OR REPLACE FUNCTION designpro_private.calls_1_7_engine_contract()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
    'contractVersion','designpro.calls-1-7-engine.v2',
    'sourceCommit','bdb26365904e91be446894e84b01b4a24f64aac0',
    'sourceBlobs',pg_catalog.jsonb_build_object(
      'design-panel-ai-generate','4df3a9741c4f0721afb00b4db823fe7022147aa6',
      'generate-color-render','0eda353a80eb3e60b293d9a99ba3e7d69ab9f065',
      'generate-pattern-render','8114c56cbb1934569bf659a5f6957c680b9bf868',
      'design-on-vehicle-photo','a962133b04c335754cf3df307505ed2da652bdda',
      'edit-vehicle-photo','3843e2b66a8583e16e514a545b7827cf77fade17',
      'studio-os','6870eaebab4d43ef8605d812416f86621727d3e9',
      'view-angles-os','03d6282d71faeec37d0fd304f3bc234d9a3cf0a4'
    ),
    'sourceViewOrder',pg_catalog.jsonb_build_array(
      'side','passenger-side','hood_detail','front','rear','close-up','roof'
    ),
    'freezePolicy','exact-source-blob-behavior',
    'retiredBlobs',pg_catalog.jsonb_build_array('generate-2d-proof'),
    'proofAuthority','designpro-os-call8'
  )
$fn$;
