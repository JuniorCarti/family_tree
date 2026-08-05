// =============================================================================
// Family Tree — frontend application
// =============================================================================
const API = '/api';

const CARD_W = 152;
const CARD_H = 64;
const SPOUSE_GAP = 14;     // gap between spouse cards within a unit
const SIBLING_GAP = 36;    // gap between adjacent sibling units
const ROW_HEIGHT = 150;    // vertical distance between generations
const PADDING = 80;

let state = {
  persons: [],
  relationships: [],
  tree: null,
  selectedId: null,
  zoom: 1,
  panX: 0,
  panY: 0,
};

// ------------------------------------------------------------------ helpers
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function personById(id) {
  return state.persons.find((p) => p.id === id);
}
function fullName(p) {
  if (!p) return 'Unknown';
  return [p.first_name, p.last_name].filter(Boolean).join(' ');
}
function yearOf(dateStr) {
  if (!dateStr) return '?';
  const m = String(dateStr).match(/\d{4}/);
  return m ? m[0] : '?';
}
function dateRangeLabel(p) {
  const b = p.birth_date ? yearOf(p.birth_date) : '?';
  const d = p.death_date ? yearOf(p.death_date) : (p.death_date === null ? '' : '');
  if (p.death_date) return `${b} – ${d}`;
  return `b. ${b}`;
}
function initials(p) {
  const a = (p.first_name || '?')[0] || '';
  const b = (p.last_name || '')[0] || '';
  return (a + b).toUpperCase();
}

