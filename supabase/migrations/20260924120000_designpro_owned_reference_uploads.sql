-- A real new-account RecreatePro test failed before generation: the shared
-- gateway creates users/{caller}/revisions/{uuid}/inputs/attachment/{sha}.jpg,
-- while production's input policies omit attachment. This adds ONLY that exact
-- owner-scoped input kind. Existing proof/output policies remain unchanged.
-- No anonymous access, cross-owner access, UPDATE, DELETE, entitlement, QC,
-- production artifact or source-master permissions are granted.
-- [.] is intentional: no SQL string/backslash mode can turn it into a wildcard.

CREATE POLICY designpro_owner_insert_reference_inputs
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'wrap-files'
  AND name ~ (
    '^users/' || (SELECT auth.uid())::text ||
    '/revisions/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/inputs/attachment/[0-9a-f]{64}[.](png|jpg|jpeg|webp|pdf)$'
  )
);

CREATE POLICY designpro_owner_read_reference_inputs
ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'wrap-files'
  AND name ~ (
    '^users/' || (SELECT auth.uid())::text ||
    '/revisions/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/inputs/attachment/[0-9a-f]{64}[.](png|jpg|jpeg|webp|pdf)$'
  )
);

COMMENT ON POLICY designpro_owner_insert_reference_inputs ON storage.objects IS
  'Authenticated owner-only immutable reference uploads for the existing DesignProAI gateway; exact UUID/hash/extension path only.';
COMMENT ON POLICY designpro_owner_read_reference_inputs ON storage.objects IS
  'Authenticated owners may verify and reopen only their own canonical reference-input files; never production outputs or another account.';
