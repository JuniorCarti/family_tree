# CODEX FINAL MASTER PROMPT

## LINEAGE / FAMILY TREE — COMPLETE FIREBASE PRODUCTION CUTOVER

Act as a principal Firebase architect, senior full-stack engineer, production release engineer, authentication engineer, Firestore security specialist, Cloud Storage engineer, QA engineer, and reliability engineer.

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

The architectural migration has already been performed substantially.

DO NOT restart the migration.

DO NOT redesign the application.

DO NOT migrate back to PostgreSQL.

DO NOT reconnect Render.

DO NOT return another broad architecture assessment.

The user has now manually completed the previously blocking Firebase Console actions:

```text
Firebase Web App:
REGISTERED

Firebase Storage:
INITIALIZED / CONNECTED
```

Therefore previous blockers relating to:

```text
no Firebase Web App
missing Firebase Web configuration
Firebase Management API HTTP 429
Firebase Storage not initialized
```

must now be considered potentially resolved.

Your task is to inspect the current Firebase project, retrieve the real configuration, finish all remaining Firebase integration, complete required feature parity, deploy production, test production thoroughly, and determine whether the legacy Cloud Run service can finally be retired.

---

# 1. FINAL OBJECTIVE

The final Lineage architecture must be:

```text
                         USERS
                           │
                           ▼
                  Firebase Hosting
                           │
               ┌───────────┴───────────┐
               │                       │
               ▼                       ▼
       Firebase Authentication    Firebase Functions
                                       │
                              ┌────────┴────────┐
                              │                 │
                              ▼                 ▼
                         Cloud Firestore   Cloud Storage
```

The final production runtime must have:

```text
Firebase Hosting
Firebase Authentication
Cloud Firestore
Firebase Functions 2nd Gen
Cloud Storage for Firebase
Firebase Security Rules
```

The final production runtime must have ZERO dependency on:

```text
Render
Render PostgreSQL
PostgreSQL
DATABASE_URL
connect-pg-simple
PostgreSQL sessions
express-session
old lineage-api Cloud Run backend
```

Legacy code may remain for historical/audit purposes only if it cannot affect the Firebase runtime.

---

# 2. CURRENT VERIFIED FOUNDATION

Previous passes established:

```text
Firebase project:
family-tree-a4c4f

Firestore:
(default)
Native mode
us-central1

Functions region:
us-central1

Firestore Rules:
deployed

Firestore adversarial tests:
PASS

Storage adversarial tests:
PASS locally

Two-user isolation:
PASS

Firebase Emulator Suite:
PASS

Java:
Temurin JDK 21

Tree CRUD backend:
implemented

Relationship validation:
implemented

Photo Storage bridge:
partially implemented

PostgreSQL dependency:
ZERO in new Firebase Functions runtime

Render dependency:
ZERO in new Firebase architecture

Legacy Cloud Run lineage-api:
retained temporarily
```

The user has now additionally confirmed:

```text
Firebase Web App:
REGISTERED

Firebase Storage:
INITIALIZED / CONNECTED
```

Verify both from tooling before proceeding.

---

# 3. START BY VERIFYING ACTUAL CURRENT STATE

Run:

```bash
git status
git branch --show-current
git log --oneline --decorate -20

firebase --version
firebase use
firebase projects:list
```

Confirm active project:

```text
family-tree-a4c4f
```

Inspect registered Firebase Apps.

Determine the actual registered Web App.

Do not create another Web App.

Record:

```text
WEB APP DISPLAY NAME:
APP ID:
PROJECT ID:
AUTH DOMAIN:
STORAGE BUCKET:
```

Do not expose private credentials because none should be required for Web configuration.

---

# 4. RETRIEVE THE REAL FIREBASE WEB CONFIGURATION

Retrieve the official Web App configuration from the registered Firebase application.

Required fields should include the actual values for:

```text
apiKey
authDomain
projectId
storageBucket
messagingSenderId
appId
```

Possibly:

```text
measurementId
```

