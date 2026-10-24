import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
const exec=promisify(execFile);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const app=path.join(root,'.tooling/龙虾脑会议执行器.app');
// LaunchServices runs the app under the identity to which the user granted permission.
// Direct child-process execution would inherit the terminal/host's TCC responsibility.
export async function runNative(command,args={},signal){
 signal?.throwIfAborted();
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lobster-meeting-'));
 try{
  const output=path.join(dir,'result.json'),error=path.join(dir,'stderr.log');
  // open -W has a kevent race when this short-lived helper exits before it attaches.
  // Launch once and consume its unique output file; never resubmit an uncertain action.
  try{await exec('/usr/bin/open',['-n','-g','--stdout',output,'--stderr',error,app,'--args',command,JSON.stringify(args)],{timeout:10000,maxBuffer:256*1024,signal});}
  catch(cause){if(signal?.aborted)throw cause;const e=new Error('无法启动会议执行器，请确认应用仍在原位置。');e.code='MEETING_NATIVE_LAUNCH_FAILED';throw e;}
  let r;const deadline=Date.now()+20000;
  while(Date.now()<deadline){
   signal?.throwIfAborted();
   try{r=JSON.parse(await fs.readFile(output,'utf8'));break;}catch{}
   await delay(75,undefined,{signal});
  }
  if(!r){const e=new Error('没有收到会议执行器的结果，请先检查电脑上的会议状态。');e.code='MEETING_NATIVE_RECEIPT_TIMEOUT';throw e;}
  if(!r.ok){const e=new Error(r.error?.message||'会议执行器未能完成操作。');e.code=r.error?.code;throw e;}
  return r;
 }finally{await fs.rm(dir,{recursive:true,force:true});}
}
