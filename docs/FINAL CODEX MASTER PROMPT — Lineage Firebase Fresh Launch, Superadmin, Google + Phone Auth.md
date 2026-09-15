# FINAL CODEX MASTER PROMPT

## LINEAGE — FIREBASE FRESH PRODUCTION LAUNCH, SUPERADMIN APPROVALS, GOOGLE + PHONE AUTH, COMPLETE TESTING & FINAL CUTOVER

Act as a principal Firebase architect, senior full-stack engineer, authentication/security engineer, UX engineer, Firestore architect, Firebase Functions engineer, Cloud Storage engineer, QA automation engineer, accessibility engineer, and production release engineer.

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

Firebase architecture is now the permanent architecture.

# IMPORTANT PRODUCT DECISION

We are STARTING FRESH on Firebase.

The old Render/PostgreSQL data is no longer required for this release.

DO NOT:

- attempt to recover the expired Render database;
- block release because historical PostgreSQL data is unavailable;
- migrate the partial Excel recovery artifact;
- recreate old PostgreSQL users;
- invent historical family-tree data;
- reconnect Render;
- recreate a PostgreSQL database;
- add `DATABASE_URL` back into the new runtime;
- use PostgreSQL for rollback;
- treat historical recovery as a release requirement.

The Firebase application starts with a clean production dataset.

Existing Firebase infrastructure must be preserved.

---

# 1. FINAL ARCHITECTURE

Lineage must run as:

```text
                         USERS
                           │
                           ▼
                  Firebase Hosting
                           │
             ┌─────────────┴─────────────┐
             │                           │
             ▼                           ▼
     Firebase Authentication      Firebase Functions
             │                           │
             │                  ┌────────┴────────┐
             │                  │                 │
             ▼                  ▼                 ▼
      Email/Password        Firestore          Storage
      Google Sign-In
      Phone Sign-In
```

Production must depend on:

```text
Firebase Hosting
Firebase Authentication
Cloud Firestore
Firebase Functions 2nd Gen
Cloud Storage for Firebase
Firestore Security Rules
Storage Security Rules
Firebase Admin SDK
```

Production must have ZERO runtime dependency on:

```text
Render
PostgreSQL
DATABASE_URL
connect-pg-simple
PostgreSQL sessions
express-session
old lineage-api Cloud Run backend
```

---

# 2. SUPERADMIN

The designated Lineage superadmin email is:

```text
lineage.superadmin@gmail.com
```

This account will:

- approve new users;
- reject user access;
- suspend/reactivate users;
- view pending registrations;
- manage user access;
- access the Superadmin Dashboard;
- view security-safe administrative audit history.

This is the ONLY bootstrap superadmin for now.

---

# 3. CRITICAL SUPERADMIN SECURITY RULE

DO NOT implement production superadmin authorization as:

```javascript
if (user.email === "lineage.superadmin@gmail.com")
```

That is allowed only during ONE-TIME BOOTSTRAP to locate the intended Firebase user.

Permanent authorization must be based on the Firebase Auth UID and a trusted custom claim assigned through Firebase Admin SDK.

Example intended claim:

```json
{
  "superAdmin": true
}
```

Superadmin access must ultimately require:

```text
valid Firebase ID token
+
superAdmin === true trusted custom claim
```

The browser may use the claim to show/hide UI.

The backend and Security Rules must enforce authorization independently.

Never trust the frontend alone.

---

# 4. BOOTSTRAP THE SUPERADMIN SAFELY

Create a one-time privileged script such as:

```text
scripts/bootstrap-superadmin.mjs
```

The script must:

1. use Firebase Admin SDK;
2. target project `family-tree-a4c4f`;
3. locate exactly:

```text
lineage.superadmin@gmail.com
```

4. retrieve its Firebase UID;
5. preserve any existing custom claims;
6. add:

```text
superAdmin: true
```

7. create/update the corresponding Firestore user profile;
8. set:

```text
role: "superadmin"
approvalStatus: "approved"
```

9. record safe audit metadata;
10. never print access tokens or private credentials.

If the Firebase Auth user does not yet exist:

DO NOT invent a password.

Instead report clearly that:

```text
lineage.superadmin@gmail.com
```

must sign into Lineage once through Google or another enabled legitimate provider, then rerun the bootstrap.

After bootstrap, runtime code must no longer use the email string as authorization.

---

# 5. SUPERADMIN CLAIM SAFETY

When setting the claim, preserve unrelated existing claims.

Do not accidentally replace claims with only:

```json
{"superAdmin": true}
```

if others already exist.

Read → merge → write.

After setting the claim, account for claim propagation.

The superadmin UI should force-refresh the current user's ID token when necessary:

```javascript
await currentUser.getIdToken(true)
```

Do not expose a public endpoint that can assign `superAdmin`.

No user, including ordinary admins if added later, may self-promote.

---

# 6. USER APPROVAL MODEL

Every new non-superadmin user should initially have:

```text
approvalStatus: "pending"
```

except where an explicit future product requirement says otherwise.

Suggested Firestore profile:

```text
users/{uid}
```

with appropriate fields such as:

```text
uid
displayName
email
phoneNumber
photoURL
providers
approvalStatus
role
createdAt
updatedAt
approvedAt
approvedBy
rejectedAt
rejectedBy
suspendedAt
suspendedBy
```

