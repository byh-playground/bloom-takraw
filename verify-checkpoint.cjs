const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9331');
 // An isolated page keeps this CPU-heavy test out of the network game loop.
 const context=await browser.newContext();const page=await context.newPage();
 try {
 await page.goto('http://127.0.0.1:8766/');await page.waitForFunction(()=>__takraw?.ready);
 const report=await page.evaluate(async()=>{
   const source=__takraw.game,make=()=>new source.constructor({RAPIER:source.physics.R,config:source.config});
   const assert=(v,m)=>{if(!v)throw Error(m);};
   const equal=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
   const compare=(a,b,label,checkRaw=true)=>{
     const x=a.save(),y=b.save(),px=x.physics.snapshot,py=y.physics.snapshot;
     delete x.physics.snapshot;delete y.physics.snapshot;
     assert(JSON.stringify(x)===JSON.stringify(y),label+' metadata');
     assert(equal(px,py),label+' saved physics');
     if(checkRaw)assert(equal(a.physics.world.takeSnapshot(),b.physics.world.takeSnapshot()),label+' real world');
     assert(JSON.stringify(a.physics.getEntities())===JSON.stringify(b.physics.getEntities()),label+' entities');
   };
   const checks=[],a=make(),b=make();let maxLegScale=1;
   try{
     a.reset('match');b.reset('match');
     for(let tick=0;tick<900;tick++){
       if([0,120,450].includes(tick)){
         const checkpoint=a.save();b.load(checkpoint);compare(a,b,'restore '+tick,false);
         checks.push({type:'restore',tick,bytes:checkpoint.physics.snapshot.length,rawImmediatelyEqual:equal(a.physics.world.takeSnapshot(),b.physics.world.takeSnapshot())});
       }
       const frame={tick,tickRate:60,inputs:[]};a.step(frame);b.step(frame);
       compare(a,b,'tick '+tick);
       for(const p of a.physics.players)maxLegScale=Math.max(maxLegScale,p.legs.L.scale,p.legs.R.scale);
       // Give renderer/other browser processes breathing room every 30 ticks.
       if(tick%30===0)await new Promise(r=>setTimeout(r,0));
     }
     const saved=a.save(),original=a.physics.world.takeSnapshot();
     const bad=structuredClone(saved);bad.physics.ballHandle=123456;
     let rejected=false;try{a.load(bad);}catch{rejected=true;}
     assert(rejected,'invalid handle rejected');assert(equal(original,a.physics.world.takeSnapshot()),'failed load leaves world unchanged');
     compare(a,b,'failed restore atomicity');checks.push({type:'invalid handle',rejected});
     const start=performance.now();
     for(let i=0;i<200;i++){b.load(saved);if(i%20===0)await new Promise(r=>setTimeout(r,0));}
     compare(a,b,'repeated restore');checks.push({type:'repeated restore',count:200,elapsedMs:performance.now()-start});
     for(let tick=900;tick<1200;tick++){const frame={tick,tickRate:60,inputs:[]};a.step(frame);b.step(frame);compare(a,b,'post repeat '+tick);if(tick%30===0)await new Promise(r=>setTimeout(r,0));}
     return {passed:true,version:__takraw.diagnostics().version,comparedTicks:1200,maxLegScale,checks};
   }finally{a.physics.dispose();b.physics.dispose();}
 });
 fs.writeFileSync(path.join(__dirname,'verification/checkpoint.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 } finally {await context.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
