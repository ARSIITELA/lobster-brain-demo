import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {parseIntent,labels} from './lib/intent.mjs';
import {runMeeting,meetingApp,meetingAutomationReady} from './lib/meeting.mjs';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
const PORT=Number(process.env.PORT||8787), HOST=process.env.HOST||'0.0.0.0';
const DATA=process.env.LOBSTER_DATA_DIR||path.join(ROOT,'data');
const ARTIFACTS=path.join(ROOT,'artifacts');
fs.mkdirSync(DATA,{recursive:true}); fs.mkdirSync(ARTIFACTS,{recursive:true});
const DB=path.join(DATA,'tasks.json');
let tasks=[];
try{tasks=JSON.parse(fs.readFileSync(DB,'utf8'));}catch{}
const terminal=new Set(['succeeded','failed','cancelled']);
for(const task of tasks)if(['running','queued'].includes(task.status)){task.status='failed';task.finishedAt=new Date().toISOString();task.error={code:'SERVER_RESTARTED',message:'电脑执行服务重启，后续步骤已停止；已提交的电脑动作需要核对结果。',recovery:'确认电脑上的实际状态后，再点击重试。'};}
const sessions=new Map(),clients=new Set(),attempts=new Map();
const pairingCode=String(crypto.randomInt(100000,1000000));
let active=null,controller=null,stopping=false;
const now=()=>new Date().toISOString();
const ipAddresses=()=>Object.values(os.networkInterfaces()).flat().filter(x=>x?.family==='IPv4'&&!x.internal).map(x=>x.address);
const urls=()=>ipAddresses().map(ip=>`http://${ip}:${PORT}`);
const device=()=>({name:os.hostname().replace(/\.local$/,''),online:!stopping,platform:process.platform});
function save(){fs.writeFileSync(DB+'.tmp',JSON.stringify(tasks,null,2));fs.renameSync(DB+'.tmp',DB);}
function metrics(){
 const done=tasks.filter(t=>terminal.has(t.status));
 const succeeded=tasks.filter(t=>t.status==='succeeded');
 const failed=tasks.filter(t=>t.status==='failed');
 const durations=done.filter(t=>t.startedAt&&t.finishedAt).map(t=>Math.max(0,Date.parse(t.finishedAt)-Date.parse(t.startedAt))).sort((a,b)=>a-b);
 const counts={};for(const t of tasks)if(t.error)counts[t.error.code]=(counts[t.error.code]||0)+1;
 return {total:tasks.length,succeeded:succeeded.length,failed:failed.length,waiting:tasks.filter(t=>t.status==='waiting_user').length,cancelled:tasks.filter(t=>t.status==='cancelled').length,
 successRate:done.length?Math.round(succeeded.length/done.length*100):0,successDenominator:done.length,completionRate:tasks.length?Math.round(succeeded.length/tasks.length*100):0,
 avgDurationMs:durations.length?Math.round(durations.reduce((a,b)=>a+b,0)/durations.length):0,p95DurationMs:durations.length?durations[Math.ceil(durations.length*.95)-1]:0,
 byIntent:Object.entries(labels).map(([intent,label])=>({intent,label,total:tasks.filter(t=>t.intent===intent).length,succeeded:succeeded.filter(t=>t.intent===intent).length})),
 failureReasons:Object.entries(counts).map(([code,count])=>({code,count})).sort((a,b)=>b.count-a.count),
 recentDays:Array.from({length:7},(_,i)=>{const date=new Date(Date.now()-(6-i)*86400000).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});const rows=tasks.filter(t=>new Date(t.createdAt).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})===date);return {date,total:rows.length,succeeded:rows.filter(t=>t.status==='succeeded').length};})};
}
function state(){return {device:device(),tasks:[...tasks].reverse(),metrics:metrics(),connection:{urls:urls()},capabilities:{movie:true,movieSearch:true,moviePlayback:false,movieSearchProvider:'bilibili',meetingInstalled:!!meetingApp(),meetingAutomation:true,meetingCreate:true,meetingJoin:false,meetingCreateVerified:tasks.some(t=>t.intent==='meeting_create'&&t.status==='succeeded'&&t.result?.evidence?.inMeeting),meetingAdapterBuilt:meetingAutomationReady(),meetingCreateRequiresPermission:true,mode:'real'}};}
function emit(){save();const payload=`event: state\ndata: ${JSON.stringify(state())}\n\n`;for(const client of clients)client.write(payload);}
function update(t,patch){Object.assign(t,patch,{updatedAt:now()});emit();}
async function execute(t){
 controller=new AbortController();const signal=controller.signal;
 const timeout=setTimeout(()=>controller?.abort(new Error('TASK_TIMEOUT')),150000);
 update(t,{status:'running',startedAt:now()});
 const step=async(label,detail)=>{if(signal.aborted)throw signal.reason;for(const s of t.steps)if(s.status==='running')s.status='succeeded';t.steps.push({label,detail,status:'running',time:now()});emit();};
 try{
  await step('理解你的指令','识别场景并检查所需信息。');
  const parsed=parseIntent(t.command);Object.assign(t,parsed);
  if(parsed.error){for(const s of t.steps)s.status='failed';update(t,{status:'failed',error:parsed.error,finishedAt:now()});return;}
  let outcome;
  if(t.intent==='movie'){
   const {runMovie}=await import('./lib/movie.mjs');
   const dir=path.join(ARTIFACTS,t.id);fs.mkdirSync(dir,{recursive:true});
   outcome=await runMovie(t,{step,signal,artifactDir:dir});
  }else outcome=await runMeeting(t,{step,signal,artifactDir:ARTIFACTS});
  if(outcome.result?.screenshot){const relative=path.relative(ARTIFACTS,outcome.result.screenshot);outcome.result.screenshot=relative.startsWith('..')?null:'/artifacts/'+relative.split(path.sep).map(encodeURIComponent).join('/');}
  if(signal.aborted)throw signal.reason;
  for(const s of t.steps)if(s.status==='running')s.status=outcome.status==='failed'?'failed':outcome.status==='waiting_user'?'waiting_user':'succeeded';
  update(t,{...outcome,finishedAt:now()});
 }catch(e){
  const cancelled=signal.aborted&&signal.reason?.message==='USER_CANCELLED';
  const code=cancelled?'USER_CANCELLED':signal.aborted?'TASK_TIMEOUT':'EXECUTION_ERROR';
  for(const s of t.steps)if(s.status==='running')s.status=cancelled?'cancelled':'failed';
  update(t,{status:cancelled?'cancelled':'failed',finishedAt:now(),error:{code,message:cancelled?'后续任务步骤已经停止，当前电脑动作可能已经完成。':code==='TASK_TIMEOUT'?'执行超过了 150 秒，已停止继续操作。':'电脑执行任务时发生错误。',recovery:cancelled?'已经打开的应用或网页可能仍然保留。':'请确认网络、Tabbit 浏览器与电脑执行权限，然后重试。'},diagnostic:String(e?.message||e).slice(0,500)});
 }finally{clearTimeout(timeout);controller=null;}
}
async function pump(){if(active||stopping)return;const t=tasks.find(x=>x.status==='queued');if(!t)return;active=t.id;try{await execute(t);}finally{active=null;setTimeout(pump,0);}}
function newTask(command,requestId,retryOf){const previous=requestId&&tasks.find(t=>t.requestId===requestId);if(previous)return previous;const parsed=parseIntent(command);const t={id:crypto.randomUUID(),command,requestId,intent:parsed.intent,status:'queued',mode:'real',createdAt:now(),updatedAt:now(),steps:[],retryOf};tasks.push(t);emit();setTimeout(pump,0);return t;}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.mp4':'video/mp4','.webm':'video/webm','.pdf':'application/pdf','.md':'text/markdown; charset=utf-8'};
function respond(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
function authorized(req){const value=req.headers.cookie?.match(/(?:^|;\s*)lobster_session=([a-f0-9]{64})(?:;|$)/)?.[1];return value&&sessions.get(value)>Date.now();}
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>8192)throw new Error('请求内容过长');}try{return JSON.parse(text||'{}');}catch{throw new Error('请求格式错误');}}
function validHost(req){const value=req.headers.host||'';return ['localhost','127.0.0.1','[::1]',...ipAddresses()].some(host=>value===`${host}:${PORT}`||PORT===80&&value===host);}
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
 if(!validHost(req))return respond(res,403,{error:'请使用启动时显示的电脑地址访问。'});
 if(req.method==='POST'&&req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return respond(res,403,{error:'请求来源不匹配。'});
 const u=new URL(req.url,`http://${req.headers.host}`),route=u.pathname;
 try{
  if(route==='/api/health')return respond(res,200,{device:device(),paired:!!authorized(req),version:'0.1.0'});
  if(route==='/api/pair'&&req.method==='POST'){
   const ip=req.socket.remoteAddress;let a=attempts.get(ip)||{count:0,since:Date.now()};if(Date.now()-a.since>60000)a={count:0,since:Date.now()};
   if(a.count>=10)return respond(res,429,{error:'尝试次数过多，请一分钟后重试。'});
   const b=await body(req);a.count++;attempts.set(ip,a);
   if(String(b.code)!==pairingCode)return respond(res,401,{error:'配对码不正确，请查看电脑启动终端中的六位数字。'});
   attempts.delete(ip);const token=crypto.randomBytes(32).toString('hex');sessions.set(token,Date.now()+24*60*60*1000);
   res.setHeader('Set-Cookie',`lobster_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`);return respond(res,200,{ok:true});
  }
  if(route.startsWith('/api/')||route.startsWith('/artifacts/'))if(!authorized(req))return respond(res,401,{error:'请先输入电脑上的配对码。'});
  if(route==='/api/state')return respond(res,200,state());
  if(route==='/api/events'){
   res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.write(`event: state\ndata: ${JSON.stringify(state())}\n\n`);clients.add(res);const interval=setInterval(()=>{if(!authorized(req)){clients.delete(res);clearInterval(interval);res.end();}else res.write(': heartbeat\n\n');},15000);req.on('close',()=>{clients.delete(res);clearInterval(interval);});return;
  }
  if(route==='/api/tasks'&&req.method==='POST'){
   const b=await body(req);if(typeof b.command!=='string'||!b.command.trim()||b.command.length>300)return respond(res,400,{error:'请输入 1 到 300 个字符的任务指令。'});
   if(tasks.filter(t=>['queued','running'].includes(t.status)).length>=5)return respond(res,429,{error:'等待执行的任务已达到 5 个，请稍后提交。'});
   const t=newTask(b.command.trim(),typeof b.requestId==='string'?b.requestId.slice(0,100):null);return respond(res,202,{task:t});
  }
  const action=route.match(/^\/api\/tasks\/([a-f0-9-]+)\/(cancel|retry)$/);
  if(action&&req.method==='POST'){
   const t=tasks.find(x=>x.id===action[1]);if(!t)return respond(res,404,{error:'任务不存在。'});
   if(action[2]==='retry'){
    if(!['failed','waiting_user','cancelled'].includes(t.status))return respond(res,409,{error:'只有失败、等待操作或已取消的任务可以重试。'});
    if(tasks.filter(t=>['queued','running'].includes(t.status)).length>=5)return respond(res,429,{error:'任务队列已满，请稍后重试。'});
    return respond(res,202,{task:newTask(t.command,crypto.randomUUID(),t.id)});
   }
   if(t.status==='running'&&active===t.id)controller?.abort(new Error('USER_CANCELLED'));
   else if(['queued','waiting_user'].includes(t.status))update(t,{status:'cancelled',finishedAt:now()});
   else return respond(res,409,{error:'任务已经结束。'});
   return respond(res,200,{task:t});
  }
  if(route.startsWith('/api/'))return respond(res,404,{error:'接口不存在。'});
  if(req.method!=='GET'&&req.method!=='HEAD')return respond(res,405,{error:'请求方法不支持。'});
  const isArtifact=route.startsWith('/artifacts/'),base=isArtifact?ARTIFACTS:path.join(ROOT,'public');
  const rel=isArtifact?route.slice(11):route==='/'?'index.html':route.slice(1);
  const filename=path.resolve(base,decodeURIComponent(rel));
  if(!filename.startsWith(base+path.sep))return respond(res,403,{error:'不能访问这个路径。'});
  const real=await fsp.realpath(filename);const realBase=await fsp.realpath(base);if(!real.startsWith(realBase+path.sep))return respond(res,403,{error:'不能访问这个路径。'});
  const stat=await fsp.stat(real);if(!stat.isFile())return respond(res,404,{error:'文件不存在。'});
  res.writeHead(200,{'Content-Type':mime[path.extname(filename)]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':'no-cache'});
  if(req.method==='HEAD')return res.end();fs.createReadStream(real).pipe(res);
 }catch(e){if(!res.headersSent)respond(res,e.code==='ENOENT'?404:400,{error:e.code==='ENOENT'?'文件不存在。':String(e.message).slice(0,200)});else res.end();}
});
server.listen(PORT,HOST,()=>{save();console.log(`\n龙虾脑 Demo 已启动\n电脑访问：http://localhost:${PORT}\n手机访问：${urls().join(' 或 ')||'未检测到局域网地址，请连接 Wi-Fi'}\n配对码：${pairingCode}\n手机与电脑需要连接同一个 Wi-Fi。按 Ctrl+C 停止。\n`);});
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`端口 ${PORT} 已被占用。请停止旧服务，或使用 PORT=8788 ./start.sh。`:e.message);process.exit(1);});
function shutdown(){stopping=true;controller?.abort(new Error('SERVER_STOPPED'));for(const c of clients)c.end();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),3000).unref();}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
