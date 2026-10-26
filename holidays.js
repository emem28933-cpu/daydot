/* Daydot: 대한민국 공휴일 (공휴일에 관한 법률 기준, 대체공휴일 자동 계산)
   - 음력 공휴일(설날·부처님오신날·추석): 2024~2050 양력 날짜 표 (한국천문연구원 음력 기준)
   - 2026년부터 노동절(5/1)·제헌절(7/17) 공휴일
   - 선거일·임시공휴일은 아래 EXTRA에 직접 추가 */
(()=>{'use strict';
const LUNAR={2024:'02-10 05-15 09-17',2025:'01-29 05-05 10-06',2026:'02-17 05-24 09-25',2027:'02-07 05-13 09-15',2028:'01-27 05-02 10-03',2029:'02-13 05-20 09-22',2030:'02-03 05-09 09-12',2031:'01-23 05-28 10-01',2032:'02-11 05-16 09-19',2033:'01-31 05-06 09-08',2034:'02-19 05-25 09-27',2035:'02-08 05-15 09-16',2036:'01-28 05-03 10-04',2037:'02-15 05-22 09-24',2038:'02-04 05-11 09-13',2039:'01-24 04-30 10-02',2040:'02-12 05-18 09-21',2041:'02-01 05-07 09-10',2042:'01-22 05-26 09-28',2043:'02-10 05-16 09-17',2044:'01-30 05-05 10-05',2045:'02-17 05-24 09-25',2046:'02-06 05-13 09-15',2047:'01-26 05-02 10-04',2048:'02-14 05-20 09-22',2049:'02-02 05-09 09-11',2050:'01-23 05-28 09-30'};
const EXTRA={'2024-04-10':'국회의원 선거일','2024-10-01':'국군의 날','2025-01-27':'임시공휴일','2025-06-03':'대통령 선거일','2026-06-03':'지방선거일','2028-04-12':'국회의원 선거일'};
const pad=n=>String(n).padStart(2,'0'),key=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const at=(y,md)=>{const [m,d]=md.split('-').map(Number);return new Date(y,m-1,d,12)};
const add=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
const cache=new Map();
function build(y){
 const map=new Map();            // dateKey -> [{name,rule}]
 const put=(d,name,rule,group)=>{const k=key(d);if(!map.has(k))map.set(k,[]);map.get(k).push({name,rule,group})};
 // rule: 'none' 대체 없음 | 'sun' 일요일·겹침만(설/추석) | 'wk' 토·일·겹침
 put(at(y,'01-01'),'신정','none');
 put(at(y,'03-01'),'삼일절','wk');
 if(y>=2026)put(at(y,'05-01'),'노동절','wk');
 put(at(y,'05-05'),'어린이날','wk');
 put(at(y,'06-06'),'현충일','none');
 if(y>=2026)put(at(y,'07-17'),'제헌절','wk');
 put(at(y,'08-15'),'광복절','wk');
 put(at(y,'10-03'),'개천절','wk');
 put(at(y,'10-09'),'한글날','wk');
 put(at(y,'12-25'),'성탄절','wk');
 const L=LUNAR[y];
 if(L){const [s,b,c]=L.split(' ');
  const seol=at(y,s),chu=at(y,c);
  [-1,0,1].forEach(i=>put(add(seol,i),'설날','sun','seol'));
  put(at(y,b),'부처님오신날','wk');
  [-1,0,1].forEach(i=>put(add(chu,i),'추석','sun','chuseok'));
 }
 for(const [k,name] of Object.entries(EXTRA))if(k.startsWith(y+'-'))put(new Date(k+'T12:00:00'),name,'none');
 // 대체공휴일
 const off=d=>{const w=d.getDay();return w===0||w===6||map.has(key(d))};
 const need=[];   // [startFrom Date]
 const periodEnd={};
 for(const [k,list] of map)for(const h of list)if(h.group)periodEnd[h.group]=k>(periodEnd[h.group]||'')?k:periodEnd[h.group];
 for(const k of [...map.keys()].sort()){
  const d=new Date(k+'T12:00:00'),w=d.getDay(),list=map.get(k);
  let n=0;
  if(w===0||w===6){n=list.filter(h=>h.rule==='wk'||(h.rule==='sun'&&w===0)).length}
  else if(list.length>1&&list.some(h=>h.rule!=='none')){n=list.length-1}
  for(let i=0;i<n;i++){
   const g=list.find(h=>h.group&&(w===0||list.length>1))?.group;
   need.push(g?new Date(periodEnd[g]+'T12:00:00'):d);
  }
 }
 for(const from of need){let d=add(from,1);while(off(d))d=add(d,1);put(d,'대체공휴일','none')}
 const res=new Map();for(const [k,list] of map)res.set(k,[...new Set(list.map(h=>h.name))].join(' · '));
 return res;
}
function forYear(y){if(!cache.has(y))cache.set(y,build(y));return cache.get(y)}
window.DaydotHolidays={get:k=>forYear(Number(k.slice(0,4))).get(k)||null,list:y=>[...forYear(y)].sort()};
})();
