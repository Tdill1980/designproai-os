-- THE THREE-ZONE PROOF IS THE THING THE CUSTOMER IS SUPPOSED TO SEE, AND
-- NOTHING COULD READ IT.
--
-- Owner, on the architecture: "Production panel proof is source it has the 3
-- zones / For panels, panels with seperated and logos and text." The panel-proof
-- Call 1 already produces all three: Zone 1 is cut and placed into the GENIE
-- manifest and becomes the accepted master, Zone 2 (the six clean panels) and
-- Zone 3 (the five cut graphics) are cut, measured and now content-addressed
-- into storage by `authorPanelProofMaster`.
--
-- Every one of those identities lands on the revision as
-- `metadata.panelProofAuthoring` -- and there was no read path to any of it.
-- `designpro_flat_atlas_revision_paths` predates the contract and returns the
-- guide, the master and the projection; it does not know the sheet exists, and
-- it cannot, because the sheet is not a column. So the product could show the
-- assembled master (Zone 1, already the master) and NOTHING of the document the
-- model actually drew or the two sibling quadrants.
--
-- This adds the read, with the same fence as the two RPCs it is modelled on
-- (`designpro_flat_atlas_revision_paths`, `designpro_atlas_refusal_paths`):
-- SECURITY DEFINER, NULL for an absent request and for another owner's request
-- alike, so the gateway answers 404 without confirming an id exists.
--
-- IT RETURNS PATHS, NEVER URLS. The gateway signs a five-minute preview per
-- object and strips the paths, exactly as /atlas and /atlas-refusals do.
--
-- WHY THE SIGNING POLICY MATCHES EXACT NAMES AND NOT THE PREFIX.
-- Both families are CONTENT-ADDRESSED: the sheet is `atlas-panel-proof/<sha>.png`
-- and a quadrant panel is `atlas-panel-proof/quadrants/<sha>.png`. Content
-- addressing is deliberately NOT owner-scoped -- two customers whose panel
-- happened to be byte-identical share one object, and more importantly a
-- prefix predicate would let any authenticated caller sign any other
-- customer's sheet by guessing or replaying a hash. So the predicate is
-- membership: the object must be named by a panel-proof revision THIS caller
-- owns. That is the same class of leak the provider cache was just fenced
-- against; the fence has to hold here too.

-- Membership test, as a definer helper rather than inline in the policy.
--
-- Two reasons it cannot be inline. A policy expression is evaluated with the
-- PRIVILEGES OF THE QUERYING USER, so an `EXISTS` over a service-role-only
-- table takes the whole read down with `permission denied` (recorded in
-- CLAUDE.md, learned on designpro_qc_members). And the jsonb expansion below
-- does not belong in a per-object policy body where the next reader has to
-- work out what it proves.
CREATE OR REPLACE FUNCTION designpro_private.caller_may_sign_panel_proof_object(
  p_object_name text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.designpro_flat_atlas_revisions r
    WHERE (
        r.owner_id = (SELECT auth.uid())
        OR designpro_private.caller_is_design_staff()
      )
      AND r.metadata ? 'panelProofAuthoring'
      AND (
        -- the sheet itself
        r.metadata->'panelProofAuthoring'->>'proofStoragePath' = p_object_name
        -- or one of the two sibling quadrants' stored panels
        OR EXISTS (
          SELECT 1
          FROM pg_catalog.jsonb_array_elements(
            COALESCE(r.metadata->'panelProofAuthoring'->'quadrants'->'clean','[]'::jsonb)
            || COALESCE(r.metadata->'panelProofAuthoring'->'quadrants'->'cutGraphics','[]'::jsonb)
          ) AS panel
          WHERE panel->>'storagePath' = p_object_name
        )
      )
  );
$fn$;

