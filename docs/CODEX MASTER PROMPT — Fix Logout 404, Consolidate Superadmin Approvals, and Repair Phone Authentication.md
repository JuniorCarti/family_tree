# CODEX MASTER PROMPT

## LINEAGE — PRODUCTION AUTH, APPROVAL & SUPERADMIN CONSOLIDATION INCIDENT

Act as a principal Firebase authentication engineer, senior full-stack engineer, production incident investigator, Firebase Security Rules specialist, UX engineer, application security engineer, and QA engineer.

Repository:

```text
https://github.com/JuniorCarti/family_tree.git
```

Local repository:

```text
~/Desktop/Projects/family_tree
```

Production:

```text
https://family-tree-a4c4f.web.app/
```

Firebase project:

```text
family-tree-a4c4f
```

The application is Firebase-native.

Do NOT restore PostgreSQL.

Do NOT reconnect Render.

Do NOT redesign the entire application.

The goal of this pass is to fix three concrete production problems:

```text
1. Pending-page logout returns HTTP 404.
2. Old and new superadmin/platform-approval implementations may overlap.
3. Firebase Phone Authentication is not successfully registering a real Kenyan number.
```

Then perform full local, emulator, security, and production verification.

---

# 1. CURRENT PRODUCTION SYMPTOM — LOGOUT 404

After a new account authenticates, the application correctly shows the pending approval experience.

Current screen includes:

```text
Lineage
ACCOUNT APPROVAL

PENDING
ONE-TIME ACCOUNT UNLOCK

Unlock your family archive
```

and currently includes an M-Pesa/manual verification flow.

When the authenticated pending user clicks:

```text
Log out
```

the UI produces:

```text
Request failed: 404
```

This must be investigated and fixed.

Do NOT merely suppress the message.

Determine exactly which HTTP request is returning 404 and why.

---

# 2. TRACE THE LOGOUT FLOW

Search the complete active frontend for:

```text
logout
logOut
signOut
/api/auth/logout
/api/logout
auth/logout
fetch(
api(
```

Use:

```bash
git grep -ni "logout"
git grep -ni "signOut"
git grep -ni "/api/auth/logout"
git grep -ni "auth/logout"
```

Trace from:

```text
Log out button
→ event listener
→ function
→ API/client operation
→ resulting network request
```

Identify the exact source file and line responsible for the 404.

---

# 3. FIREBASE AUTH MUST OWN LOGOUT

Lineage now uses Firebase Authentication.

The canonical logout operation should use:

```javascript
signOut(auth)
```

from Firebase Authentication.

A normal Firebase logout must NOT require:

```text
POST /api/auth/logout
PostgreSQL session destruction
express-session
Cloud Run
Render
```

If the current frontend still calls a legacy logout route, replace that behavior.

Do NOT preserve obsolete server logout simply because old code used it.

---

# 4. LOGOUT MUST WORK FROM EVERY ACCOUNT STATE

Logout must work when the user is:

```text
pending
approved
rejected
suspended
superadmin
```

Logging out must NOT require the account to pass approval middleware.

For example, a pending user must not need access to an `approvedUser()` API endpoint merely to log out.

This is important.

The pending screen's logout button must always work.

---

# 5. SAFE LOGOUT BEHAVIOR

Expected flow:

```text
click Log out

→ disable button / show loading state

→ signOut(auth)

→ unsubscribe active listeners

→ clear non-sensitive local application state

→ reset current profile/tree state

→ show login/register screen
```

Do NOT manually delete Firebase-managed persistence storage.

Do NOT delete unrelated localStorage/sessionStorage values blindly.

Do NOT delete user Firestore data.

---

# 6. LOGOUT FAILURE HANDLING

If Firebase `signOut()` unexpectedly fails:

show a controlled message.

Do not display:

```text
Request failed: 404
```

unless an actual relevant endpoint returned 404.

Do not expose raw stack traces.

---

# 7. TEST LOGOUT

Automated/emulator tests must cover:

```text
pending → logout
approved → logout
rejected → logout
suspended → logout
superadmin → logout
```

Expected:

```text
Firebase auth.currentUser === null
```

after logout.

Reloading the page must show authentication UI.

---

