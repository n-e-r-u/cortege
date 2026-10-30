# Beacon/Admin Tests - New/Revised Testing Plan

## Why New/Revised Tests Are Needed

The current integration tests are hiding the real failure because the global error handler swallows the exception and returns a generic `400 "Requête invalide."`. 

Key issues:
- **Schema drift**: Server relies on `ALTER TABLE ... ADD COLUMN` in `try/catch`. If those fail silently (we saw issues with `oid` and `rowid`), beacon queries/inserts throw `datatype mismatch` or `no such column` with no clear signal.
- **Shared DB state**: `test/server.test.js` reuses the same temp DB/server across many tests. Broken migration from earlier test can cascade into beacon/admin tests.
- **Exception swallowing**: `server.js:3984-3986` logs `requête POST /api/orga/beacon <message>` but drops stack trace. With `node:sqlite` "datatype mismatch" almost always comes from parameter binding, so we need full stack.
- **Tight coupling**: Failing beacon tests go through sponsor -> ready -> confirm -> beacon. Hard to tell if issue is beacon code or setup.

## Step 1: Instrument Server to Expose Real Error

Patch global error handler in `server.js` around `3984-3986`:

```js
} catch (e) {
  const busy = isBusy(e);
  if (!busy && !/bad json|too large/.test(e.message)) {
    console.error('requête', req.method, pathname, e.message);
    if (pathname?.startsWith('/api/orga/beacon')) console.error(e.stack);
  }
  send(res, busy ? 503 : 400, { error: busy ? 'Serveur occupé, réessaie.' : 'Requête invalide.' });
}
```

Also consider wrapping `tx()` call in beacon handler to log full stack when it throws.

Run just beacon tests to see real exception:
```bash
node --test --test-name-pattern="position en direct|admin : nom affiché|cortège : tête" /home/jade/cortege/test/server.test.js
```

## Step 2: Audit Schema Against What Code Expects

Script to inspect actual DB from tests:

```bash
node << 'EOF'
const fs = require('fs');
const path = require('path');
const os = require('os');
const {DatabaseSync} = require('node:sqlite');

// find latest cortege temp dir
const base = os.tmpdir();
const dirs = fs.readdirSync(base).filter(d=>d.startsWith('cortege-')).map(d=>({d, t: fs.statSync(path.join(base,d)).mtimeMs})).sort((a,b)=>b.t-a.t);
const dir = dirs[0]?.d;
if(!dir){ console.log('no temp dir found'); process.exit(0); }
const dbPath = path.join(base, dir, 'd', 'db.sqlite');
console.log('DB:', dbPath);
const db = new DatabaseSync(dbPath);
console.log(db.prepare("PRAGMA table_info(reports)").all());
EOF
```

Look for: `oid`, `bk` (INTEGER), `bkla` (REAL), `bklo` (REAL), `trail` (TEXT), `fl`, `ver`. Check for `oid` existence or rowid conflicts.

## Step 3: Make Migrations Defensive

Replace bare `ALTER TABLE` in try/catch with PRAGMA-driven migration:

```js
function ensureCol(table, name, def) {
  try {
    const cols = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name));
    if (!cols.has(name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
      console.log(`[migrate] added ${table}.${name} ${def}`);
    }
  } catch(e) { console.error('[migrate]', table, name, e.message); }
}

ensureCol('reports','oid','TEXT');
ensureCol('reports','trail','TEXT');
ensureCol('reports','bk','INTEGER DEFAULT 0');
ensureCol('reports','bkla','REAL');
ensureCol('reports','bklo','REAL');
ensureCol('reports','fl','INTEGER DEFAULT 0');
ensureCol('reports','dw','INTEGER DEFAULT 0');
ensureCol('reports','ct','INTEGER DEFAULT 0');
ensureCol('reports','last','INTEGER');
ensureCol('reports','notes','TEXT');
```

If `oid` truly conflicts with `rowid` in schema:
- Option 1: Don't rely on adding `oid` if it can't be added. Change beacon lookup to different strategy (look up by beacon report id stored differently, or join via orga_log)
- Option 2: Rebuild `reports` table in migration (copy data, create new table with correct columns, swap) - riskier

Leaning towards making beacon code defensive first: guard `WHERE oid=?` query, fallback to different lookup if column missing, or coerce types before binding.

## Step 4: Write New/Revised Tests

### A) `test/schema.beacon.test.js` (new)
Boot server with fresh temp DB, assert schema is correct:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
// ... setup helpers

test('reports has beacon/org columns', () => {
  const db = new DatabaseSync(dbPath);
  const cols = new Map(db.prepare("PRAGMA table_info(reports)").all().map(c=>[c.name,c]));
  for (const need of ['oid','bk','bkla','bklo','trail']) {
    assert.ok(cols.has(need), `missing column ${need}`);
  }
});
```

### B) `test/beacon.isolated.test.js` (new)
Completely isolated from big suite. Spin up own server on random port with own `DATA_DIR`. Minimal flow: make admin, create/sponsor/confirm orga, POST beacon. Log full response + status. Makes it trivial to see 400 with actual error.

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// ... boot isolated server, test minimal beacon flow
```

### C) Revise `test/server.test.js`
- For test 421 (confirmed orga medic report), add temporary logging of response body on failure: `console.log('r:', r.s, r.j)` to see error message
- For beacon tests, don't rely on cascading state. Each beacon test should explicitly create/confirm orga in that test or use `beforeEach` with fresh context
- Make admin label assertion already done, but also consider making any hardcoded "Cortège" expectations locale/default-agnostic going forward

## Step 5: Harden Beacon Code

Add defensive type coercion:
- Ensure all values passed to DB are proper types (numbers as numbers, nulls explicit, arrays stringified before passing if needed)
- Guard `SELECT ... WHERE oid=? AND cat=? ...` if `oid` column is missing (fallback query)
- Ensure `trail` is `[]` (array) not null when passed to `saveReport` - saveReport stringifies it, but node:sqlite can be picky
- Coerce lat/lng to numbers properly

## Concrete Next Actions

1. **Patch logging first** (5 min) - Add stack trace logging for beacon in global catch. Run beacon tests.
2. **Dump schema** (2 min) - Use script against latest temp DB from failed run.
3. **Fix migrations defensively** (10-15 min) - Implement PRAGMA-based `ensureCol` for beacon columns. Handle `oid` specially if adding fails.
4. **Add isolated beacon test** (10 min) - Write minimal happy-path test against fresh DB. Get passing first.
5. **Harden beacon code** (as needed) - Defensive typing, guard queries if columns missing.
6. **Re-run full suite** - Adjust only assertions truly affected by US port (admin label already done).

**Bet:** After adding stack trace logging, we'll see `datatype mismatch` from `q('SELECT * FROM reports WHERE oid=? AND cat=? AND bk>0 AND exp>?').get(...)` or from `saveReport`'s INSERT. Usually it's (a) `oid` column doesn't exist so WHERE clause errors, or (b) `bk`/`bkla`/`bklo` bound as `undefined`/wrong types. PRAGMA-based migrations + defensive typing will fix most of it. New isolated tests will prevent regression.