Use only fields actually needed by the product.

Do not store passwords.

Do not store OAuth tokens.

Do not store SMS codes.

---

# 7. APPROVAL STATES

Use a clear lifecycle.

Recommended:

```text
pending
approved
rejected
suspended
```

Meaning:

```text
pending
→ signed in successfully but awaiting access approval

approved
→ normal Lineage access

rejected
→ access denied with appropriate UI

suspended
→ previously approved account temporarily blocked
```

The superadmin account is permanently:

```text
approved
```

unless deliberately changed from a privileged administrative process.

---

# 8. AUTHENTICATION IS NOT APPROVAL

Firebase Authentication answers:

```text
Who is this user?
```

Lineage approval answers:

```text
May this user access Lineage?
```

A successfully authenticated ordinary user must NOT automatically gain access to the family-tree application.

Expected flow:

```text
Firebase Authentication succeeds
            ↓
load user profile
            ↓
approvalStatus
      ├── approved → app
      ├── pending → approval waiting screen
      ├── rejected → rejection screen
      └── suspended → suspension screen
```

Superadmin bypasses ordinary approval because the trusted claim grants administrative access.

---

# 9. ENFORCE APPROVAL SERVER-SIDE

Do not rely on UI visibility.

Every protected Firebase Function must perform:

```text
verify Firebase ID token
→ determine uid
→ check superAdmin claim
→ if not superadmin, check Firestore approvalStatus
→ continue only if approved
```

Pending/rejected/suspended users must receive controlled authorization responses.

Use appropriate HTTP statuses.

Do not return internal stack traces.

---

# 10. ENFORCE APPROVAL IN FIRESTORE RULES

Where clients access Firestore directly, Security Rules must prevent pending/rejected/suspended users from accessing protected Lineage data.

Create reusable rules logic conceptually similar to:

```text
signedIn()
approvedUser()
superAdmin()
```

A user should be able to access only the minimal profile/status information needed to display their own approval state before approval.

They must not access family-tree data while pending.

---

# 11. SUPERADMIN DASHBOARD

Build a polished Superadmin Dashboard.

It should include:

```text
Pending Users
Approved Users
Rejected Users
Suspended Users
```

Provide search/filter capability where useful.

Each account should show safe administrative information such as:

```text
display name
email
phone number if available
authentication provider(s)
registration date
current status
```

Never display:

```text
password
password hash
ID token
refresh token
SMS OTP
private provider credential
```

---

# 12. SUPERADMIN ACTIONS

Implement secure actions:

```text
Approve
Reject
Suspend
Reactivate
View user summary
```

Actions must call privileged Firebase Functions.

Do NOT let browsers update:

```text
approvalStatus
role
approvedBy
superAdmin
```

directly.

Functions must:

1. verify caller token;
2. require `superAdmin === true`;
3. validate target UID;
4. prevent unauthorized self-promotion;
5. perform Firestore transaction/write;
6. create audit log;
7. return safe result.

---

# 13. AUDIT LOG

Create a secure administrative audit log.

Possible structure:

```text
adminAuditLogs/{logId}
```

Record:

```text
action
targetUid
actorUid
timestamp
previousStatus
newStatus
safe metadata
```

Do not put tokens or secret data into logs.

Ordinary users must not be able to modify audit entries.

Prefer append-only admin writes.

---

# 14. FIREBASE AUTH PROVIDERS

The following authentication methods must be supported:

```text
1. Email + Password
2. Google Sign-In
3. Phone Number + OTP
```

The user has already enabled the Google and Phone providers in Firebase.

Verify configuration but do not unnecessarily toggle providers.

---

# 15. BEAUTIFUL AUTH EXPERIENCE

Redesign the authentication screens to feel polished, trustworthy, simple, and modern.

The design should fit Lineage as a family-history/family-tree product.

Desired feel:

```text
warm
clean
professional
calm
human
modern
premium but simple
```

Avoid:

```text
generic Firebase demo appearance
crowded forms
developer-looking controls
huge walls of text
overdone gradients
excessive animation
```

---

# 16. AUTH PAGE VISUAL STRUCTURE

Create a responsive authentication experience with strong hierarchy.

Desktop concept:

