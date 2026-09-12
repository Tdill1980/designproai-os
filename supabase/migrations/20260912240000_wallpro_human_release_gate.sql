-- WallPro panels do not reach a customer until a human has validated them.
--
-- Owner, 2026-09-12: "we need a wall version of the Genie Universal Panelizer
-- this can act as a value ad while we create panels which will take 24 hours
-- for my human team to validate ais panels gives us ample time to fix or
-- recreate any issues on design these are our real customers of wpw we can't
-- risk going 100% ai."
--
-- WHAT WAS ACTUALLY HAPPENING. A production job had four states -- queued,
-- running, ready, failed -- and `ready` meant the runtime had finished cutting.
-- The owner's own RLS read returns the job with every panel's storage path, and
-- `wallpro_file_read` lets an owner read anything under their own prefix,
-- production/ included. So AI-cut panels were downloadable by a real WePrintWraps
-- customer the instant the worker finished, with nobody having looked at them.
-- The QC review log added on 20260912230000 recorded a verdict and blocked
-- nothing.
--
-- `ready` NOW MEANS READY FOR VALIDATION, NOT READY FOR THE CUSTOMER. A second,
-- separate fact -- released_at -- says a human signed the panels off, and until
-- it is set the files are not readable by the customer at all.
--
-- HOW IT IS ENFORCED, AND WHY THIS SHAPE. The gate is a RESTRICTIVE storage
-- policy, which ANDs with every existing permissive policy rather than replacing
-- one. Rewriting `wallpro_file_read` in place would put every customer's access
-- to every file they own -- photos, uploads, masters -- through a brand-new
-- expression on the first deploy; a mistake there locks people out of their own
-- work. This adds one narrow condition to one path prefix and leaves the
-- existing grant untouched.
--
-- EXISTING JOBS ARE BACKFILLED AS RELEASED. A gate applied retroactively would
-- take files away from customers who already have them, which is a worse failure
-- than the one being fixed. Everything already cut keeps its access; the gate
-- binds new work only.

ALTER TABLE public.wallpro_production_jobs
  ADD COLUMN released_at timestamptz,
  ADD COLUMN released_by uuid REFERENCES auth.users(id),
  -- Why the release was given, or the note the team left while fixing. Free
  -- text: the structured verdict lives in wallpro_qc_reviews.
  ADD COLUMN release_note text CHECK (release_note IS NULL OR length(release_note) <= 2000),
  ADD CONSTRAINT wallpro_release_is_signed CHECK ((released_at IS NULL) = (released_by IS NULL));

-- Everything that already exists keeps working, exactly as it does today.
UPDATE public.wallpro_production_jobs
   SET released_at = COALESCE(finished_at, updated_at), released_by = owner_id
 WHERE status = 'ready' AND released_at IS NULL;

-- The customer may read a production file only once a human has released that
-- job. Staff read everything, which is the whole point of the validation window.
CREATE FUNCTION designpro_private.wallpro_production_readable(p_job text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' STABLE AS $$
  SELECT public.has_role((SELECT auth.uid()),'admin'::public.app_role)
      OR public.has_role((SELECT auth.uid()),'tester'::public.app_role)
      OR COALESCE((
           SELECT j.released_at IS NOT NULL
             FROM public.wallpro_production_jobs j
            WHERE j.id::text = p_job
              AND j.owner_id = (SELECT auth.uid())
           LIMIT 1
         ), false);
$$;
REVOKE ALL ON FUNCTION designpro_private.wallpro_production_readable(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION designpro_private.wallpro_production_readable(text) TO authenticated,service_role;

-- RESTRICTIVE: ANDs with the permissive policies rather than replacing them.
-- Paths are {owner}/production/{job}/{file}, so foldername[2] selects the
-- production prefix and foldername[3] names the job. Anything that is not a
-- wallpro production file passes straight through.
CREATE POLICY wallpro_production_needs_human_release ON storage.objects
AS RESTRICTIVE FOR SELECT TO authenticated
USING (
  bucket_id <> 'wallpro-files'
  OR (storage.foldername(name))[2] IS DISTINCT FROM 'production'
  OR designpro_private.wallpro_production_readable((storage.foldername(name))[3])
);

-- A human releases the panels. Staff only, and only once the design team has
-- actually recorded a release verdict for that version in the QC log -- the
-- button and the sign-off are the same act, so one cannot happen without the
-- other. Idempotent: releasing twice keeps the first signature.
CREATE FUNCTION public.release_wallpro_production_job(p_job_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.wallpro_production_jobs; v_verdict text;
BEGIN
  IF NOT (public.has_role((SELECT auth.uid()),'admin'::public.app_role)
       OR public.has_role((SELECT auth.uid()),'tester'::public.app_role)) THEN
    RAISE EXCEPTION 'not_authorised';
  END IF;
  SELECT * INTO j FROM public.wallpro_production_jobs WHERE id=p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'job_not_found'; END IF;
  IF j.released_at IS NOT NULL THEN RETURN pg_catalog.to_jsonb(j); END IF;
  IF j.status <> 'ready' THEN RAISE EXCEPTION 'job_not_ready'; END IF;

  -- The newest QC verdict for this version must be a release. A held or
  -- never-reviewed version cannot have its panels handed over.
  SELECT r.verdict INTO v_verdict
    FROM public.wallpro_qc_reviews r
   WHERE r.version_id = j.version_id
   ORDER BY r.created_at DESC
   LIMIT 1;
  IF v_verdict IS DISTINCT FROM 'released' THEN RAISE EXCEPTION 'qc_release_required'; END IF;

  UPDATE public.wallpro_production_jobs
     SET released_at = now(), released_by = (SELECT auth.uid()),
         release_note = pg_catalog."left"(p_note, 2000), updated_at = now()
   WHERE id = p_job_id
  RETURNING * INTO j;
  RETURN pg_catalog.to_jsonb(j);
END; $$;
REVOKE ALL ON FUNCTION public.release_wallpro_production_job(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.release_wallpro_production_job(uuid,text) TO authenticated,service_role;
