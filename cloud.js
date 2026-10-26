/* Daydot v0.4: explicit first-time migration, authenticated, RLS-protected Supabase sync. */
const $=id=>document.getElementById(id);
let client=null,user=null,active=false,busy=false,queued=false,baseline=null,lastPoll=0,suppress=false;
const cfgKey='daydot-supabase-config-v1';
const status=(msg)=>{$('cloudStatus').textContent=msg};
const uuid=()=>crypto.randomUUID();
const unique=(x)=>[...new Set(x)];
const sortJson=v=>JSON.stringify(v);
const sigCal=c=>sortJson([c.name,c.color]);
const sigEv=e=>sortJson([e.calId,e.text,e.date,e.endDate||null,e.note||'',e.repeat||null,!!e.done]);
const dateNow=()=>new Date().toISOString().slice(0,10);
const preserveBackup=()=>{
  const a=document.createElement('a'),blob=new Blob([JSON.stringify({app:'Daydot',schemaVersion:2,exportedAt:new Date().toISOString(),data:window.DaydotLocal.get()},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);a.href=url;a.download=`daydot-before-cloud-${dateNow()}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
};
function visible(){
  if(user){$('cloudEmail').value=user.email||''}
  $('cloudConfig').hidden=!!client;
  $('cloudAuth').hidden=!client;
  $('cloudWorkspace').hidden=!user;
  $('cloudSignOut').hidden=!user;
  $('cloudSignIn').hidden=!!user;
  $('cloudSignUp').hidden=!!user;
  $('cloudEmail').disabled=!!user;
  $('cloudPassword').disabled=!!user;
}
function openCloud(){ $('settingsDialog').close();$('cloudDialog').showModal();renderShareCals();visible() }
$('cloudOpen').onclick=$('cloudOpen2').onclick=openCloud;
$('cloudReloadConfig').onclick=()=>{active=false;localStorage.removeItem(cfgKey);client=null;user=null;visible();status('프로젝트 URL과 publishable key를 다시 입력해 주세요.')};
// Package version pinned. No service role/secret keys may be supplied to this browser client.
async function connect(url,key){
  url=url.trim().replace(/\/$/,'');key=key.trim();
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url))throw Error('Supabase 프로젝트 URL 형식이 아닙니다.');
  if(!key.startsWith('sb_publishable_')&&!key.startsWith('eyJ'))throw Error('publishable key 또는 레거시 anon key만 입력해 주세요.');
  const lib=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.0/+esm');
  client=lib.createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  const {data:{user:u},error}=await client.auth.getUser();if(error&&error.name!=='AuthSessionMissingError')console.warn(error);
  user=u||null;visible();if(user){status(`${user.email} 로그인됨 · 동기화 시작…`);renderShareCals();startSync(true)}else status('연결 완료. 이메일로 회원가입하거나 로그인하세요.');
  client.auth.onAuthStateChange((_event,session)=>{const prev=user?.id;user=session?.user||null;visible();if(!user){active=false;baseline=null}else if(user.id!==prev&&!active)setTimeout(()=>startSync(true),0)});
}
$('cloudConnect').onclick=async()=>{try{status('서버 연결 중…');const url=$('cloudUrl').value,key=$('cloudKey').value;await connect(url,key);localStorage.setItem(cfgKey,JSON.stringify({url,key}));}catch(e){status(`연결 실패: ${e.message}`)}};
$('cloudSignUp').onclick=async()=>{if(!client)return;const email=$('cloudEmail').value.trim(),password=$('cloudPassword').value;if(!email||password.length<8){status('이메일과 8자 이상의 비밀번호를 입력해 주세요.');return}const {error,data}=await client.auth.signUp({email,password});status(error?`가입 실패: ${error.message}`:data.session?'가입 및 로그인 완료.':'가입 신청 완료. 이메일 인증을 마친 뒤 로그인하세요.');};
$('cloudSignIn').onclick=async()=>{if(!client)return;const {error,data}=await client.auth.signInWithPassword({email:$('cloudEmail').value.trim(),password:$('cloudPassword').value});if(error){status(`로그인 실패: ${error.message}`);return}user=data.user;active=false;visible();status('로그인 완료 · 동기화 시작…');startSync(true)};
$('cloudSignOut').onclick=async()=>{if(!client)return;await client.auth.signOut();user=null;active=false;baseline=null;visible();status('로그아웃했습니다. 로컬 데이터는 유지됩니다.')};
async function getRows(table){
 // iOS installed web apps can fail simultaneous cross-origin requests. Read sequentially,
 // retry a transient transport error only once, and identify the failing table.
 for(let attempt=0;attempt<2;attempt++){
  try{
   const {data,error}=await client.from(table).select('*');
   if(error)throw error;
   return data||[];
  }catch(err){
   const network=/fetch|load failed|network|timed out/i.test(String(err?.message||err));
   if(network&&attempt===0){await new Promise(r=>setTimeout(r,650));continue}
   throw Error(`${table} 조회 실패: ${err?.message||String(err)}${network?' (네트워크 연결 또는 Safari 통신 문제)':''}`);
  }
 }
}
async function getRemote(quiet){
 const say=t=>{if(!quiet)status(t)};
 say('서버 캘린더 확인 중…');const c=await getRows('calendars');
 say('서버 공유 권한 확인 중…');const m=await getRows('calendar_members');
 say('서버 일정 확인 중…');const e=await getRows('events');if(e.length)endCol=('end_date' in e[0]);
 const byId=new Map(c.map(x=>[x.id,x]));const mine=m.filter(x=>byId.has(x.calendar_id));
 return {calendars:c.map(x=>({id:x.id,name:x.name,color:x.color,visible:true,owner_id:x.owner_id,role:x.owner_id===user.id?'owner':(mine.find(y=>y.calendar_id===x.id&&y.user_id===user.id)?.role||'viewer')})),events:e.map(x=>({id:x.id,calId:x.calendar_id,text:x.text,date:x.event_date,endDate:x.end_date||null,note:x.note||'',repeat:x.repeat,done:x.done}))};
}
function applyRemote(remote){
 suppress=true;try{const cur=window.DaydotLocal.get();const vis=new Map(cur.calendars.map(x=>[x.id,x.visible]));window.DaydotLocal.set({calendars:remote.calendars.map(x=>({...x,visible:vis.get(x.id)??true})),events:remote.events,settings:cur.settings});saveBaseline({calendars:remote.calendars,events:remote.events});active=true;}finally{suppress=false}
 renderShareCals();
}
function renderShareCals(){const d=window.DaydotLocal.get();$('cloudShareCal').innerHTML=d.calendars.filter(c=>!c.role||c.role==='owner').map(c=>`<option value="${c.id}">${c.name.replaceAll('&','&amp;').replaceAll('<','&lt;')}</option>`).join('')}
let endCol=null;const needEndSql=()=>status('여러 날 일정을 서버에 저장하려면 Supabase에서 05_multiday.sql을 실행해 주세요.');
async function endSafe(row,f){if(endCol===false&&'end_date' in row){delete row.end_date;needEndSql()}let res=await f(row);if(res.error&&'end_date' in row&&/end_date/.test(`${res.error.message} ${res.error.details||''}`)){endCol=false;delete row.end_date;res=await f(row);needEndSql()}if(res.error)throw res.error;return res.data}
async function insertRow(table,row){await endSafe(row,r=>client.from(table).insert(r))}
async function upsertRow(table,row){const {error}=await client.from(table).upsert(row,{onConflict:'id'});if(error)throw error}
async function deleteRow(table,id){const {error}=await client.from(table).delete().eq('id',id);if(error)throw error}
// ---- Sync engine (v0.10): auto-start when signed in, never lose offline edits ----
const baseKey=()=>user?`daydot-cloud-baseline-v1:${user.id}`:null;
function saveBaseline(b){baseline=b;try{const k=baseKey();if(k)localStorage.setItem(k,JSON.stringify(b))}catch(e){console.warn('baseline 저장 실패',e)}}
function loadBaseline(){try{const k=baseKey();const v=k&&JSON.parse(localStorage.getItem(k)||'null');return v&&Array.isArray(v.calendars)&&Array.isArray(v.events)?v:null}catch{return null}}
let dirty=false,retryTimer=null;
function scheduleRetry(ms=30000){clearTimeout(retryTimer);retryTimer=setTimeout(()=>startSync(true),ms)}
const isMine=c=>c.owner_id?c.owner_id===user?.id:(!c.role||c.role==='owner');

// Push everything that differs from the last confirmed server state.
async function pushDiff(){
 const local=window.DaydotLocal.get(),prior=baseline;
 const prevC=new Map(prior.calendars.map(c=>[c.id,c])),curC=new Map(local.calendars.map(c=>[c.id,c]));
 const prevE=new Map(prior.events.map(e=>[e.id,e])),curE=new Map(local.events.map(e=>[e.id,e]));
 const delE=[...prevE.keys()].filter(id=>!curE.has(id)),delC=[...prevC.keys()].filter(id=>!curC.has(id));
 let allowDelete=true,denied=0,lastDenyMsg='';
 if((delE.length>=5&&delE.length>prior.events.length*0.3)||delC.length>=2){
  allowDelete=confirm(`이 기기에서 일정 ${delE.length}개${delC.length?`, 캘린더 ${delC.length}개`:''}가 지워져 있어요. 서버에서도 삭제할까요?\n\n취소하면 서버에 있는 내용으로 되돌려요.`);
 }
 // A change the server refuses (e.g. a view-only shared calendar) is skipped and later replaced by the server copy.
 const op=async f=>{try{await f()}catch(e){if(/row-level security|permission|42501|not allowed|forbidden|violates/i.test(`${e?.message||''} ${e?.code||''}`)){denied++;lastDenyMsg=e?.message||String(e);console.warn('서버가 거부한 변경',e);return}throw e}};
 const upd=(table,row,id)=>op(async()=>{const data=await endSafe(row,r=>client.from(table).update(r).eq('id',id).select('id'));if(Array.isArray(data)&&!data.length)throw {message:'permission: 0 rows updated',code:'42501'}});
 for(const c of local.calendars){if(!prevC.has(c.id)){await op(()=>insertRow('calendars',{id:c.id,owner_id:user.id,name:c.name,color:c.color}));continue}const p=prevC.get(c.id),diff={};if(c.name!==p.name)diff.name=c.name;if(c.color!==p.color)diff.color=c.color;if(Object.keys(diff).length)await upd('calendars',diff,c.id)}
 const evRow=e=>({calendar_id:e.calId,text:e.text,event_date:e.date,end_date:e.endDate||null,note:e.note||'',repeat:e.repeat||null,done:!!e.done});
 for(const e of local.events){const row=evRow(e);if(!prevE.has(e.id)){await op(()=>insertRow('events',{id:e.id,...row,created_by:user.id}));continue}
  const old=evRow(prevE.get(e.id)),diff={};for(const k in row)if(JSON.stringify(row[k])!==JSON.stringify(old[k]))diff[k]=row[k];
  if(Object.keys(diff).length)await upd('events',diff,e.id)}
 if(allowDelete){for(const id of delE)await op(()=>deleteRow('events',id));for(const id of delC)await op(()=>deleteRow('calendars',id))}
 if(denied)status(`서버가 변경 ${denied}건을 저장하지 않아 되돌렸어요 · 이유: ${lastDenyMsg}`);
 return allowDelete&&!denied;   // false → caller reloads from server
}

// First time on this device/account: merge device-only events without touching server data.
async function firstSync(){
 status('클라우드 데이터 확인 중…');
 const local=window.DaydotLocal.get();
 let remote=await getRemote();
 const mineRemote=remote.calendars.filter(isMine);       // never match into a friend's calendar
 const remoteById=new Map(remote.calendars.map(c=>[c.id,c]));
 const mineBySig=new Map(mineRemote.map(c=>[sigCal(c),c]));
 const localOnlyEvents=local.events.filter(e=>!remote.events.some(r=>r.id===e.id||sigEv(r)===sigEv(e)));
 if(localOnlyEvents.length){
  if(remote.calendars.length&&!confirm(`이 기기에만 있는 일정 ${localOnlyEvents.length}개를 서버 일정과 합칠까요? 기존 서버 일정은 삭제하지 않습니다.`)){status('동기화 취소됨. 기기 일정은 그대로 보관했습니다.');return false}
  status('기기 일정 합치는 중…');
  const calendarMap=new Map();
  for(const c of local.calendars){
   if(!isMine(c)&&!remoteById.has(c.id))continue;   // a friend's calendar this account can no longer see
   let match=remoteById.get(c.id)||mineBySig.get(sigCal(c));
   if(!match){const id=uuid();await insertRow('calendars',{id,owner_id:user.id,name:c.name,color:c.color});match={id,name:c.name,color:c.color,owner_id:user.id};remoteById.set(id,match);mineBySig.set(sigCal(c),match)}
   calendarMap.set(c.id,match.id);
  }
  const seen=new Set(remote.events.map(e=>sigEv(e)));
  for(const e of localOnlyEvents){
   const calId=calendarMap.get(e.calId);if(!calId)throw Error(`일정 '${e.text}'의 캘린더를 찾을 수 없습니다.`);
   const sig=sigEv({...e,calId});if(seen.has(sig))continue;
   await insertRow('events',{id:uuid(),calendar_id:calId,text:e.text,event_date:e.date,end_date:e.endDate||null,note:e.note||'',repeat:e.repeat||null,done:!!e.done,created_by:user.id});seen.add(sig);
  }
  remote=await getRemote();
 }else if(!mineRemote.length){
  status('클라우드 캘린더 만드는 중…');
  for(const c of local.calendars.filter(isMine))await insertRow('calendars',{id:uuid(),owner_id:user.id,name:c.name,color:c.color});
  remote=await getRemote();
 }
 if(!remote.calendars.length){status('서버에 표시할 캘린더가 없습니다. 기존 데이터는 유지했습니다.');return false}
 applyRemote(remote);return true;
}

// Called automatically after sign-in / app start, and by the ☁ button.
async function startSync(auto){
 if(!client||!user||active)return;
 if(busy){scheduleRetry(2000);return}
 busy=true;const button=$('cloudSync');if(button)button.disabled=true;
 try{
  const saved=loadBaseline();
  if(saved){
   baseline=saved;
   status('기기 변경 사항 올리는 중…');
   await pushDiff();
   applyRemote(await getRemote());
  }else if(!(await firstSync()))return;
  dirty=false;
  status(`☁ 자동 동기화 켜짐 · ${user.email}`);
 }catch(e){
  active=false;
  status('동기화 대기 중: '+(e?.message||String(e))+' · 기기에는 저장돼 있어요. 연결되면 자동으로 다시 시도해요.');
  scheduleRetry();
 }finally{busy=false;if(button)button.disabled=false}
}
$('cloudSync').onclick=()=>{if(active){status(`☁ 자동 동기화 켜짐 · ${user?.email||''}`);return}startSync(false)};
$('cloudShare').onclick=async()=>{if(!client||!user)return;const p_calendar=$('cloudShareCal').value,p_email=$('cloudFriendEmail').value.trim(),p_role=$('cloudFriendRole').value;if(!p_calendar||!p_email){status('캘린더와 친구 이메일을 입력해 주세요.');return}const {data,error}=await client.rpc('daydot_share_with_email',{p_calendar,p_email,p_role});if(error){status('초대 실패: '+error.message);return}status(data==='SHARED'?'공유 완료. 친구가 Daydot에 로그인 후 동기화를 누르면 표시됩니다.':'해당 이메일로 가입하고 인증을 완료한 친구를 찾지 못했습니다.')};
// Debounced push of local edits while sync is on.
async function pushChanges(){
 if(!active||!client||!user||!baseline||suppress){queued=true;return}
 if(busy){queued=true;return}
 busy=true;
 try{
  const deleted=await pushDiff();
  if(deleted){const local=window.DaydotLocal.get();saveBaseline({calendars:local.calendars,events:local.events})}
  else{const msg=$('cloudStatus').textContent;applyRemote(await getRemote(true));changeSeq++;if(!queued)dirty=false;status(msg);return}
  changeSeq++;if(!queued)dirty=false;
  status('☁ 변경 사항 저장됨 · '+new Date().toTimeString().slice(0,5));
 }catch(e){active=false;status('동기화 대기 중: '+e.message+' · 기기에는 저장돼 있어요. 다시 연결되면 자동으로 올라가요.');scheduleRetry()}
 finally{busy=false;if(queued){queued=false;if(active)setTimeout(pushChanges,400)}}
}
let debounce,changeSeq=0;window.addEventListener('daydot:localchange',()=>{if(suppress)return;changeSeq++;dirty=true;if(!active)return;clearTimeout(debounce);debounce=setTimeout(pushChanges,700)});
setInterval(async()=>{if(!active||busy||queued||dirty||!client||!user||Date.now()-lastPoll<12000||document.visibilityState==='hidden')return;lastPoll=Date.now();const seq=changeSeq;try{const remote=await getRemote(true);if(seq!==changeSeq||dirty||busy||queued||!active)return;const fingerprint=({calendars,events})=>JSON.stringify([calendars.map(x=>[x.id,x.name,x.color]).sort(),events.map(x=>[x.id,x.calId,x.text,x.date,x.endDate||null,x.note||'',x.repeat||null,!!x.done]).sort()]);if(fingerprint(remote)!==fingerprint(baseline)){applyRemote(remote);status('다른 기기에서 변경한 일정 반영 완료.')}}catch(e){status('동기화 확인 실패: '+e.message)}},5000);
window.addEventListener('online',()=>{if(!active)startSync(true)});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){if(!active)startSync(true);else lastPoll=0}});
const DEFAULT_CFG={url:'https://ilxwwlivganhiljrwugc.supabase.co',key:'sb_publishable_udx3ngB8m-qFh9HC-OvOrw_RKKmW5Uw'};
const saved=JSON.parse(localStorage.getItem(cfgKey)||'null')||DEFAULT_CFG;if(saved?.url&&saved?.key){$('cloudUrl').value=saved.url;$('cloudKey').value=saved.key;connect(saved.url,saved.key).catch(e=>status('서버 재연결 실패: '+e.message))}

// Read-only bridge for the photo attachment module. Uses existing user session and RLS.
window.DaydotCloud={getClient:()=>client,getUser:()=>user,isActive:()=>active};
