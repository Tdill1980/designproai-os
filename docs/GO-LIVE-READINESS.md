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

## Finish line 1 — prove the kernel, then freeze it

1. **Reconfigure the droplet environment.** `sudo ./configure-env.sh
   CONFIGURE_DESIGNPRO_SECRETS_ONLY`, entering the Topaz key. This gates
   everything: `ops/deploy.sh:25` runs `validate-env.py` before it touches the
   host, and an environment file written before Call 12 has neither
   `DESIGNPRO_TOPAZ_ENABLED` nor `TOPAZ_API_KEY`, so the deploy fails there.
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

## Unproven, stated plainly

Nothing in the kernel has run against live Gemini, Topaz or Supabase. The two
open questions are design quality from the single-call Call 8 prompt, and
whether Topaz reaches print geometry inside its 6× per-request ceiling — the
receipt records `clampedByEngineCeiling` when it does not. The canary answers
both, and until it runs, no claim here is production-proven.
