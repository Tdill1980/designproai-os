# DesignProAI Changelog Template

Use this file as the standard structure for public release notes. Do not copy raw engineering commit messages directly into the customer changelog.

## YYYY-MM-DD — Release title

### New

- Customer-visible feature or capability.
- New application/workflow support.

### Improved

- Workflow improvement.
- Performance/usability improvement.

### Fixed

- Customer-visible bug that was corrected.
- Be specific about outcome; do not expose private security details or proprietary implementation.

### Production / output notes

Include only when relevant:

- supported output changes;
- QC workflow changes;
- GENIE geometry/panelizer changes;
- WrapBox delivery changes.

### Naming changes

If a public product name changes, document the visible rename and whether old links continue to work.

Example:

> GraphicsPro is now **CutPro**. Existing saved projects and legacy links continue to resolve; this is a customer-facing naming change, not a new production engine.

### Known limitations

List important customer-impacting limitations that remain open.

Avoid internal issue IDs unless they are useful to enterprise support customers.

---

## Release-note rules

1. Describe what changed for the customer.
2. Do not claim a feature is live until deployed/accepted.
3. Separate naming/copy changes from actual engine changes.
4. Do not expose prompt IP, credentials, private hosts, or security-sensitive internals.
5. If a production/output change affects file compatibility, dimensions, or QC, call it out clearly.
6. If an old route/name remains as a compatibility alias, say so when that reassures users.