let currentUser = null;

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 401) {
    currentUser = null;
    $('#app').classList.add('hidden');
    $('#authScreen').classList.remove('hidden');
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ------------------------------------------------------------------ data load
async function loadTree() {
  const data = await api('/tree');
  state.persons = data.persons;
  state.relationships = data.relationships;
  state.tree = data.tree;
  $('#treeName').value = data.tree?.name || 'My Family Tree';
  $('#treeName').readOnly = !hasFamilyRole('admin');
  $('#personCount').textContent = `${state.persons.length} ${state.persons.length === 1 ? 'person' : 'people'}`;
  render();
}

// ------------------------------------------------------------------ relationship maps
function buildMaps() {
  const parentsOf = new Map();   // childId -> [parentIds]
  const childrenOf = new Map();  // parentId -> [childIds]
  const spousesOf = new Map();   // personId -> [spouseIds]
  const siblingsOf = new Map();
  const grandparentsOf = new Map();
  const grandchildrenOf = new Map();
  const auntUnclesOf = new Map();
  const nieceNephewsOf = new Map();
  const cousinsOf = new Map();
  const relativesOf = new Map();

  for (const p of state.persons) {
    parentsOf.set(p.id, []);
    childrenOf.set(p.id, []);
    spousesOf.set(p.id, []);
    siblingsOf.set(p.id, []);
    grandparentsOf.set(p.id, []);
    grandchildrenOf.set(p.id, []);
    auntUnclesOf.set(p.id, []);
    nieceNephewsOf.set(p.id, []);
    cousinsOf.set(p.id, []);
    relativesOf.set(p.id, []);
  }

  for (const r of state.relationships) {
    if (r.type === 'parent') {
      if (!childrenOf.has(r.person1_id)) childrenOf.set(r.person1_id, []);
      if (!parentsOf.has(r.person2_id)) parentsOf.set(r.person2_id, []);
      childrenOf.get(r.person1_id).push(r.person2_id);
      parentsOf.get(r.person2_id).push(r.person1_id);
    } else if (r.type === 'spouse') {
      if (!spousesOf.has(r.person1_id)) spousesOf.set(r.person1_id, []);
      if (!spousesOf.has(r.person2_id)) spousesOf.set(r.person2_id, []);
      spousesOf.get(r.person1_id).push(r.person2_id);
      spousesOf.get(r.person2_id).push(r.person1_id);
    } else if (r.type === 'sibling') {
      siblingsOf.get(r.person1_id).push(r.person2_id);
      siblingsOf.get(r.person2_id).push(r.person1_id);
    } else if (r.type === 'grandparent') {
      grandparentsOf.get(r.person2_id).push(r.person1_id);
      grandchildrenOf.get(r.person1_id).push(r.person2_id);
    } else if (r.type === 'grandchild') {
      grandchildrenOf.get(r.person2_id).push(r.person1_id);
      grandparentsOf.get(r.person1_id).push(r.person2_id);
    } else if (r.type === 'aunt_uncle') {
      auntUnclesOf.get(r.person2_id).push(r.person1_id);
      nieceNephewsOf.get(r.person1_id).push(r.person2_id);
    } else if (r.type === 'niece_nephew') {
      nieceNephewsOf.get(r.person2_id).push(r.person1_id);
      auntUnclesOf.get(r.person1_id).push(r.person2_id);
    } else if (r.type === 'cousin') {
      cousinsOf.get(r.person1_id).push(r.person2_id);
      cousinsOf.get(r.person2_id).push(r.person1_id);
    } else if (r.type === 'relative') {
      relativesOf.get(r.person1_id).push(r.person2_id);
      relativesOf.get(r.person2_id).push(r.person1_id);
    }
  }

  // Smart inference models
  // 1. Inferred siblings: share at least one parent
  for (const p of state.persons) {
    const parents = parentsOf.get(p.id) || [];
    for (const parentId of parents) {
      const kids = childrenOf.get(parentId) || [];
      for (const kidId of kids) {
        if (kidId !== p.id && !siblingsOf.get(p.id).includes(kidId)) {
          siblingsOf.get(p.id).push(kidId);
        }
      }
    }
  }

  // 2. Inferred grandparents
  for (const p of state.persons) {
    const parents = parentsOf.get(p.id) || [];
    for (const parentId of parents) {
      const gparents = parentsOf.get(parentId) || [];
      for (const gpId of gparents) {
        if (!grandparentsOf.get(p.id).includes(gpId)) {
          grandparentsOf.get(p.id).push(gpId);
        }
      }
    }
  }

  // 3. Inferred grandchildren
  for (const p of state.persons) {
    const children = childrenOf.get(p.id) || [];
    for (const childId of children) {
      const gchildren = childrenOf.get(childId) || [];
      for (const gcId of gchildren) {
        if (!grandchildrenOf.get(p.id).includes(gcId)) {
          grandchildrenOf.get(p.id).push(gcId);
        }
      }
    }
  }

  // 4. Inferred aunts / uncles
  for (const p of state.persons) {
    const parents = parentsOf.get(p.id) || [];
    for (const parentId of parents) {
      const siblings = siblingsOf.get(parentId) || [];
      for (const sibId of siblings) {
        if (!auntUnclesOf.get(p.id).includes(sibId)) {
          auntUnclesOf.get(p.id).push(sibId);
        }
      }
    }
  }

  // 5. Inferred nieces / nephews
  for (const p of state.persons) {
    const siblings = siblingsOf.get(p.id) || [];
    for (const sibId of siblings) {
      const kids = childrenOf.get(sibId) || [];
      for (const kidId of kids) {
        if (!nieceNephewsOf.get(p.id).includes(kidId)) {
          nieceNephewsOf.get(p.id).push(kidId);
        }
      }
    }
  }

  // 6. Inferred cousins
  for (const p of state.persons) {
    const parents = parentsOf.get(p.id) || [];
    for (const parentId of parents) {
      const siblings = siblingsOf.get(parentId) || [];
      for (const sibId of siblings) {
        const kids = childrenOf.get(sibId) || [];
        for (const kidId of kids) {
          if (kidId !== p.id && !cousinsOf.get(p.id).includes(kidId)) {
            cousinsOf.get(p.id).push(kidId);
          }
        }
      }
    }
  }

  return {
    parentsOf, childrenOf, spousesOf,
    siblingsOf, grandparentsOf, grandchildrenOf,
    auntUnclesOf, nieceNephewsOf, cousinsOf, relativesOf
  };
}

// ------------------------------------------------------------------ union-find for spouse units
function buildUnits(spousesOf) {
  const parent = new Map(state.persons.map((p) => [p.id, p.id]));
  function find(x) { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; }
  function union(a, b) { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); }

  for (const [a, spouses] of spousesOf.entries()) {
    for (const b of spouses) union(a, b);
  }

  const groups = new Map(); // rootId -> [memberIds]
  for (const p of state.persons) {
    const root = find(p.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(p.id);
  }

  const unitOf = new Map(); // personId -> unitId (use root id as unit id)
  const units = new Map(); // unitId -> { id, members: [] }
  let i = 0;
  for (const [root, members] of groups.entries()) {
    // sort members: keep stable order by original person order
    members.sort((a, b) => state.persons.findIndex(p => p.id === a) - state.persons.findIndex(p => p.id === b));
    const unitId = `u${i++}`;
    units.set(unitId, { id: unitId, members });
    for (const m of members) unitOf.set(m, unitId);
  }
  return { units, unitOf };
}

// ------------------------------------------------------------------ generation computation
function computeGenerations(parentsOf, spousesOf) {
  const gen = new Map();
  const ids = state.persons.map((p) => p.id);
  for (const id of ids) gen.set(id, 0);

  // iterative relaxation: gen(child) >= max(gen(parent))+1 ; spouses share max gen
  let changed = true;
  let iterations = 0;
  while (changed && iterations < ids.length + 20) {
    changed = false;
    iterations++;
    for (const r of state.relationships) {
      if (r.type === 'parent') {
        const need = gen.get(r.person1_id) + 1;
        if (gen.get(r.person2_id) < need) { gen.set(r.person2_id, need); changed = true; }
      }
    }
    for (const [a, spouses] of spousesOf.entries()) {
      for (const b of spouses) {
        const m = Math.max(gen.get(a), gen.get(b));
        if (gen.get(a) < m) { gen.set(a, m); changed = true; }
        if (gen.get(b) < m) { gen.set(b, m); changed = true; }
      }
    }
  }
  return gen;
}

// ------------------------------------------------------------------ layout (positions in px)
function computeLayout() {
  const { parentsOf, childrenOf, spousesOf } = buildMaps();
  const { units, unitOf } = buildUnits(spousesOf);
  const personGen = computeGenerations(parentsOf, spousesOf);

  // unit generation = min gen among members (should be equal after equalization)
  const unitGen = new Map();
  for (const [uid, u] of units.entries()) {
    unitGen.set(uid, Math.min(...u.members.map((m) => personGen.get(m))));
  }

  // unit -> child units (dedup), and unit -> parent units (dedup)
  const unitChildren = new Map();
  const unitParents = new Map();
  for (const uid of units.keys()) { unitChildren.set(uid, new Set()); unitParents.set(uid, new Set()); }

  for (const [uid, u] of units.entries()) {
    for (const m of u.members) {
      for (const c of (childrenOf.get(m) || [])) {
        const cu = unitOf.get(c);
        if (cu && cu !== uid) unitChildren.get(uid).add(cu);
      }
      for (const par of (parentsOf.get(m) || [])) {
        const pu = unitOf.get(par);
        if (pu && pu !== uid) unitParents.get(uid).add(pu);
      }
    }
  }

  // choose one "layout parent" per unit to build a spanning forest for x-positioning
  const layoutParent = new Map(); // childUnit -> parentUnit
  const layoutChildren = new Map(); // parentUnit -> [childUnits] (ordered)
  for (const uid of units.keys()) layoutChildren.set(uid, []);

  for (const [uid, parents] of unitParents.entries()) {
    if (parents.size > 0) {
      const chosen = [...parents][0];
      layoutParent.set(uid, chosen);
    }
  }
  for (const [child, parent] of layoutParent.entries()) {
    layoutChildren.get(parent).push(child);
  }
  // order children by their own id for stable determinism
  for (const [k, arr] of layoutChildren.entries()) {
    arr.sort();
  }

  const rootUnits = [...units.keys()].filter((uid) => !layoutParent.has(uid));
  // stable order roots by min member's original index
  rootUnits.sort((a, b) => {
    const ai = Math.min(...units.get(a).members.map(m => state.persons.findIndex(p => p.id === m)));
    const bi = Math.min(...units.get(b).members.map(m => state.persons.findIndex(p => p.id === m)));
    return ai - bi;
  });

  function memberWidth(uid) {
    const n = units.get(uid).members.length;
    return n * CARD_W + (n - 1) * SPOUSE_GAP;
  }

  function subtreeWidth(uid) {
    const kids = layoutChildren.get(uid) || [];
    if (kids.length === 0) return memberWidth(uid);
    const kidsWidth = kids.reduce((sum, k) => sum + subtreeWidth(k), 0) + (kids.length - 1) * SIBLING_GAP;
    return Math.max(memberWidth(uid), kidsWidth);
  }

  const unitX = new Map(); // center x
  function placeUnit(uid, leftBound) {
    const kids = layoutChildren.get(uid) || [];
    const myWidth = subtreeWidth(uid);
    if (kids.length === 0) {
      unitX.set(uid, leftBound + myWidth / 2);
      return leftBound + myWidth;
    }
    let cursor = leftBound + Math.max(0, (myWidth - (kids.reduce((s, k) => s + subtreeWidth(k), 0) + (kids.length - 1) * SIBLING_GAP)) / 2);
    const childCenters = [];
    for (const k of kids) {
      const w = subtreeWidth(k);
      placeUnit(k, cursor);
      childCenters.push(unitX.get(k));
      cursor += w + SIBLING_GAP;
    }
    unitX.set(uid, (childCenters[0] + childCenters[childCenters.length - 1]) / 2);
    return leftBound + myWidth;
  }

  let cursor = PADDING;
  for (const r of rootUnits) {
    const w = subtreeWidth(r);
    placeUnit(r, cursor);
    cursor += w + SIBLING_GAP * 1.6;
  }

  // person positions
  const personPos = new Map(); // id -> {x, y, w, h}
  for (const [uid, u] of units.entries()) {
    const cx = unitX.get(uid) ?? PADDING;
    const gen = unitGen.get(uid) ?? 0;
    const totalW = memberWidth(uid);
    let x = cx - totalW / 2;
    const y = PADDING + gen * ROW_HEIGHT;
    for (const m of u.members) {
      personPos.set(m, { x, y, w: CARD_W, h: CARD_H });
      x += CARD_W + SPOUSE_GAP;
    }
  }

  // bounds
  let maxX = 0, maxY = 0;
  for (const pos of personPos.values()) {
    maxX = Math.max(maxX, pos.x + pos.w);
    maxY = Math.max(maxY, pos.y + pos.h);
  }

  return { personPos, unitOf, units, unitChildren, unitParents, unitX, unitGen, width: maxX + PADDING, height: maxY + PADDING };
}

// ------------------------------------------------------------------ rendering
function render() {
  const hasPeople = state.persons.length > 0;
  $('#emptyState').classList.toggle('hidden', hasPeople);
  if (!hasPeople) {
    $('#treeSvg').innerHTML = '';
    return;
  }

  const layout = computeLayout();
  const svg = $('#treeSvg');
  svg.setAttribute('width', Math.max(layout.width, window.innerWidth));
  svg.setAttribute('height', Math.max(layout.height, window.innerHeight - 60));
  svg.innerHTML = '';

  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('id', 'viewport');
  g.setAttribute('transform', `translate(${state.panX},${state.panY}) scale(${state.zoom})`);
  svg.appendChild(g);

  const connLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  connLayer.setAttribute('class', 'connectors');
  g.appendChild(connLayer);

  const cardLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.appendChild(cardLayer);

  // ---- extended connectors (siblings, grandparents, relatives, etc) ----
  for (const r of state.relationships) {
    if (['relative', 'sibling', 'grandparent', 'grandchild', 'aunt_uncle', 'niece_nephew', 'cousin'].includes(r.type)) {
      const a = layout.personPos.get(r.person1_id);
      const b = layout.personPos.get(r.person2_id);
      if (a && b) {
        drawArc(connLayer, a.x + a.w / 2, a.y + a.h / 2, b.x + b.w / 2, b.y + b.h / 2, r.type);
      }
    }
  }

  // ---- spouse connectors (within a unit) ----
  for (const [uid, u] of layout.units.entries()) {
    if (u.members.length < 2) continue;
    for (let i = 0; i < u.members.length - 1; i++) {
      const a = layout.personPos.get(u.members[i]);
      const b = layout.personPos.get(u.members[i + 1]);
      const y = a.y + a.h / 2;
      drawLine(connLayer, a.x + a.w, y, b.x, y, 'spouse');
    }
  }

  // ---- parent-child connectors (unit to unit, elbow style) ----
  for (const [uid, childSet] of layout.unitChildren.entries()) {
    const pUnit = layout.units.get(uid);
    const pMembers = pUnit.members.map((m) => layout.personPos.get(m));
    const pxCenter = layout.unitX.get(uid);
    const pyBottom = Math.max(...pMembers.map((m) => m.y + m.h));

    for (const cuid of childSet) {
      const cUnit = layout.units.get(cuid);
      const cMembers = cUnit.members.map((m) => layout.personPos.get(m));
      const cxCenter = layout.unitX.get(cuid);
      const cyTop = Math.min(...cMembers.map((m) => m.y));
      const midY = pyBottom + (cyTop - pyBottom) / 2;
      drawElbow(connLayer, pxCenter, pyBottom, cxCenter, cyTop, midY);
    }
  }

  // ---- cards ----
  for (const p of state.persons) {
    const pos = layout.personPos.get(p.id);
    if (!pos) continue;
    cardLayer.appendChild(makeCardNode(p, pos));
  }
}

// Colour + dash palette keyed by relationship type
const REL_STYLE = {
  spouse: { stroke: '#b8863b', width: 2.4, dash: null },
  parent: { stroke: '#b3a077', width: 1.8, dash: null },
  sibling: { stroke: '#5b8dd9', width: 2, dash: '8,5' },
  grandparent: { stroke: '#8b5cf6', width: 2, dash: '10,4' },
  grandchild: { stroke: '#8b5cf6', width: 2, dash: '10,4' },
  aunt_uncle: { stroke: '#ec4899', width: 1.8, dash: '6,4,2,4' },
  niece_nephew: { stroke: '#ec4899', width: 1.8, dash: '6,4,2,4' },
  cousin: { stroke: '#14b8a6', width: 1.8, dash: '5,5' },
  relative: { stroke: '#94a3b8', width: 1.8, dash: '4,6' },
};

function drawArc(layer, x1, y1, x2, y2, kind) {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

  // Decide how far up/down the arc should bow based on horizontal distance
  const dist = Math.abs(x1 - x2);
  const midX = (x1 + x2) / 2;
  // If they are on the same generation (y is close), arc above or below
  // For larger trees, just arc upwards heavily to avoid the generation below
  const bow = Math.min(dist * 0.4, 300); // the wider they are, the higher the arc, capped at 300px

  const cy = Math.min(y1, y2) - bow - 30; // Control point is higher than both

  const d = `M ${x1} ${y1} Q ${midX} ${cy} ${x2} ${y2}`;
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');

  const s = REL_STYLE[kind] || REL_STYLE.relative;
  path.setAttribute('stroke', s.stroke);
  path.setAttribute('stroke-width', s.width);
  if (s.dash) path.setAttribute('stroke-dasharray', s.dash);
  layer.appendChild(path);
}

function drawLine(layer, x1, y1, x2, y2, kind) {
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', x1); line.setAttribute('y1', y1);
  line.setAttribute('x2', x2); line.setAttribute('y2', y2);
  const s = REL_STYLE[kind] || REL_STYLE.relative;
  line.setAttribute('stroke', s.stroke);
  line.setAttribute('stroke-width', s.width);
  if (s.dash) line.setAttribute('stroke-dasharray', s.dash);
  layer.appendChild(line);
}

function drawElbow(layer, x1, y1, x2, y2, midY) {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  const d = `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#b3a077');
  path.setAttribute('stroke-width', 1.8);
  layer.appendChild(path);
}

function makeCardNode(p, pos) {
  const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
  fo.setAttribute('x', pos.x);
  fo.setAttribute('y', pos.y);
  fo.setAttribute('width', pos.w);
  fo.setAttribute('height', pos.h);

  const div = document.createElement('div');
  const genderClass = p.gender === 'male' ? 'gender-male' : p.gender === 'female' ? 'gender-female' : '';
  const deceasedClass = p.death_date ? 'deceased' : '';
  const selectedClass = state.selectedId === p.id ? 'selected' : '';
  div.className = `person-card ${genderClass} ${deceasedClass} ${selectedClass}`.trim();
  div.dataset.personId = p.id;

  const avatar = document.createElement('div');
  avatar.className = 'person-avatar';
  if (p.photo_url) {
    avatar.style.backgroundImage = `url(${p.photo_url})`;
    avatar.textContent = '';
  } else {
    avatar.textContent = initials(p);
  }

  const text = document.createElement('div');
  text.className = 'person-text';
  const nameEl = document.createElement('div');
  nameEl.className = 'person-name';
  nameEl.textContent = fullName(p);
  const datesEl = document.createElement('div');
  datesEl.className = 'person-dates';
  datesEl.textContent = dateRangeLabel(p);
  text.appendChild(nameEl);
  text.appendChild(datesEl);

  const addBtn = document.createElement('div');
  addBtn.className = 'card-add-btn';
  addBtn.textContent = '+';
  addBtn.title = 'Add a relative';
  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openAddRelativeMenu(p);
  });

  div.appendChild(avatar);
  div.appendChild(text);
  div.appendChild(addBtn);

  div.addEventListener('click', () => selectPerson(p.id));

  fo.appendChild(div);
  return fo;
}

// ------------------------------------------------------------------ selection & side panel
function selectPerson(id) {
  state.selectedId = id;
  render();
  openSidePanel(id);
}

function openSidePanel(id) {
  const p = personById(id);
  if (!p) return;
  const {
    parentsOf, childrenOf, spousesOf,
    siblingsOf, grandparentsOf, grandchildrenOf,
    auntUnclesOf, nieceNephewsOf, cousinsOf, relativesOf
  } = buildMaps();

  const panel = $('#sidePanel');
  panel.classList.remove('hidden');

  const parents = (parentsOf.get(id) || []).map(personById).filter(Boolean);
  const children = (childrenOf.get(id) || []).map(personById).filter(Boolean);
  const spouses = (spousesOf.get(id) || []).map(personById).filter(Boolean);
  const siblings = (siblingsOf.get(id) || []).map(personById).filter(Boolean);
  const grandparents = (grandparentsOf.get(id) || []).map(personById).filter(Boolean);
  const grandchildren = (grandchildrenOf.get(id) || []).map(personById).filter(Boolean);

  // Relatives combines aunt_uncle, niece_nephew, cousin, relative
  const relativeIds = new Set([
    ...(auntUnclesOf.get(id) || []),
    ...(nieceNephewsOf.get(id) || []),
    ...(cousinsOf.get(id) || []),
    ...(relativesOf.get(id) || [])
  ]);
  const relatives = [...relativeIds].map(personById).filter(Boolean);

  const avatarStyle = p.photo_url ? `background-image:url(${p.photo_url})` : '';

  $('#sidePanelContent').innerHTML = `
    <div class="panel-avatar" style="${avatarStyle || (p.gender === 'male' ? 'background-color:var(--male)' : p.gender === 'female' ? 'background-color:var(--female)' : '')}">${p.photo_url ? '' : initials(p)}</div>
    <h2 class="panel-name">${escapeHtml(fullName(p))}${p.maiden_name ? ` <span style="font-weight:400;font-size:14px;color:var(--ink-soft)">(née ${escapeHtml(p.maiden_name)})</span>` : ''}</h2>
    <div class="panel-meta">${p.birth_date ? 'Born ' + escapeHtml(p.birth_date) : 'Birth date unknown'}${p.death_date ? ' · Died ' + escapeHtml(p.death_date) : ''}</div>
    ${p.birth_place ? `<div class="panel-place">📍 ${escapeHtml(p.birth_place)}</div>` : ''}
    ${p.notes ? `<div class="panel-notes">${escapeHtml(p.notes)}</div>` : ''}

    <div class="panel-actions">
      <button class="btn btn-ghost" id="editPersonBtn">Edit</button>
      <button class="btn btn-ghost" id="focusPersonBtn">Center in view</button>
    </div>

    ${relSection('Parents', parents, id, 'parent_of_target')}
    ${relSection('Spouse / Partner', spouses, id, 'spouse_of_target')}
    ${relSection('Children', children, id, 'child_of_target')}
    ${relSection('Siblings', siblings, id, 'sibling_of_target')}
    ${relSection('Grandparents', grandparents, id, 'grandparent_of_target')}
    ${relSection('Grandchildren', grandchildren, id, 'grandchild_of_target')}
    ${relSection('Relatives', relatives, id, 'relative_of_target')}
  `;

  $('#editPersonBtn').addEventListener('click', () => openPersonModal(p));
  $('#focusPersonBtn').addEventListener('click', () => centerOnPerson(id));

  panel.querySelectorAll('.rel-name').forEach((el) => {
    el.addEventListener('click', () => {
      const targetId = Number(el.dataset.id);
      selectPerson(targetId);
      centerOnPerson(targetId);
    });
  });
  panel.querySelectorAll('.rel-remove').forEach((el) => {
    el.addEventListener('click', async () => {
      await api(`/relationships/${el.dataset.relId}`, { method: 'DELETE' });
      await loadTree();
      openSidePanel(id);
    });
  });
  panel.querySelectorAll('.quick-add-btn').forEach((el) => {
    el.addEventListener('click', () => {
      const kind = el.dataset.kind;
      // Allow adding these directly now since they draw as dashed lines
      openPersonModal(null, { relationType: kind, relatedPersonId: id });
    });
  });
}

function relSection(title, list, forId, addKind) {
  const items = list.map((r) => {
    const relId = findRelationshipId(forId, r.id, addKind);
    const removeLink = relId ? `<button class="rel-remove" data-rel-id="${relId}" title="Remove connection">remove</button>` : '<span class="rel-inferred" title="Inferred relationship (cannot be removed directly)">inferred</span>';
    return `<div class="rel-list-item">
      <span class="rel-name" data-id="${r.id}">${escapeHtml(fullName(r))}</span>
      ${removeLink}
    </div>`;
  }).join('') || `<div style="font-size:12.5px;color:var(--ink-soft);">None recorded</div>`;

  const selectValue = addKind === 'parent_of_target' ? 'parent_of'
    : addKind === 'spouse_of_target' ? 'spouse_of'
      : addKind === 'child_of_target' ? 'child_of'
        : addKind === 'sibling_of_target' ? 'sibling_of'
          : addKind === 'grandparent_of_target' ? 'grandparent_of'
            : addKind === 'grandchild_of_target' ? 'grandchild_of'
              : 'relative_of';
  return `
    <div class="panel-section-title">${title}</div>
    ${items}
    <div class="quick-add-row">
      <button class="btn btn-ghost quick-add-btn" data-kind="${selectValue}" style="width:100%;">+ Add ${title.toLowerCase().replace(' / partner', '/partner')}</button>
    </div>
  `;
}

function findRelationshipId(personId, otherId, addKind) {
  for (const r of state.relationships) {
    if (r.type === 'parent') {
      if (addKind === 'parent_of_target' && r.person1_id === otherId && r.person2_id === personId) return r.id;
      if (addKind === 'child_of_target' && r.person1_id === personId && r.person2_id === otherId) return r.id;
    } else if (r.type === 'spouse') {
      if (addKind === 'spouse_of_target' && ((r.person1_id === personId && r.person2_id === otherId) || (r.person1_id === otherId && r.person2_id === personId))) return r.id;
    } else if (r.type === 'sibling') {
      if (addKind === 'sibling_of_target' && ((r.person1_id === personId && r.person2_id === otherId) || (r.person1_id === otherId && r.person2_id === personId))) return r.id;
    } else if (r.type === 'grandparent') {
      if (addKind === 'grandparent_of_target' && r.person1_id === otherId && r.person2_id === personId) return r.id;
      if (addKind === 'grandchild_of_target' && r.person1_id === personId && r.person2_id === otherId) return r.id;
    } else if (r.type === 'grandchild') {
      if (addKind === 'grandchild_of_target' && r.person1_id === otherId && r.person2_id === personId) return r.id;
      if (addKind === 'grandparent_of_target' && r.person1_id === personId && r.person2_id === otherId) return r.id;
    } else if (r.type === 'aunt_uncle') {
      if (addKind === 'relative_of_target' && r.person1_id === otherId && r.person2_id === personId) return r.id;
    } else if (r.type === 'niece_nephew') {
      if (addKind === 'relative_of_target' && r.person1_id === otherId && r.person2_id === personId) return r.id;
    } else if (r.type === 'cousin') {
      if (addKind === 'relative_of_target' && ((r.person1_id === personId && r.person2_id === otherId) || (r.person1_id === otherId && r.person2_id === personId))) return r.id;
    } else if (r.type === 'relative') {
      if (addKind === 'relative_of_target' && ((r.person1_id === personId && r.person2_id === otherId) || (r.person1_id === otherId && r.person2_id === personId))) return r.id;
    }
  }
  return '';
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

$('#closePanelBtn').addEventListener('click', () => {
  $('#sidePanel').classList.add('hidden');
  state.selectedId = null;
  render();
});

// ------------------------------------------------------------------ pan / zoom
let isDragging = false, dragStart = { x: 0, y: 0 }, panStart = { x: 0, y: 0 };

const canvasWrap = $('#canvasWrap');
canvasWrap.addEventListener('mousedown', (e) => {
  if (e.target.closest('.person-card')) return;
  isDragging = true;
  canvasWrap.classList.add('dragging');
  dragStart = { x: e.clientX, y: e.clientY };
  panStart = { x: state.panX, y: state.panY };
});
window.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  state.panX = panStart.x + (e.clientX - dragStart.x);
  state.panY = panStart.y + (e.clientY - dragStart.y);
  applyTransformOnly();
});
window.addEventListener('mouseup', () => { isDragging = false; canvasWrap.classList.remove('dragging'); });

function applyTransformOnly() {
  const vp = $('#viewport');
  if (vp) vp.setAttribute('transform', `translate(${state.panX},${state.panY}) scale(${state.zoom})`);
}

$('#zoomInBtn').addEventListener('click', () => { state.zoom = Math.min(state.zoom + 0.1, 2); applyTransformOnly(); });
$('#zoomOutBtn').addEventListener('click', () => { state.zoom = Math.max(state.zoom - 0.1, 0.3); applyTransformOnly(); });
$('#resetViewBtn').addEventListener('click', () => { state.zoom = 1; state.panX = 0; state.panY = 0; applyTransformOnly(); });

canvasWrap.addEventListener('wheel', (e) => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  const delta = e.deltaY > 0 ? -0.05 : 0.05;
  state.zoom = Math.min(2, Math.max(0.3, state.zoom + delta));
  applyTransformOnly();
}, { passive: false });

function centerOnPerson(id) {
  const layout = computeLayout();
  const pos = layout.personPos.get(id);
  if (!pos) return;
  const wrapRect = canvasWrap.getBoundingClientRect();
  state.panX = wrapRect.width / 2 - (pos.x + pos.w / 2) * state.zoom;
  state.panY = wrapRect.height / 2 - (pos.y + pos.h / 2) * state.zoom;
  applyTransformOnly();
}

// ------------------------------------------------------------------ search
const searchInput = $('#searchInput');
searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim().toLowerCase();
  const results = $('#searchResults');
  if (!q) { results.classList.add('hidden'); results.innerHTML = ''; return; }
  const matches = state.persons.filter((p) => fullName(p).toLowerCase().includes(q)).slice(0, 8);
  if (matches.length === 0) {
    results.innerHTML = `<div class="search-result-item">No matches</div>`;
  } else {
    results.innerHTML = matches.map((p) => `
      <div class="search-result-item" data-id="${p.id}">
        <span>${escapeHtml(fullName(p))}</span>
        <span class="meta">${dateRangeLabel(p)}</span>
      </div>`).join('');
  }
  results.classList.remove('hidden');
  results.querySelectorAll('.search-result-item[data-id]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = Number(el.dataset.id);
      selectPerson(id);
      centerOnPerson(id);
      results.classList.add('hidden');
      searchInput.value = '';
    });
  });
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-wrap')) $('#searchResults').classList.add('hidden');
});

// ------------------------------------------------------------------ tree name
$('#treeName').addEventListener('change', async () => {
  await api('/tree', { method: 'PUT', body: JSON.stringify({ name: $('#treeName').value }) });
});

// ------------------------------------------------------------------ Add/Edit person modal
let modalContext = { editingId: null, relationType: '', relatedPersonId: null, selectedExistingId: null };

function openPersonModal(person, prefill = {}) {
  modalContext = { editingId: person ? person.id : null, relationType: prefill.relationType || '', relatedPersonId: prefill.relatedPersonId || null, selectedExistingId: null };

  $('#personModalTitle').textContent = person ? 'Edit person' : 'Add a person';
  $('#f_first_name').value = person?.first_name || '';
  $('#f_last_name').value = person?.last_name || '';
  $('#f_maiden_name').value = person?.maiden_name || '';
  $('#f_gender').value = person?.gender || 'unknown';
  $('#f_birth_date').value = person?.birth_date || '';
  $('#f_death_date').value = person?.death_date || '';
  $('#f_birth_place').value = person?.birth_place || '';
  $('#f_notes').value = person?.notes || '';
  $('#photoInput').value = '';
  const preview = $('#photoPreview');
  if (person?.photo_url) {
    preview.src = person.photo_url;
    preview.classList.remove('hidden');
    $('#photoPlaceholder').classList.add('hidden');
  } else {
    preview.classList.add('hidden');
    $('#photoPlaceholder').classList.remove('hidden');
  }
  preview.dataset.url = person?.photo_url || '';

  $('#deletePersonBtn').classList.toggle('hidden', !person);

  // Search section handling
  const isAddingNew = !person;
  $('#existingPersonSearchSection').classList.toggle('hidden', !isAddingNew);
  $('#existingPersonSearchInput').value = '';
  $('#existingPersonSearchResults').classList.add('hidden');
  $('#selectedExistingPersonView').classList.add('hidden');
  $('#newPersonFields').classList.remove('hidden');

  // relation section: only relevant when adding a brand-new person
  const relSectionEl = $('#relationSection');
  relSectionEl.classList.toggle('hidden', !!person);
  populateRelationPersonSelect();

  // NEVER autoselect relationship type - keep it empty
  if (modalContext.relationType) {
    $('#f_relation_type').value = modalContext.relationType;
  } else {
    $('#f_relation_type').value = '';
  }

  $('#relativeLabelRow').classList.toggle('hidden', $('#f_relation_type').value !== 'relative_of');
  $('#f_relation_label').value = '';

  if (modalContext.relatedPersonId) {
    $('#f_relation_person').value = modalContext.relatedPersonId;
  } else {
    $('#f_relation_person').value = '';
  }

  $('#personModalOverlay').classList.remove('hidden');
}

// Add event handlers for existing person search
const epsInput = $('#existingPersonSearchInput');
epsInput.addEventListener('input', () => {
  const q = epsInput.value.trim().toLowerCase();
  const results = $('#existingPersonSearchResults');
  if (!q) { results.classList.add('hidden'); results.innerHTML = ''; return; }

  let possible = state.persons;
  if (modalContext.relatedPersonId) {
    possible = possible.filter(p => p.id !== modalContext.relatedPersonId);
  }

  const matches = possible.filter((p) => fullName(p).toLowerCase().includes(q)).slice(0, 8);
  if (matches.length === 0) {
    results.innerHTML = `<div class="search-result-item" style="color:var(--ink-soft)">No existing people found</div>`;
  } else {
    results.innerHTML = matches.map((p) => `
      <div class="search-result-item" data-id="${p.id}">
        <span>${escapeHtml(fullName(p))}</span>
        <span class="meta">${dateRangeLabel(p)}</span>
      </div>`).join('');
  }
  results.classList.remove('hidden');
  results.querySelectorAll('.search-result-item[data-id]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = Number(el.dataset.id);
      const p = personById(id);
      modalContext.selectedExistingId = id;

      $('#selectedExistingName').textContent = fullName(p);
      $('#selectedExistingDetails').textContent = [dateRangeLabel(p), p.birth_place].filter(Boolean).join(' · ');

      $('#existingPersonSearchSection').classList.add('hidden');
      $('#selectedExistingPersonView').classList.remove('hidden');
      $('#newPersonFields').classList.add('hidden');
      results.classList.add('hidden');
    });
  });
});

$('#clearSelectedBtn').addEventListener('click', () => {
  modalContext.selectedExistingId = null;
  $('#existingPersonSearchSection').classList.remove('hidden');
  $('#selectedExistingPersonView').classList.add('hidden');
  $('#newPersonFields').classList.remove('hidden');
  $('#existingPersonSearchInput').value = '';
});

function populateRelationPersonSelect() {
  const sel = $('#f_relation_person');
  const options = state.persons
    .sort((a, b) => fullName(a).localeCompare(fullName(b)))
    .map((p) => `<option value="${p.id}">${escapeHtml(fullName(p))}</option>`).join('');
  sel.innerHTML = '<option value="">Select a person…</option>' + options;
}

$('#addPersonBtn').addEventListener('click', () => openPersonModal(null));
$('#emptyAddBtn').addEventListener('click', () => openPersonModal(null));
$('#personModalClose').addEventListener('click', closePersonModal);
$('#cancelPersonBtn').addEventListener('click', closePersonModal);
function closePersonModal() { $('#personModalOverlay').classList.add('hidden'); }

$('#photoDrop').addEventListener('click', () => $('#photoInput').click());
$('#photoInput').addEventListener('change', async () => {
  const file = $('#photoInput').files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('photo', file);
  const res = await fetch(`${API}/upload`, { method: 'POST', body: fd });
  const data = await res.json();
  if (data.url) {
    $('#photoPreview').src = data.url;
    $('#photoPreview').dataset.url = data.url;
    $('#photoPreview').classList.remove('hidden');
    $('#photoPlaceholder').classList.add('hidden');
  }
});

function openAddRelativeMenu(person) {
  // Prefill the connection target but leave the relationship direction for the
  // user to choose explicitly (parent/child/spouse are not interchangeable).
  openPersonModal(null, { relationType: '', relatedPersonId: person.id });
}

$('#personForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const relType = $('#f_relation_type').value;
  const relatedVal = $('#f_relation_person').value;
  if (!modalContext.editingId) {
    if (relType && !relatedVal) {
      alert('Please select a family member for the relationship.');
      return;
    }
    if (!relType && relatedVal) {
      alert('Please select a relationship type.');
      return;
    }
    if (modalContext.selectedExistingId && (!relType || !relatedVal)) {
      alert('You selected an existing person, so you must select a relationship to link them to the tree.');
      return;
    }
  }

  let personId = modalContext.editingId;

  try {
    if (modalContext.selectedExistingId) {
      // Just linking an existing person
      personId = modalContext.selectedExistingId;
    } else if (!modalContext.editingId) {
      // Creating NEW person
      const payload = {
        first_name: $('#f_first_name').value.trim(),
        last_name: $('#f_last_name').value.trim(),
        maiden_name: $('#f_maiden_name').value.trim(),
        gender: $('#f_gender').value,
        birth_date: $('#f_birth_date').value || null,
        death_date: $('#f_death_date').value || null,
        birth_place: $('#f_birth_place').value.trim() || null,
        notes: $('#f_notes').value.trim() || null,
        photo_url: $('#photoPreview').dataset.url || null,
      };
      if (!payload.first_name) return;
      const person = await api('/persons', { method: 'POST', body: JSON.stringify(payload) });
      personId = person.id;
    } else {
      // Editing existing person
      const payload = {
        first_name: $('#f_first_name').value.trim(),
        last_name: $('#f_last_name').value.trim(),
        maiden_name: $('#f_maiden_name').value.trim(),
        gender: $('#f_gender').value,
        birth_date: $('#f_birth_date').value || null,
        death_date: $('#f_death_date').value || null,
        birth_place: $('#f_birth_place').value.trim() || null,
        notes: $('#f_notes').value.trim() || null,
        photo_url: $('#photoPreview').dataset.url || null,
      };
      if (!payload.first_name) return;
      await api(`/persons/${personId}`, { method: 'PUT', body: JSON.stringify(payload) });
    }

    // Create relationship if requested (only if not editing)
    if (!modalContext.editingId) {
      const relatedId = Number(relatedVal);
      if (relType && relatedId) {
        if (relType === 'child_of') {
          await api('/relationships', { method: 'POST', body: JSON.stringify({ type: 'parent', person1_id: relatedId, person2_id: personId }) });
        } else if (relType === 'parent_of') {
          await api('/relationships', { method: 'POST', body: JSON.stringify({ type: 'parent', person1_id: personId, person2_id: relatedId }) });
        } else if (relType === 'spouse_of') {
          await api('/relationships', { method: 'POST', body: JSON.stringify({ type: 'spouse', person1_id: personId, person2_id: relatedId }) });
        } else if (relType === 'sibling_of') {
          await api('/relationships', { method: 'POST', body: JSON.stringify({ type: 'sibling', person1_id: personId, person2_id: relatedId }) });
        } else if (relType === 'grandparent_of') {
          await api('/relationships', { method: 'POST', body: JSON.stringify({ type: 'grandparent', person1_id: personId, person2_id: relatedId }) });
        } else if (relType === 'grandchild_of') {
          await api('/relationships', { method: 'POST', body: JSON.stringify({ type: 'grandchild', person1_id: personId, person2_id: relatedId }) });
        } else if (relType === 'relative_of') {
          const label = $('#f_relation_label').value.trim() || null;
          await api('/relationships', { method: 'POST', body: JSON.stringify({ type: 'relative', person1_id: personId, person2_id: relatedId, label }) });
        }
      }
    }

    closePersonModal();
    await loadTree();
    selectPerson(personId);
    centerOnPerson(personId);
  } catch (err) {
    alert(err.message || 'There was an error saving the person. Please try again.');
  }
});

$('#deletePersonBtn').addEventListener('click', async () => {
  if (!modalContext.editingId) return;
  if (!confirm('Delete this person and all their recorded relationships?')) return;
  await api(`/persons/${modalContext.editingId}`, { method: 'DELETE' });
  closePersonModal();
  $('#sidePanel').classList.add('hidden');
  state.selectedId = null;
  await loadTree();
});

// re-render on window resize (keeps svg sized reasonably)
window.addEventListener('resize', () => render());

// Toggle relative label input
$('#f_relation_type').addEventListener('change', (e) => {
  $('#relativeLabelRow').classList.toggle('hidden', e.target.value !== 'relative_of');
});

// ------------------------------------------------------------------ Family access and authentication
const FAMILY_ROLE_LEVEL = { viewer: 1, contributor: 2, admin: 3, owner: 4 };
const inviteToken = new URLSearchParams(window.location.search).get('invite');
let invitationInfo = null;
let isLoginMode = true;

function activeFamily() {
  return currentUser?.active_family || currentUser?.families?.find((family) => Number(family.id) === Number(currentUser.active_family_id)) || null;
}

function hasFamilyRole(minimumRole) {
  const role = currentUser?.active_family_role || activeFamily()?.role;
  return (FAMILY_ROLE_LEVEL[role] || 0) >= FAMILY_ROLE_LEVEL[minimumRole];
}

function applyUserContext(context) {
  currentUser = context;
  const families = context?.families || [];
  const selectedId = Number(context?.active_family_id || context?.active_family?.id || 0);
  const select = $('#familySelect');
  select.innerHTML = families.map((family) =>
    `<option value="${family.id}" ${Number(family.id) === selectedId ? 'selected' : ''}>${escapeHtml(family.name)}</option>`
  ).join('');

  const family = families.find((item) => Number(item.id) === selectedId) || context?.active_family || null;
  if (family) {
    currentUser.active_family = family;
    currentUser.active_family_id = family.id;
    currentUser.active_family_role = family.role;
  }
  const role = family?.role || 'viewer';
  $('#familyRoleBadge').textContent = role;
  document.body.dataset.familyRole = role;
  $('#treeName').readOnly = !hasFamilyRole('admin');
  $('#superadminBtn').classList.toggle('hidden', !context?.is_superadmin);
}

async function refreshUserContext() {
  const context = await api('/auth/me');
  applyUserContext(context);
  return context;
}

function showAuthenticatedApp(context) {
  applyUserContext(context);
  $('#authScreen').classList.add('hidden');
  $('#app').classList.add('hidden');
  $('#approvalScreen').classList.add('hidden');

  if (context?.account_status === 'approved') {
    $('#app').classList.remove('hidden');
    return true;
  }

  $('#approvalScreen').classList.remove('hidden');
  loadApprovalAccess().catch((error) => showApprovalMessage(error.message));
  return false;
}

function showApprovalMessage(message, type = 'error') {
  const element = $('#approvalMessage');
  element.textContent = message;
  element.className = `approval-message ${type}`;
}

async function loadApprovalAccess() {
  const data = await api('/account/access');
  const access = data.access;
  if (currentUser) {
    currentUser.account_status = access.account_status;
    currentUser.is_superadmin = access.is_superadmin;
  }

  $('#unlockFee').textContent = `KES ${Number(access.unlock_fee_kes).toLocaleString()}`;
  $('#paymentPhone').textContent = access.payment_phone;
  const statusLabel = {
    pending: 'Payment required',
    payment_submitted: 'Awaiting approval',
    rejected: 'Action required',
    approved: 'Approved'
  }[access.account_status] || access.account_status;
  $('#approvalStatusBadge').textContent = statusLabel;
  $('#approvalStatusBadge').className = `approval-status ${access.account_status}`;
  $('#approvalMessage').className = 'hidden approval-message';

  const form = $('#paymentProofForm');
  const review = $('#paymentReviewState');
  form.classList.toggle('hidden', access.account_status === 'payment_submitted' || access.account_status === 'approved');
  review.className = 'hidden payment-review-state';

  if (access.account_status === 'payment_submitted') {
    review.textContent = `Payment code ${access.mpesa_reference} was submitted. A superadmin will compare it with the M-Pesa payment before unlocking your account.`;
    review.className = 'payment-review-state';
    $('#approvalLead').textContent = 'Your payment details are waiting for manual verification. You can keep this page open or check again later.';
  } else if (access.account_status === 'rejected') {
    review.textContent = `The previous submission was rejected: ${access.rejection_reason || access.review_note || 'payment could not be verified'}. Check the details and submit a valid transaction code.`;
    review.className = 'payment-review-state rejected';
    $('#approvalLead').textContent = 'Your previous proof could not be verified. Review the reason below and submit the correct transaction code.';
  } else {
    $('#approvalLead').textContent = 'Complete the payment below, then submit your M-Pesa transaction code for manual verification.';
  }
  return access;
}

async function refreshApprovalStatus() {
  const context = await api('/auth/me');
  const unlocked = showAuthenticatedApp(context);
  if (unlocked) await loadTree();
}

function setAuthMode(loginMode) {
  isLoginMode = loginMode;
  const joining = Boolean(inviteToken && invitationInfo);
  $('#authTitle').textContent = loginMode ? 'Sign In to Lineage' : (joining ? `Join ${invitationInfo.family_name}` : 'Create an Account');
  $('#authSubmitBtn').textContent = loginMode ? 'Sign In' : (joining ? 'Create account and join' : 'Sign Up');
  $('#authToggleLink').textContent = loginMode ? "Don't have an account? Sign up." : 'Already have an account? Sign in.';
  $('#authFamilyNameRow').classList.toggle('hidden', loginMode || joining);
  $('#authFamilyName').required = !loginMode && !joining;
  $('#authConfirmPasswordRow').classList.toggle('hidden', loginMode);
  $('#authConfirmPassword').required = !loginMode;
  $('#authForgotPasswordWrap').classList.add('hidden');
  $('#authEmailLabel').textContent = 'Email';
  $('#authError').classList.add('hidden');
}

async function loadInvitationNotice() {
  if (!inviteToken) return;
  const notice = $('#inviteNotice');
  try {
    invitationInfo = await api(`/invitations/${encodeURIComponent(inviteToken)}`);
    notice.textContent = `You have been invited to ${invitationInfo.family_name} as ${invitationInfo.role}. Sign in or create an account using ${invitationInfo.invited_email}.`;
    notice.classList.remove('hidden');
    setAuthMode(isLoginMode);
  } catch (error) {
    notice.textContent = error.message;
    notice.classList.remove('hidden');
    notice.style.borderColor = '#a13a3a';
  }
}

async function acceptPendingInvitation() {
  if (!inviteToken) return false;
  await api(`/invitations/${encodeURIComponent(inviteToken)}/accept`, { method: 'POST' });
  window.history.replaceState({}, document.title, window.location.pathname);
  await refreshUserContext();
  return true;
}

$('#familySelect').addEventListener('change', async (event) => {
  try {
    await api(`/families/${event.target.value}/select`, { method: 'POST' });
    await refreshUserContext();
    state.selectedId = null;
    $('#sidePanel').classList.add('hidden');
    await loadTree();
  } catch (error) {
    alert(error.message);
    await refreshUserContext();
  }
});

function showFamilyMessage(message, type = 'error') {
  const element = $('#familyModalMessage');
  element.textContent = message;
  element.className = `family-message ${type}`;
}

function clearFamilyMessage() {
  $('#familyModalMessage').className = 'hidden family-message';
}

async function loadFamilyManagement() {
  clearFamilyMessage();
  const family = activeFamily();
  if (!family) return;
  $('#familyModalSubtitle').textContent = `${family.name} · ${family.role}`;
  $('#memberPermissionHint').textContent = hasFamilyRole('admin') ? 'You can manage access.' : 'Only administrators can change access.';
  $('#inviteSection').classList.toggle('hidden', !hasFamilyRole('admin'));
  const adminInviteOption = $('#inviteRole').querySelector('option[value="admin"]');
  adminInviteOption.disabled = currentUser.active_family_role !== 'owner';
  if (adminInviteOption.disabled && $('#inviteRole').value === 'admin') $('#inviteRole').value = 'contributor';

  const data = await api('/family/members');
  const canManage = hasFamilyRole('admin');
  $('#familyMembersList').innerHTML = data.members.map((member) => {
    const isOwner = member.role === 'owner';
    const canManageAdmin = currentUser.active_family_role === 'owner';
    const editable = canManage && !isOwner && (member.role !== 'admin' || canManageAdmin);
    const roleControl = editable ? `
      <select class="member-role-select" data-user-id="${member.id}">
        <option value="viewer" ${member.role === 'viewer' ? 'selected' : ''}>Viewer</option>
        <option value="contributor" ${member.role === 'contributor' ? 'selected' : ''}>Contributor</option>
        ${canManageAdmin ? `<option value="admin" ${member.role === 'admin' ? 'selected' : ''}>Administrator</option>` : ''}
      </select>
      <button class="btn btn-ghost member-remove-btn" data-user-id="${member.id}" type="button">Remove</button>
    ` : `<span class="role-badge">${member.role}</span>`;
    return `
      <div class="member-row">
        <div class="member-identity">
          <div class="member-email">${escapeHtml(member.email)}${Number(member.id) === Number(currentUser.id) ? ' (you)' : ''}</div>
          <div class="member-meta">Joined ${new Date(member.joined_at).toLocaleDateString()}</div>
        </div>
        ${roleControl}
      </div>
    `;
  }).join('');

  $$('.member-role-select').forEach((select) => {
    select.addEventListener('change', async () => {
      try {
        await api(`/family/members/${select.dataset.userId}`, {
          method: 'PATCH',
          body: JSON.stringify({ role: select.value })
        });
        showFamilyMessage('Member role updated.', 'success');
        await refreshUserContext();
        await loadFamilyManagement();
      } catch (error) {
        showFamilyMessage(error.message);
        await loadFamilyManagement();
      }
    });
  });

  $$('.member-remove-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('Remove this person from the family tree?')) return;
      try {
        await api(`/family/members/${button.dataset.userId}`, { method: 'DELETE' });
        showFamilyMessage('Member removed.', 'success');
        await loadFamilyManagement();
      } catch (error) {
        showFamilyMessage(error.message);
      }
    });
  });

  if (hasFamilyRole('admin')) await loadPendingInvitations();
}

async function loadPendingInvitations() {
  const data = await api('/family/invitations');
  const container = $('#pendingInvitations');
  if (!data.invitations.length) {
    container.innerHTML = '<p class="muted-text">No pending invitations.</p>';
    return;
  }
  container.innerHTML = data.invitations.map((invitation) => `
    <div class="pending-invite-row">
      <div class="pending-invite-identity">
        <div class="pending-invite-email">${escapeHtml(invitation.email)}</div>
        <div class="pending-invite-meta">${invitation.role} · expires ${new Date(invitation.expires_at).toLocaleDateString()}</div>
      </div>
      <button class="btn btn-ghost revoke-invite-btn" data-invite-id="${invitation.id}" type="button">Revoke</button>
    </div>
  `).join('');
  $$('.revoke-invite-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      await api(`/family/invitations/${button.dataset.inviteId}`, { method: 'DELETE' });
      await loadPendingInvitations();
    });
  });
}

$('#manageFamilyBtn').addEventListener('click', async () => {
  $('#familyModalOverlay').classList.remove('hidden');
  try {
    await loadFamilyManagement();
  } catch (error) {
    showFamilyMessage(error.message);
  }
});

$('#familyModalClose').addEventListener('click', () => $('#familyModalOverlay').classList.add('hidden'));

$('#createFamilyForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/families', { method: 'POST', body: JSON.stringify({ name: $('#newFamilyName').value.trim() }) });
    $('#newFamilyName').value = '';
    await refreshUserContext();
    await loadTree();
    await loadFamilyManagement();
    showFamilyMessage('Family tree created.', 'success');
  } catch (error) {
    showFamilyMessage(error.message);
  }
});

$('#inviteForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await api('/family/invitations', {
      method: 'POST',
      body: JSON.stringify({ email: $('#inviteEmail').value.trim(), role: $('#inviteRole').value })
    });
    const link = new URL(data.invite_path, window.location.origin).toString();
    $('#inviteLink').value = link;
    $('#inviteResult').classList.remove('hidden');
    $('#inviteEmail').value = '';
    showFamilyMessage('Invitation created. Send this link privately to your relative.', 'success');
    await loadPendingInvitations();
  } catch (error) {
    showFamilyMessage(error.message);
  }
});

$('#copyInviteBtn').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#inviteLink').value);
  showFamilyMessage('Invitation link copied.', 'success');
});

$('#paymentProofForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    $('#submitPaymentBtn').disabled = true;
    await api('/account/payment-submissions', {
      method: 'POST',
      body: JSON.stringify({
        mpesa_reference: $('#mpesaReference').value.trim(),
        payer_phone: $('#payerPhone').value.trim() || undefined
      })
    });
    $('#mpesaReference').value = '';
    showApprovalMessage('Payment details submitted. Your account will unlock after manual verification.', 'success');
    await loadApprovalAccess();
  } catch (error) {
    showApprovalMessage(error.message);
  } finally {
    $('#submitPaymentBtn').disabled = false;
  }
});

$('#refreshApprovalBtn').addEventListener('click', async () => {
  try {
    await refreshApprovalStatus();
  } catch (error) {
    showApprovalMessage(error.message);
  }
});

$('#approvalLogoutBtn').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  window.location.reload();
});

async function loadSuperadminAccounts() {
  const filter = $('#superadminStatusFilter').value;
  const data = await api(`/superadmin/accounts?status=${encodeURIComponent(filter)}`);
  const container = $('#approvalAccountsList');
  if (!data.accounts.length) {
    container.innerHTML = '<p class="muted-text" style="text-align:center;padding:24px">No accounts match this filter.</p>';
    return;
  }
  container.innerHTML = data.accounts.map((account) => {
    const submitted = account.account_status === 'payment_submitted' && account.payment_status === 'submitted';
    const paymentDetails = account.mpesa_reference
      ? `<strong>${escapeHtml(account.mpesa_reference)}</strong><div class="approval-payment-meta">KES ${account.amount_kes} · payer ${escapeHtml(account.payer_phone || 'not supplied')} · ${new Date(account.payment_submitted_at).toLocaleString()}</div>`
      : '<span class="muted-text">No payment proof submitted</span>';
    return `
      <div class="approval-account-row">
        <div>
          <div class="approval-account-email">${escapeHtml(account.email)}</div>
          <div class="approval-account-meta">${escapeHtml(account.family_name || 'Unnamed family')} · joined ${new Date(account.created_at).toLocaleDateString()} · ${account.account_status}</div>
          ${account.rejection_reason ? `<div class="approval-account-meta">Reason: ${escapeHtml(account.rejection_reason)}</div>` : ''}
        </div>
        <div>${paymentDetails}</div>
        <div class="approval-account-actions">
          ${submitted ? `<button class="btn approve-account-btn" data-user-id="${account.id}" type="button">Approve</button><button class="btn btn-ghost reject-account-btn" data-user-id="${account.id}" type="button">Reject</button>` : ''}
        </div>
      </div>`;
  }).join('');

  $$('.approve-account-btn').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Confirm that the KES 500 M-Pesa payment and transaction code match?')) return;
    try {
      await api(`/superadmin/accounts/${button.dataset.userId}/approve`, { method: 'PATCH' });
      await loadSuperadminAccounts();
    } catch (error) {
      $('#superadminMessage').textContent = error.message;
      $('#superadminMessage').className = 'family-message error';
    }
  }));

  $$('.reject-account-btn').forEach((button) => button.addEventListener('click', async () => {
    const reason = prompt('Why could this payment not be verified? The user will see this reason.');
    if (!reason) return;
    try {
      await api(`/superadmin/accounts/${button.dataset.userId}/reject`, {
        method: 'PATCH', body: JSON.stringify({ reason })
      });
      await loadSuperadminAccounts();
    } catch (error) {
      $('#superadminMessage').textContent = error.message;
      $('#superadminMessage').className = 'family-message error';
    }
  }));
}

$('#superadminBtn').addEventListener('click', async () => {
  $('#superadminModalOverlay').classList.remove('hidden');
  $('#superadminMessage').className = 'hidden family-message';
  try { await loadSuperadminAccounts(); }
  catch (error) {
    $('#superadminMessage').textContent = error.message;
    $('#superadminMessage').className = 'family-message error';
  }
});
$('#superadminModalClose').addEventListener('click', () => $('#superadminModalOverlay').classList.add('hidden'));
$('#refreshApprovalsBtn').addEventListener('click', loadSuperadminAccounts);
$('#superadminStatusFilter').addEventListener('change', loadSuperadminAccounts);
$('#authToggleLink').addEventListener('click', (event) => {
  event.preventDefault();
  setAuthMode(!isLoginMode);
});

function togglePassword(inputId, btnId) {
  const input = $('#' + inputId);
  const btn = $('#' + btnId);
  btn.addEventListener('click', () => {
    if (input.type === 'password') {
      input.type = 'text';
      btn.innerHTML = '<span style="font-size:12px;opacity:0.7">HIDE</span>';
    } else {
      input.type = 'password';
      btn.textContent = 'Show';
    }
  });
}
togglePassword('authPassword', 'togglePasswordBtn');
togglePassword('authConfirmPassword', 'toggleConfirmPasswordBtn');
togglePassword('resetPassword', 'toggleResetPasswordBtn');

$('#authForgotPasswordLink').addEventListener('click', (event) => {
  event.preventDefault();
  $('#resetModalOverlay').classList.remove('hidden');
  $('#resetMessage').classList.add('hidden');
  $('#resetIdentifier').value = $('#authEmail').value;
  $('#resetPassword').value = '';
});

$('#resetModalClose').addEventListener('click', () => $('#resetModalOverlay').classList.add('hidden'));

$('#resetForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    $('#resetSubmitBtn').disabled = true;
    await api('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ identifier: $('#resetIdentifier').value.trim(), new_password: $('#resetPassword').value })
    });
    $('#resetMessage').classList.remove('hidden');
    $('#resetMessage').style.backgroundColor = '#e1f5e8';
    $('#resetMessage').style.color = '#2d6a4f';
    $('#resetMessage').textContent = 'Password reset successfully. You can now sign in.';
  } catch (error) {
    $('#resetMessage').classList.remove('hidden');
    $('#resetMessage').style.backgroundColor = '#faeaea';
    $('#resetMessage').style.color = '#a13a3a';
    $('#resetMessage').textContent = error.message;
  } finally {
    $('#resetSubmitBtn').disabled = false;
  }
});

$('#authForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = $('#authEmail').value.trim();
  const password = $('#authPassword').value;
  const confirmPassword = $('#authConfirmPassword').value;
  const family_name = $('#authFamilyName').value.trim();

  if (!isLoginMode && password !== confirmPassword) {
    $('#authError').textContent = 'Passwords do not match.';
    $('#authError').classList.remove('hidden');
    return;
  }

  try {
    const url = isLoginMode ? '/auth/login' : '/auth/signup';
    const body = isLoginMode
      ? { email, password }
      : { email, password, family_name, invite_token: inviteToken || undefined };
    let context = await api(url, { method: 'POST', body: JSON.stringify(body) });
    if (isLoginMode && inviteToken) {
      try {
        await acceptPendingInvitation();
        context = await api('/auth/me');
      } catch (invitationError) {
        const unlocked = showAuthenticatedApp(context);
        if (unlocked) await loadTree();
        alert(`You signed in, but the invitation was not accepted: ${invitationError.message}`);
        return;
      }
    } else if (!isLoginMode && inviteToken) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    const unlocked = showAuthenticatedApp(context);
    if (unlocked) await loadTree();
  } catch (error) {
    $('#authError').textContent = error.message;
    $('#authError').classList.remove('hidden');
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  window.location.reload();
});

async function initializeApp() {
  await loadInvitationNotice();
  try {
    let context = await api('/auth/me');
    let unlocked = showAuthenticatedApp(context);
    if (inviteToken) {
      try {
        await acceptPendingInvitation();
        context = await api('/auth/me');
        unlocked = showAuthenticatedApp(context);
      } catch (invitationError) {
        console.warn(`Invitation was not accepted: ${invitationError.message}`);
      }
    }
    if (unlocked) await loadTree();
  } catch (error) {
    if (error.message !== 'Unauthorized') console.warn(error.message);
  }
}

initializeApp();
/* ========================================================================= */
// Duplicates Modal Logic
/* ========================================================================= */
$('#exportBtn').addEventListener('click', () => {
  window.location.href = `${API}/export/excel`;
});

$('#mergeBtn').addEventListener('click', async () => {
  $('#duplicatesModalOverlay').classList.remove('hidden');
  $('#duplicatesContent').innerHTML = '<p style="text-align: center; color: var(--ink-soft); padding: 20px;">Loading...</p>';
  try {
    const duplicates = await api('/duplicates');
    if (duplicates.length === 0) {
      $('#duplicatesContent').innerHTML = '<p style="text-align: center; color: var(--ink-soft); padding: 20px;">No exact duplicates (by name) found!</p>';
      return;
    }

    const html = duplicates.map((group, idx) => `
      <div style="border-bottom: 1px solid var(--card-edge); padding-bottom: 16px; margin-bottom: 16px;">
        <h4 style="margin: 0 0 10px; color: var(--gold-deep);">${escapeHtml(group.group)}</h4>
        <div style="display: flex; gap: 12px; flex-wrap: wrap;">
          ${group.persons.map(p => `
            <div style="flex: 1; min-width: 200px; border: 1px solid var(--card-edge); padding: 10px; border-radius: 8px; background: var(--parchment);">
              <label style="display: flex; gap: 8px; cursor: pointer;">
                <input type="radio" name="merge_group_${idx}" value="${p.id}" ${p.id === group.persons[0].id ? 'checked' : ''} />
                <div style="font-size: 13px;">
                  <strong>Record ID: ${p.id} (Keep)</strong><br/>
                  <div style="margin-top: 4px; color: var(--ink-soft);">
                    ${dateRangeLabel(p)}<br/>
                    ${escapeHtml(p.birth_place || '')}
                  </div>
                </div>
              </label>
            </div>
          `).join('')}
        </div>
        <button type="button" class="btn btn-primary merge-exec-btn" data-group="${idx}" style="margin-top: 10px;">Merge group</button>
      </div>
    `).join('');

    $('#duplicatesContent').innerHTML = html;

    $$('.merge-exec-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const groupIdx = btn.dataset.group;
        const groupData = duplicates[groupIdx];
        const selectedRadio = document.querySelector(`input[name="merge_group_${groupIdx}"]:checked`);
        if (!selectedRadio) return;

        const keepId = Number(selectedRadio.value);
        const mergeIds = groupData.persons.map(p => p.id).filter(id => id !== keepId);

        if (mergeIds.length === 0) {
          alert('No duplicates selected to merge.');
          return;
        }

        try {
          btn.disabled = true;
          btn.textContent = 'Merging...';
          await api('/merge', { method: 'POST', body: JSON.stringify({ keepId, mergeIds }) });
          btn.textContent = 'Merged!';
          btn.style.background = '#6e8b74';

          await loadTree();
        } catch (e) {
          alert('Merge failed: ' + e.message);
          btn.disabled = false;
          btn.textContent = 'Merge group';
        }
      });
    });

  } catch (err) {
    $('#duplicatesContent').innerHTML = '<p style="color: #a13a3a; padding: 20px;">' + escapeHtml(err.message) + '</p>';
  }
});

$('#duplicatesModalClose').addEventListener('click', () => {
  $('#duplicatesModalOverlay').classList.add('hidden');
});
