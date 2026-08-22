#!/usr/bin/env bash
set -Eeuo pipefail

# Read-only post-migration/deploy fence for the exact A.T.L.A.S. schema this
# release requires. Migration history is bookkeeping, not proof that the live
# function bodies and constraint changed. Query the hosted catalog through the
# Management API's read-only SQL endpoint and admit only one all-true row.

: "${SUPABASE_ACCESS_TOKEN:?DESIGNPRO_SUPABASE_ACCESS_TOKEN is required}"
: "${EXPECTED_PROJECT_REF:?EXPECTED_PROJECT_REF is required}"

[[ $EXPECTED_PROJECT_REF == wozyamlnygaddievzuwn ]] || {
  echo "::error::A.T.L.A.S. schema assertion refused an unexpected Supabase project" >&2
  exit 2
}
[[ $SUPABASE_ACCESS_TOKEN != *$'\n'* && $SUPABASE_ACCESS_TOKEN != *$'\r'* ]] || {
  echo "::error::Supabase access token contains an invalid newline" >&2
  exit 2
}

set +x
response=$(mktemp)
cleanup() {
  rm -f -- "$response"
  unset SUPABASE_ACCESS_TOKEN query payload
}
trap cleanup EXIT

read -r -d '' query <<'SQL' || true
WITH definitions AS (
  SELECT
    COALESCE(
      pg_catalog.pg_get_functiondef(
        pg_catalog.to_regprocedure(
          'designpro_private.calls_1_7_view_plan()'
        )
      ),
      ''
    ) AS plan_definition,
    COALESCE(
      pg_catalog.pg_get_functiondef(
        pg_catalog.to_regprocedure(
          'public.regenerate_designpro_generation_slot(uuid,text,text)'
        )
      ),
      ''
    ) AS regenerate_definition,
    COALESCE(
      pg_catalog.pg_get_functiondef(
        pg_catalog.to_regprocedure(
          'public.handoff_designpro_generation_to_production(uuid)'
        )
      ),
      ''
    ) AS handoff_definition,
    COALESCE(
      pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
        'designpro_private.verify_revision_render_assets()'
      )),''
    ) AS revision_trigger_definition,
    COALESCE(
      pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
        'public.complete_designpro_stage(uuid,uuid,jsonb,jsonb,text,jsonb)'
      )),''
    ) AS freeze_definition,
    COALESCE(
      pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
        'designpro_private.flat_first_atlas_view_set_valid(uuid)'
      )),''
    ) AS atlas_valid_definition,
    COALESCE(
      pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
        'designpro_private.flat_first_atlas_requires_new_run(uuid)'
      )),''
    ) AS atlas_new_run_definition,
    COALESCE(
      pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
        'public.get_designpro_generation_request(uuid)'
      )),''
    ) AS status_definition,
    COALESCE(
      pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
        'public.designpro_generation_view_paths(uuid)'
      )),''
    ) AS view_paths_definition,
    COALESCE(
      pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
        'public.designpro_flat_atlas_revision_paths(uuid)'
      )),''
    ) AS atlas_paths_definition,
    COALESCE((
      SELECT pg_catalog.pg_get_expr(p.polqual,p.polrelid)
      FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_class t ON t.oid=p.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname='storage' AND t.relname='objects'
        AND p.polname='designpro_owner_read_wrap_files'
      LIMIT 1
    ),'') AS storage_read_policy,
    COALESCE((
      SELECT pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid)
      FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_class t ON t.oid=p.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname='storage' AND t.relname='objects'
        AND p.polname='designpro_owner_insert_revision_inputs'
      LIMIT 1
    ),'') AS storage_insert_policy,
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger g
      WHERE g.tgrelid=pg_catalog.to_regclass(
          'public.designpro_revision_sources'
        )
        AND g.tgname='designpro_00_revision_render_assets'
        AND g.tgfoid=pg_catalog.to_regprocedure(
          'designpro_private.verify_revision_render_assets()'
        )
        AND NOT g.tgisinternal
    ) AS revision_trigger_bound,
    COALESCE((
      SELECT pg_catalog.pg_get_constraintdef(c.oid)
      FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = 'designpro_revision_sources'
        AND c.conname = 'designpro_revision_snapshot_contract'
      LIMIT 1
    ), '') AS revision_constraint
), compact AS (
  SELECT
    pg_catalog.replace(
      pg_catalog.regexp_replace(
        plan_definition, '[[:space:]]+', '', 'g'
      ),
      '::text', ''
    ) AS plan_definition,
    pg_catalog.replace(
      pg_catalog.regexp_replace(
        regenerate_definition, '[[:space:]]+', '', 'g'
      ),
      '::text', ''
    ) AS regenerate_definition,
    pg_catalog.replace(
      pg_catalog.regexp_replace(
        handoff_definition, '[[:space:]]+', '', 'g'
      ),
      '::text', ''
    ) AS handoff_definition,
    pg_catalog.replace(pg_catalog.regexp_replace(
      revision_trigger_definition,'[[:space:]]+','','g'
    ),'::text','') AS revision_trigger_definition,
    pg_catalog.replace(pg_catalog.regexp_replace(
      freeze_definition,'[[:space:]]+','','g'
    ),'::text','') AS freeze_definition,
    pg_catalog.replace(pg_catalog.regexp_replace(
      atlas_valid_definition,'[[:space:]]+','','g'
    ),'::text','') AS atlas_valid_definition,
    pg_catalog.replace(pg_catalog.regexp_replace(
      atlas_new_run_definition,'[[:space:]]+','','g'
    ),'::text','') AS atlas_new_run_definition,
    pg_catalog.replace(pg_catalog.regexp_replace(
      status_definition,'[[:space:]]+','','g'
    ),'::text','') AS status_definition,
    pg_catalog.replace(pg_catalog.regexp_replace(
      view_paths_definition,'[[:space:]]+','','g'
    ),'::text','') AS view_paths_definition,
    pg_catalog.replace(pg_catalog.regexp_replace(
      atlas_paths_definition,'[[:space:]]+','','g'
    ),'::text','') AS atlas_paths_definition,
    pg_catalog.replace(pg_catalog.regexp_replace(
      storage_read_policy,'[[:space:]]+','','g'
    ),'::text','') AS storage_read_policy,
    pg_catalog.replace(pg_catalog.regexp_replace(
      storage_insert_policy,'[[:space:]]+','','g'
    ),'::text','') AS storage_insert_policy,
    revision_trigger_bound,
    pg_catalog.replace(
      pg_catalog.replace(
        pg_catalog.replace(
          pg_catalog.regexp_replace(
            revision_constraint, '[[:space:]]+', '', 'g'
          ),
          '::text', ''
        ),
        '(', ''
      ),
      ')', ''
    ) AS revision_constraint
  FROM definitions
), positions AS (
  SELECT *,
    pg_catalog.strpos(
      regenerate_definition,
      'THENRAISEEXCEPTION''flat_first_atlas_new_run_required'';ENDIF;'
    ) AS guard_position,
    pg_catalog.strpos(
      regenerate_definition, 'UPDATEpublic.designpro_generation_views'
    ) AS views_update_position,
    pg_catalog.strpos(
      regenerate_definition, 'INSERTINTOpublic.designpro_generation_slots'
    ) AS slots_insert_position,
    pg_catalog.strpos(
      regenerate_definition, 'UPDATEpublic.designpro_generation_slots'
    ) AS slots_update_position,
    pg_catalog.strpos(
      regenerate_definition, 'UPDATEpublic.designpro_generation_requests'
    ) AS request_update_position,
    pg_catalog.strpos(
      view_paths_definition,
      'flat_first_atlas_requires_new_run(v_row.id)'
    ) AS view_paths_guard_position,
    pg_catalog.strpos(
      view_paths_definition, '''storagePath'',storage_path'
    ) AS view_paths_private_position,
    pg_catalog.strpos(
      atlas_paths_definition,
      'flat_first_atlas_requires_new_run(v_request.id)'
    ) AS atlas_paths_guard_position,
    pg_catalog.strpos(
      atlas_paths_definition, '''guideStoragePath'',r.guide_storage_path'
    ) AS atlas_paths_private_position
  FROM compact
)
SELECT
  (
    pg_catalog.strpos(
      plan_definition,
      '''sourceViewType'',''close-up'',''consumerRole'',''closeup'''
    ) > 0
    AND pg_catalog.strpos(plan_definition, 'hero3d') = 0
  ) AS view_plan_closeup,
  (
    guard_position > 0
    AND views_update_position > guard_position
    AND slots_insert_position > guard_position
    AND slots_update_position > guard_position
    AND request_update_position > guard_position
  ) AS regenerate_guard_before_mutation,
  (
    pg_catalog.strpos(
      revision_constraint,
      'snapshot->''renderAssets''?''closeup''<>snapshot->''renderAssets''?''hero3d'''
    ) > 0
  ) AS revision_constraint_history_compatible,
  (
    pg_catalog.strpos(
      handoff_definition,
      'v_view.consumer_role=''closeup'''
    ) = 0
    AND pg_catalog.strpos(
      handoff_definition,
      'FORv_viewINSELECTconsumer_role,content_hash,byte_size,content_type'
    ) > 0
  ) AS handoff_carries_closeup,
  (
    revision_trigger_bound
    AND pg_catalog.strpos(
      revision_trigger_definition,
      'ARRAY[''driver'',''passenger'',''hood'',''roof'',''front'',''rear'',''closeup'']'
    ) > 0
    AND pg_catalog.strpos(revision_trigger_definition, 'hero3d') = 0
    AND pg_catalog.strpos(
      revision_trigger_definition,
      'pg_catalog.count(DISTINCTvalue->>''contentHash'')'
    ) > 0
  ) AS revision_trigger_closeup_only,
  (
    pg_catalog.strpos(
      freeze_definition,
      'FROMpublic.designpro_revision_sourcesfrozen'
    ) > 0
    AND pg_catalog.strpos(
      freeze_definition,
      'frozen.revision_id=v_run.revision_id'
    ) > 0
    AND pg_catalog.strpos(
      freeze_definition,
      'frozen.snapshot_hash=v_run.revision_snapshot_hash'
    ) > 0
    AND pg_catalog.strpos(
      freeze_definition,
      'ARRAY[''driver'',''passenger'',''hood'',''roof'',''front'',''rear'',''hero3d'']'
    ) > 0
    AND pg_catalog.strpos(
      freeze_definition,
      'ARRAY[''driver'',''passenger'',''hood'',''roof'',''front'',''rear'',''closeup'']'
    ) > 0
    AND pg_catalog.strpos(freeze_definition, '''hero3d''')>0
    AND pg_catalog.strpos(freeze_definition, '''closeup''')>0
  ) AS revision_freeze_legacy_pinned_only,
  (
    pg_catalog.strpos(storage_read_policy,'''closeup''')>0
    AND pg_catalog.strpos(storage_read_policy,'''hero3d''')>0
    AND pg_catalog.strpos(storage_insert_policy,'''closeup''')>0
    AND pg_catalog.strpos(storage_insert_policy,'''hero3d''')=0
  ) AS storage_write_closeup_read_hero,
  (
    pg_catalog.strpos(
      atlas_valid_definition,
      '''designpro.atlas-designpanel-server-provider.v1'''
    )>0
    AND pg_catalog.strpos(
      atlas_valid_definition,
      '''designpro.atlas-proof-semantic-qc.v1'''
    )>0
    AND pg_catalog.strpos(
      atlas_valid_definition,
      '''driverContentHash'''
    )>0
    AND pg_catalog.strpos(
      atlas_valid_definition,
      '''designpro-flat-first-atlas-20260822.v4'''
    )>0
    AND pg_catalog.strpos(
      atlas_valid_definition,
      '''designpro.atlas-master-semantic-qc.v1'''
    )>0
    AND pg_catalog.strpos(
      atlas_valid_definition,
      '''designpro.flat-first-master-provider.v1'''
    )>0
    AND pg_catalog.strpos(
      atlas_valid_definition,
      '''designpanel-ai-generate.artboard.20260822.v1'''
    )>0
    AND pg_catalog.strpos(atlas_valid_definition,'''masterQcPassed''')>0
    AND pg_catalog.strpos(atlas_valid_definition,'''masterQcConfidence''')>0
    AND pg_catalog.strpos(atlas_valid_definition,'''masterPromptHash''')>0
    AND pg_catalog.strpos(atlas_valid_definition,'''masterExampleSetHash''')>0
    AND pg_catalog.strpos(atlas_valid_definition,'''{provider,atlasZoneContract}''')>0
    AND pg_catalog.strpos(atlas_valid_definition,'''{provider,atlasZoneContentHash}''')>0
    AND pg_catalog.strpos(atlas_valid_definition,'''{provider,atlasZoneSurfaceKey}''')>0
    AND pg_catalog.strpos(atlas_valid_definition,'''{validation,authorityHash}''')>0
    AND pg_catalog.strpos(atlas_valid_definition,'''{validation,zoneHash}''')>0
    AND pg_catalog.strpos(atlas_valid_definition,'''{validation,zoneSurfaceKey}''')>0
    AND pg_catalog.strpos(atlas_valid_definition,'''{authority,zoneContract}''')>0
    AND pg_catalog.strpos(atlas_valid_definition,'''{authority,zoneContentHash}''')>0
    AND pg_catalog.strpos(
      atlas_valid_definition,
      '''{provider,atlasZonePassedToPassengerRepair}'''
    )>0
    AND pg_catalog.strpos(
      atlas_new_run_definition,
      'flat_first_atlas_view_set_valid(v_row.id)'
    )>0
    AND pg_catalog.strpos(
      status_definition,
      '''flat_first_atlas_new_run_required'''
    )>0
    AND view_paths_guard_position>0
    AND view_paths_private_position>view_paths_guard_position
  ) AS atlas_owner_read_quarantine,
  (
    atlas_paths_guard_position>0
    AND atlas_paths_private_position>atlas_paths_guard_position
    AND pg_catalog.strpos(
      atlas_paths_definition,
      '''flat_first_atlas_new_run_required'''
    )>0
  ) AS atlas_preview_quarantine
