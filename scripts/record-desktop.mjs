import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
process.env.PLAYWRIGHT_BROWSERS_PATH=path.join(root,'.tooling/browsers');
const require=createRequire('/Users/mima1234/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const {chromium}=require('playwright');
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},recordVideo:{dir:path.join(root,'artifacts/recording'),size:{width:1440,height:1000}}});
await context.request.post('http://localhost:8787/api/pair',{data:{code:process.env.LOBSTER_PAIR_CODE}});
const page=await context.newPage();const video=page.video();const pause=ms=>new Promise(r=>setTimeout(r,ms));
try{
 await page.goto('http://localhost:8787/#analytics');await page.locator('#metric-cards').waitFor({state:'visible'});await pause(5000);
 await page.evaluate(()=>window.scrollTo({top:700,behavior:'smooth'}));await pause(5000);
 await page.screenshot({path:path.join(root,'artifacts/acceptance/final-desktop-dashboard.png'),fullPage:true});
 await page.locator('.nav-item[data-view="workspace"]').click();await page.locator('.task-row').filter({hasText:'搜索一部热门电影并播放相关视频'}).first().click();await pause(5000);
 await page.locator('#task-detail .result-card').scrollIntoViewIfNeeded();await pause(5000);
 await page.screenshot({path:path.join(root,'artifacts/acceptance/final-desktop-movie.png'),fullPage:true});
}finally{await context.close();await video.saveAs(path.join(root,'artifacts/recording/桌面看板录屏.webm'));await browser.close();}
