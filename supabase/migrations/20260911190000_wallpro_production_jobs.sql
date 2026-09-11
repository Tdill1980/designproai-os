-- WallPro production panels: 150 PPI print files built on the server runtime.
--
-- Owner directive (2026-09-11): "make it 150 and auto run topaz". A 4K master
-- over a full wall is ~30 PPI, and Topaz caps one request near 96 MP, so the
-- 150 PPI files are produced PER PRINT PANEL on the droplet runtime, the same
-- way Call 12 enhances vehicle panels: rasterise the panel from the approved
-- master at its native density, enhance through Topaz to the engine ceiling,
-- land exactly on panel inches x 150, and store each panel under the owner's
-- private namespace. A job is requested by the owner for an APPROVED version,
-- claimed by a runtime worker, and reports progress per panel.
CREATE TABLE public.wallpro_production_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.wallpro_projects(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES public.wallpro_design_versions(id) ON DELETE CASCADE,
  -- wallWidthIn, wallHeightIn, placement, repeatWidthIn, mirror, bleedIn,
  -- overlapIn, panelWidthIn, targetPpi: the exact geometry the panels are cut to.
  request jsonb NOT NULL CHECK (jsonb_typeof(request)='object' AND octet_length(request::text)<=4000),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','ready','failed')),
  claimed_by text,
  claimed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  panels jsonb NOT NULL DEFAULT '[]'::jsonb,
  manifest_path text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CHECK (manifest_path IS NULL OR starts_with(manifest_path, owner_id::text||'/production/'))
);
-- One live job per approved version and geometry; a failed job may be re-requested.
CREATE UNIQUE INDEX wallpro_production_jobs_live ON public.wallpro_production_jobs(version_id, request_hash) WHERE status IN ('queued','running','ready');
CREATE INDEX wallpro_production_jobs_queue ON public.wallpro_production_jobs(status, created_at) WHERE status IN ('queued','running');
CREATE INDEX wallpro_production_jobs_owner ON public.wallpro_production_jobs(owner_id, created_at DESC);

ALTER TABLE public.wallpro_production_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY wallpro_production_job_read ON public.wallpro_production_jobs FOR SELECT TO authenticated USING (owner_id=(SELECT auth.uid()));
REVOKE ALL ON public.wallpro_production_jobs FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.wallpro_production_jobs TO authenticated;
GRANT ALL ON public.wallpro_production_jobs TO service_role;

-- The owner requests production for one of their APPROVED versions. The same
-- version + geometry returns the existing live job instead of a duplicate.
CREATE FUNCTION public.request_wallpro_production(p_version_id uuid, p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.wallpro_design_versions; j public.wallpro_production_jobs; h text; w numeric; ht numeric; ppi numeric; pw numeric;
BEGIN
  SELECT * INTO v FROM public.wallpro_design_versions WHERE id=p_version_id;
  IF NOT FOUND OR v.owner_id<>(SELECT auth.uid()) THEN RAISE EXCEPTION 'wallpro_version_not_found'; END IF;
  IF v.status<>'approved' THEN RAISE EXCEPTION 'wallpro_version_not_approved'; END IF;
  IF jsonb_typeof(p_request)<>'object' THEN RAISE EXCEPTION 'wallpro_production_request_invalid'; END IF;
  w:=(p_request->>'wallWidthIn')::numeric; ht:=(p_request->>'wallHeightIn')::numeric;
  ppi:=COALESCE((p_request->>'targetPpi')::numeric,150); pw:=COALESCE((p_request->>'panelWidthIn')::numeric,59.5);
  IF w IS NULL OR ht IS NULL OR w<1 OR w>2400 OR ht<1 OR ht>2400 OR ppi<72 OR ppi>600 OR pw<1 OR pw>2400
     OR COALESCE((p_request->>'bleedIn')::numeric,1) NOT BETWEEN 0 AND 5 OR COALESCE((p_request->>'overlapIn')::numeric,0.5) NOT BETWEEN 0 AND 5
     OR COALESCE(p_request->>'placement',v.placement) NOT IN ('cover','contain','repeat') THEN
    RAISE EXCEPTION 'wallpro_production_request_invalid';
  END IF;
  h:=encode(extensions.digest(convert_to(p_request::text,'UTF8'),'sha256'),'hex');
  SELECT * INTO j FROM public.wallpro_production_jobs WHERE version_id=p_version_id AND request_hash=h AND status IN ('queued','running','ready') LIMIT 1;
  IF FOUND THEN RETURN to_jsonb(j); END IF;
  INSERT INTO public.wallpro_production_jobs(owner_id,project_id,version_id,request,request_hash)
  VALUES (v.owner_id,v.project_id,v.id,p_request,h) RETURNING * INTO j;
  RETURN to_jsonb(j);
END; $$;
REVOKE ALL ON FUNCTION public.request_wallpro_production(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_wallpro_production(uuid,jsonb) TO authenticated,service_role;

-- Runtime workers claim the oldest queued job. A job left running for more than
-- thirty minutes is a dead worker: it goes back to the queue up to three attempts,
-- then fails with that reason so nobody waits on it forever.
CREATE FUNCTION public.claim_wallpro_production_job(p_worker text)
RETURNS SETOF public.wallpro_production_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  UPDATE public.wallpro_production_jobs SET status='queued', claimed_by=NULL, claimed_at=NULL, updated_at=now()
  WHERE status='running' AND claimed_at<now()-interval '30 minutes' AND attempts<3;
  UPDATE public.wallpro_production_jobs SET status='failed', error='production worker stopped responding after three attempts', finished_at=now(), updated_at=now()
  WHERE status='running' AND claimed_at<now()-interval '30 minutes' AND attempts>=3;
  RETURN QUERY UPDATE public.wallpro_production_jobs SET status='running', claimed_by=p_worker, claimed_at=now(), attempts=attempts+1, updated_at=now()
  WHERE id=(SELECT id FROM public.wallpro_production_jobs WHERE status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
  RETURNING *;
END; $$;
REVOKE ALL ON FUNCTION public.claim_wallpro_production_job(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_wallpro_production_job(text) TO service_role;

-- 150 PPI panels are hundreds of megabytes; the private bucket must accept them.
UPDATE storage.buckets SET file_size_limit=5368709120,
  allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp','image/tiff','application/json']
WHERE id='wallpro-files';
