const { outputDir, baseURL, ports } = require('./support.cjs');
const {chromium}=require('playwright');const fs=require('fs');const path=require('path');const assert=require('assert/strict');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const bs=await Promise.all(ports.map(port=>chromium.connectOverCDP('http://127.0.0.1:'+port)));const ps=[];
for(const b of bs){let online;for(const c of b.contexts())for(const p of c.pages()){if(await p.evaluate(()=>window.__takraw?.diagnostics().mode==='online'))online=p;}assert.ok(online,'online game page');ps.push(online);}
const report=process.argv.includes('--continue') ? JSON.parse(fs.readFileSync(path.join(outputDir,'finish.json'),'utf8')) : {samples:[]};
delete report.error;delete report.passed;
try{for(let i=0;i<80;i++){
 const ds=await Promise.all(ps.map(p=>p.evaluate(()=>({diag:__takraw.diagnostics(),state:__takraw.game.state}))));assert.ok(ds.every(x=>!x.diag.errors.length&&!x.diag.failed));
 const tick=Math.min(...ds.map(x=>x.diag.session.confirmedTick))+1;const hashes=await Promise.all(ps.map(p=>p.evaluate(t=>__takraw.session.getStateHash(t),tick)));assert.ok(hashes.every(Number.isInteger));assert.equal(hashes[0],hashes[1]);
 report.samples.push({tick,hash:hashes[0],states:ds.map(x=>x.state),simulation:ds.map(x=>x.diag.simulation)});console.log('MATCH',tick,ds.map(x=>({phase:x.state.phase,score:x.state.score,sets:x.state.sets})));
 if(ds.every(x=>x.state.phase==='finished')){assert.equal(ds[0].state.matchWinner,ds[1].state.matchWinner);report.passed=true;report.diagnostics=ds.map(x=>x.diag);break;}await sleep(15000);
}assert.ok(report.passed,'match finished within twenty minutes');for(let i=0;i<2;i++)await ps[i].screenshot({path:path.join(outputDir,`finished-${i+1}.png`)});
}catch(e){report.passed=false;report.error=e.stack;throw e;}finally{fs.writeFileSync(path.join(outputDir,'finish.json'),JSON.stringify(report,null,2));await Promise.all(bs.map(b=>b.close()));}})().catch(e=>{console.error(e);process.exitCode=1;});
