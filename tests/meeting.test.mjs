import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyMeetingState,meetingCodeFrom,activeMeetingFromAX,isAXMeetingWindow,meetingCodesFromAX,createMeetingReceiptTracker,HOME_PAGE,MEETING_PAGE} from '../lib/meeting-state.mjs';
const text=t=>({text:t,confidence:.95,x:.1,y:.1,width:.1,height:.05});
const win=(page,words=[],more={})=>({windowId:1,x:100,y:100,width:720,height:480,focused:true,elements:[{identifier:page}],ocr:words.map(text),...more});
const snap=windows=>({running:true,accessibilityTrusted:true,screenRecordingGranted:true,windows});
const noScreen=windows=>({...snap(windows),screenRecordingGranted:false});
const axMeeting=(more={})=>win(MEETING_PAGE,[],{windowId:2,width:1020,height:674,elements:[{identifier:`QApplication.${MEETING_PAGE}.DialogWidget.InMeetingLayoutContainerQtView:42`,x:100,y:140,width:1020,height:634}],...more});
const row=(code='638 268 298',state='进行中',y=240,prefix='rowA')=>{
 const root=`QApplication.${HOME_PAGE}.schedule_meeting::HomeMeetingListWidget.home_meeting_list.meeting_list_meeting_item.${prefix}.main_container.detail_item_container`;
 return [
  {identifier:`${root}.meeting_code_item.label_wrap.label`,value:code,x:250,y,width:90,height:16},
  {identifier:`${root}.state_item.label_wrap.label`,value:state,x:350,y,width:40,height:16}
 ];
};
const axHome=(rows=row(),more={})=>win(HOME_PAGE,[],{focused:false,elements:[{identifier:HOME_PAGE},...rows],...more});