```text
┌─────────────────────────────────────────────────────────┐
│                                                         │
│      Brand / Lineage story      │   Auth card           │
│                                 │                       │
│      Lineage logo/name          │   Welcome back        │
│      short meaningful line      │                       │
│      subtle family visual       │   Google              │
│                                 │   Phone               │
│                                 │      OR               │
│                                 │   Email               │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

Mobile should become a clean single-column experience.

Do not sacrifice usability for decoration.

---

# 17. AUTH CARD

Auth card should support:

```text
Sign In
Create Account
Forgot Password
Phone Verification
OTP Entry
Pending Approval
Rejected
Suspended
```

Use consistent spacing, radius, typography, button heights, input states, and loading states.

---

# 18. GOOGLE SIGN-IN UI

Add a high-quality:

```text
Continue with Google
```

button.

Use appropriate Google visual conventions.

Do not fake Google branding.

Implement with Firebase:

```text
GoogleAuthProvider
```

Use appropriate:

```text
signInWithPopup
```

for suitable desktop flows and/or:

```text
signInWithRedirect
```

where redirect is more appropriate for mobile/browser behavior.

Handle:

```text
popup blocked
popup closed
network errors
account exists with different credential
provider collision
```

gracefully.

---

# 19. GOOGLE AUTH SECURITY

Do not request unnecessary Google OAuth scopes.

Basic authentication/profile information is sufficient unless an actual product feature needs additional access.

Never request:

```text
Google Drive
Contacts
Calendar
Gmail
```

just for signing in.

---

# 20. PHONE SIGN-IN UI

Create a dedicated polished phone flow.

Step 1:

```text
Enter phone number
```

Use E.164-compatible handling.

For Kenyan users provide a friendly UX such as:

```text
Country: Kenya (+254)
Phone: 7XXXXXXXX
```

but store/send the normalized number as:

```text
+254...
```

Do not incorrectly assume every user is Kenyan; retain country handling if practical.

---

# 21. PHONE OTP FLOW

Expected:

```text
enter phone
→ reCAPTCHA
→ send verification SMS
→ OTP entry
→ verify OTP
→ Firebase signed in
→ profile/approval bootstrap
```

Use Firebase:

```text
RecaptchaVerifier
signInWithPhoneNumber
confirmationResult.confirm(code)
```

Handle:

```text
invalid number
invalid OTP
expired OTP
SMS quota/throttling
network failure
reCAPTCHA expiry
resend cooldown
```

clearly.

---

# 22. PHONE AUTH ABUSE PROTECTION

DO NOT disable Firebase app verification in production.

Do NOT ship:

```javascript
appVerificationDisabledForTesting = true
```

in production.

Testing shortcuts may exist only inside explicit emulator/test configuration.

Never hardcode Firebase fictional test phone numbers into production UI.

---

# 23. SMS CONSENT

The phone sign-in UI should clearly inform users that:

```text
an SMS verification code will be sent
standard messaging rates may apply
```

Use concise copy.

Do not clutter the page.

---

# 24. PHONE AUTH REGION CONFIGURATION

Verify the Firebase Auth SMS region policy supports intended users.

Do not programmatically weaken the policy unnecessarily.

If the project restricts SMS regions, document the active policy.

---

# 25. AUTHORIZED DOMAINS

Verify Firebase Authentication authorized domains contain production domains such as:

```text
family-tree-a4c4f.web.app
```

and any actual custom production domain.

Do not add arbitrary domains.

---

# 26. PROVIDER ACCOUNT COLLISIONS

A single person may use:

```text
email/password
Google
phone
```

Do not create duplicate Lineage profiles carelessly.

Use Firebase UID as canonical identity.

When the SAME authenticated user explicitly adds another provider, use Firebase-supported provider linking where appropriate.

Do NOT merge two different Firebase UIDs merely because:

```text
emails look similar
names match
phone numbers look related
```

Account merges are security-sensitive.

---

# 27. ACCOUNT LINKING UX

Where safe and appropriate, add Account / Security settings allowing an authenticated user to see linked sign-in methods.

Possible:

```text
Password
Google
Phone
```

If provider linking is implemented, require the user to be authenticated first.

Never allow a pending unauthenticated identity to claim another account's data.

---

# 28. FIRST LOGIN PROFILE CREATION

For every auth method:

```text
Email
Google
Phone
```

ensure first successful authentication creates exactly one Firestore profile if one does not already exist.

Use an idempotent server-safe operation.

Example:

```text
users/{firebaseUid}
```

Do not create duplicates on each login.

---

# 29. PROFILE INFORMATION

Populate safe provider-derived values where available:

```text
displayName
email
phoneNumber
photoURL
providerIds
```

Do not blindly overwrite user-customized profile fields on every login.

Define which fields are:

```text
provider-sourced
user-editable
administrative
```

---

# 30. SUPERADMIN FIRST LOGIN

Ensure:

```text
lineage.superadmin@gmail.com
```

can sign in through the intended enabled provider.

Prefer Google Sign-In for this superadmin if that Google account exists.

After Firebase user creation, run the privileged bootstrap.

Then verify:

```text
superAdmin claim = true
approvalStatus = approved
role = superadmin
```

Force token refresh and test dashboard access.

---

# 31. SUPERADMIN MUST NOT BE PENDING

The bootstrap superadmin must never get trapped behind the pending approval screen.

However, do not implement that by client-side email checks.

Solve it with the server-set trusted claim/profile bootstrap.

---

# 32. NORMAL USER REGISTRATION

Test three new-user paths:

```text
Email/Password User
Google User
Phone User
```

Each must:

```text
authenticate successfully
create profile
receive approvalStatus=pending
see Pending Approval screen
NOT access family tree yet
```

---

# 33. SUPERADMIN APPROVAL TEST

Superadmin signs in.

Dashboard shows all three pending test users.

Approve each one.

After approval:

the user's next authorization/profile refresh must allow application access.

Do not require database manipulation or Firebase Console intervention.

---

# 34. REJECT TEST

Create disposable test account.

Superadmin rejects it.

Verify:

```text
user can authenticate
user cannot enter Lineage
rejection UI appears
protected APIs reject access
Firestore rules reject protected reads/writes
```

---

# 35. SUSPEND TEST

Approve disposable user.

Verify they can access Lineage.

Superadmin suspends the account at application level.

Verify:

```text
next protected operation denied
refresh shows suspended UI
tree access blocked
```

If choosing to also disable the Firebase Auth account, do so only if it improves the intended model and is implemented consistently.

Do not mix two suspension systems accidentally.

---

# 36. REACTIVATION TEST

Superadmin reactivates suspended user.

Verify access returns without corrupting data.

---

# 37. SUPERADMIN SECURITY TESTS

Prove:

```text
ordinary approved user cannot open admin dashboard
ordinary user cannot call approve endpoint
pending user cannot call approve endpoint
rejected user cannot call approve endpoint
suspended user cannot call approve endpoint
forged role in request body does nothing
changing localStorage does nothing
changing Firestore client payload does nothing
```

Only trusted superadmin token may perform administrative actions.

---

# 38. PROTECT SUPERADMIN ACCOUNT

Prevent normal user management operations from accidentally stripping the only superadmin claim.

If implementing superadmin-role mutation, do not allow the last remaining superadmin to demote itself accidentally.

For this release, simplest safe approach:

```text
no UI for changing superadmin
```

The bootstrap superadmin remains fixed.

---

# 39. FIRESTORE DATA MODEL

Review final Firestore structure.

Core:

```text
users/{uid}