# 8. INVESTIGATE THE EXISTING "PLATFORM APPROVALS"

Before implementing or changing admin UI further, investigate the existing repository and Git history.

The older Lineage application apparently already had:

```text
Platform Approvals
```

inside a previous superadmin/admin experience.

Find it.

Search all branches and history for:

```text
Platform Approvals
Approvals
Account Approval
approval
approve
reject
payment approval
admin
superadmin
isAdmin
isSuperAdmin
adminEmail
adminEmails
M-Pesa
transaction code
unlock
paymentStatus
approvalStatus
```

Use:

```bash
git grep -ni "Platform Approvals"
git grep -ni "approval"
git grep -ni "superadmin"
git grep -ni "isAdmin"
git grep -ni "M-Pesa"
git grep -ni "transaction"
```

Also inspect remote branches and historical commits where necessary.

---

# 9. IDENTIFY THE PREVIOUS SUPERADMIN SYSTEM

Determine exactly how the previous application identified its superadmin.

Possible historical implementations may include:

```text
hard-coded email
Firestore role
PostgreSQL role
environment variable
admin table
Firebase UID
Firebase custom claim
```

Do NOT assume.

Find evidence.

Create a temporary investigation matrix:

| Implementation | Identity mechanism | UI | Backend | Still active? |
|---|---|---|---|---|
| Legacy admin | | | | |
| Platform Approvals | | | | |
| New Firebase superadmin | UID + custom claim | | | |

---

# 10. FIND ANY OLD SUPERADMIN ACCOUNT

Inspect Firebase Auth/Admin data safely if credentials permit.

Determine whether any Firebase users other than the designated current superadmin have:

```text
superAdmin: true
admin: true
role: admin
role: superadmin
```

or equivalent trusted claims.

Do NOT print sensitive account information unnecessarily.

Do NOT automatically delete users.

The designated current superadmin is:

```text
lineage.superadmin@gmail.com
```

Runtime authorization must remain UID/custom-claim based.

Email is only the bootstrap locator.

---

# 11. THERE MUST BE ONE CANONICAL SUPERADMIN SYSTEM

After investigation, consolidate the architecture.

There must NOT be:

```text
old superadmin system
+
new superadmin system
```

running independently.

There must be ONE canonical authorization model:

```text
Firebase Auth UID
+
trusted Firebase custom claim:
superAdmin: true
```

The backend must enforce it.

---

# 12. DO NOT REMOVE AN OLD SUPERADMIN CLAIM PREMATURELY

If another account currently has superadmin privileges:

first determine why.

Do not revoke it until:

```text
lineage.superadmin@gmail.com
```

has been successfully bootstrapped and verified.

Once the designated superadmin is working, classify the previous superadmin account as:

```text
LEGITIMATE SECOND ADMIN
LEGACY ADMIN
TEST ACCOUNT
UNKNOWN
```

If it is clearly obsolete and the product requirement is one superadmin only, remove its administrative claim safely.

Document the change.

Never delete its Firebase Auth account automatically unless explicitly necessary.

---

# 13. INVESTIGATE "PLATFORM APPROVALS"

Determine what **Platform Approvals** actually did.

It may have represented:

```text
account approval
payment verification
M-Pesa transaction approval
platform unlock
or a combination
```

Do not create a second dashboard before understanding it.

Trace:

```text
UI
API endpoints
database/Firestore fields
admin actions
approval state
payment state
```

---

# 14. INVESTIGATE CURRENT M-PESA APPROVAL SCREEN

The current pending screen visibly contains:

```text
ONE-TIME ACCOUNT UNLOCK

KES 500

SEND MONEY TO
254113245740

Enter M-PESA transaction code

Approval is completed manually.
```

Determine whether this payment/unlock flow is still an intended CURRENT product requirement.

Do NOT automatically remove it.

Do NOT automatically duplicate it.

---

# 15. SEPARATE PAYMENT STATE FROM ACCOUNT STATE

If M-Pesa/manual payment verification remains part of Lineage, do NOT overload one generic `approvalStatus` field with every concept.

Use conceptually separate states.

For example:

```text
accountStatus:
pending
approved
rejected
suspended
```

and if payment is still required:

