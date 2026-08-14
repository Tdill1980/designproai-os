-- designpro_owner_read_generation_views could never grant anything.
--
-- The policy asks whether the path's generation id belongs to the caller by
-- selecting from public.designpro_generation_requests. That table's privileges
-- were deliberately narrowed (see the view-paths privilege migration), so the
-- subquery runs as `authenticated` without SELECT on it and storage answers
-- "permission denied for table designpro_generation_requests" -- which surfaces
-- as an unsignable view, which surfaces as a permanently pending tile.
--
-- Widening the grant would hand the browser the whole request table through
-- PostgREST just to answer an ownership question. Ask through a SECURITY
-- DEFINER predicate instead: it answers exactly "does the caller own the
-- generation at this path", reads nothing back, and leaves the table's
-- privileges as they are.

CREATE OR REPLACE FUNCTION designpro_private.caller_owns_generation(p_tenant_segment text, p_generation_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.designpro_generation_requests g
    WHERE g.owner_id = (SELECT auth.uid())
      AND p_tenant_segment = 'user_' || g.owner_id::text
      AND p_generation_id = g.generation_id::text
  );
$fn$;

REVOKE ALL ON FUNCTION designpro_private.caller_owns_generation(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION designpro_private.caller_owns_generation(text, text) TO authenticated, service_role;

DROP POLICY IF EXISTS designpro_owner_read_generation_views ON storage.objects;
CREATE POLICY designpro_owner_read_generation_views
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'wrap-files'
  AND (storage.foldername(name))[1] = 'designpro'
  AND (storage.foldername(name))[4] = 'calls-1-7'
  AND array_length(storage.foldername(name), 1) = 5
  AND designpro_private.caller_owns_generation(
        (storage.foldername(name))[2], (storage.foldername(name))[3])
);
