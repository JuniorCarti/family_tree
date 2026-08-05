const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { performance } = require('node:perf_hooks');

const { computeTreeLayout } = require('../public/tree-layout');

function person(id) {
  return { id, first_name: id, last_name: 'Family' };
}

test('lays out spouses as one unit and places children in the next generation', () => {
  const persons = ['parent-a', 'parent-b', 'child-a', 'child-b'].map(person);
  const relationships = [
    { type: 'spouse', person1_id: 'parent-a', person2_id: 'parent-b' },
    { type: 'parent', person1_id: 'parent-a', person2_id: 'child-a' },
    { type: 'parent', person1_id: 'parent-b', person2_id: 'child-b' },
  ];

  const layout = computeTreeLayout(persons, relationships);
  const firstParent = layout.personPos.get('parent-a');
  const secondParent = layout.personPos.get('parent-b');
  const child = layout.personPos.get('child-a');

  assert.equal(layout.unitOf.get('parent-a'), layout.unitOf.get('parent-b'));
  assert.equal(secondParent.x - firstParent.x, 166);
  assert.equal(child.y - firstParent.y, 150);
  assert.equal(layout.personPos.size, persons.length);
  assert.equal(layout.unitChildren.get(layout.unitOf.get('parent-a')).size, 2);
});

test('returns every person even when malformed parent data contains a cycle', () => {
  const persons = ['a', 'b', 'c'].map(person);
  const relationships = [
    { type: 'parent', person1_id: 'a', person2_id: 'b' },
    { type: 'parent', person1_id: 'b', person2_id: 'c' },
    { type: 'parent', person1_id: 'c', person2_id: 'a' },
  ];

  const layout = computeTreeLayout(persons, relationships);

  assert.equal(layout.personPos.size, 3);
  for (const current of persons) {
    const position = layout.personPos.get(current.id);
    assert.ok(Number.isFinite(position.x));
    assert.ok(Number.isFinite(position.y));
  }
});

test('lays out a 5,000-person lineage without recursive stack growth', () => {
  const count = 5000;
  const persons = Array.from({ length: count }, (_, index) => person(`person-${index}`));
  const relationships = Array.from({ length: count - 1 }, (_, index) => ({
    type: 'parent',
    person1_id: `person-${index}`,
    person2_id: `person-${index + 1}`,
  }));
  const startedAt = performance.now();

  const layout = computeTreeLayout(persons, relationships);
  const durationMs = performance.now() - startedAt;

  assert.equal(layout.personPos.size, count);
  assert.equal(layout.unitGen.get(layout.unitOf.get('person-4999')), 4999);
  assert.ok(durationMs < 2000, `expected layout under 2s, received ${Math.round(durationMs)}ms`);
});

test('mobile tree source keeps resize cheap and enables native pointer gestures', () => {
  const appSource = readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const cssSource = readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');

  assert.match(appSource, /addEventListener\('pointerdown'/);
  assert.match(appSource, /startPinchGesture/);
  assert.match(appSource, /const MIN_ZOOM = 0\.01/);
  assert.match(appSource, /visualViewport\?\.addEventListener\('resize', queueTreeViewportResize/);
  assert.doesNotMatch(appSource, /addEventListener\('resize', \(\) => render\(\)\)/);
  assert.match(cssSource, /touch-action:\s*none/);
});