```text
paymentStatus:
not_submitted
submitted
verified
rejected
```

Adapt names to the existing model.

This prevents ambiguous states.

---

# 16. DEFINE ONE CANONICAL APPROVAL WORKFLOW

After investigating the existing product behavior, establish ONE state machine.

If payment is required for account access, a possible flow may be:

```text
Firebase sign-in
      ↓
profile created
      ↓
accountStatus = pending
paymentStatus = not_submitted
      ↓
user submits transaction
      ↓
paymentStatus = submitted
      ↓
superadmin Platform Approvals
      ↓
verify payment
      ↓
paymentStatus = verified
accountStatus = approved
```

This is only an example.

Derive the actual intended workflow from repository evidence.

---

# 17. NO DUPLICATE APPROVAL DASHBOARDS

If:

```text
Platform Approvals
```

and:

```text
Pending Users
```

represent the same process, consolidate them.

Do NOT create:

```text
Superadmin Dashboard → Pending Users
```

and separately:

```text
Legacy Admin → Platform Approvals
```

for the same accounts.

Prefer one coherent Superadmin Dashboard.

Possible structure if both account and payment concepts remain:

```text
Dashboard
Users
  Pending
  Approved
  Rejected
  Suspended

Platform Approvals
  Payment submissions requiring verification

Audit Log
```

But only keep separate sections if they genuinely represent different business processes.

---

# 18. PRESERVE USEFUL LEGACY UI

If the old Platform Approvals interface is better or contains useful features:

reuse/refactor it.

Do NOT unnecessarily recreate the same interface from scratch.

Modernize it to use:

```text
Firebase Auth
Firestore
Firebase Functions
trusted custom claims
```

instead of old infrastructure.

---

# 19. ELIMINATE LEGACY AUTHORIZATION

Search active code for:

```text
hard-coded admin email
legacy admin boolean
localStorage admin role
client-side role assignment
PostgreSQL admin endpoint
old session role
```

None may remain as an authorization mechanism.

Frontend role checks may control presentation only.

Server/Rules must enforce permissions.

---

# 20. PHONE AUTH INCIDENT

A real phone-number registration attempt is currently failing.

The manually tested number was entered as:

```text
254113245740
```

For Firebase phone authentication, normalize this safely to:

```text
+254113245740
```

before calling:

```javascript
signInWithPhoneNumber(...)
```

Do NOT store the user's real number in test fixtures, source code, or logs.

---

# 21. KENYAN PHONE NORMALIZATION

Create/test a clear normalization helper.

For Kenya, acceptable input examples may include:

```text
0113245740
254113245740
+254113245740
```

Normalize valid variants to:

```text
+254113245740
```

Do not blindly prefix `+254` to every value.

Handle international country selection where supported.

Do not rewrite already valid non-Kenyan E.164 numbers.

---

# 22. PHONE INPUT UI

Prefer an explicit country selector or country-code context.

For example:

```text
Country
Kenya (+254)

Phone number
113 245 740
```

The value passed to Firebase must be normalized E.164.

Give the user a useful validation error before sending SMS if the number is obviously malformed.

---

# 23. PHONE AUTH — DO NOT ASSUME FORMATTING IS THE ROOT CAUSE

Instrument the phone flow carefully.

Capture the SAFE Firebase Auth error code returned by:

```text
signInWithPhoneNumber()
```

Potential problems to investigate include:

```text
invalid-phone-number
operation-not-allowed
app-not-authorized
captcha-check-failed
missing-phone-number
too-many-requests
quota-exceeded
network-request-failed
invalid-app-credential
```

Do not display raw internal errors to users.

Log safe diagnostic codes.

---

# 24. VERIFY PHONE PROVIDER

Confirm in Firebase project:

```text
family-tree-a4c4f
```

that:

```text
Authentication → Sign-in method → Phone
```

is enabled.

Do not blindly toggle settings.

Verify actual state.

---

# 25. VERIFY SMS REGION POLICY

This is CRITICAL.

Inspect Firebase Authentication settings:

```text
Authentication
→ Settings
→ SMS region policy
```

Determine whether:

```text
Kenya (KE)
```

is allowed.

Firebase projects may default to allowing no SMS regions until configured.