trees/{treeId}

trees/{treeId}/persons/{personId}

trees/{treeId}/relationships/{relationshipId}

adminAuditLogs/{logId}
```

Add additional collections only when current product functionality needs them.

No PostgreSQL-shaped architecture merely for historical compatibility.

---

# 40. NEW FIREBASE DATA ONLY

Do not import:

```text
old Render users
old PostgreSQL trees
old relationships
partial recovery Excel
old sessions
old payments
```

Production starts fresh.

If old migration scripts exist, retain them under documentation/archive only where useful.

They must not run during deployment.

---

# 41. TREE ACCESS

Only:

```text
approved users
or superadmin where appropriate
```

may access tree functionality.

A normal user may access only trees they own or have explicit future sharing access to.

---

# 42. TREE CRUD

Complete and production-test:

```text
create tree
load tree
rename tree
delete tree if supported
```

Use Firestore.

No PostgreSQL compatibility route should be required.

---

# 43. PERSON CRUD

Complete:

```text
create
read
update
delete
```

Test actual browser UI.

Validate fields server-side where Functions handle writes.

---

# 44. RELATIONSHIPS

Support required relationships such as:

```text
parent-child
spouse
```

Ensure:

```text
person1 exists
person2 exists
same tree
caller authorized
relationship type valid
invalid self-link rejected
```

No dangling relationships after person deletion.

---

# 45. PHOTO STORAGE

Use Firebase Storage only.

Complete:

```text
upload
display
replace
delete
cleanup
```

Do not use:

```text
public/uploads
Render disk
Cloud Run disk
```

Validate:

```text
MIME
size
authorization
ownership
```

---

# 46. UX — PENDING APPROVAL SCREEN

Create a polished status screen.

Example content concept:

```text
Your account is being reviewed

Thanks for joining Lineage.
Your account has been created successfully and is awaiting approval.

We'll give you access once your account is approved.
```

Provide:

```text
Refresh Status
Sign Out
```

Optionally show authenticated identity safely.

Do not promise approval timing.

---

# 47. UX — REJECTED SCREEN

Make it clear and respectful.

Provide:

```text
account not approved
sign out
support/contact route if one exists
```

Do not expose internal admin comments unless intentionally designed.

---

# 48. UX — SUSPENDED SCREEN

Show:

```text
Your Lineage access is currently suspended.
```

Provide a safe next action.

Do not reveal security-sensitive reasons unless the product explicitly stores user-facing reasons.

---

# 49. UX — SUPERADMIN DASHBOARD DESIGN

Create a clean responsive admin experience.

Recommended desktop layout:

```text
Sidebar
  Dashboard
  Pending
  Users
  Audit Log

Main
  summary cards
  filters
  users table/cards
