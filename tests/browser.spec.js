import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { bootstrap } from './bootstrap.js';
const fixture = readFileSync(new URL('./fixtures/discord.html', import.meta.url), 'utf8');
async function open(page, theme = 'aero', options = {}) {
  const errors = [], requests = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url === 'https://discord.com/app') return route.fulfill({ contentType: 'text/html', body: fixture });
    requests.push(url); return route.fulfill({ contentType: 'application/json', body: '{}' });
  });
  await page.addInitScript(({ theme, options }) => {
    localStorage.setItem('ldc_theme',theme);localStorage.setItem('ldc_firstRunDone','1');localStorage.setItem('ldc_lang','tr');
    for(const [key,value] of Object.entries(options)) localStorage.setItem('ldc_'+key,String(value));
  }, { theme, options });
  await page.addInitScript({ content: bootstrap() });
  await page.goto('https://discord.com/app');
  await expect(page.locator('#ldc-root')).toBeAttached();
  return { errors, requests };
}
for (const theme of ['aero', 'aeroDark']) {
  test(`${theme}: complete workspace, toolbar and text colors`, async ({ page }) => {
    const { errors } = await open(page,theme,{splash:0});
    await expect(page.locator('html')).toHaveAttribute('data-ldc-aero',theme==='aero'?'light':'dark');
    await expect(page.locator('#ldc-gear')).toBeHidden();
    const color=await page.locator('.messageContent_fixture').first().evaluate(el=>getComputedStyle(el).color);
    expect(color).toBe(theme==='aero'?'rgb(20, 56, 78)':'rgb(224, 245, 251)');
    await page.screenshot({path:`test-results/${theme}.png`});
    await page.evaluate(()=>window.__LDC_openSettings());
    await page.getByRole('tab',{name:'Tema',exact:true}).click();
    await page.getByRole('switch',{name:'Odak görünümü',exact:true}).click();
    await expect(page.locator('.membersWrap_fixture')).toBeHidden();
    await page.getByRole('switch',{name:'Cam efektleri',exact:true}).click();
    await expect(page.locator('html')).toHaveAttribute('data-ldc-aero-fx','0');
    expect(errors).toEqual([]);
  });
}
test('Aero toggles light/dark and cleans up when another theme is selected', async ({ page }) => {
  const { errors }=await open(page,'aero',{splash:0});
  await page.evaluate(()=>{localStorage.setItem('ldc_theme','aeroDark');window.__LDC_applyAll();});
  await expect(page.locator('html')).toHaveAttribute('data-ldc-aero','dark');
  await page.evaluate(()=>{localStorage.setItem('ldc_theme','midnight');window.__LDC_applyAll();});
  await expect(page.locator('html')).not.toHaveAttribute('data-ldc-aero');
  await expect(page.locator('#ldc-aero-tools')).toBeHidden();expect(errors).toEqual([]);
});
test('startup exits, never reappears and respects reduced motion', async ({ page }) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  const { errors }=await open(page,'aero',{splash:1});
  await expect(page.locator('#ldc-splash')).toHaveCount(0,{timeout:4000});
  await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
  await expect(page.locator('#ldc-splash')).toHaveCount(0);expect(errors).toEqual([]);
});
test('startup has a bounded lifetime when Discord does not render', async ({ page }) => {
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<html><body></body></html>'}));
  await page.addInitScript({content:bootstrap()});await page.goto('https://discord.com/app');
  await page.waitForTimeout(500);await page.screenshot({path:'test-results/startup.png'});
  await expect(page.locator('#ldc-splash')).toHaveCount(0,{timeout:4000});
});
test('settings open with offline voice controls', async ({ page }) => {
  const { errors }=await open(page,'aero',{splash:0});
  await page.evaluate(()=>window.__LDC_openSettings());
  await expect(page.locator('#ldc-modal')).toBeVisible();
  await page.getByRole('tab',{name:'Ses',exact:true}).click();
  await expect(page.getByRole('tab',{name:'Ses',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.getByRole('tab',{name:'Sistem',exact:true})).toHaveAttribute('aria-selected','false');
  await expect(page.getByRole('button',{name:'Ses dosyalarını denetle',exact:true})).toBeVisible();
  await expect(page.getByLabel('Komut dili')).toHaveValue('tr');
  await page.screenshot({path:'test-results/aero-settings.png'});expect(errors).toEqual([]);
});
test('telemetry blocks strings, URL objects, Requests, XHR and beacon without blocking reports', async ({ page }) => {
  const { errors,requests }=await open(page,'aero',{splash:0});
  const result=await page.evaluate(async()=>{
    const science='https://discord.com/api/v9/science';
    const bodies=await Promise.all([science,new URL(science),new Request(science)].map(async input=>(await fetch(input)).json()));
    const xhr=await new Promise(resolve=>{const x=new XMLHttpRequest();x.open('POST',science);x.responseType='json';x.onload=()=>resolve({status:x.status,data:x.response});x.send('{}');});
    const beacon=navigator.sendBeacon(science,'{}');
    await fetch('/api/v9/reporting/menu/1');await fetch('https://cdn.discordapp.com/attachments/1/sentry.png');
    return {bodies,xhr,beacon};
  });
  expect(result).toEqual({bodies:[{},{},{}],xhr:{status:200,data:{}},beacon:true});
  expect(requests.some(u=>u.includes('/science'))).toBe(false);
  expect(requests.some(u=>u.includes('/reporting/'))).toBe(true);
  expect(requests.some(u=>u.endsWith('sentry.png'))).toBe(true);expect(errors).toEqual([]);
});
test('mic controls follow actual Discord state and remain idempotent', async ({ page }) => {
  await open(page,'aero',{splash:0});const mic=page.locator('#fixture-mic');
  await page.evaluate(()=>window.__LDC_setMute('mute'));await expect(mic).toHaveAttribute('aria-pressed','true');
  await page.waitForTimeout(150);await page.evaluate(()=>window.__LDC_setMute('mute'));await expect(mic).toHaveAttribute('aria-pressed','true');
  await page.evaluate(()=>window.__LDC_setMute('unmute'));await expect(mic).toHaveAttribute('aria-pressed','false');
});
test('Aero remains usable at the minimum supported window size', async ({ page }) => {
  await page.setViewportSize({width:800,height:600});await open(page,'aeroDark',{splash:0});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.locator('#fixture-mic')).toBeVisible();await page.screenshot({path:'test-results/aero-800.png'});
});

test('settings have one scroll area, aligned switches and no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({width:800,height:600});
  const {errors}=await open(page,'aeroDark',{splash:0});
  await page.evaluate(()=>window.__LDC_openSettings());
  for(const name of ['Sistem','Ses','Gizlilik','Tema','Görünüm','Markdown','Eklentiler','Gelişmiş']) {
    await page.getByRole('tab',{name,exact:true}).click();
    const widths=await page.locator('#ldc-modal').evaluate(el=>[...el.querySelectorAll('.ldc-settings-card,.ldc-settings-nav,.ldc-settings-head,#ldc-modal-body')].map(e=>({overflow:e.scrollWidth-e.clientWidth})));
    expect(widths.every(w=>w.overflow<=1),name).toBe(true);
  }
  await page.getByRole('tab',{name:'Ses',exact:true}).click();
  const rowDisplay=await page.getByRole('switch',{name:'Sesle mikrofon komutu',exact:true}).evaluate(el=>getComputedStyle(el.parentElement).display);
  expect(rowDisplay).toBe('flex');
  await page.screenshot({path:'test-results/settings-800.png'});
  expect(errors).toEqual([]);
});

