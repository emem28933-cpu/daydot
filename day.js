/* Daydot v0.6 DAY tasks: stored on this device first, then synced per account via Supabase (table: day_todos). */
(()=>{'use strict';
const $=id=>document.getElementById(id),key='daydot-day-todos-v1',knownKey=uid=>'daydot-day-known-v1:'+uid;
let todos=[],edit=null;
const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nowIso=()=>new Date().toISOString();
// Postgres returns microseconds (…:00.123456+00:00); older Safari can't parse that, so trim to milliseconds.
const parseTs=v=>{if(!v)return NaN;let n=Date.parse(v);if(Number.isFinite(n))return n;n=Date.parse(String(v).replace(' ','T').replace(/(\.\d{3})\d+/,'$1').replace(/\+00(:?00)?$/,'Z'));return n};
const iso=v=>{const n=parseTs(v);return Number.isFinite(n)?new Date(n).toISOString():null};
const stamp=t=>parseTs(t.updated||t.created)||0;
try{const parsed=JSON.parse(localStorage.getItem(key)||'[]');if(Array.isArray(parsed))todos=parsed.filter(t=>t&&typeof t.id==='string')}catch(e){console.warn('DAY 데이터 읽기 실패',e)}

let localVersion=0;
function persist(){try{localStorage.setItem(key,JSON.stringify(todos));return true}catch(e){alert('DAY 저장 실패: '+e.message);return false}}
function save(){localVersion++;if(persist()){render();scheduleSync(700)}}

function render(){const list=$('personalDayList');if(!list)return;$('dayPageTitle').textContent='할 일';
 const ordered=[...todos].sort((a,b)=>Number(a.done)-Number(b.done)||String(a.created||'').localeCompare(String(b.created||'')));
 list.innerHTML=ordered.length?ordered.map(t=>`<div class="personal-task"><input type="checkbox" data-todo-check="${esc(t.id)}" ${t.done?'checked':''} aria-label="완료"><button class="personal-task-text ${t.done?'done':''}" data-todo-edit="${esc(t.id)}" type="button"><strong>${esc(t.text)}</strong>${t.note?`<small>${esc(t.note)}</small>`:''}</button><button type="button" class="todo-more" data-todo-edit="${esc(t.id)}" aria-label="수정">⋯</button></div>`).join(''):'<div class="empty">아직 할 일이 없어요.<br>＋ 할 일로 추가해 보세요.</div>';
 $('personalDayCount').textContent=`${todos.filter(t=>t.done).length} / ${todos.length} 완료`;
 list.querySelectorAll('[data-todo-check]').forEach(x=>x.onchange=()=>{const t=todos.find(t=>t.id===x.dataset.todoCheck);if(t){t.done=x.checked;t.updated=nowIso();save()}});
 list.querySelectorAll('[data-todo-edit]').forEach(x=>x.onclick=()=>open(x.dataset.todoEdit));
}
function open(id){edit=id||null;const t=todos.find(t=>t.id===id);$('todoDialogTitle').textContent=t?'할 일 수정':'할 일 추가';$('todoText').value=t?.text||'';$('todoNote').value=t?.note||'';$('todoDelete').hidden=!t;$('todoDialog').showModal()}
$('todoForm').onsubmit=e=>{e.preventDefault();const text=$('todoText').value.trim();if(!text)return;const note=$('todoNote').value.trim(),at=nowIso();
 const t=edit&&todos.find(t=>t.id===edit);
 if(t)Object.assign(t,{text,note,updated:at});else todos.push({id:crypto.randomUUID(),text,note,done:false,created:at,updated:at});
 $('todoDialog').close();save()};
$('todoDelete').onclick=()=>{if(edit&&confirm('할 일을 삭제할까요?')){todos=todos.filter(t=>t.id!==edit);$('todoDialog').close();save()}};

/* ---------- Cloud sync ---------- */
const sayStatus=s=>{const el=$('daySyncStatus');if(el)el.textContent=s};
const cloud=()=>{const c=window.DaydotCloud,client=c?.getClient?.(),user=c?.getUser?.();return client&&user?{client,user}:null};
let syncing=false,again=false,timer=null,lastSync=0,lastUser=null,retryAfter=0;
function scheduleSync(ms){clearTimeout(timer);timer=setTimeout(sync,ms)}
function loadKnown(uid){try{const v=JSON.parse(localStorage.getItem(knownKey(uid))||'[]');return new Set(Array.isArray(v)?v:[])}catch{return new Set()}}
function fromRow(r){return{id:r.id,text:r.text,note:r.note||'',done:!!r.done,created:iso(r.created_at)||'1970-01-01T00:00:00.000Z',updated:iso(r.updated_at)||iso(r.created_at)||'1970-01-01T00:00:00.000Z'}}
function toRow(t,uid){const created=iso(t.created)||nowIso();return{id:t.id,user_id:uid,text:String(t.text).slice(0,150),note:String(t.note||'').slice(0,2000),done:!!t.done,created_at:created,updated_at:iso(t.updated)||created}}
const fp=list=>JSON.stringify([...list].map(t=>[t.id,t.text,t.note||'',!!t.done,stamp(t)]).sort());

async function sync(){
 const c=cloud();
 if(!c){lastUser=null;sayStatus('이 기기에만 저장 중 · 로그인하면 다른 기기와 동기화돼요');return}
 if(Date.now()<retryAfter)return;
 if(syncing){again=true;return}
 syncing=true;const startVersion=localVersion;
 try{
  const {client,user}=c;
  const {data,error}=await client.from('day_todos').select('id,text,note,done,created_at,updated_at');
  if(error)throw error;
  const known=loadKnown(user.id),remote=new Map((data||[]).map(r=>[r.id,fromRow(r)])),localIds=new Set(todos.map(t=>t.id));
  const next=[],upserts=[],deletes=[];
  for(const t of todos){
   const r=remote.get(t.id);
   if(r){if(stamp(t)>stamp(r)){next.push(t);upserts.push(t)}else next.push(r)}
   else if(!known.has(t.id)){next.push(t);upserts.push(t)}   // new on this device
   // else: was on server before and is gone now → deleted on another device
  }
  for(const r of remote.values()){if(localIds.has(r.id))continue;if(known.has(r.id))deletes.push(r.id);else next.push(r)}
  if(upserts.length){const {error:e}=await client.from('day_todos').upsert(upserts.map(t=>toRow(t,user.id)),{onConflict:'id'});if(e)throw e}
  if(deletes.length){const {error:e}=await client.from('day_todos').delete().in('id',deletes);if(e)throw e}
  if(localVersion!==startVersion){again=true;return}   // edited during sync; run again with fresh local state
  if(fp(next)!==fp(todos)){todos=next;persist();render()}
  try{localStorage.setItem(knownKey(user.id),JSON.stringify(next.map(t=>t.id)))}catch{}
  lastSync=Date.now();lastUser=user.id;
  const d=new Date();sayStatus(`☁ 동기화됨 · ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`);
 }catch(e){
  const msg=String(e?.message||e);
  if(/day_todos|42P01|PGRST205|schema cache|does not exist/i.test(msg+' '+(e?.code||''))){retryAfter=Date.now()+60000;sayStatus('서버 준비 필요: Supabase에서 04_day_todos.sql을 실행해 주세요. (기기에는 저장됨)')}
  else{retryAfter=Date.now()+10000;sayStatus('동기화 대기 중 · 연결되면 자동으로 올라가요 (기기에는 저장됨)')}
  console.warn('DAY 동기화 실패',e);
 }finally{syncing=false;if(again){again=false;scheduleSync(300)}}
}
setInterval(()=>{const c=cloud();if(!c){if(lastUser!==null||!$('daySyncStatus')?.textContent)sync();return}
 if(c.user.id!==lastUser||(document.visibilityState==='visible'&&Date.now()-lastSync>15000))sync()},3000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')scheduleSync(200)});
window.addEventListener('online',()=>{retryAfter=0;scheduleSync(200)});

window.DaydotTodos={render,add:()=>open(null),sync};
render();scheduleSync(800);
})();
