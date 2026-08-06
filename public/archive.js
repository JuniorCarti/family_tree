/* ==========================================================================
   Release 3 — Family Archive & Storytelling
   ========================================================================== */
(() => {
  const EVENT_LABELS = {
    birth: 'Birth', education: 'Education', marriage: 'Marriage', work: 'Work',
    migration: 'Migration', milestone: 'Milestone', death: 'Death', other: 'Other'
  };
  const EVENT_MARKS = {
    birth: 'B', education: 'E', marriage: 'M', work: 'W',
    migration: '→', milestone: '◆', death: 'D', other: '•'
  };
  let archiveOverview = null;
  let archiveEvents = [];
  let archiveStories = [];
  let editingEvent = null;
  let editingStory = null;
  let activeStoryId = null;
  let activeView = 'tree';
  let archiveRequestTimer = null;

  function archiveDate(value, fallback = 'Date not recorded') {
    if (!value) return fallback;
    const exact = String(value).match(/^\d{4}-\d{2}-\d{2}$/);
    if (!exact) return String(value);
    const date = new Date(value + 'T00:00:00');
    return Number.isNaN(date.getTime())
      ? String(value)
      : date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function eventYear(event) {
    return String(event.event_date || '').match(/\d{4}/)?.[0] || 'Undated';
  }

  function excerpt(value, length = 220) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > length ? text.slice(0, length).trimEnd() + '…' : text;
  }

  function setArchiveButtonAccess() {
    const canContribute = hasFamilyRole('contributor');
    $('#addEventBtn').classList.toggle('hidden', !canContribute);
    $('#addStoryBtn').classList.toggle('hidden', !canContribute);
  }

  function updatePersonFilters() {
    const people = state.persons
      .filter((person) => !person.privacy_redacted)
      .slice()
      .sort((a, b) => fullName(a).localeCompare(fullName(b)));
    const options = people.map((person) => `<option value="${person.id}">${escapeHtml(fullName(person))}</option>`).join('');
    $('#timelinePersonFilter').innerHTML = '<option value="">All family members</option>' + options;
    $('#storiesPersonFilter').innerHTML = '<option value="">All people</option>' + options;
    $('#eventPerson').innerHTML = '<option value="">Choose a person</option>' +
      people.filter((person) => person.can_edit).map((person) => `<option value="${person.id}">${escapeHtml(fullName(person))}</option>`).join('');
    $('#storyPeoplePicker').innerHTML = people.filter((person) => person.can_edit).map((person) => `
      <label class="person-pick">
        <input type="checkbox" value="${person.id}" />
        <span>${escapeHtml(fullName(person))}</span>
      </label>
    `).join('') || '<span class="muted-text">No editable people are available to tag.</span>';
  }

  function updateArchiveStats(data) {
    archiveOverview = data;
    const stats = data?.stats || {};
    $('#archiveEventCount').textContent = Number(stats.events || 0).toLocaleString();
    $('#archiveStoryCount').textContent = Number(stats.stories || 0).toLocaleString();
    $('#archiveYearsSpan').textContent = Number(stats.years_spanned || 0).toLocaleString();
    $('#timelineNavCount').textContent = Number(stats.events || 0);
    $('#storiesNavCount').textContent = Number(stats.stories || 0);
  }

  async function loadArchiveOverview() {
    if (!currentUser || currentUser.account_status !== 'approved' || !activeFamily()) return;
    setArchiveButtonAccess();
    updatePersonFilters();
    try {
      const data = await api('/archive/overview');
      updateArchiveStats(data);
      if (activeView === 'timeline') await loadTimeline();
      if (activeView === 'stories') await loadStories();
      if (activeView === 'evidence') await window.loadEvidence?.();
      if (activeView === 'memories') await window.loadMemories?.();
    } catch (error) {
      console.warn('Archive overview unavailable:', error.message);
    }
  }
  window.loadArchiveOverview = loadArchiveOverview;

  async function switchArchiveView(view, options = {}) {
    activeView = view;
    document.body.dataset.workspaceView = view;
    $$('.workspace-tab').forEach((button) => {
      const selected = button.dataset.view === view;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
    });
    $('#canvasWrap').classList.toggle('hidden', view !== 'tree');
    $('#explorerCommandBar')?.classList.toggle('hidden', view !== 'tree');
    $('#timelineView').classList.toggle('hidden', view !== 'timeline');
    $('#storiesView').classList.toggle('hidden', view !== 'stories');
    $('#evidenceView').classList.toggle('hidden', view !== 'evidence');
    $('#memoriesView').classList.toggle('hidden', view !== 'memories');
    $('#sidePanel').classList.add('hidden');
    ['#zoomOutBtn', '#zoomInBtn', '#resetViewBtn', '#addPersonBtn', '#mergeBtn', '#exportBtn'].forEach((selector) => {
      $(selector).classList.toggle('hidden', view !== 'tree');
    });
    $('.topbar .search-wrap').classList.toggle('hidden', view !== 'tree');
    if (view === 'tree') render();
    if (view === 'timeline') {
      if (options.personId) $('#timelinePersonFilter').value = String(options.personId);
      await loadTimeline();
    }
    if (view === 'stories') {
      if (options.personId) $('#storiesPersonFilter').value = String(options.personId);
      await loadStories();
    }
    if (view === 'evidence') await window.loadEvidence?.();
    if (view === 'memories') await window.loadMemories?.();
  }
  window.openTimelineForPerson = (personId) => switchArchiveView('timeline', { personId });

  $$('.workspace-tab').forEach((button) => button.addEventListener('click', () => {
    switchArchiveView(button.dataset.view).catch((error) => alert(error.message));
  }));

  function timelineQuery() {
    const params = new URLSearchParams();
    const q = $('#timelineSearch').value.trim();
    const personId = $('#timelinePersonFilter').value;
    const type = $('#timelineTypeFilter').value;
    if (q) params.set('q', q);
    if (personId) params.set('person_id', personId);
    if (type) params.set('type', type);
    return params.toString();
  }

  async function loadTimeline() {
    const data = await api('/archive/events?' + timelineQuery());
    archiveEvents = data.events || [];
    renderTimeline();
  }

  function renderTimeline() {
    const feed = $('#timelineFeed');
    if (!archiveEvents.length) {
      feed.innerHTML = `
        <div class="archive-empty">
          <span class="archive-empty-mark">◷</span>
          <h3>No moments found</h3>
          <p>${hasFamilyRole('contributor') ? 'Record the first milestone, migration, or memory in this family chronicle.' : 'No visible events match these filters.'}</p>
        </div>`;
      $('#timelineYearIndex').innerHTML = '';
      return;
    }
    const groups = new Map();
    archiveEvents.forEach((event) => {
      const year = eventYear(event);
      if (!groups.has(year)) groups.set(year, []);
      groups.get(year).push(event);
    });
    const ordered = [...groups.entries()].sort(([a], [b]) => {
      if (a === 'Undated') return 1;
      if (b === 'Undated') return -1;
      return Number(a) - Number(b);
    });
    $('#timelineYearIndex').innerHTML = ordered.map(([year]) =>
      `<button class="timeline-year-link" data-year="${escapeHtml(year)}" type="button">${escapeHtml(year)}</button>`
    ).join('');
    feed.innerHTML = ordered.map(([year, events]) => `
      <section class="timeline-year" id="timeline-year-${escapeHtml(year)}">
        <div class="timeline-year-label">${escapeHtml(year)}</div>
        <div class="timeline-year-events">
          ${events.map((event) => `
            <article class="timeline-event-card" data-event-id="${event.id}">
              <span class="event-type-mark">${EVENT_MARKS[event.event_type] || '•'}</span>
              <div class="event-card-copy">
                <div class="event-card-meta">${escapeHtml(EVENT_LABELS[event.event_type] || 'Event')} · ${escapeHtml(archiveDate(event.event_date))}${event.end_date ? ' — ' + escapeHtml(archiveDate(event.end_date)) : ''}${event.place ? ' · ' + escapeHtml(event.place) : ''}</div>
                <h3>${escapeHtml(event.title)}</h3>
                ${event.description ? `<p>${escapeHtml(event.description)}</p>` : ''}
                <span class="event-person-chip">${escapeHtml(event.person_name)}</span>
                ${event.source_url ? `<a class="event-card-source" href="${escapeHtml(event.source_url)}" target="_blank" rel="noopener">Source: ${escapeHtml(event.source_title || 'Open reference')} ↗</a>` : event.source_title ? `<span class="event-card-source">Source: ${escapeHtml(event.source_title)}</span>` : ''}
              </div>
              ${event.can_edit ? '<button class="archive-card-menu edit-event-btn" type="button" title="Edit event">•••</button>' : ''}
            </article>
          `).join('')}
        </div>
      </section>
    `).join('');
    $$('.timeline-year-link').forEach((button) => button.addEventListener('click', () => {
      document.getElementById('timeline-year-' + button.dataset.year)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    $$('.edit-event-btn').forEach((button) => button.addEventListener('click', () => {
      const event = archiveEvents.find((item) => item.id === Number(button.closest('[data-event-id]').dataset.eventId));
      openEventEditor(event);
    }));
  }

  function openEventEditor(event = null, personId = null) {
    editingEvent = event;
    $('#eventModalTitle').textContent = event ? 'Edit this moment' : 'Add a moment';
    $('#eventPerson').disabled = Boolean(event);
    $('#eventPerson').value = String(event?.person_id || personId || '');
    $('#eventType').value = event?.event_type || 'milestone';
    $('#eventVisibility').value = event?.visibility || 'family';
    $('#eventTitle').value = event?.title || '';
    $('#eventDate').value = event?.event_date || '';
    $('#eventEndDate').value = event?.end_date || '';
    $('#eventPlace').value = event?.place || '';
    $('#eventLatitude').value = event?.latitude ?? '';
    $('#eventLongitude').value = event?.longitude ?? '';
    $('#eventDescription').value = event?.description || '';
    $('#eventSourceTitle').value = event?.source_title || '';
    $('#eventSourceUrl').value = event?.source_url || '';
    $('#deleteEventBtn').classList.toggle('hidden', !event?.can_edit);
    $('#eventFormMessage').className = 'hidden family-message';
    $('#eventModalOverlay').classList.remove('hidden');
  }
  window.openEventForPerson = (personId) => openEventEditor(null, personId);

  function closeEventEditor() {
    editingEvent = null;
    $('#eventModalOverlay').classList.add('hidden');
  }

  $('#addEventBtn').addEventListener('click', () => openEventEditor());
  $('#eventModalClose').addEventListener('click', closeEventEditor);
  $('#cancelEventBtn').addEventListener('click', closeEventEditor);
  $('#eventForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      person_id: Number($('#eventPerson').value),
      event_type: $('#eventType').value,
      visibility: $('#eventVisibility').value,
      title: $('#eventTitle').value.trim(),
      event_date: $('#eventDate').value.trim() || null,
      end_date: $('#eventEndDate').value.trim() || null,
      place: $('#eventPlace').value.trim() || null,
      latitude: $('#eventLatitude').value.trim() || null,
      longitude: $('#eventLongitude').value.trim() || null,
      description: $('#eventDescription').value.trim() || null,
      source_title: $('#eventSourceTitle').value.trim() || null,
      source_url: $('#eventSourceUrl').value.trim() || null
    };
    try {
      const path = editingEvent ? `/archive/events/${editingEvent.id}` : '/archive/events';
      await api(path, { method: editingEvent ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      window.LineageExplorer?.setEvents([]);
      closeEventEditor();
      await Promise.all([loadTimeline(), loadArchiveOverview()]);
    } catch (error) {
      $('#eventFormMessage').textContent = error.message;
      $('#eventFormMessage').className = 'family-message error';
    }
  });
  $('#deleteEventBtn').addEventListener('click', async () => {
    if (!editingEvent || !confirm('Delete this life event from the archive?')) return;
    await api(`/archive/events/${editingEvent.id}`, { method: 'DELETE' });
    closeEventEditor();
    await Promise.all([loadTimeline(), loadArchiveOverview()]);
  });

  function storyQuery() {
    const params = new URLSearchParams();
    const q = $('#storiesSearch').value.trim();
    const personId = $('#storiesPersonFilter').value;
    if (q) params.set('q', q);
    if (personId) params.set('person_id', personId);
    return params.toString();
  }

  async function loadStories() {
    const data = await api('/archive/stories?' + storyQuery());
    archiveStories = data.stories || [];
    renderStories();
  }

  function renderStories() {
    $('#storiesResultCount').textContent = `${archiveStories.length} ${archiveStories.length === 1 ? 'story' : 'stories'}`;
    const featured = $('#storiesFeatured');
    const grid = $('#storyGrid');
    if (!archiveStories.length) {
      featured.classList.add('hidden');
      grid.innerHTML = `
        <div class="archive-empty">
          <span class="archive-empty-mark">¶</span>
          <h3>The journal is waiting</h3>
          <p>${hasFamilyRole('contributor') ? 'Write down the story everyone tells before details fade.' : 'No visible stories match these filters.'}</p>
        </div>`;
      return;
    }
    const first = archiveStories[0];
    featured.classList.remove('hidden');
    featured.dataset.storyId = first.id;
    featured.innerHTML = `
      <div class="featured-story-copy">
        <p class="archive-kicker">FEATURED MEMORY · ${escapeHtml(archiveDate(first.story_date, 'UNDATED'))}</p>
        <h2>${escapeHtml(first.title)}</h2>
        <p>${escapeHtml(excerpt(first.body, 340))}</p>
        <div class="story-card-meta">Told by ${escapeHtml(first.author_name)}${first.place ? ' · ' + escapeHtml(first.place) : ''}</div>
      </div>
      <div class="featured-story-aside"><span class="featured-monogram">${escapeHtml(first.title.charAt(0).toUpperCase())}</span></div>
    `;
    const remaining = archiveStories.slice(1);
    grid.innerHTML = remaining.map((story, index) => `
      <article class="story-card" data-story-id="${story.id}">
        <span class="story-card-number">${String(index + 1).padStart(2, '0')}</span>
        <div class="story-card-meta">${escapeHtml(archiveDate(story.story_date, 'UNDATED'))}${story.place ? ' · ' + escapeHtml(story.place) : ''}</div>
        <h3>${escapeHtml(story.title)}</h3>
        <p class="story-card-excerpt">${escapeHtml(excerpt(story.body))}</p>
        ${story.people.length ? `<div class="event-person-chip">${story.people.length} ${story.people.length === 1 ? 'person' : 'people'} remembered</div>` : ''}
        <footer class="story-card-footer">
          <span class="story-card-meta">By ${escapeHtml(story.author_name)}</span>
          <span class="story-comment-count">${story.comment_count} notes</span>
        </footer>
      </article>
    `).join('');
    featured.onclick = () => openStoryReader(Number(featured.dataset.storyId));
    $$('.story-card').forEach((card) => card.addEventListener('click', () => openStoryReader(Number(card.dataset.storyId))));
  }

  function selectedStoryPeople() {
    return [...$('#storyPeoplePicker').querySelectorAll('input:checked')].map((input) => Number(input.value));
  }

  function openStoryEditor(story = null) {
    editingStory = story;
    $('#storyModalTitle').textContent = story ? 'Edit family story' : 'Write a family story';
    $('#storyTitle').value = story?.title || '';
    $('#storyBody').value = story?.body || '';
    $('#storyDate').value = story?.story_date || '';
    $('#storyPlace').value = story?.place || '';
    $('#storyVisibility').value = story?.visibility || 'family';
    const selected = new Set((story?.people || []).map((person) => Number(person.id)));
    $('#storyPeoplePicker').querySelectorAll('input').forEach((input) => { input.checked = selected.has(Number(input.value)); });
    $('#deleteStoryBtn').classList.toggle('hidden', !story?.can_edit);
    $('#storyFormMessage').className = 'hidden family-message';
    $('#storyModalOverlay').classList.remove('hidden');
    setTimeout(() => $('#storyTitle').focus(), 40);
  }

  function closeStoryEditor() {
    editingStory = null;
    $('#storyModalOverlay').classList.add('hidden');
  }

  $('#addStoryBtn').addEventListener('click', () => openStoryEditor());
  $('#storyModalClose').addEventListener('click', closeStoryEditor);
  $('#cancelStoryBtn').addEventListener('click', closeStoryEditor);
  $('#storyForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      title: $('#storyTitle').value.trim(),
      body: $('#storyBody').value.trim(),
      story_date: $('#storyDate').value.trim() || null,
      place: $('#storyPlace').value.trim() || null,
      visibility: $('#storyVisibility').value,
      person_ids: selectedStoryPeople()
    };
    try {
      const path = editingStory ? `/archive/stories/${editingStory.id}` : '/archive/stories';
      await api(path, { method: editingStory ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      closeStoryEditor();
      await Promise.all([loadStories(), loadArchiveOverview()]);
    } catch (error) {
      $('#storyFormMessage').textContent = error.message;
      $('#storyFormMessage').className = 'family-message error';
    }
  });
  $('#deleteStoryBtn').addEventListener('click', async () => {
    if (!editingStory || !confirm('Delete this family story?')) return;
    await api(`/archive/stories/${editingStory.id}`, { method: 'DELETE' });
    closeStoryEditor();
    $('#storyReaderOverlay').classList.add('hidden');
    await Promise.all([loadStories(), loadArchiveOverview()]);
  });

  async function openStoryReader(storyId) {
    activeStoryId = storyId;
    const data = await api(`/archive/stories/${storyId}`);
    const story = data.story;
    const comments = data.comments || [];
    $('#storyReaderContent').innerHTML = `
      <header class="story-reader-header">
        <p>${escapeHtml(archiveDate(story.story_date, 'Date not recorded'))}${story.place ? ' · ' + escapeHtml(story.place) : ''} · Told by ${escapeHtml(story.author_name)}</p>
        <h1>${escapeHtml(story.title)}</h1>
        <div class="story-card-meta">${escapeHtml(story.visibility)} archive</div>
      </header>
      <div class="story-reader-body">${escapeHtml(story.body)}</div>
      ${story.people.length ? `<div class="story-reader-people">${story.people.map((person) => `<button class="story-person-chip reader-person-btn" data-id="${person.id}" type="button">${escapeHtml(person.name)}</button>`).join('')}</div>` : ''}
      ${story.can_edit ? '<div class="story-reader-actions"><button class="btn btn-ghost" id="readerEditStoryBtn" type="button">Edit story</button></div>' : ''}
      <section class="story-comments">
        <h3>Family notes <span class="stories-result-count">${comments.length}</span></h3>
        <div id="storyCommentList">${comments.map((comment) => `
          <article class="story-comment" data-comment-id="${comment.id}">
            <strong>${escapeHtml(comment.author_name)}</strong>
            <span class="story-card-meta"> · ${new Date(comment.created_at).toLocaleString()}</span>
            <p>${escapeHtml(comment.body)}</p>
            ${comment.can_delete ? '<button class="btn btn-text delete-comment-btn" type="button">Delete</button>' : ''}
          </article>
        `).join('') || '<p class="muted-text">No notes yet. Add context, a correction, or another memory.</p>'}</div>
        <form class="comment-form" id="storyCommentForm">
          <input id="storyCommentBody" maxlength="2000" placeholder="Add a family note..." required />
          <button class="btn btn-primary" type="submit">Add note</button>
        </form>
      </section>
    `;
    $('#storyReaderOverlay').classList.remove('hidden');
    $('#readerEditStoryBtn')?.addEventListener('click', () => openStoryEditor(story));
    $$('.reader-person-btn').forEach((button) => button.addEventListener('click', () => {
      $('#storyReaderOverlay').classList.add('hidden');
      switchArchiveView('timeline', { personId: Number(button.dataset.id) });
    }));
    $$('.delete-comment-btn').forEach((button) => button.addEventListener('click', async () => {
      if (!confirm('Delete this family note?')) return;
      await api(`/archive/comments/${button.closest('[data-comment-id]').dataset.commentId}`, { method: 'DELETE' });
      await openStoryReader(storyId);
    }));
    $('#storyCommentForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      await api(`/archive/stories/${storyId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: $('#storyCommentBody').value.trim() })
      });
      await openStoryReader(storyId);
      await loadStories();
    });
  }

  $('#storyReaderClose').addEventListener('click', () => {
    activeStoryId = null;
    $('#storyReaderOverlay').classList.add('hidden');
  });

  function delayedArchiveLoad(kind) {
    clearTimeout(archiveRequestTimer);
    archiveRequestTimer = setTimeout(() => {
      (kind === 'timeline' ? loadTimeline() : loadStories()).catch((error) => console.warn(error.message));
    }, 220);
  }
  $('#timelineSearch').addEventListener('input', () => delayedArchiveLoad('timeline'));
  $('#timelinePersonFilter').addEventListener('change', loadTimeline);
  $('#timelineTypeFilter').addEventListener('change', loadTimeline);
  $('#storiesSearch').addEventListener('input', () => delayedArchiveLoad('stories'));
  $('#storiesPersonFilter').addEventListener('change', loadStories);
  $('#archiveExportBtn').addEventListener('click', () => { window.location.href = API + '/archive/export'; });
})();
