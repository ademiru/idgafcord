  // An app-owned entry in Discord's existing settings navigation. React nodes
  // are never cloned, replaced, or assigned new event handlers.
  var discordSettingsNav=null,discordSettingsFrame=null,discordSettingsEntry=null,settingsScanTimer=null;
  var settingsNavSelector='nav[aria-label="Settings pages"],nav[aria-label="Ayar sayfaları"],aside[aria-label="Settings sidebar"] nav,aside[aria-label="Ayarlar kenar çubuğu"] nav,[class*="standardSidebarView_"] [class*="sidebarRegion_"] [role="tablist"]';
  function userSettingsNav(nav){
    if(nav.closest('#ldc-modal'))return false;
    return Array.from(nav.querySelectorAll('a,button,[role="tab"],[role="link"]')).some(function(item){
      return /^(my account|account|hesabım|hesap)$/i.test((item.getAttribute('aria-label')||item.textContent||'').trim());
    });
  }
  function discordPanelHost(){
    if(!discordSettingsNav||!discordSettingsNav.isConnected||!discordSettingsFrame||!discordSettingsFrame.isConnected||!discordSettingsNav.getBoundingClientRect().width)return null;
    return discordSettingsFrame;
  }
  function scanDiscordSettings(){
    settingsScanTimer=null;
    if(modal&&!modal.isConnected)closePanel();
    if(discordSettingsNav&&discordSettingsNav.isConnected&&discordSettingsEntry&&discordSettingsEntry.isConnected)return;
    if(discordSettingsFrame)discordSettingsFrame.removeAttribute('data-ldc-discord-settings');
    if(discordSettingsEntry)discordSettingsEntry.remove();
    discordSettingsNav=null;discordSettingsFrame=null;discordSettingsEntry=null;
    var candidates=document.querySelectorAll(settingsNavSelector);
    for(var i=0;i<candidates.length;i++){if(userSettingsNav(candidates[i])){discordSettingsNav=candidates[i];break;}}
    if(!discordSettingsNav)return;
    var nav=discordSettingsNav,aside=nav.closest('aside');
    discordSettingsFrame=nav.closest('[role="dialog"],[class*="standardSidebarView_"]')||(aside&&aside.parentElement)||nav.parentElement;
    discordSettingsFrame.setAttribute('data-ldc-discord-settings','');
    nav.setAttribute('data-ldc-settings-nav','');
    var list=Array.from(nav.children).find(function(child){return child.matches('ul,ol');})||nav;
    var entry=document.createElement(list.matches('ul,ol')?'li':'div');entry.className='ldc-discord-settings-section';entry.setAttribute('aria-label','idgafcord');
    var heading=document.createElement('div');heading.className='ldc-discord-settings-label';heading.textContent='idgafcord';
    var button=document.createElement('button');button.id='ldc-discord-settings-open';button.type='button';button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls','ldc-modal');
    var icon=document.createElement('img');icon.src=LDC_LOGO_DATA_URI;icon.alt='';icon.width=22;icon.height=22;
    var text=document.createElement('span');text.textContent=lang==='en'?'Client settings':'İstemci ayarları';
    button.appendChild(icon);button.appendChild(text);button.onclick=openPanel;
    entry.appendChild(heading);entry.appendChild(button);list.prepend(entry);discordSettingsEntry=entry;
  }
  function queueSettingsScan(){if(!settingsScanTimer)settingsScanTimer=setTimeout(scanDiscordSettings,60);}
  function decorateHome(scope){
    var home=scope.matches&&scope.matches('[data-list-item-id="guildsnav___home"]')?scope:scope.querySelector&&scope.querySelector('[data-list-item-id="guildsnav___home"]');
    if(home){
      var row=home.closest('[class*="listItem_"],li');if(row)row.setAttribute('data-ldc-home-item','');
      var viewport=home.closest('foreignObject'),svg=viewport&&viewport.closest('svg');
      if(svg){
        viewport.setAttribute('data-ldc-home-viewport','');svg.setAttribute('data-ldc-home-svg','');
        for(var wrap=svg.parentElement;wrap&&wrap!==row&&row&&row.contains(wrap);wrap=wrap.parentElement)wrap.setAttribute('data-ldc-home-wrap','');
      }
    }
  }
  var headerSettingsButton=null;
  function ensureHeaderSettings(){
    var help=document.querySelector('a[href^="https://support.discord.com"]');
    var host=help&&(help.closest('[class*="trailing_"]')||help.closest('[role="toolbar"]')||help.parentElement);
    if(!host)return;
    if(!headerSettingsButton){
      headerSettingsButton=document.createElement('button');headerSettingsButton.id='ldc-header-settings';headerSettingsButton.type='button';
      headerSettingsButton.setAttribute('aria-haspopup','dialog');headerSettingsButton.setAttribute('aria-controls','ldc-modal');
      headerSettingsButton.innerHTML='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m9 3-.6 2-2 .9-1.9-.5-2 3.4 1.4 1.6v2.3L2.5 14l2 3.4 1.9-.4 2 .9.6 2.1h4l.6-2.1 2-.9 1.9.4 2-3.4-1.4-1.3v-2.3l1.4-1.6-2-3.4-1.9.5-2-.9L13 3z"/><circle cx="11" cy="11.5" r="3"/></svg><span>idgafcord</span>';
      headerSettingsButton.onclick=function(){activeTab='system';openPanel();};
    }
    headerSettingsButton.title=lang==='en'?'idgafcord settings':'idgafcord ayarları';headerSettingsButton.setAttribute('aria-label',headerSettingsButton.title);
    if(headerSettingsButton.parentNode!==host)host.insertBefore(headerSettingsButton,host.firstChild);
  }
  var settingsIntegrationObserver=new MutationObserver(function(records){
    if(!headerSettingsButton||!headerSettingsButton.isConnected)ensureHeaderSettings();
    if(modal&&!modal.isConnected)queueSettingsScan();
    if(discordSettingsNav&&(!discordSettingsNav.isConnected||!discordSettingsEntry.isConnected))queueSettingsScan();
    records.forEach(function(record){if(record.type==='attributes'&&record.target.closest(ecosystemProfileSelector))scanEcosystem();Array.from(record.addedNodes).forEach(function(node){
      if(node.nodeType!==1||node.closest('#ldc-root,#ldc-modal,.ldc-discord-settings-section'))return;
      decorateHome(node);decorateWorkspace(node);if(node.matches(ecosystemProfileSelector)||node.closest(ecosystemProfileSelector)||node.querySelector(ecosystemProfileSelector))scanEcosystem();
      if(!discordSettingsNav&&(node.matches(settingsNavSelector)||node.querySelector(settingsNavSelector)))queueSettingsScan();
    });});
  });
  settingsIntegrationObserver.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});
  scanDiscordSettings();decorateHome(document);decorateWorkspace(document);ensureHeaderSettings();
  // A deliberate Discord toggle wins over an app-level layout preference.
  window.addEventListener('click',function(event){
    var button=event.target.closest&&event.target.closest('button,[role="button"]');
    if(SAFE||!button||button.closest('#ldc-root,#ldc-modal'))return;
    var label=normVoice(button.getAttribute('aria-label')||button.getAttribute('title')||'');
    if(!/^(show|hide) member list$|^uye listesini (goster|gizle)$/.test(label))return;
    if(!ison('hideMembers','0')&&document.documentElement.getAttribute('data-ldc-aero-focus')!=='1')return;
    set('hideMembers','0');set('aeroFocus','0');
    if(switches.hideMembers)switches.hideMembers.set(false);if(switches.aeroFocus)switches.aeroFocus.set(false);
    if(/^hide\b|\bgizle$/.test(label)){event.preventDefault();event.stopImmediatePropagation();}
    applyAll();
  },true);