test('辅助功能缺失阻断执行，屏幕录制权限不阻断AX检查',()=>{
 assert.equal(classifyMeetingState({...snap([]),accessibilityTrusted:false}).code,'ACCESSIBILITY_REQUIRED');
 assert.equal(classifyMeetingState(noScreen([axMeeting()])).kind,'in_meeting');
 assert.equal(classifyMeetingState(noScreen([])).kind,'unknown');
});
test('会中判断需要可见真实布局，隐藏Qt页面名不能单独作为证据',()=>{
 assert.equal(classifyMeetingState(snap([win(MEETING_PAGE)])).kind,'unknown');
 assert.equal(classifyMeetingState(snap([win(HOME_PAGE,['会议详情'])])).kind,'unknown');
 assert.equal(classifyMeetingState(snap([win(MEETING_PAGE,['会议详情','结束会议'])])).kind,'in_meeting');
 assert.equal(isAXMeetingWindow(axMeeting()),true);
 for(const more of [{windowId:undefined},{width:600},{hidden:true},{visible:false},{minimized:true},{elements:[{identifier:`${MEETING_PAGE}.InMeetingLayoutContainerQtView`,width:0,height:0,x:100,y:100}]}]){
  assert.equal(isAXMeetingWindow(axMeeting(more)),false);
 }
});
test('登录、等候室、密码和无效会议状态不能报成功',()=>{
 for(const [label,kind] of [['正在等候室等待','waiting_room'],['请输入会议密码','password'],['会议不存在','invalid']]){
  assert.equal(classifyMeetingState(snap([win(MEETING_PAGE,[label,'结束会议'])])).kind,kind);
 }
 assert.equal(classifyMeetingState(snap([win(HOME_PAGE,['扫码登录'])])).kind,'login');
});
test('首页无OCR时需要已知尺寸，焦点和没有阻挡的窗口',()=>{
 assert.equal(classifyMeetingState(noScreen([axHome()])).kind,'home');
 assert.equal(classifyMeetingState(noScreen([axHome([],{focused:true})])).kind,'home');
 for(const more of [{width:750},{height:510},{modal:true},{role:'AXSheet'},{windowId:undefined}]){
  assert.equal(classifyMeetingState(noScreen([axHome([],more)])).kind,'unknown');
 }
 const popup=win('dialog',[],{windowId:9,width:310,height:316});
 assert.equal(classifyMeetingState(noScreen([axHome(),popup])).kind,'unknown');
 assert.equal(classifyMeetingState(noScreen([axHome([],{focused:true}),{...popup,focused:false}])).kind,'unknown');
 assert.equal(classifyMeetingState(snap([win(HOME_PAGE,['快速会议'])])).kind,'home');
});
test('会中布局和home同一进行中行联结才允许读出9或10位会议号',()=>{
 for(const code of ['638 268 298','1234567890']){
  const snapshot=noScreen([axMeeting(),axHome(row(code))]);
  const result=activeMeetingFromAX(snapshot);
  assert.equal(result.meetingCode,code.replaceAll(' ',''));
  assert.equal(result.evidence,'accessibility');
  assert.equal(classifyMeetingState(snapshot).meetingCode,result.meetingCode);
 }
 assert.equal(activeMeetingFromAX(noScreen([axHome()])),null);
 assert.equal(activeMeetingFromAX({...noScreen([axMeeting(),axHome()]),accessibilityTrusted:false}),null);
});
test('历史会议、隐藏控件、未带语义identifier的数字都不能作为当前会议号',()=>{
 const invalidRows=[row('638268298','已结束'),row('1234'),row('638268298').map(e=>({...e,width:0})),row('638268298').map(e=>({...e,y:-1000})),row('638268298').map(e=>({...e,hidden:true})),row('638268298').map(e=>({...e,identifier:e.identifier.replace('.meeting_list_meeting_item','.history_item')}))];
 for(const rows of invalidRows)assert.equal(activeMeetingFromAX(noScreen([axMeeting(),axHome(rows)])),null);
 assert.equal(activeMeetingFromAX(noScreen([axMeeting(),axHome(row(),{windowId:undefined})])),null);
 assert.equal(activeMeetingFromAX(noScreen([axMeeting(),axHome(row(),{hidden:true})])),null);
});
test('相同identifier的不同列表行仍按纵向位置配对，不能读取历史行的号码',()=>{
 const rows=[...row('111222333','已结束',200,'same'),...row('638268298','进行中',260,'same')];
 assert.equal(activeMeetingFromAX(noScreen([axMeeting(),axHome(rows)])).meetingCode,'638268298');
 const crossed=[row('111222333','已结束',200,'A')[0],row('638268298','进行中',200,'B')[1]];
 assert.equal(activeMeetingFromAX(noScreen([axMeeting(),axHome(crossed)])),null);
 const distant=[row('111222333','进行中',200)[0],row('638268298','进行中',260)[1]];
 assert.equal(activeMeetingFromAX(noScreen([axMeeting(),axHome(distant)])),null);
});
test('多个进行中候选、多代码重叠或多个会中窗口都返回歧义',()=>{
 assert.equal(activeMeetingFromAX(noScreen([axMeeting(),axHome([...row(),...row('111222333','进行中',280,'rowB')])])),null);
 assert.equal(activeMeetingFromAX(noScreen([axMeeting(),axHome([...row(),row('111222333')[0]])])),null);
 assert.equal(activeMeetingFromAX(noScreen([axMeeting(),axMeeting({windowId:3}),axHome()])),null);
});
test('OCR会议号必须有标签，不能取隐藏文本、参与者ID或低置信度文字',()=>{
 assert.equal(meetingCodeFrom(win('', ['会议号','638 268 298'])),'638268298');
 assert.equal(meetingCodeFrom(win('', ['会议号码：1234567890'])),'1234567890');
 assert.equal(meetingCodeFrom(win('', ['参会者ID：123456789'])),null);
 assert.equal(meetingCodeFrom(win('', ['会议号：1234'])),null);
 assert.equal(meetingCodeFrom({...win('',[]),elements:[{value:'会议号：123456789'}]}),null);
 assert.equal(meetingCodeFrom({...win('',[]),ocr:[{text:'会议号：123456789',confidence:.1}]}),null);
});
test('创建前记录语义会议号，旧的进行中行不能充当新建会议回执',()=>{
 const baseline=noScreen([axHome([...row('638268298','进行中'),...row('111222333','已结束',280,'history')])]);
 const existingCodes=meetingCodesFromAX(baseline);
 assert.deepEqual(existingCodes,['638268298','111222333']);
 const observe=createMeetingReceiptTracker({existingCodes,windowId:2});
 const stale=noScreen([axMeeting(),axHome(row('638268298'))]);
 assert.equal(observe(stale),null);
 assert.equal(observe(stale),null);
 const fresh=noScreen([axMeeting(),axHome(row('428454318'))]);
 assert.equal(observe(fresh),null);
 assert.equal(observe(fresh).meetingCode,'428454318');
});
test('连续两次相同窗口和号码才确认，缺失、中途换号或窗口变化会重新计数',()=>{
 const observe=createMeetingReceiptTracker({existingCodes:[],windowId:2});
 const a=noScreen([axMeeting(),axHome(row('428454318'))]);
 const b=noScreen([axMeeting(),axHome(row('555666777'))]);
 assert.equal(observe(a),null);
 assert.equal(observe(b),null);
 assert.equal(observe(noScreen([axMeeting(),axHome([])])),null);
 assert.equal(observe(b),null);
 assert.equal(observe(noScreen([axMeeting({windowId:3}),axHome(row('555666777'))])),null);
 assert.equal(observe(b),null);
 assert.equal(observe(b).meetingCode,'555666777');
});
test('创建前缓存的历史语义行也会被排除，任意未标注数字不会加入基线',()=>{
 const hidden=row('111222333','已结束').map(e=>({...e,hidden:true}));
 const baseline=noScreen([axHome([...hidden,{value:'999888777',identifier:'participantId'}])]);
 assert.deepEqual(meetingCodesFromAX(baseline),['111222333']);
 const observe=createMeetingReceiptTracker({existingCodes:meetingCodesFromAX(baseline),windowId:2});
 const reused=noScreen([axMeeting(),axHome(row('111222333'))]);
 assert.equal(observe(reused),null);
 assert.equal(observe(reused),null);
});