test('login forms do not trigger a false recovery reload', async ({ page }) => {
  await page.clock.install();
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<form><input name="email"><input type="password"></form>'}));
  await page.addInitScript({content:bootstrap()});
  await page.goto('https://discord.com/login');
  await page.clock.runFor(15000);
  expect(await page.evaluate(()=>sessionStorage.getItem('ldc_safe'))).toBeNull();
  await expect(page.locator('#ldc-load-issue')).toHaveCount(0);
});

test('settings support keyboard navigation and restore focus when closed', async ({ page }) => {
  await open(page,'midnight',{splash:0});
  const launcher=page.locator('#ldc-header-settings');
  await launcher.click();
  await expect(page.getByRole('tab',{name:'Sistem',exact:true})).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('tab',{name:'Ses',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog',{name:'Ayarlar',exact:true})).toBeHidden();
  await expect(launcher).toBeFocused();
});

test('empty channel scroll layers are never painted cyan', async ({ page }) => {
  await open(page,'aeroDark',{splash:0});
  await page.evaluate(()=>{
    const sidebar=document.querySelector('.sidebarList_channels');
    for(const position of ['top','bottom']){
      const layer=document.createElement('div');layer.id='scroll-'+position;layer.className='unread__regression';layer.setAttribute('aria-hidden','true');
      Object.assign(layer.style,{height:'40px',width:'100%',flexShrink:'0'});sidebar.appendChild(layer);
    }
  });
  for(const id of ['scroll-top','scroll-bottom']){
    expect(await page.locator('#'+id).evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  }
});

test('slow Discord startup never disables themes or telemetry protection', async ({ page }) => {
  await page.clock.install();let visits=0;
  await page.route('**/*',route=>{visits++;return route.fulfill({contentType:'text/html',body:'<html><body><div id="app-mount"></div></body></html>'});});
  await page.addInitScript({content:bootstrap()});await page.goto('https://discord.com/app');
  await page.clock.runFor(16000);
  expect(await page.evaluate(()=>sessionStorage.getItem('ldc_safe'))).toBeNull();
  expect(visits).toBe(1);
});

test('a slow boot has no white empty page after the brief logo animation', async ({ page }) => {
  await page.clock.install();
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<html><body></body></html>'}));
  await page.addInitScript({content:bootstrap()});await page.goto('https://discord.com/app');
  await page.clock.runFor(5000);
  const canvas=await page.evaluate(()=>({html:getComputedStyle(document.documentElement).backgroundColor,body:getComputedStyle(document.body).backgroundColor,waiting:!!document.querySelector('#ldc-loading')}));
  expect(canvas.waiting||![canvas.html,canvas.body].every(c=>c==='rgba(0, 0, 0, 0)'||c==='rgb(255, 255, 255)')).toBe(true);
});

test('Aero embeds replace provider stripes with one neutral frame', async ({ page }) => {
  await open(page,'aeroDark',{splash:0});
  await page.evaluate(()=>{const card=document.createElement('article');card.id='embed';card.className='embedFull_fixture';card.style.cssText='border-left:4px solid red;width:300px';card.innerHTML='<a href="#">Video başlığı</a>';document.querySelector('.messagesWrapper_feed').append(card);});
  const border=await page.locator('#embed').evaluate(el=>{const s=getComputedStyle(el);return [s.borderLeftWidth,s.borderTopWidth,s.borderLeftColor,s.borderTopColor]});
  expect(border[0]).toBe('1px');expect(border[0]).toBe(border[1]);expect(border[2]).toBe(border[3]);
  await page.locator('#embed a').click();
});

test('one multiline message produces one box without overlapping the next message', async ({ page }) => {
  await open(page,'aeroDark',{splash:0,bubbles:1});
  const message=page.locator('.messageContent_fixture').first();
  await message.evaluate(el=>{el.innerHTML='Birinci satır<br>İkinci satır<br>Üçüncü satır'});
  const metrics=await message.evaluate(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect(),next=el.closest('article').nextElementSibling.getBoundingClientRect();return {display:s.display,boxes:el.getClientRects().length,margin:s.marginTop,bottom:r.bottom,nextTop:next.top,lineHeight:parseFloat(s.lineHeight),height:r.height};});
  expect(metrics.display).toBe('block');expect(metrics.boxes).toBe(1);expect(parseFloat(metrics.margin)).toBeGreaterThanOrEqual(0);expect(metrics.height).toBeGreaterThan(metrics.lineHeight*3);expect(metrics.nextTop).toBeGreaterThan(metrics.bottom);
  expect(metrics.height).toBeLessThan(metrics.lineHeight*4+20);
  await page.screenshot({path:'test-results/aero-bubbles.png'});
});

test('Aero has a keyboard settings entry without the floating capsule', async ({ page }) => {
  await open(page,'aeroDark',{splash:0});
  await expect(page.locator('#ldc-gear')).toBeHidden();await page.keyboard.press('Control+Shift+,');
  await expect(page.locator('#ldc-modal')).toBeVisible();
});

for(const [legacy,expected] of [[null,'aeroDark'],['0','off'],['1','midnight']]) {
  test(`new profile and legacy preference: ${legacy} becomes ${expected}`, async ({ page }) => {
    await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:fixture}));
    if(legacy!==null)await page.addInitScript(value=>localStorage.setItem('ldc_themeOn',value),legacy);
    await page.addInitScript({content:bootstrap()});await page.goto('https://discord.com/app');
    expect(await page.evaluate(()=>localStorage.getItem('ldc_theme'))).toBe(expected);
    if(legacy===null)await expect(page.locator('html')).toHaveAttribute('data-ldc-aero','dark');
  });
}

