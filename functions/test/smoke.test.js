const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('functions package contains a Firebase Functions entrypoint', () => {
  const source = fs.readFileSync('src/index.js', 'utf8');
  assert.match(source, /exports\.api\s*=\s*onRequest/);
  assert.match(source, /verifyIdToken/);
});
