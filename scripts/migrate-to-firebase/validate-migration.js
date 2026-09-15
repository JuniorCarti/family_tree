#!/usr/bin/env node
/* Validates a source/target reconciliation JSON without mutating either side. */
const fs = require('node:fs');
const file = process.argv.find(a => a.startsWith('--file='))?.slice(7);
if (!file) { console.error('Usage: node scripts/migrate-to-firebase/validate-migration.js --file=reconciliation.json'); process.exit(2); }
const report = JSON.parse(fs.readFileSync(file, 'utf8'));
const differences = Object.entries(report).filter(([, v]) => typeof v === 'object' && v && Number(v.source) !== Number(v.target));
console.log(JSON.stringify({ checked: Object.keys(report).length, unexplainedDifferences: differences.length, differences: differences.map(([k]) => k) }, null, 2));
process.exitCode = differences.length ? 1 : 0;
