import { chromium, expect } from '@playwright/test';
import { mkdir, copyFile, writeFile, readFile, rename, cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const server = createServer();
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
await new Promise(r => server.close(r));
const directory = resolve('src-tauri/target/smoke',String(Date.now()));
await mkdir(join(directory,'data'),{recursive:true});
await mkdir(resolve('test-results'),{recursive:true});
const executable = join(directory,'idgafcord.exe');
await copyFile(resolve('src-tauri/target/release/lightweight-discord-client.exe'),executable);
await cp(resolve('src-tauri/resources/voice'),join(directory,'voice'),{recursive:true});
await writeFile(join(directory,'portable.flag'),'');
await writeFile(join(directory,'data/settings.json'),JSON.stringify({minimize_to_tray:false,auto_update_check:false,language:'tr'}));
const child=spawn(executable,[],{cwd:directory,windowsHide:true,stdio:'ignore',env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`}});
let browser,page;
try {
  let endpoint;
  for(let i=0;i<150;i++){
    if(child.exitCode!==null)throw Error(`Application exited: ${child.exitCode}`);
    try{const r=await fetch(`http://127.0.0.1:${port}/json/version`);endpoint=(await r.json()).webSocketDebuggerUrl;break;}catch{}
    await delay(200);
  }
  if(!endpoint)throw Error('WebView2 debugging endpoint did not start.');
  browser=await chromium.connectOverCDP(endpoint);
  const context=browser.contexts()[0];
  for(let i=0;i<100;i++){page=context.pages().find(p=>p.url().startsWith('https://discord.com'));if(page)break;await delay(200);}
  if(!page)throw Error('Discord document is unavailable.');
  // Exercise the real native host and WebView2 using deterministic Discord DOM.
  // Live Discord response timing is not a dependency of the native bridge test.
  const fixture=await readFile(resolve('tests/fixtures/discord.html'),'utf8');
  await page.route('https://discord.com/**',route=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body:fixture}):route.continue());
  await page.goto('https://discord.com/app',{waitUntil:'commit'});
  await page.waitForFunction(()=>!!window.__LDC_openSettings&&!!document.getElementById('ldc-root'),null,{timeout:30000});
  // Discord may remove the global localStorage property after boot. Seed this
  // isolated test profile through CDP, then use the real settings controls.
  const storage=await context.newCDPSession(page);
  for(const [key,value] of Object.entries({ldc_lang:'tr',ldc_theme:'aeroDark',ldc_firstRunDone:'1',ldc_splash:'0',ldc_voiceMute:'0'})){
    await storage.send('DOMStorage.setDOMStorageItem',{storageId:{securityOrigin:'https://discord.com',isLocalStorage:true},key,value});
  }
  await storage.detach();
  await page.reload({waitUntil:'commit'});
  await page.waitForFunction(()=>!!window.__LDC_openSettings&&!!document.getElementById('ldc-root'));
  await expect.poll(()=>page.evaluate(()=>!!document.getElementById('ldc-header-settings'))).toBe(true);
  if(await page.evaluate(()=>typeof window.__TAURI__!=='undefined'))throw Error('Global native IPC was exposed.');
  await page.evaluate(()=>window.__LDC_openSettings());
  await expect.poll(()=>page.evaluate(()=>document.getElementById('ldc-modal')?.style.display)).toBe('flex');
  await page.evaluate(()=>document.getElementById('ldc-tab-voice').click());
  await expect.poll(()=>page.evaluate(()=>document.getElementById('ldc-voice-pack-status')?.dataset.ready)).toBe('true');
  if(await page.evaluate(()=>document.querySelector('[role="switch"][aria-label="Sesle mikrofon komutu"]').getAttribute('aria-checked'))!=='false')throw Error('Capture was unexpectedly enabled.');
  await page.screenshot({path:'test-results/native-aero-settings.png'});
  const chrome=await page.evaluate(()=>({head:document.querySelector('.ldc-settings-head').getBoundingClientRect().height,foot:document.querySelector('.ldc-settings-foot').getBoundingClientRect().height}));
  if(chrome.head>66||chrome.foot>36)throw Error(`Settings chrome is oversized: ${JSON.stringify(chrome)}`);
  await page.evaluate(()=>document.getElementById('ldc-tab-card').click());
  await expect.poll(()=>page.evaluate(()=>!!document.querySelector('#ldc-card-editor .idgaf-user-card'))).toBe(true);
  await page.screenshot({path:'test-results/native-card-editor.png'});
  await page.evaluate(()=>document.getElementById('ldc-tab-voice').click());
  await page.evaluate(()=>{const previous=window.__LDC_downloadStatus;window.__LDC_downloadStatus=result=>{window.nativeDownloadProbe=result;window.__LDC_downloadStatus=previous;};location.href='idgafcord://native?action=download_image&key=native-probe&value='+encodeURIComponent('https://example.org/private.png');});
  await expect.poll(()=>page.evaluate(()=>window.nativeDownloadProbe?.status)).toBe('error');
  await page.evaluate(()=>{location.href='idgafcord://native?action=set_ecosystem&value='+encodeURIComponent(JSON.stringify({url:'https://idgafcord.fixture.workers.dev',enabled:false}));});
  await expect.poll(async()=>JSON.parse(await readFile(join(directory,'data/settings.json'),'utf8')).ecosystem_url).toBe('https://idgafcord.fixture.workers.dev');
  if(JSON.parse(await readFile(join(directory,'data/settings.json'),'utf8')).ecosystem_enabled)throw Error('Ecosystem lookup was unexpectedly enabled.');
  await page.evaluate(()=>{location.href='idgafcord://native?action=set_ecosystem&value='+encodeURIComponent(JSON.stringify({url:'',enabled:false}));});
  await expect.poll(async()=>JSON.parse(await readFile(join(directory,'data/settings.json'),'utf8')).ecosystem_url).toBe('');
  // Real WebView2 dialog/media behavior with an isolated synthetic call. No
  // physical screen, webcam, microphone or Discord session is captured.
  await page.evaluate(()=>{
    const layer=document.createElement('section');layer.id='native-cinema-fixture';layer.style.cssText='position:absolute;inset:100px 30px 50px 330px;opacity:.99;contain:paint;overflow:hidden;will-change:transform';
    const stage=document.createElement('div');stage.className='callContainer_native';stage.style.cssText='width:640px;height:360px;transform:translate(12px,18px)';const video=document.createElement('video');video.style.cssText='width:640px;height:360px';video.muted=true;
    const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const context=canvas.getContext('2d');context.fillStyle='#17445c';context.fillRect(0,0,1280,720);context.fillStyle='#dbe8ee';context.font='32px Segoe UI';context.fillText('idgafcord · yerel WebView2 sinema testi',80,100);video.srcObject=canvas.captureStream(5);video.play();window.nativeCinemaSource=video;window.nativeCinemaTrack=video.srcObject.getVideoTracks()[0];stage.append(video);layer.append(stage);document.getElementById('app-mount').append(layer);
  });
  // Close the settings through its keyboard handler to restore its focus state.
  await page.keyboard.press('Escape');
  await expect.poll(()=>page.evaluate(()=>!!document.getElementById('ldc-cinema-entry')&&!document.getElementById('ldc-cinema-entry').hidden)).toBe(true);
  await page.evaluate(()=>document.getElementById('ldc-cinema-entry').click());
  await expect.poll(()=>page.evaluate(()=>!!document.querySelector('#ldc-cinema-view[open] video')&&document.querySelector('#ldc-cinema-view video').readyState>=2)).toBe(true);
  const cinema=await page.evaluate(()=>{const video=document.querySelector('#ldc-cinema-view video');return {sameTrack:video.srcObject.getVideoTracks()[0]===nativeCinemaTrack,noAudio:video.srcObject.getAudioTracks().length===0,muted:video.muted,transform:getComputedStyle(nativeCinemaSource.parentElement).transform,viewport:Math.abs(document.getElementById('ldc-cinema-view').getBoundingClientRect().width-innerWidth)<1};});
  if(!cinema.sameTrack||!cinema.noAudio||!cinema.muted||!cinema.viewport||cinema.transform!=='matrix(1, 0, 0, 1, 12, 18)')throw Error(`Cinema isolation failed: ${JSON.stringify(cinema)}`);
  await page.screenshot({path:'test-results/native-cinema-isolated.png'});
  await page.keyboard.press('Escape');await expect.poll(()=>page.evaluate(()=>!!document.getElementById('ldc-cinema-view'))).toBe(false);
  if(await page.evaluate(()=>nativeCinemaTrack.readyState)!=='live')throw Error('Closing Cinema stopped the original video track.');
  await page.evaluate(()=>document.getElementById('native-cinema-fixture').remove());
  const packMarker=join(directory,'voice/tr/.verified');
  const disabledMarker=join(directory,'voice/tr/.verified.smoke-disabled');
  await rename(packMarker,disabledMarker);
  try {
    await page.evaluate(()=>window.__LDC_openSettings());
    await expect.poll(()=>page.evaluate(()=>document.getElementById('ldc-voice-pack-status')?.dataset.ready)).toBe('false');
  } finally { await rename(disabledMarker,packMarker); }
  await page.evaluate(()=>window.__LDC_openSettings());
  await expect.poll(()=>page.evaluate(()=>document.getElementById('ldc-voice-pack-status')?.dataset.ready)).toBe('true');
  const savedAppearance=async()=>JSON.parse(await readFile(join(directory,'data/settings.json'),'utf8')).appearance;
  await page.evaluate(()=>{document.getElementById('ldc-tab-theme').click();Array.from(document.querySelectorAll('#ldc-modal button')).find(b=>b.textContent==='Frutiger Aero').click();});
  await expect.poll(async()=>(await savedAppearance())?.background).toBe('#dbeef5');
  await page.evaluate(()=>Array.from(document.querySelectorAll('#ldc-modal button')).find(b=>b.textContent==='Dark Frutiger Aero').click());
  await expect.poll(async()=>(await savedAppearance())?.background).toBe('#061321');
  await page.route('https://discord.com/app',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><div id="app-mount"></div></body></html>'}));
  let scienceRequests=0;
  await page.route('**/api/v9/science',route=>{scienceRequests++;return route.fulfill({json:{}});});
  await page.goto('https://discord.com/app',{waitUntil:'domcontentloaded'});
  await delay(16000);
  if(await page.evaluate(()=>sessionStorage.getItem('ldc_safe'))!==null)throw Error('Slow startup enabled safe mode.');
  await expect.poll(()=>page.evaluate(()=>{const waiting=document.getElementById('ldc-loading');return !!waiting&&waiting.getBoundingClientRect().width>0;})).toBe(true);
  const bg=await page.evaluate(()=>getComputedStyle(document.documentElement).backgroundColor);
  if(bg!=='rgb(6, 19, 33)')throw Error(`Unexpected slow-start background: ${bg}`);
  await page.evaluate(()=>fetch('https://discord.com/api/v9/science',{method:'POST',body:'{}'}));
  if(scienceRequests!==0)throw Error('Slow startup disabled telemetry blocking.');
  await page.screenshot({path:'test-results/native-slow-start.png'});
  await page.route('https://discord.com/app',route=>route.fulfill({contentType:'text/html',body:fixture}));
  await page.goto('https://discord.com/app',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__LDC_openSettings);
  await expect.poll(()=>page.evaluate(()=>!!document.getElementById('ldc-audio-status'))).toBe(true);
  await page.evaluate(()=>{
    const frame=document.createElement('section');frame.id='native-settings-fixture';frame.setAttribute('role','dialog');frame.style.cssText='position:fixed;inset:40px;display:flex;z-index:1000';
    frame.innerHTML='<aside aria-label="Settings sidebar"><nav aria-label="Settings pages"><ul><li><div role="link" tabindex="0">Account</div></li><li><div role="link" tabindex="0">Voice &amp; Video</div></li></ul></nav></aside><main>Discord settings</main>';document.body.appendChild(frame);
  });
  await expect.poll(()=>page.evaluate(()=>!!document.getElementById('ldc-discord-settings-open'))).toBe(true);
  await page.evaluate(()=>document.getElementById('ldc-discord-settings-open').click());
  if(!await page.evaluate(()=>!!document.querySelector('#native-settings-fixture #ldc-modal')))throw Error('Client settings escaped the native settings focus boundary.');
  await page.screenshot({path:'test-results/native-discord-settings.png'});
  await page.evaluate(()=>document.getElementById('native-settings-fixture').remove());
  await expect.poll(()=>page.evaluate(()=>!!document.querySelector('#ldc-root #ldc-modal'))).toBe(true);
  // Request consent, then DENY. The permission UI is tested without granting
  // access or recording a live microphone.
  await page.evaluate(()=>{
    window.__permissionResult='pending';
    navigator.mediaDevices.getUserMedia({audio:true}).then(stream=>{stream.getTracks().forEach(track=>track.stop());window.__permissionResult='unexpected-grant';},error=>window.__permissionResult=error.name);
  });
  let consent;
  for(let i=0;i<75;i++){consent=context.pages().find(candidate=>candidate.url().includes('/permission.html'));if(consent)break;await delay(100);}
  if(!consent)throw Error(`Local permission window did not open; result=${await page.evaluate(()=>window.__permissionResult)}`);
  await consent.waitForFunction(()=>!!document.getElementById('deny')&&!document.getElementById('deny').disabled);
  if(await consent.evaluate(()=>document.getElementById('remember').checked))throw Error('Permission persistence was preselected.');
  await consent.screenshot({path:'test-results/native-device-permission.png'});
  await consent.evaluate(()=>document.getElementById('deny').click()).catch(error=>{if(!/closed|destroyed/i.test(error.message))throw error;});
  await expect.poll(()=>page.evaluate(()=>window.__permissionResult)).toBe('NotAllowedError');
  await page.evaluate(()=>{document.getElementById('ldc-audio-status').click();Array.from(document.querySelectorAll('#ldc-modal button')).find(button=>button.textContent==='Discord aygıt izinlerini sıfırla').click();});
  await expect.poll(()=>page.evaluate(()=>document.getElementById('ldc-voice-detail')?.textContent.includes('Discord aygıt izinleri sıfırlandı'))).toBe(true);
  console.log(JSON.stringify({nativeStartup:true,cinemaIsolated:true,cinemaOriginalTrackAlive:true,settings:true,discordSettingsEntry:true,permissionDeniedWithoutCapture:true,permissionResetToPrompt:true,remoteIpcDisabled:true,bundledTrEnReady:true,missingPackMessage:true,nativeThemeSync:true,slowStartupPreservesProtection:true,microphoneEnabled:false,profile:directory},null,2));
} catch(error) {
  if(page)await page.screenshot({path:'test-results/native-failure.png'}).catch(()=>{});
  throw error;
} finally {
  if(browser)await browser.close().catch(()=>{});
  if(child.exitCode===null){try{execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{child.kill();}}
}
