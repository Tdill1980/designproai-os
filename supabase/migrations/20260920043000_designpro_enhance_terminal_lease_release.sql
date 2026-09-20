-- Topaz acquires the heavy slot after its ordinary workflow claim. Release it
-- on a terminal transition without imposing the output stages' prebound-slot
-- requirement on enhance.upscale's initial running transition.
DO $migration$
DECLARE
  v_definition text;
  v_anchor text := $anchor$  IF NEW.stage_key NOT IN ('output.build','output.verify','zip.build') THEN$anchor$;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'designpro_private.sync_heavy_stage_lease()'::regprocedure
  ) INTO v_definition;
  IF pg_catalog.strpos(v_definition, 'enhance_terminal_heavy_release') = 0 THEN
    IF pg_catalog.strpos(v_definition, v_anchor) = 0 THEN
      RAISE EXCEPTION 'heavy_stage_terminal_release_patch_anchor_missing';
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_anchor, $patch$  -- enhance_terminal_heavy_release: only the finishing attempt owns this slot.
  IF NEW.stage_key = 'enhance.upscale' THEN
    IF OLD.status = 'running' AND NEW.status IN ('completed','failed') THEN
      UPDATE designpro_private.heavy_stage_leases
      SET stage_id = NULL, lease_owner = NULL, lease_token = NULL,
        lease_expires_at = NULL, updated_at = pg_catalog.clock_timestamp()
      WHERE lease_key = 'production-heavy'
        AND panelprofile_node_id IS NULL
        AND stage_id = OLD.id
        AND lease_token = OLD.lease_token;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.stage_key NOT IN ('output.build','output.verify','zip.build') THEN$patch$);
    EXECUTE v_definition;
  END IF;
END
$migration$;

-- Repair only an already terminal Topaz owner's leaked slot. The stage lock
-- prevents a concurrent retry from becoming running while its slot is cleared;
-- the existing acquisition advisory lock serializes heavy/PPO claimants.
DO $repair$
DECLARE v_stage_id uuid;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('designpro.heavy-stage:production-heavy',0)
  );
  FOR v_stage_id IN
    SELECT s.id
    FROM public.designpro_workflow_stages s
    JOIN designpro_private.heavy_stage_leases h ON h.stage_id = s.id
    WHERE h.lease_key = 'production-heavy'
      AND h.panelprofile_node_id IS NULL
      AND s.stage_key = 'enhance.upscale'
      AND s.status IN ('completed','failed')
    FOR UPDATE OF s
  LOOP
    UPDATE designpro_private.heavy_stage_leases h
    SET stage_id = NULL, lease_owner = NULL, lease_token = NULL,
      lease_expires_at = NULL, updated_at = pg_catalog.clock_timestamp()
    WHERE h.lease_key = 'production-heavy'
      AND h.stage_id = v_stage_id
      AND h.panelprofile_node_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.designpro_workflow_stages s
        WHERE s.id = h.stage_id AND s.stage_key = 'enhance.upscale'
          AND s.status IN ('completed','failed')
      );
  END LOOP;
END
$repair$;
