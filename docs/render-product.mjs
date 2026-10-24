// Render the local product document without modifying the user's browser session.
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
const require=createRequire('/Users/mima1234/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const {chromium}=require('playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1024,height:900}});
 await page.goto(pathToFileURL(path.join(root,'public/product.html')).href);
 await page.emulateMedia({media:'print'});
 await page.pdf({path:path.join(root,'docs/龙虾脑产品方案.pdf'),format:'A4',printBackground:true,preferCSSPageSize:true});
 console.log('Rendered docs/龙虾脑产品方案.pdf');
} finally {await browser.close();}