if Analytics is enabled.

Do not invent or guess values.

Do not manually construct identifiers if official tooling can provide them.

Do not confuse Firebase Web configuration with Firebase Admin secrets.

Firebase Web configuration may be used by browser code.

Never place in frontend:

```text
service-account JSON
private key
Admin SDK secret
SMTP password
M-Pesa secret
payment API secret
```

---

# 5. VERIFY FIREBASE STORAGE

Inspect the Storage setup now configured by the user.

Determine:

```text
default bucket
additional buckets
bucket location
Firebase Storage status
rules deployment target
```

Previous work discovered:

```text
family-tree-a4c4f-media
```

in:

```text
US-CENTRAL1
```

Determine whether this is now:

```text
the Firebase default bucket
an imported Firebase bucket
a secondary Firebase Storage bucket
or an unrelated GCS bucket
```

Use the actual configured bucket in the client.

Do not create unnecessary duplicate buckets.

---

# 6. VERIFY STORAGE ACCESS MODEL

If using:

```text
gs://family-tree-a4c4f-media
```

explicitly, ensure the Firebase Web SDK is initialized against the correct bucket.

Conceptually:

```javascript
getStorage(app, "gs://family-tree-a4c4f-media")
```

only if that is truly the configured bucket.

Otherwise use:

```javascript
getStorage(app)
```

with the official `storageBucket` config.

Do not hard-code obsolete bucket names.

---

# 7. COMPLETE FIREBASE CLIENT CONFIGURATION

Inspect the existing modular Firebase bridge.

Update it to use the official production Web configuration.

Prefer a clean structure such as:

```text
public/firebase-config.js
public/firebase-client.js
```

or the architecture already created.

Support two explicit environments:

```text
development/emulator
production
```

Development must connect to:

```text
Auth Emulator
Firestore Emulator
Functions Emulator
Storage Emulator
```

Production must connect only to real Firebase services.

Do not accidentally deploy emulator hostnames.

---

# 8. COMPLETE FIREBASE AUTHENTICATION

Firebase Authentication now becomes the sole production identity system.

Complete and test:

```text
register
login
logout
authentication persistence
password reset
email verification if required
auth-state restoration
```

Use:

```javascript
onAuthStateChanged()
```

or the appropriate current Firebase mechanism.

Remove runtime dependence on:

```text
express-session
PostgreSQL session records
SESSION_SECRET
__session
legacy login sessions
```

---

# 9. BOOT SEQUENCE

The application initialization flow must become:

```text
browser opens
↓
Firebase initializes
↓
Firebase Auth initializes
↓
wait for initial auth state
│
├── authenticated
│      ↓
│   load application
│
├── unauthenticated
│      ↓
│   display login/register
│
└── initialization failure
       ↓
    display recovery UI + Retry
```

There must never be an unexplained blank screen.

Preserve the previously implemented blank-page recovery behavior.

---

# 10. COMPLETE REGISTER FLOW

Wire actual registration UI to Firebase Authentication.

After account creation:

create the corresponding Firestore user/profile document where needed.

Derive ownership from:

```text
Firebase uid
```

Do not create a second independent application user ID unnecessarily.

If approval is required, registration may create:

```text
accountStatus: pending
```

but authentication and application approval must remain separate.

---

# 11. COMPLETE LOGIN FLOW

Use Firebase email/password authentication or the currently intended provider.

On successful login:

```text
Firebase Auth
→ valid user
→ application profile lookup
→ approval checks if required
→ tree/application load
```

Translate Firebase Auth errors into clear user-facing messages.

Do not expose internal Firebase error dumps directly to users.

---

# 12. AUTH PERSISTENCE

Prove:

```text
login
→ refresh page
→ still authenticated
```

within expected Firebase Auth behavior.

Also prove:

```text
logout
→ refresh
→ remains logged out
```

---

# 13. PASSWORD RESET

Use Firebase Authentication password-reset flow.

Remove or disable any legacy insecure reset route that allows password replacement without proper token verification.