```

Summary cards may include:

```text
Pending
Approved
Suspended
Total Users
```

Use meaningful visual hierarchy.

Avoid unnecessarily flashy admin dashboards.

---

# 50. MOBILE ADMIN EXPERIENCE

Dashboard must remain usable on mobile.

Large tables should convert gracefully to:

```text
stacked cards
responsive rows
scroll-safe layouts
```

Important buttons must remain reachable.

---

# 51. ACCESSIBILITY

Authentication and admin UI must support:

```text
keyboard navigation
visible focus
semantic labels
screen-reader-friendly form fields
sufficient contrast
meaningful validation errors
touch-friendly controls
```

Do not communicate states by color alone.

---

# 52. RESPONSIVE DESIGN

Test:

```text
360px mobile
tablet
desktop
large desktop
```

No:

```text
horizontal overflow
clipped OTP inputs
offscreen modals
unreachable approval buttons
broken Google button
```

---

# 53. LOADING STATES

Add polished loading feedback for:

```text
Firebase initialization
Google sign-in
SMS send
OTP verification
email login
registration
approval
rejection
suspension
tree load
photo upload
```

Disable double-submit appropriately.

---

# 54. ERROR HANDLING

Translate technical Firebase errors into helpful messages.

Do not show users raw errors like:

```text
auth/invalid-credential
FirebaseError...
```

Log safe technical detail where useful.

User-facing text should be understandable.

---

# 55. BLANK-PAGE PREVENTION

Preserve previous boot-state protections.

Every startup must display one of:

```text
loading
login
app
pending approval
rejected
suspended
superadmin dashboard
recoverable error
```

Never a blank page.

---

# 56. NODE 22

Ensure Firebase Functions use:

```text
Node.js 22
```

Inspect:

```text
functions/package.json
firebase.json
```

Use a single canonical runtime declaration.

Run Functions tests under Node 22.

---

# 57. EMAIL/PASSWORD TESTING

Using Firebase Auth Emulator and then production disposable accounts, test:

```text
sign up
pending approval
approve
sign in
wrong password
password reset
logout
session persistence
```

---

# 58. GOOGLE SIGN-IN TESTING

Test:

```text
first Google sign-in
profile creation
pending state
superadmin approval
subsequent Google login
auth persistence
logout
popup/redirect failure handling
```

Use a disposable Google account for normal-user tests where practical.

Do not alter the superadmin account during destructive tests.

---

# 59. PHONE TESTING — DO NOT WASTE SMS

For automated/local testing:

use Firebase Auth Emulator and/or configured Firebase fictional phone numbers.

Do NOT send repeated real SMS messages during automated testing.

Test:

```text
valid number
OTP success
incorrect OTP
expired/invalid flow
resend
pending approval
approval
login again
```

Production smoke testing may use one controlled real phone flow if necessary.

---

# 60. RECAPTCHA TESTING

Verify production phone flow uses active Firebase app verification.

Test reCAPTCHA lifecycle.

Ensure test-only bypass cannot execute in production.

Search for:

```text
appVerificationDisabledForTesting
```

If present, confirm it is strictly test-only.

---

# 61. PROVIDER DUPLICATION TESTS

Test scenarios where practical:

```text
same person tries Google after email/password
existing Google user tries password flow
phone account exists separately
```

Do not automatically merge Firestore data across different UIDs.

If provider collision occurs:

show a safe account-linking/recovery message.

---

# 62. AUTH TOKEN TESTS

Protected Functions must reject:

```text
no token
malformed token
expired/invalid token
forged token
normal user on admin endpoint
pending user on protected app endpoint
```

Expected controlled:

```text
401
403
```

No 500.

---

# 63. SUPERADMIN FUNCTION TESTS

Test:

```text
list pending users
approve
reject
suspend
reactivate
```

Verify:

```text
audit record created
target status updated
actor UID recorded
timestamps correct
```

---

# 64. FIRESTORE RULE TESTS

Use Emulator Suite.

Required adversarial cases:

```text
anonymous
pending user
approved User A
approved User B
rejected user
suspended user
superadmin
```

Prove:

```text
A cannot access B's private tree
pending cannot access trees
rejected cannot access trees
suspended cannot access trees
superadmin admin actions work only through intended trusted paths
```

---

# 65. STORAGE RULE TESTS

Test:

```text
anonymous upload denied
pending upload denied
rejected upload denied
suspended upload denied
approved owner's upload allowed
cross-user upload denied
invalid MIME denied
oversize denied
```

---

# 66. THREE-GENERATION E2E TEST

With approved test User A:

create:

```text
Grandfather ─ Grandmother
          │
        Parent ─ Spouse
              │
            Child
```

Test:

```text
tree rendering
relationship persistence
person editing
photo upload
reload
logout
login
persistence
```

---

# 67. CROSS-USER TEST

Create approved User B.

Verify User B cannot read/write User A's:

```text
tree
people
relationships
photos
```

unless sharing is deliberately implemented.

---

# 68. SHARING

For this fresh release, determine whether sharing is CURRENT REQUIRED scope.

If it is not essential for launch:

mark:

```text
NOT APPLICABLE FOR CURRENT RELEASE
```

Do not block release for historical unfinished sharing unless the current product requires it.

If current, fully implement and test it.

Use the same approach for:

```text
payments
memories
evidence
import
export
```

Do not carry old migration-era FAIL statuses forward blindly.

---

# 69. FEATURE PARITY REBASE

Because we are STARTING FRESH, redefine feature parity against the intended Firebase product, NOT the old Render implementation.

Create/update:

```text
docs/FIREBASE_FEATURE_PARITY_MATRIX.md
```

Classify each feature:

```text
REQUIRED FOR FRESH RELEASE
PLANNED LATER
NOT APPLICABLE
PASS
FAIL
```

Only required fresh-release features block production.

---

# 70. REQUIRED FRESH-RELEASE FEATURES

At minimum release must have:

```text
Email/password authentication
Google authentication
Phone authentication
Superadmin bootstrap
Superadmin dashboard
Pending approval
Approve
Reject
Suspend/reactivate
Auth persistence
Password reset
Tree create/load/rename
Person CRUD
Relationships
Photo upload
Security Rules
Cross-user isolation
Responsive UI
Blank-page recovery
```

If additional current product functionality is already mature, preserve it.

---

# 71. DO NOT LET OLD DATA BLOCK RELEASE

Delete/rewrite documentation language such as:

```text
migration blocked because PostgreSQL unavailable
rollback requires Render
zero-data-loss migration incomplete
```

That is no longer the product decision.

Replace with:

```text
Lineage launched as a fresh Firebase-native deployment.
Historical Render/PostgreSQL data was intentionally not migrated.
```

Do not claim it was recovered.

---

# 72. LEGACY CODE

Legacy PostgreSQL code may remain temporarily under:

```text
legacy/
```

or historical Git commits if needed.

But it must NOT participate in:

```text
frontend runtime
Firebase Functions runtime
firebase.json rewrites
deployment
tests required for Firebase release
```

---

# 73. LEGACY TESTS

PostgreSQL integration tests must not gate this Firebase release.

Retain/archive them only if useful historically.

The release test must concern the new Firebase architecture.

---

# 74. FIREBASE RELEASE TEST COMMAND

Create/maintain:

```bash
npm run test:firebase
```

and:

```bash
npm run test:firebase:rules
```

or an equivalent deterministic suite.

It should exercise:

```text
Auth
approval
superadmin
Functions
Firestore
Storage
Rules
tree CRUD
relationships
cross-user security
```

---

# 75. AUTH E2E TEST MATRIX

Produce automated/manual test matrix:

| Flow | Emulator | Production |
|---|---:|---:|
| Email signup | PASS/FAIL | PASS/FAIL |
| Email login | PASS/FAIL | PASS/FAIL |
| Google login | PASS/FAIL/N/A | PASS/FAIL |
| Phone login | PASS/FAIL | PASS/FAIL |
| Pending status | PASS/FAIL | PASS/FAIL |
| Superadmin approval | PASS/FAIL | PASS/FAIL |
| Reject | PASS/FAIL | PASS/FAIL |
| Suspend | PASS/FAIL | PASS/FAIL |
| Reactivate | PASS/FAIL | PASS/FAIL |
| Password reset | PASS/FAIL | PASS/FAIL |
| Persistence | PASS/FAIL | PASS/FAIL |

---

# 76. PRODUCTION CLEANUP AFTER TESTS

Disposable test accounts/data must be clearly identifiable.

After tests:

remove disposable:

```text
test trees
test persons
test relationships
test photos
```

where safe.

Do NOT delete:

```text
lineage.superadmin@gmail.com
```

or its superadmin profile/claim.

Do not leave test phone numbers or fake users mixed with genuine production users unnecessarily.

---

# 77. DEPLOYMENT PRE-FLIGHT

Before production deployment require:

```text
Node 22 PASS

