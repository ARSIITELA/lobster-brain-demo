import {existsSync} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {classifyMeetingState,findText,meetingCodeFrom,meetingCodesFromAX,createMeetingReceiptTracker,HOME_PAGE,MEETING_PAGE} from './meeting-state.mjs';
import {runNative} from './meeting-native.mjs';
const exec=promisify(execFile),ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const BINARY=path.join(ROOT,'.tooling/meeting-native');
export function meetingApp(){return [process.env.TENCENT_MEETING_APP,'/Applications/TencentMeeting.app','/Applications/腾讯会议.app',`${homedir()}/Applications/TencentMeeting.app`,`${homedir()}/Applications/腾讯会议.app`].filter(Boolean).find(p=>existsSync(p))??null;}
export function meetingAutomationReady(){return process.platform==='darwin'&&existsSync(BINARY);}
function waiting(code,message,recovery,result){return {status:'waiting_user',error:{code,message,recovery},result};}
export async function runMeeting(task,ctx){
 const {signal}=ctx;const native=(command,args={})=>runNative(command,args,signal);
 const inspect=()=>native('inspect');
 const pause=()=>delay(750,undefined,{signal});
 const act=async(command,w,page,extra={})=>native(command,{windowId:w.windowId,expectedIdentifier:page,...extra});
 const clickText=async(w,page,re)=>{
  const item=findText(w,re);if(!item){const e=new Error('界面上没有找到预期按钮，已停止操作。');e.code='MEETING_UI_CHANGED';throw e;}
  await act('raise',w,page);await pause();
  await act('clickNormalized',w,page,{x:item.x+item.width/2,y:item.y+item.height/2});await pause();
 };
 await ctx.step('检查腾讯会议客户端','检查应用安装、登录及电脑操作权限。');
 const app=meetingApp();
 if(!app)return waiting('MEETING_APP_MISSING','电脑上没有检测到腾讯会议客户端。','安装并登录腾讯会议后重试。',{title:'需要安装腾讯会议',url:'https://meeting.tencent.com/download/'});
 if(process.platform!=='darwin')return {status:'failed',error:{code:'PLATFORM_UNSUPPORTED',message:'会议执行器仅支持 macOS 14 及以上版本。',recovery:'请在这台 Mac 上启动 Demo。'}};
 try{
  if(!existsSync(BINARY)){
   await ctx.step('准备会议执行器','首次使用时，编译本地 macOS 窗口操作程序。');
   try{await exec('/bin/sh',[path.join(ROOT,'scripts/build-meeting-native.sh')],{timeout:90000,maxBuffer:1024*1024,signal});}
   catch(e){if(signal?.aborted)throw e;return waiting('MEETING_HELPER_BUILD_FAILED','会议执行器编译失败。','请在终端运行 sh scripts/build-meeting-native.sh，检查是否已安装 Apple Command Line Tools。');}
  }
  await exec('/usr/bin/open',['-a',app],{signal,timeout:10000});await pause();
  let snapshot=await inspect(),state=classifyMeetingState(snapshot);
  if(state.kind==='permission')return waiting(state.code,'会议执行器缺少辅助功能权限。',`在系统设置 → 隐私与安全性 → 辅助功能中，添加并开启 ${path.join(ROOT,'.tooling/龙虾脑会议执行器.app')}，然后重试。执行器不会自行更改系统权限。`);
  if(state.kind==='login')return waiting('MEETING_LOGIN_REQUIRED','腾讯会议尚未登录。','在电脑上完成腾讯会议登录后重试。');
  if(state.kind==='in_meeting')return waiting('MEETING_ALREADY_ACTIVE','这台电脑已经在一个会议中。','结束或离开当前会议后，再发送新指令。为避免重复创建，本次没有另开会议。',{title:'当前会议仍在进行',meetingCode:state.meetingCode||undefined});
  if(task.intent==='meeting_join')return waiting('MEETING_JOIN_CONFIRMATION_REQUIRED','有效会议号已通过检查，仍需在电脑上确认加入。',`本版本的自动入会尚未验收，请在腾讯会议中填写 ${task.meetingCode} 并确认音视频选项。`,{title:'等待确认入会',meetingCode:task.meetingCode});
  if(state.kind!=='home')return waiting('MEETING_UI_CHANGED','当前腾讯会议界面无法自动操作。','请关闭客户端内的弹窗并回到腾讯会议首页，然后重试。');
  const existingCodes=meetingCodesFromAX(snapshot);
  await ctx.step('在电脑上创建会议','在已登录的腾讯会议中点击快速会议。');
  if(findText(state.window,/^快速会议$/))await clickText(state.window,HOME_PAGE,/^快速会议$/);
  else{
   const {stdout:version}=await exec('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString',path.join(app,'Contents/Info.plist')],{signal});
   if(version.trim()!=='3.46.0'||Math.abs(state.window.width-720)>5||Math.abs(state.window.height-480)>5)return waiting('MEETING_UI_CHANGED','当前腾讯会议版本或窗口尺寸尚未验证。','本机已验证的首页为腾讯会议 3.46.0，720 × 480。请在电脑上完成会议操作。');
   await act('raise',state.window,HOME_PAGE);await pause();
   await act('clickNormalized',state.window,HOME_PAGE,{x:249/720,y:95/480});await pause();
  }
  for(let i=0;i<12;i++){
   snapshot=await inspect();state=classifyMeetingState(snapshot);
   if(state.kind==='in_meeting')break;
   if(['login','password','waiting_room','invalid'].includes(state.kind))break;
   await pause();
  }
  if(state.kind!=='in_meeting')return waiting('MEETING_CONFIRMATION_REQUIRED','已经提交创建操作，但尚未读到会中界面。','请查看腾讯会议是否显示音频选择、登录或其他弹窗。确认当前会议情况后再重试，避免重复创建。');
  await ctx.step('读取会议结果','核对会中界面，并等待客户端显示当前会议号。');
  let w=state.window;
  if(findText(w,/^静音$/)){await clickText(w,MEETING_PAGE,/^静音$/);snapshot=await inspect();state=classifyMeetingState(snapshot);w=state.window;}
  if(w&&findText(w,/^关闭视频$/)){await clickText(w,MEETING_PAGE,/^关闭视频$/);snapshot=await inspect();state=classifyMeetingState(snapshot);w=state.window;}
  if(state.kind!=='in_meeting'||!w)return waiting('MEETING_STATE_UNVERIFIED','创建操作后会议窗口发生变化。','请在电脑上核对实际会议状态。');
  const microphoneMuted=!!findText(w,/^(解除静音|取消静音)$/),cameraOff=!!findText(w,/^开启视频$/);
  const dir=path.join(ctx.artifactDir,task.id);await fs.mkdir(dir,{recursive:true});
  // AX mode reads labeled client controls without requesting screen recording permission.
  const observeReceipt=createMeetingReceiptTracker({existingCodes,windowId:w.windowId});
  let activeAX;
  // Require a new code, observed twice consecutively on the same newly opened meeting window.
  for(let i=0;i<=20;i++){
   if(i>0){await pause();snapshot=await inspect();state=classifyMeetingState(snapshot);}
   if(state.kind!=='in_meeting'||state.window?.windowId!==w.windowId)return waiting('MEETING_STATE_UNVERIFIED','读取结果时，原会议窗口已经改变。','请在电脑上核对当前会议。');
   activeAX=observeReceipt(snapshot);
   if(activeAX)break;
  }
  let screen,code=activeAX?.meetingCode;
  if(!code&&snapshot.screenRecordingGranted){
   snapshot=await native('inspect',{ocr:true});state=classifyMeetingState(snapshot);
   if(state.kind==='in_meeting'&&state.window?.windowId===w.windowId){
    w=state.window;
    screen=path.join(dir,'meeting.png');await native('screenshot',{windowId:w.windowId,path:screen});
    await clickText(w,MEETING_PAGE,/^会议详情$/);snapshot=await native('inspect',{ocr:true});
    const first=(snapshot.windows||[]).filter(x=>x.focused).map(meetingCodeFrom).find(Boolean);
    const firstState=classifyMeetingState(snapshot);
    if(first&&!existingCodes.includes(first)&&firstState.kind==='in_meeting'&&firstState.window?.windowId===w.windowId){
     await pause();snapshot=await native('inspect',{ocr:true});
     const second=(snapshot.windows||[]).filter(x=>x.focused).map(meetingCodeFrom).find(Boolean);
     const secondState=classifyMeetingState(snapshot);
     if(first===second&&secondState.kind==='in_meeting'&&secondState.window?.windowId===w.windowId)code=second;
    }
   }
  }
  if(!code)return waiting('MEETING_CODE_UNVERIFIED','会议窗口已经打开，但未读到真实会议号。','请在电脑上打开会议详情核对会议号。当前任务不会被计为成功。',{title:'等待核对会议号',screenshot:screen});
  const finalState=classifyMeetingState(snapshot);
  if(finalState.kind!=='in_meeting'||finalState.window?.windowId!==w.windowId)return waiting('MEETING_STATE_UNVERIFIED','读取会议号时，原会中窗口已经改变。','请确认会议仍在进行。');
  const evidence={taskId:task.id,observedAt:new Date().toISOString(),meetingCode:code,inMeeting:true,microphoneMuted:microphoneMuted||null,cameraOff:cameraOff||null,client:'com.tencent.meeting',source:activeAX?'accessibility-inmeeting-and-active-home-meeting':'native-window-and-labeled-meeting-details'};
  await fs.writeFile(path.join(dir,'meeting-evidence.json'),JSON.stringify(evidence,null,2));
  return {status:'succeeded',result:{title:'腾讯会议已创建',summary:`这台电脑已进入会议，已读取会议号。${microphoneMuted?'麦克风已静音。':'麦克风状态未能确认，请在电脑上检查。'}${cameraOff?'摄像头已关闭。':'摄像头状态未能确认，请在电脑上检查。'}会议会保持打开。`,meetingCode:code,screenshot:screen,evidence}};
 }catch(e){
  if(signal?.aborted)throw e;
  return waiting(e.code||'MEETING_NATIVE_ERROR','会议执行器未能完成当前操作。',`${e.message} 请在电脑上核对当前会议情况后重试。`);
 }
}

