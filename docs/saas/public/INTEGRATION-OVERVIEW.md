# DesignProAI OS — Integration Overview

This document explains the integration boundary at a platform level. It is intentionally not an endpoint-by-endpoint API reference. The reviewed repository contains internal gateway, Supabase, Stripe, and workflow interfaces whose contracts should not be published as a public API until they are versioned and explicitly supported.

## Integration philosophy

DesignProAI is designed so external systems can participate at the edges while the operating system remains authoritative for project identity and production state.

External systems may provide or consume:

- customer/project intake;
- vehicle/application metadata;
- billing/production-file entitlement;
- proof notifications;
- production status;
- completed output/delivery state;
- downstream print/fulfillment handoff.

They should not become a second production conductor or create competing production artifacts.

## Current platform boundary

### Browser / client applications

The browser submits customer-authorized inputs, displays project state, shows proofs/artifacts, accepts permitted review/QC actions, and can request/resume work. It does not own the durable production graph.

### DesignProAI gateway/server

The server validates requests, resolves current project identity/state, and advances server-owned workflow work. Durable stage state and artifact relationships are stored outside the browser session.

### Data / workflow state

The operating system persists project identity, workflow runs/stages, artifact receipts, production entitlements, QC state, and delivery relationships so completed work can be resumed rather than reconstructed from browser memory.

### Billing

The current production-output path includes Stripe-based production entitlement/purchase handling. Public partner documentation should describe supported checkout/entitlement behavior, not expose internal webhook parsing or database schemas.

### File delivery

Verified production packages are delivered through WrapBox. Optional external print/fulfillment systems may consume those outputs when an approved integration exists.

## Partner/OEM integration patterns

The platform can support several commercial integration models without giving a partner control of the internal production graph:

### Referral / channel integration

A partner sends qualified users into a branded DesignProAI onboarding or plan flow. Attribution and recurring-revenue rules can sit outside the production runtime.

### Embedded/white-label application entry

A partner can present selected DesignProAI applications or tenant-branded experiences while DesignProAI remains the server authority for project state and production output.

### Enterprise account provisioning

A franchise, manufacturer, distributor, or multi-location organization can provision users/locations under an enterprise relationship while retaining the shared DesignProAI project model.

### Production/fulfillment handoff

After DesignProAI builds and verifies production files, an approved partner workflow can receive the output package and associated order metadata for downstream printing/fulfillment.

## Public API status

A public, versioned external API is not declared by this document.

Before publishing an API reference, DesignProAI should explicitly define:

1. supported authentication model;
2. API versioning policy;
3. stable resource names;
4. tenant and role authorization rules;
5. idempotency rules;
6. webhook event contracts;
7. rate limits;
8. error model;
9. file-upload/download limits;
10. deprecation policy.

Internal routes, Supabase functions, gateway endpoints, and database RPCs are implementation details until promoted to a supported public contract.

## Non-negotiable integration rule

**One project has one authoritative production lineage.**

An integration may start work, add approved data, observe work, purchase work, or consume completed work. It must not create a parallel panel/output producer that can diverge from the DesignProAI project authority.
