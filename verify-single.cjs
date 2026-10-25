const {chromium}=require('playwright');const fs=require('fs');const path=require('path');const assert=require('assert/strict');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const browser=await chromium.connectOverCDP('http://127.0.0.1:9332');const context=await browser.newContext({viewport:{width:960,height:720}});const page=await context.newPage();const report={samples:[]};
try{await page.goto('http://127.0.0.1:8766/');await page.waitForFunction(()=>__takraw?.ready);await page.locator('#start-match').click();
 for(let i=0;i<45;i++){
 const data=await page.evaluate(()=>({state:__takraw.game.state,diagnostics:__takraw.diagnostics()}));assert.equal(data.diagnostics.mode,'match');assert.ok(!data.diagnostics.failed&&!data.diagnostics.errors.length);
 report.samples.push({tick:data.diagnostics.tick,score:data.state.score,sets:data.state.sets,phase:data.state.phase});console.log('SINGLE',report.samples.at(-1));
 if(data.state.phase==='finished'){report.passed=true;report.diagnostics=data.diagnostics;await page.screenshot({path:path.join(__dirname,'verification/single-finished.png')});break;}await sleep(15000);
 }assert.ok(report.passed,'single game completed');
}catch(e){report.passed=false;report.error=e.stack;throw e;}finally{fs.writeFileSync(path.join(__dirname,'verification/single.json'),JSON.stringify(report,null,2));await context.close();await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