test('reply preview stays inline and does not inherit the main message bubble', async ({ page }) => {
  await open(page,'aeroDark',{splash:0,bubbles:1});
  await page.evaluate(()=>{
    const message=document.querySelector('.messagebody');
    const quote=document.createElement('div');quote.className='repliedMessage_fixture';quote.id='reply-preview';
    quote.style.cssText='display:flex;align-items:center;height:22px;gap:6px';
    quote.innerHTML='<span class="replyAvatar_fixture" style="width:16px;height:16px;flex:none">◉</span><button class="replyAuthor_fixture">Deniz</button><span class="repliedTextPreview_fixture" style="min-width:0;overflow:hidden;white-space:nowrap"><span class="messageContent_fixture">Önceki mesajın uzun alıntısı burada görünüyor.</span></span>';
    message.prepend(quote);
  });
  const preview=page.locator('#reply-preview .messageContent_fixture');
  const style=await preview.evaluate(el=>{const s=getComputedStyle(el);return {display:s.display,padding:s.padding,background:s.backgroundColor}});
  expect(style.display).toBe('inline');expect(style.padding).toBe('0px');expect(style.background).toBe('rgba(0, 0, 0, 0)');
  const boxes=await page.locator('#reply-preview').evaluate(el=>{const text=el.querySelector('.repliedTextPreview_fixture').getBoundingClientRect(),author=el.querySelector('button').getBoundingClientRect(),body=el.parentElement.querySelector(':scope > .messageContent_fixture').getBoundingClientRect();return {textY:text.y,authorY:author.y,quoteBottom:el.getBoundingClientRect().bottom,bodyTop:body.top}});
  expect(Math.abs(boxes.textY-boxes.authorY)).toBeLessThan(8);expect(boxes.bodyTop).toBeGreaterThanOrEqual(boxes.quoteBottom);
  await page.screenshot({path:'test-results/aero-reply.png'});
});

for(const nativeOpen of [true,false]) {
  test(`Discord member toggle overrides app hiding when nativeOpen=${nativeOpen}`, async ({ page }) => {
    await open(page,'aeroDark',{splash:0,hideMembers:1,aeroFocus:1});
    await page.evaluate(nativeOpen=>{
      const members=document.querySelector('.membersWrap_fixture');members.hidden=!nativeOpen;
      const button=document.createElement('button');button.id='native-member-toggle';button.setAttribute('aria-label',nativeOpen?'Hide Member List':'Show Member List');
      button.onclick=()=>{members.hidden=!members.hidden;button.setAttribute('aria-label',members.hidden?'Show Member List':'Hide Member List');};
      document.querySelector('.title_container').appendChild(button);button.textContent='Üyeler';
    },nativeOpen);
    await expect(page.locator('.membersWrap_fixture')).toBeHidden();
    await page.getByRole('button',{name:nativeOpen?'Hide Member List':'Show Member List',exact:true}).click();
    await expect(page.locator('.membersWrap_fixture')).toBeVisible();
    expect(await page.evaluate(()=>localStorage.getItem('ldc_hideMembers'))).toBe('0');
    expect(await page.evaluate(()=>localStorage.getItem('ldc_aeroFocus'))).toBe('0');
  });
}

