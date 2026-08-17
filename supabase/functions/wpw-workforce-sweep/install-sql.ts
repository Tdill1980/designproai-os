// AUTO-GENERATED installer (video_pipeline + 150000..270000)
export const INSTALL_SQL = `
DROP VIEW IF EXISTS public.workforce_scoreboard;
DROP VIEW IF EXISTS public.workforce_retarget_attribution;

-- ===== 20260721_video_pipeline.sql =====
-- ============================================================================
-- RestylePro-native video pipeline — Phase 1 (engine port)
-- docs/VIDEO-AUTOCREATE-PILOT-KICKOFF.md
--
-- 1. video_render_jobs — queue for the self-hosted ffmpeg renderer
--    (worker/video-renderer, dispatched by the video-render edge function,
--    drained by the render-videos GitHub Actions workflow).
-- 2. agent_media_assets extension — turns the dormant media table into the
--    brand video clip library (Drive-synced clips + finished renders).
-- ============================================================================

-- ── 1. Render job queue ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.video_render_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand         text NOT NULL DEFAULT 'weprintwraps',
  -- Optional caller reference (e.g. an agent_social_posts id or UI session)
  source_ref    text,
  blueprint     jsonb NOT NULL,
  music_url     text,
  captions      jsonb NOT NULL DEFAULT '[]'::jsonb,
  bucket        text NOT NULL DEFAULT 'wrap-files',
  -- queued → rendering → complete | failed
  status        text NOT NULL DEFAULT 'queued',
  final_url     text,
  thumbnail_url text,
  error         text,
  attempts      int  NOT NULL DEFAULT 0,
  -- worker heartbeat, so a crashed render can be reclaimed
  claimed_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.video_render_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on video_render_jobs" ON public.video_render_jobs;
CREATE POLICY "Service role full access on video_render_jobs"
  ON public.video_render_jobs FOR ALL USING (auth.role() = 'service_role');

-- Engine Room (authenticated admins) can watch render status
DROP POLICY IF EXISTS "Authenticated read on video_render_jobs" ON public.video_render_jobs;
CREATE POLICY "Authenticated read on video_render_jobs"
  ON public.video_render_jobs FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_video_render_jobs_status_created
  ON public.video_render_jobs (status, created_at);

-- ── 2. Media library extension (agent_media_assets → clip library) ─────────
ALTER TABLE public.agent_media_assets ADD COLUMN IF NOT EXISTS thumbnail_url     text;
ALTER TABLE public.agent_media_assets ADD COLUMN IF NOT EXISTS duration_seconds  numeric;
ALTER TABLE public.agent_media_assets ADD COLUMN IF NOT EXISTS tags              text[] DEFAULT '{}';
ALTER TABLE public.agent_media_assets ADD COLUMN IF NOT EXISTS transcript        text;
ALTER TABLE public.agent_media_assets ADD COLUMN IF NOT EXISTS ai_labels         jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.agent_media_assets ADD COLUMN IF NOT EXISTS original_filename text;
-- Drive provenance (drive-sync feeder, Phase 2)
ALTER TABLE public.agent_media_assets ADD COLUMN IF NOT EXISTS drive_file_id     text;
ALTER TABLE public.agent_media_assets ADD COLUMN IF NOT EXISTS source_folder     text;
ALTER TABLE public.agent_media_assets ADD COLUMN IF NOT EXISTS file_size_bytes   bigint;

-- Columns video-auto-assemble selects/filters on
ALTER TABLE public.agent_media_assets ADD COLUMN IF NOT EXISTS metadata          jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.agent_media_assets ADD COLUMN IF NOT EXISTS content_category  text;
ALTER TABLE public.agent_media_assets ADD COLUMN IF NOT EXISTS visual_tags       jsonb;
ALTER TABLE public.agent_media_assets ADD COLUMN IF NOT EXISTS organization_id   uuid;

-- Dedupe guard: one row per Drive file
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_media_assets_drive_file
  ON public.agent_media_assets (drive_file_id) WHERE drive_file_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_media_assets_brand_type
  ON public.agent_media_assets (brand, asset_type);

-- Engine Room (authenticated admins) can browse the clip library
DROP POLICY IF EXISTS "Authenticated read on agent_media_assets" ON public.agent_media_assets;
CREATE POLICY "Authenticated read on agent_media_assets"
  ON public.agent_media_assets FOR SELECT TO authenticated USING (true);

-- ── 3. Music library (video-music recommendations) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.video_music_library (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text,
  storage_url      text NOT NULL,
  mood             text,
  energy           text,
  bpm              int,
  genre            text,
  duration_seconds numeric,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.video_music_library ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on video_music_library" ON public.video_music_library;
CREATE POLICY "Service role full access on video_music_library"
  ON public.video_music_library FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Authenticated read on video_music_library" ON public.video_music_library;
CREATE POLICY "Authenticated read on video_music_library"
  ON public.video_music_library FOR SELECT TO authenticated USING (true);


-- ===== 20260722150000_wpw_workforce_mission_control.sql =====
-- ============================================================
-- WPW AI Workforce — Mission Control activation
-- (docs/WPW_AI_WORKFORCE_AUDIT.md, Top-25 items 1–7)
--
-- 1. workforce_runs — per-run log for the wpw-workforce-sweep
--    dispatcher (debugging is a query, not screenshot archaeology)
-- 2. workforce_dormant_customers — service-role-only view feeding
--    the win-back detector
-- 3. Cron schedules:
--      • wpw-workforce-sweep hourly (event detection → Mission
--        Control tasks + gated drip enrollment)
--      • wpw-workforce-digest weekday mornings (per-person cards)
--      • approvepro-followup-sweep daily  (built, was never scheduled)
--      • proof-intake-sweep hourly        (built, was never scheduled)
--      • seo-auto-blog-cron daily         (built, was never scheduled)
--
-- NOTE: the sweep's automated sends stay gated behind the
-- WORKFORCE_SENDS_ENABLED function secret (default off) — until it
-- is set to "on", every detector creates tasks only.
-- The Authorization header reads app.service_role_key, set once via:
--   ALTER DATABASE postgres SET app.service_role_key = '<KEY>';
-- (same contract as the process-scheduled-emails cron).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Run log
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workforce_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode TEXT NOT NULL DEFAULT 'sweep',
  dry_run BOOLEAN NOT NULL DEFAULT false,
  sends_enabled BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  results JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workforce_runs_created
  ON public.workforce_runs (created_at DESC);

ALTER TABLE public.workforce_runs ENABLE ROW LEVEL SECURITY;

-- Service role writes; admins read.
DROP POLICY IF EXISTS "service_role_workforce_runs" ON public.workforce_runs;
CREATE POLICY "service_role_workforce_runs"
  ON public.workforce_runs FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "admin_read_workforce_runs" ON public.workforce_runs;
CREATE POLICY "admin_read_workforce_runs"
  ON public.workforce_runs FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','tester')
  ));

-- ------------------------------------------------------------
-- 2. Dormant-customer view (win-back detector input)
--    Aggregates wpw_orders; service-role only — the view owner
--    bypasses RLS, so it must NOT be exposed to anon/authenticated.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.workforce_dormant_customers AS
SELECT
  customer_email,
  max(customer_name)  AS customer_name,
  max(date_created)   AS last_order_at,
  count(*)            AS orders_count,
  sum(total)          AS lifetime_total
FROM public.wpw_orders
WHERE customer_email IS NOT NULL
  AND status NOT IN ('cancelled','refunded','failed','checkout-draft')
GROUP BY customer_email
HAVING max(date_created) < now() - interval '120 days';

REVOKE ALL ON public.workforce_dormant_customers FROM anon, authenticated;
GRANT SELECT ON public.workforce_dormant_customers TO service_role;

-- ------------------------------------------------------------
-- 3. Cron schedules (idempotent: unschedule same-name first)
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule(jobid) FROM cron.job
  WHERE jobname IN (
    'wpw-workforce-sweep-hourly',
    'wpw-workforce-digest',
    'approvepro-followup-sweep-daily',
    'proof-intake-sweep-hourly',
    'seo-auto-blog-daily'
  );

-- Event detection, hourly at :10
SELECT cron.schedule('wpw-workforce-sweep-hourly', '10 * * * *', $job$
  SELECT net.http_post(
    url := 'https://kfapjdyythzyvnpdeghu.supabase.co/functions/v1/wpw-workforce-sweep',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || current_setting('app.service_role_key', true)),
    body := '{"mode":"sweep"}'::jsonb
  ) AS request_id;
$job$);

-- Per-person morning cards, weekdays 11:00 UTC (7am ET during DST)
SELECT cron.schedule('wpw-workforce-digest', '0 11 * * 1-5', $job$
  SELECT net.http_post(
    url := 'https://kfapjdyythzyvnpdeghu.supabase.co/functions/v1/wpw-workforce-sweep',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || current_setting('app.service_role_key', true)),
    body := '{"mode":"digest"}'::jsonb
  ) AS request_id;
$job$);

-- ApprovePro automatic customer follow-ups are intentionally not scheduled.
-- Do not add this job back without explicit owner approval, migration rehearsal,
-- idempotency validation, and a test-recipient-only canary.

-- ApprovePro intake cron disabled until the DesignProAI cutover is accepted.

-- SEO auto-blog (write → publish → Search Console) — daily 12:00 UTC.
-- Per-shop frequency gating lives inside the function (shouldRun()).
SELECT cron.schedule('seo-auto-blog-daily', '0 12 * * *', $job$
  SELECT net.http_post(
    url := 'https://kfapjdyythzyvnpdeghu.supabase.co/functions/v1/seo-auto-blog-cron',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || current_setting('app.service_role_key', true)),
    body := '{}'::jsonb
  ) AS request_id;
$job$);


-- ===== 20260722160000_wpw_workforce_event_bus.sql =====
-- ============================================================
-- WPW AI Workforce — Business Event Bus + AI Orchestrator
--
--   Systems (WooCommerce, QuickQuote, ApprovePro, Outlook, …)
--     → workforce_events (THE BUS — any function emits with 1 insert)
--     → wpw-workforce-orchestrator (department agents draft the work)
--     → Marketing Hub review queue (slack_agent_tasks +
--       agent_email_campaigns) → human approve → publish
--
-- Producers so far: wpw-workforce-sweep (orders/quotes/customers).
-- Event contract: (event_type, dedupe_key UNIQUE, payload jsonb).
-- Status machine: pending → processing → done | failed | skipped.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.workforce_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'unknown',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','done','failed','skipped')),
  claimed_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  output JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workforce_events_pending
  ON public.workforce_events (created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_workforce_events_type
  ON public.workforce_events (event_type, created_at DESC);

ALTER TABLE public.workforce_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_workforce_events" ON public.workforce_events;
CREATE POLICY "service_role_workforce_events"
  ON public.workforce_events FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "admin_read_workforce_events" ON public.workforce_events;
CREATE POLICY "admin_read_workforce_events"
  ON public.workforce_events FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','tester')
  ));

-- ------------------------------------------------------------
-- Orchestrator cron — drain the bus every 15 minutes.
-- Same auth contract as the other workforce crons
-- (app.service_role_key database setting).
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- The orchestrator lives inside wpw-workforce-sweep (mode:"orchestrate")
-- because the project sits at Supabase's 500-function cap — updates
-- deploy fine, new functions 402.
SELECT cron.unschedule(jobid) FROM cron.job
  WHERE jobname = 'wpw-workforce-orchestrator';

SELECT cron.schedule('wpw-workforce-orchestrator', '*/15 * * * *', $job$
  SELECT net.http_post(
    url := 'https://kfapjdyythzyvnpdeghu.supabase.co/functions/v1/wpw-workforce-sweep',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || current_setting('app.service_role_key', true)),
    body := '{"mode":"orchestrate"}'::jsonb
  ) AS request_id;
$job$);


-- ===== 20260722170000_wpw_workforce_learning.sql =====
-- ============================================================
-- WPW AI Workforce — Learn capture + Phase 1 scoreboard
--
-- 1. workforce_learning — the library of human decisions on agent
--    output. Captured AUTOMATICALLY by triggers (no new button for
--    the team): any UPDATE to an agent-created row in
--    agent_email_campaigns / agent_social_posts / slack_agent_tasks
--    snapshots the full before/after. After ~500 rows this powers
--    prompt tuning and retrieval from past approved work.
-- 2. workforce_scoreboard / workforce_event_stats — the Phase 1
--    daily metrics (cards created/approved/rejected, campaign
--    approval %, event outcomes), queryable by dashboards and fed
--    into the Monday exec/growth briefs.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.workforce_learning (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table TEXT NOT NULL,
  source_id UUID NOT NULL,
  agent TEXT,                          -- created_by of the agent row
  item_type TEXT,                      -- task_type / campaign_type / platform
  change_kind TEXT NOT NULL,           -- 'edited' | 'status:<new_status>'
  original JSONB NOT NULL,             -- full row before the human touched it
  final JSONB NOT NULL,                -- full row after
  reason TEXT,                         -- optional, for a future UI field
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workforce_learning_source
  ON public.workforce_learning (source_table, source_id);
CREATE INDEX IF NOT EXISTS idx_workforce_learning_agent
  ON public.workforce_learning (agent, created_at DESC);

ALTER TABLE public.workforce_learning ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_workforce_learning" ON public.workforce_learning;
CREATE POLICY "service_role_workforce_learning"
  ON public.workforce_learning FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "admin_read_workforce_learning" ON public.workforce_learning;
CREATE POLICY "admin_read_workforce_learning"
  ON public.workforce_learning FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','tester')
  ));

-- ------------------------------------------------------------
-- Capture trigger — one generic function, applied to the three
-- agent-output tables. Fires only for rows an agent created.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.workforce_capture_learning()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $fn$
DECLARE
  creator TEXT;
  old_status TEXT;
  new_status TEXT;
  kind TEXT;
  itype TEXT;
BEGIN
  creator := COALESCE(NEW.created_by::text, '');
  -- Only agent-created rows build the learning library.
  IF creator !~ '^(workforce-|wpw-workforce|marketing-agent)' THEN
    RETURN NEW;
  END IF;

  old_status := COALESCE((to_jsonb(OLD)->>'status'), '');
  new_status := COALESCE((to_jsonb(NEW)->>'status'), '');
  IF new_status <> old_status THEN
    kind := 'status:' || new_status;
  ELSIF to_jsonb(NEW) - 'updated_at' <> to_jsonb(OLD) - 'updated_at' THEN
    kind := 'edited';
  ELSE
    RETURN NEW;  -- no-op update
  END IF;

  itype := COALESCE(
    to_jsonb(NEW)->>'task_type',
    to_jsonb(NEW)->>'campaign_type',
    to_jsonb(NEW)->>'platform');

  INSERT INTO public.workforce_learning
    (source_table, source_id, agent, item_type, change_kind, original, final)
  VALUES
    (TG_TABLE_NAME, NEW.id, creator, itype, kind, to_jsonb(OLD), to_jsonb(NEW));

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_workforce_learning_campaigns ON public.agent_email_campaigns;
CREATE TRIGGER trg_workforce_learning_campaigns
  AFTER UPDATE ON public.agent_email_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.workforce_capture_learning();

DROP TRIGGER IF EXISTS trg_workforce_learning_social ON public.agent_social_posts;
CREATE TRIGGER trg_workforce_learning_social
  AFTER UPDATE ON public.agent_social_posts
  FOR EACH ROW EXECUTE FUNCTION public.workforce_capture_learning();

DROP TRIGGER IF EXISTS trg_workforce_learning_tasks ON public.slack_agent_tasks;
CREATE TRIGGER trg_workforce_learning_tasks
  AFTER UPDATE ON public.slack_agent_tasks
  FOR EACH ROW EXECUTE FUNCTION public.workforce_capture_learning();

-- ------------------------------------------------------------
-- Phase 1 scoreboard views (aggregates only; service_role +
-- signed-in users so a dashboard page can read them).
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.workforce_scoreboard AS
SELECT
  (SELECT count(*) FROM public.slack_agent_tasks
     WHERE created_by ~ '^(workforce-|wpw-workforce)'
       AND created_at > now() - interval '7 days')                 AS cards_created_7d,
  (SELECT count(*) FROM public.slack_agent_tasks
     WHERE created_by ~ '^(workforce-|wpw-workforce)'
       AND status NOT IN ('pending')
       AND created_at > now() - interval '7 days')                 AS cards_actioned_7d,
  (SELECT count(*) FROM public.agent_email_campaigns
     WHERE created_by ~ '^workforce-'
       AND created_at > now() - interval '7 days')                 AS campaigns_built_7d,
  (SELECT count(*) FROM public.agent_email_campaigns
     WHERE created_by ~ '^workforce-' AND status = 'approved'
       AND created_at > now() - interval '7 days')                 AS campaigns_approved_7d,
  (SELECT count(*) FROM public.agent_social_posts
     WHERE created_by ~ '^workforce-'
       AND created_at > now() - interval '7 days')                 AS social_built_7d,
  (SELECT count(*) FROM public.workforce_learning
     WHERE change_kind = 'edited'
       AND created_at > now() - interval '7 days')                 AS human_edits_7d,
  (SELECT count(*) FROM public.workforce_events
     WHERE status = 'done'
       AND created_at > now() - interval '7 days')                 AS events_processed_7d,
  (SELECT count(*) FROM public.workforce_events
     WHERE status = 'failed'
       AND created_at > now() - interval '7 days')                 AS events_failed_7d,
  (SELECT count(*) FROM public.scheduled_emails
     WHERE (source = 'quote_retarget' OR source LIKE 'mightymail:%')
       AND created_at > now() - interval '7 days')                 AS drip_emails_queued;

CREATE OR REPLACE VIEW public.workforce_event_stats AS
SELECT event_type, status, count(*) AS n,
       min(created_at) AS first_seen, max(created_at) AS last_seen
FROM public.workforce_events
GROUP BY event_type, status;

REVOKE ALL ON public.workforce_scoreboard FROM anon;
REVOKE ALL ON public.workforce_event_stats FROM anon;
GRANT SELECT ON public.workforce_scoreboard TO service_role, authenticated;
GRANT SELECT ON public.workforce_event_stats TO service_role, authenticated;


-- ===== 20260722180000_wpw_quote_retarget_attribution.sql =====
-- ============================================================
-- WPW AI Workforce — QuickQuote retarget revenue attribution
--
-- The Woo order sync already flips quotes to 'converted' (3-way
-- match: quote number in order meta → email → fuzzy name). This
-- view answers "which of those conversions had received a retarget
-- email first" — i.e. revenue the drip influenced — across BOTH
-- quote books (internal "quotes" and public homepage
-- "customer_quotes"). Matches every source_ref format in use:
--   manual admin path:      <quote uuid>
--   workforce internal:     retarget_quote_<uuid>
--   workforce public:       retarget_pubquote_<uuid>
-- ============================================================

CREATE OR REPLACE VIEW public.workforce_retarget_attribution AS
SELECT
  q.id            AS quote_id,
  'internal'      AS book,
  q.customer_total AS amount,
  q.status,
  q.created_at    AS quote_created_at
FROM public.quotes q
WHERE q.status IN ('converted', 'completed')
  AND EXISTS (
    SELECT 1 FROM public.scheduled_emails se
    WHERE se.source = 'quote_retarget'
      AND se.status = 'sent'
      AND se.source_ref IN (q.id::text, 'retarget_quote_' || q.id::text))
UNION ALL
SELECT
  cq.id, 'public', cq.quote_total, cq.status, cq.created_at
FROM public.customer_quotes cq
WHERE cq.status = 'converted'
  AND EXISTS (
    SELECT 1 FROM public.scheduled_emails se
    WHERE se.source = 'quote_retarget'
      AND se.status = 'sent'
      AND se.source_ref = 'retarget_pubquote_' || cq.id::text);

REVOKE ALL ON public.workforce_retarget_attribution FROM anon;
GRANT SELECT ON public.workforce_retarget_attribution TO service_role, authenticated;

-- Append attribution columns to the scoreboard (CREATE OR REPLACE VIEW
-- permits adding columns at the end only — keep existing column order).
CREATE OR REPLACE VIEW public.workforce_scoreboard AS
SELECT
  (SELECT count(*) FROM public.slack_agent_tasks
     WHERE created_by ~ '^(workforce-|wpw-workforce)'
       AND created_at > now() - interval '7 days')                 AS cards_created_7d,
  (SELECT count(*) FROM public.slack_agent_tasks
     WHERE created_by ~ '^(workforce-|wpw-workforce)'
       AND status NOT IN ('pending')
       AND created_at > now() - interval '7 days')                 AS cards_actioned_7d,
  (SELECT count(*) FROM public.agent_email_campaigns
     WHERE created_by ~ '^workforce-'
       AND created_at > now() - interval '7 days')                 AS campaigns_built_7d,
  (SELECT count(*) FROM public.agent_email_campaigns
     WHERE created_by ~ '^workforce-' AND status = 'approved'
       AND created_at > now() - interval '7 days')                 AS campaigns_approved_7d,
  (SELECT count(*) FROM public.agent_social_posts
     WHERE created_by ~ '^workforce-'
       AND created_at > now() - interval '7 days')                 AS social_built_7d,
  (SELECT count(*) FROM public.workforce_learning
     WHERE change_kind = 'edited'
       AND created_at > now() - interval '7 days')                 AS human_edits_7d,
  (SELECT count(*) FROM public.workforce_events
     WHERE status = 'done'
       AND created_at > now() - interval '7 days')                 AS events_processed_7d,
  (SELECT count(*) FROM public.workforce_events
     WHERE status = 'failed'
       AND created_at > now() - interval '7 days')                 AS events_failed_7d,
  (SELECT count(*) FROM public.scheduled_emails
     WHERE (source = 'quote_retarget' OR source LIKE 'mightymail:%')
       AND created_at > now() - interval '7 days')                 AS drip_emails_queued,
  (SELECT count(*) FROM public.workforce_retarget_attribution)     AS retarget_converted_quotes,
  (SELECT COALESCE(round(sum(amount)), 0)
     FROM public.workforce_retarget_attribution)                   AS retarget_influenced_revenue;


-- ===== 20260722190000_wpw_workforce_personal_outreach.sql =====
-- ============================================================
-- WPW AI Workforce — personalized outreach shell template
--
-- Carrier template for agent-written PER-CUSTOMER emails (the
-- anti-generic path): the agent writes the whole body from that
-- customer's actual data (their vehicle, their material, their
-- order history, their price); this template is just the branded
-- shell. Delivery rides the existing pipeline:
--   scheduled_emails -> process-scheduled-emails ->
--   send-templated-email (Resend), with every open/click mirrored
--   onto the Klaviyo profile by resend-webhook.
-- ============================================================

INSERT INTO public.email_templates
  (slug, name, description, subject, html_content, from_name, from_email, merge_tags, category, is_active)
SELECT
  'workforce-personal-v1',
  'Workforce Personal Outreach',
  'Branded shell for agent-written per-customer emails. Body is fully composed by the agent from the customer''s own data; subject arrives via subject_override.',
  'A note from WePrintWraps',
  '<!doctype html><html><body style="margin:0;background:#f6f7fb;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',sans-serif;color:#0d1220;">'
  || '<div style="max-width:560px;margin:0 auto;padding:32px 24px;">'
  || '<div style="height:5px;border-radius:5px;background:linear-gradient(90deg,#00C7FF,#7E5BEC 55%,#FF2DC8);margin-bottom:20px;"></div>'
  || '{{body_html}}'
  || '<p style="color:#94a3b8;font-size:12px;margin:26px 0 0;">We Print Wraps · genuine 3M &amp; Avery film · printed in the USA · 549-622-4678</p>'
  || '</div></body></html>',
  'WePrintWraps',
  'noreply@restyleproai.com',
  '["body_html","customer_name"]'::jsonb,
  'workforce',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.email_templates WHERE slug = 'workforce-personal-v1'
);


-- ===== 20260722200000_prompt_to_print_positioning.sql =====
-- ============================================================
-- Prompt-to-Print(TM) — canonical category positioning into the
-- brand brain (docs/PROMPT_TO_PRINT_POSITIONING.md is the source
-- of truth; this merges the machine-readable copy every agent
-- and content-engine-claude reads at draft time).
-- Merge (||) so existing brand_brain keys are preserved;
-- 'positioning' key is replaced wholesale.
-- ============================================================

UPDATE public.brands
SET brand_brain = coalesce(brand_brain, '{}'::jsonb) || jsonb_build_object(
  'positioning', jsonb_build_object(
    'category', 'Prompt-to-Print(TM) — a new category of design software that transforms a simple prompt into production-ready graphics. Design software that does not stop at artwork; it continues all the way to production-ready print files.',
    'evolution', '1987 Adobe Illustrator: Draw it. 1990 Adobe Photoshop: Design it. 2026 DesignProAI: Prompt it. Print it. The world''s first AI-native design platform with a proprietary deterministic production engine.',
    'killer_line', 'Photoshop creates graphics. DesignProAI creates graphics—and the production-ready files to print them.',
    'contrast', 'Adobe created software for designers. DesignProAI created software for production.',
    'tagline', 'Describe it. Refine it. Print it.',
    'claim', 'Photoshop changed how designers create. DesignProAI is changing how the print industry creates production-ready graphics.',
    'workflow', 'Prompt (describe the wrap) -> Design (DesignProAI generates professional concepts) -> Revise (natural language) -> Print (PrintPro(TM), the proprietary hybrid deterministic file output engine, automatically generates production-ready wrap files).',
    'engine_credit', 'DESIGNPROAI(TM) - Powered by PrintPro(TM) - Hybrid Deterministic File Output Engine',
    'benefits', jsonb_build_array(
      'No in-house designer required.',
      'Faster customer approvals.',
      'Production-ready files.',
      'More wraps completed.'
    ),
    'rules', jsonb_build_array(
      'The differentiator is always the one extra sentence: "...and the production-ready files to print them." Lead with what people already understand (Photoshop), then land the leap.',
      'Category language (Prompt-to-Print, the tagline) appears wherever DesignProAI is named. One line in job-proof content; full narrative on landing surfaces.',
      'Never "AI art", never "AI image generator", never "like Midjourney". The engine is deterministic production.',
      'The category is about changing the workflow; the benefits explain why customers care.'
    )
  )
)
WHERE slug = 'weprintwraps' OR is_active = true;


-- ===== 20260722210000_wraptv_house_music.sql =====
-- ============================================================
-- WrapTVWorld house music → video_music_library
-- Registers the five archived original tracks (Suno, July 2026;
-- masters in wrap-files/wraptv-music/) so video-music recommends
-- the HOUSE library for install mashups instead of returning empty.
-- Moods/energy derived from the transcribed lyrics
-- (docs/WRAPTV_MUSIC_LIBRARY.md). Durations approximate (128kbps).
-- Idempotent by storage_url.
-- ============================================================

INSERT INTO public.video_music_library (title, storage_url, mood, energy, bpm, genre, duration_seconds)
SELECT * FROM (VALUES
  ('The Wrap Game',
   'https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/wrap-files/wraptv-music/the-wrap-game.mp3',
   'gritty, determined, grind anthem', 'high', NULL::int, 'hip-hop', 222::numeric),
  ('The Wrap Game (Alt Mix)',
   'https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/wrap-files/wraptv-music/untitled-a.mp3',
   'gritty, determined, grind anthem', 'high', NULL::int, 'hip-hop', 256::numeric),
  ('Wrap Family',
   'https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/wrap-files/wraptv-music/wrap-family.mp3',
   'defiant, anthemic, community pride', 'high', NULL::int, 'rock-rap anthem', 274::numeric),
  ('Wrap Family (Metal Forge Mix)',
   'https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/wrap-files/wraptv-music/wrap-family-metal-forge-mix.mp3',
   'heavy, emotional, legacy', 'high', NULL::int, 'metal remix', 261::numeric),
  ('Wrap Life (working title)',
   'https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/wrap-files/wraptv-music/untitled-b.mp3',
   'upbeat, proud, community roll-call', 'high', NULL::int, 'uptempo hip-hop', 190::numeric)
) AS v(title, storage_url, mood, energy, bpm, genre, duration_seconds)
WHERE NOT EXISTS (
  SELECT 1 FROM public.video_music_library m WHERE m.storage_url = v.storage_url
);


-- ===== 20260722220000_content_intelligence_library.sql =====
-- ============================================================
-- CONTENT INTELLIGENCE LIBRARY (docs/CONTENT_INTELLIGENCE_LIBRARY.md)
-- Not folders — a searchable catalog: one record per source
-- video/song, timestamped content moments underneath, and music
-- structure analysis. The batch-ingestion/catalog layer that feeds
-- the EXISTING processing tools (transcribe, auto-assemble,
-- captions, music match, review queue).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.media_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('video','music')),
  title TEXT,
  filename TEXT,
  storage_url TEXT,
  drive_id TEXT,
  shoot TEXT,                          -- e.g. 'lucid-wraps-denver', 'houdini-vegas'
  transcript TEXT,
  duration_seconds NUMERIC,
  orientation TEXT,                    -- 'landscape' | 'vertical' | 'square'
  quality TEXT,                        -- freeform: '4k clean', 'phone handheld', ...
  brands TEXT[] DEFAULT '{}',
  projects TEXT[] DEFAULT '{}',
  vehicles TEXT[] DEFAULT '{}',
  people TEXT[] DEFAULT '{}',
  emotional_tone TEXT,
  energy TEXT,
  product_relevance TEXT,
  recommended_formats TEXT[] DEFAULT '{}',
  script_ideas JSONB DEFAULT '[]'::jsonb,
  review_status TEXT NOT NULL DEFAULT 'unreviewed',
  dedupe_key TEXT UNIQUE,              -- storage path or drive id
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.content_moments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES public.media_sources(id) ON DELETE CASCADE,
  start_time NUMERIC,
  end_time NUMERIC,
  speaker TEXT,
  verbatim_quote TEXT,
  visual_description TEXT,
  hook_score INT,                      -- 0-10
  soundbite_score INT,
  broll_score INT,
  install_stage TEXT,                  -- prep | squeegee | trim | reveal | interview | ...
  brands TEXT[] DEFAULT '{}',
  vehicles TEXT[] DEFAULT '{}',
  people TEXT[] DEFAULT '{}',
  content_uses TEXT[] DEFAULT '{}',    -- reel | short | ad | testimonial | broll | ...
  music_matches TEXT[] DEFAULT '{}',
  review_status TEXT NOT NULL DEFAULT 'unreviewed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.music_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID REFERENCES public.media_sources(id) ON DELETE SET NULL,
  track_title TEXT,
  storage_url TEXT UNIQUE,
  bpm INT,
  duration_seconds NUMERIC,
  intro_seconds NUMERIC,
  beat_drops JSONB DEFAULT '[]'::jsonb,      -- [{time, note}]
  chorus_sections JSONB DEFAULT '[]'::jsonb, -- [{start, end}]
  lyrical_theme TEXT,
  energy_curve TEXT,
  explicit BOOLEAN NOT NULL DEFAULT false,
  best_footage_type TEXT,
  suggested_structure TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_moments_source ON public.content_moments (source_id);
CREATE INDEX IF NOT EXISTS idx_content_moments_hook ON public.content_moments (hook_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_media_sources_shoot ON public.media_sources (shoot);
CREATE INDEX IF NOT EXISTS idx_media_sources_kind ON public.media_sources (kind);

ALTER TABLE public.media_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_moments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_analysis ENABLE ROW LEVEL SECURITY;

DO $pol$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['media_sources','content_moments','music_analysis'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "service_role_%s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "service_role_%s" ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "authenticated_read_%s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "authenticated_read_%s" ON public.%I FOR SELECT TO authenticated USING (true)', t, t);
  END LOOP;
END
$pol$;


-- ===== 20260722230000_houdini_retag.sql =====
-- ============================================================
-- Folder 1 identified by Trish: HOUDINI WRAPS, LAS VEGAS
-- (Behind Shop Doors episode). Retag the ingested assets.
-- Idempotent: only touches rows still carrying the placeholder.
-- ============================================================

UPDATE public.agent_media_assets
SET tags = array_remove(tags, 'untagged-shoot') || ARRAY['houdini-wraps','las-vegas']
WHERE 'untagged-shoot' = ANY(tags);

UPDATE public.media_sources
SET shoot = 'houdini-wraps-vegas'
WHERE shoot = 'untagged-shoot';


-- ===== 20260722230000_wraptv_site_content.sql =====
-- WrapTVWorld site rotation — the site is a DISTRIBUTION CHANNEL alongside IG/FB.
-- content-deploy publishes approved agent_social_posts rows with
-- platform 'wraptv_site' into this table on schedule; the public Fuel-style
-- site (/wraptv) reads it anonymously. Rotation: newest N entries per show
-- stay 'live', older ones flip to 'archived' (done by the publisher, not SQL).

CREATE TABLE IF NOT EXISTS wraptv_site_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID,                          -- back-link to agent_social_posts.id
  brand TEXT NOT NULL DEFAULT 'wraptvworld',
  show_slug TEXT NOT NULL DEFAULT 'behind-the-install',
  title TEXT,
  caption TEXT,
  media_url TEXT NOT NULL,
  thumbnail_url TEXT,
  media_type TEXT NOT NULL DEFAULT 'video',   -- 'video' | 'image'
  credit TEXT,                           -- shop / creator attribution line
  tags TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'live',   -- 'live' | 'archived'
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL DEFAULT 'content-deploy',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wraptv_site_show_live
  ON wraptv_site_content (show_slug, status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_wraptv_site_post ON wraptv_site_content (post_id);

ALTER TABLE wraptv_site_content ENABLE ROW LEVEL SECURITY;

-- The public site reads live entries with the anon key.
DROP POLICY IF EXISTS "wraptv site public read" ON wraptv_site_content;
CREATE POLICY "wraptv site public read" ON wraptv_site_content
  FOR SELECT USING (status = 'live');

-- Publisher (service role) manages everything.
DROP POLICY IF EXISTS "wraptv site service all" ON wraptv_site_content;
CREATE POLICY "wraptv site service all" ON wraptv_site_content
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');


-- ===== 20260722240000_video_parse_jobs.sql =====
-- ============================================================================
-- video_parse_jobs — queue for the self-hosted footage parser
-- (worker/media-parser, drained by the parse-media GitHub Actions workflow).
--
-- Creator Studio queues a Google Drive file/folder URL (or any direct media
-- URL); the worker downloads it, extracts 32kbps mono audio with ffmpeg,
-- chunks anything over the Whisper cap, and POSTs each chunk to
-- wpw-workforce-sweep {"mode":"transcribe"} — which catalogs the transcript
-- into media_sources/content_moments and emits media.analyze for scoring.
-- This is the in-UI replacement for hand-run parse batches: edge functions
-- cannot hold multi-GB camera raws, a GitHub runner can.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.video_parse_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'drive_file' | 'drive_folder' | 'url'
  kind          text NOT NULL DEFAULT 'drive_file',
  media_url     text NOT NULL,
  filename      text,
  -- shoot/series tags carried into media_sources (e.g. houdini-wraps,
  -- behind-shop-doors, las-vegas)
  tags          text[] NOT NULL DEFAULT '{}',
  -- queued → processing → complete | failed | skipped
  status        text NOT NULL DEFAULT 'queued',
  -- parent folder job that expanded into this file job
  parent_job_id uuid REFERENCES public.video_parse_jobs(id) ON DELETE SET NULL,
  segments      int,
  duration_seconds numeric,
  chunks        int,
  error         text,
  attempts      int NOT NULL DEFAULT 0,
  claimed_at    timestamptz,
  created_by    text NOT NULL DEFAULT 'creator-studio',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.video_parse_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on video_parse_jobs" ON public.video_parse_jobs;
CREATE POLICY "Service role full access on video_parse_jobs"
  ON public.video_parse_jobs FOR ALL USING (auth.role() = 'service_role');

-- Creator Studio (authenticated admins) can queue and watch parse jobs
DROP POLICY IF EXISTS "Authenticated read on video_parse_jobs" ON public.video_parse_jobs;
CREATE POLICY "Authenticated read on video_parse_jobs"
  ON public.video_parse_jobs FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated insert on video_parse_jobs" ON public.video_parse_jobs;
CREATE POLICY "Authenticated insert on video_parse_jobs"
  ON public.video_parse_jobs FOR INSERT TO authenticated
  WITH CHECK (status = 'queued');

CREATE INDEX IF NOT EXISTS idx_video_parse_jobs_status_created
  ON public.video_parse_jobs (status, created_at);


-- ===== 20260722250000_fix_drive_file_unique.sql =====
-- drive-sync upserts agent_media_assets with ON CONFLICT (drive_file_id),
-- but uq_agent_media_assets_drive_file was a PARTIAL unique index
-- (WHERE drive_file_id IS NOT NULL) — PostgreSQL cannot infer a partial
-- index for a plain ON CONFLICT (col) target, so every scan upsert failed
-- with "no unique or exclusion constraint matching the ON CONFLICT
-- specification". A full unique index behaves identically for data
-- (NULLs never conflict) and satisfies ON CONFLICT inference.
DROP INDEX IF EXISTS public.uq_agent_media_assets_drive_file;
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_media_assets_drive_file
  ON public.agent_media_assets (drive_file_id);


-- ===== 20260722250000_video_render_jobs_slide_urls.sql =====
-- Carousel format: the renderer produces one JPG per slide. final_url stays
-- the first slide; the full ordered set lands here so publishing (IG carousel
-- containers) and the Studio UI can use every slide.
ALTER TABLE video_render_jobs ADD COLUMN IF NOT EXISTS slide_urls TEXT[];


-- ===== 20260722260000_agent_sms_campaigns.sql =====
-- agent_sms_campaigns — staging queue for workforce-drafted SMS blasts.
-- The agents only ever DRAFT here (status needs_review); actual sending
-- is a manual human action through the existing Twilio send-sms-campaign
-- function. Mirrors the agent_email_campaigns review pattern.
CREATE TABLE IF NOT EXISTS public.agent_sms_campaigns (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand            text NOT NULL DEFAULT 'weprintwraps',
  name             text NOT NULL,
  message_template text NOT NULL,
  audience         text,
  -- needs_review → approved | rejected | sent
  status           text NOT NULL DEFAULT 'needs_review',
  created_by       text NOT NULL DEFAULT 'workforce',
  reviewed_by      text,
  sent_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_sms_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on agent_sms_campaigns" ON public.agent_sms_campaigns;
CREATE POLICY "Service role full access on agent_sms_campaigns"
  ON public.agent_sms_campaigns FOR ALL USING (auth.role() = 'service_role');

-- Workforce dashboard (authenticated admins) reviews and approves
DROP POLICY IF EXISTS "Authenticated read on agent_sms_campaigns" ON public.agent_sms_campaigns;
CREATE POLICY "Authenticated read on agent_sms_campaigns"
  ON public.agent_sms_campaigns FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated update on agent_sms_campaigns" ON public.agent_sms_campaigns;
CREATE POLICY "Authenticated update on agent_sms_campaigns"
  ON public.agent_sms_campaigns FOR UPDATE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_agent_sms_campaigns_status
  ON public.agent_sms_campaigns (status, created_at);


-- ===== 20260722270000_social_revision_note.sql =====
-- Chat-edit feedback for social drafts (the dashboard's "edit by chat"
-- box). The revise loop reads this and returns a fresh draft.
ALTER TABLE public.agent_social_posts ADD COLUMN IF NOT EXISTS revision_note text;

`;
