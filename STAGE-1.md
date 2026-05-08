# Phase 1 — Stop the Bleeding

This phase closes the highest-severity findings raised by the five audit
documents in this repo. Every fix is a separate commit so they can be
reviewed independently. Every fix ships with a regression test under
`tests/regression/` that would have caught the problem.

The phase is intentionally narrow: only the changes specified in the phase-1
prompt were made. No refactors, no design changes. Open follow-ups are
listed at the end of this document.

The full test suite is run with:

```
npm test
```

It runs Vitest with `--passWithNoTests`. The current tally is **117 tests
across 10 regression files**. The harness writes a per-test data dir under
`/tmp/kasmgt-test-*`, runs Excel-only persistence so it has no Mongo
dependency, and tears the dir down on completion.

The HTTP server is verified to boot by:

```
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))") npm start
```

---

## Fixes

### 1. Require JWT_SECRET at startup (no fallback)

Files changed:
- `server.js`
- `tests/regression/jwt-secret.test.js` (new)

How to verify: start `node server.js` with no `JWT_SECRET` and the process
exits within 5 seconds with a fatal log explaining how to generate a value.
Same outcome with `JWT_SECRET=short` or `JWT_SECRET=change-me-to-a-real-secret`.

---

### 2. Delete the `authEnabled` bypass entirely

Files changed:
- `backend/feature-flags.json` (key removed)
- `backend/feature_flags.js`
- `plugins/auth.js` (no longer fabricates a Developer user on JWT failure)
- `backend/auth.js` (DEV_USER deleted, all `if (!AUTH_ENABLED)` branches gone)
- `scripts/seed-admin.js` (new — dev convenience to create a Full Admin)
- `tests/regression/no-auth-bypass.test.js` (new)

How to verify: `grep -rn "authEnabled\|DEV_USER" backend/ plugins/ routes/ frontend/`
returns no matches. Calling any protected route without a token returns 401.

---

### 3. Argon2id passwords with transparent legacy-rehash on login

Files changed:
- `backend/password.js` (new — `hashPassword`, `verifyPassword`)
- `backend/auth.js` (all hashPassword call sites are async; loginUser passes plaintext)
- `backend/excel_worker.js` (`loginAuthUser` now verifies + rehashes)
- `backend/excel_worker_client.js` (param renamed for clarity)
- `backend/persistence/MongoPersistence.js` (`loginAuthUser` now verifies + rehashes; fail-closed compare-and-swap on the rehash write)
- `backend/persistence/ExcelPersistence.js` (param renamed for clarity)
- `package.json` (adds `argon2`)
- `tests/regression/password-hashing.test.js` (new)

How to verify: stop the server, seed a user whose stored hash is the SHA-256
hex of their password (e.g. directly insert into the workbook), restart and
log in. The next inspection of the stored hash shows `$argon2id$...`.

---

### 4. Add permission preHandlers to previously open routes

Files changed:
- `routes/algorithms.js` (six POST endpoints now require READ_EDIT)
- `routes/excel.js` (`/list-sheets`, `/parse-rows-from-sheet` require READ_EDIT)
- `routes/stations.js` (`/invalidate` requires READ_EDIT)
- `routes/auth.js` (`GET /users` requires FULL_ADMIN)
- `tests/regression/route-permissions.test.js` (new)

How to verify: log in as a Read Only user, hit any of the affected endpoints,
get a `403 forbidden` response. Repeat as a user with the required level —
no `403`.

`PUT /api/stations` is intentionally left with its inline permission check
(field-level General Information gating).

---

### 5. Strip identity/role fields from public registration; first-admin bootstrap

Files changed:
- `backend/auth.js` (`createUser` ignores body `admin`/`permissions`; first registrant is promoted to Full Admin)
- `tests/regression/no-self-promotion.test.js` (new)

How to verify on a fresh deployment: `POST /api/auth/register` with
`{name, email, password, admin: 'Yes', permissions: 'Full Admin'}` — the
first call succeeds and produces a Full Admin (bootstrap). The second call
with the same body produces a Read Only user.

The privileged `POST /api/auth/admin/create` endpoint still honours
`admin`/`permissionLevel` from the body because it remains FULL_ADMIN-gated.

---

### 6. Strip self-elected permissionLevel from access-request

Files changed:
- `routes/auth.js` (no source change needed — the layer below ignores the field)
- `backend/auth.js` (`sendAccessRequest` no longer accepts permissionLevel; `createUserWithCode` always Read Only)
- `backend/access_requests.js` (record schema no longer carries permissionLevel; sanitize fn removed)
- `backend/mailer.js` (email body no longer mentions a requested level)
- `frontend/login.html` (permission dropdown removed; replaced with explanatory text)
- `frontend/js/login.js` (no longer reads the dropdown)
- `tests/regression/access-request-no-self-promotion.test.js` (new)

How to verify: submit an access request with
`{permissionLevel: 'Full Admin'}`, consume the code. Inspect the user via
`/api/auth/users` (as an admin) — the new account is Read Only.

---

