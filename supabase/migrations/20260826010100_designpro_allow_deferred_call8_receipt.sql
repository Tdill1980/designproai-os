-- Allow the A.T.L.A.S. free-half Call 8 deferral receipt to persist.
--
-- 20260826010000 introduces the distinct receipt kind
-- `call8.flat-proof-deferred` so a recorded proof-build deferral can never be
-- mistaken for a successfully built Call 8 proof. The runtime and completion
-- function already emit that kind, but the historical table CHECK still only
-- admits the pre-A.T.L.A.S. receipt set. That mismatch makes an otherwise valid
-- A.T.L.A.S. deferral fail at INSERT time.
--
-- This migration changes only the receipt-kind enum CHECK. It does not weaken
-- receipt verification, stage completion, ATLAS lineage, GENIE production
-- geometry, or any paid-manufacturing gate.

ALTER TABLE public.designpro_stage_receipts
  DROP CONSTRAINT IF EXISTS designpro_stage_receipts_receipt_kind_check;

ALTER TABLE public.designpro_stage_receipts
  ADD CONSTRAINT designpro_stage_receipts_receipt_kind_check CHECK (receipt_kind IN (
    'views.seven-source',
    'call8.flat-proof',
    'call8.flat-proof-deferred',
    'call9.surface-panels',
    'call10.logo-inventory',
    'call11.qc-panels',
    'panelpro.preflight',
    'call12.topaz-upscale',
    'output.verified',
    'final.human-qc',
    'stamp',
    'zip',
    'wrapbox.delivery'
  ));
