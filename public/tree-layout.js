(function exposeTreeLayout(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LineageTreeLayout = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function computeTreeLayout(persons, relationships, options = {}) {
    const cardWidth = options.cardWidth ?? 152;
    const cardHeight = options.cardHeight ?? 64;
    const spouseGap = options.spouseGap ?? 14;
    const siblingGap = options.siblingGap ?? 36;
    const rowHeight = options.rowHeight ?? 150;
    const padding = options.padding ?? 80;
    const personIndex = new Map(persons.map((person, index) => [person.id, index]));
    const parent = new Map(persons.map((person) => [person.id, person.id]));

    function find(id) {
      let rootId = id;
      while (parent.get(rootId) !== rootId) rootId = parent.get(rootId);
      while (parent.get(id) !== id) {
        const next = parent.get(id);
        parent.set(id, rootId);
        id = next;
      }
      return rootId;
    }

    function union(firstId, secondId) {
      if (!parent.has(firstId) || !parent.has(secondId)) return;
      const firstRoot = find(firstId);
      const secondRoot = find(secondId);
      if (firstRoot !== secondRoot) parent.set(secondRoot, firstRoot);
    }

    for (const relationship of relationships) {
      if (relationship.type === 'spouse') union(relationship.person1_id, relationship.person2_id);
    }

    const groups = new Map();
    for (const person of persons) {
      const rootId = find(person.id);
      if (!groups.has(rootId)) groups.set(rootId, []);
      groups.get(rootId).push(person.id);
    }

    const units = new Map();
    const unitOf = new Map();
    let unitNumber = 0;
    for (const members of groups.values()) {
      members.sort((a, b) => personIndex.get(a) - personIndex.get(b));
      const unitId = `u${unitNumber++}`;
      units.set(unitId, { id: unitId, members });
      for (const memberId of members) unitOf.set(memberId, unitId);
    }

    const unitChildren = new Map();
    const unitParents = new Map();
    for (const unitId of units.keys()) {
      unitChildren.set(unitId, new Set());
      unitParents.set(unitId, new Set());
    }

    for (const relationship of relationships) {
      if (relationship.type !== 'parent') continue;
      const parentUnit = unitOf.get(relationship.person1_id);
      const childUnit = unitOf.get(relationship.person2_id);
      if (!parentUnit || !childUnit || parentUnit === childUnit) continue;
      unitChildren.get(parentUnit).add(childUnit);
      unitParents.get(childUnit).add(parentUnit);
    }

    const unitOrder = new Map([...units.keys()].map((unitId, index) => [unitId, index]));
    const layoutParent = new Map();
    const componentParent = new Map([...units.keys()].map((unitId) => [unitId, unitId]));

    function findComponent(unitId) {
      let rootId = unitId;
      while (componentParent.get(rootId) !== rootId) rootId = componentParent.get(rootId);
      while (componentParent.get(unitId) !== unitId) {
        const next = componentParent.get(unitId);
        componentParent.set(unitId, rootId);
        unitId = next;
      }
      return rootId;
    }

    function joinComponents(firstUnit, secondUnit) {
      const firstRoot = findComponent(firstUnit);
      const secondRoot = findComponent(secondUnit);
      if (firstRoot !== secondRoot) componentParent.set(secondRoot, firstRoot);
    }

    for (const unitId of units.keys()) {
      const candidates = [...unitParents.get(unitId)].sort((a, b) => unitOrder.get(a) - unitOrder.get(b));
      for (const candidate of candidates) {
        if (findComponent(unitId) !== findComponent(candidate)) {
          layoutParent.set(unitId, candidate);
          joinComponents(unitId, candidate);
          break;
        }
      }
    }

    const layoutChildren = new Map([...units.keys()].map((unitId) => [unitId, []]));
    for (const [childUnit, parentUnit] of layoutParent.entries()) layoutChildren.get(parentUnit).push(childUnit);
    for (const children of layoutChildren.values()) children.sort((a, b) => unitOrder.get(a) - unitOrder.get(b));

    const roots = [...units.keys()].filter((unitId) => !layoutParent.has(unitId));
    roots.sort((a, b) => unitOrder.get(a) - unitOrder.get(b));

    function memberWidth(unitId) {
      const memberCount = units.get(unitId).members.length;
      return memberCount * cardWidth + (memberCount - 1) * spouseGap;
    }

    const postOrder = [];
    const walkStack = roots.map((unitId) => ({ unitId, expanded: false })).reverse();
    while (walkStack.length) {
      const current = walkStack.pop();
      if (current.expanded) {
        postOrder.push(current.unitId);
        continue;
      }
      walkStack.push({ unitId: current.unitId, expanded: true });
      const children = layoutChildren.get(current.unitId);
      for (let index = children.length - 1; index >= 0; index--) {
        walkStack.push({ unitId: children[index], expanded: false });
      }
    }

    const subtreeWidths = new Map();
    for (const unitId of postOrder) {
      const children = layoutChildren.get(unitId);
      const childWidth = children.length
        ? children.reduce((total, childId) => total + subtreeWidths.get(childId), 0)
          + (children.length - 1) * siblingGap
        : 0;
      subtreeWidths.set(unitId, Math.max(memberWidth(unitId), childWidth));
    }

    const unitLeft = new Map();
    let rootCursor = padding;
    for (const rootId of roots) {
      unitLeft.set(rootId, rootCursor);
      rootCursor += subtreeWidths.get(rootId) + siblingGap * 1.6;
    }

    const placementStack = [...roots].reverse();
    while (placementStack.length) {
      const unitId = placementStack.pop();
      const children = layoutChildren.get(unitId);
      if (!children.length) continue;
      const childrenWidth = children.reduce((total, childId) => total + subtreeWidths.get(childId), 0)
        + (children.length - 1) * siblingGap;
      let childCursor = unitLeft.get(unitId) + Math.max(0, (subtreeWidths.get(unitId) - childrenWidth) / 2);
      for (const childId of children) {
        unitLeft.set(childId, childCursor);
        childCursor += subtreeWidths.get(childId) + siblingGap;
      }
      for (let index = children.length - 1; index >= 0; index--) placementStack.push(children[index]);
    }

    const unitX = new Map();
    for (const unitId of postOrder) {
      const children = layoutChildren.get(unitId);
      unitX.set(
        unitId,
        children.length
          ? (unitX.get(children[0]) + unitX.get(children[children.length - 1])) / 2
          : unitLeft.get(unitId) + subtreeWidths.get(unitId) / 2,
      );
    }

    const unitGen = new Map();
    const generationStack = roots.map((unitId) => ({ unitId, generation: 0 })).reverse();
    while (generationStack.length) {
      const { unitId, generation } = generationStack.pop();
      unitGen.set(unitId, generation);
      const children = layoutChildren.get(unitId);
      for (let index = children.length - 1; index >= 0; index--) {
        generationStack.push({ unitId: children[index], generation: generation + 1 });
      }
    }

    const personPos = new Map();
    for (const [unitId, unit] of units.entries()) {
      const totalWidth = memberWidth(unitId);
      let x = unitX.get(unitId) - totalWidth / 2;
      const y = padding + unitGen.get(unitId) * rowHeight;
      for (const memberId of unit.members) {
        personPos.set(memberId, { x, y, w: cardWidth, h: cardHeight });
        x += cardWidth + spouseGap;
      }
    }

    let maxX = 0;
    let maxY = 0;
    for (const position of personPos.values()) {
      maxX = Math.max(maxX, position.x + position.w);
      maxY = Math.max(maxY, position.y + position.h);
    }

    return {
      personPos,
      unitOf,
      units,
      unitChildren,
      unitParents,
      unitX,
      unitGen,
      width: maxX + padding,
      height: maxY + padding,
    };
  }

  return { computeTreeLayout };
}));
