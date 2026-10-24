import { spawn } from 'node:child_process';
import { access, copyFile, mkdir, writeFile, readFile, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { movieSearchQuery } from './movie-query.mjs';
import { classifyBilibiliSearch } from './movie-search-state.mjs';

const TASK_NAME = '龙虾脑 B站搜索';
const SEARCH_URL = 'https://search.bilibili.com/all';
const CLI = process.env.TABBIT_CLI || join(homedir(), '.local', 'bin', 'tabbit-cli');
const DATA_DIR = process.env.LOBSTER_DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const PENDING_FILE = join(DATA_DIR, 'bilibili-pending.json');
let unresolvedRequestId = null;

async function loadPending() {
  if (unresolvedRequestId) return;
  try {
    const pending = JSON.parse(await readFile(PENDING_FILE, 'utf8'));
    if (pending.task !== TASK_NAME || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(pending.requestId)) throw new Error('浏览器待确认记录损坏，请先人工核对电脑状态。');
    unresolvedRequestId = pending.requestId;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

async function recordPending(requestId) {
  await mkdir(DATA_DIR, {recursive:true});
  await writeFile(PENDING_FILE + '.tmp', JSON.stringify({task:TASK_NAME,requestId,recordedAt:new Date().toISOString()}), {mode:0o600});
  await rename(PENDING_FILE + '.tmp', PENDING_FILE);
  unresolvedRequestId = requestId;
}

async function clearPending() {
  await unlink(PENDING_FILE).catch(error=>{if(error.code!=='ENOENT')throw error;});
  unresolvedRequestId = null;
}

// The command is sent through stdin. User text never becomes a shell command.
async function cli(args, input = '', timeoutMs = 75_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(CLI, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(Object.assign(new Error('浏览器控制连接超时；操作结果尚未确认。'), {code:'BROWSER_OUTCOME_UNKNOWN'})); }, timeoutMs);
    child.stdout.on('data', b => { stdout += b; });
    child.stderr.on('data', b => { stderr += b; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', () => {
      clearTimeout(timer);
      const lines = (stdout + '\n' + stderr).split('\n').filter(Boolean);
      let receipt;
      for (const line of lines) {
        try { const value = JSON.parse(line); if (value.status || value.error || value.finished !== undefined || value.resourceId || value.task) receipt = value; } catch {}
      }
      if (!receipt) return reject(new Error((stderr || stdout || '浏览器未返回执行结果').slice(0,800)));
      resolve(receipt);
    });
    child.stdin.end(input);
  });
}

async function program(code, prefix) {
  if (unresolvedRequestId) throw Object.assign(new Error(`上一次浏览器动作的结果尚未确认（${unresolvedRequestId}）。`),{code:'BROWSER_OUTCOME_UNKNOWN'});
  const requestId = `${prefix}-${randomUUID()}`;
  const deadline = Date.now() + 90_000;
  await recordPending(requestId);
  let receipt;
  try {
    receipt = await cli(['nodejs', '--task', TASK_NAME, '--request-id', requestId, '--timeout-ms', '60000'], code);
  } catch {
    // A lost CLI response is not proof that its browser action failed. Read the
    // original receipt once; never dispatch the program under a replacement ID.
    try { receipt = await cli(['receipt','--task',TASK_NAME,'--request-id',requestId,'--wait-ms','1000'],'',5000); }
    catch { throw Object.assign(new Error(`浏览器动作结果尚未确认（${requestId}）；没有重新执行该动作。`),{code:'BROWSER_OUTCOME_UNKNOWN'}); }
  }
  while (receipt.status === 'queued' || receipt.status === 'running') {
    if (Date.now() >= deadline) throw Object.assign(new Error(`浏览器持续返回 ${receipt.status}（${requestId}）；请在电脑确认操作结果。`),{code:'BROWSER_OUTCOME_UNKNOWN'});
    receipt = await cli(['receipt', '--task', TASK_NAME, '--request-id', requestId, '--wait-ms', '1000'],'',5000);
  }
  if (['succeeded','failed','interrupted'].includes(receipt.status)) await clearPending();
  // Routing validation failures explicitly report unchanged state. Missing or
  // ambiguous receipts keep the guard in place for subsequent task submissions.
  if (receipt.outcome === 'unchanged' || receipt.codeDispatched === false || receipt.error?.code === 'BROWSER_RUNTIME_CONNECT_DENIED') await clearPending();
  if (receipt.status !== 'succeeded') {
    const message = receipt.error?.message || receipt.result?.error || receipt.error || '浏览器操作失败';
    const error = new Error(typeof message === 'string' ? message : JSON.stringify(message));
    error.receipt = receipt;
    throw error;
  }
  if (receipt.result?.value !== undefined) return receipt.result.value;
  const resourceId = receipt.result?.resourceId;
  if (resourceId) {
    try {
      let offset = 0, source = '';
      for (;;) {
        // Large receipts are exceptional; this does not retry the original action.
        const chunk = await cli(['resource','--task',TASK_NAME,'--resource',resourceId,'--offset',String(offset),'--max-bytes','65536'],'',10000);
        if (typeof chunk.data !== 'string' || (!chunk.eof && (!Number.isInteger(chunk.nextOffset) || chunk.nextOffset <= offset))) throw new Error('浏览器结果分块无效。');
        source += chunk.data;
        if (source.length > 1_000_000) throw new Error('浏览器返回的结果超过了 Demo 读取上限。');
        if (chunk.eof) return JSON.parse(source);
        offset = chunk.nextOffset;
      }
    } catch (error) { error.receipt = receipt; throw error; }
  }
  return receipt.result;
}

