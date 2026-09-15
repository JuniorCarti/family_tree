# Lineage email verification audit

Date: 2026-09-15

## Root cause

Firebase email/password accounts were sending verification through the client, but the resend button still called the removed PostgreSQL-era `/api/auth/resend-verification` endpoint. The refresh action also re-read application state without reloading the Firebase user or forcing a fresh ID token. In addition, phone-only accounts were interpreted as having an unverified email because their email field is empty.

## Changes

- Firebase `sendEmailVerification` now uses the production continue URL `https://family-tree-a4c4f.web.app/`.
- Refresh calls `reload()` and `getIdToken(true)` before requesting Lineage session state.
- Resend uses Firebase Auth directly for Firebase users, with the legacy endpoint retained only for non-Firebase fallback.
- Verification gating applies only to users with an email and the password provider. Google users follow Firebase's `emailVerified`; phone-only users are not blocked by email verification.
- Approval remains independent from email verification; verified users still receive pending/approved status based on the Lineage profile.

## Verification contract

The Firebase default action handler is canonical; no custom `applyActionCode` handler is maintained. The authorized production domain is `family-tree-a4c4f.web.app` and no Render/Cloud Run/localhost continue URL is used.

## Validation

- Firebase contract tests: 8/8 passed.
- JavaScript syntax checks: passed.
- Production `GET /`: 200.
- Production unauthenticated `/api/auth/session`: controlled 401 (not 404/500).
- Production unauthenticated feature routes: controlled 401.

Real email receipt and link activation require a disposable production account and a mailbox; those are manual release checks and were not claimed as automated successes.
