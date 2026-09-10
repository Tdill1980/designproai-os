-- WallPro restoration: independent private files and project/AI request records.
-- Does not change wrap-files, the vehicle source seam, or checkout pricing.
CREATE TABLE public.wallpro_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Wall design' CHECK (length(name) BETWEEN 1 AND 200),
  config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config)='object' AND octet_length(config::text)<=64000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (COALESCE(config->>'wallPath','')='' OR starts_with(config->>'wallPath',owner_id::text||'/')),
  CHECK (COALESCE(config->>'artworkPath','')='' OR starts_with(config->>'artworkPath',owner_id::text||'/')),
  CHECK (COALESCE(config->>'referencePath','')='' OR starts_with(config->>'referencePath',owner_id::text||'/'))
);
CREATE INDEX wallpro_projects_owner_updated ON public.wallpro_projects(owner_id,updated_at DESC);
ALTER TABLE public.wallpro_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY wallpro_project_read ON public.wallpro_projects FOR SELECT TO authenticated USING (owner_id=(SELECT auth.uid()));
CREATE POLICY wallpro_project_insert ON public.wallpro_projects FOR INSERT TO authenticated WITH CHECK (owner_id=(SELECT auth.uid()));
CREATE POLICY wallpro_project_update ON public.wallpro_projects FOR UPDATE TO authenticated USING (owner_id=(SELECT auth.uid())) WITH CHECK (owner_id=(SELECT auth.uid()));
REVOKE ALL ON public.wallpro_projects FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.wallpro_projects TO authenticated;
GRANT ALL ON public.wallpro_projects TO service_role;
REVOKE ALL ON public.wallpro_projects FROM anon;

CREATE TABLE public.wallpro_generations (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  input_hash text NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'working' CHECK (state IN ('working','completed','failed')),
  input jsonb NOT NULL,
  artwork_path text,
  design_name text,
  error text,
  charge_source text CHECK (charge_source IN ('privileged','subscription','tokens')),
  subscription_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX wallpro_generations_owner_created ON public.wallpro_generations(owner_id,created_at DESC);
ALTER TABLE public.wallpro_generations ENABLE ROW LEVEL SECURITY;
CREATE POLICY wallpro_generation_read ON public.wallpro_generations FOR SELECT TO authenticated USING (owner_id=(SELECT auth.uid()));
REVOKE ALL ON public.wallpro_generations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.wallpro_generations TO authenticated;
GRANT ALL ON public.wallpro_generations TO service_role;
REVOKE ALL ON public.wallpro_generations FROM anon;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('wallpro-files','wallpro-files',false,20971520,ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT(id) DO NOTHING;
CREATE POLICY wallpro_file_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='wallpro-files' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text);
CREATE POLICY wallpro_file_upload ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='wallpro-files' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text
  AND (storage.foldername(name))[2]='uploads' AND array_length(storage.foldername(name),1)=2
  AND storage.filename(name) ~ '^[0-9a-f-]{36}\.(jpg|png|webp)$');

-- The existing WallPro token-gate tier limits, reserved atomically with a request.
-- Only the verified edge handler's service role can call either RPC. Definer
-- rights let this narrow operation reserve/refund legacy balances without
-- granting new direct table privileges. The search path is pinned below.
CREATE FUNCTION public.reserve_wallpro_generation(p_id uuid,p_owner uuid,p_hash text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g public.wallpro_generations; s public.user_subscriptions; cap integer; source text; sid uuid;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text,9010));
  SELECT * INTO g FROM public.wallpro_generations WHERE id=p_id;
  IF FOUND THEN
    IF g.owner_id<>p_owner OR g.input_hash<>p_hash THEN RAISE EXCEPTION 'request_conflict'; END IF;
    RETURN jsonb_build_object('fresh',false,'generation',to_jsonb(g));
  END IF;
  IF EXISTS (SELECT 1 FROM public.wallpro_generations WHERE owner_id=p_owner AND state='working' AND created_at>now()-interval '3 minutes') THEN
    RAISE EXCEPTION 'generation_in_progress';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=p_owner AND role::text IN ('admin','tester')) THEN source:='privileged';
  ELSE
    SELECT * INTO s FROM public.user_subscriptions WHERE user_id=p_owner AND status='active' ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    cap:=CASE s.tier WHEN 'starter' THEN 50 WHEN 'advanced' THEN 75 WHEN 'professional' THEN 100 WHEN 'complete' THEN 200 WHEN 'proshop' THEN 200 WHEN 'enterprise' THEN 999999 WHEN 'agency' THEN 999999 ELSE 0 END;
    IF s.id IS NOT NULL AND COALESCE(s.render_count,0)<cap THEN
      UPDATE public.user_subscriptions SET render_count=COALESCE(render_count,0)+1 WHERE id=s.id;
      source:='subscription'; sid:=s.id;
    ELSE
      UPDATE public.user_tokens SET balance=balance-1,total_used=total_used+1,updated_at=now() WHERE user_id=p_owner AND balance>=1;
      IF NOT FOUND THEN RAISE EXCEPTION 'no_tokens'; END IF;
      source:='tokens';
    END IF;
  END IF;
  INSERT INTO public.wallpro_generations(id,owner_id,input_hash,input,charge_source,subscription_id)
    VALUES(p_id,p_owner,p_hash,p_input,source,sid) RETURNING * INTO g;
  RETURN jsonb_build_object('fresh',true,'generation',to_jsonb(g));
END; $$;
REVOKE ALL ON FUNCTION public.reserve_wallpro_generation(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_wallpro_generation(uuid,uuid,text,jsonb) TO service_role;

CREATE FUNCTION public.finish_wallpro_generation(p_id uuid,p_owner uuid,p_path text,p_name text,p_error text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g public.wallpro_generations;
BEGIN
  SELECT * INTO g FROM public.wallpro_generations WHERE id=p_id AND owner_id=p_owner FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'generation_not_found'; END IF;
  IF g.state<>'working' THEN RETURN to_jsonb(g); END IF;
  IF p_error IS NULL AND (p_path IS NULL OR NOT starts_with(p_path,p_owner::text||'/generated/'||p_id::text||'.')) THEN RAISE EXCEPTION 'invalid_output_path'; END IF;
  IF p_error IS NOT NULL THEN
    IF g.charge_source='tokens' THEN
      UPDATE public.user_tokens SET balance=balance+1,total_used=greatest(0,total_used-1),updated_at=now() WHERE user_id=p_owner;
    ELSIF g.charge_source='subscription' THEN
      UPDATE public.user_subscriptions SET render_count=greatest(0,COALESCE(render_count,0)-1) WHERE id=g.subscription_id;
    END IF;
  END IF;
  UPDATE public.wallpro_generations SET state=CASE WHEN p_error IS NULL THEN 'completed' ELSE 'failed' END,
    artwork_path=p_path,design_name=left(p_name,200),error=left(p_error,1000),completed_at=now()
    WHERE id=p_id RETURNING * INTO g;
  RETURN to_jsonb(g);
END; $$;
REVOKE ALL ON FUNCTION public.finish_wallpro_generation(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_wallpro_generation(uuid,uuid,text,text,text) TO service_role;