REVOKE ALL ON FUNCTION designpro_private.caller_may_sign_panel_proof_object(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION designpro_private.caller_may_sign_panel_proof_object(text)
  TO authenticated, service_role;

COMMENT ON FUNCTION designpro_private.caller_may_sign_panel_proof_object(text) IS
  'True when the named storage object is the three-zone proof sheet or one of the Zone 2 / Zone 3 panels of a panel-proof A.T.L.A.S. revision the caller owns (or design staff). Membership, not prefix: atlas-panel-proof objects are content-addressed and therefore not owner-scoped.';

-- Owner (or design staff) read of the three-zone proof for the LATEST revision.
--
-- The latest revision is the one the product is showing. Older revisions keep
-- their own metadata and stay readable through this function once they are
-- latest again; nothing here rewrites or hides history.
CREATE OR REPLACE FUNCTION public.designpro_atlas_panel_proof_paths(
  p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_request public.designpro_generation_requests%ROWTYPE;
  v_atlas public.designpro_flat_atlas_revisions%ROWTYPE;
  v_proof jsonb;
BEGIN
  SELECT * INTO v_request
  FROM public.designpro_generation_requests
  WHERE id = p_request_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF COALESCE(auth.jwt()->>'role','') IS DISTINCT FROM 'service_role'
    AND v_request.owner_id IS DISTINCT FROM auth.uid()
    AND NOT designpro_private.caller_is_design_staff()
  THEN RETURN NULL; END IF;

  SELECT * INTO v_atlas
  FROM public.designpro_flat_atlas_revisions
  WHERE request_id = v_request.id
  ORDER BY revision_sequence DESC
  LIMIT 1;

  -- A request with no revision, or a revision authored on a topology that has
  -- no three-zone document (six-surface, field, hero-driver), answers with an
  -- explicit absence rather than NULL. NULL means "not yours / no such
  -- request" and the gateway turns it into 404; this request exists and simply
  -- has no panel proof, which the UI must be able to tell apart.
  IF v_atlas.id IS NULL OR NOT (v_atlas.metadata ? 'panelProofAuthoring')
    OR v_atlas.metadata->'panelProofAuthoring' = 'null'::jsonb
  THEN RETURN pg_catalog.jsonb_build_object(
    'requestId', v_request.id,
    'revisionId', v_atlas.id,
    'panelProof', false
  ); END IF;

  v_proof := v_atlas.metadata->'panelProofAuthoring';

  RETURN pg_catalog.jsonb_build_object(
    'requestId', v_request.id,
    'revisionId', v_atlas.id,
    'revisionSequence', v_atlas.revision_sequence,
    'panelProof', true,
    'contract', v_proof->>'contract',
    'topology', v_proof->>'topology',
    'promptVersion', v_proof->>'promptVersion',
    'masterContentHash', v_atlas.master_content_hash,
    -- THE SHEET: the three-zone document Call 1 actually drew. This is the
    -- artifact the owner calls the production panel proof and the source every
    -- zone is cut from.
    'sheet', pg_catalog.jsonb_build_object(
      'storagePath', v_proof->>'proofStoragePath',
      'contentHash', v_proof->>'proofSha256',
      'contract', v_proof->>'proofContract',
      'geometry', v_proof->'sheet'
    ),
    -- Zone 1 became the accepted master, so it is described (surface, fit,
    -- rect, size) and NOT stored twice; the master is already signed by
    -- /atlas. Zones 2 and 3 carry their own stored identities, or an honest
    -- `persisted: false` with a reason.
    'quadrants', v_proof->'quadrants'
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.designpro_atlas_panel_proof_paths(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.designpro_atlas_panel_proof_paths(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.designpro_atlas_panel_proof_paths(uuid) IS
  'Owner (or design staff) read of the three-zone production panel proof for a request''s latest A.T.L.A.S. revision: the sheet plus the Zone 2 (clean) and Zone 3 (cut graphics) panel identities from metadata.panelProofAuthoring. Returns NULL for an absent or other-owner request, and {panelProof:false} for a request whose revision was authored on a topology with no three-zone document. Returns storage paths; the gateway signs and strips them.';

-- Signing only, owner or design staff, exactly the objects a revision names.
DROP POLICY IF EXISTS designpro_owner_sign_atlas_panel_proof ON storage.objects;
CREATE POLICY designpro_owner_sign_atlas_panel_proof
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'wrap-files'
    AND storage.allow_only_operation('object.sign')
    AND designpro_private.caller_may_sign_panel_proof_object(storage.objects.name)
  );

COMMENT ON POLICY designpro_owner_sign_atlas_panel_proof ON storage.objects IS
  'Owner-only (or design staff) signing access to the exact three-zone proof sheet and Zone 2 / Zone 3 panels named by that owner''s panel-proof A.T.L.A.S. revisions. Membership, never prefix: these objects are content-addressed and shared across owners. Listing and direct download are excluded.';
