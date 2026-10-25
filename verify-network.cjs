const {chromium}=require('playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const path=require('node:path');
const report={started:new Date().toISOString(),checks:[],samples:[]};
let bs=[],ps=[];
const save=()=>fs.writeFileSync(path.join(__dirname,'verification/network.json'),JSON.stringify(report,null,2));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function diag(){return Promise.all(ps.map(p=>p.evaluate(()=>__takraw.diagnostics())));}
async function connected(){await Promise.all(ps.map(p=>p.waitForFunction(()=>window.__takraw?.session?.ready && __takraw.session.players.length===2 && __takraw.session.status==='running' && __takraw.session.room.transports.size===1,{},{timeout:85000})));}
async function equal(label){
 const states=await Promise.all(ps.map(p=>p.evaluate(()=>{const s=__takraw.session;return {epoch:s.epoch,base:s.baseTick,confirmed:s.confirmedTick,players:s.players,failure:s.failure};})));
 assert.deepEqual(states[0].players,states[1].players);assert.equal(states[0].epoch,states[1].epoch);assert.ok(states.every(s=>!s.failure));
 const tick=Math.min(...states.map(s=>s.confirmed))+1;
 const hashes=await Promise.all(ps.map(p=>p.evaluate(t=>__takraw.session.getStateHash(t),tick)));
 assert.ok(hashes.every(Number.isInteger),'retained finite hashes');assert.equal(hashes[0],hashes[1],label+' state hash');
 report.checks.push({label,tick,hash:hashes[0],epoch:states[0].epoch});save();console.log('PASS',label,tick,hashes[0]);
}
async function screenshot(label){for(let i=0;i<2;i++)await ps[i].screenshot({path:path.join(__dirname,`verification/${label}-${i+1}.png`)});}
(async()=>{
 bs=await Promise.all([9331,9332].map(port=>chromium.connectOverCDP('http://127.0.0.1:'+port)));ps=bs.map(b=>b.contexts()[0].pages()[0]);
 for(const p of ps){await p.evaluate(()=>{sessionStorage.clear();__takraw?.dispose();});await p.goto('http://127.0.0.1:8766/');await p.waitForFunction(()=>__takraw?.ready);await p.locator('#open-network').click();}
 await ps[0].locator('[data-dialog-action="host"]').click();await ps[0].waitForFunction(()=>__takraw.diagnostics().network.code);
 const code=await ps[0].locator('#room-code').inputValue();report.room=code;
 await ps[1].locator('#room-input').fill(code);await ps[1].locator('[data-dialog-action="join"]').click();await connected();await wait(500);await equal('room admission');
 for(const p of ps){assert.equal(await p.locator('#team-label-0').innerText(),'청록 팀');assert.equal(await p.locator('#team-label-1').innerText(),'코랄 팀');}
 report.initialIds=await Promise.all(ps.map(p=>p.evaluate(()=>__takraw.session.localPlayerId)));
 for(let i=0;i<6;i++){
   const p=ps[i%2];await p.locator('canvas').focus();await p.keyboard.down(i%2?'a':'d');await p.keyboard.down('Space');await p.mouse.move(480,400);await p.mouse.down();await wait(300);await p.keyboard.up(i%2?'a':'d');await p.keyboard.up('Space');await p.mouse.up();await wait(1700);await equal('live input '+i);
 }
 await screenshot('network-play');report.samples.push({label:'live',diagnostics:await diag()});
 // Drop actual RTCPeerConnection, leaving both game sessions alive.
 await ps[1].evaluate(()=>{for(const pc of __takraw.session.room.peerConnections.values())pc.close();});
 await wait(500);report.samples.push({label:'link closed',diagnostics:await diag()});await connected();await wait(1500);await equal('RTC reconnect');
 for(const i of [1,0]){
   const prior=await ps[1-i].evaluate(()=>({tick:__takraw.session.tick,score:__takraw.game.state.score,sets:__takraw.game.state.sets}));
   await ps[i].reload();await ps[i].waitForFunction(()=>__takraw?.ready);await connected();await wait(1000);
   assert.equal(await ps[i].evaluate(()=>__takraw.session.localPlayerId),report.initialIds[i],'resume preserves identity');
   assert.ok(await ps[i].evaluate(t=>__takraw.session.tick>=t-24,prior.tick),'resume preserves match progress');
   await equal(i?'guest reload':'host reload');report.samples.push({label:i?'guest reload':'host reload',diagnostics:await diag()});
 }
 // Force the first reload signaling attempt to fail, then retry via visible UI.
 // RTC and signaling implementations remain the production library.
 await ps[1].addInitScript(()=>{
   const Native=window.WebSocket;
   window.WebSocket=class extends Native { constructor(...args){
     if(sessionStorage.getItem('__qaSignalFault')==='1')throw Error('QA signaling outage');
     super(...args);
   }};
 });
 await ps[1].evaluate(()=>sessionStorage.setItem('__qaSignalFault','1'));
 await ps[1].reload();await ps[1].waitForFunction(()=>__takraw?.diagnostics().network.state==='error',{},{timeout:30000});
 report.samples.push({label:'expected signaling outage',diagnostics:await diag()});
 await ps[1].evaluate(()=>sessionStorage.removeItem('__qaSignalFault'));
 await ps[1].locator('#resume-room').click();await connected();await wait(1000);await equal('retry after signaling outage');
 assert.equal(await ps[1].evaluate(()=>__takraw.session.localPlayerId),report.initialIds[1]);
 await ps[1].reload();await connected();await wait(1000);await equal('guest reload after retry');
 for(let i=0;i<12;i++){await wait(2500);await equal('sustained '+i);}
 await screenshot('network-resumed');report.samples.push({label:'final',diagnostics:await diag()});
 const ds=await diag();assert.ok(ds.every(d=>!d.failed&&!d.errors.length&&d.session.hashMismatches===0));
 report.passed=true;save();console.log('NETWORK PASS');
})().catch(async e=>{report.passed=false;report.error=e.stack;try{report.failure=await diag();await screenshot('failure');}catch{}save();console.error(e);process.exitCode=1;}).finally(async()=>{await Promise.all(bs.map(b=>b.close()));});
