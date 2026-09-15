(function exposeBootState(root) {
  function setHidden(documentRef, id, hidden) {
    const element = documentRef.getElementById(id);
    if (element) element.classList.toggle('hidden', hidden);
  }

  function showStartupFailure(documentRef) {
    setHidden(documentRef, 'app', true);
    setHidden(documentRef, 'approvalScreen', true);
    setHidden(documentRef, 'authScreen', false);
    setHidden(documentRef, 'bootError', false);
  }

  const api = { showStartupFailure };
  root.LineageBoot = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
