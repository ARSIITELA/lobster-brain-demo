import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const delay=ms=>new Promise(r=>setTimeout(r,ms));

test('配对、错误反馈、真实统计、幂等和重启恢复',async()=>{
 const data=await mkdtemp(path.join(os.tmpdir(),'lobster-test-'));
 await writeFile(path.join(data,'tasks.json'),JSON.stringify([{id:'stale',command:'旧任务',intent:'movie',status:'running',createdAt:new Date().toISOString(),steps:[]}]));
 const port=18987;let log='';
 const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:String(port),HOST:'127.0.0.1',LOBSTER_DATA_DIR:data},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);
 try{
  for(let i=0;i<100&&!log.includes('配对码');i++)await delay(50);
  const code=log.match(/配对码：(\d{6})/)?.[1];assert.ok(code,log);
  const base=`http://127.0.0.1:${port}`;
  assert.equal((await fetch(base+'/api/state')).status,401);
  const bad=await fetch(base+'/api/pair',{method:'POST',body:JSON.stringify({code:'000000'})});assert.equal(bad.status,401);
  const pair=await fetch(base+'/api/pair',{method:'POST',body:JSON.stringify({code})});assert.equal(pair.status,200);const cookie=pair.headers.get('set-cookie').split(';')[0];
  const headers={'Cookie':cookie,'Content-Type':'application/json'};
  const csrf=await fetch(base+'/api/tasks',{method:'POST',headers:{...headers,Origin:'https://evil.example'},body:'{}'});assert.equal(csrf.status,403);
  const make=()=>fetch(base+'/api/tasks',{method:'POST',headers,body:JSON.stringify({command:'加入腾讯会议，会议码1234',requestId:'same-click'})}).then(x=>x.json());
  const a=await make(),b=await make();assert.equal(a.task.id,b.task.id);
  let state;for(let i=0;i<40;i++){state=await fetch(base+'/api/state',{headers}).then(x=>x.json());if(state.tasks.find(t=>t.id===a.task.id).status==='failed')break;await delay(50);}
  assert.equal(state.tasks.find(t=>t.id==='stale').error.code,'SERVER_RESTARTED');
  assert.equal(state.tasks.find(t=>t.id===a.task.id).error.code,'INVALID_MEETING_CODE');
  assert.equal(state.metrics.total,2);assert.equal(state.metrics.failed,2);assert.equal(state.metrics.succeeded,0);
  const retry=await fetch(base+`/api/tasks/${a.task.id}/retry`,{method:'POST',headers}).then(x=>x.json());assert.notEqual(retry.task.id,a.task.id);assert.equal(retry.task.retryOf,a.task.id);
  const forbidden=await new Promise((resolve,reject)=>{const req=http.get(base+'/api/state',{headers:{...headers,Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});assert.equal(forbidden,403);
 }finally{child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));await rm(data,{recursive:true,force:true});}
});
