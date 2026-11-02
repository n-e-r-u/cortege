#!/usr/bin/env node
'use strict';
// Faux outil pmtiles pour les tests : « version », et « extract » qui copie FAKE_PM_SRC (estimation avec --dry-run)
const fs = require('fs');
const a = process.argv.slice(2);
if (a[0] === 'version') { console.log('pmtiles 1.31.2, commit test'); process.exit(0); }
if (a[0] !== 'extract') process.exit(2);
const out = a[2], src = process.env.FAKE_PM_SRC;
fs.appendFileSync(process.env.FAKE_PM_LOG || '/dev/null', JSON.stringify(a) + '\n');
if (a.includes('--dry-run')) { console.log(`2026/11/02 09:00:00 extract.go:612: Extract transferred 5 kB (overfetch 0.05) for an archive size of ${(fs.statSync(src).size / 1000).toFixed(1)} kB`); process.exit(0); }
if (process.env.FAKE_PM_FAIL) { console.error('2026/11/02 09:00:00 main.go:185: Failed to extract, source archive must be clustered for extracts'); process.exit(1); }
setTimeout(() => { fs.copyFileSync(src, out); process.exit(0); }, Number(process.env.FAKE_PM_DELAY || 50));