Test actual UI.

---

# 14. EMAIL VERIFICATION

Determine whether the current intended Lineage product requires verified email.

If YES:

implement:

```text
send verification
resend verification
refresh user
detect verified state
```

If NO:

mark:

```text
EMAIL VERIFICATION:
NOT APPLICABLE
```

with repository evidence.

Do not leave it indefinitely incomplete.

---

# 15. CENTRAL AUTHENTICATED API CLIENT

Use one central browser API helper.

Conceptually:

```javascript
async function api(path, options = {}) {
  const user = auth.currentUser;

  if (!user) {
    throw new Error("Authentication required");
  }

  const token = await user.getIdToken();

  return fetch(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
}
```

Adapt to existing code.

Do not duplicate token handling across every feature.

---

# 16. FUNCTIONS AUTHENTICATION

Every protected Functions route must verify:

```text
Authorization: Bearer <Firebase ID token>
```

using Firebase Admin SDK.

Use:

```text
decodedToken.uid
```

as canonical user identity.

Never authorize from:

```text
req.body.userId
query.userId
frontend-supplied ownerUid
frontend role flag
```

---

# 17. COMPLETE TREE BROWSER INTEGRATION

Backend-only implementation does not count.

Connect actual frontend screens to Firebase-backed Functions/Firestore.

Test through the browser:

```text
create tree
load tree
rename tree
reload
```

Data must persist.

---

# 18. COMPLETE PERSON CRUD

Through the actual UI test:

```text
create person
view person
edit person
delete person
```

Verify all intended fields.

Examples may include:

```text
first name
middle name
last name
maiden name
gender
birth date
death date
birth place
death place
notes
photo
```

Only preserve fields actually supported by Lineage.

---

# 19. COMPLETE RELATIONSHIP CRUD

Support intended graph relationships.

At minimum where applicable:

```text
parent-child
spouse
```

Server-side validation must guarantee:

```text
person1 exists
person2 exists
same tree
authorized user
valid relationship type
no invalid self-link
```

Where duplicate edges are invalid, reject duplicates.

---

# 20. PERSON DELETE SAFETY

Firestore has no SQL foreign-key cascade.

When deleting a person:

handle associated relationships safely.

Use:

```text
batch writes
transactions
controlled recursive cleanup
```

as appropriate.

Also handle related Storage photos.

Do not leave dangling relationship documents.

---

# 21. COMPLETE PHOTO UPLOAD END-TO-END

Now that Firebase Storage is initialized, complete the production-ready flow.

Required:

```text
select image
↓
client validation
↓
Firebase Storage upload
↓
secure object path
↓
Firestore photo metadata
↓
display image
```

Implement:

```text
upload
display
replace
delete
person-delete cleanup
```

Do not store image binaries in Firestore.

Do not use:

```text
public/uploads
Render filesystem
Cloud Run filesystem
```

---

# 22. PHOTO SECURITY

Verify:

```text
anonymous upload denied
cross-user upload denied
wrong-tree upload denied
authorized upload allowed
invalid MIME denied
oversized file denied where rule/app enforcement applies
```

Re-run tests against emulator after final Storage implementation changes.

---

# 23. FULL FEATURE PARITY REVIEW

Open:

```text
docs/FIREBASE_FEATURE_PARITY_MATRIX.md
```

Resolve every remaining feature.

No feature may remain merely:

```text
PENDING
PARTIAL
NOT COMPLETE
IMPLEMENTED BUT UNTESTED
```

Final states must be:

```text
PASS
FAIL
NOT APPLICABLE
BLOCKED BY GENUINE EXTERNAL DEPENDENCY
```

---

# 24. SHARING

Current earlier status:

```text
SHARING:
FAIL
```

Inspect latest intended product behavior.

If sharing is CURRENT:

implement it fully.

Possible model if appropriate:

```text
trees/{treeId}/members/{uid}
```

Support the actual roles required.

Examples might include:

