-- The operator could not see the seven views their own generation produced.
--
-- Calls 1-7 writes each view to
--   designpro/user_<owner_id>/<generation_id>/calls-1-7/<sourceViewType>/<sha256>.<ext>
-- but designpro_owner_read_wrap_files only admits two shapes: a revision input
-- under users/<uid>/revisions/..., and a derived artifact under
-- designpro/<tenant_key>/<workflow_run_id>/. The third segment of a generation
-- path is the generation id, not a workflow run id, and while Calls 1-7 is
-- running there is no workflow run at all -- it is the handoff that creates
-- one. So no policy ever matched.
--
-- Storage answers an RLS-denied read with "Object not found", so the gateway's
-- sign call failed, /generation/requests/:id/views returned each view without a
-- signedUrl, and the generation screen showed seven permanently pending tiles
-- while the bytes sat in the bucket. Confirmed live: all seven objects exist in
-- wrap-files and signing returns NoSuchKey for their owner.
--
-- This grants exactly that subtree and nothing else: the wrap-files bucket, a
-- path whose tenant segment is the caller's own user_<uid>, whose third segment
-- is one of the caller's own generation ids, and whose fourth segment is the
-- literal calls-1-7. It adds no access to any other prefix, and the existing
-- policies are left untouched -- a SELECT is permitted if any policy allows it,
-- so this widens the owner's reach without widening anyone else's.

CREATE POLICY designpro_owner_read_generation_views
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'wrap-files'
  AND (storage.foldername(name))[1] = 'designpro'
  AND (storage.foldername(name))[4] = 'calls-1-7'
  AND array_length(storage.foldername(name), 1) = 5
  AND EXISTS (
    SELECT 1
    FROM public.designpro_generation_requests g
    WHERE g.owner_id = (SELECT auth.uid())
      AND (storage.foldername(name))[2] = 'user_' || g.owner_id::text
      AND (storage.foldername(name))[3] = g.generation_id::text
  )
);
