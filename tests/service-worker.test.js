const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');

test('service worker never caches authenticated API responses', () => {
  assert.match(source, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.doesNotMatch(source, /startsWith\('\/api\/tree'\)/);
});

test('service worker removes superseded shells and refreshes navigations', () => {
  assert.match(source, /caches\.delete\(key\)/);
  assert.match(source, /event\.request\.mode === 'navigate'/);
  assert.match(source, /fetch\(event\.request\)\.catch/);
});
