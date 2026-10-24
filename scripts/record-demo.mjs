import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
process.env.PLAYWRIGHT_BROWSERS_PATH=path.join(root,'.tooling/browsers');
const require=createRequire('/Users/mima1234/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const {chromium}=require('playwright');
const code=process.env.LOBSTER_PAIR_CODE;
if(!code)throw new Error('Set LOBSTER_PAIR_CODE to the startup pairing code.');
const out=path.join(root,'artifacts/recording');await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({viewport:{width:430,height:932},deviceScaleFactor:1,isMobile:true,hasTouch:true,recordVideo:{dir:out,size:{width:430,height:932}}});
const page=await context.newPage();const video=page.video();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const results=[];
async function submit(command){
 await page.locator('#command').scrollIntoViewIfNeeded();
 await page.locator('#command').fill('');
 await page.locator('#command').pressSequentially(command,{delay:65});await pause(1200);
 const receipt=page.waitForResponse(r=>r.url().endsWith('/api/tasks')&&r.request().method()==='POST');
 await page.locator('#submit-command').click();const {task}=await (await receipt).json();
 await pause(1100);await page.locator('#task-detail').scrollIntoViewIfNeeded();
 let finished;
 for(let i=0;i<90;i++){
  const state=await page.evaluate(()=>fetch('/api/state').then(r=>r.json()));
  finished=state.tasks.find(t=>t.id===task.id);
  if(['succeeded','failed','waiting_user','cancelled'].includes(finished?.status))break;
  await pause(1200);
 }
 results.push(finished);await pause(2500);
 await page.locator('#task-detail .detail-actions').scrollIntoViewIfNeeded().catch(()=>{});await pause(2500);
 await page.screenshot({path:path.join(out,`${task.intent}-${task.id}.png`),fullPage:true});
 return finished;
}
try{
 await page.goto('http://localhost:8787');await page.locator('#pair-code').waitFor();await pause(1500);
 await page.locator('#pair-code').fill(code);await pause(1000);await page.getByRole('button',{name:'连接电脑',exact:true}).click();
 await page.locator('#command').waitFor();await pause(2000);
 const movie=await submit('搜索一部热门电影并播放相关视频');
 console.log(JSON.stringify({movie:movie.status,title:movie.result?.title,playback:movie.result?.playback}));
 await submit('加入腾讯会议，会议码1234');
 await submit('创建一个腾讯会议');
 await page.locator('.nav-item[data-view="analytics"]').click();await pause(3000);
 await page.evaluate(()=>window.scrollTo({top:450,behavior:'smooth'}));await pause(3000);
 await page.evaluate(()=>window.scrollTo({top:950,behavior:'smooth'}));await pause(3000);
 await page.screenshot({path:path.join(out,'mobile-analytics.png'),fullPage:true});
 await page.locator('.nav-item[data-view="device"]').click();await pause(3500);
 await fs.writeFile(path.join(out,'recording-evidence.json'),JSON.stringify({recordedAt:new Date().toISOString(),viewport:{width:430,height:932},physicalPhone:false,tasks:results,errors},null,2));
 console.log(JSON.stringify({errors,tasks:results.map(t=>({id:t.id,status:t.status,error:t.error?.code}))}));
}finally{await context.close();await video.saveAs(path.join(out,'手机端闭环录屏.webm'));await browser.close();}