### 7. Never return password hashes from `/api/auth/users`

Files changed:
- `backend/auth.js` (`getAllUsers` now passes through a fixed allow-list and drops anything matching `/password|hash/i`)
- `frontend/js/users.js` (`maskPassword` deleted; password row removed from user grid)
- `tests/regression/users-list-no-hash.test.js` (new)

How to verify: as a Full Admin, `GET /api/auth/users`. The response is an
array of objects whose keys are a subset of:
`name, email, permissions, admin, status, created, lastLogin`.

This is in addition to the FULL_ADMIN gate on the endpoint (Step 4) — i.e.
defense in depth.

---

### 8. Path-component sanitization on filesystem-bound inputs

Files changed:
- `backend/utils/path_safety.js` (new — `assertSafePathSegment`, `assertSafeRelativePath`)
- `routes/nuke.js` (companyName, locationName, assetTypeName)
- `routes/stations.js` (DELETE `:company/:location/:stationId`)
- `routes/lookups.js` (POST company/location/asset-type)
- `routes/excel.js` (company, location, locationName, assetType, sheetName)
- `routes/photos.js` (siteName, stationId; photoPath/folderPath/subPath validated as relative paths)
- `routes/documents.js` (siteName, stationId; docPath/folderPath/subPath as relative paths)
- `routes/inspections.js` (siteName, stationId, folderName)
- `routes/projects.js` (siteName, stationId, folderName)
- `tests/regression/path-traversal.test.js` (new)

How to verify: send any of the malicious values listed in the test file
(`../etc/passwd`, `..\\windows\\system32`, `foo\x00.txt`, empty string, a
300-char string, etc.) for any of the validated parameters and the API
returns 400. (For URL-segment params over 100 chars, `find-my-way` returns
404 before the handler runs — also a valid rejection.)

---

### 9. JWT tokens expire after 8 hours

Files changed:
- `routes/auth.js` (`POST /login` signs with `expiresIn: '8h'` via `reply.jwtSign`)
- `tests/regression/jwt-expiry.test.js` (new)

How to verify: log in. Decode the returned JWT (the middle segment is
base64url JSON). It now contains `iat` and `exp`, with `exp - iat = 28800`.

---

### 10. `PUT /api/stations` validates body

Files changed:
- `routes/stations.js` (rejects missing/null/non-object body and missing/non-object `stationData`)
- `tests/regression/put-stations-validates-body.test.js` (new)

How to verify: `PUT /api/stations` with no body, with `null`, with `{}`, or
with `{stationData: 'string'}` — all return 400. With
`{stationData: {...}}` the handler proceeds normally.

---

## Things this phase did NOT do

These were called out by the audits but are deferred — they need a design
decision, are higher-effort than the prompt allowed, or both.

- Replace the in-process session singletons (`currentUser`, `sessionToken` in `backend/auth.js`) with a real session store. Right now the JWT carries identity correctly per request, but those module-level globals still exist and are not multi-tenant safe.
- Add `loginAuthUser` (and the rest of the auth surface) to `DualWritePersistence` — the wrapper currently has no auth methods, so a configuration with multiple write targets only works for auth if one of the writers happens to also be the read source. (Today's repo configuration `read: excel, write: [excel, mongodb]` works because the read happens against Excel; mongo never sees auth writes.)
- Tighten CORS. `@fastify/cors` is registered with `origin: true, credentials: true`, which reflects whatever origin asks. This is pre-existing and out of scope for this phase.
- Frontend hardening (CSP, SameSite=strict cookies, frame-ancestors, etc.).
- Rate-limiting login attempts.
- A real first-time bootstrap UX in the frontend (the registration form still asks for name/email/password without telling the user that the very first account becomes Full Admin).
- Removal or hardening of `routes/nuke.js`. Even with FULL_ADMIN-gating, an irreversible "delete-everything" endpoint is risky in a multi-tenant setting.
- Bulk migration of existing SHA-256 hashes off the legacy scheme. (See "How to migrate existing users" below — they upgrade lazily on next login.)
- A user-rotation / password-reset flow.
- Auditing access-request file (`data/login/access_requests.json`) for stale entries.

---

## How to migrate existing users

No active migration is required. The first time each existing user logs in
after this phase deploys:

1. Their stored hash (legacy SHA-256) is recognized by `verifyPassword` and they are allowed in.
2. The login handler immediately replaces the stored hash with an argon2id digest of the same plaintext.
3. All subsequent logins go through the argon2id path.

Operational notes:

- A user who never logs in keeps a SHA-256 hash. To force everyone onto argon2id, expire all sessions and require a re-login.
- The first deploy's first registrant is now bootstrapped to Full Admin (Step 5). On a system that already has users, this branch is dormant and the first registrant is created Read Only.
- The access-request flow (`POST /api/auth/access-request` → email → `POST /api/auth/create-with-code`) now stores an argon2id hash in the request file and creates the new user with an argon2id hash. Old request records, if any, with SHA-256 password hashes will still validate via the legacy fallback when the code is consumed.
