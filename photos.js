/* Daydot photos v0.4.3: private storage, member-only signed thumbnails. */
(()=>{'use strict';
const $=id=>document.getElementById(id),bucket='daydot-photos';
let eventId=null,pending=[],generation=0,objectUrls=[],viewGeneration=0,failedEventId=null,uploading=false;
const getCloud=()=>window.DaydotCloud;
const maxPerEvent=8,maxBytes=5*1024*1024;
const mimeExt={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
const say=s=>{$('photoStatus').textContent=s};
const resetUrls=()=>{objectUrls.forEach(x=>URL.revokeObjectURL(x));objectUrls=[]};
const safeName=s=>s.replace(/[^\w .()-]/g,'').slice(0,60);
function tile(url,label,onRemove){let wrap=document.createElement('div');wrap.className='photo-tile';const img=document.createElement('img');img.src=url;img.alt=label;img.onclick=()=>window.open(url,'_blank','noopener');wrap.append(img);if(onRemove){const b=document.createElement('button');b.className='photo-remove';b.type='button';b.textContent='×';b.title='사진 삭제';b.onclick=onRemove;wrap.append(b)}return wrap}
async function remoteList(id){const c=getCloud();if(!c?.getClient()||!c.getUser())return null;
 const {data,error}=await c.getClient().storage.from(bucket).list(id,{limit:100,sortBy:{column:'name',order:'asc'}});if(error)throw error;return (data||[]).filter(x=>x.name&&!x.name.startsWith('.'));
}
async function render(id=eventId){const token=++generation;resetUrls();const area=$('photoPreview');area.replaceChildren();
 if(!getCloud()?.getUser()){say('사진 첨부는 Daydot 계정 로그인 후 사용할 수 있어요.');showPending();return}
 if(!getCloud()?.isActive()){say('계정 · 친구 공유에서 동기화를 한 번 실행해 주세요.');showPending();return}
 if(id){try{const files=await remoteList(id);if(token!==generation)return;
   for(const file of files){const path=`${id}/${file.name}`;const {data,error}=await getCloud().getClient().storage.from(bucket).createSignedUrl(path,900);if(error)throw error;
    const remove=async()=>{if(!confirm('이 사진을 삭제할까요?'))return;const {error:err}=await getCloud().getClient().storage.from(bucket).remove([path]);if(err){say('삭제 권한이 없거나 삭제 실패: '+err.message);return}await render(id)};
    area.append(tile(data.signedUrl,file.name,remove));}
   say(`사진 ${files.length}장 저장됨 · 최대 ${maxPerEvent}장 · 장당 5MB (JPG/PNG/WebP)`);
  }catch(e){if(token===generation)say('사진 조회 실패: '+e.message)}}
 else say('새 일정에 사진을 선택하면 일정 저장 후 자동으로 업로드합니다.');
 showPending();
}
function showPending(){const area=$('photoPreview');for(const [i,f] of pending.entries()){const url=URL.createObjectURL(f);objectUrls.push(url);area.append(tile(url,`선택된 사진 ${i+1}`,()=>{pending.splice(i,1);render()}))}}
$('eventPhotos').addEventListener('change',e=>{const selected=[...e.target.files];e.target.value='';for(const file of selected){if(!mimeExt[file.type]){say('JPG, PNG, WebP만 첨부할 수 있어요.');continue}if(file.size>maxBytes){say('사진 한 장은 5MB 이하여야 해요.');continue}if(pending.length>=maxPerEvent){say('한 일정에 최대 8장까지 첨부할 수 있어요.');break}pending.push(file)}render()});
async function waitForEvent(id){const c=getCloud();if(!c?.getUser()||!c.isActive())throw Error('로그인한 뒤 동기화를 먼저 해 주세요.');
 // app.js saves locally; cloud.js synchronizes shortly thereafter. Confirm the exact event exists server-side.
 for(let n=0;n<16;n++){const {data,error}=await c.getClient().from('events').select('id').eq('id',id).maybeSingle();if(error)throw error;if(data)return;await new Promise(r=>setTimeout(r,450))}
 throw Error('서버에 일정이 아직 저장되지 않았어요. 클라우드 동기화 상태를 확인하세요.');
}
async function upload(id,files){if(!files.length||uploading)return;uploading=true;
 try{say('서버에 일정 저장 확인 중…');await waitForEvent(id);const existing=await remoteList(id);if(existing.length+files.length>maxPerEvent)throw Error(`사진은 일정당 ${maxPerEvent}장까지 첨부할 수 있어요.`);
  for(const [index,file] of files.entries()){say(`사진 업로드 중 ${index+1}/${files.length}…`);const path=`${id}/${crypto.randomUUID()}.${mimeExt[file.type]}`;const {error}=await getCloud().getClient().storage.from(bucket).upload(path,file,{contentType:file.type,cacheControl:'3600',upsert:false});if(error)throw error}
  if(eventId===id){pending=[];failedEventId=null;await render(id)}else{pending=[];failedEventId=null;say('사진 업로드 완료.')}
 }catch(e){failedEventId=id;pending=files;say((/quota|limit|storage.*exceed|insufficient/i.test(e.message)?'클라우드 저장 용량이 부족하거나 제한에 도달했습니다. 저장 공간을 확인해 주세요. · ':'사진 업로드 실패: ')+e.message+' · 이 일정을 다시 열면 재시도할 수 있어요.');console.warn(e)}finally{uploading=false}
}
async function viewPhotos(id){
 const token=++viewGeneration;
 const area=$('eventViewPhotos'),status=$('eventViewPhotoStatus'),count=$('eventViewPhotoCount');
 area.replaceChildren();count.textContent='';status.textContent='사진 불러오는 중…';
 const c=getCloud();
 if(!c?.getClient()||!c.getUser()){status.textContent='사진을 보려면 Daydot 계정에 로그인해 주세요.';return}
 // Viewing uses the signed-in user's Storage permissions; no manual server pull needed.
 try{
  const files=await remoteList(id);
  if(token!==viewGeneration)return;
  count.textContent=`(${files.length}장)`;
  if(!files.length){status.textContent='첨부된 사진이 없어요.';return}
  for(const file of files){
   const path=`${id}/${file.name}`;
   const {data,error}=await c.getClient().storage.from(bucket).createSignedUrl(path,900);
   if(error)throw error;
   if(token!==viewGeneration)return;
   // Read-only thumbnails: photo deletion remains restricted to editing mode.
   area.append(tile(data.signedUrl,file.name,null));
  }
  status.textContent='사진을 누르면 크게 볼 수 있어요.';
 }catch(e){if(token===viewGeneration)status.textContent='사진을 불러오지 못했어요: '+e.message}
}
// Remove every photo of an event (call BEFORE the event row is deleted on the server: storage permission checks the event).
async function removeAll(id){const c=getCloud();if(!c?.getClient()||!c.getUser()||!c.isActive())return {ok:true,count:0,skipped:true};
 try{const files=await remoteList(id);if(!files?.length)return {ok:true,count:0};
  const {error}=await c.getClient().storage.from(bucket).remove(files.map(f=>`${id}/${f.name}`));if(error)throw error;return {ok:true,count:files.length}}
 catch(e){console.warn('사진 삭제 실패',e);return {ok:false,error:e}}}
window.DaydotPhotos={removeAll,view:viewPhotos,canSave:()=>{if(!pending.length)return true;if(!getCloud()?.getUser()||!getCloud()?.isActive()){say('사진을 저장하려면 먼저 계정 · 친구 공유에서 클라우드 연결을 완료해 주세요.');return false}return true},open:(id)=>{eventId=id;if(failedEventId!==id){pending=[];failedEventId=null}$('eventPhotos').value='';render(id);if(failedEventId===id&&pending.length)say('이전에 업로드되지 않은 사진이 남아 있어요. 저장을 누르면 다시 시도합니다.')}};
window.addEventListener('daydot:eventSaved',e=>{const id=e.detail.id,files=[...pending];if(files.length)upload(id,files)});
})();