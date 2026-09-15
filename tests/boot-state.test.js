const test = require('node:test');
const assert = require('node:assert/strict');
const { showStartupFailure } = require('../public/boot-state');

function element(hidden = true) {
  const classes = new Set(hidden ? ['hidden'] : []);
  return {
    classList: {
      contains: (name) => classes.has(name),
      toggle: (name, force) => force ? classes.add(name) : classes.delete(name)
    }
  };
}

test('failed session bootstrap reveals a recoverable error instead of a blank page', () => {
  const elements = {
    app: element(true),
    approvalScreen: element(true),
    authScreen: element(true),
    bootError: element(true)
  };
  const documentRef = { getElementById: (id) => elements[id] || null };

  showStartupFailure(documentRef);

  assert.equal(elements.app.classList.contains('hidden'), true);
  assert.equal(elements.approvalScreen.classList.contains('hidden'), true);
  assert.equal(elements.authScreen.classList.contains('hidden'), false);
  assert.equal(elements.bootError.classList.contains('hidden'), false);
});