If Kenya is blocked, document the exact operator action required or configure it through supported tooling if safely possible.

Do not broaden the policy to the entire world unnecessarily.

Prefer the intended product regions.

Firebase documentation explicitly requires configuring SMS region policy for phone auth.

---

# 26. VERIFY CLOUD BILLING FOR REAL SMS

Check whether:

```text
family-tree-a4c4f
```

is linked to a Cloud Billing account.

Real Firebase Phone Auth SMS requires Cloud Billing.

If billing is missing, identify it clearly as the blocker.

Do NOT attempt to bypass billing or Firebase safeguards.

Firebase states that SMS service requires a linked Cloud Billing account.

---

# 27. VERIFY AUTHORIZED DOMAIN

Check:

```text
Authentication
→ Settings
→ Authorized domains
```

Production must include:

```text
family-tree-a4c4f.web.app
```

and any actual custom domain.

Phone auth relies on app/domain verification.

Do not authorize unnecessary domains.

---

# 28. VERIFY RECAPTCHA

Inspect the actual production implementation of:

```javascript
RecaptchaVerifier
```

Verify:

```text
correct Auth instance
correct button/container
initialization timing
no duplicate verifier instances
cleanup/reset
expiry handling
```

Invisible reCAPTCHA must work in production.

Do not disable app verification in production.

---

# 29. RECAPTCHA LIFECYCLE

A common implementation failure is retaining a broken verifier after a failed SMS attempt.

Implement safe lifecycle handling.

On failure:

```text
clear/reset verifier
allow retry
create a clean verifier when required
```

Do not create multiple invisible reCAPTCHA instances on repeated clicks.

---

# 30. TEST-ONLY PHONE BYPASS

Search:

```bash
git grep -n "appVerificationDisabledForTesting"
```

If present, ensure it can ONLY run against:

```text
Firebase Auth Emulator
or explicit development/test environment
```

Never in production.

---

# 31. PHONE AUTH ERROR UX

Replace generic errors with appropriate messages.

Examples:

```text
Please enter a valid phone number.

We couldn't verify this request. Please try again.

Too many verification attempts. Please try again later.

SMS verification isn't currently available for this region.

We couldn't send the code. Please try again.
```

Do not expose internal Firebase stack traces.

---

# 32. OTP SCREEN

After successful SMS send:

show a polished OTP screen.

Include:

```text
phone number masked appropriately
6-digit verification input
Verify
Resend code
Change number
```

Do not store OTP codes.

---

# 33. RESEND CONTROL

Prevent accidental SMS abuse.

Implement reasonable resend cooldown.

Do not repeatedly trigger:

```text
signInWithPhoneNumber()
```

from double-clicks.

Show countdown/state if useful.

---

# 34. PHONE AUTH AUTOMATED TESTING

Do NOT repeatedly use the real phone number during automated tests.

Use:

```text
Firebase Auth Emulator
```

and/or Firebase fictional test numbers.

Test:

```text
valid test number
correct OTP
wrong OTP
retry
pending profile creation
approval
logout
login
```

---

# 35. ONE CONTROLLED REAL PHONE SMOKE TEST

After local/emulator tests pass:

perform one controlled production test using the operator's real number.

Do not print the full number in logs.

Record only:

```text
PHONE AUTH PRODUCTION:
PASS / FAIL

Firebase error code:
<safe code if failed>
```

---

# 36. PHONE-FIRST PROFILE CREATION

A successful phone-auth user may have:

```text
phoneNumber
```

but no:

```text
email
displayName
```

Do not assume every account has email.

Ensure profile creation works.

If Lineage requires a name, prompt for it after phone verification.

---

# 37. GOOGLE/EMAIL/PHONE IDENTITY

Continue using:

```text
Firebase UID
```

as canonical identity.

Never use:

```text
email
phone number
Google email
```

as database ownership identifiers.

---

# 38. ACCOUNT APPROVAL AFTER PHONE SIGN-IN

Successful OTP verification must NOT bypass approval.

New phone user:

```text
Firebase authentication succeeds
→ profile created
→ accountStatus/pending
→ pending approval screen
```

unless the authenticated account is trusted superadmin.

---

