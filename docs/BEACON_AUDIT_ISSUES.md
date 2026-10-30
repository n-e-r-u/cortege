# Beacon/Admin Test Failures - Audit & Issues

## Summary
Running `node --test /home/jade/cortege/test/server.test.js` shows 4 failures. The core localization/US port changes are complete; these appear to be pre-existing or environment-related issues, primarily in the `/api/orga/beacon` flow.

## Failing Tests

| Test | Line | Expected | Actual | Notes |
|---|---|---|---|---|
| `orga confirmée : signalement vérifié d’office, deux fois plus long, prolongeable et corrigeable par elle seule` | ~421-427 | `201` | `400` | Posts report as confirmed orga with `cat: 'medic'`. |
| `cortège : tête qui suit (avec sa trace), queue, et position en direct des orgas confirmées` | ~681-704 | Beacon operations succeed | Cascading failures likely | Uses beacon flow heavily. |
| `position en direct : arrêtée net à plus de 2 km du départ, sans garder la position lointaine` | ~705-710 | `201` POST to `/api/orga/beacon` with `role: 'medic'` | `400` | Direct beacon start fails. |
| `admin : nom affiché choisi, réservé, et point en direct avec son logo` | ~776-783 | `201` POST to `/api/orga/beacon` with `role: 'contact'` as admin | `400` | Direct beacon start fails as admin. |

The `journées prévues...` test was failing due to admin label change (`Cortège` vs `Protest map`) and has been fixed by making the assertion locale-agnostic.

## Root Cause: `/api/orga/beacon` returns 400

All three beacon failures hit the same endpoint. The global error handler in `server.js:3984-3986` catches exceptions thrown in route handlers and logs them as `requête POST /api/orga/beacon <error>`, returning `400 {"error":"Requête invalide."}` unless it's a known "busy"/"bad json"/"too large" error.

Debug logs show:
```
stderr]requête POST /api/orga/beacon datatype mismatch
BK: 400
{ error: 'Requête invalide.' }
```

This indicates a `node:sqlite` `datatype mismatch` exception is thrown inside the beacon handler (likely inside `tx()` at `server.js:3801-3844`).

## Why This Happens

The beacon flow does many DB operations with columns added via `ALTER TABLE`:

**Schema expectations:**
- `reports.bk` (INTEGER DEFAULT 0) - set on beacon creation (`r.bk = now`)
- `reports.bkla` (REAL), `reports.bklo` (REAL) - start position
- `reports.oid` (TEXT) - orga id
- `reports.trail` (TEXT) - JSON stringified array
- `reports.fl` (INTEGER), `ver` (TEXT), etc.

**Problematic code paths:**

1. **`toReport()` expectations** (`server.js:499`): `trail: parseTrail(r), bk: r.bk || 0, bkla: r.bkla ?? null, bklo: r.bklo ?? null`. If rows come back with unexpected types or missing columns in some DB states, this can blow up.

2. **Lookup query** (`server.js:3803`):
```js
const cur = toReport(q('SELECT * FROM reports WHERE oid=? AND cat=? AND bk>0 AND exp>?').get(orga.id, role, now));
```
`node:sqlite` is strict about types. If `bk` is stored unexpectedly, or parameter binding has issues, it can throw `datatype mismatch`. Also `oid` can be problematic - earlier debugging showed `ALTER TABLE reports ADD COLUMN oid TEXT` can fail with "cannot add rowid alias: oid" in some schemas (SQLite treats `oid`/`rowid` specially).

3. **`saveReport()` bindings** (`server.js:531-536`): The INSERT/UPSERT writes `bk`, `bkla`, `bklo`, `trail` etc. If prepared statement expects certain types and gets `undefined`/wrong types, or schema doesn't match expectations, it throws.

4. **Transaction wrapper `tx()`** catches nothing special - any exception propagates to the global handler which logs as "requête POST..." and returns 400.

## The Confirmed Orga Report Failure (Test 421)

Test 421 does `POST /api/reports` with `cat: 'medic'` as a confirmed orga (after sponsorship flow). Expects 201, gets 400. Possible causes:
- Orga not actually in confirmed state when test runs (sponsorship/confirmation logic issue)
- Report validation rejecting it
- Cascading issue from DB state

Less obviously beacon-related. Worth verifying the full test flow (sponsor → actions to become ready → confirm via sponsor → post as medic).

## Debugging Plan

1. **Reproduce with minimal debug script** - Use throwaway DB like existing debug scripts (`/tmp/debug_beacon*.js`). Create orga, confirm it, try to POST beacon and log the actual exception with full stack trace.

2. **Check schema state** - In test DB, inspect `PRAGMA table_info(reports)`. Look for `oid`, `bk`, `bkla`, `bklo`, `trail`. ALTER TABLE statements at `server.js:445-452` are in try/catch, so they may have silently failed on existing schema.

3. **Look for `oid` conflicts** - SQLite has `rowid` as alias; if `oid` was created differently or conflicts, SELECT/INSERT can misbehave. Debug showed "cannot add rowid alias: oid" - schema may be in bad state.

4. **Trace the exception** - Temporarily patch global error handler (or beacon handler) to log full stack trace instead of just `e.message`. "datatype mismatch" is usually from parameter binding in prepared statements.

5. **Check `saveReport`/`toReport`** - Beacon creates new report object with specific fields. Ensure `trail` is `[]` (array) not null when passed to `saveReport` - `saveReport` stringifies it, but `node:sqlite` can be picky about types.

6. **Fix schema issues** - If `oid` causes problems, may need to migrate differently (rename/recreate). Or check if `toReport` passes wrong types.

## Quick Fixes to Try

- **Make beacon error more verbose (temporarily)**: In beacon handler's catch or global handler, log `e.stack` for beacon requests to see exact line throwing.
- **Defensive typing in beacon**: Ensure all values passed to DB are proper types (numbers as numbers, nulls explicit, arrays stringified before passing if needed).
- **Check `oid` column issue**: Code does `ALTER TABLE reports ADD COLUMN oid TEXT` at line 445. If it fails silently and `oid` doesn't exist, `SELECT ... WHERE oid=?` would fail. But `SELECT *` would still work? Or it would error. Also `toReport` doesn't seem to use `oid` directly - it reads from row. But WHERE clause would fail if column missing.

**Most likely issue:** Schema-related from ALTER TABLE statements failing silently on existing schema shape, causing `datatype mismatch` or "no such column" errors that bubble up as exceptions caught by global handler.