```text
owner
editor
viewer
```

but do not introduce roles unnecessarily.

Enforce access in:

```text
Firestore Rules
Functions
```

Test with multiple users.

If sharing is obsolete:

mark:

```text
NOT APPLICABLE
```

with repository evidence.

---

# 25. ACCOUNT APPROVAL

Determine whether approval remains a current requirement.

If current:

implement application-level status such as the actual required states.

Examples:

```text
pending
approved
rejected
suspended
```

Firebase Auth identity alone must not bypass approval.

If approval is obsolete:

mark N/A with evidence.

---

# 26. PAYMENTS / M-PESA

Determine whether payment functionality is part of the current intended Lineage application.

If YES:

migrate trusted payment logic to Firebase Functions.

Secrets must remain server-side.

Use appropriate Firebase/Google secret mechanisms.

Never expose:

```text
consumer secret
passkey
private payment token
callback validation secret
```

to browser JavaScript.

Preserve payment records in Firestore where appropriate.

If payment is no longer intended:

mark:

```text
PAYMENTS:
NOT APPLICABLE
```

with evidence.

---

# 27. MEMORIES

If memories are current:

implement:

```text
Firestore model
Functions/Rules authorization
frontend CRUD
tests
```

If attachments exist, use Storage.

If obsolete:

mark N/A.

---

# 28. EVIDENCE

If evidence/document support is current:

use:

```text
Firestore → metadata
Storage → binary documents/files
```

Protect both using authorization.

Test:

```text
User A
vs
User B
```

If obsolete:

mark N/A.

---

# 29. IMPORT

If import is current:

implement secure import.

Never trust ownership IDs contained inside uploaded data.

Derive owner from authenticated Firebase UID.

Validate:

```text
schema
file size
file type
persons
relationship references
duplicates
invalid IDs
```

Provide controlled error reporting.

---

# 30. EXPORT

If export is current:

allow users to export only trees they are authorized to access.

Preserve:

```text
tree metadata
persons
relationships
supported application metadata
```

Test round-trip where practical:

```text
export
→ clean emulator
→ import
→ compare graph
```

---

# 31. ADMIN FUNCTIONALITY

If administration exists:

use secure Firebase authorization.

Where appropriate use Firebase custom claims.

Never allow:

```text
isAdmin
role
approval
```

to be changed directly by untrusted browser writes.

Admin privileges must originate from trusted server logic.

---

# 32. FIRESTORE RULES FINAL RUN

Re-run full adversarial tests after all feature parity changes.

Prove:

```text
anonymous denied
owner allowed
cross-user denied
wrong-tree denied
```

Also cover:

```text
sharing
approval-sensitive data
payments
memories
evidence
```

if those features remain current.

---

# 33. STORAGE RULES FINAL RUN

Re-run all Storage adversarial tests after feature changes.

Cover:

```text
profile photos
evidence files
memory media
```

where applicable.

---

# 34. TWO-USER SECURITY TEST

Create emulator:

```text
User A
User B
```

User A creates data.

User B must NOT be able to access A's private:

```text
tree
persons
relationships
photos
memories
evidence
payments
private exports
```

unless explicit sharing grants access.

Repeat reverse direction.

---

# 35. THREE-GENERATION BROWSER TEST

Using the actual frontend and emulators:

create:

```text
Grandfather + Grandmother
          │
        Parent + Spouse
              │
            Child
```

Test:

```text
tree layout
parent-child edges
spouse edge
editing
photo
relationship deletion
reload
logout
login
persistence
```

This must go through the browser, not direct Firestore seeding only.

---

# 36. FIREBASE RELEASE TEST COMMAND

Ensure a deterministic release test exists.

Preferred:

```bash
npm run test:firebase
```

It should cover as much as practical:

```text
Auth
Functions
Firestore
Storage
Rules
two-user isolation
tree CRUD
relationships
```

Also run:

```bash
npm run test:firebase:rules
```

where already configured.

Target:

```text
PASS
```

---