# 39. FIX THE PENDING PAGE UX

Review the pending page visible in production.

Ensure:

```text
status clear
payment/approval instructions clear
logout works
errors shown in the correct context
```

The current:

```text
Request failed: 404
```

must not remain.

---

# 40. ERROR CONTEXT

Do not display unrelated errors inside the payment panel.

If logout fails:

show logout-specific feedback.

If payment submission fails:

show payment-specific feedback.

If phone sign-in fails:

show authentication-specific feedback.

Avoid one shared generic:

```text
Request failed
```

message for unrelated actions.

---

# 41. INVESTIGATE THE CURRENT 404 NETWORK RESPONSE

Use browser DevTools or automated browser where available.

Reproduce:

```text
pending user
→ click Log out
```

Capture:

```text
HTTP method
URL
status
request initiator
response
source file
```

Include this in incident documentation.

Expected after fix:

```text
no legacy logout network request
Firebase logout succeeds
```

unless Firebase itself legitimately performs its own Auth requests.

---

# 42. SUPERADMIN BOOTSTRAP VERIFICATION

Verify the intended superadmin UID has:

```text
superAdmin: true
```

and Firestore profile:

```text
role: superadmin
approvalStatus: approved
```

Do not include full UID in public logs unnecessarily.

---

# 43. SUPERADMIN DASHBOARD CONSOLIDATION

After investigating legacy Platform Approvals, produce one final navigation design.

For example, if payment verification remains required:

```text
Superadmin
├── Overview
├── Platform Approvals
├── Users
│   ├── Pending
│   ├── Approved
│   ├── Rejected
│   └── Suspended
└── Audit Log
```

But if Platform Approvals duplicates Pending Users:

merge them.

Do not maintain two screens that approve the same account in different ways.

---

# 44. APPROVAL SECURITY

Only the trusted custom claim may authorize:

```text
approve
reject
suspend
reactivate
verify payment
```

where applicable.

Test direct API calls from ordinary users.

Expected:

```text
403
```

---

# 45. OLD ADMIN SECURITY

If a previous account still has obsolete admin privileges:

document:

```text
UID
claim type
reason
```

privately/safely.

After the intended superadmin is verified, remove obsolete privileged claims if evidence shows they are no longer intended.

Do not delete the user account merely to remove privileges.

---

# 46. AUDIT LOG

All privileged actions should generate audit records:

```text
approve user
reject user
suspend user
reactivate user
verify/reject payment if applicable
```

Include:

```text
actorUid
targetUid
action
timestamp
previousStatus
newStatus
```

No secrets.

---

# 47. FIRESTORE RULES

Re-run Firestore Rules tests after approval consolidation.

Test:

```text
anonymous
pending
approved User A
approved User B
rejected
suspended
superadmin
```

Required:

```text
pending cannot access protected tree
rejected cannot access protected tree
suspended cannot access protected tree
A cannot access B private tree
ordinary user cannot mutate approval
superadmin privileged operations work through intended trusted architecture
```

---

# 48. STORAGE RULES

Test the same account statuses for Storage:

```text
pending denied
rejected denied
suspended denied
approved owner allowed
cross-user denied
```

---

# 49. FIREBASE FUNCTIONS AUTH TESTS

Test protected functions with:

```text
no token
invalid token
pending token
approved token
suspended token
normal user calling admin endpoint
superadmin token
```

No unauthorized operation may return 200.

---

# 50. RUN ALL EXISTING FIREBASE TESTS

Run:

```bash
npm test
npm run test:firebase
npm run test:firebase:rules
```

and Functions-specific tests.

Use Node 22 if that migration has already been completed or complete it if still pending.

Do not let obsolete PostgreSQL tests gate this fresh Firebase release.

---

# 51. ADD REGRESSION TEST FOR LOGOUT 404

Add an explicit test that proves:

```text
pending authenticated user
→ logout
→ Firebase signOut
→ no /api/auth/logout 404
→ unauthenticated UI
```

This bug must never silently return.

---

# 52. ADD PHONE NORMALIZATION TESTS

Test at minimum:

```text
+254113245740
254113245740
0113245740
```

All should normalize to the same E.164 number if valid.

Also test:

```text
empty input
letters
too-short number
malformed +
```

and reject invalid values.

Do not use the real number outside dedicated normalization fixtures if privacy-safe generic equivalents can be used.

Prefer fictional examples in committed tests.

---

# 53. PRODUCTION BUILD

After tests pass:

deploy:

```text
Functions
Hosting
Firestore Rules
Storage Rules
Firestore indexes if changed
```

to:

```text
family-tree-a4c4f
```

Do not deploy another project.

---

# 54. PRODUCTION LOGOUT TEST

Using a disposable pending user:

```text
login/signup
→ pending page
→ click Log out
```

Required:

```text
logout succeeds
login screen appears
404 does not appear
reload stays logged out
```

---

# 55. PRODUCTION PHONE TEST

After region/billing/domain/reCAPTCHA verification:

perform controlled phone auth test.

For the provided Kenyan test:

input variants should normalize safely to E.164.

Do not repeatedly trigger real SMS.

Record exact safe Firebase error code if unsuccessful.

Do not call the issue fixed until OTP can actually be sent and verified or an external provider/carrier limitation is conclusively identified.

---

# 56. PRODUCTION SUPERADMIN TEST

Sign in as the designated superadmin.

Verify:

```text
correct consolidated dashboard
no duplicate Platform Approval systems
pending users visible
approval works
reject works
suspend works
reactivate works
audit works
```

---

# 57. PRODUCTION NORMAL USER TEST

Create one disposable non-admin account.

Verify:

```text
new → pending
cannot access tree
superadmin approval
approved → access
logout
login
tree works
```

---

# 58. PRODUCTION NETWORK INSPECTION

During:

```text
phone auth
logout
approval
tree access
```

inspect Network.

Required:

```text
requests to Render = 0
requests to old lineage-api Cloud Run = 0
```

There must also be:

```text
no 404 logout request
```

---

# 59. PRODUCTION CONSOLE

Target:

```text
FIRST-PARTY APPLICATION ERRORS:
0
```

Do not count known extension-generated errors.

No:

```text
404 logout
Firebase auth initialization error
reCAPTCHA uncaught error
Functions 500
blank page
```

---

# 60. UPDATE DOCUMENTATION

Create/update:

```text
docs/AUTH_APPROVAL_INCIDENT_REPORT.md
docs/AUTH_AND_ACCESS_CONTROL.md
docs/FIREBASE_FRESH_LAUNCH_REPORT.md
docs/FIREBASE_FEATURE_PARITY_MATRIX.md
```

Document:

```text
logout root cause
logout fix
legacy Platform Approvals investigation
previous superadmin mechanism
final canonical superadmin mechanism
approval state model
payment relationship if retained
phone-auth root cause
phone normalization
SMS region policy
billing status
authorized domain
reCAPTCHA behavior
production test results
```

Do not include secrets or OTPs.

---

# 61. FINAL GIT SECURITY REVIEW

Run:

```bash
git status
git diff --stat
git diff
```

Search for:

```text
service-account private keys
Firebase Admin JSON
OTP codes
real passwords
payment secrets
DATABASE_URL
SESSION_SECRET
hard-coded superadmin authorization
real phone test credentials
```

None may be committed.

---

# 62. REQUIRED FINAL TERMINAL OUTPUT

Return:

