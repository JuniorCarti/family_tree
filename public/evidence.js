/* Release 4/5: source library, attached claims, and GEDCOM actions. */
(() => {
  let sources = [];
  const $ = (s) => document.querySelector(s);
  const esc = (v) => window.escapeHtml ? escapeHtml(v) : String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const typeLabels = { birth_certificate:'Birth certificate', death_certificate:'Death certificate', marriage_record:'Marriage record', census:'Census', school_record:'School record', church_record:'Church record', land_record:'Land record', newspaper:'Newspaper', photograph:'Photograph', interview:'Interview', online_archive:'Online archive', other:'Other' };
  async function loadEvidence() {
    if (!currentUser || currentUser.account_status !== 'approved') return;
    const q = $('#evidenceSearch')?.value.trim() || '';
    const data = await api('/evidence/sources' + (q ? `?q=${encodeURIComponent(q)}` : ''));
    sources = data.sources || [];
    $('#evidenceResultCount').textContent = `${sources.length} ${sources.length === 1 ? 'source' : 'sources'}`;
    $('#evidenceNavCount').textContent = sources.length;
    $('#evidenceSourceList').innerHTML = sources.length ? sources.map((s) => `<button class="evidence-source-card" type="button" data-source-id="${s.id}"><span class="evidence-source-type">${esc(typeLabels[s.source_type] || 'Source')}</span><strong>${esc(s.title)}</strong><span>${esc(s.repository || s.archive_location || 'Repository not recorded')}</span><small>${s.citation_count} attached claim${s.citation_count === 1 ? '' : 's'}</small></button>`).join('') : '<div class="empty-card"><h2>No sources yet</h2><p>Add a certificate, archive, photograph, interview, or other record to start your evidence trail.</p></div>';
    document.querySelectorAll('[data-source-id]').forEach((button) => button.addEventListener('click', () => showSource(sources.find((s) => String(s.id) === button.dataset.sourceId))));
  }
  function showSource(s) {
    if (!s) return;
    $('#evidenceDetail').innerHTML = `<div class="evidence-detail-head"><span class="evidence-source-type">${esc(typeLabels[s.source_type] || 'Source')}</span><h2>${esc(s.title)}</h2><p>${esc(s.description || 'No description added yet.')}</p></div><dl class="evidence-meta"><dt>Repository</dt><dd>${esc(s.repository || 'Not recorded')}</dd><dt>Archive location</dt><dd>${esc(s.archive_location || 'Not recorded')}</dd><dt>Call number</dt><dd>${esc(s.call_number || 'Not recorded')}</dd><dt>Publication/date</dt><dd>${esc([s.publication_info, s.source_date].filter(Boolean).join(' · ') || 'Not recorded')}</dd></dl><div class="evidence-detail-actions"><button class="btn btn-primary" id="addCitationBtn">Attach a claim</button><button class="btn btn-ghost" id="exportEvidenceGedcomBtn">Export GEDCOM</button></div><p class="muted-text">${s.citation_count} claim${s.citation_count === 1 ? '' : 's'} can preserve competing facts without changing the family tree.</p>`;
    $('#addCitationBtn').onclick = () => addCitation(s);
    $('#exportEvidenceGedcomBtn').onclick = () => downloadGedcom();
  }
  async function addSource() {
    const title = prompt('Source title (for example, “Nelson Wabwaya birth certificate”)'); if (!title) return;
    const repository = prompt('Repository or archive location (optional)') || '';
    const kind = prompt(`Source type: ${Object.keys(typeLabels).join(', ')}`, 'other') || 'other';
    await api('/evidence/sources', { method:'POST', body: JSON.stringify({ title, repository, source_type: typeLabels[kind] ? kind : 'other' }) });
    await loadEvidence();
  }
  async function addCitation(source) {
    const subjectType = $('#evidenceSubjectType').value; const subjectId = Number($('#evidenceSubjectId').value);
    if (!subjectId) return alert('Enter the person, relationship, event, or story ID first.');
    const factKey = prompt('Fact key (birth_date, birth_place, relationship, or custom fact)') || 'custom';
    const claim = prompt('Claim recorded by this source') || ''; if (!claim) return;
    const confidence = prompt('Confidence: confirmed, probable, uncertain, or disputed', 'probable') || 'probable';
    const note = prompt('Research note explaining the conclusion (optional)') || '';
    await api('/evidence/citations', { method:'POST', body: JSON.stringify({ source_id:source.id, subject_type:subjectType, subject_id:subjectId, fact_key:factKey, claim_value:claim, confidence, research_note:note }) });
    alert('Evidence claim attached. Conflicting claims remain separate and visible.');
    await loadEvidence();
  }
  async function loadAttached() {
    const type=$('#evidenceSubjectType').value,id=Number($('#evidenceSubjectId').value);if(!id)return alert('Enter a subject ID.');
    const data=await api(`/evidence/citations?subject_type=${type}&subject_id=${id}`);
    const claims=(data.citations||[]).map((c)=>{const media=(c.media||[]).map((m)=>'<a href="'+esc(m.url)+'" target="_blank" rel="noreferrer">View original: '+esc(m.name||'attachment')+'</a>').join('');return '<article class="evidence-claim"><div><strong>'+esc(c.fact_key||'Claim')+'</strong><span class="confidence-badge confidence-'+esc(c.confidence)+'">'+esc(c.confidence)+'</span></div><p>'+esc(c.claim_value||c.citation_text||'No claim text')+'</p><small>'+esc(c.source_title)+(c.page?' · Page '+esc(c.page):'')+(c.record_identifier?' · Record '+esc(c.record_identifier):'')+'</small>'+(c.research_note?'<p class="muted-text">Research note: '+esc(c.research_note)+'</p>':'')+media+'</article>';}).join('');
    $('#evidenceDetail').innerHTML=claims?'<div class="evidence-detail-head"><span class="evidence-source-type">ATTACHED EVIDENCE</span><h2>'+data.citations.length+' claim'+(data.citations.length===1?'':'s')+'</h2><p>Each claim is independent, so uncertain or disputed records do not overwrite the tree.</p></div>'+claims:'<div class="empty-card"><h2>No evidence attached</h2><p>This subject does not have source claims yet.</p></div>';
  }
  async function downloadGedcom(zip=false){const response=await fetch('/api/gedcom/export'+(zip?'?format=gedzip':''),{credentials:'same-origin'});if(!response.ok)return alert('GEDCOM export is unavailable.');const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=zip?'lineage-family.ged.zip':'lineage-family.ged';a.click();URL.revokeObjectURL(url);}
  async function previewGedcom(file){const form=new FormData();form.append('file',file);const response=await fetch('/api/gedcom/preview',{method:'POST',body:form,credentials:'same-origin'});const data=await response.json();if(!response.ok)return alert(data.error||'Import preview failed');const duplicateText=data.duplicates.length?`\nPotential duplicates: ${data.duplicates.length}`:'\nNo likely duplicates found';if(confirm(`GEDCOM preview\nPeople: ${data.summary.people}\nFamilies: ${data.summary.families}\nSources: ${data.summary.sources}${duplicateText}\n\nImport these records now?`)){const imported=await api(`/gedcom/import/${data.preview_id}`,{method:'POST',body:'{}'});alert(`Imported ${imported.imported_people} people.`);window.loadTree?.();}}
  window.loadEvidence=loadEvidence;
  $('#addSourceBtn')?.addEventListener('click',()=>addSource().catch(e=>alert(e.message)));
  $('#loadEvidenceBtn')?.addEventListener('click',()=>loadAttached().catch(e=>alert(e.message)));
  $('#evidenceSearch')?.addEventListener('input',()=>loadEvidence().catch(()=>{}));
  $('#gedcomExportBtn')?.addEventListener('click',()=>downloadGedcom().catch(e=>alert(e.message)));
  $('#gedzipExportBtn')?.addEventListener('click',()=>downloadGedcom(true).catch(e=>alert(e.message)));
  $('#gedcomImportFile')?.addEventListener('change',(e)=>e.target.files[0]&&previewGedcom(e.target.files[0]).catch(err=>alert(err.message)));
})();
