const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { performance } = require('node:perf_hooks');

const {
  computeTreeLayout,
  buildRelationshipGraph,
  deriveRelationshipFacts,
  withDerivedRelationships,
  projectTree,
  shortestRelationshipPath,
  ancestorSlots,
} = require('../public/tree-layout');

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

test('projects pedigree, descendant, hourglass, and collapsed family branches', () => {
  const persons = [1, 2, 3, 4, 5, 6].map(person);
  const relationships = [
    { id: 1, type: 'parent', person1_id: 1, person2_id: 2 },
    { id: 2, type: 'parent', person1_id: 2, person2_id: 3 },
    { id: 3, type: 'spouse', person1_id: 3, person2_id: 6 },
    { id: 4, type: 'parent', person1_id: 3, person2_id: 4 },
    { id: 5, type: 'parent', person1_id: 4, person2_id: 5 },
  ];
  const graph = buildRelationshipGraph(persons, relationships);

  assert.deepEqual(
    [...projectTree(persons, relationships, { graph, focusId: 3, direction: 'ancestors', depth: 2 }).ids].sort(),
    [1, 2, 3, 6],
  );
  assert.deepEqual(
    [...projectTree(persons, relationships, { graph, focusId: 3, direction: 'descendants', depth: 1 }).ids].sort(),
    [3, 4, 6],
  );
  assert.equal(projectTree(persons, relationships, {
    graph,
    focusId: 3,
    direction: 'hourglass',
    depth: 2,
    collapsedIds: [4],
  }).ids.has(5), false);
});

test('finds the shortest relationship path and preserves its relationship edges', () => {
  const persons = [1, 2, 3, 4].map(person);
  const relationships = [
    { id: 1, type: 'parent', person1_id: 1, person2_id: 2 },
    { id: 2, type: 'spouse', person1_id: 2, person2_id: 3 },
    { id: 3, type: 'sibling', person1_id: 3, person2_id: 4 },
    { id: 4, type: 'relative', person1_id: 1, person2_id: 4 },
  ];

  const pathResult = shortestRelationshipPath(persons, relationships, 2, 4);

  assert.deepEqual(pathResult.people.map((item) => item.id), [2, 1, 4]);
  assert.deepEqual(pathResult.steps.map((step) => step.relationship.id), [1, 4]);
});

test('builds deterministic binary ancestor slots including unknown ancestors', () => {
  const persons = [
    { ...person(1), gender: 'unknown' },
    { ...person(2), gender: 'female' },
    { ...person(3), gender: 'male' },
    { ...person(4), gender: 'male' },
  ];
  const relationships = [
    { type: 'parent', person1_id: 2, person2_id: 1 },
    { type: 'parent', person1_id: 3, person2_id: 1 },
    { type: 'parent', person1_id: 4, person2_id: 3 },
  ];

  const slots = ancestorSlots(persons, relationships, 1, 2);

  assert.deepEqual(slots.levels[0], [1]);
  assert.deepEqual(slots.levels[1], [3, 2]);
  assert.deepEqual(slots.levels[2], [4, null, null, null]);
});

test('derives the complete kinship chain without creating database records', () => {
  const persons = [
    person(1), person(2), person(3), person(4), person(5),
  ];
  const relationships = [
    { type: 'parent', person1_id: 1, person2_id: 2 },
    { type: 'parent', person1_id: 1, person2_id: 3 },
    { type: 'parent', person1_id: 2, person2_id: 4 },
    { type: 'parent', person1_id: 3, person2_id: 5 },
  ];
  const derived = deriveRelationshipFacts(persons, relationships);
  const byPair = new Set(derived.map((item) => `${item.type}:${[item.person1_id, item.person2_id].sort((a, b) => a - b).join('-')}`));

  assert.ok(byPair.has('sibling:2-3'));
  assert.ok(byPair.has('grandparent:1-4'));
  assert.ok(byPair.has('grandparent:1-5'));
  assert.ok(byPair.has('aunt_uncle:3-4'));
  assert.ok(byPair.has('aunt_uncle:2-5'));
  assert.ok(byPair.has('cousin:4-5'));
  assert.ok(derived.every((item) => item.inferred === true && item.id === null));
  assert.equal(withDerivedRelationships(persons, relationships).length, relationships.length + derived.length);

  const cousinPath = shortestRelationshipPath(persons, relationships, 4, 5);
  assert.equal(cousinPath.steps[0].relationship.type, 'cousin');
});

test('exploration shell exposes every view, large-tree LOD, minimap, and accessible mobile controls', () => {
  const appSource = readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const explorerSource = readFileSync(path.join(__dirname, '..', 'public', 'explorer.js'), 'utf8');
  const htmlSource = readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const cssSource = readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');

  for (const view of ['family', 'pedigree', 'descendants', 'fan', 'hourglass', 'list', 'path', 'map']) {
    assert.match(htmlSource, new RegExp(`data-explorer-view="${view}"`));
  }
  assert.match(htmlSource, /id="treeMinimapSvg"/);
  assert.match(htmlSource, /id="shareTreeModalOverlay"/);
  assert.match(explorerSource, /shortestRelationshipPath/);
  assert.match(explorerSource, /ancestorSlots/);
  assert.match(explorerSource, /\/api\/exploration\/chart\.pdf/);
  assert.match(explorerSource, /\/api\/shared-tree\//);
  assert.match(appSource, /renderedPersons\.length > 300/);
  assert.match(appSource, /state\.zoom < 0\.075/);
  assert.match(appSource, /function renderMinimap/);
  assert.match(cssSource, /@media \(max-width: 430px\)/);
  assert.match(cssSource, /@media print/);
  assert.match(cssSource, /@media \(prefers-reduced-motion: reduce\)/);
});
