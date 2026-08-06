(function () {
  'use strict';

  const layoutTools = window.LineageTreeLayout;
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const svgNS = 'http://www.w3.org/2000/svg';

  const state = {
    persons: [],
    relationships: [],
    graph: null,
    events: [],
    view: 'family',
    presentation: '2d',
    focusId: null,
    depth: 4,
    focusBranch: false,
    collapsedIds: new Set(),
    host: {},
    initialized: false,
    exportSvg: '',
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function personName(person) {
    if (!person) return 'Unknown relative';
    return [person.first_name, person.middle_name, person.last_name].filter(Boolean).join(' ') || 'Unnamed relative';
  }

  function lifeYears(person) {
    const birth = String(person?.birth_date || '').slice(0, 4);
    const death = String(person?.death_date || '').slice(0, 4);
    if (!birth && !death) return 'Dates not recorded';
    return `${birth || '?'} – ${death || 'present'}`;
  }

  function initials(person) {
    return [person?.first_name, person?.last_name].filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || '?';
  }

  function byId(id) {
    return state.graph?.personById.get(Number(id)) || null;
  }

  function ensureFocus() {
    if (!byId(state.focusId)) state.focusId = state.persons[0]?.id ? Number(state.persons[0].id) : null;
  }

  function updateControls() {
    ensureFocus();
    const focus = $('#explorerFocusPerson');
    if (focus) {
      const selected = String(state.focusId || '');
      focus.innerHTML = state.persons
        .slice().sort((a, b) => personName(a).localeCompare(personName(b)))
        .map((person) => `<option value="${person.id}">${escapeHtml(personName(person))}</option>`).join('');
      focus.value = selected;
    }
    $$('.explorer-view-button').forEach((button) => {
      const active = button.dataset.explorerView === state.view;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    const depth = $('#explorerDepth');
    if (depth) depth.value = state.depth === Infinity ? 'all' : String(state.depth);
    const focusBranch = $('#explorerFocusBranchBtn');
    if (focusBranch) {
      focusBranch.classList.toggle('active', state.focusBranch);
      focusBranch.setAttribute('aria-pressed', String(state.focusBranch));
    }
    $('#explorerResetBranchesBtn')?.classList.toggle('hidden', state.collapsedIds.size === 0);
    const focusPerson = byId(state.focusId);
    const collapsed = focusPerson && state.collapsedIds.has(Number(focusPerson.id));
    if ($('#explorerCollapseBtn')) $('#explorerCollapseBtn').textContent = collapsed ? 'Expand branch' : 'Collapse branch';
  }

  function projectionFor(view = state.view) {
    ensureFocus();
    if (!layoutTools || !state.graph) return { persons: state.persons, relationships: state.relationships };
    const direction = view === 'pedigree' || view === 'fan' ? 'ancestors'
      : view === 'descendants' ? 'descendants'
        : view === 'hourglass' ? 'hourglass' : 'family';
    if (direction === 'family' && !state.focusBranch && state.collapsedIds.size === 0) {
      return { persons: state.persons, relationships: state.relationships };
    }
    return layoutTools.projectTree(state.persons, state.relationships, {
      focusId: state.focusId,
      direction,
      depth: state.focusBranch || direction !== 'family' ? state.depth : Infinity,
      collapsedIds: state.collapsedIds,
    });
  }

  function setBusy(message) {
    const alt = $('#explorerAltView');
    if (!alt) return;
    alt.innerHTML = `<div class="explorer-loading"><span></span><p>${escapeHtml(message)}</p></div>`;
  }

  function showAlt(show) {
    $('#explorerAltView')?.classList.toggle('hidden', !show);
    $('#treeSvg')?.classList.toggle('hidden', show);
    $('#treeMinimap')?.classList.toggle('hidden', show);
    $('.tree-viewport-tools')?.classList.toggle('hidden', show);
    $('.tree-gesture-hint')?.classList.toggle('hidden', show);
    $('#relLegend')?.classList.toggle('hidden', show);
  }

  function setResultCount(count, suffix = 'people') {
    if ($('#explorerResultCount')) $('#explorerResultCount').textContent = `${count.toLocaleString()} ${suffix}`;
  }

  function setData(data = {}) {
    state.persons = Array.isArray(data.persons) ? data.persons : [];
    state.relationships = Array.isArray(data.relationships) ? data.relationships : [];
    state.events = Array.isArray(data.events) ? data.events : state.events;
    state.graph = layoutTools?.buildRelationshipGraph(state.persons, state.relationships) || null;
    ensureFocus();
    updateControls();
    return render();
  }

  function setView(view) {
    const allowed = new Set(['family', 'pedigree', 'descendants', 'fan', 'hourglass', 'list', 'path', 'map']);
    if (!allowed.has(view)) return;
    state.view = view;
    updateControls();
    render();
  }

  function render3D(projected) {
    showAlt(false); $('#treeSvg')?.classList.add('hidden');
    let stage = $('#tree3dStage');
    if (!stage) { stage = document.createElement('div'); stage.id = 'tree3dStage'; stage.className = 'tree-3d-stage'; $('#canvasWrap').appendChild(stage); }
    if (!stage.dataset.gestures) {
      stage.dataset.gestures = 'true'; stage.style.touchAction = 'none';
      stage.addEventListener('pointerdown', event => { stage.setPointerCapture?.(event.pointerId); stage.dataset.dragging = 'true'; stage.dataset.lastX = event.clientX; stage.dataset.lastY = event.clientY; });
      stage.addEventListener('pointermove', event => { if (stage.dataset.dragging !== 'true') return; const dx=event.clientX-Number(stage.dataset.lastX); const dy=event.clientY-Number(stage.dataset.lastY); stage.dataset.lastX=event.clientX; stage.dataset.lastY=event.clientY; state.orbitY=(state.orbitY||0)+dx*.25; state.orbitX=Math.max(28,Math.min(72,(state.orbitX||54)-dy*.18)); const scene=stage.querySelector('.tree-3d-scene'); if(scene) scene.style.transform=`translate(${state.pan3dX||0}px,${state.pan3dY||0}px) rotateX(${state.orbitX}deg) rotateY(${state.orbitY}deg) scale(${state.zoom3d||1})`; });
      ['pointerup','pointercancel','lostpointercapture'].forEach(type => stage.addEventListener(type, () => { stage.dataset.dragging='false'; }));
      stage.addEventListener('wheel', event => { event.preventDefault(); state.zoom3d=Math.max(.45,Math.min(2.2,(state.zoom3d||1)*(event.deltaY<0?1.08:.93))); const scene=stage.querySelector('.tree-3d-scene'); if(scene) scene.style.transform=`translate(${state.pan3dX||0}px,${state.pan3dY||0}px) rotateX(${state.orbitX||54}deg) rotateY(${state.orbitY||0}deg) scale(${state.zoom3d})`; }, { passive:false });
    }
    stage.innerHTML = '';
    const layout = layoutTools.computeTreeLayout(projected.persons, projected.relationships, { cardWidth: 190, cardHeight: 92, spouseGap: 32, horizontalGap: 66, verticalGap: 90 });
    const scene = document.createElement('div'); scene.className = 'tree-3d-scene'; stage.appendChild(scene);
    projected.persons.forEach(person => { const at=layout.personPos.get(Number(person.id)); if(!at)return; const card=document.createElement('button'); card.type='button'; card.className='tree-3d-card'; card.dataset.personId=person.id; card.style.left=at.x+'px'; card.style.top=at.y+'px'; card.innerHTML='<span class=tree-3d-avatar>'+escapeHtml(initials(person))+'</span><strong>'+escapeHtml(personName(person))+'</strong><small>'+escapeHtml(lifeYears(person))+'</small>'; card.onclick=()=>state.host.openPerson?.(Number(person.id)); scene.appendChild(card); });
  }

  function render() {
    if (!state.initialized || !state.graph) return;
    updateControls();
    const projected = projectionFor();
    setResultCount(projected.persons.length);
    if (state.view === 'family') {
      if (state.presentation === '3d') { render3D(projected); return; }
      $('#tree3dStage')?.remove(); $('#treeSvg')?.classList.remove('hidden');
      showAlt(false);
      state.exportSvg = '';
      state.host.renderProjection?.(projected);
      return;
    }
    showAlt(true);
    if (state.view === 'fan') return renderFan(projected);
    if (state.view === 'list') return renderList(projected);
    if (state.view === 'path') return renderPath();
    if (state.view === 'map') return renderMap();
    return renderHierarchy(projected, state.view);
  }

  function chartCard(person, x, y, width = 184, height = 76) {
    const color = person.gender === 'female' ? '#9a5f65' : person.gender === 'male' ? '#3f6b5b' : '#79694d';
    return `<g class="explorer-svg-person" data-person-id="${person.id}" transform="translate(${x} ${y})" tabindex="0" role="button">
      <rect width="${width}" height="${height}" rx="12" fill="#fffdf7" stroke="#d4c299" />
      <circle cx="27" cy="30" r="17" fill="${color}" opacity=".14"/><text x="27" y="35" text-anchor="middle" fill="${color}" font-size="12" font-weight="700">${escapeHtml(initials(person))}</text>
      <text x="52" y="28" fill="#30271e" font-size="13" font-weight="700">${escapeHtml(personName(person).slice(0, 23))}</text>
      <text x="52" y="48" fill="#786b5d" font-size="10.5">${escapeHtml(lifeYears(person))}</text>
      <text x="14" y="65" fill="#a27834" font-size="9.5">${person.is_living === false ? 'Remembered' : 'Living relative'}</text>
    </g>`;
  }

  function bindSvgPeople(root) {
    root.querySelectorAll('[data-person-id]').forEach((node) => {
      const open = () => state.host.openPerson?.(Number(node.dataset.personId));
      node.addEventListener('click', open);
      node.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') open(); });
    });
  }

  function renderHierarchy(projected, view, alt = $('#explorerAltView'), commit = true) {
    const layout = layoutTools.computeTreeLayout(projected.persons, projected.relationships, {
      cardWidth: 184, cardHeight: 76, spouseGap: 34, horizontalGap: 58, verticalGap: 76,
    });
    const margin = 60;
    const width = Math.max(720, layout.width + margin * 2);
    const height = Math.max(440, layout.height + margin * 2);
    const offsetX = margin;
    const offsetY = margin;
    const positions = layout.personPos;
    const lines = projected.relationships.map((relationship) => {
      const first = positions.get(Number(relationship.person1_id));
      const second = positions.get(Number(relationship.person2_id));
      if (!first || !second) return '';
      const spouse = relationship.type === 'spouse';
      const x1 = first.x + first.w / 2 + offsetX;
      const y1 = first.y + (spouse ? first.h / 2 : first.h) + offsetY;
      const x2 = second.x + second.w / 2 + offsetX;
      const y2 = second.y + (spouse ? 38 : 0) + offsetY;
      const mid = (y1 + y2) / 2;
      return `<path d="M${x1},${y1} ${spouse ? `L${x2},${y2}` : `C${x1},${mid} ${x2},${mid} ${x2},${y2}`}" fill="none" stroke="${spouse ? '#b78639' : '#b8aa8d'}" stroke-width="${spouse ? 2.5 : 1.7}"/>`;
    }).join('');
    const cards = projected.persons.map((person) => {
      const position = positions.get(Number(person.id));
      return position ? chartCard(person, position.x + offsetX, position.y + offsetY) : '';
    }).join('');
    const label = view === 'pedigree' ? 'Ancestor pedigree' : view === 'descendants' ? 'Descendant tree' : 'Hourglass family view';
    const svg = `<svg class="explorer-chart-svg" xmlns="${svgNS}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}">
      <defs><pattern id="explorerPaperGrid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#b7a77d" stroke-opacity=".08"/></pattern></defs>
      <rect width="100%" height="100%" fill="#f9f5e9"/><rect width="100%" height="100%" fill="url(#explorerPaperGrid)"/>
      <text x="32" y="35" fill="#8f6526" font-size="11" font-weight="700" letter-spacing="2">${label.toUpperCase()}</text>
      <g>${lines}${cards}</g>
    </svg>`;
    if (commit) state.exportSvg = svg;
    alt.innerHTML = `<div class="explorer-chart-stage">${svg}</div>`;
    bindSvgPeople(alt);
  }

  function polar(cx, cy, radius, angle) {
    const radians = (angle - 90) * Math.PI / 180;
    return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
  }

  function fanWedge(cx, cy, inner, outer, start, end) {
    const a = polar(cx, cy, outer, start);
    const b = polar(cx, cy, outer, end);
    const c = polar(cx, cy, inner, end);
    const d = polar(cx, cy, inner, start);
    const large = end - start > 180 ? 1 : 0;
    return `M${a.x},${a.y} A${outer},${outer} 0 ${large} 1 ${b.x},${b.y} L${c.x},${c.y} A${inner},${inner} 0 ${large} 0 ${d.x},${d.y} Z`;
  }

  function renderFan(projected) {
    const alt = $('#explorerAltView');
    const focus = byId(state.focusId);
    const maxDepth = Math.min(state.depth === Infinity ? 6 : state.depth, 6);
    const slotResult = layoutTools.ancestorSlots(state.persons, state.relationships, state.focusId, maxDepth);
    const slots = slotResult.levels.flatMap((level, generation) => level.map((personId, index) => ({ personId, generation, index })));
    const width = 1040;
    const height = 610;
    const cx = width / 2;
    const cy = 560;
    const ring = 92;
    const palette = ['#e8ddbf', '#d9e4d7', '#edd9d4', '#d8e2e5', '#e7ddce', '#d8e1c9'];
    let wedges = '';
    slots.forEach((slot) => {
      if (slot.generation === 0) return;
      const count = 2 ** slot.generation;
      const span = 180 / count;
      const start = -90 + slot.index * span + .5;
      const end = start + span - 1;
      const inner = 54 + (slot.generation - 1) * ring;
      const outer = inner + ring - 7;
      const mid = (start + end) / 2;
      const at = polar(cx, cy, inner + ring * .48, mid);
      const person = slot.personId ? byId(slot.personId) : null;
      const label = person ? personName(person) : 'Unknown';
      wedges += `<g class="fan-wedge ${person ? '' : 'empty'}" ${person ? `data-person-id="${person.id}" tabindex="0" role="button"` : ''}>
        <path d="${fanWedge(cx, cy, inner, outer, start, end)}" fill="${palette[(slot.index + slot.generation) % palette.length]}" stroke="#fffaf0" stroke-width="2"/>
        <text x="${at.x}" y="${at.y}" text-anchor="middle" fill="#352c22" font-size="${slot.generation > 4 ? 8 : 10.5}" font-weight="600" transform="rotate(${mid} ${at.x} ${at.y})">${escapeHtml(label.slice(0, slot.generation > 3 ? 13 : 20))}</text>
      </g>`;
    });
    const svg = `<svg class="explorer-chart-svg fan-chart-svg" xmlns="${svgNS}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Fan chart for ${escapeHtml(personName(focus))}">
      <rect width="100%" height="100%" fill="#faf6eb"/><text x="36" y="40" fill="#8f6526" font-size="11" font-weight="700" letter-spacing="2">ANCESTOR FAN · ${maxDepth} GENERATIONS</text>
      ${wedges}<g class="fan-center" data-person-id="${focus?.id || ''}" tabindex="0" role="button"><path d="${fanWedge(cx, cy, 0, 50, -90, 90)}" fill="#345f50"/><text x="${cx}" y="${cy - 22}" text-anchor="middle" fill="#fffaf0" font-size="12" font-weight="700">${escapeHtml(personName(focus).slice(0, 22))}</text></g>
    </svg>`;
    state.exportSvg = svg;
    alt.innerHTML = `<div class="explorer-chart-stage fan-chart-stage">${svg}</div>`;
    bindSvgPeople(alt);
    setResultCount(projected.persons.length, 'ancestors shown');
  }

  function renderList(projected) {
    const alt = $('#explorerAltView');
    const rows = projected.persons.slice().sort((a, b) => {
      const family = String(a.last_name || '').localeCompare(String(b.last_name || ''));
      return family || personName(a).localeCompare(personName(b));
    });
    const rowHtml = rows.map((person) => `<button class="compact-person-row" type="button" data-person-id="${person.id}" data-person-search="${escapeHtml(personName(person).toLowerCase())}">
      <span class="compact-person-avatar">${escapeHtml(initials(person))}</span>
      <span><strong>${escapeHtml(personName(person))}</strong><small>${escapeHtml(lifeYears(person))}</small></span>
      <span class="compact-person-place">${escapeHtml(person.birth_place || 'Place not recorded')}</span>
      <span class="compact-person-open">View →</span>
    </button>`).join('');
    alt.innerHTML = `<section class="compact-list-view">
      <header><div><p class="archive-kicker">FAMILY DIRECTORY</p><h2>Compact family list</h2></div><label><span>Find a relative</span><input id="explorerListSearch" type="search" placeholder="Search by name…" autocomplete="off"/></label></header>
      <div class="compact-list-head"><span>Relative</span><span>Place</span><span></span></div>
      <div id="explorerListRows">${rowHtml || '<div class="explorer-empty-panel">No relatives match this branch.</div>'}</div>
    </section>`;
    alt.querySelectorAll('[data-person-id]').forEach((button) => button.addEventListener('click', () => state.host.openPerson?.(Number(button.dataset.personId))));
    $('#explorerListSearch')?.addEventListener('input', (event) => {
      const query = event.target.value.trim().toLowerCase();
      let visible = 0;
      alt.querySelectorAll('.compact-person-row').forEach((row) => {
        const match = !query || row.dataset.personSearch.includes(query);
        row.classList.toggle('hidden', !match);
        if (match) visible += 1;
      });
      setResultCount(visible, 'matching people');
    });
    state.exportSvg = '';
  }

  function relationshipLabel(edge, fromId) {
    if (!edge) return 'related to';
    if (edge.type === 'spouse') return 'spouse of';
    if (edge.type === 'sibling') return 'sibling of';
    if (edge.type === 'parent') {
      return Number(edge.person1_id) === Number(fromId) ? 'parent of' : 'child of';
    }
    if (edge.type === 'grandparent') {
      return Number(edge.person1_id) === Number(fromId) ? 'grandparent of' : 'grandchild of';
    }
    if (edge.type === 'aunt_uncle') {
      return Number(edge.person1_id) === Number(fromId) ? 'aunt/uncle of' : 'niece/nephew of';
    }
    if (edge.type === 'cousin') return 'cousin of';
    return String(edge.label || edge.relationship_type || edge.type || 'related').replace(/_/g, ' ');
  }

  function renderPath() {
    const alt = $('#explorerAltView');
    const candidates = state.persons.filter((person) => Number(person.id) !== Number(state.focusId));
    if (!state.pathTargetId || !byId(state.pathTargetId) || Number(state.pathTargetId) === Number(state.focusId)) {
      state.pathTargetId = candidates[0]?.id ? Number(candidates[0].id) : null;
    }
    const path = state.pathTargetId ? layoutTools.shortestRelationshipPath(
      state.persons, state.relationships, state.focusId, state.pathTargetId,
    ) : null;
    const select = candidates.slice().sort((a, b) => personName(a).localeCompare(personName(b)))
      .map((person) => `<option value="${person.id}" ${Number(person.id) === Number(state.pathTargetId) ? 'selected' : ''}>${escapeHtml(personName(person))}</option>`).join('');
    let pathHtml = '<div class="explorer-empty-panel"><strong>No relationship path found.</strong><p>These two people are not connected by the recorded relationships.</p></div>';
    if (path?.people?.length) {
      pathHtml = path.people.map((person, index) => {
        const step = path.steps[index];
        return `<div class="relationship-path-step">
          <button type="button" data-person-id="${person.id}"><span>${escapeHtml(initials(person))}</span><strong>${escapeHtml(personName(person))}</strong><small>${escapeHtml(lifeYears(person))}</small></button>
          ${step ? `<div class="relationship-path-link"><i></i><em>${escapeHtml(relationshipLabel(step.relationship, person.id))}</em><i></i></div>` : ''}
        </div>`;
      }).join('');
    }
    alt.innerHTML = `<section class="relationship-path-view">
      <header><div><p class="archive-kicker">CONNECTION FINDER</p><h2>How are they related?</h2><p>Follow the shortest recorded relationship chain from the focus person.</p></div>
      <label><span>Connect to</span><select id="explorerPathTarget">${select}</select></label></header>
      <div class="relationship-path-summary">${path ? `<strong>${path.steps.length} relationship${path.steps.length === 1 ? '' : 's'}</strong><span>separate ${escapeHtml(personName(byId(state.focusId)))} and ${escapeHtml(personName(byId(state.pathTargetId)))}</span>` : '<strong>No recorded connection</strong>'}</div>
      <div class="relationship-path-track">${pathHtml}</div>
    </section>`;
    $('#explorerPathTarget')?.addEventListener('change', (event) => {
      state.pathTargetId = Number(event.target.value);
      renderPath();
    });
    alt.querySelectorAll('[data-person-id]').forEach((button) => button.addEventListener('click', () => state.host.openPerson?.(Number(button.dataset.personId))));
    setResultCount(path?.people?.length || 0, 'people in path');
    state.exportSvg = '';
  }

  function mapPoint(latitude, longitude, width, height) {
    return {
      x: ((Number(longitude) + 180) / 360) * width,
      y: ((90 - Number(latitude)) / 180) * height,
    };
  }

  async function renderMap() {
    const alt = $('#explorerAltView');
    if (!state.events.length && state.host.api) {
      setBusy('Mapping recorded family places…');
      try {
        const payload = await state.host.api('/api/archive/events');
        state.events = payload.events || payload || [];
      } catch (_) {
        state.events = [];
      }
    }
    const mapped = state.events.filter((event) => Number.isFinite(Number(event.latitude)) && Number.isFinite(Number(event.longitude)));
    const unmapped = state.events.filter((event) => event.place && !mapped.includes(event));
    const width = 1080;
    const height = 520;
    const dots = mapped.map((event, index) => {
      const point = mapPoint(event.latitude, event.longitude, width, height);
      const person = byId(event.person_id);
      const label = event.title || event.event_type || 'Family event';
      return `<g class="map-event-point" transform="translate(${point.x} ${point.y})" tabindex="0">
        <circle r="13" fill="#c39442" opacity=".18"/><circle r="5" fill="#8c6124" stroke="#fff7e5" stroke-width="2"/>
        <title>${escapeHtml(label)} · ${escapeHtml(event.place || '')}${person ? ` · ${escapeHtml(personName(person))}` : ''}</title>
        <text x="10" y="${index % 2 ? 16 : -10}" fill="#493a29" font-size="9.5" font-weight="600">${escapeHtml((event.place || label).slice(0, 22))}</text>
      </g>`;
    }).join('');
    const svg = `<svg class="explorer-map-svg" xmlns="${svgNS}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Map of family life events">
      <defs><linearGradient id="mapSea" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#e5efea"/><stop offset="1" stop-color="#cedfd7"/></linearGradient></defs>
      <rect width="${width}" height="${height}" rx="18" fill="url(#mapSea)"/>
      <g fill="#eee3c9" stroke="#cbbd98" stroke-width="1.2" opacity=".95">
        <path d="M70 118L150 60l115 18 60 63-39 83-73 22-21 101-65-27-25-102z"/><path d="M326 329l47 28 39 102-28 49-43-93z"/>
        <path d="M455 91l110-35 98 18 34 64-52 33-16 104-74 101-48-46-16-117-55-46z"/><path d="M636 81l121-34 190 39 75 97-72 67-105-9-58 60-61-42-22-99z"/>
        <path d="M837 358l91-33 83 50-22 74-94 25-61-60z"/><path d="M1003 211l47 17-8 42-34-4z"/>
      </g>
      <g stroke="#fff" stroke-opacity=".35" stroke-width=".7">${[90,180,270,360,450].map((y) => `<line x1="0" y1="${y}" x2="${width}" y2="${y}"/>`).join('')}${[180,360,540,720,900].map((x) => `<line x1="${x}" y1="0" x2="${x}" y2="${height}"/>`).join('')}</g>
      ${dots}
    </svg>`;
    state.exportSvg = svg;
    alt.innerHTML = `<section class="family-map-view"><header><div><p class="archive-kicker">FAMILY GEOGRAPHY</p><h2>Places across generations</h2><p>Add coordinates to timeline events to reveal births, marriages, residences and migrations here.</p></div><div class="map-stat"><strong>${mapped.length}</strong><span>mapped events</span></div></header>
      <div class="family-map-stage">${svg}</div>
      ${unmapped.length ? `<details class="unmapped-events"><summary>${unmapped.length} events still need coordinates</summary><div>${unmapped.slice(0, 30).map((event) => `<span>${escapeHtml(event.title || event.event_type)} · ${escapeHtml(event.place)}</span>`).join('')}</div></details>` : ''}
    </section>`;
    setResultCount(mapped.length, 'mapped events');
  }

  function showShareMessage(message, error = false) {
    const target = $('#shareTreeMessage');
    if (!target) return;
    target.textContent = message;
    target.classList.remove('hidden');
    target.classList.toggle('error', error);
  }

  async function loadShareLinks() {
    const list = $('#shareLinksList');
    if (!list || !state.host.api) return;
    list.innerHTML = '<p class="muted-text">Loading controlled links…</p>';
    try {
      const payload = await state.host.api('/api/exploration/share-links');
      const links = payload.links || [];
      if (!links.length) {
        list.innerHTML = '<div class="share-links-empty">No private links have been created yet.</div>';
        return;
      }
      list.innerHTML = links.map((link) => {
        const expired = link.revoked_at || new Date(link.expires_at) <= new Date();
        const status = link.revoked_at ? 'Revoked' : expired ? 'Expired' : 'Active';
        return `<article class="share-link-item ${expired ? 'expired' : ''}">
          <div><strong>${escapeHtml(link.label || `${link.view_type} view`)}</strong><small>${escapeHtml(link.view_type)} · expires ${new Date(link.expires_at).toLocaleString()}</small></div>
          <span class="share-link-status">${status}</span>
          ${!expired ? `<button type="button" data-revoke-share="${link.id}">Revoke</button>` : ''}
        </article>`;
      }).join('');
      list.querySelectorAll('[data-revoke-share]').forEach((button) => button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await state.host.api(`/api/exploration/share-links/${button.dataset.revokeShare}`, { method: 'DELETE' });
          await loadShareLinks();
        } catch (error) {
          showShareMessage(error.message || 'Could not revoke link.', true);
          button.disabled = false;
        }
      }));
    } catch (error) {
      list.innerHTML = `<div class="share-links-empty error">${escapeHtml(error.message || 'Could not load links.')}</div>`;
    }
  }

  function openShareModal() {
    $('#shareTreeModalOverlay')?.classList.remove('hidden');
    $('#shareTreeView').value = ['path', 'map'].includes(state.view) ? 'family' : state.view;
    $('#shareCreatedPanel')?.classList.add('hidden');
    $('#shareTreeMessage')?.classList.add('hidden');
    loadShareLinks();
  }

  async function createShareLink(event) {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const payload = await state.host.api('/api/exploration/share-links', {
        method: 'POST',
        body: JSON.stringify({
          label: $('#shareTreeLabel').value.trim(),
          view: $('#shareTreeView').value,
          expiry_hours: Number($('#shareTreeExpiry').value),
          include_living: $('#shareTreeIncludeLiving').checked,
          focus_person_id: state.focusId,
          generation_depth: state.depth === Infinity ? 8 : state.depth,
        }),
      });
      $('#shareCreatedUrl').value = payload.url;
      $('#shareCreatedPanel').classList.remove('hidden');
      showShareMessage('Private link created. Copy it now; the secret token is not stored in readable form.');
      await loadShareLinks();
    } catch (error) {
      showShareMessage(error.message || 'Could not create private link.', true);
    } finally {
      submit.disabled = false;
    }
  }

  async function copyShareUrl() {
    const input = $('#shareCreatedUrl');
    if (!input?.value) return;
    try {
      await navigator.clipboard.writeText(input.value);
      $('#shareCopyBtn').textContent = 'Copied';
    } catch (_) {
      input.select();
      document.execCommand('copy');
      $('#shareCopyBtn').textContent = 'Copied';
    }
  }

  function downloadBlob(blob, filename) {
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
  }

  async function exportPng() {
    let svgText = state.exportSvg;
    if (!svgText) {
      const scratch = document.createElement('div');
      const view = ['pedigree', 'descendants', 'hourglass'].includes(state.view) ? state.view : 'family';
      renderHierarchy(projectionFor(state.view), view, scratch, false);
      svgText = scratch.querySelector('svg')?.outerHTML || '';
    }
    if (!svgText) return;
    const source = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(source);
    const image = new Image();
    image.onload = () => {
      const box = svgText.match(/viewBox="[^"]*\s([\d.]+)\s([\d.]+)"/);
      const width = Math.min(6000, Math.max(1600, Number(box?.[1]) * 2 || 2400));
      const height = Math.min(6000, Math.max(1000, Number(box?.[2]) * 2 || 1400));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      context.fillStyle = '#faf6eb';
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      canvas.toBlob((blob) => blob && downloadBlob(blob, `family-tree-${state.view}.png`), 'image/png', 1);
      URL.revokeObjectURL(url);
    };
    image.src = url;
  }

  function exportPdf() {
    const view = ['map', 'path'].includes(state.view) ? 'family' : state.view;
    const params = new URLSearchParams({
      view,
      focus_id: state.focusId || '',
      depth: state.depth === Infinity ? 'all' : state.depth,
    });
    window.location.href = `/api/exploration/chart.pdf?${params}`;
  }

  function printCurrentView() {
    const content = state.view === 'family' ? $('#canvasWrap')?.innerHTML : $('#explorerAltView')?.innerHTML;
    const popup = window.open('', '_blank', 'noopener,noreferrer');
    if (!popup) return;
    popup.document.write(`<!doctype html><html><head><title>Lineage family chart</title><link rel="stylesheet" href="/style.css"></head><body class="explorer-print-page"><header><h1>Family tree</h1><p>${escapeHtml(state.view)} view · ${new Date().toLocaleDateString()}</p></header><main>${content || ''}</main></body></html>`);
    popup.document.close();
    popup.addEventListener('load', () => setTimeout(() => popup.print(), 300));
  }

  function togglePresentation(target = $('#canvasWrap')) {
    if (!document.fullscreenElement) target?.requestFullscreen?.();
    else document.exitFullscreen?.();
  }

  function renderSharedChart(payload) {
    const canvas = $('#sharedTreeCanvas');
    const view = payload.share?.view || 'family';
    const people = payload.persons || [];
    const relationships = payload.relationships || [];
    if (view === 'list') {
      canvas.innerHTML = `<div class="shared-list">${people.map((person) => `<article><span>${escapeHtml(initials(person))}</span><div><strong>${escapeHtml(personName(person))}</strong><small>${escapeHtml(lifeYears(person))}</small></div></article>`).join('')}</div>`;
      return;
    }
    if (view === 'fan') {
      const personMap = new Map(people.map((person) => [Number(person.id), person]));
      const depth = Math.min(Number(payload.share?.generation_depth) || 4, 6);
      const slots = layoutTools.ancestorSlots(people, relationships, payload.share?.focus_person_id, depth).levels
        .flatMap((level, generation) => level.map((personId, index) => ({ personId, generation, index })));
      const width = 1040;
      const height = 610;
      const cx = 520;
      const cy = 560;
      const ring = 92;
      const palette = ['#e8ddbf', '#d9e4d7', '#edd9d4', '#d8e2e5', '#e7ddce', '#d8e1c9'];
      const wedges = slots.filter((slot) => slot.generation > 0).map((slot) => {
        const count = 2 ** slot.generation;
        const span = 180 / count;
        const start = -90 + slot.index * span + .5;
        const end = start + span - 1;
        const inner = 54 + (slot.generation - 1) * ring;
        const outer = inner + ring - 7;
        const mid = (start + end) / 2;
        const at = polar(cx, cy, inner + ring * .48, mid);
        const person = personMap.get(Number(slot.personId));
        return `<g opacity="${person ? 1 : .34}"><path d="${fanWedge(cx, cy, inner, outer, start, end)}" fill="${palette[(slot.index + slot.generation) % palette.length]}" stroke="#fffaf0" stroke-width="2"/><text x="${at.x}" y="${at.y}" text-anchor="middle" fill="#352c22" font-size="${slot.generation > 4 ? 8 : 10.5}" font-weight="600" transform="rotate(${mid} ${at.x} ${at.y})">${escapeHtml((person ? personName(person) : 'Unknown').slice(0, slot.generation > 3 ? 13 : 20))}</text></g>`;
      }).join('');
      const focus = personMap.get(Number(payload.share?.focus_person_id)) || people[0];
      canvas.innerHTML = `<svg class="shared-chart-svg" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#faf6eb"/>${wedges}<path d="${fanWedge(cx, cy, 0, 50, -90, 90)}" fill="#345f50"/><text x="${cx}" y="${cy - 22}" text-anchor="middle" fill="#fffaf0" font-size="12" font-weight="700">${escapeHtml(personName(focus).slice(0, 22))}</text></svg>`;
      return;
    }
    const layout = layoutTools.computeTreeLayout(people, relationships, { cardWidth: 184, cardHeight: 76, spouseGap: 34, horizontalGap: 58, verticalGap: 76 });
    const margin = 60;
    const lines = relationships.map((relationship) => {
      const a = layout.personPos.get(Number(relationship.person1_id));
      const b = layout.personPos.get(Number(relationship.person2_id));
      if (!a || !b) return '';
      const spouse = relationship.type === 'spouse';
      const x1 = a.x + a.w / 2 + margin;
      const y1 = a.y + (spouse ? a.h / 2 : a.h) + margin;
      const x2 = b.x + b.w / 2 + margin;
      const y2 = b.y + (spouse ? b.h / 2 : 0) + margin;
      return `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${spouse ? '#b78639' : '#b8aa8d'}" stroke-width="2" fill="none"/>`;
    }).join('');
    const cards = people.map((person) => {
      const at = layout.personPos.get(Number(person.id));
      return at ? chartCard(person, at.x + margin, at.y + margin) : '';
    }).join('');
    canvas.innerHTML = `<svg class="shared-chart-svg" viewBox="0 0 ${Math.max(760, layout.width + margin * 2)} ${Math.max(480, layout.height + margin * 2)}"><rect width="100%" height="100%" fill="#f9f5e9"/>${lines}${cards}</svg>`;
  }

  async function loadSharedTree(token) {
    $('#authScreen')?.classList.add('hidden');
    $('#approvalScreen')?.classList.add('hidden');
    $('#app')?.classList.add('hidden');
    $('#sharedTreeScreen')?.classList.remove('hidden');
    $('#sharedTreeCanvas').innerHTML = '<div class="explorer-loading"><span></span><p>Opening private family presentation…</p></div>';
    try {
      const response = await fetch(`/api/shared-tree/${encodeURIComponent(token)}`, { headers: { Accept: 'application/json' } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'This private family link is unavailable.');
      $('#sharedTreeTitle').textContent = payload.share?.label || payload.tree?.name || 'Family tree';
      $('#sharedTreeExpiry').textContent = `Available until ${new Date(payload.share.expires_at).toLocaleString()}`;
      $('#sharedTreeNotice').textContent = `${payload.persons.length} relatives · read-only ${payload.share.view} view${payload.share.includes_living ? ' · limited living profiles included' : ''}`;
      renderSharedChart(payload);
    } catch (error) {
      $('#sharedTreeNotice').textContent = error.message;
      $('#sharedTreeCanvas').innerHTML = '<div class="explorer-empty-panel"><strong>This presentation cannot be opened.</strong><p>Ask the family administrator for a new private link.</p></div>';
    }
  }

  function bindControls() {
    const modeButton = document.createElement('button'); modeButton.type='button'; modeButton.id='explorer3dToggle'; modeButton.className='explorer-icon-button'; modeButton.textContent='3D view'; modeButton.setAttribute('aria-pressed','false'); document.querySelector('.explorer-output-controls')?.prepend(modeButton); modeButton.addEventListener('click',()=>{state.presentation=state.presentation==='3d'?'2d':'3d';modeButton.textContent=state.presentation==='3d'?'2D view':'3D view';modeButton.setAttribute('aria-pressed',String(state.presentation==='3d'));render();});
    $$('.explorer-view-button').forEach((button) => button.addEventListener('click', () => setView(button.dataset.explorerView)));
    $('#explorerFocusPerson')?.addEventListener('change', (event) => { state.focusId = Number(event.target.value); render(); });
    $('#explorerDepth')?.addEventListener('change', (event) => { state.depth = event.target.value === 'all' ? Infinity : Number(event.target.value); render(); });
    $('#explorerFocusBranchBtn')?.addEventListener('click', () => { state.focusBranch = !state.focusBranch; render(); });
    $('#explorerCollapseBtn')?.addEventListener('click', () => toggleCollapse(state.focusId));
    $('#explorerResetBranchesBtn')?.addEventListener('click', resetCollapsed);
    $('#explorerExportMenuBtn')?.addEventListener('click', () => {
      const menu = $('#explorerExportMenu');
      menu.classList.toggle('hidden');
      $('#explorerExportMenuBtn').setAttribute('aria-expanded', String(!menu.classList.contains('hidden')));
    });
    $$('[data-export-action]').forEach((button) => button.addEventListener('click', () => {
      $('#explorerExportMenu')?.classList.add('hidden');
      if (button.dataset.exportAction === 'png') exportPng();
      if (button.dataset.exportAction === 'pdf') exportPdf();
      if (button.dataset.exportAction === 'print') printCurrentView();
    }));
    $('#explorerShareBtn')?.addEventListener('click', openShareModal);
    $('#shareTreeModalClose')?.addEventListener('click', () => $('#shareTreeModalOverlay')?.classList.add('hidden'));
    $('#shareTreeModalOverlay')?.addEventListener('click', (event) => { if (event.target.id === 'shareTreeModalOverlay') event.currentTarget.classList.add('hidden'); });
    $('#shareTreeForm')?.addEventListener('submit', createShareLink);
    $('#shareCopyBtn')?.addEventListener('click', copyShareUrl);
    $('#refreshShareLinksBtn')?.addEventListener('click', loadShareLinks);
    $('#explorerPresentBtn')?.addEventListener('click', () => togglePresentation());
    $('#sharedTreeFullscreenBtn')?.addEventListener('click', () => togglePresentation($('#sharedTreeScreen')));
    $('#sharedTreeFitBtn')?.addEventListener('click', () => $('#sharedTreeCanvas')?.scrollTo({ left: 0, top: 0, behavior: 'smooth' }));
    state.initialized = true;
  }

  function toggleCollapse(personId) {
    const id = Number(personId);
    if (!id) return;
    if (state.collapsedIds.has(id)) state.collapsedIds.delete(id);
    else state.collapsedIds.add(id);
    render();
  }

  function resetCollapsed() {
    state.collapsedIds.clear();
    render();
  }

  function configureHost(host = {}) {
    state.host = { ...state.host, ...host };
    const canShare = state.host.hasFamilyRole?.('admin') ?? false;
    $('#explorerShareBtn')?.classList.toggle('hidden', !canShare);
  }

  bindControls();
  window.LineageExplorer = {
    configureHost,
    setData,
    setEvents(events) {
      state.events = Array.isArray(events) ? events : [];
      if (state.view === 'map') renderMap();
    },
    setView,
    getProjection: projectionFor,
    toggleCollapse,
    resetCollapsed,
    render,
    loadSharedTree,
    getState: () => ({ ...state, collapsedIds: new Set(state.collapsedIds) }),
  };
})();
