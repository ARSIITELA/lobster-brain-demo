// Only current on-screen windows and visible controls can establish meeting state.
export const HOME_PAGE='wemeet://page/home';
export const MEETING_PAGE='wemeet://page/inmeeting_revision';
const CODE_SUFFIX='.meeting_code_item.label_wrap.label';
const STATE_SUFFIX='.state_item.label_wrap.label';
const positive=n=>Number.isFinite(n)&&n>0;
const visibleWindow=w=>Boolean(w?.windowId)&&positive(w.width)&&positive(w.height)&&w.hidden!==true&&w.visible!==false&&w.minimized!==true;
function visibleElement(e,w){
 if(e?.hidden===true||e?.visible===false||!positive(e?.width)||!positive(e?.height))return false;
 if(![e.x,e.y,w.x,w.y].every(Number.isFinite))return false;
 return e.x+e.width>w.x&&e.x<w.x+w.width&&e.y+e.height>w.y&&e.y<w.y+w.height;
}
export function windowText(w){return [...(w.elements||[]).filter(e=>visibleElement(e,w)).flatMap(e=>[e.title,e.value,e.description]),...(w.ocr||[]).filter(e=>e.confidence>=.5).map(e=>e.text)].filter(Boolean).join('\n');}
export function hasPage(w,page){return [w.identifier,...(w.elements||[]).map(e=>e.identifier)].some(x=>typeof x==='string'&&x.includes(page));}
export function findText(w,re){return (w.ocr||[]).find(e=>e.confidence>=.5&&re.test(e.text.trim()));}
export function meetingCodeFrom(w){
 const t=(w.ocr||[]).filter(e=>e.confidence>=.5).map(e=>e.text).join('\n');const match=t.match(/会议(?:号码|号|码)\s*[：:]?\s*([0-9][0-9 \t\n]{7,16}[0-9])/);
 const code=match?.[1].replace(/\s/g,'');return /^\d{9,10}$/.test(code||'')?code:null;
}
export function isAXMeetingWindow(w){
 return visibleWindow(w)&&w.width>600&&hasPage(w,MEETING_PAGE)&&(w.elements||[]).some(e=>
  typeof e.identifier==='string'&&e.identifier.includes(MEETING_PAGE)&&e.identifier.includes('InMeetingLayoutContainerQtView')&&visibleElement(e,w));
}
function rowPrefix(e,suffix){
 const id=e.identifier;
 if(typeof id!=='string'||!id.includes(HOME_PAGE)||!id.includes('.meeting_list_meeting_item')||!id.endsWith(suffix))return null;
 return id.slice(0,-suffix.length);
}
function sameRow(a,b){
 // Qt may reuse the same identifier for several rows; geometry must agree as well.
 const tolerance=Math.max(3,Math.min(a.height,b.height)/2);
 return Math.abs((a.y+a.height/2)-(b.y+b.height/2))<=tolerance;
}
export function meetingCodesFromAX(snapshot){
 if(!snapshot?.running||!snapshot.accessibilityTrusted)return [];
 // Save every labeled home-list code present before creation, including cached rows.
 // A cached row must not become proof that this task created a new meeting.
 const codes=(snapshot.windows||[]).filter(w=>hasPage(w,HOME_PAGE)).flatMap(w=>(w.elements||[])
  .filter(e=>rowPrefix(e,CODE_SUFFIX)).map(e=>String(e.value??'').replace(/\s/g,'')))
  .filter(code=>/^\d{9,10}$/.test(code));
 return [...new Set(codes)];
}
export function createMeetingReceiptTracker({existingCodes=[],windowId}){
 const excluded=new Set(existingCodes);let previous=null;
 return snapshot=>{
  const current=activeMeetingFromAX(snapshot);
  if(!current||current.window.windowId!==windowId||excluded.has(current.meetingCode)){
   previous=null;return null;
  }
  const confirmed=previous?.meetingCode===current.meetingCode&&previous.window.windowId===current.window.windowId;
  previous=current;
  return confirmed?current:null;
 };
}
export function activeMeetingFromAX(snapshot){
 if(!snapshot?.running||!snapshot.accessibilityTrusted)return null;
 const windows=(snapshot.windows||[]).filter(visibleWindow);
 const activeWindows=windows.filter(isAXMeetingWindow);
 if(activeWindows.length!==1)return null;
 const rows=[];
 for(const home of windows.filter(w=>hasPage(w,HOME_PAGE))){
  const visible=(home.elements||[]).filter(e=>visibleElement(e,home));
  const states=visible.filter(e=>rowPrefix(e,STATE_SUFFIX)&&String(e.value??'').trim()==='进行中');
  for(const state of states){
   const prefix=rowPrefix(state,STATE_SUFFIX);
   const codes=visible.filter(e=>rowPrefix(e,CODE_SUFFIX)===prefix&&sameRow(e,state)).map(e=>String(e.value??'').replace(/\s/g,''));
   // Any second current row or multiple codes is ambiguous, even if the digits happen to match.
   rows.push({home,codes});
  }
 }
 if(rows.length!==1||rows[0].codes.length!==1||!/^\d{9,10}$/.test(rows[0].codes[0]))return null;
 return {meetingCode:rows[0].codes[0],window:activeWindows[0],homeWindow:rows[0].home,evidence:'accessibility'};
}
function modalWithin(w){
 return w.modal===true||/AX(?:Dialog|Sheet|SystemDialog)/.test(`${w.role||''} ${w.subrole||''}`)||
  (w.elements||[]).some(e=>visibleElement(e,w)&&(e.modal===true||/AX(?:Dialog|Sheet|SystemDialog)/.test(`${e.role||''} ${e.subrole||''}`)));
}
function canUseHome(home,windows,focused){
 if(modalWithin(home)||focused&&focused!==home)return false;
 // Unknown secondary windows can be login, confirmation or permission dialogs.
 // With no OCR, do not guess whether the home page remains clickable behind one.
 if(windows.some(w=>w!==home&&(modalWithin(w)||w.width>100&&w.height>80)))return false;
 return home.focused===true||!focused;
}
export function classifyMeetingState(snapshot){
 if(!snapshot.running)return {kind:'not_running'};
 if(!snapshot.accessibilityTrusted)return {kind:'permission',code:'ACCESSIBILITY_REQUIRED'};
 // Screen Recording is optional: verified accessibility structure can establish state.
 const windows=(snapshot.windows||[]).filter(w=>visibleWindow(w)&&w.width>100&&w.height>80);
 const focused=windows.find(w=>w.focused);
 const candidates=focused?[focused,...windows.filter(w=>w!==focused)]:windows;
 for(const w of candidates){
  const text=windowText(w);
  if(/会议不存在|会议已结束|无效的会议号|会议号不存在/.test(text))return {kind:'invalid',window:w};
  if(/等候室|等待主持人.*(允许|加入|入会)|主持人尚未/.test(text))return {kind:'waiting_room',window:w};
  if(/会议密码|请输入密码/.test(text))return {kind:'password',window:w};
  if(/扫码登录|手机号登录|微信登录|验证码登录/.test(text)&&!hasPage(w,MEETING_PAGE))return {kind:'login',window:w};
 }
 const axActive=windows.find(isAXMeetingWindow);
 const active=axActive||windows.find(w=>hasPage(w,MEETING_PAGE)&&(findText(w,/^(结束会议|离开会议)$/)||findText(w,/^会议详情$/)));
 if(active){
  const ax=activeMeetingFromAX(snapshot);
  return {kind:'in_meeting',window:active,meetingCode:meetingCodeFrom(active)||ax?.meetingCode||null,evidence:axActive?'accessibility':'ocr'};
 }
 const home=windows.find(w=>{
  if(!hasPage(w,HOME_PAGE))return false;
  if(findText(w,/^快速会议$/))return true;
  return !(w.ocr||[]).length&&Math.abs(w.width-720)<=10&&Math.abs(w.height-480)<=10;
 });
 if(home&&canUseHome(home,windows,focused))return {kind:'home',window:home,evidence:findText(home,/^快速会议$/)?'ocr':'accessibility'};
 return {kind:'unknown',window:focused||windows[0]};
}