# 37. LEGACY POSTGRES TESTS

Legacy PostgreSQL tests must not gate the Firebase-native release.

Classify them separately.

Do not delete useful history.

But a PostgreSQL connection refusal must not make the Firebase release test fail.

The Firebase runtime no longer uses PostgreSQL.

---

# 38. SEARCH FOR LEGACY RUNTIME DEPENDENCIES

Run:

```bash
git grep -ni "DATABASE_URL"
git grep -ni "postgres"
git grep -ni "pool.query"
git grep -ni "connect-pg"
git grep -ni "SESSION_SECRET"
git grep -ni "req.session"
git grep -ni "render.com"
git grep -ni "lineage-api"
git grep -ni "run.app"
```

Classify every occurrence.

Allowed:

```text
legacy/
migration documentation
incident reports
historical notes
one-time recovery tooling
```

Not allowed:

```text
active Firebase Functions
active frontend
firebase.json production rewrite
current application startup
```

---

# 39. FIREBASE HOSTING REWRITE

Inspect:

```text
firebase.json
```

Production:

```text
/api/**
```

must target the Firebase Functions API.

It must NOT target:

```text
lineage-api
Cloud Run
Render
```

---

# 40. SERVICE WORKER

Review:

```text
public/sw.js
```

Ensure it does not cache:

```text
Firebase Auth tokens
Authorization headers
private API responses
private Firestore data
```

Increment cache version for final cutover.

Make sure older Cloud Run-era frontend JavaScript cannot remain indefinitely active.

---

# 41. FIREBASE AUTHORIZED DOMAINS

Verify Firebase Authentication authorized domains include:

```text
family-tree-a4c4f.web.app
```

plus any intentional custom production domain.

Do not add unrelated domains.

---

# 42. PRODUCTION CONFIGURATION REVIEW

Before deployment confirm:

```text
official Firebase Web config loaded
correct project ID
correct Auth domain
correct Storage bucket
correct Functions region
correct Firestore database
```

No emulator URLs may exist in production path.

---

# 43. SECRET REVIEW

Search repository for accidental secrets.

Check:

```text
service account keys
private keys
M-Pesa credentials
SMTP passwords
old DATABASE_URL
session secrets
access tokens
```

Do not commit them.

Ensure `.gitignore` protects:

```text
service account files
migration-private/
database backups
local Firebase state
private exports
```

---

# 44. BUILD AND TEST

Run all appropriate current tests.

Examples only if scripts exist:

```bash
npm ci
npm test
npm run test:firebase
npm run test:firebase:rules
```

Functions:

```bash
cd functions
npm ci
npm test
```

Run syntax/build checks.

Do not claim a command passed unless it actually ran successfully.

---

# 45. FINAL LOCAL RELEASE GATE

Before production deployment require:

```text
Firebase Web config → PASS
Frontend Auth → PASS
Register → PASS
Login → PASS
Auth persistence → PASS
Logout → PASS
Firestore Rules → PASS
Storage Rules → PASS
Two-user isolation → PASS
Tree CRUD → PASS
Relationship CRUD → PASS
Photo upload → PASS
Feature parity → PASS or justified N/A
First-party local JS errors → 0
```

Any actual security failure blocks deployment.

---

# 46. DEPLOY FIREBASE PRODUCTION

Once all local gates pass, deploy to:

```text
family-tree-a4c4f
```

Deploy applicable:

```text
Functions
Firestore Rules
Firestore indexes
Storage Rules
Hosting
```

Use the actual supported Firebase CLI commands.

Do not deploy another project accidentally.

Capture deployment output.

---

# 47. CLEAN PRODUCTION TEST

After deployment open:

```text
https://family-tree-a4c4f.web.app/
```

using an extension-free browser profile.

Test the actual deployed site.

Required:

```text
page renders
register
login
auth persistence
tree creation
tree load
tree rename
person create
person edit
person delete
relationship create
relationship delete
photo upload
photo replace
photo display
logout
login again
password reset
email verification if required
```

