-- designpro_generation_view_paths was created SECURITY DEFINER without a grant
-- statement, so it kept PostgreSQL's default ACL: EXECUTE to PUBLIC. The
-- function resolves the storage paths of a request's generated views, which is
-- exactly the identity the rest of Calls 1-7 refuses to hand the browser -- the
-- status route returns hashes and roles and never a path, and signing lives
-- behind the owner's own token at the gateway. A definer function that anon can
-- call reaches around all of that.
--
-- Every other function in that migration is revoked on the line after it is
-- created; this one was missed, and the release gate's fresh-database pgTAP run
-- is what caught it ("no DesignPro SECURITY DEFINER function is executable by
-- PUBLIC or anon"). The production database does not carry the leak, because it
-- reached its current shape through a different migration path -- but any
-- database built from these files does, so the fix belongs here rather than in
-- a console.
--
-- Written as its own migration rather than as an edit to
-- 20260814070000_designpro_generation_view_supersession.sql: that file is
-- already applied, and a revoke is idempotent, so this applies cleanly to a
-- fresh database and to one that already has the function.

REVOKE ALL ON FUNCTION public.designpro_generation_view_paths(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.designpro_generation_view_paths(uuid) TO authenticated, service_role;
