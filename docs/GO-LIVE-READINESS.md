# Two finish lines

Revised 2026-08-12. This replaces an earlier version of this document whose
next-build recommendation was wrong; the correction is recorded at the bottom.

There are two separate finish lines and confusing them costs weeks.

| | |
|---|---|
| **Technical validation** | Extremely close. Topaz key → dark deploy → real canary. |
| **Commercial DesignProAI V1** | Calls 1–7 engine → DesignPro generation UI → the existing kernel → customer acceptance → launch. |

The kernel is the production back half. It is not the customer-facing product.
A shop that already has seven renders can be served end to end today. A
customer who wants to *ask for a wrap* cannot, and that is the launch blocker.

## Deploying: the `[dark-deploy]` marker is not optional

A merge to `main` runs the release gate, and the gate's success chains into
`deploy-production.yml` via `workflow_run`. That chain then **stops** unless the
main commit message contains the literal marker:

```
git log -1 --format=%B | grep -Fq '[dark-deploy]'   # deploy-production.yml:94
```

So a squash-merge title without `[dark-deploy]` produces a green release gate
and a **failed deploy**, and the failure looks like an SSH error — the guard
exits before `KEY_FILE` and `KNOWN_HOSTS` are ever set, so the diagnostic step
reports `Identity file not accessible` and `no argument after keyword
"userknownhostsfile"`. Those messages are a symptom of the missing marker, not
a credentials problem. Confirmed live on PRs #61 and #62.

**Put `[dark-deploy]` in the squash-merge title of any PR that should reach the
droplet.** A PR that should merge without deploying simply omits it.

## Finish line 1 — prove the kernel, then freeze it

1. **Configure the droplet environment.** Put the Topaz key in the
   `designproai-production` environment as the `DESIGNPRO_TOPAZ_API_KEY`
   secret, then run the **Configure the droplet environment from GitHub
   Secrets** workflow with `WRITE_DESIGNPROAI_DROPLET_ENV`. The key travels
   from GitHub to the server over the same pinned SSH the deploy uses; it
   never passes through a chat window or a shell history. On the server the
   one canonical writer is still `ops/configure-env.sh`, so there is no second
   idea of what a valid environment is.

   This gates everything downstream: `ops/deploy.sh:25` runs `validate-env.py`
   before it touches the host, and an environment file written before Call 12
   has neither `DESIGNPRO_TOPAZ_ENABLED` nor `TOPAZ_API_KEY`, so the deploy
   fails there.

   `sudo ./configure-env.sh CONFIGURE_DESIGNPRO_SECRETS_ONLY` at a server
   console does exactly the same thing and remains supported. The dark deploy
   also configures a droplet that has no environment yet, from the same
   secrets, so a first deployment needs no separate configuration step.
2. **Dark deploy** the exact `main` SHA. Loopback only, no DNS.
3. **Run one complete canary** on seven renders that already exist: seven views
   → GENIE → Call 8 → Call 9 → logos → PanelPro preflight → Call 12 → 18
   production files → final QC → stamp → ZIP → WrapBox. Then interrupt a worker
   mid-run and prove it resumes without regenerating accepted artifacts.

**Then stop.** If the canary passes, freeze Calls 8–12. Do not rebuild the
production engine again unless the canary exposes a real defect. Enough time
has gone into it.

## Finish line 2 — the vertical slice that sells

**The next development assignment is Calls 1–7, not another app extraction.**

Port the frozen Calls 1–7 generation engine and the DesignPro generation page
into this repository, against the `designpro_*` API and storage contract, with
zero RestylePro runtime dependency, and connect its seven immutable outputs
straight into the already-built Calls 8–12 pipeline.

Today `/api/generation/requests` is a lease and contract adapter. It records a
request, hands out a lease, and binds an engine-contract hash. **It does not
generate anything.** A customer cannot type

> 2024 Ford Transit, HVAC Hero, dark blue / ice blue, bold commercial wrap

and receive seven renders inside this product. That one screen is what makes
the proposition work, and it does not exist here.

Sellable V1 is exactly this path, nothing more:

> prompt it → see seven matching vehicle renders → revise and approve → see the
> 2D production proof → order production files → receive the production pack

The lightweight back-half surfaces already in this repository are sufficient
for that path. Revision Studio does not need to become the historical 9,769-line
`RevisionStudioIQ`, and the QC gates do not need to become the full
`DesignPanelProWorkspace`, before anything can be sold.

Then: Caddy and DNS, DesignProAI Resend, signup/auth, billing and entitlement,
and one real outside-user acceptance test.

## Finish line 3 — the broader suite, afterwards

Once DesignPro sells, extract the rest. **RecreatePro first** — 49 files, 4
tables, the only app with no prohibited-table dependency, so it proves the
extraction pattern cheaply — then WallPro, MyVehiclePro, GraphicsPro and the
others behind their own server APIs. Measured inventory for all eleven apps is
in `docs/migration/2026-08-12-suite-migration-inventory.md`.

## What this document previously got wrong

The earlier version recommended starting the suite with RecreatePro on the
grounds that it is the cheapest extraction. That optimizes for engineering
convenience, not for launch. RecreatePro is the easiest first migration; it is
not the missing piece preventing the core product from being demonstrated or
sold. Days spent on RecreatePro, WallPro, Gallery and ApprovePro would leave
the one screen that makes DesignProAI magical still absent from the new system.

It also framed the suite as something to wait for. That is wrong too. The suite
is not required to sell. The DesignPro vertical slice is.

## The edge functions the droplet routes — 59, not 470

The migration copied all of `restylepro-os`'s edge functions into
`supabase/functions/` so nothing would be missing mid-port. Production does not
run all of them. `ops/designpro-functions.txt` is the routed set: **59
functions**, each listed with the caller that reaches it, computed from the
DesignPro chain by `ops/designpro-function-graph.mjs`.

The number matters because the migrated frontend carries every RestylePro
product. "What the app can invoke" is 212 functions across WallPro, GraphicsPro,
ColorPro, the marketing tools and the video pipeline. Routing that set would put
the cost and the attack surface of products this droplet does not host onto this
droplet. The DesignPro closure is 59.

Four places enforce it and `ops/tests/ops-hardening.test.mjs` fails if they
disagree: the server refuses an unlisted name
(`function_not_in_designpro_allowlist`), the image build deletes unlisted
directories, the release policy names each routed function individually rather
than globbing the directory, and `--check` re-derives the graph so a function
whose last caller is deleted cannot stay routed.

Three routed functions conflict with standing owner direction and are routed
only because migrated UI still calls them — `designpro-parse-brief`
(`DesignPanelProPremium.tsx`), `designpro-persist-assets`
(`DesignPanelProPremium.tsx`, `RevisionStudioIQ.tsx`) and `elevate-prompt`
(`DesignGenie.tsx`, a manual button, not the auto-render path). Dropping them
changes migrated behaviour, so they stay until the owner says otherwise.

## Unproven, stated plainly

Nothing in the kernel has run against live Gemini, Topaz or Supabase. The two
open questions are design quality from the single-call Call 8 prompt, and
whether Topaz reaches print geometry inside its 6× per-request ceiling — the
receipt records `clampedByEngineCeiling` when it does not. The canary answers
both, and until it runs, no claim here is production-proven.