function checkCancelled(signal) {
  if (signal?.aborted) throw new DOMException('任务已由用户取消。当前浏览器动作可能已经完成。', 'AbortError');
}

function safeId(id) { return String(id || randomUUID()).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0,100); }

async function saveScreenshot(shot, artifactDir, id) {
  const source=shot?.path||shot?.nextAction?.path;
  if(!source||!artifactDir)return undefined;
  await mkdir(artifactDir,{recursive:true});
  const destination=join(artifactDir,`movie-${safeId(id)}.png`);
  await copyFile(source,destination);return destination;
}

/** Search only. A matching URL alone does not establish that results loaded. */
export async function runMovie(task,ctx){
 const query=movieSearchQuery(task.command);
 const url=new URL(SEARCH_URL);url.searchParams.set('keyword',query);
 let opened=false,settled=true;
 const step=async(label,detail)=>{checkCancelled(ctx.signal);await ctx.step(label,detail);};
 try{
  await access(CLI);await loadPending();
  if(unresolvedRequestId){
   const receipt=await cli(['receipt','--task',TASK_NAME,'--request-id',unresolvedRequestId,'--wait-ms','1000'],'',5000);
   if(['succeeded','failed','interrupted'].includes(receipt.status)){
    await clearPending();
    const observed=await program('return {url:page.url(),title:await page.title()};','search-recover');
    opened=true;
    return {status:'waiting_user',result:{title:'前一次搜索状态已读取',summary:'请查看电脑保留的搜索页面，再提交需要的搜索词。',url:observed.url},error:{code:'PREVIOUS_ACTION_RECONCILED',message:'前一次浏览器请求已经结束，本次没有重复提交搜索。',recovery:'确认电脑页面后，可重新提交搜索。'}};
   }
   throw Object.assign(new Error('前一次浏览器请求结果仍待确认，请查看电脑上的B站页面。'),{code:'BROWSER_OUTCOME_UNKNOWN'});
  }
  await step('准备搜索词',`将在 B 站搜索“${query}”。`);
  // Initialize the browser before sending navigation; cold-start errors happen before dispatch.
  const ready=await cli(['create','--task',TASK_NAME],'',25000);
  if(ready.ok===false||ready.error)throw new Error(ready.error?.message||'浏览器未能启动。');
  opened=true;
  await step('打开 B 站搜索',`在电脑浏览器打开“${query}”的搜索结果。`);
  settled=false;
  const navigation=await program(`
    const response=await page.goto(${JSON.stringify(url.href)},{waitUntil:'domcontentloaded',timeout:25000});
    return {url:page.url(),httpStatus:response?.status()||0};
  `,'bilibili-open');
  settled=true;
  await step('核对搜索结果','检查搜索框中的关键词和页面结果，并返回截图与链接。');
  settled=false;
  const snapshot=await program(`
    const query=${JSON.stringify(query)};
    try{await page.waitForFunction(query=>{
      const input=document.querySelector('input[placeholder="输入关键字搜索"]');
      const links=Array.from(document.querySelectorAll('a[href]'));
      const results=links.some(a=>{try{const u=new URL(a.href);return u.hostname==='www.bilibili.com'&&/^\\/(video|bangumi\\/play)\\//.test(u.pathname)&&a.getClientRects().length>0;}catch{return false;}});
      const text=document.body?.innerText||'';
      return input?.value===query&&results||/没有找到|暂无搜索结果|未找到相关|没有相关|安全验证|人机验证|访问过于频繁/.test(text);
    },query,{timeout:18000});}catch{}
    const state=await page.evaluate(()=>{
      const input=document.querySelector('input[placeholder="输入关键字搜索"]');
      const items=new Map();
      for(const a of document.querySelectorAll('a[href]')){
        try{const u=new URL(a.href);if(u.hostname!=='www.bilibili.com'||!/^\\/(video|bangumi\\/play)\\//.test(u.pathname)||!a.getClientRects().length)continue;
        const title=a.querySelector('h3')?.getAttribute('title')||a.getAttribute('title')||a.textContent.trim();
        const key=u.origin+u.pathname;
        if(!items.has(key)||a.querySelector('h3')||a.getAttribute('title'))items.set(key,{title:title.slice(0,160),url:a.href});}catch{}
      }
      const text=document.body?.innerText||'';
      return {url:location.href,pageTitle:document.title,inputValue:input?.value||'',resultCount:items.size,items:Array.from(items.values()).slice(0,5),empty:/没有找到|暂无搜索结果|未找到相关|没有相关/.test(text),blocked:/安全验证|人机验证|访问过于频繁|请完成验证|captcha|verify you are human/i.test(text)};
    });
    let screenshot;try{screenshot=await page.screenshot({fullPage:false});}catch{}
    return {...state,screenshot};
  `,'bilibili-verify');
  settled=true;checkCancelled(ctx.signal);
  snapshot.httpStatus=navigation.httpStatus;
  const state=classifyBilibiliSearch(snapshot,query);
  let screenshot;try{screenshot=await saveScreenshot(snapshot.screenshot,ctx.artifactDir,task.id);}catch{}
  const verified=['results','empty'].includes(state);
  const search={query,resultCount:snapshot.resultCount,empty:state==='empty',verified,verifiedAt:verified?new Date().toISOString():undefined,observedAt:new Date().toISOString(),items:snapshot.items};
  const result={title:'B 站搜索页面',query,url:url.href,source:'哔哩哔哩',screenshot,search};
  if(ctx.artifactDir)await writeFile(join(ctx.artifactDir,`movie-${safeId(task.id)}.json`),JSON.stringify({taskId:task.id,query,url:url.href,state,pageTitle:snapshot.pageTitle,inputValue:snapshot.inputValue,httpStatus:snapshot.httpStatus,search},null,2));
  if(state==='blocked')return {status:'waiting_user',result,error:{code:'BILIBILI_VERIFICATION_REQUIRED',message:'B 站要求完成验证，搜索结果尚未确认。',recovery:'请在电脑浏览器完成页面提示的验证，再重试。'}};
  if(!['results','empty'].includes(state))return {status:state==='failed'?'failed':'waiting_user',result,error:{code:state==='failed'?'BILIBILI_SEARCH_FAILED':'BILIBILI_SEARCH_UNVERIFIED',message:'已尝试打开 B 站，但尚未确认搜索结果加载完成。',recovery:'请查看电脑上的页面；网络恢复或页面加载完成后可以重试。'}};
  return {status:'succeeded',result:{...result,title:'已在 B 站搜索',summary:state==='empty'?`已搜索“${query}”，B 站提示没有找到相关结果。可以换一个片名或关键词。`:`电脑已打开“${query}”的 B 站搜索结果。你可以在电脑上选择要看的视频，或用下方链接在手机上查看。`}};
 }catch(error){
  if(error.name==='AbortError')throw error;
  if(error.receipt)settled=['succeeded','failed','interrupted'].includes(error.receipt.status)||error.receipt.outcome==='unchanged'||error.receipt.codeDispatched===false;
  if(unresolvedRequestId)settled=false;
  const missing=error.code==='ENOENT',denied=/BROWSER_RUNTIME_CONNECT_DENIED|sandbox denied/i.test(error.message);
  const code=unresolvedRequestId?'BROWSER_OUTCOME_UNKNOWN':missing?'BROWSER_NOT_INSTALLED':denied?'BROWSER_PERMISSION_DENIED':'BILIBILI_SEARCH_FAILED';
  return {status:unresolvedRequestId?'waiting_user':'failed',result:{title:'B 站搜索尚未完成',query,url:url.href,summary:'没有取得可以确认的搜索结果。'},error:{code,message:missing?'未找到 Tabbit 浏览器控制工具。':denied?'当前环境无法连接电脑浏览器。':unresolvedRequestId?'浏览器连接中断，搜索页面的状态仍需核对。':'B 站搜索页面未能正常加载。',recovery:missing?'安装 Tabbit 后重新启动 Demo。':unresolvedRequestId?'请查看电脑上的实际页面，系统不会自动重放未确认的请求。':'确认电脑浏览器和网络正常后重试。'},diagnostic:String(error.message).slice(0,500)};
 }finally{
  if(opened&&settled)await cli(['finish','--task',TASK_NAME],'',10000).catch(()=>{});
 }
}

export const movieCapabilities={browser:'Tabbit',sourceUrl:SEARCH_URL,requiresLogin:false,verifiesSearch:true,verifiesPlayback:false,supported:'在B站搜索任意片名或电影关键词'};
