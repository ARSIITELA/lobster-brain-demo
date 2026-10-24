import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire('/Users/mima1234/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const {chromium}=require('playwright');
const code=process.env.LOBSTER_PAIR_CODE;if(!code)throw new Error('需要 LOBSTER_PAIR_CODE');
const out=path.join(root,'artifacts/bilibili-update');await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const page=await context.newPage(),errors=[],tasks=[];
page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://localhost:8787');await page.locator('#pair-code').fill(code);
 await page.getByRole('button',{name:'连接电脑',exact:true}).click();await page.locator('#command').waitFor();
 for(const [command,query,file] of [['搜索电影','热门电影','generic'],['搜索个流浪地球','流浪地球','named']]){
  await page.locator('#command').fill(command);
  const receipt=page.waitForResponse(r=>r.url().endsWith('/api/tasks')&&r.request().method()==='POST');
  await page.locator('#submit-command').click();const {task}=await (await receipt).json();
  let result;
  for(let i=0;i<90;i++){
   const state=await page.evaluate(()=>fetch('/api/state').then(r=>r.json()));result=state.tasks.find(t=>t.id===task.id);
   if(['succeeded','failed','waiting_user','cancelled'].includes(result?.status))break;
   await new Promise(r=>setTimeout(r,1000));
  }
  tasks.push(result);
  await fs.writeFile(path.join(out,'tasks.json'),JSON.stringify(tasks,null,2));
  if(result?.status!=='succeeded'||result.result?.query!==query||result.result?.search?.verified!==true)throw new Error('实际搜索未成功：'+JSON.stringify(result));
  await page.locator('#task-detail .result-card').scrollIntoViewIfNeeded();
  await page.getByRole('link',{name:'打开 B 站搜索结果'}).waitFor();
  await page.screenshot({path:path.join(out,`mobile-${file}.png`),fullPage:false});
  console.log(JSON.stringify({command,id:task.id,status:result.status,query,resultCount:result.result.search.resultCount}));
 }
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
 await fs.writeFile(path.join(out,'acceptance.json'),JSON.stringify({testedAt:new Date().toISOString(),physicalPhone:false,viewport:{width:390,height:844},tasks,errors,overflow},null,2));
 if(errors.length||overflow)throw new Error('页面错误或横向溢出');
}finally{await context.close();await browser.close();}