Test every other feature classified as CURRENT.

---

# 48. TWO-ACCOUNT PRODUCTION TEST

Create disposable:

```text
Production User A
Production User B
```

User A creates private test data.

User B attempts unauthorized access.

Expected:

```text
DENIED
```

Test:

```text
tree
person
relationship
photo
other private features
```

Do not use real private user family data.

---

# 49. PRODUCTION NETWORK INSPECTION

Inspect browser Network traffic.

Required:

```text
REQUESTS TO RENDER:
0

REQUESTS TO OLD CLOUD RUN LINEAGE-API:
0
```

Expected Firebase endpoints are allowed.

If any normal runtime request still hits the old Cloud Run service, the cutover is incomplete.

---

# 50. PRODUCTION CONSOLE

Inspect console.

Target:

```text
FIRST-PARTY APPLICATION ERRORS:
0
```

Do not count extension-generated errors as first-party errors after verifying their origin.

There must be no:

```text
Firebase Auth initialization exception
Firestore permission denial for valid actions
Functions 500
Storage denial for valid uploads
blank screen
```

---

# 51. VERIFY BLANK-PAGE RECOVERY

Simulate or test recoverable failure behavior.

If Functions or network fails, UI should show:

```text
error message
Retry action
```

not a blank page.

---

# 52. CLOUD RUN RETIREMENT DECISION

Legacy:

```text
lineage-api
```

may only be classified:

```text
SAFE TO RETIRE
```

when all are true:

```text
production Firebase Auth works
production Firestore works
production Functions work
production Storage works
production required features work
production security passes
Render traffic = 0
old Cloud Run traffic = 0
```

Do not delete the Cloud Run service automatically unless explicitly authorized.

---

# 53. RENDER / POSTGRES FINAL STATUS

Final architecture report must state:

```text
Render:
NOT REQUIRED

PostgreSQL:
NOT REQUIRED

DATABASE_URL:
NOT REQUIRED

express-session:
NOT REQUIRED

connect-pg-simple:
NOT REQUIRED
```

Historical references do not count as runtime dependencies.

---

# 54. HISTORICAL DATA

Do not alter historical-data reporting unless new verified data was recovered.

Current known recoverable data:

```text
1 person
0 relationships
```

Original PostgreSQL user/tree/relationship records remain unavailable unless new evidence exists.

Do not fabricate them.

---

# 55. UPDATE FEATURE PARITY MATRIX

Update:

```text
docs/FIREBASE_FEATURE_PARITY_MATRIX.md
```

There must be no unexplained:

```text
PENDING
PARTIAL
NOT COMPLETE
```

states.

Every row must end:

```text
PASS
N/A
FAIL with exact reason
EXTERNAL BLOCKER
```

---

# 56. UPDATE ARCHITECTURE DOCUMENT

Update:

```text
docs/FIREBASE_NATIVE_ARCHITECTURE.md
```

Final diagram should show:

```text
                       Firebase Hosting
                              │
                    ┌─────────┴─────────┐
                    │                   │
                    ▼                   ▼
             Firebase Auth       Firebase Functions
                                         │
                               ┌─────────┴────────┐
                               │                  │
                               ▼                  ▼
                           Firestore          Storage
```

No active:

```text
Render
PostgreSQL
Cloud Run lineage-api
```

dependency.

---

# 57. UPDATE MIGRATION REPORT

Update:

```text
docs/FIREBASE_NATIVE_MIGRATION_REPORT.md
```

Include:

```text
Web App registration result
Web config
Firestore
Functions
Storage
Auth
security tests
feature parity
production deployment
production smoke test
network verification
legacy infrastructure status
historical-data limitation
```

---

# 58. UPDATE CUTOVER CHECKLIST

Update:

```text
docs/FIREBASE_PRODUCTION_CUTOVER_CHECKLIST.md
```

Every item should be:

```text
PASS
FAIL
N/A
```

Avoid vague prose statuses.

---

# 59. README

