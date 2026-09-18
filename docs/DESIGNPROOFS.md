# DesignProofs

DesignProAI OS owns this shared approval-PDF library. WPW is a tenant/brand;
PatternPro and WallPro are the originating systems. Brand tags do not grant
access to another customer's proofs.

- `/design-proofs` opens the signed-in customer's library across brands.
- `/design-proofs?brand=weprintwraps` opens their WPW proofs from ShopFlow.
- In either app's **3D Proof**, **Save to DesignProofs**, **Share**, and
  **Email Proof** save an immutable PDF and catalog entry. Local PDF download
  and Print remain available without saving an account copy.
- Filter by system and search the actual DesignID, GenerationID, Project ID,
  Proof ID, customer, quote, order, or design name. PatternPro supplies its
  render ID as GenerationID; WallPro supplies its design/version/project
  references. An uploaded wall with no generation has a Project ID.
- Catalog PDF/Share/Email actions renew the seven-day link to the existing
  PDF. Email uses the same shared composer and attachment delivery function.
- Quote/order numbers are searchable labels, not automatic job attachments.
  Proof approval fields are part of the PDF, not an online signature service.

## Release

Run the release gate and protected production migration for this exact main
revision before deploying the updated `design-proof-export` edge function.
The frontend and function share the new `design_proofs` catalog contract.
Keep handler authentication enabled for every action, with owner-scoped list
queries and storage paths. RLS permits authenticated owners to read only;
only the server can file immutable catalog entries.

The migration test executes the real schema and policies on PGlite. Handler
tests cover owner isolation, system/brand filters, references, pagination,
renewed links, failed filing cleanup, and the existing email attachment.
An actual inbox delivery still needs a recipient-authorized live check.