async function nativeSettings(page,legacy=false){
  await page.evaluate(legacy=>{
    const frame=document.createElement('section');frame.id='native-settings';frame.setAttribute('role','dialog');frame.setAttribute('aria-label','User Settings');
    frame.style.cssText='position:fixed;inset:50px 70px;display:flex;z-index:1000;color:var(--text-normal);overflow:auto';
    frame.innerHTML=legacy?'<div class="standardSidebarView_fixture" style="display:flex;width:100%"><aside class="sidebarRegion_fixture" style="width:260px"><div role="tablist"><button role="tab">My Account</button><button role="tab">Voice &amp; Video</button></div></aside><main>Discord settings</main></div>':'<aside aria-label="Settings sidebar" style="width:260px;flex:none"><input aria-label="Search settings"><nav aria-label="Settings pages"><ul><li><a href="#account">Account</a></li><li><a href="#voice">Voice &amp; Video</a></li></ul></nav></aside><main style="flex:1;padding:30px">Discord settings</main>';
    document.body.appendChild(frame);window.originalDiscordSetting=frame.querySelector('a,button');
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&frame.isConnected)frame.remove();});
  },legacy);
  await expect(page.locator('#ldc-discord-settings-open')).toBeVisible();
}
for(const legacy of [false,true]){
  test(`Discord settings entry opens inside its focus boundary and returns on Escape: legacy=${legacy}`,async({page})=>{
    const {errors}=await open(page,'aeroDark',{splash:0});await nativeSettings(page,legacy);
    await page.getByRole('button',{name:'İstemci ayarları',exact:true}).click();
    await expect(page.locator('#ldc-modal')).toBeVisible();
    expect(await page.locator('#ldc-modal').evaluate(el=>!!el.closest('#native-settings'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#ldc-modal')).toBeHidden();await expect(page.locator('#native-settings')).toBeVisible();
    await expect(page.getByRole('button',{name:'İstemci ayarları',exact:true})).toBeFocused();
    expect(await page.evaluate(()=>document.contains(window.originalDiscordSetting))).toBe(true);
    expect(errors).toEqual([]);
  });
}
test('settings integration remounts without duplicate entries and recovers a detached panel',async({page})=>{
  const {errors}=await open(page,'aeroDark',{splash:0});await nativeSettings(page);
  await page.getByRole('button',{name:'İstemci ayarları',exact:true}).click();
  await page.evaluate(()=>document.getElementById('native-settings').remove());
  await expect(page.locator('#ldc-root #ldc-modal')).toHaveCount(1);await expect(page.locator('#ldc-modal')).toBeHidden();
  await nativeSettings(page);await expect(page.locator('#ldc-discord-settings-open')).toHaveCount(1);
  await page.evaluate(()=>document.querySelector('#native-settings nav').appendChild(document.createElement('span')));
  await expect(page.locator('#ldc-discord-settings-open')).toHaveCount(1);expect(errors).toEqual([]);
});
test('voice status is a compact header control and errors are shown in Voice settings',async({page})=>{
  await open(page,'aeroDark',{splash:0,micBadge:1});
  const status=page.locator('#ldc-audio-status');await expect(status).toBeVisible();
  expect(await status.evaluate(el=>!!el.closest('.windowbar'))).toBe(true);
  expect(await status.evaluate(el=>getComputedStyle(el).position)).not.toBe('fixed');
  await status.click();await expect(page.getByRole('tab',{name:'Ses',exact:true})).toHaveAttribute('aria-selected','true');
  await page.evaluate(()=>{
    document.querySelector('[role="switch"][aria-label="Sesle mikrofon komutu"]').click();
  });
  await expect(page.locator('#ldc-voice-hud')).toHaveCount(0);
});
test('server lens effects preserve clicks, respect reduced motion and home has no tile',async({page})=>{
  await open(page,'aeroDark',{splash:0});
  const home=page.locator('[data-list-item-id="guildsnav___home"]');
  const design=await home.evaluate(el=>({width:el.getBoundingClientRect().width,bg:getComputedStyle(el).backgroundColor,reflect:getComputedStyle(el,'::before').content}));
  expect(design.width).toBeGreaterThanOrEqual(54);expect(design.bg).toBe('rgba(0, 0, 0, 0)');expect(design.reflect).toBe('none');
  const server=page.getByRole('button',{name:'Test sunucusu',exact:true});await server.hover();
  await expect.poll(()=>server.evaluate(el=>Number(getComputedStyle(el,'::after').opacity))).toBe(1);
  expect(await server.evaluate(el=>getComputedStyle(el,'::after').pointerEvents)).toBe('none');
  await server.click();await expect(server).toHaveAttribute('data-clicked','true');
  await page.emulateMedia({reducedMotion:'reduce'});
  expect(await server.evaluate(el=>getComputedStyle(el,'::after').transitionDuration)).toBe('0s');
  await page.screenshot({path:'test-results/aero-guilds.png'});
});

for(const variant of ['dark','light','invalid']){
  test(`local permission dialog: ${variant} defaults to no grant`,async({page})=>{
    await page.setViewportSize({width:420,height:310});
    const assets=new URL('../src/',import.meta.url);
    await page.route('**/*',route=>{
      const name=new URL(route.request().url()).pathname.slice(1);
      if(['permission.html','permission.js','permission.css'].includes(name))return route.fulfill({contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html',body:readFileSync(new URL(name,assets),'utf8')});
      if(name==='assets/idgafcord.png')return route.fulfill({contentType:'image/png',body:readFileSync(new URL(name,assets))});
      return route.abort();
    });
    await page.addInitScript(variant=>{window.__LDC_PERMISSION__=variant==='invalid'?{origin:'https://example.org',kind:'microphone'}:{origin:'https://discord.com',kind:'microphone',language:'tr',appearance:{dark:variant==='dark'}};},variant);
    await page.goto('https://tauri.localhost/permission.html');
    await expect(page.locator('#remember')).not.toBeChecked();
    if(variant==='invalid')await expect(page.locator('#allow')).toBeDisabled();
    else{await expect(page.locator('#allow')).toBeEnabled();await expect(page.locator('#deny')).toBeFocused();}
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight)).toBe(true);
    await page.screenshot({path:`test-results/permission-${variant}.png`});
  });
}

test('settings entries support Discord role links and the header has an independent settings button',async({page})=>{
  await open(page,'aeroDark',{splash:0,micBadge:0});
  await page.evaluate(()=>{const frame=document.createElement('section');frame.id='role-link-settings';frame.setAttribute('role','dialog');frame.innerHTML='<aside aria-label="Settings sidebar"><nav aria-label="Settings pages"><ul><li><div role="link" tabindex="0">Account</div></li><li><div role="link" tabindex="0">Voice &amp; Video</div></li></ul></nav></aside><main>Settings</main>';document.body.append(frame);});
  await expect(page.locator('#ldc-discord-settings-open')).toBeVisible();
  await page.evaluate(()=>document.getElementById('role-link-settings').remove());
  const entry=page.locator('#ldc-header-settings');await expect(entry).toBeVisible();await expect(entry).toContainText('idgafcord');
  await entry.click();await expect(page.locator('#ldc-modal')).toBeVisible();
});

test('home logo fits the SVG viewport and all clipping ancestors',async({page})=>{
  await open(page,'aeroDark',{splash:0});
  await page.evaluate(()=>{
    document.querySelector('[data-list-item-id="guildsnav___home"]').closest('.listItem_fixture').remove();
    const rail=document.querySelector('[data-list-id="guildsnav"]');
    const row=document.createElement('div');row.className='listItem_clip';row.innerHTML='<div style="width:40px;height:40px;overflow:hidden"><svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40" style="overflow:hidden"><defs><mask id="home-mask"><rect width="40" height="40" fill="white" rx="12"/></mask></defs><foreignObject width="40" height="40" mask="url(#home-mask)"><div xmlns="http://www.w3.org/1999/xhtml" data-list-item-id="guildsnav___home" role="treeitem" tabindex="0" aria-label="Direct Messages" style="width:40px;height:40px"></div></foreignObject></svg></div>';
    rail.prepend(row);
  });
  const home=page.locator('[data-list-item-id="guildsnav___home"]');
  await expect(page.locator('[data-ldc-home-item]')).toHaveCount(1);
  const bounds=await home.evaluate(el=>{const home=el.getBoundingClientRect(),svg=el.closest('svg').getBoundingClientRect(),foreign=el.closest('foreignObject').getBoundingClientRect();return {home:{x:home.x,y:home.y,right:home.right,bottom:home.bottom},svg:{x:svg.x,y:svg.y,right:svg.right,bottom:svg.bottom},foreign:{x:foreign.x,y:foreign.y,right:foreign.right,bottom:foreign.bottom},clipped:[...function*(){for(let p=el.parentElement;p&&!p.matches('[data-ldc-home-item]');p=p.parentElement)yield p;}()].some(p=>{const s=getComputedStyle(p),r=p.getBoundingClientRect();return /(hidden|clip)/.test(s.overflow)&&home.right>r.right+1;})};});
  expect(bounds.home.right).toBeLessThanOrEqual(bounds.foreign.right+1);expect(bounds.home.bottom).toBeLessThanOrEqual(bounds.foreign.bottom+1);expect(bounds.clipped).toBe(false);
  await page.screenshot({path:'test-results/aero-logo-viewport.png'});
});

test('settings chrome is compact and server hover does not move or rescale icons',async({page})=>{
  await open(page,'aeroDark',{splash:0});await page.addStyleTag({content:'*{box-sizing:content-box}'});await page.evaluate(()=>window.__LDC_openSettings());
  const heights=await page.locator('#ldc-modal').evaluate(el=>({head:el.querySelector('.ldc-settings-head').getBoundingClientRect().height,foot:el.querySelector('.ldc-settings-foot').getBoundingClientRect().height}));
  expect(heights.head).toBeLessThanOrEqual(66);expect(heights.foot).toBeLessThanOrEqual(36);
  await page.keyboard.press('Escape');
  const server=page.getByRole('button',{name:'Test sunucusu',exact:true});const before=await server.boundingBox();await server.hover();await page.waitForTimeout(200);const after=await server.boundingBox();
  expect(after.width).toBeCloseTo(before.width,1);expect(after.y).toBeCloseTo(before.y,1);expect(await server.evaluate(el=>getComputedStyle(el).filter)).toBe('none');
});

async function fakeCapture(page,deny=false){
  await page.addInitScript(deny=>{
    window.captureCalls=[];navigator.mediaDevices.getDisplayMedia=function(options){
      window.captureCalls.push({options,activation:navigator.userActivation.isActive});
      if(deny)return Promise.reject(new DOMException('Source unavailable','NotReadableError'));
      const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const graphics=canvas.getContext('2d');graphics.fillStyle='#153043';graphics.fillRect(0,0,1280,720);graphics.fillStyle='#264f64';graphics.fillRect(72,72,1136,576);graphics.fillStyle='#10202b';graphics.fillRect(72,120,1136,528);graphics.fillStyle='#d7e8ee';graphics.font='28px Segoe UI';graphics.fillText('idgafcord · Sentetik önizleme testi',100,106);graphics.fillStyle='#287c93';graphics.fillRect(110,170,440,350);graphics.fillStyle='#8bb4bd';graphics.fillRect(600,170,550,25);graphics.fillRect(600,220,430,15);graphics.fillRect(600,255,500,15);
      const stream=canvas.captureStream(30);window.syntheticCapture=stream;return Promise.resolve(stream);
    };
  },deny);
  await open(page,'aeroDark',{splash:0});
}
async function requestCapture(page,options={video:true,audio:true}){
  await page.evaluate(options=>{window.captureResult=null;navigator.mediaDevices.getDisplayMedia(options).then(stream=>{window.captureResult={ok:true,id:stream.id};},error=>{window.captureResult={ok:false,name:error.name};});},options);
}
test('share menu cancels without capturing and only Continue calls the source picker with click activation',async({page})=>{
  await fakeCapture(page);await requestCapture(page);await expect(page.locator('#ldc-share-menu')).toBeVisible();
  expect(await page.evaluate(()=>captureCalls.length)).toBe(0);await page.keyboard.press('Escape');
  await expect.poll(()=>page.evaluate(()=>captureResult)).toEqual({ok:false,name:'NotAllowedError'});
  expect(await page.evaluate(()=>captureCalls.length)).toBe(0);
  await requestCapture(page);await page.getByLabel('Yakalama boyutu').selectOption('1080');await page.getByLabel('Akıcılık',{exact:true}).selectOption('60');
  await page.screenshot({path:'test-results/share-menu.png'});
  await page.getByRole('button',{name:'Kaynak seç',exact:true}).click();
  await expect(page.getByLabel('Canlı ekran önizlemesi')).toBeVisible();expect(await page.evaluate(()=>captureResult)).toBe(null);await expect.poll(()=>page.evaluate(()=>document.querySelector('#ldc-share-menu video').readyState)).toBeGreaterThanOrEqual(2);expect(await page.evaluate(()=>{const video=document.querySelector('#ldc-share-menu video'),canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const context=canvas.getContext('2d');context.drawImage(video,0,0);return [...context.getImageData(20,20,1,1).data].slice(0,3).every((value,index)=>Math.abs(value-[21,48,67][index])<=2);})).toBe(true);await expect(page.locator('#ldc-ss-bar')).toHaveCount(0);await page.screenshot({path:'test-results/share-preview.png'});await page.getByRole('button',{name:'Paylaşımı başlat',exact:true}).click();
  await expect(page.locator('#ldc-ss-bar')).toHaveCount(0);await expect.poll(()=>page.evaluate(()=>captureResult?.ok)).toBe(true);
  const calls=await page.evaluate(()=>captureCalls);expect(calls).toHaveLength(1);expect(calls[0].activation).toBe(true);
  expect(calls[0].options.video).toMatchObject({width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:60}});
  await expect(page.getByRole('button',{name:'Paylaşımı durdur',exact:true})).toHaveCount(0);await page.evaluate(()=>syntheticCapture.getTracks().forEach(track=>track.stop()));
  await expect(page.locator('#ldc-ss-bar')).toHaveCount(0);
  expect(await page.evaluate(()=>syntheticCapture.getVideoTracks()[0].readyState)).toBe('ended');
});
test('share failures never retry, concurrent prompts reject and watching somebody else never means sharing',async({page})=>{
  await fakeCapture(page,true);
  await page.evaluate(()=>{const tile=document.createElement('div');tile.className='streamTile_fixture';tile.innerHTML='<video class="stream_fixture"></video>';document.body.append(tile);});
  await expect(page.locator('#ldc-ss-bar')).toHaveCount(0);
  await requestCapture(page);
  expect(await page.evaluate(()=>navigator.mediaDevices.getDisplayMedia({video:true}).then(()=>'',e=>e.name))).toBe('InvalidStateError');
  await page.getByRole('button',{name:'Kaynak seç',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>captureResult)).toEqual({ok:false,name:'NotReadableError'});
  expect(await page.evaluate(()=>captureCalls.length)).toBe(1);await expect(page.locator('#ldc-ss-bar')).toHaveCount(0);
});
test('Discord stopping the capture cleans its controls and source audio is never requested against the caller choice',async({page})=>{
  await fakeCapture(page);await requestCapture(page,{video:{width:{exact:640}},audio:false});
  await expect(page.getByLabel('Kaynak sesi iste')).toBeDisabled();await page.getByLabel('Yakalama boyutu').selectOption('1080');
  await page.getByRole('button',{name:'Kaynak seç',exact:true}).click();await page.getByRole('button',{name:'Paylaşımı başlat',exact:true}).click();await expect(page.locator('#ldc-ss-bar')).toHaveCount(0);await expect.poll(()=>page.evaluate(()=>captureResult?.ok)).toBe(true);
  expect(await page.evaluate(()=>captureCalls[0].options.video.width)).toEqual({exact:640});
  expect(await page.evaluate(()=>captureCalls[0].options.audio)).toBe(false);
  await page.evaluate(()=>syntheticCapture.getVideoTracks()[0].stop());await expect(page.locator('#ldc-ss-bar')).toHaveCount(0);
});
test('cancelling the live preview releases capture and never returns a stream to Discord',async({page})=>{
  await fakeCapture(page);await requestCapture(page);await page.getByRole('button',{name:'Kaynak seç',exact:true}).click();await expect(page.getByLabel('Canlı ekran önizlemesi')).toBeVisible();await page.getByRole('button',{name:'Vazgeç',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>captureResult)).toEqual({ok:false,name:'NotAllowedError'});expect(await page.evaluate(()=>syntheticCapture.getVideoTracks()[0].readyState)).toBe('ended');await expect(page.locator('#ldc-ss-bar')).toHaveCount(0);
});
test('server shortcuts hide independently without hiding channels named Members or Events',async({page})=>{
  await open(page,'aeroDark',{splash:0});
  await page.evaluate(()=>{const group=document.createElement('ul');group.id='shortcuts-fixture';group.innerHTML='<li><div role="button" tabindex="0">Events</div></li><li><a href="/channels/123/member-safety">Members</a></li><li><div role="button" tabindex="0">Server Boosts</div></li><li><a href="/channels/123/456">Members</a></li>';document.querySelector('[class*="sidebarList_"]').prepend(group);});
  await expect(page.locator('[data-ldc-server-shortcut]')).toHaveCount(3);
  await page.evaluate(()=>window.__LDC_openSettings());await page.getByRole('tab',{name:'Görünüm',exact:true}).click();
  for(const [name,kind] of [['Etkinlikleri gizle','events'],['Üyeler kısayolunu gizle','members'],['Sunucu takviyelerini gizle','boosts']]){
    await page.getByRole('switch',{name,exact:true}).click();await expect(page.locator(`[data-ldc-server-shortcut="${kind}"]`)).toBeHidden();
  }
  await expect(page.locator('a[href="/channels/123/456"]')).toBeVisible();
  await page.getByRole('switch',{name:'Etkinlikleri gizle',exact:true}).click();await expect(page.locator('[data-ldc-server-shortcut="events"]')).toBeVisible();
});
for(const theme of ['aeroDark','midnight']){
  test(`${theme}: digital voice timer and message indicators use the selected theme`,async({page})=>{
    await open(page,theme,{splash:0});await page.evaluate(()=>{const timer=document.createElement('span');timer.className='voiceChannelTimer_fixture';timer.textContent='14:24';document.querySelector('[class*="sidebarList_"]').append(timer);const message=document.querySelector('.message_fixture');message.classList.add('mentioned_fixture','backgroundFlash_fixture');});
    const timer=await page.locator('.voiceChannelTimer_fixture').evaluate(el=>{const s=getComputedStyle(el);return {font:s.fontFamily,padding:s.padding,border:s.borderTopWidth,variant:s.fontVariantNumeric};});
    expect(timer.font).toContain('Consolas');expect(timer.border).toBe('1px');expect(timer.variant).toContain('tabular-nums');
    const message=page.locator('.message_fixture').first();expect(await message.evaluate(el=>getComputedStyle(el,'::before').backgroundColor)).not.toMatch(/240, 178|250, 168/);
    await page.emulateMedia({reducedMotion:'reduce'});expect(await message.evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
  });
}
test('image tools rotate, flip, inspect and reset inside the existing viewer; originals stay untouched',async({page})=>{
  const {errors}=await open(page,'aeroDark',{splash:0});
  const imageUrl='https://media.discordapp.net/attachments/123/456/photo.png?ex=abc&is=def&hm=signature&width=320&format=webp';
  await page.route('https://media.discordapp.net/attachments/**',route=>route.fulfill({contentType:'image/png',body:readFileSync(new URL('../logo-1024.png',import.meta.url))}));
  await page.evaluate(src=>{const modal=document.createElement('section');modal.id='photo-fixture';modal.className='carouselModal_fixture';modal.setAttribute('role','dialog');modal.style.cssText='position:fixed;inset:0;z-index:1000;background:#000e;display:grid;place-items:center';modal.innerHTML='<div class="imageWrapper_fixture"><img style="width:320px;height:320px" alt="Test image"></div>';modal.querySelector('img').src=src;document.body.append(modal);},imageUrl);
  await expect(page.locator('#ldc-photo-tools')).toBeVisible();await expect(page.getByRole('button',{name:'Orijinali indir',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Sağa döndür',exact:true}).click();await page.getByRole('button',{name:'Yatay çevir',exact:true}).click();await page.getByRole('button',{name:'Yakınlaştır',exact:true}).click();
  const image=page.locator('#photo-fixture img');expect(await image.evaluate(el=>el.style.rotate)).toBe('90deg');expect(await image.getAttribute('src')).toBe(imageUrl);
  await page.getByRole('button',{name:'Piksel inceleme',exact:true}).click();expect(await image.evaluate(el=>el.style.imageRendering)).toBe('pixelated');
  await page.screenshot({path:'test-results/photo-tools.png'});
  await page.getByRole('button',{name:'Görünümü sıfırla',exact:true}).click();expect(await image.evaluate(el=>el.style.rotate)).toBe('0deg');expect(await image.evaluate(el=>el.style.scale)).toBe('1');
  await page.evaluate(()=>document.getElementById('photo-fixture').remove());await expect(page.locator('#ldc-photo-tools')).toHaveCount(0);expect(errors).toEqual([]);
});
test('cinema fills the viewport, offers explicit crop/stretch choices and restores the same live video',async({page})=>{
  const {errors}=await open(page,'aeroDark',{splash:0});
  await page.evaluate(()=>{const stage=document.createElement('section');stage.id='cinema-fixture';stage.className='callContainer_fixture';stage.style.cssText='position:fixed;top:120px;left:400px;width:600px;height:340px;background:#000;transform:translateZ(0);overflow:hidden';const video=document.createElement('video');video.style.cssText='width:600px;height:340px';video.muted=true;const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const c=canvas.getContext('2d');c.fillStyle='#145b78';c.fillRect(0,0,1280,720);video.srcObject=canvas.captureStream(1);video.play();stage.append(video);document.body.append(stage);window.originalCinemaStream=video.srcObject;});
  await page.getByRole('button',{name:'Sinema',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-ldc-cinema','');
  const video=page.locator('#ldc-cinema-view video');const original=page.locator('#cinema-fixture video');const bounds=await video.boundingBox();expect(bounds.x).toBe(0);expect(bounds.y).toBe(0);expect(bounds.width).toBe(1440);expect(bounds.height).toBe(960);
  expect(await page.evaluate(()=>document.elementFromPoint(36,70)?.tagName)).toBe('VIDEO');
  await expect(page.locator('#ldc-cinema-view')).toBeVisible();
  await page.locator('#ldc-cinema-tools summary').click();await page.getByLabel('Görüntü yerleşimi').selectOption('cover');expect(await video.evaluate(el=>getComputedStyle(el).objectFit)).toBe('cover');
  await page.getByLabel('Görüntü yerleşimi').selectOption('fill');expect(await video.evaluate(el=>getComputedStyle(el).objectFit)).toBe('fill');
  await page.screenshot({path:'test-results/cinema.png'});await page.keyboard.press('Escape');
  await expect(page.locator('html')).not.toHaveAttribute('data-ldc-cinema');expect(await original.evaluate(el=>el.srcObject===originalCinemaStream)).toBe(true);
  expect((await original.boundingBox()).width).toBe(600);expect(await page.locator('[data-ldc-cinema-path]').count()).toBe(0);
  await page.evaluate(()=>document.getElementById('cinema-fixture').remove());await expect(page.locator('#ldc-cinema-tools')).toHaveCount(0);expect(errors).toEqual([]);
});

async function nestedCall(page){
  await open(page,'aeroDark',{splash:0});
  await page.evaluate(()=>{
    const layer=document.createElement('section');layer.id='call-layer';layer.style.cssText='position:absolute;inset:100px 0 0 320px;opacity:.99;contain:paint;overflow:hidden;will-change:transform;clip:rect(0px,900px,700px,0px)';
    const stage=document.createElement('div');stage.className='callContainer_nested';stage.style.cssText='width:800px;height:450px;transform:translate(14px,20px);overflow:hidden';
    const tile=document.createElement('div');tile.className='streamTile_nested';tile.setAttribute('aria-label','Deniz ekran paylaşımı');const video=document.createElement('video');video.muted=true;video.style.cssText='width:800px;height:450px;object-fit:contain';
    const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const paint=canvas.getContext('2d');paint.fillStyle='#17445c';paint.fillRect(0,0,1280,720);paint.fillStyle='#e0e8ee';paint.font='34px Segoe UI';paint.fillText('Sinema · yerel test yayını',80,100);
    video.srcObject=canvas.captureStream(5);video.play();tile.append(video);stage.append(tile);layer.append(stage);document.getElementById('app-mount').append(layer);window.callSource=video;window.callTrack=video.srcObject.getVideoTracks()[0];
    const controls=document.createElement('div');controls.id='discord-call-controls';controls.style.cssText='position:fixed;left:calc(50% - 300px);bottom:18px;width:600px;height:48px;background:#203747;border-radius:10px;z-index:100';controls.textContent='Kamera · Ekran paylaşımı · Bağlantıyı kes';document.body.append(controls);
  });
  await expect(page.getByRole('button',{name:'Sinema',exact:true})).toBeVisible();
}
test('cinema launcher stays clear of Discord call controls',async({page})=>{
  await nestedCall(page);
  const entry=await page.getByRole('button',{name:'Sinema',exact:true}).boundingBox(),controls=await page.locator('#discord-call-controls').boundingBox();
  expect(entry.x<controls.x+controls.width&&entry.x+entry.width>controls.x&&entry.y<controls.y+controls.height&&entry.y+entry.height>controls.y).toBe(false);
});
test('cinema leaves a nested Discord call layout intact and shows a viewport-sized view',async({page})=>{
  await nestedCall(page);
  const before=await page.locator('.callContainer_nested').evaluate(el=>({transform:getComputedStyle(el).transform,width:el.getBoundingClientRect().width,clip:getComputedStyle(el.parentElement).clip,contain:getComputedStyle(el.parentElement).contain}));
  await page.getByRole('button',{name:'Sinema',exact:true}).click();
  const after=await page.locator('.callContainer_nested').evaluate(el=>({transform:getComputedStyle(el).transform,width:el.getBoundingClientRect().width,clip:getComputedStyle(el.parentElement).clip,contain:getComputedStyle(el.parentElement).contain}));
  expect(after).toEqual(before);
  await expect(page.locator('#ldc-cinema-view')).toBeVisible();
  expect(await page.locator('#ldc-cinema-view').evaluate(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}))).toEqual({width:1440,height:960});
});

test('cinema switches video tracks explicitly, never adds audio or stops Discord tracks',async({page})=>{
  await nestedCall(page);await page.evaluate(()=>{
    const tile=document.createElement('div');tile.className='streamTile_second';tile.setAttribute('aria-label','Ece ekran paylaşımı');tile.style.cssText='position:fixed;left:20px;top:100px';const video=document.createElement('video');video.style.cssText='width:280px;height:160px';video.muted=true;const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;canvas.getContext('2d').fillRect(0,0,640,360);video.srcObject=canvas.captureStream(5);video.play();tile.append(video);document.querySelector('#call-layer').append(tile);window.secondSource=video;window.secondTrack=video.srcObject.getVideoTracks()[0];
  });
  await page.getByRole('button',{name:'Sinema',exact:true}).click();await page.locator('#ldc-cinema-tools summary').click();
  await expect(page.getByLabel('Görüntü kaynağı',{exact:true}).locator('option')).toHaveCount(2);
  const second=await page.getByLabel('Görüntü kaynağı',{exact:true}).locator('option').filter({hasText:'Ece'}).getAttribute('value');await page.getByLabel('Görüntü kaynağı',{exact:true}).selectOption(second);
  expect(await page.locator('#ldc-cinema-view video').evaluate(el=>el.srcObject.getVideoTracks()[0]===secondTrack&&el.srcObject.getAudioTracks().length===0&&el.muted)).toBe(true);
  await page.getByRole('button',{name:'Sinemadan çık',exact:true}).click();
  expect(await page.evaluate(()=>[callTrack.readyState,secondTrack.readyState,callSource.srcObject.getVideoTracks()[0]===callTrack])).toEqual(['live','live',true]);
});
test('cinema restores focus and handles repeated opening, source removal and stream replacement',async({page})=>{
  await nestedCall(page);await page.getByRole('button',{name:'Sinema',exact:true}).click();
  await page.evaluate(()=>{document.querySelector('[aria-label="Sinemadan çık"]').click();document.getElementById('ldc-cinema-entry').click();});
  await expect(page.locator('#ldc-cinema-view')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('#ldc-cinema-view')).toHaveCount(0);await expect(page.locator('#ldc-cinema-entry')).toBeFocused();
  await page.getByRole('button',{name:'Sinema',exact:true}).click();await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;callSource.srcObject=canvas.captureStream(5);});
  await expect(page.locator('#ldc-cinema-view')).toHaveCount(0);expect(await page.evaluate(()=>callTrack.readyState)).toBe('live');
  await page.getByRole('button',{name:'Sinema',exact:true}).click();await page.evaluate(()=>document.getElementById('call-layer').remove());await expect(page.locator('#ldc-cinema-view')).toHaveCount(0);await expect(page.locator('#ldc-cinema-entry')).toBeHidden();
});
test('cinema stays inside a small viewport and its fullscreen control owns only its own viewer',async({page})=>{
  await nestedCall(page);await page.getByRole('button',{name:'Sinema',exact:true}).click();
  await page.getByRole('button',{name:'Tam ekran',exact:true}).click();await expect.poll(()=>page.evaluate(()=>document.fullscreenElement?.className)).toBe('ldc-cinema-surface');
  await page.getByRole('button',{name:'Tam ekran',exact:true}).click();await expect.poll(()=>page.evaluate(()=>document.fullscreenElement)).toBe(null);await expect(page.locator('#ldc-cinema-view')).toBeVisible();
  await page.setViewportSize({width:800,height:600});await page.locator('#ldc-cinema-tools summary').click();
  const bounds=await page.locator('.ldc-cinema-pane').boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.y).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(800);expect(bounds.y+bounds.height).toBeLessThanOrEqual(600);
  await page.screenshot({path:'test-results/cinema-nested-small.png'});await page.getByRole('button',{name:'Sinemadan çık',exact:true}).click();expect(await page.evaluate(()=>callTrack.readyState)).toBe('live');
});
test('cinema closes when the selected track ends and ignores the app share preview',async({page})=>{
  await nestedCall(page);await page.getByRole('button',{name:'Sinema',exact:true}).click();await page.evaluate(()=>callTrack.stop());await expect(page.locator('#ldc-cinema-view')).toHaveCount(0);await expect(page.locator('#ldc-cinema-entry')).toBeHidden();
  await page.evaluate(()=>{document.getElementById('call-layer').remove();const preview=document.createElement('section');preview.id='ldc-share-menu';preview.className='callContainer_preview';preview.innerHTML='<video style="width:800px;height:450px"></video>';const canvas=document.createElement('canvas');preview.querySelector('video').srcObject=canvas.captureStream(5);document.body.append(preview);});
  await expect(page.locator('#ldc-cinema-entry')).toBeHidden();
});
test('cinema keeps microphone commands and the settings shortcut usable',async({page})=>{
  await nestedCall(page);await page.getByRole('button',{name:'Sinema',exact:true}).click();
  await page.evaluate(()=>window.__LDC_setMute('mute'));await expect(page.locator('#fixture-mic')).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('Control+Shift+Comma');await expect(page.locator('#ldc-cinema-view')).toHaveCount(0);await expect(page.locator('#ldc-modal')).toBeVisible();expect(await page.evaluate(()=>callTrack.readyState)).toBe('live');
});

test('card editor saves a local skin and safely renders text without contacting an ecosystem',async({page})=>{
  const {errors,requests}=await open(page,'aeroDark',{splash:0});await page.evaluate(()=>window.__LDC_openSettings());await page.getByRole('tab',{name:'Kartım',exact:true}).click();
  await page.getByLabel('Görünen ad',{exact:true}).fill('ademiru');await page.getByLabel('Kısa açıklama',{exact:true}).fill('gece sohbeti / müzik');await page.getByLabel('Hakkımda',{exact:true}).fill('<img src=x onerror=alert(1)>');
  for(const skin of ['aero-night','graphite','silver','amber']){await page.getByLabel('Kaplama',{exact:true}).selectOption(skin);await expect(page.locator('.idgaf-user-card')).toHaveAttribute('data-skin',skin);await page.screenshot({path:`test-results/card-${skin}.png`});}
  await expect(page.locator('.idgaf-card-bio')).toHaveText('<img src=x onerror=alert(1)>');expect(await page.locator('.idgaf-card-bio img').count()).toBe(0);
  await page.getByRole('button',{name:'Kartı kaydet',exact:true}).click();expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('ldc_profileCard')).skin)).toBe('amber');
  await page.reload();await page.evaluate(()=>window.__LDC_openSettings());await page.getByRole('tab',{name:'Kartım',exact:true}).click();await expect(page.getByLabel('Görünen ad',{exact:true})).toHaveValue('ademiru');
  expect(requests.some(url=>url.includes('workers.dev'))).toBe(false);expect(errors).toEqual([]);
});
test('ecosystem card callbacks cannot attach a stale identity and disabling the connection removes published cards',async({page})=>{
  await open(page,'aeroDark',{splash:0});
  await page.evaluate(()=>window.__LDC_setNativeSettings({ecosystem_url:'https://idgafcord.example.workers.dev',ecosystem_enabled:true}));
  await page.evaluate(()=>{const profile=document.createElement('section');profile.className='userProfileOuter_fixture';profile.id='ecosystem-fixture';profile.innerHTML='<img src="https://cdn.discordapp.com/avatars/123456789012345678/avatar.png">';document.body.append(profile);});
  await expect(page.locator('#ecosystem-fixture')).toHaveAttribute('data-ldc-ecosystem-user','123456789012345678');
  await page.evaluate(()=>window.__LDC_ecosystemCard({request:'card-1',id:'234567890123456789',status:'ok',card:{name:'Wrong person'}}));await expect(page.locator('.ldc-ecosystem-profile')).toHaveCount(0);
  await page.evaluate(()=>window.__LDC_ecosystemCard({request:'card-1',id:'123456789012345678',status:'ok',card:{name:'Deniz',client:'Vesktop',bio:'<script>bad()</script>'}}));
  await expect(page.locator('.ldc-ecosystem-profile')).toContainText('Vesktop');await expect(page.locator('.ldc-ecosystem-source')).toHaveText('İstemci: profil sahibinin seçimi');await expect(page.locator('.ldc-ecosystem-profile script')).toHaveCount(0);
  await page.evaluate(()=>window.__LDC_setNativeSettings({ecosystem_url:'',ecosystem_enabled:false}));await expect(page.locator('.ldc-ecosystem-profile')).toHaveCount(0);
});
