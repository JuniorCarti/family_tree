(()=>{
  const root=document.documentElement;
  if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
  const stateKey='lineage-release13-settings';
  const saved=JSON.parse(localStorage.getItem(stateKey)||'{}');
  root.classList.toggle('high-contrast',saved.contrast===true);root.style.setProperty('--access-font-scale',saved.fontScale||1);
  window.addEventListener('online',()=>document.body.classList.remove('offline-mode'));window.addEventListener('offline',()=>document.body.classList.add('offline-mode'));
  window.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(x=>x.classList.add('hidden'));});
  window.LineageAccessibility={toggleContrast(){saved.contrast=!saved.contrast;localStorage.setItem(stateKey,JSON.stringify(saved));root.classList.toggle('high-contrast',saved.contrast)},setFontScale(scale){saved.fontScale=Math.max(.9,Math.min(1.3,Number(scale)));localStorage.setItem(stateKey,JSON.stringify(saved));root.style.setProperty('--access-font-scale',saved.fontScale)}};
  window.addEventListener('online',async()=>{const queue=JSON.parse(localStorage.getItem('lineage-offline-queue')||'[]');if(!queue.length)return;const remaining=[];for(const item of queue){try{const r=await fetch(item.path,{method:item.method,headers:{'Content-Type':'application/json'},body:item.body});if(!r.ok)remaining.push(item)}catch(e){remaining.push(item)}}localStorage.setItem('lineage-offline-queue',JSON.stringify(remaining));document.body.classList.remove('offline-mode')});
  let installPrompt=null;
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;const button=document.createElement('button');button.type='button';button.className='btn btn-ghost pwa-install-button';button.textContent='Install app';button.setAttribute('aria-label','Install Lineage as an app');button.addEventListener('click',async()=>{if(!installPrompt)return;installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;button.remove()});(document.querySelector('.topbar-actions')||document.querySelector('.topbar')||document.body).append(button)});
  document.addEventListener('input',event=>{const form=event.target.closest&&event.target.closest('#personForm');if(!form)return;const draft={};new FormData(form).forEach((value,key)=>{if(typeof value==='string')draft[key]=value});localStorage.setItem('lineage-person-draft',JSON.stringify(draft))});
  document.addEventListener('click',event=>{if(!event.target.closest('#personModalOverlay')||event.target.closest('#personModalClose'))return;const raw=localStorage.getItem('lineage-person-draft');if(!raw)return;const draft=JSON.parse(raw);Object.entries(draft).forEach(([key,value])=>{const field=document.getElementById(key);if(field&&!field.value)field.value=value})});
  document.addEventListener('submit',event=>{if(event.target.id==='personForm')localStorage.removeItem('lineage-person-draft')});
})();
