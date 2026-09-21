-- THE VALIDATOR SERVICE_ROLE CANNOT RUN TURNS EVERY DIRECT WRITE INTO A FAILURE.
--
-- `designpro_generation_request_asset_paths_bound` is a BEFORE INSERT OR UPDATE
-- trigger on `public.designpro_generation_requests`. Its body calls
-- `designpro_private.calls_1_7_asset_paths_bound(...)`, which is owned by
-- postgres and was granted EXECUTE to postgres ALONE:
--
--     acl: postgres=X/postgres
--
-- `service_role` already holds SELECT/INSERT/UPDATE/DELETE on that table, so the
-- write itself is permitted — it is the CHECK that is not. Every direct insert
-- therefore dies with
--
--     permission denied for function calls_1_7_asset_paths_bound
--
-- measured on panel-proof probe run 35634810443 (2026-09-21).
--
-- THIS IS NOT A LOOSENING. The grant does not widen what service_role may
-- write; it already may. It makes the constraint on those writes RUNNABLE
-- instead of fatal, which is the difference between a rule that is enforced and
-- a rule that makes the table unwritable. The validator's own logic, the
-- trigger, and the v2/v3 contract-version condition it guards are untouched.
--
-- Scoped to `service_role` deliberately: `authenticated` and `anon` have no
-- privilege on this table and must not gain a reason to reach into
-- `designpro_private`.

grant execute on function designpro_private.calls_1_7_asset_paths_bound(jsonb, uuid, uuid)
  to service_role;

-- The trigger function itself is invoked by the executor rather than by a
-- caller, so it needs no grant to fire. It is included because a future direct
-- call (a backfill validating rows in place, say) would hit the identical wall,
-- and because leaving one half of a pair ungranted is how this defect read as
-- mysterious rather than obvious.
grant execute on function designpro_private.validate_calls_1_7_asset_paths()
  to service_role;
