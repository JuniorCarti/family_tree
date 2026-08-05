# Account Unlock and Superadmin Approval

## Purpose

New Lineage accounts are locked until a one-time KES 500 payment is manually verified. This reduces anonymous signups while keeping payment review transparent. Existing accounts are grandfathered as approved during the first migration.

This platform approval is separate from family roles. A platform superadmin can unlock accounts; a family owner or family administrator cannot.

## User journey

1. A person signs up or accepts a family invitation.
2. The account is created with `pending` status and receives a normal server-side session.
3. Instead of family data, the user sees a locked preview containing example family-tree nodes and feature placeholders.
4. The user sends exactly **KES 500** using **M-Pesa Send Money** to **254113245740**.
5. The user submits the M-Pesa transaction code and, optionally, the payer phone number.
6. The account moves to `payment_submitted` and waits for manual review.
7. A superadmin compares the submitted information with the received M-Pesa payment and approves or rejects it.
8. Approval unlocks all family access already associated with that account. Rejection displays a reason and permits a new payment-reference submission.

Lineage never requests an M-Pesa PIN. Users should not share their PIN, full M-Pesa message, password, or invitation token with a reviewer.

## Account states

| State | Meaning | Family data access | Can submit payment proof |
| --- | --- | --- | --- |
| `pending` | Registered, no proof submitted | No | Yes |
| `payment_submitted` | Proof awaits superadmin review | No | No |
| `rejected` | Proof was rejected with a reason | No | Yes |
| `approved` | Payment verified or existing account grandfathered | Yes, subject to family role | Not required |

## Pre-approval product guide and help centre

The locked-account screen is also the product's pre-purchase help centre. The same guide is available publicly from both sign-in and sign-up, so a person can understand Lineage before creating an account or submitting payment proof.

The screen contains:

- A clear description of Lineage as a private family-tree and storytelling application.
- A preview of the tree, timeline, stories, collaboration, privacy, export, and recovery features.
- A four-step explanation covering unlock, tree creation, family invitations, and archive preservation.
- A role guide for viewers, contributors, administrators, and owners.
- Prominent warnings that Lineage never requests an M-Pesa PIN, password, or verification code.
- 34 expandable questions covering onboarding, payment, family access, privacy, features, and account troubleshooting.
- Full-text FAQ search and category filters.
- A support handoff explaining what information is safe to include in a request.

Payment and approval status remain the primary action. On narrow screens the payment card appears before the locked product preview and educational content.

The authentication card includes a compact “New to Lineage?” explanation plus separate How Lineage works and Browse FAQs actions. These actions open the existing guide in public-help mode rather than duplicating FAQ content. Public-help mode hides account-specific payment controls, labels the screen as a product guide, and replaces Log out with Back to sign in. Returning restores the authentication form and preserves invitation or other query parameters.

The approval screen is an independent, full-height scroll container because the authenticated tree workspace intentionally disables document scrolling. Anchor links include a sticky-header offset, and reduced-motion preferences disable smooth scrolling.

### FAQ content rules

When changing the FAQ:

1. Keep payment amount and recipient information consistent with server-controlled configuration.
2. Do not promise a fixed manual-review time.
3. Do not claim that unsupported features such as GEDCOM, print books, MFA, or automated user-managed backups exist.
4. Keep privacy answers aligned with API enforcement, not merely browser visibility.
5. Never ask users to send an M-Pesa PIN, password, full confirmation message, bank credential, or email verification code.
6. Test search terms that appear only in answers as well as terms appearing in question titles.
7. Verify the locked screen at 320px, 390px, tablet, and desktop widths after content changes.
8. Verify both sign-in and sign-up can open the shared guide and return without changing authentication mode or losing invitation parameters.

## Superadmin bootstrap

Superadmins are configured through a comma-separated environment variable:

```env
SUPERADMIN_EMAILS=owner@example.com,backup@example.com
```

A matching account is marked as a superadmin and approved during startup or signup. Removing an email from the variable does not silently demote an existing superadmin; role removal should be a deliberate database/administrative operation.

At least one controlled email must be configured before enabling the approval gate in production.

## Payment configuration

```env
ACCOUNT_UNLOCK_FEE_KES=500
MPESA_PAYMENT_PHONE=254113245740
```

These defaults are present in the application, but production should set them explicitly so deployment configuration documents the intended recipient and amount.

## Security controls

- The API, not browser visibility, enforces the account lock.
- Every family-data route checks current database status on every request, so approval takes effect without a new login and revocation cannot be bypassed with an old session.
- M-Pesa references are normalized to uppercase and globally unique to prevent reuse.
- A user can have only one submitted payment awaiting review.
- Approval requires an actual submitted reference.
- Reviews store reviewer ID, timestamp, and rejection reason.
- Payment amount and recipient number are server-controlled; clients cannot override them.
- Existing family invitations may be accepted while locked, but no tree data becomes readable until approval.

## API

| Method | Endpoint | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/api/account/access` | Signed in | Current lock state, latest submission, amount, and recipient |
| POST | `/api/account/payment-submissions` | Signed in, locked | Submit M-Pesa reference for review |
| GET | `/api/superadmin/accounts` | Superadmin | Review accounts by status |
| PATCH | `/api/superadmin/accounts/:userId/approve` | Superadmin | Verify payment and unlock account |
| PATCH | `/api/superadmin/accounts/:userId/reject` | Superadmin | Reject proof with a visible reason |

## Manual review checklist

Before approving:

1. Confirm a KES 500 payment appears in the recipient's M-Pesa records.
2. Confirm its transaction code exactly matches the submitted code.
3. Confirm it has not been reversed or previously used.
4. Use the payer phone only as supporting information; do not request a PIN or password.
5. Approve only after all checks pass. Otherwise reject with a concise reason the user can act on.

## Future M-Pesa integration

Manual Send Money verification is an interim workflow. A future Daraja integration should use server-to-server callbacks, signed/validated callback data, idempotency keys, and an immutable payment event log. Automated integration must not trust a browser-supplied success response.