```text
================================================================
LINEAGE — AUTH / APPROVAL / PHONE INCIDENT FINAL RESULT
================================================================

PRODUCTION:
https://family-tree-a4c4f.web.app/

---------------------------------------------------------------
LOGOUT INCIDENT
---------------------------------------------------------------

LOGOUT 404 ROOT CAUSE:
<exact cause>

BROKEN REQUEST:
<method + route or N/A>

FIREBASE signOut:
PASS / FAIL

PENDING USER LOGOUT:
PASS / FAIL

APPROVED USER LOGOUT:
PASS / FAIL

SUPERADMIN LOGOUT:
PASS / FAIL

404 AFTER LOGOUT:
0 / <number>

---------------------------------------------------------------
SUPERADMIN / APPROVAL CONSOLIDATION
---------------------------------------------------------------

DESIGNATED SUPERADMIN:
lineage.superadmin@gmail.com

SUPERADMIN AUTHORIZATION:
UID + CUSTOM CLAIM / OTHER

DESIGNATED CLAIM VERIFIED:
PASS / FAIL

LEGACY SUPERADMIN FOUND:
YES / NO

LEGACY SUPERADMIN STATUS:
RETAINED / PRIVILEGE REMOVED / N/A / NEEDS REVIEW

PLATFORM APPROVALS FOUND:
YES / NO

PLATFORM APPROVAL PURPOSE:
ACCOUNT / PAYMENT / BOTH / OTHER

DUPLICATE APPROVAL SYSTEM:
REMOVED / CONSOLIDATED / NONE FOUND

FINAL APPROVAL DASHBOARD:
<summary>

PENDING:
PASS / FAIL

APPROVE:
PASS / FAIL

REJECT:
PASS / FAIL

SUSPEND:
PASS / FAIL

REACTIVATE:
PASS / FAIL

AUDIT:
PASS / FAIL

---------------------------------------------------------------
PAYMENT / APPROVAL MODEL
---------------------------------------------------------------

M-PESA UNLOCK STILL REQUIRED:
YES / NO

ACCOUNT STATUS MODEL:
<summary>

PAYMENT STATUS MODEL:
<summary / N/A>

PAYMENT SUBMISSION:
PASS / FAIL / N/A

PLATFORM PAYMENT APPROVAL:
PASS / FAIL / N/A

---------------------------------------------------------------
PHONE AUTHENTICATION
---------------------------------------------------------------

PHONE PROVIDER:
ENABLED / DISABLED

INPUT NORMALIZATION:
PASS / FAIL

KENYA +254:
PASS / FAIL

SMS REGION POLICY:
KENYA ALLOWED / BLOCKED / UNKNOWN

CLOUD BILLING:
CONFIGURED / NOT CONFIGURED / UNKNOWN

AUTHORIZED DOMAIN:
PASS / FAIL

RECAPTCHA:
PASS / FAIL

REAL SMS SEND:
PASS / FAIL

REAL OTP:
PASS / FAIL

PHONE AUTH ROOT CAUSE:
<exact explanation>

SAFE FIREBASE ERROR CODE:
<code / none>

---------------------------------------------------------------
SECURITY
---------------------------------------------------------------

FIRESTORE RULES:
PASS / FAIL

STORAGE RULES:
PASS / FAIL

PENDING USER BLOCK:
PASS / FAIL

CROSS-USER ISOLATION:
PASS / FAIL

NON-SUPERADMIN ADMIN CALL:
DENIED / VULNERABLE

CLIENT ROLE FORGERY:
DENIED / VULNERABLE

---------------------------------------------------------------
PRODUCTION
---------------------------------------------------------------

DEPLOYMENT:
PASS / FAIL

PRODUCTION LOGOUT:
PASS / FAIL

PRODUCTION PHONE AUTH:
PASS / FAIL

PRODUCTION SUPERADMIN:
PASS / FAIL

FIRST-PARTY CONSOLE ERRORS:
<number>

REQUESTS TO RENDER:
<number>

REQUESTS TO OLD CLOUD RUN:
<number>

---------------------------------------------------------------
FINAL VERDICT
---------------------------------------------------------------

<state clearly whether logout, approval architecture,
superadmin consolidation, and phone authentication now work>

REMAINING ACTIONS:
1. ...
2. ...

================================================================
```

# FINAL SUCCESS STANDARD

Do NOT declare this incident resolved unless:

```text
pending-page logout no longer generates 404

Firebase signOut works from every account state

old Platform Approvals has been inspected

old and new superadmin systems are no longer competing

there is one canonical UID/custom-claim superadmin architecture

approval workflow is unambiguous

M-Pesa/payment approval is either intentionally integrated or intentionally removed

phone inputs normalize correctly

Kenya SMS region policy is correct

billing requirement is satisfied

authorized domain is correct

reCAPTCHA works

a controlled real phone OTP test works or an external carrier limitation is proven

all security tests pass

production has zero Render/old Cloud Run dependency
```

Do not solve these symptoms independently while leaving duplicate authorization logic behind.

The objective is one coherent Firebase authentication and approval system.