// /cre start-up (X1, 2026-11-15): moved out of cre.html so the desk page carries no inline script, ready for a policy that forbids
// inline scripts (report-only first). A viewer token pins the person (the server answers its own desk); the owner may preview any desk
// with ?person=. The desk has no TV view (W12): ?view=tv is dropped from the address and never applied, and the deck's Commercial page
// stays the TV board. The address also loses the ?t= token once the cookie is set.
'use strict';
// ==== CRE BOOT PURE BEGIN (no DOM, no fetch: tests/cre_boot.test.js loads this block) ====
const CreBoot=(()=>{
 const PEOPLE=/^(tanner|jordan|riley)$/;
 const isViewer=who=>!!(who&&typeof who==='object'&&who.role==='viewer');
 // whose desk: a viewer's own, else ?person= when it names a desk, else the owner's
 function person(who,q){return isViewer(who)?String(who.person||''):PEOPLE.test(q||'')?q:'tanner'}
 // the address after start-up: no token, no TV view, nothing else from the query; ?person= stays for the owner's preview of another desk
 function cleanUrl(path,search,hash,who){const q=new URLSearchParams(search||'').get('person');
  return String(path||'/')+(isViewer(who)||!PEOPLE.test(q||'')?'':'?person='+q)+String(hash||'')}
 return {person,cleanUrl,isViewer}})();
// ==== CRE BOOT PURE END ====
if(typeof window!=='undefined'&&typeof creMount==='function')(async()=>{let who=null;
 try{const r=await fetch('/api/whoami',{credentials:'same-origin',cache:'no-store'});who=await r.json()}catch(e){}
 const q=new URLSearchParams(location.search).get('person'),url=CreBoot.cleanUrl(location.pathname,location.search,location.hash,who);
 if(url!==location.pathname+location.search+location.hash)history.replaceState(null,'',url);
 creMount(document.getElementById('cre-root'),{person:CreBoot.person(who,q),viewer:CreBoot.isViewer(who),scatterEl:document.getElementById('cre-sc'),toolsEl:document.getElementById('cre-tools')})})();
if(typeof module!=='undefined')module.exports={CreBoot};
