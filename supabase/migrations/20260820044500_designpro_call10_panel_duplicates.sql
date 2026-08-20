-- Call 10: persist the six exact branded working duplicates BEFORE Call 11.
--
-- `panel` remains the only authoritative production-panel kind. Call 10 copies
-- each verified Call 9 panel byte-for-byte to `panel-duplicate`; Call 11 may
-- consume only those duplicates and emits `qc-panel` after de-logo/de-letter.
-- Neither duplicate kind is printable or eligible for Topaz/output.

ALTER TABLE public.designpro_artifacts
  DROP CONSTRAINT IF EXISTS designpro_artifacts_artifact_kind_check;
ALTER TABLE public.designpro_artifacts
  ADD CONSTRAINT designpro_artifacts_artifact_kind_check CHECK (artifact_kind IN (
    'flat-proof','panel','panel-duplicate','qc-panel','upscaled-panel','logo','output','stamp','zip','wrapbox-manifest'
  ));
