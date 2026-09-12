-- wpw_link_otps — cross-domain WPW account-link verification codes.
--
-- Backs the wpw-oauth-link edge function's cross-domain link mode (RULE 1:
-- recover, don't invent — this is a proven pattern, adapted). A shop's
-- DesignProAI signup email can differ from the email their WePrintWraps
-- orders are under (e.g. signed up under an LLC domain, ordered with a
-- personal gmail). requestOtp/verifyOtp prove ownership of that alt inbox
-- instead of requiring a matching domain.
--
-- Service-role only: the edge function is the sole reader/writer. No client
-- (anon or authenticated) may ever read a code hash or an unverified link
-- attempt directly.
CREATE TABLE IF NOT EXISTS public.wpw_link_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alt_email text NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wpw_link_otps_user_alt_idx ON public.wpw_link_otps (user_id, alt_email);
CREATE INDEX IF NOT EXISTS wpw_link_otps_rate_limit_idx ON public.wpw_link_otps (user_id, created_at);

ALTER TABLE public.wpw_link_otps ENABLE ROW LEVEL SECURITY;
-- No policies for anon/authenticated — deny-all by default under RLS.
REVOKE ALL ON public.wpw_link_otps FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.wpw_link_otps TO service_role;