Update `README.md` to describe only the current supported production architecture.

Remove setup instructions requiring:

```text
PostgreSQL
Render
DATABASE_URL
```

Document:

```text
Firebase project
Firebase Emulator Suite
Authentication
Firestore
Functions
Storage
Hosting
local development
testing
deployment
```

---

# 60. GIT REVIEW

Before completion:

```bash
git status
git diff --stat
git diff
```

Verify:

```text
no secrets
no service account keys
no database dump
no private Excel recovery file
no emulator database export accidentally committed
```

Review all migration changes.

---

# 61. FINAL RELEASE MATRIX

Generate:

| Area | Result |
|---|---|
| Web App | PASS/FAIL |
| Web config | PASS/FAIL |
| Auth | PASS/FAIL |
| Register | PASS/FAIL |
| Login | PASS/FAIL |
| Auth persistence | PASS/FAIL |
| Logout | PASS/FAIL |
| Password reset | PASS/FAIL/N/A |
| Email verification | PASS/FAIL/N/A |
| Firestore | PASS/FAIL |
| Functions | PASS/FAIL |
| Storage | PASS/FAIL |
| Firestore Rules | PASS/FAIL |
| Storage Rules | PASS/FAIL |
| Cross-user security | PASS/FAIL |
| Tree CRUD | PASS/FAIL |
| Person CRUD | PASS/FAIL |
| Relationships | PASS/FAIL |
| Photo Upload | PASS/FAIL |
| Sharing | PASS/FAIL/N/A |
| Approval | PASS/FAIL/N/A |
| Payments | PASS/FAIL/N/A |
| Memories | PASS/FAIL/N/A |
| Evidence | PASS/FAIL/N/A |
| Import | PASS/FAIL/N/A |
| Export | PASS/FAIL/N/A |
| Production Deployment | PASS/FAIL |
| Production Smoke Test | PASS/FAIL |
| Blank-page recovery | PASS/FAIL |
| Render dependency | ZERO/REMAINS |
| PostgreSQL dependency | ZERO/REMAINS |
| Cloud Run traffic | ZERO/REMAINS |

---

# 62. REQUIRED FINAL TERMINAL OUTPUT

Return exactly this general structure:

