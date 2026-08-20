# Dark deploy trigger — 2026-08-09

Authorized by the owner to run the existing protected DesignProAI dark-deployment path against the pinned new droplet after the acceptance-directory fix on main.

This file changes no application behavior, database schema, DNS, Caddy configuration, or RestylePro code. It exists only to create an auditable deployment-trigger commit.

## 2026-08-20 — A.T.L.A.S. flat-first diagnostic

Owner-authorized deployment of PR #107. The production database records migration `20260820100000_designpro_flat_first_atlas_v1`; the deployed application keeps legacy generation as the default and exposes A.T.L.A.S. only as an opt-in diagnostic. Production handoff remains fail-closed.
