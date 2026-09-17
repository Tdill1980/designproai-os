# DesignProAI Troubleshooting

This guide is for daily users. It explains what to check without exposing internal runtime details.

## My design is not showing the latest revision

1. Open the project in RevisionStudio.
2. Confirm the selected revision is the latest intended revision.
3. Refresh the project state from the server.
4. Do not upload/export an old proof and treat it as the new project authority.
5. If the project still shows the wrong revision, contact support with the GenerationID / DesignID shown in the project.

## The client proof email did not arrive

1. Confirm the customer email address.
2. Confirm the proof was sent from the current revision.
3. Check whether the project reports a send/delivery error.
4. Ask the customer to check spam/quarantine.
5. Correct the email and resend from the same project rather than creating a duplicate project.

## The customer wants a change

Use RevisionStudio. Do not start a new unrelated project for a normal revision.

Examples:

- phone number;
- URL;
- logo;
- wording;
- color;
- placement;
- design-element changes.

A true creative revision should stay attached to the same broader project lineage.

## GENIE progress appears stalled

GENIE progress is server-reported. A job may be waiting on:

- production-file purchase/entitlement;
- dimension/geometry resolution;
- production validation;
- human preflight QC;
- output generation;
- final human QC;
- package/delivery work.

Do not assume the browser is broken simply because a stage has not advanced. Check the stage label and required action. If the system shows an error, provide the project identity to support.

## A production panel is missing

Do not create a substitute panel manually inside the UI just to make the job look complete.

A missing expected production artifact should be reported as missing so the authoritative production path can be repaired/resumed.

## The 3D proof looks right but the production dimensions look different

This can be correct.

A 3D proof is a presentation asset. Production geometry is resolved from the system's dimensional authority (including GENIE vehicle data where applicable), not by measuring the appearance of the render.

If the physical vehicle/configuration is unusual, confirm whether MyVehiclePro or a production geometry review is required.

## The wrong year/make/model is shown

Stop before production-file approval.

Correct the vehicle/application context and regenerate/review the correct project state. The production system must not be released against the wrong vehicle identity.

## RecreatePro did not reproduce the reference closely enough

Clarify what must be preserved versus what may be interpreted:

- exact logo/text;
- color relationships;
- major graphic motif;
- layout/placement;
- style inspiration only.

Use RevisionStudio/RecreatePro revision controls rather than treating the first recreation as final.

## Production output is waiting for QC

This is expected when the job is at a human release gate.

DesignProAI intentionally uses human QC in addition to automated validation. The purpose is to catch expensive production errors before final release.

## WrapBox does not show the final package yet

WrapBox is the terminal delivery step. The job must complete the required production/output verification and final QC before the package is released.

Check GENIE/ProductionFlow for the current stage rather than assuming delivery is complete.

## What information support needs

Include:

- GenerationID;
- DesignID if shown;
- order number if applicable;
- app used (VehiclePro, WallPro, CutPro, MyVehiclePro, RecreatePro);
- current stage/status;
- screenshot of the visible issue;
- what action you expected to happen.

Do not send passwords, API keys, or payment card details to support.