Web config PASS

Auth providers verified

Superadmin claim PASS

Firestore PASS

Storage PASS

Functions PASS

Firestore Rules PASS

Storage Rules PASS

Auth tests PASS

Approval tests PASS

Superadmin tests PASS

Cross-user tests PASS

Tree CRUD PASS

Relationships PASS

Photo flow PASS

UI responsive PASS

First-party console errors locally = 0
```

---

# 78. DEPLOY

Deploy the appropriate Firebase resources to:

```text
family-tree-a4c4f
```

including as applicable:

```text
Functions
Hosting
Firestore Rules
Firestore indexes
Storage Rules
```

Do not deploy to another Firebase project.

---

# 79. PRODUCTION SUPERADMIN TEST

Sign into production with:

```text
lineage.superadmin@gmail.com
```

Verify:

```text
authentication works
superAdmin claim recognized
superadmin dashboard opens
pending users visible
approval action works
audit log records action
```

Do not reveal private tokens.

---

# 80. PRODUCTION EMAIL USER TEST

Create disposable email/password user.

Verify:

```text
register
pending
superadmin approves
access granted
tree works
logout
login
```

---

# 81. PRODUCTION GOOGLE USER TEST

Create disposable Google-auth user.

Verify:

```text
Google sign-in
pending
superadmin approval
access granted
logout
Google sign-in again
```

---

# 82. PRODUCTION PHONE USER TEST

Use a controlled phone testing approach.

Verify:

```text
phone input
reCAPTCHA
SMS/OTP
authentication
pending
superadmin approval
access granted
logout
login again
```

Avoid excessive SMS traffic.

---

# 83. PRODUCTION TREE TEST

Using an approved disposable user:

```text
create tree
rename tree
create people
create relationships
upload photo
reload
edit
delete
logout
login
verify persistence
```

---

# 84. PRODUCTION SECURITY TEST

Use two disposable approved production users.

Verify cross-user access is denied.

Also verify pending user cannot bypass approval using:

```text
direct API request
direct Firestore request
URL manipulation
manually supplied IDs
```

---

# 85. NETWORK INSPECTION

During production:

```text
login
approval
tree CRUD
photo upload
logout
```

inspect browser Network.

Required:

```text
requests to Render = 0

