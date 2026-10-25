const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = __dirname;
http.createServer((req,res)=>{
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0]));
  if (!file.startsWith(root)) {res.writeHead(403).end();return;}
  fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':'application/octet-stream');res.end(data);});
}).listen(8766,'127.0.0.1');
(async()=>{
 for(let i=0;i<2;i++){
   const browser = await chromium.launch({headless:false,args:[`--remote-debugging-port=${9331+i}`,'--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows',`--window-position=${i*650},20`,'--window-size=960,800']});
   const context = await browser.newContext({viewport:{width:960,height:720}});
   const page=await context.newPage();
   page.on('pageerror',error=>fs.appendFileSync(path.join(root,'verification',`browser-${i+1}-errors.log`),error.stack+'\n'));
   await page.goto('http://127.0.0.1:8766/');
   console.log('browser',i+1,'started');
 }
})();