FROM positions;
SQL

payload=$(jq -cn --arg query "$query" '{query: $query, parameters: []}')
curl --fail --silent --show-error \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary "$payload" \
  "https://api.supabase.com/v1/projects/$EXPECTED_PROJECT_REF/database/query/read-only" \
  > "$response"

# The endpoint currently returns an array. Accept its documented response
# wrapper variants as well, but never accept a bare object or more than one
# result row. Definitions stay on the server; logs expose only pass/fail.
if ! jq -e '
  def rows:
    if type == "array" then .
    elif ((.result? | type) == "array") then .result
    elif ((.data? | type) == "array") then .data
    else error("read-only query returned no row array")
    end;
  rows as $rows
  | ($rows | length) == 1
    and ($rows[0].view_plan_closeup == true)
    and ($rows[0].regenerate_guard_before_mutation == true)
    and ($rows[0].revision_constraint_history_compatible == true)
    and ($rows[0].handoff_carries_closeup == true)
    and ($rows[0].revision_trigger_closeup_only == true)
    and ($rows[0].revision_freeze_legacy_pinned_only == true)
    and ($rows[0].storage_write_closeup_read_hero == true)
    and ($rows[0].atlas_owner_read_quarantine == true)
    and ($rows[0].atlas_preview_quarantine == true)
' "$response" >/dev/null; then
  echo "::error::Live DesignProAI schema does not satisfy the A.T.L.A.S. Close-Up/regeneration contract; migration history alone is not release evidence" >&2
  exit 1
fi

echo "PASS: live A.T.L.A.S. view plan, owner quarantine, Close-Up-only writes, and read-only historical Hero compatibility are installed"