requests to old lineage-api Cloud Run = 0
```

Firebase/Google endpoints are expected.

---

# 86. CONSOLE INSPECTION

Using clean browser profile:

target:

```text
FIRST-PARTY APPLICATION ERRORS = 0
```

No:

```text
blank page
/api/auth/session 500
Functions 500
Firebase initialization error
valid Firestore permission error
valid Storage permission error
uncaught auth promise
```

---

# 87. RETIRE OLD INFRASTRUCTURE

Once production Firebase passes every required release gate and:

```text
Render traffic = 0
Cloud Run lineage-api traffic = 0
PostgreSQL dependency = 0
```

the old runtime is no longer required.

Because we are intentionally starting fresh, do not retain old Render/PostgreSQL infrastructure as a data rollback dependency.

Document:

```text
Render/PostgreSQL historical recovery intentionally closed.
```

If credentials permit, retire obsolete Cloud Run routing/services safely after recording their previous configuration.

Do not delete Git history.

---

# 88. README

Update `README.md` for fresh Firebase development.

Document:

```text
Firebase Auth
Email sign-in
Google sign-in
Phone sign-in
Emulators
Firestore
Functions
Storage
superadmin bootstrap
approval workflow
tests
deployment
```

Do not instruct developers to configure Render/PostgreSQL.

---

# 89. SECURITY DOCUMENTATION

Create/update:

```text
docs/AUTH_AND_ACCESS_CONTROL.md
```

Explain:

```text
authentication methods
superadmin bootstrap
custom claims
approval statuses
authorization
Firestore Rules
Storage Rules
audit logs
provider linking policy
phone auth/reCAPTCHA
```

Do not include secrets.

---

# 90. SUPERADMIN DOCUMENTATION

Document clearly:

```text
Bootstrap superadmin email:
lineage.superadmin@gmail.com
```

But state:

```text
Email is only the bootstrap locator.
Firebase UID + trusted custom claim is the runtime authority.
```

Include exact bootstrap command.

---

# 91. FINAL UX REVIEW

Review:

```text
auth page
Google button
phone flow
OTP screen
pending screen
rejected screen
suspended screen
superadmin dashboard
normal Lineage dashboard
mobile layout
```

Fix obvious UI defects before declaring completion.

---

# 92. FINAL GIT REVIEW

Run:

```bash
git status
git diff --stat
git diff
```

Check for:

```text
Firebase Admin keys
service account JSON
tokens
SMS test secrets
real passwords
private keys
database URLs
M-Pesa secrets
```

None may be committed.

---

# 93. FINAL TESTS

Run all applicable tests.

At minimum:

```text
npm test
npm run test:firebase
npm run test:firebase:rules
```

Functions tests.

Syntax/build checks.

Emulator Suite.

Browser E2E.

Production smoke tests.

Do not mark PASS for anything that was not actually executed.

---

# 94. RELEASE BLOCKERS

Only these kinds of failures may block the final release:

```text
authentication broken
superadmin unauthorized
ordinary user can self-approve
approval bypass
cross-user data leak
Firestore Rules failure
Storage Rules failure
Functions auth failure
Google sign-in broken
phone auth broken
tree CRUD broken
photo flow broken
production deployment failure
first-party production 500
```

Historical PostgreSQL recovery is NOT a release blocker.

---

# 95. REQUIRED FINAL TERMINAL OUTPUT

Return:

```text
================================================================
LINEAGE — FRESH FIREBASE PRODUCTION RELEASE
================================================================

STATUS:
COMPLETE / PARTIAL / BLOCKED

PROJECT:
family-tree-a4c4f

PRODUCTION:
https://family-tree-a4c4f.web.app/

---------------------------------------------------------------
SUPERADMIN
---------------------------------------------------------------

BOOTSTRAP EMAIL:
lineage.superadmin@gmail.com

FIREBASE UID:
<uid or safely abbreviated identifier>

SUPERADMIN CLAIM:
PASS / FAIL

SUPERADMIN PROFILE:
PASS / FAIL

SUPERADMIN LOGIN:
PASS / FAIL

SUPERADMIN DASHBOARD:
PASS / FAIL

PENDING USER LIST:
PASS / FAIL

APPROVE:
PASS / FAIL

REJECT:
PASS / FAIL

SUSPEND:
PASS / FAIL

REACTIVATE:
PASS / FAIL

ADMIN AUDIT LOG:
PASS / FAIL

---------------------------------------------------------------
AUTHENTICATION
---------------------------------------------------------------

EMAIL/PASSWORD:
PASS / FAIL

GOOGLE SIGN-IN:
PASS / FAIL

PHONE SIGN-IN:
PASS / FAIL

PHONE RECAPTCHA:
PASS / FAIL

OTP:
PASS / FAIL

AUTH PERSISTENCE:
PASS / FAIL

LOGOUT:
PASS / FAIL

PASSWORD RESET:
PASS / FAIL

EMAIL VERIFICATION:
PASS / FAIL / N/A

PROVIDER COLLISION HANDLING:
PASS / FAIL

---------------------------------------------------------------
APPROVAL WORKFLOW
---------------------------------------------------------------

NEW USER DEFAULT PENDING:
PASS / FAIL

PENDING USER BLOCKED FROM APP:
PASS / FAIL

APPROVED USER ACCESS:
PASS / FAIL

REJECTED USER BLOCKED:
PASS / FAIL

SUSPENDED USER BLOCKED:
PASS / FAIL

REACTIVATED USER ACCESS:
PASS / FAIL

CLIENT-SIDE APPROVAL BYPASS:
DENIED / VULNERABLE

DIRECT API APPROVAL BYPASS:
DENIED / VULNERABLE

---------------------------------------------------------------
FIREBASE
---------------------------------------------------------------

HOSTING:
PASS / FAIL

FIRESTORE:
PASS / FAIL

FUNCTIONS:
PASS / FAIL

FUNCTIONS NODE:
22 / OTHER

STORAGE:
PASS / FAIL

FIRESTORE RULES:
PASS / FAIL

STORAGE RULES:
PASS / FAIL

FUNCTION AUTH:
PASS / FAIL

---------------------------------------------------------------
LINEAGE CORE
---------------------------------------------------------------

TREE CREATE:
PASS / FAIL

TREE LOAD:
PASS / FAIL

