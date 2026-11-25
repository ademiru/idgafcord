import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';
const allocator=createServer();await new Promise(resolve=>allocator.listen(0,'127.0.0.1',resolve));const port=allocator.address().port;await new Promise(resolve=>allocator.close(resolve));
const origin=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,[resolve('ecosystem/node_modules/wrangler/bin/wrangler.js'),'dev','--local','--ip','127.0.0.1','--port',String(port),'--config','ecosystem/wrangler.example.jsonc','--persist-to','src-tauri/target/ecosystem-local','--var',`PUBLIC_ORIGIN:${origin}`],{windowsHide:true,stdio:'ignore',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
let browser;
try{
  let ready=false;for(let index=0;index<100;index++){if(child.exitCode!==null)throw Error('Local worker exited');try{if((await fetch(origin+'/health')).ok){ready=true;break;}}catch{}await delay(200);}if(!ready)throw Error('Local worker did not start');
  const cards=await fetch(origin+'/v1/cards?ids=123456789012345678');if(!cards.ok||Object.keys((await cards.json()).cards).length)throw Error('Actual D1 lookup failed');
  const denied=await fetch(origin+'/v1/me',{method:'PUT',headers:{origin,'content-type':'application/json'},body:'{}'});if(denied.status!==401)throw Error('Unauthenticated publishing was not blocked');
  browser=await chromium.launch({channel:'msedge'});const page=await browser.newPage({viewport:{width:1100,height:1000}}),errors=[],external=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(!request.url().startsWith(origin))external.push(request.url());});
  await page.goto(origin);await expect(page.locator('.idgaf-user-card')).toBeVisible();await page.getByLabel('Görünen ad',{exact:true}).fill('ademiru');await page.getByLabel('Kaplama',{exact:true}).selectOption('graphite');await page.getByRole('button',{name:'Kartı kaydet',exact:true}).click();
  await expect(page.locator('#connection')).toContainText('önce Discord ile giriş yap');
  if(errors.length||external.length)throw Error(JSON.stringify({errors,external}));
  await page.screenshot({path:'test-results/ecosystem-local.png',fullPage:true});
  console.log('PASS: actual local workerd/D1 migration and lookup, CSP/ES module editor, unauthenticated publishing denied, no external requests.');
}finally{if(browser)await browser.close();if(child.exitCode===null){if(process.platform==='win32'){try{execFileSync('taskkill',['/pid',String(child.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'});}catch{}}else child.kill();}}
