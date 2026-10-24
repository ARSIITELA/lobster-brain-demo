import {createRequire} from 'node:module';
import path from 'node:path';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
process.env.PLAYWRIGHT_BROWSERS_PATH=path.join(root,'.tooling/browsers');
const require=createRequire('/Users/mima1234/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const {chromium}=require('playwright');
const code=process.env.LOBSTER_PAIR_CODE;if(!code)throw new Error('需要 LOBSTER_PAIR_CODE。');
const out=path.join(root,'artifacts/meeting-update');await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true,recordVideo:{dir:out,size:{width:430,height:932}}});
const page=await context.newPage(),video=page.video(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
try{
 await page.goto('http://localhost:8787');await page.locator('#pair-code').fill(code);
 await page.getByRole('button',{name:'连接电脑',exact:true}).click();await page.locator('#command').waitFor();await pause(1200);
 await page.locator('#command').pressSequentially('创建一个腾讯会议',{delay:120});await pause(1200);
 const receipt=page.waitForResponse(r=>r.url().endsWith('/api/tasks')&&r.request().method()==='POST');
 await page.locator('#submit-command').click();const {task}=await (await receipt).json();
 let result;
 for(let i=0;i<30;i++){
  const state=await page.evaluate(()=>fetch('/api/state').then(r=>r.json()));result=state.tasks.find(t=>t.id===task.id);
  if(['succeeded','failed','waiting_user','cancelled'].includes(result?.status))break;
  await pause(1000);
 }
 if(result?.status!=='waiting_user'||result?.error?.code!=='ACCESSIBILITY_REQUIRED')throw new Error('预期辅助功能权限提示，实际为 '+JSON.stringify(result));
 await page.locator('#task-detail').scrollIntoViewIfNeeded();await pause(4000);
 await page.locator('#task-detail .notice').scrollIntoViewIfNeeded();await pause(4500);
 await page.screenshot({path:path.join(out,'mobile-permission.png'),fullPage:true});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
 await page.locator('.nav-item[data-view="analytics"]').click();await pause(3500);
 await page.evaluate(()=>window.scrollTo({top:900,behavior:'smooth'}));await pause(3500);
 await page.screenshot({path:path.join(out,'mobile-analytics.png'),fullPage:true});
 const state=await page.evaluate(()=>fetch('/api/state').then(r=>r.json()));
 await fs.writeFile(path.join(out,'permission-evidence.json'),JSON.stringify({recordedAt:new Date().toISOString(),physicalPhone:false,viewport:{width:430,height:932},task:result,metrics:state.metrics,overflow,errors},null,2));
 console.log(JSON.stringify({taskId:task.id,status:result.status,error:result.error.code,overflow,errors}));
}finally{await context.close();await video.saveAs(path.join(out,'会议权限反馈录屏.webm'));await browser.close();}