TREE RENAME:
PASS / FAIL

PERSON CREATE:
PASS / FAIL

PERSON READ:
PASS / FAIL

PERSON UPDATE:
PASS / FAIL

PERSON DELETE:
PASS / FAIL

RELATIONSHIP CREATE:
PASS / FAIL

RELATIONSHIP DELETE:
PASS / FAIL

GRAPH PERSISTENCE:
PASS / FAIL

PHOTO UPLOAD:
PASS / FAIL

PHOTO DISPLAY:
PASS / FAIL

PHOTO REPLACE:
PASS / FAIL

PHOTO DELETE:
PASS / FAIL

---------------------------------------------------------------
SECURITY
---------------------------------------------------------------

ANONYMOUS ACCESS:
DENIED / VULNERABLE

PENDING USER TREE ACCESS:
DENIED / VULNERABLE

REJECTED USER TREE ACCESS:
DENIED / VULNERABLE

SUSPENDED USER TREE ACCESS:
DENIED / VULNERABLE

CROSS-USER FIRESTORE ACCESS:
DENIED / VULNERABLE

CROSS-USER STORAGE ACCESS:
DENIED / VULNERABLE

NON-SUPERADMIN ADMIN ACTION:
DENIED / VULNERABLE

SUPERADMIN SELF-BOOTSTRAP FROM CLIENT:
DENIED / VULNERABLE

---------------------------------------------------------------
UX
---------------------------------------------------------------

DESKTOP AUTH UI:
PASS / FAIL

MOBILE AUTH UI:
PASS / FAIL

GOOGLE UI:
PASS / FAIL

PHONE/OTP UI:
PASS / FAIL

PENDING UI:
PASS / FAIL

REJECTED UI:
PASS / FAIL

SUSPENDED UI:
PASS / FAIL

SUPERADMIN UI:
PASS / FAIL

ACCESSIBILITY:
PASS / FAIL

BLANK-PAGE RECOVERY:
PASS / FAIL

---------------------------------------------------------------
TESTING
---------------------------------------------------------------

UNIT TESTS:
PASS / FAIL

FIREBASE TESTS:
PASS / FAIL

RULE TESTS:
PASS / FAIL

EMULATOR SUITE:
PASS / FAIL

THREE-GENERATION E2E:
PASS / FAIL

TWO-USER E2E:
PASS / FAIL

SUPERADMIN E2E:
PASS / FAIL

GOOGLE AUTH PRODUCTION TEST:
PASS / FAIL

PHONE AUTH PRODUCTION TEST:
PASS / FAIL

---------------------------------------------------------------
PRODUCTION
---------------------------------------------------------------

DEPLOYMENT:
PASS / FAIL

PRODUCTION SMOKE TEST:
PASS / FAIL

FIRST-PARTY CONSOLE ERRORS:
<number>

REQUESTS TO RENDER:
<number>

REQUESTS TO OLD CLOUD RUN:
<number>

---------------------------------------------------------------
LEGACY INFRASTRUCTURE
---------------------------------------------------------------

POSTGRESQL PRODUCTION DEPENDENCY:
ZERO / REMAINS

RENDER PRODUCTION DEPENDENCY:
ZERO / REMAINS

DATABASE_URL REQUIRED:
NO / YES

EXPRESS SESSION REQUIRED:
NO / YES

OLD CLOUD RUN REQUIRED:
NO / YES

---------------------------------------------------------------
FRESH START
---------------------------------------------------------------

HISTORICAL RENDER DATA MIGRATION:
NOT REQUIRED BY PRODUCT DECISION

HISTORICAL POSTGRESQL RECOVERY:
CLOSED

PARTIAL EXCEL IMPORT:
NOT PERFORMED

PRODUCTION DATA MODEL:
FRESH FIREBASE DATA

---------------------------------------------------------------
FINAL VERDICT
---------------------------------------------------------------

<state clearly whether Lineage is now ready for real users>

SECURITY VERDICT:
<state whether superadmin, approval workflow, provider auth,
Firestore, Storage and cross-user isolation passed>

LEGACY VERDICT:
<state whether Render/PostgreSQL/old Cloud Run are completely
unnecessary>

REMAINING ACTIONS:
1. ...
2. ...

================================================================
```

# FINAL SUCCESS STANDARD

Do not declare Lineage ready merely because Firebase deployed.

The release is complete only if:

```text
lineage.superadmin@gmail.com is securely bootstrapped

superadmin uses trusted custom claim authorization

ordinary users cannot self-approve

email/password works

Google Sign-In works

phone + OTP works

reCAPTCHA/app verification works

new users become pending

superadmin can approve/reject/suspend/reactivate

approved users can use Lineage

pending/rejected/suspended users cannot bypass restrictions

Firestore Rules pass

Storage Rules pass

cross-user isolation passes

tree CRUD works

relationships work

photo upload works

responsive UI is polished

production deployment works

first-party production errors = 0

Render requests = 0

old Cloud Run requests = 0

PostgreSQL dependency = 0
```

The intended final result is:

# LINEAGE IS A FRESH, SECURE, FIREBASE-NATIVE APPLICATION.

Users may register with Email/Password, Google, or Phone.

New users wait for approval.

`lineage.superadmin@gmail.com` securely approves access through the Superadmin Dashboard.

Render and PostgreSQL are no longer part of Lineage.