```text
================================================================
LINEAGE — FIREBASE FINAL PRODUCTION CUTOVER
================================================================

STATUS:
COMPLETE / PARTIAL / BLOCKED

PROJECT:
family-tree-a4c4f

PRODUCTION:
https://family-tree-a4c4f.web.app/

---------------------------------------------------------------
FIREBASE PLATFORM
---------------------------------------------------------------

WEB APP:
PASS / FAIL

WEB APP ID:
<id>

WEB CONFIG:
PASS / FAIL

AUTH:
PASS / FAIL

FIRESTORE:
PASS / FAIL

FIRESTORE DATABASE:
(default)

FIRESTORE LOCATION:
us-central1

FUNCTIONS:
PASS / FAIL

FUNCTIONS REGION:
us-central1

STORAGE:
PASS / FAIL

STORAGE BUCKET:
<actual bucket>

HOSTING:
PASS / FAIL

---------------------------------------------------------------
AUTHENTICATION
---------------------------------------------------------------

REGISTER:
PASS / FAIL

LOGIN:
PASS / FAIL

AUTH PERSISTENCE:
PASS / FAIL

LOGOUT:
PASS / FAIL

PASSWORD RESET:
PASS / FAIL / N/A

EMAIL VERIFICATION:
PASS / FAIL / N/A

---------------------------------------------------------------
SECURITY
---------------------------------------------------------------

FIRESTORE RULE TESTS:
PASS / FAIL

STORAGE RULE TESTS:
PASS / FAIL

FUNCTION AUTH TESTS:
PASS / FAIL

TWO-USER ISOLATION:
PASS / FAIL

PRODUCTION CROSS-USER TEST:
PASS / FAIL

---------------------------------------------------------------
CORE APPLICATION
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

---------------------------------------------------------------
FILES
---------------------------------------------------------------

PHOTO UPLOAD:
PASS / FAIL

PHOTO DISPLAY:
PASS / FAIL

PHOTO REPLACE:
PASS / FAIL

PHOTO DELETE:
PASS / FAIL

PHOTO CLEANUP:
PASS / FAIL

---------------------------------------------------------------
FEATURE PARITY
---------------------------------------------------------------

SHARING:
PASS / FAIL / N/A

APPROVAL:
PASS / FAIL / N/A

PAYMENTS:
PASS / FAIL / N/A

MEMORIES:
PASS / FAIL / N/A

EVIDENCE:
PASS / FAIL / N/A

IMPORT:
PASS / FAIL / N/A

EXPORT:
PASS / FAIL / N/A

---------------------------------------------------------------
TESTING
---------------------------------------------------------------

EMULATOR SUITE:
PASS / FAIL

FIREBASE RELEASE TEST:
PASS / FAIL

THREE-GENERATION E2E:
PASS / FAIL

LOCAL FIRST-PARTY ERRORS:
<number>

---------------------------------------------------------------
PRODUCTION
---------------------------------------------------------------

PRODUCTION DEPLOYMENT:
PASS / FAIL

PRODUCTION SMOKE TEST:
PASS / FAIL

PRODUCTION FIRST-PARTY CONSOLE ERRORS:
<number>

REQUESTS TO RENDER:
<number>

REQUESTS TO OLD CLOUD RUN:
<number>

---------------------------------------------------------------
LEGACY INFRASTRUCTURE
---------------------------------------------------------------

RENDER RUNTIME DEPENDENCY:
ZERO / REMAINS

POSTGRESQL RUNTIME DEPENDENCY:
ZERO / REMAINS

DATABASE_URL REQUIRED:
NO / YES

EXPRESS SESSION REQUIRED:
NO / YES

CONNECT-PG-SIMPLE REQUIRED:
NO / YES

CLOUD RUN LINEAGE-API:
SAFE TO RETIRE / NOT SAFE TO RETIRE

---------------------------------------------------------------
HISTORICAL RECOVERY
---------------------------------------------------------------

RECOVERED:
1 person
0 relationships
<update only with verified additional recovery>

UNAVAILABLE:
<verified unavailable historical data>

---------------------------------------------------------------
DOCUMENTATION
---------------------------------------------------------------

FEATURE PARITY:
docs/FIREBASE_FEATURE_PARITY_MATRIX.md

ARCHITECTURE:
docs/FIREBASE_NATIVE_ARCHITECTURE.md

MIGRATION REPORT:
docs/FIREBASE_NATIVE_MIGRATION_REPORT.md

CUTOVER CHECKLIST:
docs/FIREBASE_PRODUCTION_CUTOVER_CHECKLIST.md

---------------------------------------------------------------
FINAL VERDICT
---------------------------------------------------------------

<state clearly whether Lineage is now fully Firebase-native and
whether Render/PostgreSQL/old Cloud Run can be retired>

REMAINING ACTIONS:
1. ...
2. ...

================================================================
```

# FINAL NON-NEGOTIABLE SUCCESS STANDARD

Do NOT declare Lineage fully migrated merely because Firebase code exists.

Do NOT declare completion merely because local emulator tests pass.

Completion requires:

```text
real Firebase Web App config works
real Firebase Auth works
real Firestore works
real Firebase Functions work
real Storage works
frontend works
security tests pass
two-user isolation passes
tree CRUD passes
relationship graph passes
photo flow passes
all intended current features pass or are explicitly N/A
production deployment succeeds
production smoke test succeeds
production sends zero requests to Render
production sends zero requests to old lineage-api Cloud Run
PostgreSQL is not required
```

The intended final result is:

# LINEAGE RUNS ENTIRELY ON FIREBASE.

Render, PostgreSQL, DATABASE_URL, Express sessions, and the old Cloud Run backend are no longer necessary for production operation.