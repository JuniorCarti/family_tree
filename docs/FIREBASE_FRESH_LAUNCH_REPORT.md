# Lineage Firebase fresh-launch report

Date: 2026-09-15

## Implemented

- Firebase Auth Web bridge now supports email/password, Google popup sign-in, phone OTP with invisible reCAPTCHA, password reset, email verification, and ID-token API calls.
- `scripts/bootstrap-superadmin.js` performs an explicit UID-only bootstrap. It sets the `superadmin` custom claim and an approved profile; it refuses missing/invalid `SUPERADMIN_UID` and never authorizes by email.
- Functions enforce approved/suspended/rejected account state server-side. Superadmins bypass approval through the trusted claim/profile.
- Superadmin account listing, approve, reject, suspend, reactivate, and audit endpoints are privileged and write audit records.
- Firestore and Storage rules require an approved profile (or trusted `superadmin` claim) for family data.
- Existing tree/person/relationship emulator tests were updated with approved fixtures.

## Deployment evidence

- Firestore and Storage rules deployed to `family-tree-a4c4f`.
- Functions `api` updated in `us-central1`.
- Hosting release completed at `https://family-tree-a4c4f.web.app/`.
- Firebase contract tests passed; Functions syntax passed; rules emulator suite passed (3 tests).

## Required operator steps

1. Enable/verify Google and Phone providers, SMS region policy, reCAPTCHA, and authorized domains in Firebase Console.
2. Sign in once with the intended Google or phone account, obtain its Firebase Auth UID, then run:
   `SUPERADMIN_UID=<uid> npm run bootstrap:superadmin`
3. Sign out/in so the refreshed ID token contains the `superadmin` claim.
4. Run disposable email, Google, and phone account approval/rejection/suspension tests in a clean browser.

No production superadmin claim was created because no operator UID was supplied. No user data or credentials were fabricated.

## Known blockers

- Browser-based provider and OTP testing was not available in this execution environment.
- Firebase CLI warned that Functions still targets Node 20 and has no Artifact Registry cleanup policy. Upgrade runtime and configure cleanup before long-term operation.
- Historical PostgreSQL/Render data recovery remains a separate zero-data-loss blocker; this fresh launch does not import or delete legacy data.
